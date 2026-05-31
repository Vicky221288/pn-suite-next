-- ============================================================================
-- W2 — HALL COMPLETION (the named gaps; the spine already does the lifecycle)
-- ----------------------------------------------------------------------------
-- Six pieces, in dependency order: (1) contracts/e-sign, (2) payment milestones,
-- (3) resource scheduling/roster, (4) execution checklists w/ photo-proof,
-- (5) vendor coordination, (6) revenue analytics.
-- REUSE (flagged): contracts reuse the W1c e-sign lifecycle; milestone reminders
-- reuse B4 A5 run_rent_reminders (NOT rebuilt — only the records + due dates);
-- roster reuses W0 staff; vendors reuse the W1d vendors table; analytics reads
-- the W0 finance_ledger (hall stream). Atomic + audited + tenant-scoped.
-- ============================================================================

-- ── (1) hall_contracts — REUSE W1c e-sign shape. DIVERGENCE vs BEO: keyed to a
--    booking (not event/beo_type); adds terms + clauses + a contract_value snap. ─
create table if not exists public.hall_contracts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  booking_id     uuid not null references public.bookings(id) on delete cascade,
  version        int  not null default 1 check (version >= 1),
  status         text not null default 'draft' check (status in ('draft','sent','signed','superseded')),
  contract_value numeric(12,2) not null default 0,          -- hall_rent snapshot at generation
  terms          text,
  clauses        jsonb not null default '[]',
  signed_by_name text,
  signed_at      timestamptz,
  signed_method  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint uq_hall_contract_version unique (booking_id, version)
);
create index if not exists idx_hall_contracts_booking on public.hall_contracts (booking_id);

-- ── (2) payment_milestones — the locked schedule (advance@confirm; balance T-45) ─
create table if not exists public.payment_milestones (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  kind        text not null check (kind in ('advance','balance')),
  label       text,
  amount      numeric(12,2) not null check (amount >= 0),
  due_date    date,
  status      text not null default 'due' check (status in ('due','paid','overdue','waived')),
  paid_amount numeric(12,2),
  paid_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_milestone_kind unique (booking_id, kind)
);
create index if not exists idx_milestones_booking on public.payment_milestones (booking_id);

-- ── (3) event_staff — event-day roster (REUSE W0 staff). Slot double-booking is
--    already prevented by the B1 date_block GiST guard; this is the human roster. ─
create table if not exists public.event_staff (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  event_id      uuid not null references public.events(id) on delete cascade,
  staff_id      uuid not null references public.staff(id) on delete cascade,
  role_on_event text,
  status        text not null default 'assigned' check (status in ('assigned','confirmed','checked_in','no_show')),
  created_at    timestamptz not null default now(),
  constraint uq_event_staff unique (event_id, staff_id)
);
create index if not exists idx_event_staff_event on public.event_staff (event_id);

