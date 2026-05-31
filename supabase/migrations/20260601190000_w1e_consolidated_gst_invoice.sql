-- ============================================================================
-- W1e — CONSOLIDATED MULTI-RATE GST INVOICE (the catering loop closer)
-- ----------------------------------------------------------------------------
-- ONE invoice over the shared Event, spanning up to three supply-types:
--   hall rent        → 18% w/ITC  (CGST 9 + SGST 9)
--   rooms / in-house F&B / room-dining → 5% no-ITC  (non-specified premises)
--   catering         → composite 5% catering-led (SAC 9963)
-- The RATE IS NEVER STORED on the line or the menu item — it is RESOLVED by the
-- GST engine (resolve_gst) from the line's supply_type + the property's
-- specified-premises flag. We EXTEND the B5 invoices engine (no parallel path):
-- invoices gains event-level + multi-rate columns; a new invoice_lines table
-- carries the per-supply-type lines. Deposit = escrowed liability (§12 #6):
-- discharged against balance via deposit_ledger, NEVER a finance_ledger revenue
-- line, NOT taxed — unless FORFEITED, which then becomes taxable income.
-- Atomic + audited + tenant-scoped. Config-driven GST (no hardcoded line rate).
-- ============================================================================

-- ── property-level specified-premises flag (config-driven; PN = non-specified) ─
alter table public.orgs add column if not exists specified_premises boolean not null default false;

-- ── extend the B5 invoices header to an event-level, multi-rate document ──────
alter table public.invoices alter column booking_id drop not null;        -- catering-only event has no hall booking
alter table public.invoices alter column gst_rate   drop not null;        -- multi-rate header has no single rate
alter table public.invoices alter column sac_code   drop not null;
alter table public.invoices drop constraint if exists invoices_supply_type_check;
alter table public.invoices add  constraint invoices_supply_type_check check (supply_type in ('composite','itemised','consolidated'));
alter table public.invoices add column if not exists event_id        uuid references public.events(id) on delete set null;
alter table public.invoices add column if not exists tax_summary     jsonb;            -- per-rate CGST/SGST groups
alter table public.invoices add column if not exists deposit_applied numeric(12,2) not null default 0;  -- discharge, not revenue
alter table public.invoices add column if not exists amount_due      numeric(12,2);    -- total − deposit_applied
create unique index if not exists uq_invoice_event on public.invoices (event_id) where event_id is not null;  -- one consolidated invoice per Event (idempotent)

-- ── invoice_lines — one row per billable supply on the Event ─────────────────
create table if not exists public.invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  invoice_id    uuid not null references public.invoices(id) on delete cascade,
  event_id      uuid references public.events(id) on delete set null,
  stream        text not null check (stream in ('hall','rooms_fnb','catering')),   -- the supply_type tag
  description   text,
  sac_code      text not null,                       -- RESOLVED by the engine (output snapshot)
  taxable_value numeric(12,2) not null check (taxable_value >= 0),
  billed_count  numeric(12,3),                        -- catering: max(actual, guarantee)
  gst_rate      numeric(5,2) not null,                -- RESOLVED output — never a stored input rate
  itc           boolean not null default false,
  cgst          numeric(12,2) not null,
  sgst          numeric(12,2) not null,
  line_total    numeric(12,2) not null,
  source_ref    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_invoice_lines_invoice on public.invoice_lines (invoice_id);

do $$
declare t text;
begin
  foreach t in array array['invoice_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ============================================================================
-- resolve_gst — THE GST ENGINE. Resolves {rate, cgst_rate, sgst_rate, sac, itc}
-- from supply_type + the org's specified_premises flag. The ONLY place rates
-- live; never stored on a line or menu item as an input. STABLE.
-- (Rate VALUES are GST-law constants; the SAC per type is engine config.)
-- ============================================================================
create or replace function public.resolve_gst(p_org uuid, p_supply_type text)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_specified boolean; v_rate numeric; v_sac text; v_itc boolean;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select specified_premises into v_specified from public.orgs where id = p_org;
  if p_supply_type = 'hall' then
    v_rate := 18.0; v_sac := '997212'; v_itc := true;                          -- hall rent: 18% w/ITC
  elsif p_supply_type = 'rooms_fnb' then
    if coalesce(v_specified, false) then
      v_rate := 18.0; v_itc := true;                                           -- specified premises → 18% w/ITC
    else
      v_rate := 5.0;  v_itc := false;                                          -- non-specified → 5% no-ITC
    end if;
    v_sac := '996311';
  elsif p_supply_type = 'catering' then
    v_rate := 5.0; v_sac := '9963'; v_itc := false;                            -- composite catering-led 5%
  else
    raise exception 'unknown_supply_type' using errcode='22023', detail=p_supply_type;
  end if;
  return jsonb_build_object('supply_type', p_supply_type, 'rate', v_rate,
    'cgst_rate', v_rate/2.0, 'sgst_rate', v_rate/2.0, 'sac_code', v_sac, 'itc', v_itc);
end; $$;

-- ============================================================================
-- generate_consolidated_invoice — gather billable lines for an Event across
-- streams, resolve each rate via the engine, write one invoice + lines + a
-- multi-rate tax summary. Catering lines bill on max(actual_count, guarantee).
-- Deposit (escrowed) is SHOWN applied (amount_due = total − deposit) but only
-- DISCHARGED at settlement. Idempotent: one invoice per Event. Per-org seq.
-- p_lines = [{stream, description, taxable_value?, unit_price?, actual_count?, beo_id?, source_ref?}]
-- ============================================================================
create or replace function public.generate_consolidated_invoice(p_org uuid, p_event_id uuid, p_lines jsonb, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_event public.events%rowtype; v_inv public.invoices%rowtype; v_seq int;
  e jsonb; v_stream text; v_gst jsonb; v_taxable numeric(12,2); v_billed numeric(12,3);
  v_guar int; v_actual numeric; v_cgst numeric(12,2); v_sgst numeric(12,2);
  v_sub numeric(12,2) := 0; v_tot_cgst numeric(12,2) := 0; v_tot_sgst numeric(12,2) := 0;
  v_deposit numeric(12,2); v_total numeric(12,2); v_summary jsonb; v_lines jsonb; v_inv_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_event from public.events where id = p_event_id and org_id = p_org;
  if not found then raise exception 'event_not_found' using errcode='P0002'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'no_lines' using errcode='22023'; end if;

  select * into v_inv from public.invoices where event_id = p_event_id and org_id = p_org;     -- idempotent
  if found then
    select coalesce(jsonb_agg(to_jsonb(l) order by l.stream), '[]'::jsonb) into v_lines from public.invoice_lines l where l.invoice_id = v_inv.id;
    return jsonb_build_object('invoice_id', v_inv.id, 'invoice_number', v_inv.invoice_number, 'subtotal', v_inv.subtotal,
      'cgst', v_inv.cgst, 'sgst', v_inv.sgst, 'total', v_inv.total, 'tax_summary', v_inv.tax_summary,
      'deposit_applied', v_inv.deposit_applied, 'amount_due', v_inv.amount_due, 'lines', v_lines, 'idempotent', true);
  end if;

  select coalesce(max(invoice_seq),0) + 1 into v_seq from public.invoices where org_id = p_org;
  insert into public.invoices(org_id, booking_id, event_id, invoice_seq, invoice_number, supply_type, sac_code, gst_rate,
                              subtotal, cgst, sgst, total, status, issued_at)
    values (p_org, v_event.booking_id, p_event_id, v_seq, 'INV-'||lpad(v_seq::text,5,'0'), 'consolidated', null, null,
            0, 0, 0, 0, 'issued', now())
    returning id into v_inv_id;

  for e in select * from jsonb_array_elements(p_lines) loop
    v_stream := e->>'stream';
    v_gst := public.resolve_gst(p_org, v_stream);            -- RATE RESOLVED HERE, from supply_type + premises flag
    if v_stream = 'catering' and (e ? 'beo_id') then
      select guest_guarantee into v_guar from public.catering_beos where id = (e->>'beo_id')::uuid and org_id = p_org;
      v_actual := coalesce((e->>'actual_count')::numeric, 0);
      v_billed := greatest(v_actual, coalesce(v_guar, 0));    -- bill on max(actual, guarantee)
      v_taxable := round((e->>'unit_price')::numeric * v_billed, 2);
    else
      v_billed := null;
      v_taxable := round((e->>'taxable_value')::numeric, 2);
    end if;
    v_cgst := round(v_taxable * (v_gst->>'cgst_rate')::numeric / 100.0, 2);
    v_sgst := round(v_taxable * (v_gst->>'sgst_rate')::numeric / 100.0, 2);
    insert into public.invoice_lines(org_id, invoice_id, event_id, stream, description, sac_code, taxable_value,
                                     billed_count, gst_rate, itc, cgst, sgst, line_total, source_ref)
      values (p_org, v_inv_id, p_event_id, v_stream, e->>'description', v_gst->>'sac_code', v_taxable,
              v_billed, (v_gst->>'rate')::numeric, (v_gst->>'itc')::boolean, v_cgst, v_sgst, v_taxable + v_cgst + v_sgst, e->>'source_ref');
    v_sub := v_sub + v_taxable; v_tot_cgst := v_tot_cgst + v_cgst; v_tot_sgst := v_tot_sgst + v_sgst;
  end loop;

  v_total := v_sub + v_tot_cgst + v_tot_sgst;
  -- multi-rate tax summary: group CGST/SGST by resolved rate
  select coalesce(jsonb_agg(jsonb_build_object('gst_rate', g.gst_rate, 'itc', g.itc,
            'taxable', g.taxable, 'cgst', g.cgst, 'sgst', g.sgst) order by g.gst_rate), '[]'::jsonb)
    into v_summary
    from (select gst_rate, bool_or(itc) itc, sum(taxable_value) taxable, sum(cgst) cgst, sum(sgst) sgst
          from public.invoice_lines where invoice_id = v_inv_id group by gst_rate) g;

  -- escrowed deposit (held) on the Event's hall booking — shown applied, not discharged yet
  select coalesce(sum(amount),0) into v_deposit from public.deposit_ledger
    where org_id = p_org and booking_id = v_event.booking_id and entry_type = 'deposit_held' and status = 'held';

  update public.invoices set subtotal = v_sub, cgst = v_tot_cgst, sgst = v_tot_sgst, total = v_total,
         tax_summary = v_summary, deposit_applied = v_deposit, amount_due = v_total - v_deposit
    where id = v_inv_id returning * into v_inv;

  select coalesce(jsonb_agg(to_jsonb(l) order by l.stream), '[]'::jsonb) into v_lines from public.invoice_lines l where l.invoice_id = v_inv_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'invoice.generate', 'completed', coalesce(p_actor_id, auth.uid()), 'invoice', v_inv_id::text,
            jsonb_build_object('invoice_number', v_inv.invoice_number, 'total', v_total, 'deposit_applied', v_deposit, 'event_id', p_event_id));
  return jsonb_build_object('invoice_id', v_inv_id, 'invoice_number', v_inv.invoice_number, 'subtotal', v_sub,
    'cgst', v_tot_cgst, 'sgst', v_tot_sgst, 'total', v_total, 'tax_summary', v_summary,
    'deposit_applied', v_deposit, 'amount_due', v_total - v_deposit, 'lines', v_lines, 'idempotent', false);
end; $$;

-- ============================================================================
-- settle_invoice — realize the invoice: post REVENUE per stream to finance_ledger
-- (credit, tagged by supply_type + domain) and DISCHARGE the deposit in
-- deposit_ledger (NOT revenue). Forfeit ⇒ deposit becomes taxable income (a
-- finance_ledger credit). Owner/PM only (settlement.process). Idempotent.
-- ============================================================================
create or replace function public.settle_invoice(p_org uuid, p_invoice_id uuid, p_deposit_resolution text default 'discharge', p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv public.invoices%rowtype; r record; v_held public.deposit_ledger%rowtype; v_dep_action text := 'none';
begin
  if auth.uid() is not null and not public.has_capability(p_org, 'settlement.process') then
    raise exception 'forbidden' using errcode='42501', detail='settlement is Owner/PM only'; end if;
  if p_deposit_resolution not in ('discharge','forfeit') then raise exception 'bad_resolution' using errcode='22023', detail=p_deposit_resolution; end if;
  select * into v_inv from public.invoices where id = p_invoice_id and org_id = p_org;
  if not found then raise exception 'invoice_not_found' using errcode='P0002'; end if;
  if v_inv.status = 'paid' then
    return jsonb_build_object('invoice_id', v_inv.id, 'status', 'paid', 'idempotent', true); end if;

  -- realized REVENUE per stream (net/taxable) → finance_ledger credit (COGS already posted in W1d)
  for r in select stream, sum(taxable_value) amt from public.invoice_lines where invoice_id = p_invoice_id group by stream loop
    perform public.write_ledger(p_org, r.stream, r.amt, 'credit',
      case r.stream when 'hall' then 'hall' when 'rooms_fnb' then 'stays' else 'catering' end,
      'invoice', p_invoice_id::text, 'revenue '||r.stream, p_actor_id);
  end loop;

  -- deposit: discharge against balance (deposit_ledger; NOT revenue) OR forfeit (taxable income)
  if v_inv.booking_id is not null then
    select * into v_held from public.deposit_ledger
      where org_id = p_org and booking_id = v_inv.booking_id and entry_type = 'deposit_held' and status = 'held';
    if found then
      if p_deposit_resolution = 'forfeit' then
        insert into public.deposit_ledger(org_id, booking_id, amount, entry_type, is_liability, status)
          values (p_org, v_inv.booking_id, v_held.amount, 'deposit_forfeited', false, 'forfeited');
        update public.deposit_ledger set status = 'forfeited' where id = v_held.id;
        perform public.write_ledger(p_org, 'deposit_forfeit', v_held.amount, 'credit', 'core',
          'invoice', p_invoice_id::text, 'forfeited deposit (taxable income)', p_actor_id);   -- ONLY when forfeited
        v_dep_action := 'forfeited';
      else
        insert into public.deposit_ledger(org_id, booking_id, amount, entry_type, is_liability, status)
          values (p_org, v_inv.booking_id, v_held.amount, 'deposit_adjusted', false, 'adjusted');  -- discharged vs balance
        update public.deposit_ledger set status = 'adjusted' where id = v_held.id;
        v_dep_action := 'discharged';
      end if;
    end if;
  end if;

  update public.invoices set status = 'paid' where id = p_invoice_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'invoice.settle', 'completed', coalesce(p_actor_id, auth.uid()), 'invoice', p_invoice_id::text,
            jsonb_build_object('invoice_number', v_inv.invoice_number, 'deposit', v_dep_action, 'amount_due', v_inv.amount_due));
  return jsonb_build_object('invoice_id', p_invoice_id, 'status', 'paid', 'deposit', v_dep_action, 'amount_due', v_inv.amount_due, 'idempotent', false);
end; $$;

-- grants
do $$
declare fn text;
begin
  foreach fn in array array[
    'resolve_gst(uuid,text)',
    'generate_consolidated_invoice(uuid,uuid,jsonb,uuid)',
    'settle_invoice(uuid,uuid,text,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
