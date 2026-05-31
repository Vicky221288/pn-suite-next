-- ============================================================================
-- S4 — STAYS: room folio + F&B-to-folio + settlement + occupancy/revenue report
-- ----------------------------------------------------------------------------
-- The Stays-core closer. Charges accrue on a per-stay folio (room nights + F&B +
-- other), all tagged rooms_fnb. Settlement REUSES the W1e engine — no parallel
-- billing path: the SAME invoices/invoice_lines tables, resolve_gst for the rate
-- (rooms_fnb → 5% no-ITC; 18% if specified premises — NEVER hardcoded), and the
-- W1e settle_invoice for the finance_ledger posting (rooms_fnb → domain stays).
-- F&B-to-folio wires the W1d room-dining ticket (one kitchen/one inventory) onto
-- the guest folio (closes KL-2). Stay transitions CHECKED_OUT → SETTLED.
-- Owner/PM-gated settlement. Atomic + audited + tenant-scoped.
-- ============================================================================

-- ── extend the shared invoices header for a stay folio (no fork) ─────────────
alter table public.invoices add column if not exists stay_id uuid references public.room_stays(id) on delete set null;
alter table public.invoices drop constraint if exists invoices_supply_type_check;
alter table public.invoices add  constraint invoices_supply_type_check check (supply_type in ('composite','itemised','consolidated','folio'));
create unique index if not exists uq_invoice_stay on public.invoices (stay_id) where stay_id is not null;  -- one folio invoice per stay

-- ── room_folios — one running tab per stay ───────────────────────────────────
create table if not exists public.room_folios (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  stay_id    uuid not null references public.room_stays(id) on delete cascade,
  status     text not null default 'open' check (status in ('open','settled')),
  invoice_id uuid references public.invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_folio_stay unique (stay_id)
);
create index if not exists idx_folios_org on public.room_folios (org_id);

