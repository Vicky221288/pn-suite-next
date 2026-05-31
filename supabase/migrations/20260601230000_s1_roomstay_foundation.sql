-- ============================================================================
-- S1 — STAYS: RoomStay foundation + the DOUBLE-BOOKING GUARD (in-suite PMS core)
-- ----------------------------------------------------------------------------
-- Room inventory + the RoomStay reservation lifecycle + a race-proof overlap
-- guard. NO OTA/channel-manager, NO Yale, NO walk-in/check-in/folio (S2–S4).
-- Reuses the W0 shared Guest (a hotel guest is the SAME Guest) and the B1
-- GiST-EXCLUDE pattern. CRITICAL: a stay occupies [check_in, check_out) — the
-- checkout day is NOT occupied, so same-day turnover is allowed. Only ACTIVE
-- (reserved/checked_in) stays block. This fixes legacy F-DATA-01 (unguarded
-- room booking). Config-driven rate (held per room_type; 5% no-ITC GST is S4).
-- Atomic + audited + tenant-scoped.
-- ============================================================================

-- ── room_types — config-driven base rate (NO GST applied here; that's S4) ────
create table if not exists public.room_types (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null,
  base_rate  numeric(12,2) not null default 0 check (base_rate >= 0),  -- per-night, pre-tax
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- expression uniqueness MUST be a unique INDEX (W1a lesson f9ed6ce)
create unique index if not exists uq_room_types_org_name on public.room_types (org_id, lower(btrim(name)));
create index if not exists idx_room_types_org on public.room_types (org_id);

-- ── rooms — physical inventory; status is a placeholder (housekeeping is S3) ─
create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  room_type_id uuid not null references public.room_types(id) on delete restrict,
  number       text not null,
  name         text,
  status       text not null default 'available' check (status in ('available','out_of_service')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists uq_rooms_org_number on public.rooms (org_id, lower(btrim(number)));
create index if not exists idx_rooms_org on public.rooms (org_id);

-- ── room_stays — the reservation. Half-open occupancy [check_in, check_out). ─
create table if not exists public.room_stays (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  guest_id     uuid not null references public.guests(id) on delete restrict,   -- the SHARED W0 Guest
  room_id      uuid references public.rooms(id) on delete restrict,             -- null = unassigned (booked by type)
  room_type_id uuid not null references public.room_types(id) on delete restrict,
  check_in     date not null,
  check_out    date not null,
  status       text not null default 'reserved'
                 check (status in ('reserved','checked_in','checked_out','settled','cancelled','no_show')),
  rate_quoted  numeric(12,2) not null default 0,                                -- base_rate snapshot at reservation
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint chk_stay_dates check (check_out > check_in),
  -- THE GUARD: no two ACTIVE stays may overlap on the same room. daterange '[)'
  -- makes checkout-day = next check-in-day NOT a conflict (same-day turnover).
  -- btree_gist (B1) provides uuid '=' inside the GiST exclusion.
  constraint no_overlapping_active_stay
    exclude using gist (org_id with =, room_id with =, daterange(check_in, check_out, '[)') with &&)
    where (room_id is not null and status in ('reserved','checked_in'))
);
create index if not exists idx_room_stays_org on public.room_stays (org_id, check_in);
create index if not exists idx_room_stays_room on public.room_stays (room_id, check_in);
create index if not exists idx_room_stays_guest on public.room_stays (guest_id);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['room_types','rooms','room_stays'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ── room_types / rooms config (config-driven rate; never hardcoded) ──────────
create or replace function public.upsert_room_type(p_org uuid, p_name text, p_base_rate numeric, p_room_type_id uuid default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_base_rate < 0 then raise exception 'bad_rate' using errcode='22023'; end if;
  if p_room_type_id is null then
    insert into public.room_types(org_id, name, base_rate) values (p_org, btrim(p_name), p_base_rate) returning id into v_id;
  else
    update public.room_types set name = btrim(p_name), base_rate = p_base_rate, updated_at = now()
      where id = p_room_type_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'room_type_not_found' using errcode='P0002'; end if;
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'stays.room_type_upsert', 'completed', coalesce(p_actor_id, auth.uid()), 'room_type', v_id::text);
  return jsonb_build_object('room_type_id', v_id);
end; $$;

create or replace function public.create_room(p_org uuid, p_room_type_id uuid, p_number text, p_name text default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.room_types where id = p_room_type_id and org_id = p_org) then raise exception 'room_type_not_found' using errcode='P0002'; end if;
  insert into public.rooms(org_id, room_type_id, number, name) values (p_org, p_room_type_id, btrim(p_number), p_name) returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'stays.room_create', 'completed', coalesce(p_actor_id, auth.uid()), 'room', v_id::text);
  return jsonb_build_object('room_id', v_id);
end; $$;

create or replace function public.set_room_status(p_org uuid, p_room_id uuid, p_status text, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_status not in ('available','out_of_service') then raise exception 'bad_status' using errcode='22023'; end if;
  update public.rooms set status = p_status, updated_at = now() where id = p_room_id and org_id = p_org;
  if not found then raise exception 'room_not_found' using errcode='P0002'; end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.room_status', 'completed', coalesce(p_actor_id, auth.uid()), 'room', p_room_id::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('room_id', p_room_id, 'status', p_status);
end; $$;

-- ============================================================================
-- create_room_stay — reserve. Reuses the shared Guest (find_or_create_guest).
-- The GiST guard rejects overlapping ACTIVE stays on the same room (atomic).
-- ============================================================================
create or replace function public.create_room_stay(
  p_org uuid, p_phone text, p_name text, p_room_id uuid, p_room_type_id uuid,
  p_check_in date, p_check_out date, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_guest uuid; v_rate numeric(12,2); v_rtype uuid; v_stay uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_check_out <= p_check_in then raise exception 'bad_dates' using errcode='22023', detail='check_out must be after check_in'; end if;

  v_guest := (public.find_or_create_guest(p_org, p_phone, p_name, null, null, null, '{}', '{}', p_actor_id) ->> 'guest_id')::uuid;

  if p_room_id is not null then
    select r.room_type_id, rt.base_rate into v_rtype, v_rate
      from public.rooms r join public.room_types rt on rt.id = r.room_type_id
      where r.id = p_room_id and r.org_id = p_org;
    if v_rtype is null then raise exception 'room_not_found' using errcode='P0002'; end if;
  elsif p_room_type_id is not null then
    select id, base_rate into v_rtype, v_rate from public.room_types where id = p_room_type_id and org_id = p_org;
    if v_rtype is null then raise exception 'room_type_not_found' using errcode='P0002'; end if;
  else
    raise exception 'room_or_type_required' using errcode='22023';
  end if;

  begin
    insert into public.room_stays(org_id, guest_id, room_id, room_type_id, check_in, check_out, status, rate_quoted)
      values (p_org, v_guest, p_room_id, v_rtype, p_check_in, p_check_out, 'reserved', coalesce(v_rate,0))
      returning id into v_stay;
  exception when exclusion_violation then
    raise exception 'room_double_booked' using errcode='23P01', detail='overlapping active reservation on this room';
  end;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.stay_create', 'completed', coalesce(p_actor_id, auth.uid()), 'room_stay', v_stay::text,
            jsonb_build_object('room_id', p_room_id, 'check_in', p_check_in, 'check_out', p_check_out, 'guest_id', v_guest));
  return jsonb_build_object('stay_id', v_stay, 'guest_id', v_guest, 'rate_quoted', coalesce(v_rate,0));
end; $$;

-- ============================================================================
-- assign_room — attach a physical room to an unassigned (type-level) stay.
-- Re-validates the overlap guard on update.
-- ============================================================================
create or replace function public.assign_room(p_org uuid, p_stay_id uuid, p_room_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.rooms where id = p_room_id and org_id = p_org) then raise exception 'room_not_found' using errcode='P0002'; end if;
  select status into v_status from public.room_stays where id = p_stay_id and org_id = p_org;
  if v_status is null then raise exception 'stay_not_found' using errcode='P0002'; end if;
  if v_status not in ('reserved','checked_in') then raise exception 'stay_not_active' using errcode='22023', detail=v_status; end if;
  begin
    update public.room_stays set room_id = p_room_id, updated_at = now() where id = p_stay_id and org_id = p_org;
  exception when exclusion_violation then
    raise exception 'room_double_booked' using errcode='23P01';
  end;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'stays.assign_room', 'completed', coalesce(p_actor_id, auth.uid()), 'room_stay', p_stay_id::text);
  return jsonb_build_object('stay_id', p_stay_id, 'room_id', p_room_id);
end; $$;

-- ============================================================================
-- set_room_stay_status — guarded lifecycle transitions.
--   reserved   → checked_in | cancelled | no_show
--   checked_in → checked_out
--   checked_out→ settled
--   settled/cancelled/no_show = terminal
-- A non-active status frees the dates automatically (the GiST WHERE excludes it).
-- ============================================================================
create or replace function public.set_room_stay_status(p_org uuid, p_stay_id uuid, p_status text, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_current text; v_allowed text[];
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_status not in ('reserved','checked_in','checked_out','settled','cancelled','no_show') then raise exception 'bad_status' using errcode='22023'; end if;
  select status into v_current from public.room_stays where id = p_stay_id and org_id = p_org for update;
  if v_current is null then raise exception 'stay_not_found' using errcode='P0002'; end if;

  v_allowed := case v_current
    when 'reserved'    then array['checked_in','cancelled','no_show']
    when 'checked_in'  then array['checked_out']
    when 'checked_out' then array['settled']
    else array[]::text[]
  end;
  if not (p_status = any(v_allowed)) then
    raise exception 'illegal_transition' using errcode='22023', detail = format('%s → %s', v_current, p_status);
  end if;

  update public.room_stays set status = p_status, updated_at = now() where id = p_stay_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.stay_status', 'completed', coalesce(p_actor_id, auth.uid()), 'room_stay', p_stay_id::text,
            jsonb_build_object('from', v_current, 'to', p_status));
  return jsonb_build_object('stay_id', p_stay_id, 'from', v_current, 'to', p_status);
end; $$;

-- grants
do $$
declare fn text;
begin
  foreach fn in array array[
    'upsert_room_type(uuid,text,numeric,uuid,uuid)',
    'create_room(uuid,uuid,text,text,uuid)',
    'set_room_status(uuid,uuid,text,uuid)',
    'create_room_stay(uuid,text,text,uuid,uuid,date,date,uuid)',
    'assign_room(uuid,uuid,uuid,uuid)',
    'set_room_stay_status(uuid,uuid,text,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
