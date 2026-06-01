-- ============================================================================
-- M1b — WORKFORCE: attendance + leave + HR fields + GENERIC tiered-approval
-- ----------------------------------------------------------------------------
-- Second workforce increment (depends on M1a). Benchmarked vs greytHR /
-- Connecteam (NOT a legacy re-skin). Four pieces on the shared spine, all
-- reusing the W0 `staff` entity (never a parallel person record):
--
--  A) HR FIELDS — extend the W0 staff profile (employee_code, date_of_joining,
--     designation, employment_type, email). ALTER staff; no second person table.
--     NO payroll / pay / salary (out of scope).
--
--  B) GEOFENCED ON-PREMISE ATTENDANCE (DPDP-sensitive):
--     - `attendance_geofences` = per-ORG config (the PROPERTY's centre + radius),
--       manager-set, NEVER a hardcoded PN literal.
--     - the DEVICE evaluates its own position against that fence and sends ONLY
--       the resulting boolean. `record_attendance` stores on_premise + timestamp.
--     - **`attendance_records` has NO lat/long column anywhere** — raw coordinates
--       are never transmitted to nor persisted by the server. We store the
--       attendance FACT ("clocked in on-site?"), not sensitive location data.
--       (cf. AUDIT F-SEC-02 PII posture.) The geofence centre stored in config is
--       the property's own location, not staff tracking.
--
--  C) LEAVE — request → pending → approved/rejected, guarded + audited. Leave is
--     the FIRST CONSUMER of the approval primitive (D). NOT wired to M1a shift
--     assignment (leave↔assignment cross-check DEFERRED — see KL-6).
--
--  D) TIERED-APPROVAL PRIMITIVE — GENERIC, not leave-specific. References its
--     subject POLYMORPHICALLY: (request_type, subject_id) — NO leave_id FK — so
--     M6 plugs in request_type='expense' with ZERO changes. One-or-more approver
--     tiers (required_approvals + distinct per-approver decisions),
--     anti-self-approval, capability-gated ('approval.decide').
--
-- Every write atomic + audited + tenant-scoped (RLS default-deny + auth.uid()
-- self-auth). No client-supplied org_id. No god-role.
-- ============================================================================

-- ── A) HR FIELDS — extend the W0 staff profile (no second person table) ──────
alter table public.staff add column if not exists employee_code   text;
alter table public.staff add column if not exists date_of_joining date;
alter table public.staff add column if not exists designation     text;
alter table public.staff add column if not exists employment_type text
  check (employment_type is null or employment_type in ('full_time','part_time','contract','temporary'));
alter table public.staff add column if not exists email           text;
-- employee_code unique within an org (when present)
create unique index if not exists uq_staff_org_empcode on public.staff (org_id, lower(btrim(employee_code))) where employee_code is not null;

-- ── B) attendance_geofences — per-org fence CONFIG (property centre + radius) ─
create table if not exists public.attendance_geofences (
  org_id      uuid primary key references public.orgs(id) on delete cascade,
  center_lat  numeric(9,6) not null,
  center_lng  numeric(9,6) not null,
  radius_m    numeric(10,2) not null check (radius_m > 0),
  updated_at  timestamptz not null default now()
);

-- ── B) attendance_records — on_premise BOOLEAN + timestamp ONLY. NO lat/long. ─
create table if not exists public.attendance_records (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  shift_id    uuid references public.shifts(id) on delete set null,   -- optional M1a link
  kind        text not null check (kind in ('check_in','check_out')),
  on_premise  boolean not null,                                        -- device-evaluated geofence result
  recorded_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
  -- DELIBERATELY no latitude/longitude/coordinate column (DPDP): we store the
  -- attendance fact, not the location. The device evaluates the fence locally.
);
create index if not exists idx_attendance_org on public.attendance_records (org_id, recorded_at desc);
create index if not exists idx_attendance_staff on public.attendance_records (staff_id, recorded_at desc);

-- ── D) approval_requests — GENERIC tiered approval (polymorphic subject) ──────
create table if not exists public.approval_requests (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  request_type      text not null,                                     -- 'leave' now; 'expense' (M6) later
  subject_id        uuid not null,                                     -- POLYMORPHIC — NO FK to any subject table
  status            text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  required_approvals int not null default 1 check (required_approvals >= 1),
  approvals_count   int not null default 0 check (approvals_count >= 0),
  requested_by_user uuid,                                              -- for anti-self-approval (plain uuid, like audit actor)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_approval_subject unique (org_id, request_type, subject_id)  -- one thread per subject
);
create index if not exists idx_approval_org_status on public.approval_requests (org_id, status);

