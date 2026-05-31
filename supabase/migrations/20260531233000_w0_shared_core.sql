-- ============================================================================
-- W0 — MINIMAL SHARED CORE (OP MODEL v2 Part 2; the spine all 3 domains draw from)
-- ----------------------------------------------------------------------------
-- Four shared-core entities every domain (Hall/Stays/Catering) reads + writes:
-- Guest, Inventory, Staff, Finance/Ledger. Each on the proven pattern: atomic
-- wrapper+RPC writes (B1), org-scoped default-deny RLS (B2), loud audit, self-
-- authorize on auth.uid(). Invariants in force: 7 (one Guest many roles),
-- 9 (one Inventory many consumers), 10 (one Ledger many streams). Additive only.
-- ============================================================================

-- ── GUEST — durable identity. Phone is the merge key; NAME disambiguates, so a
--    family sharing one phone stays as distinct active rows (never silently
--    fused). Explicit merge is a separate audited RPC. ────────────────────────
create table if not exists public.guests (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  name           text not null,
  phone          text not null,
  email          text,
  address        text,
  preferences    jsonb  not null default '{}',
  dietary_flags  text[] not null default '{}',
  notes          text,
  status         text   not null default 'active' check (status in ('active','merged')),
  merged_into_id uuid references public.guests(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- dedup key = (org, phone, normalized name) among ACTIVE guests; merged rows
-- don't block re-creation. Same phone + different name → a distinct guest.
create unique index if not exists uq_guests_active_identity
  on public.guests (org_id, phone, lower(btrim(name))) where status = 'active';
create index if not exists idx_guests_org_phone on public.guests (org_id, phone);

-- ── INVENTORY — one stock ledger, many consumers (catering ingredients, room
--    amenities, hall consumables). cost is GROSS of input GST (PN non-specified,
--    5% no-ITC → input GST is a real cost). ───────────────────────────────────
create table if not exists public.inventory_items (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  name             text not null,
  category         text,
  unit             text not null default 'unit',
  quantity_on_hand numeric(14,3) not null default 0,
  reorder_point    numeric(14,3) not null default 0,
  supplier_id      uuid,                 -- FK to vendors added in W1 (Catering); forward-ref
  cost             numeric(12,2) not null default 0 check (cost >= 0),  -- gross of input GST
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint uq_inventory_org_name unique (org_id, name)
);
create index if not exists idx_inventory_org on public.inventory_items (org_id);
create index if not exists idx_inventory_reorder on public.inventory_items (org_id)
  where quantity_on_hand <= reorder_point;

create table if not exists public.inventory_movements (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs(id) on delete cascade,
  item_id            uuid not null references public.inventory_items(id) on delete cascade,
  direction          text not null check (direction in ('in','out','adjust')),
  quantity           numeric(14,3) not null check (quantity >= 0),  -- in/out = delta; adjust = new on-hand
  reason             text,
  linked_entity_type text,
  linked_entity_id   text,
  performed_by       uuid,
  created_at         timestamptz not null default now()
);
create index if not exists idx_movements_item on public.inventory_movements (org_id, item_id, created_at desc);

-- ── STAFF — PROFILE layer (people, schedulable). Does NOT duplicate auth
--    identity: user_id links those who log in to auth.users, and their RLS
--    CAPABILITIES live in org_members (B2 — the source of truth). Temp/event
--    staff have a null user_id (no login). ────────────────────────────────────
create table if not exists public.staff (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,  -- nullable; caps are in org_members
  name       text not null,
  phone      text,
  role       text not null default 'operative',  -- display label; capabilities = org_members
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_staff_org_user unique (org_id, user_id)  -- NULLs distinct → many temp staff OK; one per login
);
create index if not exists idx_staff_org on public.staff (org_id);

-- ── FINANCE / LEDGER — ONE ledger, MANY streams (invariant #10). Every realized
--    money movement (any domain) with a supply-type tag → P&L is a query, not a
--    reconciliation. (Escrowed deposits stay in deposit_ledger per §12 #6; this
--    ledger captures revenue/COGS/commission/expense.) ─────────────────────────
create table if not exists public.finance_ledger (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs(id) on delete cascade,
  entry_date         date not null default (now() at time zone 'Asia/Kolkata')::date,
  supply_type        text not null,         -- config-driven tag: hall_rent/room/catering/commission/expense/...
  amount             numeric(14,2) not null check (amount >= 0),
  direction          text not null check (direction in ('credit','debit')),  -- credit=in/revenue, debit=out/COGS/expense
  source_domain      text not null check (source_domain in ('hall','stays','catering','core')),
  linked_entity_type text,
  linked_entity_id   text,
  description        text,
  created_by         uuid,
  created_at         timestamptz not null default now()
);
create index if not exists idx_ledger_org_date on public.finance_ledger (org_id, entry_date desc);
create index if not exists idx_ledger_org_supply on public.finance_ledger (org_id, supply_type);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['guests','inventory_items','inventory_movements','staff','finance_ledger'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- helper: authenticated callers must be a member of the target org (service_role
-- = system path, auth.uid() null, bypasses). Used by every W0 RPC.
-- (inlined per-RPC below to keep them self-contained / SECURITY DEFINER-safe)

-- ============================================================================
-- find_or_create_guest — dedup by (org, phone, normalized name). Same phone +
-- different name → a NEW guest (family members stay distinct).
-- ============================================================================
create or replace function public.find_or_create_guest(
  p_org uuid, p_phone text, p_name text,
  p_email text default null, p_address text default null, p_notes text default null,
  p_dietary text[] default '{}', p_preferences jsonb default '{}', p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select id into v_id from public.guests
    where org_id = p_org and phone = p_phone and lower(btrim(name)) = lower(btrim(p_name)) and status = 'active';
  if found then return jsonb_build_object('guest_id', v_id, 'created', false); end if;

  insert into public.guests(org_id, name, phone, email, address, notes, dietary_flags, preferences)
    values (p_org, btrim(p_name), p_phone, p_email, p_address, p_notes, coalesce(p_dietary,'{}'), coalesce(p_preferences,'{}'))
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'guest.find_or_create', 'completed', coalesce(p_actor_id, auth.uid()), 'guest', v_id::text,
            jsonb_build_object('created', true, 'phone', p_phone));
  return jsonb_build_object('guest_id', v_id, 'created', true);
exception
  when unique_violation then  -- concurrent create of same (org,phone,name)
    select id into v_id from public.guests
      where org_id = p_org and phone = p_phone and lower(btrim(name)) = lower(btrim(p_name)) and status = 'active';
    return jsonb_build_object('guest_id', v_id, 'created', false);
end; $$;

-- ============================================================================
-- merge_guests — explicitly fuse p_merge into p_keep (when truly the same
-- person). Fills the keeper's null scalar fields, unions dietary flags, marks
-- the merged row, audited. (As domains add guest_id FKs, extend here to re-point
-- them; W0 has no guest references yet.)
-- ============================================================================
create or replace function public.merge_guests(
  p_org uuid, p_keep_id uuid, p_merge_id uuid, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_keep public.guests%rowtype; v_merge public.guests%rowtype;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_keep_id = p_merge_id then raise exception 'cannot_merge_self' using errcode='22023'; end if;
  select * into v_keep  from public.guests where id = p_keep_id  and org_id = p_org for update;
  if not found then raise exception 'keep_not_found' using errcode='P0002'; end if;
  select * into v_merge from public.guests where id = p_merge_id and org_id = p_org and status = 'active' for update;
  if not found then raise exception 'merge_not_found_or_inactive' using errcode='P0002'; end if;

  update public.guests set
    email       = coalesce(v_keep.email, v_merge.email),
    address     = coalesce(v_keep.address, v_merge.address),
    notes       = coalesce(v_keep.notes, v_merge.notes),
    dietary_flags = (select array(select distinct unnest(v_keep.dietary_flags || v_merge.dietary_flags))),
    updated_at  = now()
  where id = p_keep_id;
  update public.guests set status = 'merged', merged_into_id = p_keep_id, updated_at = now() where id = p_merge_id;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'guest.merge', 'completed', coalesce(p_actor_id, auth.uid()), 'guest', p_keep_id::text,
            jsonb_build_object('kept', p_keep_id, 'merged', p_merge_id));
  return jsonb_build_object('kept', p_keep_id, 'merged', p_merge_id);
end; $$;

-- ============================================================================
-- record_stock_movement — atomic: movement row + on-hand update + audit.
-- in/out are deltas (out guarded against going negative); adjust SETS on-hand.
-- ============================================================================
create or replace function public.record_stock_movement(
  p_org uuid, p_item_id uuid, p_direction text, p_quantity numeric,
  p_reason text default null, p_linked_type text default null, p_linked_id text default null, p_performed_by uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_item public.inventory_items%rowtype; v_new numeric(14,3); v_mid uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_direction not in ('in','out','adjust') then raise exception 'bad_direction' using errcode='22023'; end if;
  if p_quantity < 0 then raise exception 'negative_quantity' using errcode='22023'; end if;
  select * into v_item from public.inventory_items where id = p_item_id and org_id = p_org for update;
  if not found then raise exception 'item_not_found' using errcode='P0002'; end if;

  v_new := case p_direction
    when 'in'     then v_item.quantity_on_hand + p_quantity
    when 'out'    then v_item.quantity_on_hand - p_quantity
    when 'adjust' then p_quantity end;
  if v_new < 0 then raise exception 'insufficient_stock' using errcode='23514', detail = format('on_hand %s, out %s', v_item.quantity_on_hand, p_quantity); end if;

  insert into public.inventory_movements(org_id, item_id, direction, quantity, reason, linked_entity_type, linked_entity_id, performed_by)
    values (p_org, p_item_id, p_direction, p_quantity, p_reason, p_linked_type, p_linked_id, coalesce(p_performed_by, auth.uid()))
    returning id into v_mid;
  update public.inventory_items set quantity_on_hand = v_new, updated_at = now() where id = p_item_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'inventory.movement', 'completed', coalesce(p_performed_by, auth.uid()), 'inventory_item', p_item_id::text,
            jsonb_build_object('direction', p_direction, 'quantity', p_quantity, 'new_on_hand', v_new));
  return jsonb_build_object('item_id', p_item_id, 'movement_id', v_mid, 'new_on_hand', v_new);
end; $$;

-- ============================================================================
-- create_staff — profile insert + audit. Capabilities are NOT set here (they
-- live in org_members). user_id links a login; null = temp/event staff.
-- ============================================================================
create or replace function public.create_staff(
  p_org uuid, p_name text, p_phone text default null, p_role text default 'operative',
  p_user_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  insert into public.staff(org_id, user_id, name, phone, role)
    values (p_org, p_user_id, btrim(p_name), p_phone, p_role)
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'staff.create', 'completed', coalesce(p_actor_id, auth.uid()), 'staff', v_id::text, jsonb_build_object('role', p_role));
  return jsonb_build_object('staff_id', v_id);
exception
  when unique_violation then  -- a staff profile for this login already exists
    select id into v_id from public.staff where org_id = p_org and user_id = p_user_id;
    return jsonb_build_object('staff_id', v_id, 'existing', true);
end; $$;

-- ============================================================================
-- write_ledger — atomic ledger entry + audit. The "one ledger many streams"
-- write path; supply_type + source_domain tag every movement.
-- ============================================================================
create or replace function public.write_ledger(
  p_org uuid, p_supply_type text, p_amount numeric, p_direction text, p_source_domain text,
  p_linked_type text default null, p_linked_id text default null, p_description text default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_direction not in ('credit','debit') then raise exception 'bad_direction' using errcode='22023'; end if;
  if p_source_domain not in ('hall','stays','catering','core') then raise exception 'bad_domain' using errcode='22023'; end if;
  insert into public.finance_ledger(org_id, supply_type, amount, direction, source_domain, linked_entity_type, linked_entity_id, description, created_by)
    values (p_org, p_supply_type, p_amount, p_direction, p_source_domain, p_linked_type, p_linked_id, p_description, coalesce(p_actor_id, auth.uid()))
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'finance.ledger_write', 'completed', coalesce(p_actor_id, auth.uid()), 'finance_ledger', v_id::text,
            jsonb_build_object('supply_type', p_supply_type, 'amount', p_amount, 'direction', p_direction, 'domain', p_source_domain));
  return jsonb_build_object('ledger_id', v_id);
end; $$;

-- grants: members act (self-auth inside); service_role = system path
do $$
declare fn text;
begin
  foreach fn in array array[
    'find_or_create_guest(uuid,text,text,text,text,text,text[],jsonb,uuid)',
    'merge_guests(uuid,uuid,uuid,uuid)',
    'record_stock_movement(uuid,uuid,text,numeric,text,text,text,uuid)',
    'create_staff(uuid,text,text,text,uuid,uuid)',
    'write_ledger(uuid,text,numeric,text,text,text,text,text,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
