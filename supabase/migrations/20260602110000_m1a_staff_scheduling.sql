-- ============================================================================
-- M1a — WORKFORCE: staff scheduling (shifts · roster · assignment & status)
-- ----------------------------------------------------------------------------
-- The first module-migration port. Re-expresses the legacy Shifts module
-- world-class against Deputy / 7shifts (NOT a legacy re-skin): recurring shift
-- TEMPLATES → concrete shifts on a publishable ROSTER → staff ASSIGNMENTS with a
-- guarded status lifecycle. Reuses the W0 `staff` entity (no parallel person
-- record) and the W2 `event_staff` roster PATTERN (assignment + status),
-- generalized from event-scoped to calendar shifts.
--
-- THE SEAM — staff double-booking guard: a staff member must NOT hold two
-- overlapping ACTIVE assignments. Same proven B1/S1 GiST-EXCLUDE mechanism that
-- guards room/hall dates, now guarding STAFF TIME:
--   exclude using gist (org_id =, staff_id =, tstzrange(start_at,end_at,'[)') &&)
--   where status in ('scheduled','acknowledged','completed')
-- Half-open '[)' → adjacent shifts (one ends exactly as the next begins) do NOT
-- conflict. cancelled / no_show fall outside the partial index → they FREE the
-- slot (mirror the S1 boundary matrix). Conflicts enforced by the DB constraint,
-- never check-then-insert.
--
-- SCOPE GUARD: scheduling ONLY. NO attendance/clock-in/geofence, NO leave, NO HR
-- fields, NO tiered-approval, NO payroll, NO messaging (all M1b / later).
-- Atomic + audited + tenant-scoped (RLS default-deny + auth.uid() self-auth).
-- Manager capability `roster.manage` gates every write (publish/assign/config).
-- ============================================================================

create extension if not exists btree_gist;   -- uuid '=' inside the GiST EXCLUDE (B1)

-- ── shift_templates — recurring shift definition (config per org; NEVER a PN
--    literal). days_of_week uses 0=Sun..6=Sat (matches Postgres extract(dow) &
--    JS getUTCDay). A template generates concrete shifts onto a roster. ────────
create table if not exists public.shift_templates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  name          text not null,
  role          text,                              -- role label for the shift (e.g. 'server')
  start_time    time not null,
  end_time      time not null,                     -- <= start_time ⇒ overnight (rolls to next day)
  location      text,                              -- optional (named, not coordinates)
  days_of_week  int[] not null default '{}',       -- 0=Sun..6=Sat
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- expression uniqueness MUST be a unique INDEX (W1a lesson)
create unique index if not exists uq_shift_templates_org_name on public.shift_templates (org_id, lower(btrim(name)));
create index if not exists idx_shift_templates_org on public.shift_templates (org_id);

-- ── staff_rosters — a publishable roster over a period. draft → published;
--    published is what staff see (roster_board hides drafts from non-managers). ─
create table if not exists public.staff_rosters (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  name          text not null,
  period_start  date not null,
  period_end    date not null,                     -- inclusive last day of the roster window
  status        text not null default 'draft' check (status in ('draft','published')),
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint chk_roster_dates check (period_end >= period_start)
);
create index if not exists idx_staff_rosters_org on public.staff_rosters (org_id, period_start);

-- ── shifts — concrete shift on a roster (date + time window + role + location).
--    start_at/end_at are IST wall-clock anchored to timestamptz. template_id is
--    provenance (nullable → ad-hoc manual shift). ─────────────────────────────
create table if not exists public.shifts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  roster_id     uuid not null references public.staff_rosters(id) on delete cascade,
  template_id   uuid references public.shift_templates(id) on delete set null,
  shift_date    date not null,
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  role          text,
  location      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint chk_shift_window check (end_at > start_at)
);
-- idempotent template expansion: one shift per (roster, template, date)
create unique index if not exists uq_shift_template_date on public.shifts (roster_id, template_id, shift_date) where template_id is not null;
create index if not exists idx_shifts_org_date on public.shifts (org_id, shift_date);
create index if not exists idx_shifts_roster on public.shifts (roster_id);

