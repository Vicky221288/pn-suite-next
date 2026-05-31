-- ============================================================================
-- S2 — STAYS: walk-ins + check-in/out workflows + Form C capture
-- ----------------------------------------------------------------------------
-- The guest-movement layer on top of the S1 reservation. Walk-in = a stay
-- created now with immediate check-in (still subject to the S1 GiST guard).
-- Check-in records a timestamp + (for foreign nationals) the FRRO Form C
-- dataset — check-in MUST NOT complete for a foreign guest without the required
-- fields (enforced server-side). Check-out records a timestamp only — NO money
-- (financial folio + SETTLED is S4). NO housekeeping/room-status (S3).
-- Reuses the W0 shared Guest + the S1 room_stays lifecycle. Atomic + audited.
-- ============================================================================

-- ── extend room_stays with actual movement timestamps + foreign flag ─────────
alter table public.room_stays add column if not exists checked_in_at  timestamptz;
alter table public.room_stays add column if not exists checked_out_at timestamptz;
alter table public.room_stays add column if not exists is_foreign     boolean not null default false;

-- ── form_c_records — FRRO dataset for foreign nationals; one per stay ─────────
create table if not exists public.form_c_records (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  stay_id          uuid not null references public.room_stays(id) on delete cascade,
  guest_id         uuid not null references public.guests(id) on delete restrict,
  passport_number  text not null,
  nationality      text not null,
  date_of_birth    date not null,
  visa_type        text,
  visa_number      text not null,
  arrived_from     text not null,
  intended_stay    text,
  next_destination text,
  created_at       timestamptz not null default now(),
  constraint uq_form_c_stay unique (stay_id)
);
create index if not exists idx_form_c_org on public.form_c_records (org_id, created_at desc);
create index if not exists idx_form_c_guest on public.form_c_records (guest_id);