create table if not exists public.folio_charges (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  folio_id    uuid not null references public.room_folios(id) on delete cascade,
  stay_id     uuid not null references public.room_stays(id) on delete cascade,
  charge_type text not null check (charge_type in ('room_night','fnb','other')),
  description text,
  supply_type text not null default 'rooms_fnb',     -- the GST tag (resolved at settle, never a stored rate)
  amount      numeric(12,2) not null check (amount >= 0),
  source_type text,
  source_id   text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_folio_charges_folio on public.folio_charges (folio_id);
create unique index if not exists uq_folio_room_night on public.folio_charges (folio_id) where charge_type = 'room_night';     -- one room-night line
create unique index if not exists uq_folio_fnb_source on public.folio_charges (folio_id, source_id) where charge_type = 'fnb' and source_id is not null;  -- a room-dining ticket posts once

do $$
declare t text;
begin
  foreach t in array array['room_folios','folio_charges'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- internal: ensure an open folio exists for a stay
create or replace function public.pn_ensure_folio(p_org uuid, p_stay_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.room_folios where stay_id = p_stay_id and org_id = p_org;
  if v_id is null then
    insert into public.room_folios(org_id, stay_id) values (p_org, p_stay_id)
      on conflict (stay_id) do nothing returning id into v_id;
    if v_id is null then select id into v_id from public.room_folios where stay_id = p_stay_id and org_id = p_org; end if;
  end if;
  return v_id;
end; $$;

-- ── add a generic folio charge ───────────────────────────────────────────────
create or replace function public.add_folio_charge(p_org uuid, p_stay_id uuid, p_charge_type text, p_description text, p_amount numeric, p_source_type text default null, p_source_id text default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stay public.room_stays%rowtype; v_folio uuid; v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_charge_type not in ('room_night','fnb','other') then raise exception 'bad_charge_type' using errcode='22023'; end if;
  if p_amount < 0 then raise exception 'bad_amount' using errcode='22023'; end if;
  select * into v_stay from public.room_stays where id = p_stay_id and org_id = p_org;
  if v_stay.id is null then raise exception 'stay_not_found' using errcode='P0002'; end if;
  if v_stay.status = 'settled' then raise exception 'folio_settled' using errcode='22023', detail='stay already settled'; end if;
  v_folio := public.pn_ensure_folio(p_org, p_stay_id);
  insert into public.folio_charges(org_id, folio_id, stay_id, charge_type, description, amount, source_type, source_id)
    values (p_org, v_folio, p_stay_id, p_charge_type, p_description, p_amount, p_source_type, p_source_id) returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.folio_charge', 'completed', coalesce(p_actor_id, auth.uid()), 'folio_charge', v_id::text, jsonb_build_object('type', p_charge_type, 'amount', p_amount));
  return jsonb_build_object('charge_id', v_id, 'folio_id', v_folio);
end; $$;

-- ── post room nights (nights × rate_quoted) — idempotent (one room_night line) ─
create or replace function public.post_room_nights(p_org uuid, p_stay_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stay public.room_stays%rowtype; v_folio uuid; v_nights int; v_amount numeric(12,2); v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_stay from public.room_stays where id = p_stay_id and org_id = p_org;
  if v_stay.id is null then raise exception 'stay_not_found' using errcode='P0002'; end if;
  v_nights := (v_stay.check_out - v_stay.check_in);
  v_amount := v_nights * v_stay.rate_quoted;
  v_folio := public.pn_ensure_folio(p_org, p_stay_id);
  insert into public.folio_charges(org_id, folio_id, stay_id, charge_type, description, amount, source_type)
    values (p_org, v_folio, p_stay_id, 'room_night', v_nights || ' night(s) @ ' || v_stay.rate_quoted, v_amount, 'room_stay')
    on conflict (folio_id) where (charge_type = 'room_night') do nothing
    returning id into v_id;
  return jsonb_build_object('folio_id', v_folio, 'nights', v_nights, 'amount', v_amount, 'posted', v_id is not null);
end; $$;

-- ============================================================================
-- post_room_dining_to_folio — KL-2 closer. Takes a W1d room_dining kitchen
-- ticket (one kitchen/one inventory) and posts its F&B sell amount (from menu
-- config — never hardcoded) as an fnb line on the guest's folio. Idempotent.
-- ============================================================================
create or replace function public.post_room_dining_to_folio(p_org uuid, p_ticket_id uuid, p_stay_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_src text; v_amount numeric(12,2); v_folio uuid; v_id uuid; v_stay_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select source_type into v_src from public.kitchen_tickets where id = p_ticket_id and org_id = p_org;
  if v_src is null then raise exception 'ticket_not_found' using errcode='P0002'; end if;
  if v_src <> 'room_dining' then raise exception 'not_room_dining' using errcode='22023', detail=v_src; end if;
  select status into v_stay_status from public.room_stays where id = p_stay_id and org_id = p_org;
  if v_stay_status is null then raise exception 'stay_not_found' using errcode='P0002'; end if;
  if v_stay_status = 'settled' then raise exception 'folio_settled' using errcode='22023'; end if;

  -- F&B sell amount from menu config (portion_count × menu selling price) — no hardcoded price
  select coalesce(sum(ktl.portion_count * mi.default_selling_price), 0) into v_amount
    from public.kitchen_ticket_lines ktl join public.catering_menu_items mi on mi.id = ktl.menu_item_id
    where ktl.ticket_id = p_ticket_id;

  v_folio := public.pn_ensure_folio(p_org, p_stay_id);
  insert into public.folio_charges(org_id, folio_id, stay_id, charge_type, description, amount, source_type, source_id)
    values (p_org, v_folio, p_stay_id, 'fnb', 'Room dining', v_amount, 'kitchen_ticket', p_ticket_id::text)
    on conflict (folio_id, source_id) where (charge_type = 'fnb' and source_id is not null) do nothing
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.fnb_to_folio', 'completed', coalesce(p_actor_id, auth.uid()), 'folio_charge', coalesce(v_id::text, p_ticket_id::text),
            jsonb_build_object('ticket_id', p_ticket_id, 'amount', v_amount, 'posted', v_id is not null));
  return jsonb_build_object('folio_id', v_folio, 'amount', v_amount, 'posted', v_id is not null);
end; $$;

-- ============================================================================
-- settle_folio — assemble the folio into an invoice via resolve_gst (rooms_fnb)
-- and REUSE settle_invoice for the ledger posting. Stay → SETTLED. Owner/PM only.
-- Deposit (escrowed) is shown applied (amount_due = total − deposit), NOT revenue.
-- ============================================================================
create or replace function public.settle_folio(p_org uuid, p_stay_id uuid, p_deposit_applied numeric default 0, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_stay public.room_stays%rowtype; v_folio uuid; v_gst jsonb; v_rate numeric; v_seq int; v_inv uuid;
  r record; v_sub numeric(12,2) := 0; v_cgst numeric(12,2) := 0; v_sgst numeric(12,2) := 0; v_lc numeric(12,2); v_ls numeric(12,2);
  v_total numeric(12,2); v_existing uuid;
begin
  if auth.uid() is not null and not public.has_capability(p_org, 'settlement.process') then
    raise exception 'forbidden' using errcode='42501', detail='settlement is Owner/PM only'; end if;
  select * into v_stay from public.room_stays where id = p_stay_id and org_id = p_org for update;
  if v_stay.id is null then raise exception 'stay_not_found' using errcode='P0002'; end if;

  -- idempotent: already settled → return the existing invoice
  if v_stay.status = 'settled' then
    select id into v_existing from public.invoices where stay_id = p_stay_id and org_id = p_org;
    return jsonb_build_object('invoice_id', v_existing, 'status', 'settled', 'idempotent', true);
  end if;
  if v_stay.status <> 'checked_out' then raise exception 'illegal_transition' using errcode='22023', detail = format('%s → settled (check out first)', v_stay.status); end if;

  v_folio := public.pn_ensure_folio(p_org, p_stay_id);
  perform public.post_room_nights(p_org, p_stay_id, p_actor_id);   -- ensure room nights present

  v_gst := public.resolve_gst(p_org, 'rooms_fnb');                  -- RATE RESOLVED (5% no-ITC; 18% if specified) — never hardcoded
  v_rate := (v_gst->>'rate')::numeric;

  select coalesce(max(invoice_seq),0) + 1 into v_seq from public.invoices where org_id = p_org;
  insert into public.invoices(org_id, booking_id, event_id, stay_id, invoice_seq, invoice_number, supply_type, sac_code, gst_rate,
                              subtotal, cgst, sgst, total, status, issued_at, deposit_applied)
    values (p_org, null, null, p_stay_id, v_seq, 'INV-'||lpad(v_seq::text,5,'0'), 'folio', v_gst->>'sac_code', v_rate,
            0, 0, 0, 0, 'issued', now(), coalesce(p_deposit_applied,0))
    returning id into v_inv;

  -- one line per charge_type group (all rooms_fnb)
  for r in select charge_type, sum(amount) amt from public.folio_charges where folio_id = v_folio group by charge_type loop
    v_lc := round(r.amt * (v_gst->>'cgst_rate')::numeric / 100.0, 2);
    v_ls := round(r.amt * (v_gst->>'sgst_rate')::numeric / 100.0, 2);
    insert into public.invoice_lines(org_id, invoice_id, stream, description, sac_code, taxable_value, gst_rate, itc, cgst, sgst, line_total, source_ref)
      values (p_org, v_inv, 'rooms_fnb', r.charge_type, v_gst->>'sac_code', r.amt, v_rate, (v_gst->>'itc')::boolean, v_lc, v_ls, r.amt + v_lc + v_ls, r.charge_type);
    v_sub := v_sub + r.amt; v_cgst := v_cgst + v_lc; v_sgst := v_sgst + v_ls;
  end loop;
  if v_sub = 0 then raise exception 'empty_folio' using errcode='22023', detail='no charges to settle'; end if;

  v_total := v_sub + v_cgst + v_sgst;
  update public.invoices set subtotal = v_sub, cgst = v_cgst, sgst = v_sgst, total = v_total,
         amount_due = v_total - coalesce(p_deposit_applied,0),
         tax_summary = jsonb_build_array(jsonb_build_object('gst_rate', v_rate, 'itc', (v_gst->>'itc')::boolean, 'taxable', v_sub, 'cgst', v_cgst, 'sgst', v_sgst))
    where id = v_inv;

  -- REUSE W1e settle_invoice → posts rooms_fnb revenue to finance_ledger (domain stays),
  -- marks invoice paid. Deposit branch is booking-gated → skipped (stay has no booking).
  perform public.settle_invoice(p_org, v_inv, 'discharge', p_actor_id);

  update public.room_folios set status = 'settled', invoice_id = v_inv, updated_at = now() where id = v_folio;
  update public.room_stays set status = 'settled', updated_at = now() where id = p_stay_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.folio_settle', 'completed', coalesce(p_actor_id, auth.uid()), 'invoice', v_inv::text,
            jsonb_build_object('stay_id', p_stay_id, 'total', v_total, 'deposit_applied', coalesce(p_deposit_applied,0)));
  return jsonb_build_object('invoice_id', v_inv, 'subtotal', v_sub, 'cgst', v_cgst, 'sgst', v_sgst, 'total', v_total,
    'gst_rate', v_rate, 'deposit_applied', coalesce(p_deposit_applied,0), 'amount_due', v_total - coalesce(p_deposit_applied,0), 'status', 'settled', 'idempotent', false);
end; $$;

-- ============================================================================
-- stays_report (READ, STABLE) — occupancy% / ADR / RevPAR + revenue by stream.
-- Occupancy counts visible to ops; revenue figures margin-gated (pnl.view_margin).
-- ============================================================================
create or replace function public.stays_report(p_org uuid, p_from date, p_to date)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_can boolean; v_nights int; v_rooms int; v_avail int; v_sold numeric; v_revenue numeric(14,2); v_stream jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_to <= p_from then raise exception 'bad_range' using errcode='22023'; end if;
  v_can := (auth.uid() is null) or public.has_capability(p_org, 'pnl.view_margin');

  v_nights := (p_to - p_from);
  select count(*) into v_rooms from public.rooms where org_id = p_org;
  v_avail := v_rooms * v_nights;
  -- room-nights SOLD = overlap of each active/settled stay with [from,to)
  select coalesce(sum(greatest(0, least(check_out, p_to) - greatest(check_in, p_from))), 0) into v_sold
    from public.room_stays where org_id = p_org and room_id is not null
      and status in ('checked_in','checked_out','settled') and check_in < p_to and check_out > p_from;
  -- room revenue = room_night charges on stays overlapping the range
  select coalesce(sum(fc.amount), 0) into v_revenue
    from public.folio_charges fc join public.room_stays s on s.id = fc.stay_id
    where fc.org_id = p_org and fc.charge_type = 'room_night' and s.check_in < p_to and s.check_out > p_from;
  select coalesce(jsonb_object_agg(supply_type, amt), '{}'::jsonb) into v_stream
    from (select supply_type, sum(amount) amt from public.finance_ledger where org_id = p_org and direction = 'credit' group by supply_type) g;

  return jsonb_build_object(
    'can_see_revenue', v_can, 'nights', v_nights, 'total_rooms', v_rooms,
    'available_room_nights', v_avail, 'sold_room_nights', v_sold,
    'occupancy_pct', case when v_avail > 0 then round(v_sold * 100.0 / v_avail, 2) else 0 end,
    'room_revenue', case when v_can then v_revenue else null end,
    'adr',    case when v_can and v_sold > 0 then round(v_revenue / v_sold, 2) else null end,
    'revpar', case when v_can and v_avail > 0 then round(v_revenue / v_avail, 2) else null end,
    'revenue_by_stream', case when v_can then v_stream else null end);
end; $$;

-- grants
do $$
declare fn text;
begin
  foreach fn in array array[
    'pn_ensure_folio(uuid,uuid)',
    'add_folio_charge(uuid,uuid,text,text,numeric,text,text,uuid)',
    'post_room_nights(uuid,uuid,uuid)',
    'post_room_dining_to_folio(uuid,uuid,uuid,uuid)',
    'settle_folio(uuid,uuid,numeric,uuid)',
    'stays_report(uuid,date,date)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