-- ── shift_assignments — staff → shift, with the guarded lifecycle + THE GUARD.
--    The shift's [start_at,end_at) window is SNAPSHOT onto the assignment so the
--    single-table GiST EXCLUDE can enforce per-staff overlap (mirrors how
--    room_stays carries its own daterange). ──────────────────────────────────
create table if not exists public.shift_assignments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  shift_id      uuid not null references public.shifts(id) on delete cascade,
  staff_id      uuid not null references public.staff(id) on delete restrict,   -- the SHARED W0 staff
  status        text not null default 'scheduled'
                  check (status in ('scheduled','acknowledged','completed','cancelled','no_show')),
  start_at      timestamptz not null,              -- snapshot of the shift window (for the guard)
  end_at        timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_assignment unique (shift_id, staff_id),   -- one assignment per staff per shift
  -- THE GUARD: no two ACTIVE assignments for the same staff may overlap in time.
  -- '[)' makes adjacent shifts non-conflicting; cancelled/no_show fall outside
  -- the partial index and free the slot. btree_gist (B1) supplies uuid '='.
  constraint no_overlapping_staff_assignment
    exclude using gist (org_id with =, staff_id with =, tstzrange(start_at, end_at, '[)') with &&)
    where (status in ('scheduled','acknowledged','completed'))
);
create index if not exists idx_assignments_staff on public.shift_assignments (staff_id, start_at);
create index if not exists idx_assignments_shift on public.shift_assignments (shift_id);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['shift_templates','staff_rosters','shifts','shift_assignments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ============================================================================
-- upsert_shift_template — recurring shift config (manager: roster.manage).
-- ============================================================================
create or replace function public.upsert_shift_template(
  p_org uuid, p_name text, p_role text, p_start_time time, p_end_time time,
  p_location text default null, p_days_of_week int[] default '{}', p_active boolean default true,
  p_template_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; d int;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'roster.manage') then raise exception 'forbidden' using errcode='42501', detail='roster.manage required'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'bad_name' using errcode='22023'; end if;
  foreach d in array coalesce(p_days_of_week, '{}') loop
    if d < 0 or d > 6 then raise exception 'bad_dow' using errcode='22023', detail='days_of_week must be 0..6'; end if;
  end loop;
  if p_template_id is null then
    insert into public.shift_templates(org_id, name, role, start_time, end_time, location, days_of_week, active)
      values (p_org, btrim(p_name), p_role, p_start_time, p_end_time, p_location, coalesce(p_days_of_week,'{}'), coalesce(p_active,true))
      returning id into v_id;
  else
    update public.shift_templates set name = btrim(p_name), role = p_role, start_time = p_start_time, end_time = p_end_time,
        location = p_location, days_of_week = coalesce(p_days_of_week,'{}'), active = coalesce(p_active,true), updated_at = now()
      where id = p_template_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'template_not_found' using errcode='P0002'; end if;
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'workforce.shift_template_upsert', 'completed', coalesce(p_actor_id, auth.uid()), 'shift_template', v_id::text);
  return jsonb_build_object('template_id', v_id);
end; $$;

-- ============================================================================
-- create_roster — a draft roster window (manager). Upsert by id.
-- ============================================================================
create or replace function public.create_roster(
  p_org uuid, p_name text, p_period_start date, p_period_end date,
  p_roster_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'roster.manage') then raise exception 'forbidden' using errcode='42501', detail='roster.manage required'; end if;
  if p_period_end < p_period_start then raise exception 'bad_dates' using errcode='22023', detail='period_end before period_start'; end if;
  if p_roster_id is null then
    insert into public.staff_rosters(org_id, name, period_start, period_end)
      values (p_org, btrim(p_name), p_period_start, p_period_end) returning id into v_id;
  else
    update public.staff_rosters set name = btrim(p_name), period_start = p_period_start, period_end = p_period_end, updated_at = now()
      where id = p_roster_id and org_id = p_org and status = 'draft' returning id into v_id;
    if v_id is null then raise exception 'roster_not_editable' using errcode='22023', detail='not found or already published'; end if;
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'workforce.roster_upsert', 'completed', coalesce(p_actor_id, auth.uid()), 'staff_roster', v_id::text);
  return jsonb_build_object('roster_id', v_id);
end; $$;

-- ============================================================================
-- generate_shifts_from_template — expand a recurring template across the
-- roster's period (only matching days_of_week). IST wall-clock → timestamptz;
-- end_time <= start_time ⇒ overnight (rolls to next day). IDEMPOTENT: the
-- (roster,template,date) unique index makes re-generation a no-op. Roster must
-- be draft. (manager).
-- ============================================================================
create or replace function public.generate_shifts_from_template(
  p_org uuid, p_roster_id uuid, p_template_id uuid, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r_status text; r_start date; r_end date; t record; d date; v_start timestamptz; v_end timestamptz; v_n int := 0;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'roster.manage') then raise exception 'forbidden' using errcode='42501', detail='roster.manage required'; end if;
  select status, period_start, period_end into r_status, r_start, r_end from public.staff_rosters where id = p_roster_id and org_id = p_org;
  if r_status is null then raise exception 'roster_not_found' using errcode='P0002'; end if;
  if r_status <> 'draft' then raise exception 'roster_published' using errcode='22023', detail='cannot add shifts to a published roster'; end if;
  select * into t from public.shift_templates where id = p_template_id and org_id = p_org;
  if t.id is null then raise exception 'template_not_found' using errcode='P0002'; end if;

  d := r_start;
  while d <= r_end loop
    if extract(dow from d)::int = any(t.days_of_week) then
      v_start := (d + t.start_time) at time zone 'Asia/Kolkata';
      if t.end_time <= t.start_time then
        v_end := ((d + 1) + t.end_time) at time zone 'Asia/Kolkata';   -- overnight
      else
        v_end := (d + t.end_time) at time zone 'Asia/Kolkata';
      end if;
      insert into public.shifts(org_id, roster_id, template_id, shift_date, start_at, end_at, role, location)
        values (p_org, p_roster_id, p_template_id, d, v_start, v_end, t.role, t.location)
        on conflict (roster_id, template_id, shift_date) do nothing;
      if found then v_n := v_n + 1; end if;
    end if;
    d := d + 1;
  end loop;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'workforce.shifts_generate', 'completed', coalesce(p_actor_id, auth.uid()), 'staff_roster', p_roster_id::text,
            jsonb_build_object('template_id', p_template_id, 'generated', v_n));
  return jsonb_build_object('roster_id', p_roster_id, 'template_id', p_template_id, 'generated', v_n);
