-- ============================================================================
-- B2 — MULTI-TENANT SKELETON (OP MODEL §10, §3; fixes AUDIT-2.0 F-SEC-04)
-- ----------------------------------------------------------------------------
-- org_id is already on every B1 table. B2 is the POLICY layer: a tenant root
-- (orgs) + user↔org membership with composable capabilities, tenant-scoped RLS
-- on every table, and an authorization gate so authenticated users can act ONLY
-- within their own org, with the capabilities they hold. No god-role: even the
-- highest role (owner) is scoped to its property — a member of org A has zero
-- power in org B, BY CONSTRUCTION (the F-SEC-04 fix).
-- ============================================================================

-- ── Tenant root + membership ────────────────────────────────────────────────
create table if not exists public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- Roles are composable CAPABILITIES (OP MODEL §3). A membership carries a role
-- label (for display) + the capability set actually enforced. Locked rights
-- (OP MODEL §12): owner = all; property_manager = confirm + margin + discount
-- (NOT delete); managers = operational only (no elevated caps yet).
create table if not exists public.org_members (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  user_id      uuid not null,                 -- auth.users id
  role         text not null,
  capabilities text[] not null default '{}',
  created_at   timestamptz not null default now(),
  constraint uq_org_member unique (org_id, user_id)
);
create index if not exists idx_org_members_user on public.org_members (user_id);
create index if not exists idx_org_members_org  on public.org_members (org_id);

-- ── Membership helper functions (SECURITY DEFINER → read org_members without
--    tripping RLS recursion; STABLE; pinned search_path) ──────────────────────
create or replace function public.is_org_member(p_org uuid)
  returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.org_members
                 where user_id = auth.uid() and org_id = p_org);
$$;

create or replace function public.has_capability(p_org uuid, p_cap text)
  returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.org_members
                 where user_id = auth.uid() and org_id = p_org and p_cap = any(capabilities));
$$;

revoke all on function public.is_org_member(uuid)        from public;
revoke all on function public.has_capability(uuid, text) from public;
grant execute on function public.is_org_member(uuid)        to authenticated, service_role;
grant execute on function public.has_capability(uuid, text) to authenticated, service_role;

-- ── Referential integrity: every B1 row's org_id must be a real org ──────────
-- (Safe: pre-flight confirmed all B1 tables are empty at apply time.)
alter table public.halls          add constraint fk_halls_org          foreign key (org_id) references public.orgs(id) on delete cascade;
alter table public.bookings       add constraint fk_bookings_org       foreign key (org_id) references public.orgs(id) on delete cascade;
alter table public.date_blocks    add constraint fk_date_blocks_org    foreign key (org_id) references public.orgs(id) on delete cascade;
alter table public.deposit_ledger add constraint fk_deposit_ledger_org foreign key (org_id) references public.orgs(id) on delete cascade;
-- audit_log.org_id is left FK-free: it must survive org deletion as a record,
-- and carries null for pre-tenant/system events.

-- ── RLS: orgs + org_members (members read their own; service_role manages) ────
alter table public.orgs        enable row level security;
alter table public.org_members enable row level security;

drop policy if exists orgs_select on public.orgs;
create policy orgs_select on public.orgs
  for select to authenticated using (public.is_org_member(id));
drop policy if exists orgs_service_all on public.orgs;
create policy orgs_service_all on public.orgs
  for all to service_role using (true) with check (true);

-- A member sees their own membership row + co-members in the same org.
drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members
  for select to authenticated using (user_id = auth.uid() or public.is_org_member(org_id));
drop policy if exists org_members_service_all on public.org_members;
create policy org_members_service_all on public.org_members
  for all to service_role using (true) with check (true);

-- ── Tenant-scoped RLS on every B1 table ──────────────────────────────────────
-- Pattern, default-deny: authenticated may SELECT only rows of an org they
-- belong to; NO authenticated direct INSERT/UPDATE/DELETE policy exists, so all
-- writes must go through the SECURITY DEFINER RPC (which self-authorizes).
-- service_role keeps full access (system/automation/admin path).
do $$
declare t text;
begin
  foreach t in array array['halls','bookings','date_blocks','deposit_ledger','audit_log'] loop
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format(
      'create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))',
      t, t);
    -- service_role_all already exists from the B1/B0 migrations; ensure present.
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format(
      'create policy %I_service_all on public.%I for all to service_role using (true) with check (true)',
      t, t);
  end loop;
