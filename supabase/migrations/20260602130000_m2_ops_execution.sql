-- ============================================================================
-- M2 — OPS EXECUTION: tasks · incidents · checklist-TEMPLATE engine
-- ----------------------------------------------------------------------------
-- Benchmarked vs Quore / Amadeus HotSOS (work-orders + incident tracking) and
-- Xenia (SOP checklist templates). Three pieces on the shared spine:
--
--  A) TASKS — a generic assignable work item: create → assign (W0 staff) →
--     guarded status lifecycle (open→in_progress→done, +cancelled), priority,
--     optional due_date. Optionally linked to ANY spine object via a POLYMORPHIC
--     reference (entity_type + entity_id) — same discipline as the M1b approval
--     primitive's (request_type, subject_id): no FK soup, both-or-neither.
--
--  B) INCIDENTS — a DISTINCT reported-problem lifecycle (report→in_progress→
--     resolved, +cancelled) with severity, assignable to W0 staff, same
--     polymorphic link. Generalizes the proven S3 maintenance_requests shape.
--     Tasks (assigned work) and incidents (reported problems) are separate
--     domains — separate tables + RPCs — not collapsed.
--
--  C) CHECKLIST-TEMPLATE ENGINE — THE REUSE SEAM. Execution + photo-proof are
--     ALREADY DONE (W2 event_checklists / event_checklist_items; KL-3 Storage).
--     M2 adds ONLY the template layer (checklist_templates + _items) and a
--     generate RPC that emits a W2-style execution checklist INTO THE EXISTING
--     event_checklists/event_checklist_items tables — it does NOT create a new
--     execution table, does NOT re-implement item completion, and does NOT
--     re-implement photo-proof. Completion stays on the UNCHANGED W2
--     `complete_checklist_item` (KL-3 storage flow intact). The only touch to the
--     execution tables is a nullable provenance column event_checklists.template_id
--     ("generated from template X").
--
-- Every write atomic + audited + tenant-scoped (RLS default-deny + auth.uid()
-- self-auth). Capability `ops.manage` gates create/assign/resolve/template work;
-- reporting an incident is open to any member (anyone can flag a problem).
-- ============================================================================

-- ── A) tasks — generic assignable work item + polymorphic entity link ────────
create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  title             text not null,
  description       text,
  assigned_staff_id uuid references public.staff(id) on delete set null,
  priority          text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  due_date          date,
  status            text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  entity_type       text,                                  -- POLYMORPHIC link (no FK): 'event'|'room'|'room_stay'|'booking'
  entity_id         uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_task_entity check ((entity_type is null) = (entity_id is null))
);
create index if not exists idx_tasks_org_status on public.tasks (org_id, status);
create index if not exists idx_tasks_assignee on public.tasks (assigned_staff_id);
create index if not exists idx_tasks_entity on public.tasks (entity_type, entity_id);

-- ── B) incidents — reported-problem lifecycle (distinct from tasks) ──────────
create table if not exists public.incidents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  title             text not null,
  description       text,
  severity          text not null default 'medium' check (severity in ('low','medium','high','critical')),
  status            text not null default 'reported' check (status in ('reported','in_progress','resolved','cancelled')),
  reported_by       uuid,
  assigned_staff_id uuid references public.staff(id) on delete set null,
  entity_type       text,                                  -- POLYMORPHIC link (no FK)
  entity_id         uuid,
  resolution        text,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_incident_entity check ((entity_type is null) = (entity_id is null))
);
create index if not exists idx_incidents_org_status on public.incidents (org_id, status);
create index if not exists idx_incidents_assignee on public.incidents (assigned_staff_id);