-- ── D) approval_decisions — one row per approver tier (distinct-approver) ─────
create table if not exists public.approval_decisions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  approval_request_id uuid not null references public.approval_requests(id) on delete cascade,
  decided_by_user     uuid,
  decision            text not null check (decision in ('approve','reject')),
  created_at          timestamptz not null default now(),
  constraint uq_decision_per_approver unique (approval_request_id, decided_by_user)  -- no double-vote
);
create index if not exists idx_decisions_request on public.approval_decisions (approval_request_id);

-- ── C) leave_requests — consumes the approval primitive as request_type='leave' ─
create table if not exists public.leave_requests (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  staff_id            uuid not null references public.staff(id) on delete cascade,
  leave_type          text not null default 'casual',
  start_date          date not null,
  end_date            date not null,
  reason              text,
  status              text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_leave_dates check (end_date >= start_date)
);
create index if not exists idx_leave_org on public.leave_requests (org_id, status);
create index if not exists idx_leave_staff on public.leave_requests (staff_id);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['attendance_geofences','attendance_records','approval_requests','approval_decisions','leave_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ============================================================================
-- A) set_hr_fields — extend the SAME staff row (manager: staff.manage).
-- ============================================================================
create or replace function public.set_hr_fields(
  p_org uuid, p_staff_id uuid, p_employee_code text default null, p_date_of_joining date default null,
  p_designation text default null, p_employment_type text default null, p_email text default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'staff.manage') then raise exception 'forbidden' using errcode='42501', detail='staff.manage required'; end if;
  if p_employment_type is not null and p_employment_type not in ('full_time','part_time','contract','temporary') then
    raise exception 'bad_employment_type' using errcode='22023';
  end if;
  update public.staff set
      employee_code = coalesce(p_employee_code, employee_code),
      date_of_joining = coalesce(p_date_of_joining, date_of_joining),
      designation = coalesce(p_designation, designation),
      employment_type = coalesce(p_employment_type, employment_type),
      email = coalesce(p_email, email),
      updated_at = now()
    where id = p_staff_id and org_id = p_org;
  if not found then raise exception 'staff_not_found' using errcode='P0002'; end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'workforce.hr_fields_set', 'completed', coalesce(p_actor_id, auth.uid()), 'staff', p_staff_id::text);
  return jsonb_build_object('staff_id', p_staff_id);
end; $$;

-- ============================================================================
-- B) set_geofence — per-org fence config (manager: staff.manage). Upsert by org.
-- ============================================================================
create or replace function public.set_geofence(
  p_org uuid, p_center_lat numeric, p_center_lng numeric, p_radius_m numeric, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'staff.manage') then raise exception 'forbidden' using errcode='42501', detail='staff.manage required'; end if;
  if p_radius_m is null or p_radius_m <= 0 then raise exception 'bad_radius' using errcode='22023'; end if;
  insert into public.attendance_geofences(org_id, center_lat, center_lng, radius_m, updated_at)
    values (p_org, p_center_lat, p_center_lng, p_radius_m, now())
    on conflict (org_id) do update set center_lat = excluded.center_lat, center_lng = excluded.center_lng, radius_m = excluded.radius_m, updated_at = now();
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'workforce.geofence_set', 'completed', coalesce(p_actor_id, auth.uid()), 'attendance_geofence', p_org::text);
  return jsonb_build_object('org_id', p_org);
end; $$;