-- ── (4) execution checklists w/ photo-proof (the accountability moat) ─────────
create table if not exists public.event_checklists (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  event_id          uuid not null references public.events(id) on delete cascade,
  title             text not null,
  assigned_staff_id uuid references public.staff(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists idx_checklists_event on public.event_checklists (event_id);

create table if not exists public.event_checklist_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  checklist_id  uuid not null references public.event_checklists(id) on delete cascade,
  label         text not null,
  requires_photo boolean not null default false,
  done          boolean not null default false,
  photo_ref     text,                                  -- path/URL; binary upload to Storage deferred (no bucket wired)
  completed_by  uuid,
  completed_at  timestamptz,
  sort          int not null default 0
);
create index if not exists idx_checklist_items_list on public.event_checklist_items (checklist_id);

-- ── (5) event_vendors — link W1d vendors to a hall event ─────────────────────
create table if not exists public.event_vendors (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  event_id          uuid not null references public.events(id) on delete cascade,
  vendor_id         uuid not null references public.vendors(id) on delete restrict,
  service_type      text not null,                     -- decor / dj / photography / ...
  amount            numeric(12,2) not null default 0,
  commission_amount numeric(12,2) not null default 0,  -- our commission on the vendor (legacy donor)
  status            text not null default 'proposed' check (status in ('proposed','confirmed','paid')),
  notes             text,
  created_at        timestamptz not null default now(),
  constraint uq_event_vendor unique (event_id, vendor_id, service_type)
);
create index if not exists idx_event_vendors_event on public.event_vendors (event_id);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['hall_contracts','payment_milestones','event_staff','event_checklists','event_checklist_items','event_vendors'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ============================================================================
-- (1) CONTRACTS — generate / send / sign (REUSE the W1c e-sign lifecycle).
-- Signed contract is immutable; a change supersedes it with a new version.
-- ============================================================================
create or replace function public.generate_contract(p_org uuid, p_booking_id uuid, p_terms text default null, p_clauses jsonb default '[]', p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.bookings%rowtype; v_latest public.hall_contracts%rowtype; v_version int; v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_b from public.bookings where id = p_booking_id and org_id = p_org;
  if not found then raise exception 'booking_not_found' using errcode='P0002'; end if;
  if v_b.status not in ('confirmed','completed','settled') then raise exception 'booking_not_confirmed' using errcode='22023', detail=v_b.status; end if;

  select * into v_latest from public.hall_contracts where booking_id = p_booking_id order by version desc limit 1;
  if found and v_latest.status in ('draft','sent') then
    return jsonb_build_object('contract_id', v_latest.id, 'version', v_latest.version, 'status', v_latest.status, 'idempotent', true);
  end if;
  if found and v_latest.status = 'signed' then
    update public.hall_contracts set status = 'superseded', updated_at = now() where id = v_latest.id;  -- change → new version
  end if;
  v_version := coalesce(v_latest.version, 0) + 1;

  insert into public.hall_contracts(org_id, booking_id, version, status, contract_value, terms, clauses)
    values (p_org, p_booking_id, v_version, 'draft', v_b.hall_rent, p_terms, coalesce(p_clauses,'[]'))
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'hall.contract_generate', 'completed', coalesce(p_actor_id, auth.uid()), 'hall_contract', v_id::text,
            jsonb_build_object('booking_id', p_booking_id, 'version', v_version, 'value', v_b.hall_rent));
  return jsonb_build_object('contract_id', v_id, 'version', v_version, 'status', 'draft', 'idempotent', false);
end; $$;

create or replace function public.send_contract(p_org uuid, p_contract_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select status into v_status from public.hall_contracts where id = p_contract_id and org_id = p_org;
  if v_status is null then raise exception 'contract_not_found' using errcode='P0002'; end if;
  if v_status <> 'draft' then raise exception 'contract_not_draft' using errcode='22023', detail=v_status; end if;
  update public.hall_contracts set status = 'sent', updated_at = now() where id = p_contract_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'hall.contract_send', 'completed', coalesce(p_actor_id, auth.uid()), 'hall_contract', p_contract_id::text);
  return jsonb_build_object('contract_id', p_contract_id, 'status', 'sent');
end; $$;

create or replace function public.sign_contract(p_org uuid, p_contract_id uuid, p_signed_by_name text, p_signed_method text default 'click', p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_signed_by_name is null or btrim(p_signed_by_name) = '' then raise exception 'signature_required' using errcode='22023'; end if;
  select status into v_status from public.hall_contracts where id = p_contract_id and org_id = p_org;
  if v_status is null then raise exception 'contract_not_found' using errcode='P0002'; end if;
  if v_status = 'signed' then raise exception 'already_signed' using errcode='22023'; end if;
  if v_status <> 'sent' then raise exception 'contract_not_sent' using errcode='22023', detail=v_status; end if;
  update public.hall_contracts set status = 'signed', signed_by_name = btrim(p_signed_by_name), signed_at = now(), signed_method = p_signed_method, updated_at = now()
    where id = p_contract_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'hall.contract_sign', 'completed', coalesce(p_actor_id, auth.uid()), 'hall_contract', p_contract_id::text,
            jsonb_build_object('signed_by', btrim(p_signed_by_name)));
  return jsonb_build_object('contract_id', p_contract_id, 'status', 'signed');
end; $$;

create or replace function public.update_contract_terms(p_org uuid, p_contract_id uuid, p_terms text default null, p_clauses jsonb default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select status into v_status from public.hall_contracts where id = p_contract_id and org_id = p_org;
  if v_status is null then raise exception 'contract_not_found' using errcode='P0002'; end if;
  if v_status in ('signed','superseded') then raise exception 'contract_immutable' using errcode='22023', detail='signed contracts are immutable — generate a new version'; end if;
  update public.hall_contracts set terms = coalesce(p_terms, terms), clauses = coalesce(p_clauses, clauses), updated_at = now()
    where id = p_contract_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'hall.contract_update', 'completed', coalesce(p_actor_id, auth.uid()), 'hall_contract', p_contract_id::text);
  return jsonb_build_object('contract_id', p_contract_id, 'ok', true);
end; $$;

-- ============================================================================
-- (2) PAYMENT MILESTONES — the locked schedule. Reminders are A5's job (B4);
-- this records the financial milestones + due dates + paid/overdue state.
-- ============================================================================
create or replace function public.set_payment_schedule(p_org uuid, p_booking_id uuid, p_advance_amount numeric, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_b public.bookings%rowtype; v_balance numeric(12,2); v_balance_due date;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_b from public.bookings where id = p_booking_id and org_id = p_org;
  if not found then raise exception 'booking_not_found' using errcode='P0002'; end if;
  if p_advance_amount < 0 or p_advance_amount > v_b.hall_rent then raise exception 'bad_advance' using errcode='22023'; end if;

  v_balance := v_b.hall_rent - p_advance_amount;
  v_balance_due := v_b.event_date - 45;                 -- §12 #9: full hall rent due T-45
  insert into public.payment_milestones(org_id, booking_id, kind, label, amount, due_date, status)
    values (p_org, p_booking_id, 'advance', 'Advance / deposit at confirm', p_advance_amount,
            coalesce(v_b.confirmed_at::date, (now() at time zone 'Asia/Kolkata')::date), 'due')
    on conflict (booking_id, kind) do update set amount = excluded.amount, due_date = excluded.due_date, updated_at = now();
  insert into public.payment_milestones(org_id, booking_id, kind, label, amount, due_date, status)
    values (p_org, p_booking_id, 'balance', 'Balance hall rent (T-45)', v_balance, v_balance_due, 'due')
    on conflict (booking_id, kind) do update set amount = excluded.amount, due_date = excluded.due_date, updated_at = now();
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'hall.payment_schedule', 'completed', coalesce(p_actor_id, auth.uid()), 'booking', p_booking_id::text,
            jsonb_build_object('advance', p_advance_amount, 'balance', v_balance, 'balance_due', v_balance_due));
  return jsonb_build_object('booking_id', p_booking_id, 'advance', p_advance_amount, 'balance', v_balance, 'balance_due', v_balance_due);
end; $$;

create or replace function public.mark_milestone_paid(p_org uuid, p_milestone_id uuid, p_amount numeric default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m public.payment_milestones%rowtype;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_m from public.payment_milestones where id = p_milestone_id and org_id = p_org;
  if not found then raise exception 'milestone_not_found' using errcode='P0002'; end if;
  if v_m.status = 'paid' then return jsonb_build_object('milestone_id', p_milestone_id, 'status', 'paid', 'idempotent', true); end if;
  update public.payment_milestones set status = 'paid', paid_amount = coalesce(p_amount, v_m.amount), paid_at = now(), updated_at = now()
    where id = p_milestone_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'hall.milestone_paid', 'completed', coalesce(p_actor_id, auth.uid()), 'payment_milestone', p_milestone_id::text,
            jsonb_build_object('kind', v_m.kind, 'amount', coalesce(p_amount, v_m.amount)));
  return jsonb_build_object('milestone_id', p_milestone_id, 'status', 'paid', 'idempotent', false);
end; $$;

-- flag overdue milestones (due_date < today, still due). A cron/B4 hook later; RPC for now.
create or replace function public.refresh_milestone_overdue(p_org uuid, p_now timestamptz default now())
  returns integer language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  update public.payment_milestones set status = 'overdue', updated_at = now()
    where org_id = p_org and status = 'due' and due_date < (p_now at time zone 'Asia/Kolkata')::date;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

-- ============================================================================
-- (3) RESOURCE SCHEDULING — event-day staff roster (REUSE W0 staff).
-- ============================================================================
create or replace function public.assign_event_staff(p_org uuid, p_event_id uuid, p_staff_id uuid, p_role text default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.events where id = p_event_id and org_id = p_org) then raise exception 'event_not_found' using errcode='P0002'; end if;
  if not exists (select 1 from public.staff where id = p_staff_id and org_id = p_org) then raise exception 'staff_not_found' using errcode='P0002'; end if;
  insert into public.event_staff(org_id, event_id, staff_id, role_on_event)
    values (p_org, p_event_id, p_staff_id, p_role)
    on conflict (event_id, staff_id) do update set role_on_event = excluded.role_on_event
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'hall.staff_assign', 'completed', coalesce(p_actor_id, auth.uid()), 'event_staff', v_id::text);
  return jsonb_build_object('event_staff_id', v_id);
end; $$;

create or replace function public.set_event_staff_status(p_org uuid, p_event_staff_id uuid, p_status text, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_status not in ('assigned','confirmed','checked_in','no_show') then raise exception 'bad_status' using errcode='22023'; end if;
  update public.event_staff set status = p_status where id = p_event_staff_id and org_id = p_org;
  if not found then raise exception 'assignment_not_found' using errcode='P0002'; end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'hall.staff_status', 'completed', coalesce(p_actor_id, auth.uid()), 'event_staff', p_event_staff_id::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('event_staff_id', p_event_staff_id, 'status', p_status);
end; $$;

-- ============================================================================
-- (4) EXECUTION CHECKLISTS — assignable, completion tracked, photo-proof.
-- ============================================================================
create or replace function public.create_event_checklist(p_org uuid, p_event_id uuid, p_title text, p_assigned_staff_id uuid default null, p_items jsonb default '[]', p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; r record; v_sort int := 0; v_n int := 0;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.events where id = p_event_id and org_id = p_org) then raise exception 'event_not_found' using errcode='P0002'; end if;
  insert into public.event_checklists(org_id, event_id, title, assigned_staff_id)
    values (p_org, p_event_id, p_title, p_assigned_staff_id) returning id into v_id;
  for r in select * from jsonb_to_recordset(coalesce(p_items,'[]')) as x(label text, requires_photo boolean) loop
    insert into public.event_checklist_items(org_id, checklist_id, label, requires_photo, sort)
      values (p_org, v_id, r.label, coalesce(r.requires_photo, false), v_sort);
    v_sort := v_sort + 1; v_n := v_n + 1;
  end loop;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'hall.checklist_create', 'completed', coalesce(p_actor_id, auth.uid()), 'event_checklist', v_id::text, jsonb_build_object('items', v_n));
  return jsonb_build_object('checklist_id', v_id, 'items', v_n);
end; $$;

create or replace function public.complete_checklist_item(p_org uuid, p_item_id uuid, p_photo_ref text default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_it public.event_checklist_items%rowtype;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_it from public.event_checklist_items where id = p_item_id and org_id = p_org;
  if not found then raise exception 'item_not_found' using errcode='P0002'; end if;
  if v_it.requires_photo and (p_photo_ref is null or btrim(p_photo_ref) = '') then
    raise exception 'photo_required' using errcode='22023', detail='this item requires photo-proof';   -- the accountability moat
  end if;
  update public.event_checklist_items set done = true, photo_ref = p_photo_ref, completed_by = coalesce(p_actor_id, auth.uid()), completed_at = now()
    where id = p_item_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'hall.checklist_complete', 'completed', coalesce(p_actor_id, auth.uid()), 'event_checklist_item', p_item_id::text,
            jsonb_build_object('photo', p_photo_ref is not null));
  return jsonb_build_object('item_id', p_item_id, 'done', true);
end; $$;

-- ============================================================================
-- (5) VENDOR COORDINATION — link W1d vendors to an event.
-- ============================================================================
create or replace function public.assign_event_vendor(p_org uuid, p_event_id uuid, p_vendor_id uuid, p_service_type text,
  p_amount numeric default 0, p_commission numeric default 0, p_notes text default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.events where id = p_event_id and org_id = p_org) then raise exception 'event_not_found' using errcode='P0002'; end if;
  if not exists (select 1 from public.vendors where id = p_vendor_id and org_id = p_org) then raise exception 'vendor_not_found' using errcode='P0002'; end if;
  insert into public.event_vendors(org_id, event_id, vendor_id, service_type, amount, commission_amount, notes)
    values (p_org, p_event_id, p_vendor_id, p_service_type, p_amount, p_commission, p_notes)
    on conflict (event_id, vendor_id, service_type) do update set amount = excluded.amount, commission_amount = excluded.commission_amount, notes = excluded.notes
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'hall.vendor_assign', 'completed', coalesce(p_actor_id, auth.uid()), 'event_vendor', v_id::text, jsonb_build_object('service', p_service_type));
  return jsonb_build_object('event_vendor_id', v_id);
