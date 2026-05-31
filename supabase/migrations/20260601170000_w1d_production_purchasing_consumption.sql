-- ============================================================================
-- W1d — KITCHEN PRODUCTION / KOT + PURCHASE PLANNING + CONSUMPTION DRAW-DOWN
-- ----------------------------------------------------------------------------
-- The first catering sub-phase that MOVES REAL STOCK. Every inventory change
-- routes through the W0 record_stock_movement RPC (atomic, audited, over-draw
-- guarded) — NO parallel stock-mutation path. Upstream driver = a signed BEO and
-- its recipes (W1a scale_recipe). One kitchen / one inventory serves BOTH
-- banquet (BEO-driven) and Stays room-dining (no BEO). Config-driven GST stays
-- out of scope (that's W1e billing). Atomic + audited + tenant-scoped.
-- ============================================================================

-- ── vendors — wire the W0 forward-ref FK on inventory_items.supplier_id ───────
--    (NEWLY WIRED in W1d: supplier_id was a bare uuid forward-ref since W0.)
create table if not exists public.vendors (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null,
  phone      text,
  email      text,
  notes      text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- expression uniqueness MUST be a unique INDEX, never a table UNIQUE (W1a lesson f9ed6ce)
create unique index if not exists uq_vendors_org_name on public.vendors (org_id, lower(btrim(name)));
create index if not exists idx_vendors_org on public.vendors (org_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_inventory_supplier') then
    alter table public.inventory_items
      add constraint fk_inventory_supplier foreign key (supplier_id) references public.vendors(id) on delete set null;
  end if;
end $$;

-- ── kitchen_tickets (KOT) — the production ticket. source_type unifies banquet
--    (BEO-driven) and room_dining (ad-hoc, no BEO). One banquet ticket per BEO. ─
create table if not exists public.kitchen_tickets (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  source_type    text not null check (source_type in ('banquet','room_dining')),
  beo_id         uuid references public.catering_beos(id) on delete set null,
  event_id       uuid references public.events(id) on delete set null,
  billable_count numeric(14,3) not null default 0,                              -- banquet: max(count,guarantee)
  label          text,
  status         text not null default 'open' check (status in ('open','closed','void')),
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- one production ticket per signed BEO → idempotent generation
create unique index if not exists uq_kitchen_ticket_beo on public.kitchen_tickets (beo_id) where source_type = 'banquet';
create index if not exists idx_kitchen_tickets_org on public.kitchen_tickets (org_id, created_at desc);

create table if not exists public.kitchen_ticket_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  ticket_id     uuid not null references public.kitchen_tickets(id) on delete cascade,
  menu_item_id  uuid references public.catering_menu_items(id) on delete set null,
  name          text not null,
  portion_count numeric(14,3) not null check (portion_count >= 0),
  constraint uq_ticket_line unique (ticket_id, menu_item_id)
);
create index if not exists idx_ticket_lines_ticket on public.kitchen_ticket_lines (ticket_id);

-- ── production_consumption — consolidated ingredient requirement per ticket:
--    planned (from recipes) + actual (recorded at close). variance = actual−planned. ─
create table if not exists public.production_consumption (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  ticket_id        uuid not null references public.kitchen_tickets(id) on delete cascade,
  item_id          uuid not null references public.inventory_items(id) on delete restrict,
  planned_quantity numeric(14,4) not null default 0,
  actual_quantity  numeric(14,4),                       -- null until consumed/closed
  constraint uq_consumption unique (ticket_id, item_id)
);
create index if not exists idx_consumption_ticket on public.production_consumption (ticket_id);

-- ── purchase_orders — shortfall (requirement − on-hand) grouped by supplier ──
create table if not exists public.purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  supplier_id      uuid references public.vendors(id) on delete set null,        -- null = unassigned supplier
  source_ticket_id uuid references public.kitchen_tickets(id) on delete set null,
  status           text not null default 'draft' check (status in ('draft','ordered','received')),
  notes            text,
  ordered_at       timestamptz,
  received_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_po_org on public.purchase_orders (org_id, created_at desc);
create index if not exists idx_po_ticket on public.purchase_orders (source_ticket_id);

create table if not exists public.purchase_order_lines (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.orgs(id) on delete cascade,
  po_id     uuid not null references public.purchase_orders(id) on delete cascade,
  item_id   uuid not null references public.inventory_items(id) on delete restrict,
  name      text not null,
  quantity  numeric(14,4) not null check (quantity >= 0),
  unit      text,
  unit_cost numeric(12,2) not null default 0,
  constraint uq_po_line unique (po_id, item_id)
);
create index if not exists idx_po_lines_po on public.purchase_order_lines (po_id);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['vendors','kitchen_tickets','kitchen_ticket_lines','production_consumption','purchase_orders','purchase_order_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ── small helper: upsert-sum the scaled recipe of one dish into a ticket's
--    consolidated requirement (same ingredient across dishes is summed) ────────
create or replace function public.pn_add_dish_to_requirement(p_org uuid, p_ticket uuid, p_menu_item uuid, p_count numeric)
  returns void language plpgsql security definer set search_path = public as $$
declare v_scaled jsonb; r record;
begin
  v_scaled := public.scale_recipe(p_org, p_menu_item, p_count);
  if (v_scaled->>'has_recipe')::boolean is not true then return; end if;
  for r in select * from jsonb_to_recordset(v_scaled->'lines') as x(inventory_item_id uuid, scaled_quantity numeric) loop
    insert into public.production_consumption(org_id, ticket_id, item_id, planned_quantity)
      values (p_org, p_ticket, r.inventory_item_id, r.scaled_quantity)
      on conflict (ticket_id, item_id) do update set planned_quantity = public.production_consumption.planned_quantity + excluded.planned_quantity;
  end loop;
end; $$;

-- ============================================================================
-- generate_production — from a SIGNED BEO, build the KOT + consolidated
-- ingredient requirement at max(guest_count, guest_guarantee) (never under-
-- produce). Idempotent: one banquet ticket per BEO.
-- ============================================================================
create or replace function public.generate_production(p_org uuid, p_beo_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_beo public.catering_beos%rowtype; v_billable numeric(14,3); v_ticket uuid; r record; v_req jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_beo from public.catering_beos where id = p_beo_id and org_id = p_org;
  if not found then raise exception 'beo_not_found' using errcode='P0002'; end if;
  if v_beo.status <> 'signed' then raise exception 'beo_not_signed' using errcode='22023', detail='production needs a signed BEO'; end if;

  select id into v_ticket from public.kitchen_tickets where beo_id = p_beo_id and source_type = 'banquet';
  if v_ticket is not null then
    return jsonb_build_object('ticket_id', v_ticket, 'already_exists', true);  -- idempotent
  end if;

  v_billable := greatest(coalesce(v_beo.guest_count,0), coalesce(v_beo.guest_guarantee,0));  -- never under-produce
  insert into public.kitchen_tickets(org_id, source_type, beo_id, event_id, billable_count, label, status)
    values (p_org, 'banquet', p_beo_id, v_beo.event_id, v_billable, 'BEO '||v_beo.beo_type||' v'||v_beo.version, 'open')
    returning id into v_ticket;

  for r in select menu_item_id, name from public.catering_beo_lines where beo_id = p_beo_id loop
    insert into public.kitchen_ticket_lines(org_id, ticket_id, menu_item_id, name, portion_count)
      values (p_org, v_ticket, r.menu_item_id, r.name, v_billable);
    if r.menu_item_id is not null then
      perform public.pn_add_dish_to_requirement(p_org, v_ticket, r.menu_item_id, v_billable);  -- consolidates shared ingredients
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
            'item_id', pc.item_id, 'name', ii.name, 'unit', ii.unit,
            'planned_quantity', pc.planned_quantity, 'on_hand', ii.quantity_on_hand,
            'shortfall', greatest(pc.planned_quantity - ii.quantity_on_hand, 0)) order by ii.name), '[]'::jsonb)
    into v_req
    from public.production_consumption pc join public.inventory_items ii on ii.id = pc.item_id
    where pc.ticket_id = v_ticket;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'catering.production_generate', 'completed', coalesce(p_actor_id, auth.uid()), 'kitchen_ticket', v_ticket::text,
            jsonb_build_object('beo_id', p_beo_id, 'billable_count', v_billable));
  return jsonb_build_object('ticket_id', v_ticket, 'billable_count', v_billable, 'requirement', v_req);
end; $$;

-- ============================================================================
-- create_room_dining — lightweight Stays F&B path: order → KOT → (later) consume.
-- No BEO. Proves one kitchen / one inventory ledger serves both models.
-- p_lines = [{menu_item_id, portion_count}]
-- ============================================================================
create or replace function public.create_room_dining(p_org uuid, p_lines jsonb, p_label text default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ticket uuid; r record; v_total numeric(14,3) := 0; v_req jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'no_lines' using errcode='22023'; end if;

  insert into public.kitchen_tickets(org_id, source_type, billable_count, label, status)
    values (p_org, 'room_dining', 0, coalesce(p_label,'Room dining'), 'open') returning id into v_ticket;

  for r in select * from jsonb_to_recordset(p_lines) as x(menu_item_id uuid, portion_count numeric) loop
    insert into public.kitchen_ticket_lines(org_id, ticket_id, menu_item_id, name, portion_count)
      select p_org, v_ticket, r.menu_item_id, mi.name, r.portion_count
      from public.catering_menu_items mi where mi.id = r.menu_item_id and mi.org_id = p_org;
    perform public.pn_add_dish_to_requirement(p_org, v_ticket, r.menu_item_id, r.portion_count);
    v_total := v_total + coalesce(r.portion_count,0);
  end loop;
  update public.kitchen_tickets set billable_count = v_total where id = v_ticket;

  select coalesce(jsonb_agg(jsonb_build_object('item_id', pc.item_id, 'name', ii.name,
            'planned_quantity', pc.planned_quantity, 'on_hand', ii.quantity_on_hand) order by ii.name), '[]'::jsonb)
    into v_req from public.production_consumption pc join public.inventory_items ii on ii.id = pc.item_id where pc.ticket_id = v_ticket;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'catering.room_dining_create', 'completed', coalesce(p_actor_id, auth.uid()), 'kitchen_ticket', v_ticket::text,
            jsonb_build_object('portions', v_total));
  return jsonb_build_object('ticket_id', v_ticket, 'requirement', v_req);
end; $$;

-- ============================================================================
-- plan_purchase — shortfall (requirement − on-hand) → DRAFT POs grouped by
-- supplier (inventory_items.supplier_id; null = one unassigned PO). Idempotent:
-- regenerates draft POs for the ticket (leaves ordered/received untouched).
-- ============================================================================
create or replace function public.plan_purchase(p_org uuid, p_ticket_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sup record; v_po uuid; v_pos jsonb := '[]'::jsonb; v_n int;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.kitchen_tickets where id = p_ticket_id and org_id = p_org) then
    raise exception 'ticket_not_found' using errcode='P0002'; end if;

  delete from public.purchase_orders where source_ticket_id = p_ticket_id and org_id = p_org and status = 'draft';  -- idempotent replan

  for v_sup in
    select ii.supplier_id as sup
    from public.production_consumption pc join public.inventory_items ii on ii.id = pc.item_id
    where pc.ticket_id = p_ticket_id and pc.planned_quantity > ii.quantity_on_hand
    group by ii.supplier_id
  loop
    insert into public.purchase_orders(org_id, supplier_id, source_ticket_id, status)
      values (p_org, v_sup.sup, p_ticket_id, 'draft') returning id into v_po;
    insert into public.purchase_order_lines(org_id, po_id, item_id, name, quantity, unit, unit_cost)
      select p_org, v_po, ii.id, ii.name, round(pc.planned_quantity - ii.quantity_on_hand, 4), ii.unit, ii.cost
      from public.production_consumption pc join public.inventory_items ii on ii.id = pc.item_id
      where pc.ticket_id = p_ticket_id and pc.planned_quantity > ii.quantity_on_hand
        and ii.supplier_id is not distinct from v_sup.sup;
    select count(*) into v_n from public.purchase_order_lines where po_id = v_po;
    v_pos := v_pos || jsonb_build_object('po_id', v_po, 'supplier_id', v_sup.sup, 'lines', v_n);
  end loop;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'catering.purchase_plan', 'completed', coalesce(p_actor_id, auth.uid()), 'kitchen_ticket', p_ticket_id::text,
            jsonb_build_object('pos', v_pos));
  return jsonb_build_object('ticket_id', p_ticket_id, 'pos', v_pos);