-- ============================================================================
-- B) record_attendance — stores the DEVICE-EVALUATED boolean + timestamp ONLY.
-- Receives NO coordinates; persists NO coordinates. (any org member; kiosk model)
-- ============================================================================
create or replace function public.record_attendance(
  p_org uuid, p_staff_id uuid, p_kind text, p_on_premise boolean, p_shift_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_kind not in ('check_in','check_out') then raise exception 'bad_kind' using errcode='22023'; end if;
  if p_on_premise is null then raise exception 'on_premise_required' using errcode='22023'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id and org_id = p_org) then raise exception 'staff_not_found' using errcode='P0002'; end if;
  if p_shift_id is not null and not exists (select 1 from public.shifts where id = p_shift_id and org_id = p_org) then raise exception 'shift_not_found' using errcode='P0002'; end if;
  insert into public.attendance_records(org_id, staff_id, shift_id, kind, on_premise)
    values (p_org, p_staff_id, p_shift_id, p_kind, p_on_premise) returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'workforce.attendance_record', 'completed', coalesce(p_actor_id, auth.uid()), 'attendance_record', v_id::text,
            jsonb_build_object('kind', p_kind, 'on_premise', p_on_premise));
  return jsonb_build_object('attendance_id', v_id, 'on_premise', p_on_premise);
end; $$;

-- ============================================================================
-- D) submit_approval_request — GENERIC. Opens a pending approval thread for any
-- (request_type, subject_id). Any org member may submit. Reused by M6.
-- ============================================================================
create or replace function public.submit_approval_request(
  p_org uuid, p_request_type text, p_subject_id uuid, p_required_approvals int default 1,
  p_requested_by_user uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if coalesce(btrim(p_request_type),'') = '' then raise exception 'bad_request_type' using errcode='22023'; end if;
  -- NOTE: required_approvals >= 1 is enforced by the table CHECK; a bad value
  -- raises HERE (mid-tx) so a wrapping caller's earlier writes roll back atomically.
  insert into public.approval_requests(org_id, request_type, subject_id, required_approvals, requested_by_user)
    values (p_org, btrim(p_request_type), p_subject_id, p_required_approvals, coalesce(p_requested_by_user, auth.uid()))
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'workforce.approval_submit', 'completed', coalesce(p_actor_id, auth.uid()), 'approval_request', v_id::text,
            jsonb_build_object('request_type', p_request_type, 'subject_id', p_subject_id, 'required_approvals', p_required_approvals));
  return jsonb_build_object('approval_request_id', v_id);
end; $$;

-- ============================================================================
-- D) decide_approval — GENERIC. approve/reject a pending request (approver:
-- approval.decide). Anti-self-approval; distinct per-approver decision; advances
-- through tiers (approvals_count → required_approvals ⇒ approved); reject is
-- terminal. Guarded: only from 'pending'.
-- ============================================================================
create or replace function public.decide_approval(
  p_org uuid, p_request_id uuid, p_decision text, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_req int; v_cnt int; v_requester uuid; v_decider uuid; v_new_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'approval.decide') then raise exception 'forbidden' using errcode='42501', detail='approval.decide required'; end if;
  if p_decision not in ('approve','reject') then raise exception 'bad_decision' using errcode='22023'; end if;
  select status, required_approvals, approvals_count, requested_by_user
    into v_status, v_req, v_cnt, v_requester
    from public.approval_requests where id = p_request_id and org_id = p_org for update;
  if v_status is null then raise exception 'approval_not_found' using errcode='P0002'; end if;
  if v_status <> 'pending' then raise exception 'not_pending' using errcode='22023', detail=v_status; end if;

  v_decider := coalesce(auth.uid(), p_actor_id);
  if v_decider is not null and v_requester is not null and v_decider = v_requester then
    raise exception 'self_approval' using errcode='22023', detail='approver cannot decide their own request';
  end if;

  begin
    insert into public.approval_decisions(org_id, approval_request_id, decided_by_user, decision)
      values (p_org, p_request_id, v_decider, p_decision);
  exception when unique_violation then
    raise exception 'already_decided' using errcode='23505', detail='this approver already decided';
  end;

  if p_decision = 'reject' then
    v_new_status := 'rejected';
    update public.approval_requests set status = 'rejected', updated_at = now() where id = p_request_id and org_id = p_org;
  else
    v_cnt := v_cnt + 1;
    v_new_status := case when v_cnt >= v_req then 'approved' else 'pending' end;
    update public.approval_requests set approvals_count = v_cnt, status = v_new_status, updated_at = now() where id = p_request_id and org_id = p_org;
  end if;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'workforce.approval_decide', 'completed', coalesce(p_actor_id, auth.uid()), 'approval_request', p_request_id::text,
            jsonb_build_object('decision', p_decision, 'status', v_new_status, 'approvals', v_cnt, 'required', v_req));
  return jsonb_build_object('approval_request_id', p_request_id, 'status', v_new_status, 'approvals_count', v_cnt, 'required_approvals', v_req);