end; $$;

create or replace function public.set_event_vendor_status(p_org uuid, p_event_vendor_id uuid, p_status text, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_status not in ('proposed','confirmed','paid') then raise exception 'bad_status' using errcode='22023'; end if;
  update public.event_vendors set status = p_status where id = p_event_vendor_id and org_id = p_org;
  if not found then raise exception 'event_vendor_not_found' using errcode='P0002'; end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'hall.vendor_status', 'completed', coalesce(p_actor_id, auth.uid()), 'event_vendor', p_event_vendor_id::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('event_vendor_id', p_event_vendor_id, 'status', p_status);
end; $$;

-- ============================================================================
-- (6) REVENUE ANALYTICS (READ, STABLE) — bookings, realized hall revenue (from
-- finance_ledger hall stream), occupancy by slot, pipeline. Revenue figures
-- are margin-gated (pnl.view_margin); counts/occupancy always visible.
-- ============================================================================
create or replace function public.hall_analytics(p_org uuid)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_can boolean; v_status jsonb; v_slot jsonb; v_revenue numeric(14,2); v_pipeline numeric(14,2);
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  v_can := (auth.uid() is null) or public.has_capability(p_org, 'pnl.view_margin');

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_status
    from (select status, count(*) n from public.bookings where org_id = p_org group by status) s;
  select coalesce(jsonb_object_agg(slot, n), '{}'::jsonb) into v_slot
    from (select slot, count(*) n from public.bookings where org_id = p_org and status in ('confirmed','completed','settled') group by slot) s;

  select coalesce(sum(amount),0) into v_revenue from public.finance_ledger
    where org_id = p_org and source_domain = 'hall' and direction = 'credit';
  select coalesce(sum(hall_rent),0) into v_pipeline from public.bookings
    where org_id = p_org and status in ('tentative_hold','confirmed');

  return jsonb_build_object(
    'can_see_revenue', v_can,
    'bookings_by_status', v_status,
    'occupancy_by_slot', v_slot,
    'realized_hall_revenue', case when v_can then v_revenue else null end,
    'pipeline_value',        case when v_can then v_pipeline else null end);
end; $$;

-- grants
do $$
declare fn text;
begin
  foreach fn in array array[
    'generate_contract(uuid,uuid,text,jsonb,uuid)',
    'send_contract(uuid,uuid,uuid)',
    'sign_contract(uuid,uuid,text,text,uuid)',
    'update_contract_terms(uuid,uuid,text,jsonb,uuid)',
    'set_payment_schedule(uuid,uuid,numeric,uuid)',
    'mark_milestone_paid(uuid,uuid,numeric,uuid)',
    'refresh_milestone_overdue(uuid,timestamptz)',
    'assign_event_staff(uuid,uuid,uuid,text,uuid)',
    'set_event_staff_status(uuid,uuid,text,uuid)',
    'create_event_checklist(uuid,uuid,text,uuid,jsonb,uuid)',
    'complete_checklist_item(uuid,uuid,text,uuid)',
    'assign_event_vendor(uuid,uuid,uuid,text,numeric,numeric,text,uuid)',
    'set_event_vendor_status(uuid,uuid,text,uuid)',
    'hall_analytics(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
