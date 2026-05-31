-- ============================================================================
-- S3 — STAYS: housekeeping + room status board + maintenance requests
-- ----------------------------------------------------------------------------
-- TWO INDEPENDENT DIMENSIONS:
--   occupancy     — DERIVED from S1 room_stays (a checked_in stay = occupied);
--                   never stored on the room.
--   housekeeping  — STORED on the room: clean / dirty / inspected / out_of_order.
-- A room is sellable/ready ONLY when vacant AND housekeeping ∈ (inspected,clean)
-- AND in service (rooms.status='available'). The two are modelled separately —
-- vacant-dirty, vacant-inspected, occupied(any-hk), etc. are all valid states.
--
-- CHECK-OUT → DIRTY MECHANISM (flagged choice): extends the S2 check_out_stay RPC
-- INLINE (CREATE OR REPLACE), in the SAME atomic transaction — NOT a DB trigger
-- and NOT a B4 async rule. Rationale: same-tx atomicity + audit, write logic
-- stays discoverable in one RPC, and the codebase uses explicit RPCs (no
-- triggers); a B4 rule would be eventual, wrong for an on-checkout side-effect.
--
-- Reuses W0 Staff (assignment) + the W2 photo-proof gate (cleaning turns).
-- Scope: housekeeping + room status + maintenance ONLY (folio/reporting = S4).
-- Atomic + audited + tenant-scoped.
-- ============================================================================

-- ── housekeeping is its OWN dimension on the room (distinct from occupancy) ──
alter table public.rooms add column if not exists housekeeping_status text not null default 'inspected'
  check (housekeeping_status in ('clean','dirty','inspected','out_of_order'));

-- ── housekeeping_tasks — cleaning turns; assignable to W0 staff; photo-proof ─
create table if not exists public.housekeeping_tasks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  room_id       uuid not null references public.rooms(id) on delete cascade,
  stay_id       uuid references public.room_stays(id) on delete set null,   -- the checkout that triggered it
  kind          text not null default 'turnover',
  status        text not null default 'pending' check (status in ('pending','in_progress','done')),
  assigned_staff_id uuid references public.staff(id) on delete set null,
  requires_photo boolean not null default false,
  photo_ref     text,
  completed_by  uuid,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_hk_tasks_org on public.housekeeping_tasks (org_id, status);
create index if not exists idx_hk_tasks_room on public.housekeeping_tasks (room_id);

