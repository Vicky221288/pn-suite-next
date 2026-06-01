-- ============================================================================
-- M5 — tentative DATE HOLDS + unified AVAILABILITY CALENDAR
-- ----------------------------------------------------------------------------
-- Benchmarked vs Oracle OPERA / Cloudbeds calendar (NOT a legacy re-skin). Two
-- pieces on the shared spine: a soft, expiring hold lifecycle + a read-only
-- availability aggregation.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ THE HOLD / GiST SEAM (F-DATA-01-SENSITIVE) — STRUCTURAL.                    ║
-- ║  A hold is a SOFT, ADVISORY, EXPIRING claim. `date_holds` has NO GiST       ║
-- ║  EXCLUDE and NO overlap-unique → therefore:                                ║
-- ║   • two holds MAY overlap (a hold never blocks another hold);              ║
-- ║   • a hold NEVER blocks a confirmed booking/stay — the B1/S1 GiST EXCLUDE  ║
-- ║     lives on date_blocks/room_stays and never sees date_holds rows;        ║
-- ║   • a hold NEVER silently becomes a booking — the ONLY mutation to         ║
-- ║     status='converted' is convert_hold, which DELEGATES to the existing    ║
-- ║     confirm_booking (hall) / create_room_stay (stays). The GiST EXCLUDE in ║
-- ║     those RPCs is what actually decides availability. If GiST rejects       ║
-- ║     (slot_taken / room_double_booked, 23P01), convert_hold's tx ROLLS BACK ║
-- ║     and the hold stays pending — zero orphan, F-DATA-01 cannot recur.      ║
-- ║  convert_hold contains NO overlap check and NO insert into date_blocks/    ║
-- ║  room_stays — it only calls the delegate. The constraint is law; the hold  ║
-- ║  layer is advisory paint.                                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- EXPIRY (belt-and-suspenders): each hold carries a mandatory expires_at.
--   (1) a B4 registry rule run_hold_expiry (per-org, every tick; atomic,
--       idempotent, IST-anchored, audited) flips lapsed pending holds → expired; AND
--   (2) EVERY read of hold state filters expires_at > now() — so an already-lapsed
--       hold is ignored EVEN IF the sweep hasn't run. Correctness does NOT depend
--       on the sweep having run; the sweep is housekeeping for tidy status/queries.
--
-- Atomic + audited + tenant-scoped (RLS default-deny + auth.uid() self-auth).
-- Cap `hold.manage` gates place/convert/release; availability_calendar is a
-- member-open read (availability, not money).
-- ============================================================================