end $$;

-- ============================================================================
-- confirm_booking — add the AUTHENTICATED authorization gate (F-SEC-04 fix).
-- Same atomic body as B1 (booking → GiST-EXCLUDE block → deposit liability →
-- in-tx audit, all-or-nothing). The ONLY change: when called by an authenticated
-- user (auth.uid() not null), the caller MUST be a member of p_org_id holding
-- 'booking.confirm' — so a member of A can NEVER confirm in B, even via a direct
-- RPC call with a forged p_org_id. The service_role path (auth.uid() null =
-- system/automation/admin gate) is trusted and skips the self-check.
-- ============================================================================
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
  p_force_rollback  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_deposit    numeric(12,2);
  v_range      tstzrange;
  v_existing   public.bookings%rowtype;
  v_audit_id   uuid;
begin
  -- 0. AUTHORIZATION GATE (B2 / F-SEC-04). Authenticated callers must belong to
  --    the target org with the capability. service_role (auth.uid() null) is the
  --    trusted system path.
  if auth.uid() is not null
     and not exists (select 1 from public.org_members
                     where user_id = auth.uid()
                       and org_id  = p_org_id
                       and 'booking.confirm' = any(capabilities)) then
    raise exception 'forbidden' using errcode = '42501',
      detail = 'caller lacks booking.confirm in this org';
  end if;

  -- 1. Idempotency: same key already used → return it, do NOT write again.
  select * into v_existing from public.bookings
    where org_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('booking_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;

  if p_slot not in ('morning','evening','full_day') then
    raise exception 'invalid_slot' using errcode = '22023', detail = p_slot;
  end if;

  -- 2. Slot → IST time range (3h turnaround lives in the 14:00–17:00 gap).
  v_range := case p_slot
    when 'morning'  then tstzrange((p_event_date + time '09:00') at time zone 'Asia/Kolkata',
                                   (p_event_date + time '14:00') at time zone 'Asia/Kolkata', '[)')
    when 'evening'  then tstzrange((p_event_date + time '17:00') at time zone 'Asia/Kolkata',
                                   (p_event_date + time '23:00') at time zone 'Asia/Kolkata', '[)')
    when 'full_day' then tstzrange((p_event_date + time '09:00') at time zone 'Asia/Kolkata',
                                   (p_event_date + time '23:00') at time zone 'Asia/Kolkata', '[)')
  end;

  v_deposit := round(p_hall_rent * 0.5, 2);

  insert into public.bookings(org_id, hall_id, event_date, slot, status, hall_rent,
                              customer_name, idempotency_key, confirmed_at)
    values (p_org_id, p_hall_id, p_event_date, p_slot, 'confirmed', p_hall_rent,
            p_customer_name, p_idempotency_key, now())
    returning id into v_booking_id;

  insert into public.date_blocks(org_id, hall_id, booking_id, block_date, slot, during)
    values (p_org_id, p_hall_id, v_booking_id, p_event_date, p_slot, v_range);

  insert into public.deposit_ledger(org_id, booking_id, amount, entry_type, is_liability, status)
    values (p_org_id, v_booking_id, v_deposit, 'deposit_held', true, 'held');

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type,
                               entity_id, parent_audit_id, meta)
    values (p_org_id, 'booking.confirm', 'completed', coalesce(p_actor_id, auth.uid()), 'booking',
            v_booking_id::text, p_parent_audit_id,
            jsonb_build_object('slot', p_slot, 'event_date', p_event_date,
                               'hall_rent', p_hall_rent, 'deposit', v_deposit))
    returning id into v_audit_id;

  if p_force_rollback then
    raise exception 'forced_rollback_for_test' using errcode = 'P0001';
  end if;

  return jsonb_build_object('booking_id', v_booking_id, 'status', 'confirmed',
                            'deposit', v_deposit, 'audit_id', v_audit_id, 'idempotent', false);

exception
  when exclusion_violation then
    raise exception 'slot_taken' using errcode = '23P01',
      detail = format('hall %s %s %s is already blocked', p_hall_id, p_event_date, p_slot);
  when unique_violation then
    select * into v_existing from public.bookings
      where org_id = p_org_id and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('booking_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
    end if;
    raise;
end;
$$;

-- Now safe to let authenticated users call it — it self-authorizes on auth.uid().
grant execute on function public.confirm_booking(uuid,uuid,date,text,numeric,text,text,uuid,uuid,boolean)
  to authenticated, service_role;