-- ── C) checklist_templates + _items — the TEMPLATE layer only ────────────────
create table if not exists public.checklist_templates (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null,
  kind       text not null default 'event' check (kind in ('event','daily','room')),  -- library categorization
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_checklist_templates_org_name on public.checklist_templates (org_id, lower(btrim(name)));

create table if not exists public.checklist_template_items (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  template_id    uuid not null references public.checklist_templates(id) on delete cascade,
  label          text not null,
  requires_photo boolean not null default false,
  sort           int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_checklist_template_items_tpl on public.checklist_template_items (template_id);

-- ── C) THE REUSE SEAM: provenance ONLY on the existing W2 execution table ────
-- (no new execution table; generation writes into event_checklists/_items.)
alter table public.event_checklists add column if not exists template_id uuid references public.checklist_templates(id) on delete set null;

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['tasks','incidents','checklist_templates','checklist_template_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ── shared helper: validate a polymorphic spine link exists in the org ───────
create or replace function public.pn_entity_exists(p_org uuid, p_entity_type text, p_entity_id uuid)
  returns boolean language plpgsql security definer stable set search_path = public as $$
begin
  if p_entity_type is null and p_entity_id is null then return true; end if;
  if p_entity_type is null or p_entity_id is null then return false; end if;
  return case p_entity_type
    when 'event'     then exists (select 1 from public.events     where id = p_entity_id and org_id = p_org)
    when 'room'      then exists (select 1 from public.rooms      where id = p_entity_id and org_id = p_org)
    when 'room_stay' then exists (select 1 from public.room_stays where id = p_entity_id and org_id = p_org)
    when 'booking'   then exists (select 1 from public.bookings   where id = p_entity_id and org_id = p_org)
    else null  -- unknown type
  end;
end; $$;

-- ============================================================================
-- A) create_task / assign_task / set_task_status (ops.manage).
-- ============================================================================
create or replace function public.create_task(
  p_org uuid, p_title text, p_description text default null, p_priority text default 'medium',
  p_due_date date default null, p_assigned_staff_id uuid default null,
  p_entity_type text default null, p_entity_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok boolean;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'ops.manage') then raise exception 'forbidden' using errcode='42501', detail='ops.manage required'; end if;
  if coalesce(btrim(p_title),'') = '' then raise exception 'bad_title' using errcode='22023'; end if;
  if p_priority not in ('low','medium','high','urgent') then raise exception 'bad_priority' using errcode='22023'; end if;
  if p_assigned_staff_id is not null and not exists (select 1 from public.staff where id = p_assigned_staff_id and org_id = p_org) then raise exception 'staff_not_found' using errcode='P0002'; end if;
  v_ok := public.pn_entity_exists(p_org, p_entity_type, p_entity_id);
  if v_ok is null then raise exception 'bad_entity_type' using errcode='22023'; end if;
  if not v_ok then raise exception 'entity_not_found' using errcode='P0002', detail='polymorphic link target does not exist'; end if;

  insert into public.tasks(org_id, title, description, assigned_staff_id, priority, due_date, entity_type, entity_id)
    values (p_org, btrim(p_title), p_description, p_assigned_staff_id, p_priority, p_due_date, p_entity_type, p_entity_id)
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'ops.task_create', 'completed', coalesce(p_actor_id, auth.uid()), 'task', v_id::text,
            jsonb_build_object('priority', p_priority, 'linked_type', p_entity_type));
  return jsonb_build_object('task_id', v_id);
end; $$;

create or replace function public.assign_task(p_org uuid, p_task_id uuid, p_staff_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'ops.manage') then raise exception 'forbidden' using errcode='42501', detail='ops.manage required'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id and org_id = p_org) then raise exception 'staff_not_found' using errcode='P0002'; end if;
  update public.tasks set assigned_staff_id = p_staff_id, updated_at = now() where id = p_task_id and org_id = p_org;
  if not found then raise exception 'task_not_found' using errcode='P0002'; end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'ops.task_assign', 'completed', coalesce(p_actor_id, auth.uid()), 'task', p_task_id::text);
  return jsonb_build_object('task_id', p_task_id, 'assigned_staff_id', p_staff_id);
end; $$;

create or replace function public.set_task_status(p_org uuid, p_task_id uuid, p_status text, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_current text; v_allowed text[];
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'ops.manage') then raise exception 'forbidden' using errcode='42501', detail='ops.manage required'; end if;
  if p_status not in ('open','in_progress','done','cancelled') then raise exception 'bad_status' using errcode='22023'; end if;
  select status into v_current from public.tasks where id = p_task_id and org_id = p_org for update;
  if v_current is null then raise exception 'task_not_found' using errcode='P0002'; end if;
  v_allowed := case v_current
    when 'open'        then array['in_progress','cancelled']
    when 'in_progress' then array['done','cancelled']
    else array[]::text[]
  end;
  if not (p_status = any(v_allowed)) then raise exception 'illegal_transition' using errcode='22023', detail = format('%s → %s', v_current, p_status); end if;
  update public.tasks set status = p_status, updated_at = now() where id = p_task_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'ops.task_status', 'completed', coalesce(p_actor_id, auth.uid()), 'task', p_task_id::text, jsonb_build_object('from', v_current, 'to', p_status));
  return jsonb_build_object('task_id', p_task_id, 'from', v_current, 'to', p_status);