end; $$;

-- ============================================================================
-- C) request_leave — creates the leave + opens its approval thread (request_type
-- ='leave'). Two writes, ONE tx: a bad required_approvals fails in
-- submit_approval_request mid-tx ⇒ the leave insert rolls back (atomicity).
-- (any org member may request.)
-- ============================================================================
create or replace function public.request_leave(
  p_org uuid, p_staff_id uuid, p_leave_type text, p_start date, p_end date, p_reason text default null,
  p_required_approvals int default 1, p_requested_by_user uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_leave uuid; v_appr uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_end < p_start then raise exception 'bad_dates' using errcode='22023', detail='end before start'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id and org_id = p_org) then raise exception 'staff_not_found' using errcode='P0002'; end if;

  insert into public.leave_requests(org_id, staff_id, leave_type, start_date, end_date, reason)
    values (p_org, p_staff_id, coalesce(btrim(p_leave_type),'casual'), p_start, p_end, p_reason) returning id into v_leave;

  -- consume the GENERIC primitive (polymorphic: request_type='leave', subject=leave id)
  v_appr := (public.submit_approval_request(p_org, 'leave', v_leave, p_required_approvals, coalesce(p_requested_by_user, auth.uid()), p_actor_id) ->> 'approval_request_id')::uuid;
  update public.leave_requests set approval_request_id = v_appr, updated_at = now() where id = v_leave and org_id = p_org;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'workforce.leave_request', 'completed', coalesce(p_actor_id, auth.uid()), 'leave_request', v_leave::text,
            jsonb_build_object('approval_request_id', v_appr, 'start', p_start, 'end', p_end));
  return jsonb_build_object('leave_id', v_leave, 'approval_request_id', v_appr);
end; $$;

-- ============================================================================
-- C) decide_leave — approve/reject a leave via the generic primitive, then sync
-- the leave's own status when the approval reaches a terminal state. Guarded at
-- the leave level too (only a pending leave). (approver: approval.decide.)
-- ============================================================================
create or replace function public.decide_leave(
  p_org uuid, p_leave_id uuid, p_decision text, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_appr uuid; v_res jsonb; v_new text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  -- decide_approval re-checks approval.decide; check here too for a clean error
  if auth.uid() is not null and not public.has_capability(p_org, 'approval.decide') then raise exception 'forbidden' using errcode='42501', detail='approval.decide required'; end if;
  select status, approval_request_id into v_status, v_appr from public.leave_requests where id = p_leave_id and org_id = p_org for update;
  if v_status is null then raise exception 'leave_not_found' using errcode='P0002'; end if;
  if v_status <> 'pending' then raise exception 'not_pending' using errcode='22023', detail=v_status; end if;
  if v_appr is null then raise exception 'no_approval_thread' using errcode='P0002'; end if;

  v_res := public.decide_approval(p_org, v_appr, p_decision, p_actor_id);
  v_new := v_res ->> 'status';
  if v_new in ('approved','rejected') then
    update public.leave_requests set status = v_new, updated_at = now() where id = p_leave_id and org_id = p_org;
  end if;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'workforce.leave_decide', 'completed', coalesce(p_actor_id, auth.uid()), 'leave_request', p_leave_id::text,
            jsonb_build_object('decision', p_decision, 'leave_status', coalesce(v_new,'pending')));
  return jsonb_build_object('leave_id', p_leave_id, 'status', coalesce(v_new, v_status), 'approval', v_res);
end; $$;

-- ── grants (RPC is the only write path; revoke from public, grant to the app) ─
do $$
declare fn text;
begin
  foreach fn in array array[
    'set_hr_fields(uuid,uuid,text,date,text,text,text,uuid)',
    'set_geofence(uuid,numeric,numeric,numeric,uuid)',
    'record_attendance(uuid,uuid,text,boolean,uuid,uuid)',
    'submit_approval_request(uuid,text,uuid,int,uuid,uuid)',
    'decide_approval(uuid,uuid,text,uuid)',
    'request_leave(uuid,uuid,text,date,date,text,int,uuid,uuid)',
    'decide_leave(uuid,uuid,text,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