end; $$;

-- ============================================================================
-- upsert_shift — ad-hoc / manual concrete shift (no template). Roster draft.
-- IST wall-clock window. (manager).
-- ============================================================================
create or replace function public.upsert_shift(
  p_org uuid, p_roster_id uuid, p_shift_date date, p_start_time time, p_end_time time,
  p_role text default null, p_location text default null, p_shift_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r_status text; v_id uuid; v_start timestamptz; v_end timestamptz;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'roster.manage') then raise exception 'forbidden' using errcode='42501', detail='roster.manage required'; end if;
  select status into r_status from public.staff_rosters where id = p_roster_id and org_id = p_org;
  if r_status is null then raise exception 'roster_not_found' using errcode='P0002'; end if;
  if r_status <> 'draft' then raise exception 'roster_published' using errcode='22023', detail='cannot edit shifts on a published roster'; end if;

  v_start := (p_shift_date + p_start_time) at time zone 'Asia/Kolkata';
  if p_end_time <= p_start_time then
    v_end := ((p_shift_date + 1) + p_end_time) at time zone 'Asia/Kolkata';
  else
    v_end := (p_shift_date + p_end_time) at time zone 'Asia/Kolkata';
  end if;

  if p_shift_id is null then
    insert into public.shifts(org_id, roster_id, template_id, shift_date, start_at, end_at, role, location)
      values (p_org, p_roster_id, null, p_shift_date, v_start, v_end, p_role, p_location) returning id into v_id;
  else
    update public.shifts set shift_date = p_shift_date, start_at = v_start, end_at = v_end, role = p_role, location = p_location, updated_at = now()
      where id = p_shift_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'shift_not_found' using errcode='P0002'; end if;
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'workforce.shift_upsert', 'completed', coalesce(p_actor_id, auth.uid()), 'shift', v_id::text);
  return jsonb_build_object('shift_id', v_id, 'start_at', v_start, 'end_at', v_end);
end; $$;

-- ============================================================================
-- publish_roster — draft → published (manager). Idempotent (re-publish = no-op).
-- Published is what staff see via roster_board.
-- ============================================================================
create or replace function public.publish_roster(p_org uuid, p_roster_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'roster.manage') then raise exception 'forbidden' using errcode='42501', detail='roster.manage required'; end if;
  select status into v_status from public.staff_rosters where id = p_roster_id and org_id = p_org for update;
  if v_status is null then raise exception 'roster_not_found' using errcode='P0002'; end if;
  if v_status = 'published' then return jsonb_build_object('roster_id', p_roster_id, 'status', 'published', 'idempotent', true); end if;
  update public.staff_rosters set status = 'published', published_at = now(), updated_at = now() where id = p_roster_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'workforce.roster_publish', 'completed', coalesce(p_actor_id, auth.uid()), 'staff_roster', p_roster_id::text);
  return jsonb_build_object('roster_id', p_roster_id, 'status', 'published', 'idempotent', false);
end; $$;