-- ── maintenance_requests — issues against a room; assignable; lifecycle ──────
create table if not exists public.maintenance_requests (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  room_id       uuid not null references public.rooms(id) on delete cascade,
  description   text not null,
  priority      text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status        text not null default 'open' check (status in ('open','in_progress','resolved')),
  assigned_staff_id uuid references public.staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index if not exists idx_maint_org on public.maintenance_requests (org_id, status);
create index if not exists idx_maint_room on public.maintenance_requests (room_id);

do $$
declare t text;
begin
  foreach t in array array['housekeeping_tasks','maintenance_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ── manual housekeeping status set ───────────────────────────────────────────
create or replace function public.set_housekeeping_status(p_org uuid, p_room_id uuid, p_status text, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_status not in ('clean','dirty','inspected','out_of_order') then raise exception 'bad_status' using errcode='22023'; end if;
  update public.rooms set housekeeping_status = p_status, updated_at = now() where id = p_room_id and org_id = p_org;
  if not found then raise exception 'room_not_found' using errcode='P0002'; end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.hk_status', 'completed', coalesce(p_actor_id, auth.uid()), 'room', p_room_id::text, jsonb_build_object('housekeeping', p_status));
  return jsonb_build_object('room_id', p_room_id, 'housekeeping_status', p_status);
end; $$;

-- ── housekeeping task: create / assign / complete (photo-proof gate, W2) ─────
create or replace function public.create_housekeeping_task(p_org uuid, p_room_id uuid, p_kind text default 'turnover', p_requires_photo boolean default false, p_stay_id uuid default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.rooms where id = p_room_id and org_id = p_org) then raise exception 'room_not_found' using errcode='P0002'; end if;
  insert into public.housekeeping_tasks(org_id, room_id, stay_id, kind, requires_photo)
    values (p_org, p_room_id, p_stay_id, p_kind, p_requires_photo) returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'stays.hk_task_create', 'completed', coalesce(p_actor_id, auth.uid()), 'housekeeping_task', v_id::text);
  return jsonb_build_object('task_id', v_id);
end; $$;

create or replace function public.assign_housekeeping_task(p_org uuid, p_task_id uuid, p_staff_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id and org_id = p_org) then raise exception 'staff_not_found' using errcode='P0002'; end if;
  select status into v_status from public.housekeeping_tasks where id = p_task_id and org_id = p_org;
  if v_status is null then raise exception 'task_not_found' using errcode='P0002'; end if;
  if v_status = 'done' then raise exception 'task_done' using errcode='22023'; end if;
  update public.housekeeping_tasks set assigned_staff_id = p_staff_id, status = 'in_progress', updated_at = now() where id = p_task_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'stays.hk_task_assign', 'completed', coalesce(p_actor_id, auth.uid()), 'housekeeping_task', p_task_id::text);
  return jsonb_build_object('task_id', p_task_id, 'assigned', p_staff_id);
end; $$;

-- complete a turn → room becomes inspected/clean. Photo-required turns need a ref.
create or replace function public.complete_housekeeping_task(p_org uuid, p_task_id uuid, p_photo_ref text default null, p_result text default 'inspected', p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.housekeeping_tasks%rowtype;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_result not in ('clean','inspected') then raise exception 'bad_result' using errcode='22023'; end if;
  select * into v_t from public.housekeeping_tasks where id = p_task_id and org_id = p_org for update;
  if v_t.id is null then raise exception 'task_not_found' using errcode='P0002'; end if;
  if v_t.status = 'done' then raise exception 'task_done' using errcode='22023'; end if;
  if v_t.requires_photo and (p_photo_ref is null or btrim(p_photo_ref) = '') then
    raise exception 'photo_required' using errcode='22023', detail='this turn requires photo-proof';   -- W2 accountability moat
  end if;
  update public.housekeeping_tasks set status = 'done', photo_ref = p_photo_ref, completed_by = coalesce(p_actor_id, auth.uid()), completed_at = now(), updated_at = now()
    where id = p_task_id and org_id = p_org;
  update public.rooms set housekeeping_status = p_result, updated_at = now() where id = v_t.room_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.hk_task_complete', 'completed', coalesce(p_actor_id, auth.uid()), 'housekeeping_task', p_task_id::text,
            jsonb_build_object('result', p_result, 'photo', p_photo_ref is not null));
  return jsonb_build_object('task_id', p_task_id, 'room_id', v_t.room_id, 'housekeeping_status', p_result);
end; $$;

-- ── maintenance: create / status transitions / out-of-order / restore ───────
create or replace function public.create_maintenance_request(p_org uuid, p_room_id uuid, p_description text, p_priority text default 'medium', p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_priority not in ('low','medium','high','critical') then raise exception 'bad_priority' using errcode='22023'; end if;
  if not exists (select 1 from public.rooms where id = p_room_id and org_id = p_org) then raise exception 'room_not_found' using errcode='P0002'; end if;
  insert into public.maintenance_requests(org_id, room_id, description, priority) values (p_org, p_room_id, p_description, p_priority) returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.maint_create', 'completed', coalesce(p_actor_id, auth.uid()), 'maintenance_request', v_id::text, jsonb_build_object('priority', p_priority));
  return jsonb_build_object('request_id', v_id);
end; $$;

create or replace function public.set_maintenance_status(p_org uuid, p_request_id uuid, p_status text, p_staff_id uuid default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_current text; v_allowed text[];
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_status not in ('open','in_progress','resolved') then raise exception 'bad_status' using errcode='22023'; end if;
  select status into v_current from public.maintenance_requests where id = p_request_id and org_id = p_org for update;
  if v_current is null then raise exception 'request_not_found' using errcode='P0002'; end if;
  v_allowed := case v_current when 'open' then array['in_progress','resolved'] when 'in_progress' then array['resolved'] else array[]::text[] end;
  if not (p_status = any(v_allowed)) then raise exception 'illegal_transition' using errcode='22023', detail = format('%s → %s', v_current, p_status); end if;
  update public.maintenance_requests set status = p_status, assigned_staff_id = coalesce(p_staff_id, assigned_staff_id),
         resolved_at = case when p_status = 'resolved' then now() else resolved_at end
    where id = p_request_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.maint_status', 'completed', coalesce(p_actor_id, auth.uid()), 'maintenance_request', p_request_id::text, jsonb_build_object('from', v_current, 'to', p_status));
  return jsonb_build_object('request_id', p_request_id, 'status', p_status);
end; $$;

-- set a room OUT_OF_ORDER (removed from sellable inventory) / restore to dirty
create or replace function public.set_room_out_of_order(p_org uuid, p_room_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  update public.rooms set housekeeping_status = 'out_of_order', updated_at = now() where id = p_room_id and org_id = p_org;
  if not found then raise exception 'room_not_found' using errcode='P0002'; end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'stays.room_ooo', 'completed', coalesce(p_actor_id, auth.uid()), 'room', p_room_id::text);
  return jsonb_build_object('room_id', p_room_id, 'housekeeping_status', 'out_of_order');
end; $$;

create or replace function public.restore_room(p_org uuid, p_room_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  update public.rooms set housekeeping_status = 'dirty', updated_at = now() where id = p_room_id and org_id = p_org and housekeeping_status = 'out_of_order';
  if not found then raise exception 'room_not_ooo' using errcode='22023', detail='room is not out_of_order'; end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'stays.room_restore', 'completed', coalesce(p_actor_id, auth.uid()), 'room', p_room_id::text);
  return jsonb_build_object('room_id', p_room_id, 'housekeeping_status', 'dirty');
end; $$;

-- ── room_board (READ) — the live grid: occupancy (derived) + housekeeping +
--    sellable. Sellable = in service AND vacant AND hk ∈ (inspected,clean). ───
create or replace function public.room_board(p_org uuid)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
            'room_id', r.id, 'number', r.number, 'service_status', r.status, 'housekeeping_status', r.housekeeping_status,
            'occupied', occ.occupied,
            'sellable', (r.status = 'available' and not occ.occupied and r.housekeeping_status in ('inspected','clean'))
          ) order by r.number), '[]'::jsonb) into v
    from public.rooms r,
         lateral (select exists (select 1 from public.room_stays s where s.room_id = r.id and s.status = 'checked_in') as occupied) occ
    where r.org_id = p_org;
  return jsonb_build_object('rooms', v);
