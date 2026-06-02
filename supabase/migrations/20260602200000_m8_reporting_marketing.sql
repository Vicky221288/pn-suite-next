-- ============================================================================
-- M8 — REPORTING + MARKETING LEAF (the FINAL module-migration sub-phase)
-- ----------------------------------------------------------------------------
-- Benchmarked vs Oracle OPERA reporting / Revinate Marketing (NOT a legacy
-- re-skin). The LEAF: it READS what every prior phase wrote. Mostly read RPCs +
-- a minimal marketing layer. Reuses the ONE finance_ledger, existing invoices/
-- invoice_lines, existing leads — no parallel ledger, no parallel lead store.
--
--  A) CONSOLIDATED P&L — a pure READ over the ONE finance_ledger: revenue credits
--     MINUS expense debits (incl. M6 expenses) bucketed by source_domain
--     (hall/stays/catering/core) over a range. Invariant #10: P&L is a QUERY — NO
--     stored/cached P&L table. Money gated by pnl.view_margin.
--
--  B) GST-RETURN SURFACE — READ-ONLY over resolve_gst OUTPUT (the firewall):
--     OUTPUT tax is read from the RESOLVED snapshot already on invoice_lines
--     (gst_rate/cgst/sgst — the W1e/S4 output of resolve_gst); INPUT GST is read as
--     DATA from expenses (M6). It groups/sums an already-resolved output.
--     ╔══════════════════════════════════════════════════════════════════════╗
--     ║ GST FIREWALL: M8 NEVER calls resolve_gst, NEVER computes/stores a rate, ║
--     ║ NEVER alters an invoice. It reports the snapshot. resolve_gst stays the ║
--     ║ sole rate authority. (Reporting only — GSTN/portal filing is external.) ║
--     ╚══════════════════════════════════════════════════════════════════════╝
--
--  C) PER-CUSTOMER AR AGEING — extends M6's aggregate ageing to PER GUEST
--     (invoices link to a guest via event/stay), bucketed 0-30/31-60/61-90/90+.
--     Closes the KL-11 ageing residual. Money gated.
--
--  D) MARKETING LEAF (minimal, real): lead-source attribution over the EXISTING
--     leads (reuses leads.source; adds a nullable leads.campaign_id) + a simple
--     `campaigns` record + LED advertising `led_bookings` whose revenue posts to
--     the EXISTING finance_ledger via write_ledger (NO parallel ledger). NO
--     marketing automation (M3-auto owns outreach), NO ML attribution, NO ad
--     scheduling. If LED revenue is taxable, GST is the existing invoice/resolve_gst
--     path's job — M8 sets no rate.
--
-- Reads RLS+capability-gated; writes atomic + audited + tenant-scoped (SECURITY
-- DEFINER, auth.uid() self-auth). Cap `marketing.manage` gates marketing writes;
-- money figures gated by `pnl.view_margin`.
-- ============================================================================

create table if not exists public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  name         text not null,
  channel      text,
  period_start date,
  period_end   date,
  spend        numeric(14,2) not null default 0 check (spend >= 0),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists uq_campaigns_org_name on public.campaigns (org_id, lower(btrim(name)));