end; $$;

-- order a draft PO (draft → ordered)
create or replace function public.order_purchase_order(p_org uuid, p_po_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select status into v_status from public.purchase_orders where id = p_po_id and org_id = p_org;
  if v_status is null then raise exception 'po_not_found' using errcode='P0002'; end if;
  if v_status <> 'draft' then raise exception 'po_not_draft' using errcode='22023', detail=v_status; end if;
  update public.purchase_orders set status = 'ordered', ordered_at = now(), updated_at = now() where id = p_po_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'catering.po_order', 'completed', coalesce(p_actor_id, auth.uid()), 'purchase_order', p_po_id::text);
  return jsonb_build_object('po_id', p_po_id, 'status', 'ordered');
end; $$;

-- ============================================================================
-- receive_purchase_order — ordered → received. Each line is a real inventory IN
-- via W0 record_stock_movement (atomic, audited). Idempotent: re-receive rejected.
-- ============================================================================
create or replace function public.receive_purchase_order(p_org uuid, p_po_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; r record; v_n int := 0;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select status into v_status from public.purchase_orders where id = p_po_id and org_id = p_org;
  if v_status is null then raise exception 'po_not_found' using errcode='P0002'; end if;
  if v_status = 'received' then raise exception 'po_already_received' using errcode='22023'; end if;       -- idempotency guard
  if v_status <> 'ordered' then raise exception 'po_not_ordered' using errcode='22023', detail=v_status; end if;

  for r in select item_id, quantity from public.purchase_order_lines where po_id = p_po_id loop
    perform public.record_stock_movement(p_org, r.item_id, 'in', r.quantity, 'PO receive', 'purchase_order', p_po_id::text, p_actor_id);
    v_n := v_n + 1;
  end loop;
  update public.purchase_orders set status = 'received', received_at = now(), updated_at = now() where id = p_po_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'catering.po_receive', 'completed', coalesce(p_actor_id, auth.uid()), 'purchase_order', p_po_id::text,
            jsonb_build_object('lines_received', v_n));
  return jsonb_build_object('po_id', p_po_id, 'status', 'received', 'lines_received', v_n);