do $$
declare t text;
begin
  foreach t in array array['form_c_records'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ── helper: the Form C required-field gate (server-side legal gate) ──────────
create or replace function public.pn_form_c_complete(p jsonb)
  returns boolean language sql immutable set search_path = public as $$
  select p is not null
     and coalesce(btrim(p->>'passport_number'), '') <> ''
     and coalesce(btrim(p->>'nationality'), '')     <> ''
     and coalesce(btrim(p->>'date_of_birth'), '')   <> ''
     and coalesce(btrim(p->>'visa_number'), '')     <> ''
     and coalesce(btrim(p->>'arrived_from'), '')    <> '';
$$;

-- internal: insert the Form C row (assumes completeness already validated)
create or replace function public.pn_insert_form_c(p_org uuid, p_stay uuid, p_guest uuid, p jsonb)
  returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.form_c_records(org_id, stay_id, guest_id, passport_number, nationality, date_of_birth,
                                    visa_type, visa_number, arrived_from, intended_stay, next_destination)
    values (p_org, p_stay, p_guest, btrim(p->>'passport_number'), btrim(p->>'nationality'), (p->>'date_of_birth')::date,
            p->>'visa_type', btrim(p->>'visa_number'), btrim(p->>'arrived_from'), p->>'intended_stay', p->>'next_destination')
    on conflict (stay_id) do update set passport_number = excluded.passport_number, nationality = excluded.nationality,
            date_of_birth = excluded.date_of_birth, visa_type = excluded.visa_type, visa_number = excluded.visa_number,
            arrived_from = excluded.arrived_from, intended_stay = excluded.intended_stay, next_destination = excluded.next_destination;
end; $$;

-- ============================================================================
-- check_in_stay — RESERVED → CHECKED_IN. Assigns a room if unassigned, records
-- the check-in timestamp, and (for foreign nationals) gates on Form C.
-- ============================================================================
create or replace function public.check_in_stay(
  p_org uuid, p_stay_id uuid, p_room_id uuid default null, p_is_foreign boolean default false,
  p_form_c jsonb default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stay public.room_stays%rowtype;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_stay from public.room_stays where id = p_stay_id and org_id = p_org for update;
  if v_stay.id is null then raise exception 'stay_not_found' using errcode='P0002'; end if;
  if v_stay.status <> 'reserved' then raise exception 'illegal_transition' using errcode='22023', detail = format('%s → checked_in', v_stay.status); end if;

  -- legal gate FIRST (validate before any write): a foreign guest needs a complete Form C
  if p_is_foreign and not public.pn_form_c_complete(p_form_c) then
    raise exception 'form_c_required' using errcode='22023', detail='foreign-national check-in requires complete Form C';
  end if;

  -- assign room if needed; a check-in cannot proceed without a physical room
  if p_room_id is not null then
    if not exists (select 1 from public.rooms where id = p_room_id and org_id = p_org) then raise exception 'room_not_found' using errcode='P0002'; end if;
    begin
      update public.room_stays set room_id = p_room_id where id = p_stay_id and org_id = p_org;
    exception when exclusion_violation then raise exception 'room_double_booked' using errcode='23P01'; end;
    v_stay.room_id := p_room_id;
  end if;
  if v_stay.room_id is null then raise exception 'room_required' using errcode='22023', detail='assign a room before check-in'; end if;

  if p_is_foreign then perform public.pn_insert_form_c(p_org, p_stay_id, v_stay.guest_id, p_form_c); end if;

  update public.room_stays set status = 'checked_in', checked_in_at = now(), is_foreign = p_is_foreign, updated_at = now()
    where id = p_stay_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.check_in', 'completed', coalesce(p_actor_id, auth.uid()), 'room_stay', p_stay_id::text,
            jsonb_build_object('is_foreign', p_is_foreign, 'form_c', p_is_foreign));
  return jsonb_build_object('stay_id', p_stay_id, 'status', 'checked_in', 'is_foreign', p_is_foreign);
end; $$;

-- ============================================================================
-- check_out_stay — CHECKED_IN → CHECKED_OUT. Records a timestamp only — NO
-- money (financial settlement → SETTLED is S4 folio).
-- ============================================================================
create or replace function public.check_out_stay(p_org uuid, p_stay_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select status into v_status from public.room_stays where id = p_stay_id and org_id = p_org for update;
  if v_status is null then raise exception 'stay_not_found' using errcode='P0002'; end if;
  if v_status <> 'checked_in' then raise exception 'illegal_transition' using errcode='22023', detail = format('%s → checked_out', v_status); end if;
  update public.room_stays set status = 'checked_out', checked_out_at = now(), updated_at = now() where id = p_stay_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'stays.check_out', 'completed', coalesce(p_actor_id, auth.uid()), 'room_stay', p_stay_id::text);
  return jsonb_build_object('stay_id', p_stay_id, 'status', 'checked_out');
end; $$;

-- ============================================================================
-- create_walk_in — guest arriving without a reservation. Creates the stay AND
-- checks in immediately (status checked_in, timestamp now) — still subject to
-- the S1 double-booking guard + the Form C gate. Reuses the shared Guest.
-- ============================================================================
create or replace function public.create_walk_in(
  p_org uuid, p_phone text, p_name text, p_room_id uuid, p_check_in date, p_check_out date,
  p_is_foreign boolean default false, p_form_c jsonb default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_guest uuid; v_rtype uuid; v_rate numeric(12,2); v_stay uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_check_out <= p_check_in then raise exception 'bad_dates' using errcode='22023'; end if;
  if p_room_id is null then raise exception 'room_required' using errcode='22023', detail='a walk-in must be assigned a room'; end if;
  if p_is_foreign and not public.pn_form_c_complete(p_form_c) then
    raise exception 'form_c_required' using errcode='22023', detail='foreign-national walk-in requires complete Form C';
  end if;

  select r.room_type_id, rt.base_rate into v_rtype, v_rate
    from public.rooms r join public.room_types rt on rt.id = r.room_type_id where r.id = p_room_id and r.org_id = p_org;
  if v_rtype is null then raise exception 'room_not_found' using errcode='P0002'; end if;

  v_guest := (public.find_or_create_guest(p_org, p_phone, p_name, null, null, null, '{}', '{}', p_actor_id) ->> 'guest_id')::uuid;

  begin
    insert into public.room_stays(org_id, guest_id, room_id, room_type_id, check_in, check_out, status, rate_quoted, checked_in_at, is_foreign)
      values (p_org, v_guest, p_room_id, v_rtype, p_check_in, p_check_out, 'checked_in', coalesce(v_rate,0), now(), p_is_foreign)
      returning id into v_stay;
  exception when exclusion_violation then
    raise exception 'room_double_booked' using errcode='23P01', detail='room occupied for those dates';
  end;

  if p_is_foreign then perform public.pn_insert_form_c(p_org, v_stay, v_guest, p_form_c); end if;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.walk_in', 'completed', coalesce(p_actor_id, auth.uid()), 'room_stay', v_stay::text,
            jsonb_build_object('room_id', p_room_id, 'is_foreign', p_is_foreign, 'guest_id', v_guest));
  return jsonb_build_object('stay_id', v_stay, 'guest_id', v_guest, 'status', 'checked_in', 'is_foreign', p_is_foreign);
end; $$;

-- grants
do $$
declare fn text;
begin
  foreach fn in array array[
    'pn_form_c_complete(jsonb)',
    'pn_insert_form_c(uuid,uuid,uuid,jsonb)',
    'check_in_stay(uuid,uuid,uuid,boolean,jsonb,uuid)',
    'check_out_stay(uuid,uuid,uuid)',
    'create_walk_in(uuid,text,text,uuid,date,date,boolean,jsonb,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