end; $$;

-- ============================================================================
-- B) report_incident (any member) / set_incident_status (ops.manage).
-- ============================================================================
create or replace function public.report_incident(
  p_org uuid, p_title text, p_description text default null, p_severity text default 'medium',
  p_entity_type text default null, p_entity_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok boolean;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;  -- reporting open to any member
  if coalesce(btrim(p_title),'') = '' then raise exception 'bad_title' using errcode='22023'; end if;
  if p_severity not in ('low','medium','high','critical') then raise exception 'bad_severity' using errcode='22023'; end if;
  v_ok := public.pn_entity_exists(p_org, p_entity_type, p_entity_id);
  if v_ok is null then raise exception 'bad_entity_type' using errcode='22023'; end if;
  if not v_ok then raise exception 'entity_not_found' using errcode='P0002'; end if;
  insert into public.incidents(org_id, title, description, severity, reported_by, entity_type, entity_id)
    values (p_org, btrim(p_title), p_description, p_severity, coalesce(p_actor_id, auth.uid()), p_entity_type, p_entity_id)
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'ops.incident_report', 'completed', coalesce(p_actor_id, auth.uid()), 'incident', v_id::text, jsonb_build_object('severity', p_severity));
  return jsonb_build_object('incident_id', v_id);
end; $$;

create or replace function public.set_incident_status(
  p_org uuid, p_incident_id uuid, p_status text, p_assigned_staff_id uuid default null,
  p_resolution text default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_current text; v_allowed text[];
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'ops.manage') then raise exception 'forbidden' using errcode='42501', detail='ops.manage required'; end if;
  if p_status not in ('reported','in_progress','resolved','cancelled') then raise exception 'bad_status' using errcode='22023'; end if;
  if p_assigned_staff_id is not null and not exists (select 1 from public.staff where id = p_assigned_staff_id and org_id = p_org) then raise exception 'staff_not_found' using errcode='P0002'; end if;
  select status into v_current from public.incidents where id = p_incident_id and org_id = p_org for update;
  if v_current is null then raise exception 'incident_not_found' using errcode='P0002'; end if;
  v_allowed := case v_current
    when 'reported'    then array['in_progress','cancelled']
    when 'in_progress' then array['resolved','cancelled']
    else array[]::text[]
  end;
  if not (p_status = any(v_allowed)) then raise exception 'illegal_transition' using errcode='22023', detail = format('%s → %s', v_current, p_status); end if;
  update public.incidents set
      status = p_status,
      assigned_staff_id = coalesce(p_assigned_staff_id, assigned_staff_id),
      resolution = case when p_status = 'resolved' then p_resolution else resolution end,
      resolved_at = case when p_status = 'resolved' then now() else resolved_at end,
      updated_at = now()
    where id = p_incident_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'ops.incident_status', 'completed', coalesce(p_actor_id, auth.uid()), 'incident', p_incident_id::text, jsonb_build_object('from', v_current, 'to', p_status));
  return jsonb_build_object('incident_id', p_incident_id, 'from', v_current, 'to', p_status);
end; $$;