end; $$;

-- ============================================================================
-- close_production — execute/close a ticket: record actuals (default = planned),
-- decrement inventory via W0 record_stock_movement (OUT). Over-draw is rejected
-- by W0 (insufficient_stock) → whole tx rolls back, on-hand unchanged.
-- IDEMPOTENT: a non-open ticket is rejected — consuming the same ticket twice
-- can NOT double-deduct.  p_actuals = [{item_id, actual_quantity}] (optional)
-- ============================================================================
create or replace function public.close_production(p_org uuid, p_ticket_id uuid, p_actuals jsonb default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; r record; v_consumed jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select status into v_status from public.kitchen_tickets where id = p_ticket_id and org_id = p_org for update;
  if v_status is null then raise exception 'ticket_not_found' using errcode='P0002'; end if;
  if v_status <> 'open' then raise exception 'production_already_closed' using errcode='22023', detail=v_status; end if;  -- IDEMPOTENCY

  -- set actuals: override where supplied, else default to planned
  update public.production_consumption pc set actual_quantity = coalesce(
      (select (e->>'actual_quantity')::numeric from jsonb_array_elements(coalesce(p_actuals,'[]'::jsonb)) e
        where (e->>'item_id')::uuid = pc.item_id), pc.planned_quantity)
    where pc.ticket_id = p_ticket_id and pc.org_id = p_org;

  -- draw down via the ONE W0 stock path (raises insufficient_stock 23514 → rollback)
  for r in select item_id, actual_quantity from public.production_consumption where ticket_id = p_ticket_id and actual_quantity > 0 loop
    perform public.record_stock_movement(p_org, r.item_id, 'out', r.actual_quantity, 'production consume', 'kitchen_ticket', p_ticket_id::text, p_actor_id);
  end loop;

  update public.kitchen_tickets set status = 'closed', closed_at = now(), updated_at = now() where id = p_ticket_id and org_id = p_org;

  select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'actual_quantity', actual_quantity) order by item_id), '[]'::jsonb)
    into v_consumed from public.production_consumption where ticket_id = p_ticket_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'catering.production_close', 'completed', coalesce(p_actor_id, auth.uid()), 'kitchen_ticket', p_ticket_id::text,
            jsonb_build_object('consumed', v_consumed));
  return jsonb_build_object('ticket_id', p_ticket_id, 'status', 'closed', 'consumed', v_consumed);
