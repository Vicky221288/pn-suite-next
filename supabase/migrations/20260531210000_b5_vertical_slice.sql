-- ============================================================================
-- B5 — THE VERTICAL SLICE (foundation-wave go/no-go gate)
-- ----------------------------------------------------------------------------
-- Composes B1 (atomic confirm + deposit), B2 (tenant RLS + capabilities),
-- B3 (sends), B4 (rules) into ONE thread: Enquiry → Quote → Booking → Event →
-- Settlement. Minimal-but-real spine tables + transition RPCs. Money model
-- (§7/§12): deposit = 50% hall rent escrowed LIABILITY (never revenue); invoice
-- at settlement is composite-5% catering-led (fixes F-FIN-03); deposit resolved
-- (refund/forfeit/adjust) by Owner/PM only. Every RPC is atomic, audited,
-- tenant-scoped, and self-authorizes on auth.uid() (B2 pattern).
-- ============================================================================

alter table public.bookings add column if not exists lead_id uuid references public.leads(id) on delete set null;

-- ── Quote ────────────────────────────────────────────────────────────────────
create table if not exists public.quotes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  hall_rent   numeric(12,2) not null check (hall_rent >= 0),
  guest_count int,
  valid_until date,
  status      text not null default 'sent' check (status in ('sent','accepted','expired','withdrawn')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_quotes_org on public.quotes (org_id, lead_id);

-- ── Event (minimal BEO) ──────────────────────────────────────────────────────
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  event_date  date not null,
  slot        text not null,
  guest_count int,
  status      text not null default 'planning' check (status in ('planning','ready','in_progress','concluded')),
  created_at  timestamptz not null default now(),
  constraint uq_event_booking unique (booking_id)
);
create index if not exists idx_events_org on public.events (org_id, event_date);

-- ── Invoice (composite-5% GST tax invoice; per-ORG numbering — no global SERIAL) ──
create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  booking_id     uuid not null references public.bookings(id) on delete cascade,
  invoice_seq    int  not null,
  invoice_number text not null,
  supply_type    text not null default 'composite' check (supply_type in ('composite','itemised')),
  sac_code       text not null,
  gst_rate       numeric(5,2) not null,
  subtotal       numeric(12,2) not null,
  cgst           numeric(12,2) not null,
  sgst           numeric(12,2) not null,
  total          numeric(12,2) not null,
  status         text not null default 'issued' check (status in ('issued','paid','void')),
  issued_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  constraint uq_invoice_booking unique (booking_id),         -- one invoice per booking (idempotent settle)
  constraint uq_invoice_org_seq unique (org_id, invoice_seq) -- per-tenant numbering (closes the global-SERIAL one-way-door)
);
create index if not exists idx_invoices_org on public.invoices (org_id, issued_at desc);