create table if not exists public.led_bookings (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  advertiser_name  text not null,
  slot_description text,
  period_start     date,
  period_end       date,
  amount           numeric(14,2) not null check (amount >= 0),   -- revenue (net); GST, if invoiced, is the invoice path's job
  ledger_entry_id  uuid references public.finance_ledger(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_led_bookings_org on public.led_bookings (org_id, created_at desc);

-- reuse the EXISTING leads (leads.source already exists); add a nullable campaign link
alter table public.leads add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['campaigns','led_bookings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ============================================================================
-- A) consolidated_pnl — pure READ over the ONE finance_ledger (no stored P&L).
-- Revenue (credit) − expenses (debit, incl. M6) per source_domain. Money gated.
-- ============================================================================
create or replace function public.consolidated_pnl(p_org uuid, p_from date, p_to date)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_can boolean; r record; v_streams jsonb := '{}'::jsonb; v_rev numeric := 0; v_exp numeric := 0;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  v_can := (auth.uid() is null) or public.has_capability(p_org, 'pnl.view_margin');

  for r in
    select source_domain,
           coalesce(sum(amount) filter (where direction = 'credit'), 0) as rev,
           coalesce(sum(amount) filter (where direction = 'debit'), 0)  as exp
    from public.finance_ledger
    where org_id = p_org and entry_date between p_from and p_to
    group by source_domain
  loop
    v_rev := v_rev + r.rev; v_exp := v_exp + r.exp;
    v_streams := v_streams || jsonb_build_object(r.source_domain, jsonb_build_object(
      'revenue',  case when v_can then r.rev else null end,
      'expenses', case when v_can then r.exp else null end,
      'net',      case when v_can then r.rev - r.exp else null end));
  end loop;

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'can_see', v_can, 'streams', v_streams,
    'total', jsonb_build_object(
      'revenue',  case when v_can then v_rev else null end,
      'expenses', case when v_can then v_exp else null end,
      'net',      case when v_can then v_rev - v_exp else null end));
end; $$;

-- ============================================================================
-- B) gst_return_report — READ-ONLY over the resolve_gst OUTPUT snapshot on
-- invoice_lines + input-GST DATA on expenses. NEVER calls resolve_gst, NEVER
-- writes invoices. Money gated.
-- ============================================================================
create or replace function public.gst_return_report(p_org uuid, p_from date, p_to date)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_can boolean; r record; v_rates jsonb := '[]'::jsonb; v_out_tax numeric := 0; v_in numeric := 0;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  v_can := (auth.uid() is null) or public.has_capability(p_org, 'pnl.view_margin');

  -- OUTPUT tax: read the RESOLVED snapshot already on invoice_lines (no recompute)
  for r in
    select il.gst_rate,
           coalesce(sum(il.taxable_value), 0) as taxable,
           coalesce(sum(il.cgst), 0)          as cgst,
           coalesce(sum(il.sgst), 0)          as sgst
    from public.invoice_lines il
    join public.invoices i on i.id = il.invoice_id
    where il.org_id = p_org and (i.issued_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    group by il.gst_rate
    order by il.gst_rate
  loop
    v_out_tax := v_out_tax + r.cgst + r.sgst;
    v_rates := v_rates || jsonb_build_object('gst_rate', r.gst_rate,
      'taxable_value', case when v_can then r.taxable else null end,
      'cgst', case when v_can then r.cgst else null end,
      'sgst', case when v_can then r.sgst else null end,
      'tax',  case when v_can then r.cgst + r.sgst else null end);
  end loop;

  -- INPUT GST: read as DATA from expenses (M6); never resolved
  select coalesce(sum(input_gst_amount), 0) into v_in from public.expenses
    where org_id = p_org and expense_date between p_from and p_to and input_gst_amount is not null;

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to), 'can_see', v_can,
    'output_by_rate', v_rates,
    'output_total_tax', case when v_can then v_out_tax else null end,
    'input_gst_total',  case when v_can then v_in else null end,
    'net_tax',          case when v_can then v_out_tax - v_in else null end,
    'note', 'reporting only — reads resolve_gst output; GSTN/portal submission is external');
end; $$;