end; $$;

-- ============================================================================
-- production_variance (READ, STABLE) — planned vs actual per ingredient, with
-- variance (actual − planned). Variance + cost are gated to pnl.view_margin OR
-- catering.view_cost (same gate as W1b quote_summary); nulled for operatives.
-- ============================================================================
create or replace function public.production_variance(p_org uuid, p_ticket_id uuid)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_can_cost boolean; v_lines jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.kitchen_tickets where id = p_ticket_id and org_id = p_org) then
    raise exception 'ticket_not_found' using errcode='P0002'; end if;

  v_can_cost := (auth.uid() is null)
                or public.has_capability(p_org, 'pnl.view_margin')
                or public.has_capability(p_org, 'catering.view_cost');

  select coalesce(jsonb_agg(jsonb_build_object(
            'item_id', pc.item_id, 'name', ii.name, 'unit', ii.unit,
            'planned_quantity', pc.planned_quantity, 'actual_quantity', pc.actual_quantity,
            'variance_quantity', case when v_can_cost then coalesce(pc.actual_quantity,0) - pc.planned_quantity else null end,
            'unit_cost',         case when v_can_cost then ii.cost else null end,
            'planned_cost',      case when v_can_cost then round(pc.planned_quantity * ii.cost, 2) else null end,
            'actual_cost',       case when v_can_cost then round(coalesce(pc.actual_quantity,0) * ii.cost, 2) else null end,
            'variance_cost',     case when v_can_cost then round((coalesce(pc.actual_quantity,0) - pc.planned_quantity) * ii.cost, 2) else null end
          ) order by ii.name), '[]'::jsonb)
    into v_lines
    from public.production_consumption pc join public.inventory_items ii on ii.id = pc.item_id
    where pc.ticket_id = p_ticket_id;

  return jsonb_build_object('ticket_id', p_ticket_id, 'can_see_cost', v_can_cost, 'lines', v_lines);