-- ── RLS: tenant-scoped default-deny (members read own org; writes via RPC) ───
do $$
declare t text;
begin
  foreach t in array array['quotes','events','invoices'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ── create_enquiry — manual enquiry + A1 acknowledgement (B3 send) ───────────
create or replace function public.create_enquiry(
  p_org uuid, p_function_area text, p_phone text, p_name text,
  p_actor_id uuid default null, p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lead_id uuid; v_created boolean := false;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.leads(org_id, function_area, phone, name, source, status)
    values (p_org, p_function_area, p_phone, p_name, 'manual', 'new')
    on conflict (org_id, phone) do nothing
    returning id into v_lead_id;
  if v_lead_id is null then
    select id into v_lead_id from public.leads where org_id = p_org and phone = p_phone;
  else
    v_created := true;
    -- A1: acknowledgement to the enquirer via the area's sender (idempotent).
    perform public.enqueue_outbound(p_org, p_function_area, p_phone, 'enquiry_ack',
      jsonb_build_object('lead_id', v_lead_id), 'enquiry-ack:' || v_lead_id::text, 'template', p_now);
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'enquiry.create', 'completed', coalesce(p_actor_id, auth.uid()), 'lead', v_lead_id::text,
            jsonb_build_object('created', v_created));
  return jsonb_build_object('lead_id', v_lead_id, 'created', v_created);
end; $$;

-- ── record_followup — qualifies the lead, stops the A2 SLA clock ─────────────
create or replace function public.record_followup(
  p_org uuid, p_lead_id uuid, p_actor_id uuid default null, p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.leads set last_follow_up_at = p_now,
         status = case when status = 'new' then 'qualifying' else status end, updated_at = p_now
    where id = p_lead_id and org_id = p_org;
  if not found then raise exception 'lead_not_found' using errcode = 'P0002'; end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'enquiry.followup', 'completed', coalesce(p_actor_id, auth.uid()), 'lead', p_lead_id::text);
  return jsonb_build_object('lead_id', p_lead_id, 'ok', true);
end; $$;

-- ── create_quote ─────────────────────────────────────────────────────────────
create or replace function public.create_quote(
  p_org uuid, p_lead_id uuid, p_hall_rent numeric, p_guest_count int, p_valid_until date,
  p_actor_id uuid default null, p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_quote_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.quotes(org_id, lead_id, hall_rent, guest_count, valid_until)
    values (p_org, p_lead_id, p_hall_rent, p_guest_count, p_valid_until) returning id into v_quote_id;
  update public.leads set status = 'quoted', updated_at = p_now where id = p_lead_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'quote.create', 'completed', coalesce(p_actor_id, auth.uid()), 'quote', v_quote_id::text,
            jsonb_build_object('hall_rent', p_hall_rent, 'lead_id', p_lead_id));
  return jsonb_build_object('quote_id', v_quote_id);
end; $$;

-- ── confirm_booking — EXTENDED from B1/B2: add p_lead_id to link the won lead
--    (sets bookings.lead_id + lead.status='won') inside the same atomic tx.
--    Drop the prior signature, recreate with the new trailing default param so
--    B1/B2 named-arg callers (which omit p_lead_id) keep working.
-- ============================================================================
drop function if exists public.confirm_booking(uuid,uuid,date,text,numeric,text,text,uuid,uuid,boolean);
create or replace function public.confirm_booking(
  p_org_id          uuid,
  p_hall_id         uuid,
  p_event_date      date,
  p_slot            text,
  p_hall_rent       numeric,
  p_customer_name   text,
  p_idempotency_key text,
  p_actor_id        uuid    default null,
  p_parent_audit_id uuid    default null,
  p_force_rollback  boolean default false,
  p_lead_id         uuid    default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_booking_id uuid; v_deposit numeric(12,2); v_range tstzrange;
  v_existing public.bookings%rowtype; v_audit_id uuid;
begin
  if auth.uid() is not null
     and not exists (select 1 from public.org_members
                     where user_id = auth.uid() and org_id = p_org_id
                       and 'booking.confirm' = any(capabilities)) then
    raise exception 'forbidden' using errcode = '42501', detail = 'caller lacks booking.confirm in this org';
  end if;

  select * into v_existing from public.bookings where org_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('booking_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;
  if p_slot not in ('morning','evening','full_day') then
    raise exception 'invalid_slot' using errcode = '22023', detail = p_slot;
  end if;

  v_range := case p_slot
    when 'morning'  then tstzrange((p_event_date + time '09:00') at time zone 'Asia/Kolkata', (p_event_date + time '14:00') at time zone 'Asia/Kolkata', '[)')
    when 'evening'  then tstzrange((p_event_date + time '17:00') at time zone 'Asia/Kolkata', (p_event_date + time '23:00') at time zone 'Asia/Kolkata', '[)')
    when 'full_day' then tstzrange((p_event_date + time '09:00') at time zone 'Asia/Kolkata', (p_event_date + time '23:00') at time zone 'Asia/Kolkata', '[)')
  end;
  v_deposit := round(p_hall_rent * 0.5, 2);

  insert into public.bookings(org_id, hall_id, lead_id, event_date, slot, status, hall_rent, customer_name, idempotency_key, confirmed_at)
    values (p_org_id, p_hall_id, p_lead_id, p_event_date, p_slot, 'confirmed', p_hall_rent, p_customer_name, p_idempotency_key, now())
    returning id into v_booking_id;
  insert into public.date_blocks(org_id, hall_id, booking_id, block_date, slot, during)
    values (p_org_id, p_hall_id, v_booking_id, p_event_date, p_slot, v_range);
  insert into public.deposit_ledger(org_id, booking_id, amount, entry_type, is_liability, status)
    values (p_org_id, v_booking_id, v_deposit, 'deposit_held', true, 'held');
  if p_lead_id is not null then
    update public.leads set status = 'won', updated_at = now() where id = p_lead_id and org_id = p_org_id;
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, parent_audit_id, meta)
    values (p_org_id, 'booking.confirm', 'completed', coalesce(p_actor_id, auth.uid()), 'booking', v_booking_id::text, p_parent_audit_id,
            jsonb_build_object('slot', p_slot, 'event_date', p_event_date, 'hall_rent', p_hall_rent, 'deposit', v_deposit, 'lead_id', p_lead_id))
    returning id into v_audit_id;
  if p_force_rollback then raise exception 'forced_rollback_for_test' using errcode = 'P0001'; end if;

  return jsonb_build_object('booking_id', v_booking_id, 'status', 'confirmed', 'deposit', v_deposit, 'audit_id', v_audit_id, 'idempotent', false);
exception
  when exclusion_violation then
    raise exception 'slot_taken' using errcode = '23P01', detail = format('hall %s %s %s is already blocked', p_hall_id, p_event_date, p_slot);
  when unique_violation then
    select * into v_existing from public.bookings where org_id = p_org_id and idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('booking_id', v_existing.id, 'status', v_existing.status, 'idempotent', true); end if;
    raise;
end; $$;
grant execute on function public.confirm_booking(uuid,uuid,date,text,numeric,text,text,uuid,uuid,boolean,uuid) to authenticated, service_role;

-- ── create_event — minimal BEO from a confirmed booking ──────────────────────
create or replace function public.create_event(
  p_org uuid, p_booking_id uuid, p_guest_count int, p_actor_id uuid default null, p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.bookings%rowtype; v_event_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_b from public.bookings where id = p_booking_id and org_id = p_org;
  if not found then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  insert into public.events(org_id, booking_id, event_date, slot, guest_count, status)
    values (p_org, p_booking_id, v_b.event_date, v_b.slot, p_guest_count, 'planning')
    on conflict (booking_id) do update set guest_count = excluded.guest_count
    returning id into v_event_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'event.create', 'completed', coalesce(p_actor_id, auth.uid()), 'event', v_event_id::text);
  return jsonb_build_object('event_id', v_event_id);
end; $$;

-- ── settle_booking — GST tax invoice (composite-5%) + deposit resolution ─────
-- Owner/PM only (capability 'settlement.process'). Idempotent: re-settle returns
-- the existing invoice. Deposit is resolved as a SEPARATE liability entry — it is
-- never folded into the invoice/revenue (§12 #6).
create or replace function public.settle_booking(
  p_org uuid, p_booking_id uuid, p_deposit_resolution text default 'refund',
  p_damage_amount numeric default 0, p_actor_id uuid default null, p_now timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_b public.bookings%rowtype; v_inv public.invoices%rowtype; v_held public.deposit_ledger%rowtype;
  v_seq int; v_sub numeric(12,2); v_cgst numeric(12,2); v_sgst numeric(12,2);
  v_net numeric(12,2); v_resolve_type text; v_resolve_status text;
begin
  if auth.uid() is not null
     and not public.has_capability(p_org, 'settlement.process') then
    raise exception 'forbidden' using errcode = '42501', detail = 'settlement is Owner/PM only';
  end if;
  if p_deposit_resolution not in ('refund','forfeit','adjust') then
    raise exception 'bad_resolution' using errcode = '22023', detail = p_deposit_resolution;
  end if;

  select * into v_b from public.bookings where id = p_booking_id and org_id = p_org;
  if not found then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  -- idempotent: already settled → return the existing invoice
  select * into v_inv from public.invoices where booking_id = p_booking_id;
  if found then
    return jsonb_build_object('invoice_id', v_inv.id, 'invoice_number', v_inv.invoice_number,
      'subtotal', v_inv.subtotal, 'cgst', v_inv.cgst, 'sgst', v_inv.sgst, 'total', v_inv.total,
      'gst_rate', v_inv.gst_rate, 'sac_code', v_inv.sac_code, 'idempotent', true);
  end if;

  -- composite-5% catering-led tax invoice (§7/§12 #11). Subtotal = hall rent
  -- (the package's billable supply); the deposit is NOT part of the bill.
  v_sub  := v_b.hall_rent;
  v_cgst := round(v_sub * 0.025, 2);
  v_sgst := round(v_sub * 0.025, 2);
  select coalesce(max(invoice_seq), 0) + 1 into v_seq from public.invoices where org_id = p_org;
  insert into public.invoices(org_id, booking_id, invoice_seq, invoice_number, supply_type, sac_code,
                              gst_rate, subtotal, cgst, sgst, total, status, issued_at)
    values (p_org, p_booking_id, v_seq, 'INV-' || lpad(v_seq::text, 5, '0'), 'composite', '9963',
            5.00, v_sub, v_cgst, v_sgst, v_sub + v_cgst + v_sgst, 'issued', p_now)
    returning * into v_inv;

  -- resolve the escrowed deposit (separate liability; never revenue)
  select * into v_held from public.deposit_ledger
    where booking_id = p_booking_id and entry_type = 'deposit_held' and status = 'held';
  if found then
    if p_deposit_resolution = 'forfeit' then
      v_resolve_type := 'deposit_forfeited'; v_resolve_status := 'forfeited'; v_net := 0;
    elsif p_deposit_resolution = 'adjust' or coalesce(p_damage_amount,0) > 0 then
      v_resolve_type := 'deposit_adjusted'; v_resolve_status := 'adjusted';
      v_net := greatest(v_held.amount - coalesce(p_damage_amount,0), 0);
    else
      v_resolve_type := 'deposit_refunded'; v_resolve_status := 'refunded'; v_net := v_held.amount;
    end if;
    insert into public.deposit_ledger(org_id, booking_id, amount, entry_type, is_liability, status)
      values (p_org, p_booking_id, v_net, v_resolve_type, false, v_resolve_status);
    update public.deposit_ledger set status = v_resolve_status where id = v_held.id;
  end if;

  update public.bookings set status = 'settled', updated_at = now() where id = p_booking_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'settlement.process', 'completed', coalesce(p_actor_id, auth.uid()), 'invoice', v_inv.id::text,
            jsonb_build_object('invoice_number', v_inv.invoice_number, 'total', v_inv.total,
                               'deposit_resolution', p_deposit_resolution, 'deposit_net', v_net));
  return jsonb_build_object('invoice_id', v_inv.id, 'invoice_number', v_inv.invoice_number,
    'subtotal', v_inv.subtotal, 'cgst', v_inv.cgst, 'sgst', v_inv.sgst, 'total', v_inv.total,
    'gst_rate', v_inv.gst_rate, 'sac_code', v_inv.sac_code, 'deposit_resolution', p_deposit_resolution,
    'deposit_net', v_net, 'idempotent', false);
end; $$;

-- grants: enquiry/quote/event creatable by members (self-auth inside); settlement
-- gated to Owner/PM by capability inside the RPC. service_role for the system path.
revoke all on function public.create_enquiry(uuid,text,text,text,uuid,timestamptz) from public;
revoke all on function public.record_followup(uuid,uuid,uuid,timestamptz) from public;
revoke all on function public.create_quote(uuid,uuid,numeric,int,date,uuid,timestamptz) from public;
revoke all on function public.create_event(uuid,uuid,int,uuid,timestamptz) from public;
revoke all on function public.settle_booking(uuid,uuid,text,numeric,uuid,timestamptz) from public;
grant execute on function public.create_enquiry(uuid,text,text,text,uuid,timestamptz) to authenticated, service_role;
grant execute on function public.record_followup(uuid,uuid,uuid,timestamptz) to authenticated, service_role;
grant execute on function public.create_quote(uuid,uuid,numeric,int,date,uuid,timestamptz) to authenticated, service_role;
grant execute on function public.create_event(uuid,uuid,int,uuid,timestamptz) to authenticated, service_role;
grant execute on function public.settle_booking(uuid,uuid,text,numeric,uuid,timestamptz) to authenticated, service_role;