-- ============================================================================
-- C) ar_ageing_by_customer — per-guest AR buckets over outstanding invoices
-- (closes KL-11 aggregate-only residual). Money gated.
-- ============================================================================
create or replace function public.ar_ageing_by_customer(p_org uuid, p_as_of date default (now() at time zone 'Asia/Kolkata')::date)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_can boolean; r record; v_rows jsonb := '[]'::jsonb; v_name text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  v_can := (auth.uid() is null) or public.has_capability(p_org, 'pnl.view_margin');

  for r in
    with inv as (
      select coalesce(i.amount_due, i.total) as outstanding,
             (i.issued_at at time zone 'Asia/Kolkata')::date as idate,
             coalesce(ev.guest_id, rs.guest_id) as guest_id
      from public.invoices i
      left join public.events ev on ev.id = i.event_id
      left join public.room_stays rs on rs.id = i.stay_id
      where i.org_id = p_org and i.status = 'issued' and coalesce(i.amount_due, i.total) > 0
    )
    select guest_id,
      count(*) as cnt,
      coalesce(sum(outstanding) filter (where p_as_of - idate <= 30), 0)              as b0,
      coalesce(sum(outstanding) filter (where p_as_of - idate between 31 and 60), 0)  as b1,
      coalesce(sum(outstanding) filter (where p_as_of - idate between 61 and 90), 0)  as b2,
      coalesce(sum(outstanding) filter (where p_as_of - idate > 90), 0)               as b3,
      coalesce(sum(outstanding), 0)                                                    as tot
    from inv group by guest_id
  loop
    v_name := (select name from public.guests where id = r.guest_id and org_id = p_org);
    v_rows := v_rows || jsonb_build_object(
      'guest_id', r.guest_id, 'guest_name', coalesce(v_name, '(unattributed)'), 'count', r.cnt,
      'buckets', jsonb_build_object(
        '0_30',   case when v_can then r.b0 else null end,
        '31_60',  case when v_can then r.b1 else null end,
        '61_90',  case when v_can then r.b2 else null end,
        '90_plus',case when v_can then r.b3 else null end),
      'total', case when v_can then r.tot else null end);
  end loop;

  return jsonb_build_object('as_of', p_as_of, 'can_see_amounts', v_can, 'customers', v_rows);
end; $$;

-- ============================================================================
-- D) upsert_campaign / set_lead_source / record_ad_revenue (cap marketing.manage)
--    + lead_source_report (read; counts member-open, spend gated).
-- ============================================================================
create or replace function public.upsert_campaign(
  p_org uuid, p_name text, p_channel text default null, p_period_start date default null, p_period_end date default null,
  p_spend numeric default 0, p_campaign_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'marketing.manage') then raise exception 'forbidden' using errcode='42501', detail='marketing.manage required'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'bad_name' using errcode='22023'; end if;
  if p_campaign_id is null then
    insert into public.campaigns(org_id, name, channel, period_start, period_end, spend)
      values (p_org, btrim(p_name), p_channel, p_period_start, p_period_end, coalesce(p_spend,0)) returning id into v_id;
  else
    update public.campaigns set name = btrim(p_name), channel = p_channel, period_start = p_period_start, period_end = p_period_end, spend = coalesce(p_spend,0), updated_at = now()
      where id = p_campaign_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'campaign_not_found' using errcode='P0002'; end if;
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'marketing.campaign_upsert', 'completed', coalesce(p_actor_id, auth.uid()), 'campaign', v_id::text);
  return jsonb_build_object('campaign_id', v_id);
end; $$;

create or replace function public.set_lead_source(p_org uuid, p_lead_id uuid, p_source text, p_campaign_id uuid default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'marketing.manage') then raise exception 'forbidden' using errcode='42501', detail='marketing.manage required'; end if;
  if coalesce(btrim(p_source),'') = '' then raise exception 'bad_source' using errcode='22023'; end if;
  if p_campaign_id is not null and not exists (select 1 from public.campaigns where id = p_campaign_id and org_id = p_org) then raise exception 'campaign_not_found' using errcode='P0002'; end if;
  update public.leads set source = btrim(p_source), campaign_id = p_campaign_id, updated_at = now() where id = p_lead_id and org_id = p_org;
  if not found then raise exception 'lead_not_found' using errcode='P0002'; end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'marketing.lead_source_set', 'completed', coalesce(p_actor_id, auth.uid()), 'lead', p_lead_id::text, jsonb_build_object('source', p_source, 'campaign_id', p_campaign_id));
  return jsonb_build_object('lead_id', p_lead_id, 'source', p_source, 'campaign_id', p_campaign_id);