end; $$;

-- ── manage a vendor (create/update; expression-unique on name handled by index) ─
create or replace function public.upsert_vendor(p_org uuid, p_name text, p_phone text default null,
  p_email text default null, p_notes text default null, p_vendor_id uuid default null, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_vendor_id is null then
    insert into public.vendors(org_id, name, phone, email, notes) values (p_org, btrim(p_name), p_phone, p_email, p_notes) returning id into v_id;
  else
    update public.vendors set name = btrim(p_name), phone = p_phone, email = p_email, notes = p_notes, updated_at = now()
      where id = p_vendor_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'vendor_not_found' using errcode='P0002'; end if;
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'catering.vendor_upsert', 'completed', coalesce(p_actor_id, auth.uid()), 'vendor', v_id::text);
  return jsonb_build_object('vendor_id', v_id);
end; $$;

-- grants
do $$
declare fn text;
begin
  foreach fn in array array[
    'pn_add_dish_to_requirement(uuid,uuid,uuid,numeric)',
    'generate_production(uuid,uuid,uuid)',
    'create_room_dining(uuid,jsonb,text,uuid)',
    'plan_purchase(uuid,uuid,uuid)',
    'order_purchase_order(uuid,uuid,uuid)',
    'receive_purchase_order(uuid,uuid,uuid)',
    'close_production(uuid,uuid,jsonb,uuid)',
    'production_variance(uuid,uuid)',
    'upsert_vendor(uuid,text,text,text,text,uuid,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