-- ============================================================================
-- assign_shift — assign a staff member to a shift (manager). Snapshots the
-- shift window onto the assignment; the GiST guard rejects an overlapping ACTIVE
-- assignment atomically (staff_double_booked). Reuses the SHARED W0 staff row.
-- ============================================================================
create or replace function public.assign_shift(p_org uuid, p_shift_id uuid, p_staff_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_start timestamptz; v_end timestamptz; v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'roster.manage') then raise exception 'forbidden' using errcode='42501', detail='roster.manage required'; end if;
  select start_at, end_at into v_start, v_end from public.shifts where id = p_shift_id and org_id = p_org;
  if v_start is null then raise exception 'shift_not_found' using errcode='P0002'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id and org_id = p_org) then raise exception 'staff_not_found' using errcode='P0002'; end if;
  begin
    insert into public.shift_assignments(org_id, shift_id, staff_id, status, start_at, end_at)
      values (p_org, p_shift_id, p_staff_id, 'scheduled', v_start, v_end) returning id into v_id;
  exception
    when unique_violation then raise exception 'already_assigned' using errcode='23505', detail='staff already assigned to this shift';
    when exclusion_violation then raise exception 'staff_double_booked' using errcode='23P01', detail='overlapping active shift for this staff';
  end;
  -- atomic 'completed' audit INSIDE the tx — can never outlive a rolled-back insert
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'workforce.shift_assign', 'completed', coalesce(p_actor_id, auth.uid()), 'shift_assignment', v_id::text,
            jsonb_build_object('shift_id', p_shift_id, 'staff_id', p_staff_id));
  return jsonb_build_object('assignment_id', v_id, 'shift_id', p_shift_id, 'staff_id', p_staff_id);
end; $$;

-- ============================================================================
-- set_shift_assignment_status — guarded lifecycle (manager).
--   scheduled    → acknowledged | cancelled | no_show
--   acknowledged → completed | cancelled | no_show
--   completed / cancelled / no_show = terminal
-- Moving to cancelled/no_show drops the row from the partial GiST index → frees
-- the staff slot automatically.
-- ============================================================================
create or replace function public.set_shift_assignment_status(p_org uuid, p_assignment_id uuid, p_status text, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_current text; v_allowed text[];
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'roster.manage') then raise exception 'forbidden' using errcode='42501', detail='roster.manage required'; end if;
  if p_status not in ('scheduled','acknowledged','completed','cancelled','no_show') then raise exception 'bad_status' using errcode='22023'; end if;
  select status into v_current from public.shift_assignments where id = p_assignment_id and org_id = p_org for update;
  if v_current is null then raise exception 'assignment_not_found' using errcode='P0002'; end if;

  v_allowed := case v_current
    when 'scheduled'    then array['acknowledged','cancelled','no_show']
    when 'acknowledged' then array['completed','cancelled','no_show']
    else array[]::text[]
  end;
  if not (p_status = any(v_allowed)) then
    raise exception 'illegal_transition' using errcode='22023', detail = format('%s → %s', v_current, p_status);
  end if;

  update public.shift_assignments set status = p_status, updated_at = now() where id = p_assignment_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'workforce.shift_status', 'completed', coalesce(p_actor_id, auth.uid()), 'shift_assignment', p_assignment_id::text,
            jsonb_build_object('from', v_current, 'to', p_status));
  return jsonb_build_object('assignment_id', p_assignment_id, 'from', v_current, 'to', p_status);
end; $$;

-- ============================================================================
-- roster_board — READ: shifts in [from,to] with assignments (staff + status).
-- Visibility: a non-manager (lacks roster.manage) sees ONLY published rosters'
-- shifts — a draft roster is never surfaced as published. service_role / system
-- path (auth.uid() null) sees all.
-- ============================================================================
create or replace function public.roster_board(p_org uuid, p_from date, p_to date)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_can_manage boolean; v_rows jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  v_can_manage := (auth.uid() is null) or public.has_capability(p_org, 'roster.manage');

  select coalesce(jsonb_agg(obj order by obj->>'start_at'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'shift_id', s.id, 'roster_id', r.id, 'roster_name', r.name, 'roster_status', r.status,
             'shift_date', s.shift_date, 'start_at', s.start_at, 'end_at', s.end_at, 'role', s.role, 'location', s.location,
             'assignments', coalesce((
               select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'staff_id', a.staff_id, 'staff_name', st.name, 'status', a.status))
               from public.shift_assignments a join public.staff st on st.id = a.staff_id
               where a.shift_id = s.id
             ), '[]'::jsonb)
           ) as obj
    from public.shifts s
    join public.staff_rosters r on r.id = s.roster_id
    where s.org_id = p_org and s.shift_date between p_from and p_to
      and (v_can_manage or r.status = 'published')
  ) q;

  return jsonb_build_object('can_manage', v_can_manage, 'shifts', v_rows);
end; $$;

-- ── grants (RPC is the only write path; revoke from public, grant to the app) ─
do $$
declare fn text;
begin
  foreach fn in array array[
    'upsert_shift_template(uuid,text,text,time,time,text,int[],boolean,uuid,uuid)',
    'create_roster(uuid,text,date,date,uuid,uuid)',
    'generate_shifts_from_template(uuid,uuid,uuid,uuid)',
    'upsert_shift(uuid,uuid,date,time,time,text,text,uuid,uuid)',
    'publish_roster(uuid,uuid,uuid)',
    'assign_shift(uuid,uuid,uuid,uuid)',
    'set_shift_assignment_status(uuid,uuid,text,uuid)',
    'roster_board(uuid,date,date)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