end; $$;

-- lead_source_report — counts member-open; campaign spend/ROI gated by pnl.view_margin
create or replace function public.lead_source_report(p_org uuid, p_from date, p_to date)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_can boolean; r record; v_by_source jsonb := '[]'::jsonb; v_by_campaign jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  v_can := (auth.uid() is null) or public.has_capability(p_org, 'pnl.view_margin');

  for r in
    select source, count(*) as leads, count(*) filter (where status = 'won') as conversions
    from public.leads where org_id = p_org and (created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
    group by source order by count(*) desc
  loop
    v_by_source := v_by_source || jsonb_build_object('source', r.source, 'leads', r.leads, 'conversions', r.conversions);
  end loop;

  for r in
    select c.id, c.name, c.spend,
           count(l.id) as leads, count(l.id) filter (where l.status = 'won') as conversions
    from public.campaigns c
    left join public.leads l on l.campaign_id = c.id and l.org_id = p_org
    where c.org_id = p_org
    group by c.id, c.name, c.spend order by c.name
  loop
    v_by_campaign := v_by_campaign || jsonb_build_object('campaign_id', r.id, 'name', r.name,
      'leads', r.leads, 'conversions', r.conversions, 'spend', case when v_can then r.spend else null end);
  end loop;

  return jsonb_build_object('range', jsonb_build_object('from', p_from, 'to', p_to),
    'can_see_spend', v_can, 'by_source', v_by_source, 'by_campaign', v_by_campaign);
end; $$;

-- record_ad_revenue — LED booking → revenue posts to the EXISTING finance_ledger
-- (write_ledger; NO parallel ledger). M8 sets NO GST rate. (cap marketing.manage)
create or replace function public.record_ad_revenue(
  p_org uuid, p_advertiser text, p_amount numeric, p_slot text default null,
  p_period_start date default null, p_period_end date default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_booking uuid; v_led uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'marketing.manage') then raise exception 'forbidden' using errcode='42501', detail='marketing.manage required'; end if;
  if coalesce(btrim(p_advertiser),'') = '' then raise exception 'bad_advertiser' using errcode='22023'; end if;

  insert into public.led_bookings(org_id, advertiser_name, slot_description, period_start, period_end, amount)
    values (p_org, btrim(p_advertiser), p_slot, p_period_start, p_period_end, p_amount) returning id into v_booking;   -- write 1 (amount CHECK >= 0)
  -- revenue posts to the ONE ledger (supply_type tag 'led', source_domain core). NO rate set by M8.
  v_led := (public.write_ledger(p_org, 'led', p_amount, 'credit', 'core', 'led_booking', v_booking::text, 'LED advertising revenue', p_actor_id) ->> 'ledger_id')::uuid;   -- write 2
  update public.led_bookings set ledger_entry_id = v_led where id = v_booking;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'marketing.ad_revenue', 'completed', coalesce(p_actor_id, auth.uid()), 'led_booking', v_booking::text, jsonb_build_object('amount', p_amount, 'ledger_entry_id', v_led));
  return jsonb_build_object('led_booking_id', v_booking, 'ledger_entry_id', v_led, 'amount', p_amount);
end; $$;

-- ── grants ────────────────────────────────────────────────────────────────--
do $$
declare fn text;
begin
  foreach fn in array array[
    'consolidated_pnl(uuid,date,date)',
    'gst_return_report(uuid,date,date)',
    'ar_ageing_by_customer(uuid,date)',
    'lead_source_report(uuid,date,date)',
    'upsert_campaign(uuid,text,text,date,date,numeric,uuid,uuid)',
    'set_lead_source(uuid,uuid,text,uuid,uuid)',
    'record_ad_revenue(uuid,text,numeric,text,date,date,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