create table if not exists public.date_holds (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs(id) on delete cascade,
  domain               text not null check (domain in ('hall','stays')),
  -- hall subject
  hall_id              uuid references public.halls(id) on delete cascade,
  event_date           date,
  slot                 text check (slot in ('morning','evening','full_day')),
  hall_rent            numeric(12,2),                       -- provisional, for the convert delegate
  -- stays subject
  room_id              uuid references public.rooms(id) on delete set null,
  room_type_id         uuid references public.room_types(id) on delete cascade,
  check_in             date,
  check_out            date,
  -- who the hold is for (provisional)
  guest_name           text,
  guest_phone          text,
  lead_id              uuid,
  -- lifecycle
  status               text not null default 'pending' check (status in ('pending','converted','released','expired')),
  expires_at           timestamptz not null,                -- MANDATORY
  converted_booking_id uuid references public.bookings(id) on delete set null,
  converted_stay_id    uuid references public.room_stays(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- structural subject completeness; deliberately NO GiST EXCLUDE / NO overlap-unique
  constraint chk_hold_subject check (
    (domain = 'hall'  and hall_id is not null and event_date is not null and slot is not null)
    or (domain = 'stays' and room_type_id is not null and check_in is not null and check_out is not null and check_out > check_in)
  )
);
create index if not exists idx_date_holds_active on public.date_holds (org_id, status, expires_at);
create index if not exists idx_date_holds_hall on public.date_holds (org_id, domain, event_date) where domain = 'hall';
create index if not exists idx_date_holds_stays on public.date_holds (org_id, room_type_id, check_in) where domain = 'stays';

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
alter table public.date_holds enable row level security;
drop policy if exists date_holds_member_select on public.date_holds;
create policy date_holds_member_select on public.date_holds for select to authenticated using (public.is_org_member(org_id));
drop policy if exists date_holds_service_all on public.date_holds;
create policy date_holds_service_all on public.date_holds for all to service_role using (true) with check (true);

-- ============================================================================
-- place_hold — create a tentative hold (cap hold.manage). NO overlap check: a
-- hold can be placed even where another hold or a confirmed booking exists (it
-- is advisory). expires_at is mandatory + must be in the future.
-- ============================================================================
create or replace function public.place_hold(
  p_org uuid, p_domain text, p_expires_at timestamptz,
  p_hall_id uuid default null, p_event_date date default null, p_slot text default null, p_hall_rent numeric default null,
  p_room_id uuid default null, p_room_type_id uuid default null, p_check_in date default null, p_check_out date default null,
  p_guest_name text default null, p_guest_phone text default null, p_lead_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'hold.manage') then raise exception 'forbidden' using errcode='42501', detail='hold.manage required'; end if;
  if p_domain not in ('hall','stays') then raise exception 'bad_domain' using errcode='22023'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'bad_expiry' using errcode='22023', detail='expires_at must be in the future'; end if;

  if p_domain = 'hall' then
    if p_hall_id is null or p_event_date is null or p_slot is null then raise exception 'hall_fields_required' using errcode='22023'; end if;
    if p_slot not in ('morning','evening','full_day') then raise exception 'invalid_slot' using errcode='22023'; end if;
    if coalesce(btrim(p_guest_name),'') = '' then raise exception 'guest_name_required' using errcode='22023'; end if;
    if not exists (select 1 from public.halls where id = p_hall_id and org_id = p_org) then raise exception 'hall_not_found' using errcode='P0002'; end if;
  else
    if p_room_type_id is null or p_check_in is null or p_check_out is null then raise exception 'stays_fields_required' using errcode='22023'; end if;
    if p_check_out <= p_check_in then raise exception 'bad_dates' using errcode='22023'; end if;
    if coalesce(btrim(p_guest_phone),'') = '' then raise exception 'guest_phone_required' using errcode='22023', detail='stays convert needs a phone (shared guest)'; end if;
    if not exists (select 1 from public.room_types where id = p_room_type_id and org_id = p_org) then raise exception 'room_type_not_found' using errcode='P0002'; end if;
  end if;

  insert into public.date_holds(org_id, domain, hall_id, event_date, slot, hall_rent, room_id, room_type_id, check_in, check_out, guest_name, guest_phone, lead_id, status, expires_at)
    values (p_org, p_domain, p_hall_id, p_event_date, p_slot, p_hall_rent, p_room_id, p_room_type_id, p_check_in, p_check_out, p_guest_name, p_guest_phone, p_lead_id, 'pending', p_expires_at)
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'hold.place', 'completed', coalesce(p_actor_id, auth.uid()), 'date_hold', v_id::text, jsonb_build_object('domain', p_domain, 'expires_at', p_expires_at));
  return jsonb_build_object('hold_id', v_id, 'status', 'pending', 'expires_at', p_expires_at);
end; $$;

-- ============================================================================
-- release_hold — manual release (cap hold.manage). Guarded: only pending.
-- ============================================================================
create or replace function public.release_hold(p_org uuid, p_hold_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'hold.manage') then raise exception 'forbidden' using errcode='42501', detail='hold.manage required'; end if;
  select status into v_status from public.date_holds where id = p_hold_id and org_id = p_org for update;
  if v_status is null then raise exception 'hold_not_found' using errcode='P0002'; end if;
  if v_status <> 'pending' then raise exception 'hold_not_pending' using errcode='22023', detail=v_status; end if;
  update public.date_holds set status = 'released', updated_at = now() where id = p_hold_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'hold.release', 'completed', coalesce(p_actor_id, auth.uid()), 'date_hold', p_hold_id::text);
  return jsonb_build_object('hold_id', p_hold_id, 'status', 'released');
end; $$;

-- ============================================================================
-- convert_hold — turn a hold into a REAL booking/stay (cap hold.manage). The ONLY
-- mutation to status='converted'. DELEGATES to the existing confirm_booking /
-- create_room_stay — the GiST EXCLUDE in those RPCs is the sole overlap authority.
-- If the delegate raises (23P01 slot_taken / room_double_booked), this whole tx
-- rolls back and the hold stays pending (no orphan). Rejects an expired hold via
-- the read-filter (expires_at > now()), independent of the sweep.
-- ============================================================================
create or replace function public.convert_hold(p_org uuid, p_hold_id uuid, p_idempotency_key text default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare h public.date_holds%rowtype; v_res jsonb; v_now timestamptz := now();
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'hold.manage') then raise exception 'forbidden' using errcode='42501', detail='hold.manage required'; end if;
  select * into h from public.date_holds where id = p_hold_id and org_id = p_org for update;
  if h.id is null then raise exception 'hold_not_found' using errcode='P0002'; end if;
  if h.status <> 'pending' then raise exception 'hold_not_pending' using errcode='22023', detail=h.status; end if;
  if h.expires_at <= v_now then raise exception 'hold_expired' using errcode='22023', detail='hold lapsed; cannot convert (read-filter, independent of the sweep)'; end if;

  if h.domain = 'hall' then
    -- DELEGATE: confirm_booking is the GiST authority. A conflict raises 23P01 → this tx rolls back.
    v_res := public.confirm_booking(p_org, h.hall_id, h.event_date, h.slot, coalesce(h.hall_rent, 0),
               coalesce(h.guest_name, 'Hold'), coalesce(p_idempotency_key, 'hold-convert:' || h.id::text),
               p_actor_id, null, false, h.lead_id, h.guest_phone);
    update public.date_holds set status = 'converted', converted_booking_id = (v_res->>'booking_id')::uuid, updated_at = now() where id = h.id;
  else
    -- DELEGATE: create_room_stay is the GiST authority (room overlap).
    v_res := public.create_room_stay(p_org, h.guest_phone, coalesce(h.guest_name, 'Hold'), h.room_id, h.room_type_id, h.check_in, h.check_out, p_actor_id);
    update public.date_holds set status = 'converted', converted_stay_id = (v_res->>'stay_id')::uuid, updated_at = now() where id = h.id;
  end if;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'hold.convert', 'completed', coalesce(p_actor_id, auth.uid()), 'date_hold', h.id::text, jsonb_build_object('domain', h.domain, 'result', v_res));
  return jsonb_build_object('hold_id', h.id, 'status', 'converted', 'result', v_res);