-- ============================================================================
-- C) upsert_checklist_template — manage the template + its items (ops.manage).
-- On UPDATE: delete-then-reinsert items in ONE tx → a bad item rolls back the
-- delete (atomicity vehicle). Returns template_id + item count.
-- ============================================================================
create or replace function public.upsert_checklist_template(
  p_org uuid, p_name text, p_kind text default 'event', p_items jsonb default '[]',
  p_template_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; r record; v_sort int := 0; v_n int := 0;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'ops.manage') then raise exception 'forbidden' using errcode='42501', detail='ops.manage required'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'bad_name' using errcode='22023'; end if;
  if p_kind not in ('event','daily','room') then raise exception 'bad_kind' using errcode='22023'; end if;

  if p_template_id is null then
    insert into public.checklist_templates(org_id, name, kind) values (p_org, btrim(p_name), p_kind) returning id into v_id;
  else
    update public.checklist_templates set name = btrim(p_name), kind = p_kind, updated_at = now()
      where id = p_template_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'template_not_found' using errcode='P0002'; end if;
    delete from public.checklist_template_items where template_id = v_id and org_id = p_org;  -- write 1
  end if;

  for r in select * from jsonb_to_recordset(coalesce(p_items,'[]')) as x(label text, requires_photo boolean) loop
    -- label NOT NULL on the table → a null-label item raises here (mid-tx) and rolls back the delete above
    insert into public.checklist_template_items(org_id, template_id, label, requires_photo, sort)
      values (p_org, v_id, r.label, coalesce(r.requires_photo, false), v_sort);                -- write 2..
    v_sort := v_sort + 1; v_n := v_n + 1;
  end loop;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'ops.checklist_template_upsert', 'completed', coalesce(p_actor_id, auth.uid()), 'checklist_template', v_id::text, jsonb_build_object('items', v_n));
  return jsonb_build_object('template_id', v_id, 'items', v_n);
end; $$;

-- ============================================================================
-- C) generate_checklist_from_template — THE REUSE SEAM. Emits a W2 execution
-- checklist INTO the EXISTING event_checklists / event_checklist_items tables,
-- tagged with template_id provenance. Completion + photo-proof reuse the
-- UNCHANGED W2 complete_checklist_item (KL-3 storage). No new execution table.
-- (ops.manage.)
-- ============================================================================
create or replace function public.generate_checklist_from_template(
  p_org uuid, p_template_id uuid, p_event_id uuid, p_title text default null,
  p_assigned_staff_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tpl record; v_checklist uuid; r record; v_n int := 0;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'ops.manage') then raise exception 'forbidden' using errcode='42501', detail='ops.manage required'; end if;
  select * into v_tpl from public.checklist_templates where id = p_template_id and org_id = p_org;
  if v_tpl.id is null then raise exception 'template_not_found' using errcode='P0002'; end if;
  if not exists (select 1 from public.events where id = p_event_id and org_id = p_org) then raise exception 'event_not_found' using errcode='P0002'; end if;
  if p_assigned_staff_id is not null and not exists (select 1 from public.staff where id = p_assigned_staff_id and org_id = p_org) then raise exception 'staff_not_found' using errcode='P0002'; end if;

  -- INTO the EXISTING W2 execution table (provenance: template_id)
  insert into public.event_checklists(org_id, event_id, title, assigned_staff_id, template_id)
    values (p_org, p_event_id, coalesce(p_title, v_tpl.name), p_assigned_staff_id, p_template_id)
    returning id into v_checklist;
  -- INTO the EXISTING W2 execution items table (requires_photo carried through)
  for r in select label, requires_photo, sort from public.checklist_template_items where template_id = p_template_id and org_id = p_org order by sort loop
    insert into public.event_checklist_items(org_id, checklist_id, label, requires_photo, sort)
      values (p_org, v_checklist, r.label, r.requires_photo, r.sort);
    v_n := v_n + 1;
  end loop;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'ops.checklist_generate', 'completed', coalesce(p_actor_id, auth.uid()), 'event_checklist', v_checklist::text,
            jsonb_build_object('template_id', p_template_id, 'event_id', p_event_id, 'items', v_n));
  return jsonb_build_object('checklist_id', v_checklist, 'items', v_n, 'template_id', p_template_id);
end; $$;

-- ── grants (RPC is the only write path; revoke from public, grant to the app) ─
do $$
declare fn text;
begin
  foreach fn in array array[
    'pn_entity_exists(uuid,text,uuid)',
    'create_task(uuid,text,text,text,date,uuid,text,uuid,uuid)',
    'assign_task(uuid,uuid,uuid,uuid)',
    'set_task_status(uuid,uuid,text,uuid)',
    'report_incident(uuid,text,text,text,text,uuid,uuid)',
    'set_incident_status(uuid,uuid,text,uuid,text,uuid)',
    'upsert_checklist_template(uuid,text,text,jsonb,uuid,uuid)',
    'generate_checklist_from_template(uuid,uuid,uuid,text,uuid,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