end; $$;

-- ============================================================================
-- check_out_stay — REPLACE (S2 body + the housekeeping side-effect): on
-- CHECKED_OUT, set the room DIRTY and create a turnover task (same atomic tx).
-- ============================================================================
create or replace function public.check_out_stay(p_org uuid, p_stay_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_room uuid; v_task uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select status, room_id into v_status, v_room from public.room_stays where id = p_stay_id and org_id = p_org for update;
  if v_status is null then raise exception 'stay_not_found' using errcode='P0002'; end if;
  if v_status <> 'checked_in' then raise exception 'illegal_transition' using errcode='22023', detail = format('%s → checked_out', v_status); end if;
  update public.room_stays set status = 'checked_out', checked_out_at = now(), updated_at = now() where id = p_stay_id and org_id = p_org;

  -- S3 side-effect (inline, same tx): checkout dirties the room + opens a turn
  if v_room is not null then
    update public.rooms set housekeeping_status = 'dirty', updated_at = now() where id = v_room and org_id = p_org;
    insert into public.housekeeping_tasks(org_id, room_id, stay_id, kind, status) values (p_org, v_room, p_stay_id, 'turnover', 'pending') returning id into v_task;
  end if;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'stays.check_out', 'completed', coalesce(p_actor_id, auth.uid()), 'room_stay', p_stay_id::text, jsonb_build_object('room_dirtied', v_room, 'turn_task', v_task));
  return jsonb_build_object('stay_id', p_stay_id, 'status', 'checked_out', 'turn_task_id', v_task);
end; $$;

-- grants
do $$
declare fn text;
begin
  foreach fn in array array[
    'set_housekeeping_status(uuid,uuid,text,uuid)',
    'create_housekeeping_task(uuid,uuid,text,boolean,uuid,uuid)',
    'assign_housekeeping_task(uuid,uuid,uuid,uuid)',
    'complete_housekeeping_task(uuid,uuid,text,text,uuid)',
    'create_maintenance_request(uuid,uuid,text,text,uuid)',
    'set_maintenance_status(uuid,uuid,text,uuid,uuid)',
    'set_room_out_of_order(uuid,uuid,uuid)',
    'restore_room(uuid,uuid,uuid)',
    'room_board(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