end; $$;

-- ============================================================================
-- run_hold_expiry — B4 registry rule (A_hold_expiry; per-org, every tick). Flips
-- lapsed pending holds → expired. Idempotent (only pending + expires_at <= now);
-- IST-anchored via injectable p_now; audited. Belt to the read-filter suspenders.
-- ============================================================================
create or replace function public.run_hold_expiry(p_org uuid, p_now timestamptz default now())
  returns integer language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with expired as (
    update public.date_holds set status = 'expired', updated_at = p_now
      where org_id = p_org and status = 'pending' and expires_at <= p_now
      returning id
  )
  select count(*) into v_count from expired;
  if v_count > 0 then
    insert into public.audit_log(org_id, action, sub_event, entity_type, meta)
      values (p_org, 'rule.A_hold.expiry', 'completed', 'date_hold', jsonb_build_object('expired', v_count));
  end if;
  return v_count;
end; $$;

-- ============================================================================
-- availability_calendar — READ-ONLY aggregation over [p_from, p_to]: CONFIRMED
-- hall blocks + confirmed room stays + ACTIVE holds (expires_at > p_now). Writes
-- nothing. Member-open (availability, not money). Expired holds are excluded by
-- the read-filter regardless of whether the sweep has run.
-- ============================================================================
create or replace function public.availability_calendar(p_org uuid, p_from date, p_to date, p_now timestamptz default now())
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_hall_conf jsonb; v_hall_hold jsonb; v_room_conf jsonb; v_room_hold jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('block_date', block_date, 'hall_id', hall_id, 'slot', slot, 'booking_id', booking_id) order by block_date), '[]'::jsonb)
    into v_hall_conf from public.date_blocks
    where org_id = p_org and released_at is null and block_date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('hold_id', id, 'hall_id', hall_id, 'event_date', event_date, 'slot', slot, 'expires_at', expires_at) order by event_date), '[]'::jsonb)
    into v_hall_hold from public.date_holds
    where org_id = p_org and domain = 'hall' and status = 'pending' and expires_at > p_now and event_date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object('stay_id', id, 'room_id', room_id, 'room_type_id', room_type_id, 'check_in', check_in, 'check_out', check_out, 'status', status) order by check_in), '[]'::jsonb)
    into v_room_conf from public.room_stays
    where org_id = p_org and status in ('reserved','checked_in') and check_in <= p_to and check_out > p_from;

  select coalesce(jsonb_agg(jsonb_build_object('hold_id', id, 'room_id', room_id, 'room_type_id', room_type_id, 'check_in', check_in, 'check_out', check_out, 'expires_at', expires_at) order by check_in), '[]'::jsonb)
    into v_room_hold from public.date_holds
    where org_id = p_org and domain = 'stays' and status = 'pending' and expires_at > p_now and check_in <= p_to and check_out > p_from;

  return jsonb_build_object('range', jsonb_build_object('from', p_from, 'to', p_to),
    'hall_confirmed', v_hall_conf, 'hall_holds', v_hall_hold,
    'room_confirmed', v_room_conf, 'room_holds', v_room_hold);
end; $$;

-- ── grants ────────────────────────────────────────────────────────────────--
-- writes (cap-gated in-body) + the registry rule (service_role drives the tick)
do $$
declare fn text;
begin
  foreach fn in array array[
    'place_hold(uuid,text,timestamptz,uuid,date,text,numeric,uuid,uuid,date,date,text,text,uuid,uuid)',
    'release_hold(uuid,uuid,uuid)',
    'convert_hold(uuid,uuid,text,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
revoke all    on function public.run_hold_expiry(uuid,timestamptz) from public;
grant execute on function public.run_hold_expiry(uuid,timestamptz) to service_role;
-- availability_calendar: a MEMBER-OPEN read (availability, not money)
revoke all    on function public.availability_calendar(uuid,date,date,timestamptz) from public;
grant execute on function public.availability_calendar(uuid,date,date,timestamptz) to authenticated, service_role;
