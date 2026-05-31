-- ============================================================================
-- W1a — CATERING: MENU + RECIPE + COST FOUNDATION (OP MODEL v2 §3.2)
-- ----------------------------------------------------------------------------
-- The data all later catering sub-phases (quote/BEO/production/purchasing/
-- billing) read from. Ports the legacy Kitchen donor's per-plate CONCEPT
-- (quantity_per_plate × count) and extends it to a real recipe model with
-- auto-scaling + costing that rolls up from W0 inventory_items.cost (never
-- hardcoded). Config-driven GST: items carry a supply-type TAG, NEVER a rate.
-- On the proven pattern: atomic RPC writes, org-scoped default-deny RLS, audit.
-- ============================================================================

-- ── Menu items (a recipe is optional — some items are bought-in) ─────────────
create table if not exists public.catering_menu_items (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.orgs(id) on delete cascade,
  name                  text not null,
  category              text,
  description           text,
  default_selling_price numeric(12,2) not null default 0 check (default_selling_price >= 0),
  supply_type           text,            -- GST TAG only (e.g. 'catering_composite'); rate resolved later by the GST engine — never stored here
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- normalized-name uniqueness must be an INDEX — a table-level UNIQUE constraint
-- cannot reference an expression like lower(btrim(name)) (same pattern as the W0
-- guest-dedup index).
create unique index if not exists uq_catering_menu_org_name
  on public.catering_menu_items (org_id, lower(btrim(name)));
create index if not exists idx_catering_menu_org on public.catering_menu_items (org_id);
create index if not exists idx_catering_menu_org_cat on public.catering_menu_items (org_id, category);

-- ── Recipe: one per menu item. base_yield = servings the listed line quantities
--    produce. scale_mode: 'linear' (per-plate; scales continuously) or 'batch'
--    (round UP to whole batches of base_yield). ───────────────────────────────
create table if not exists public.catering_recipes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  menu_item_id uuid not null references public.catering_menu_items(id) on delete cascade,
  base_yield  numeric(12,3) not null check (base_yield > 0),   -- servings the lines below produce
  scale_mode  text not null check (scale_mode in ('linear','batch')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_recipe_per_item unique (menu_item_id)
);
create index if not exists idx_recipe_org on public.catering_recipes (org_id);

-- ── Recipe lines: each links a W0 inventory item with a quantity per base_yield ─
create table if not exists public.catering_recipe_lines (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  recipe_id         uuid not null references public.catering_recipes(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity          numeric(14,4) not null check (quantity >= 0),  -- per base_yield servings
  unit              text not null default 'unit',
  created_at        timestamptz not null default now(),
  constraint uq_recipe_line_item unique (recipe_id, inventory_item_id)
);
create index if not exists idx_recipe_lines_recipe on public.catering_recipe_lines (recipe_id);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['catering_menu_items','catering_recipes','catering_recipe_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ============================================================================
-- upsert_menu_item — create or update a menu item (atomic + audited).
-- ============================================================================
create or replace function public.upsert_menu_item(
  p_org uuid, p_name text, p_category text default null, p_description text default null,
  p_selling_price numeric default 0, p_supply_type text default null,
  p_menu_item_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_menu_item_id is null then
    insert into public.catering_menu_items(org_id, name, category, description, default_selling_price, supply_type)
      values (p_org, btrim(p_name), p_category, p_description, coalesce(p_selling_price,0), p_supply_type)
      returning id into v_id;
  else
    update public.catering_menu_items set
      name = btrim(p_name), category = p_category, description = p_description,
      default_selling_price = coalesce(p_selling_price,0), supply_type = p_supply_type, updated_at = now()
    where id = p_menu_item_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'menu_item_not_found' using errcode='P0002'; end if;
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'catering.menu_item_upsert', 'completed', coalesce(p_actor_id, auth.uid()), 'catering_menu_item', v_id::text,
            jsonb_build_object('name', btrim(p_name), 'supply_type', p_supply_type));
  return jsonb_build_object('menu_item_id', v_id);
end; $$;

-- ============================================================================
-- set_recipe — atomically (re)define a menu item's recipe + lines.
-- p_lines = jsonb array of { inventory_item_id, quantity, unit }. Replaces any
-- existing lines. Validates each inventory item belongs to the org. Audited.
-- ============================================================================
create or replace function public.set_recipe(
  p_org uuid, p_menu_item_id uuid, p_base_yield numeric, p_scale_mode text,
  p_lines jsonb, p_notes text default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_recipe_id uuid; v_line jsonb; v_item_org uuid; v_count int := 0;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_scale_mode not in ('linear','batch') then raise exception 'bad_scale_mode' using errcode='22023'; end if;
  if p_base_yield is null or p_base_yield <= 0 then raise exception 'bad_base_yield' using errcode='22023'; end if;
  if not exists (select 1 from public.catering_menu_items where id = p_menu_item_id and org_id = p_org) then
    raise exception 'menu_item_not_found' using errcode='P0002';
  end if;

  insert into public.catering_recipes(org_id, menu_item_id, base_yield, scale_mode, notes)
    values (p_org, p_menu_item_id, p_base_yield, p_scale_mode, p_notes)
    on conflict (menu_item_id) do update set base_yield = excluded.base_yield, scale_mode = excluded.scale_mode, notes = excluded.notes, updated_at = now()
    returning id into v_recipe_id;
  delete from public.catering_recipe_lines where recipe_id = v_recipe_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select org_id into v_item_org from public.inventory_items where id = (v_line->>'inventory_item_id')::uuid;
    if v_item_org is null or v_item_org <> p_org then
      raise exception 'inventory_item_not_in_org' using errcode='42501', detail = coalesce(v_line->>'inventory_item_id','?');
    end if;
    insert into public.catering_recipe_lines(org_id, recipe_id, inventory_item_id, quantity, unit)
      values (p_org, v_recipe_id, (v_line->>'inventory_item_id')::uuid, (v_line->>'quantity')::numeric, coalesce(v_line->>'unit','unit'));
    v_count := v_count + 1;
  end loop;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'catering.set_recipe', 'completed', coalesce(p_actor_id, auth.uid()), 'catering_recipe', v_recipe_id::text,
            jsonb_build_object('menu_item_id', p_menu_item_id, 'base_yield', p_base_yield, 'scale_mode', p_scale_mode, 'lines', v_count));
  return jsonb_build_object('recipe_id', v_recipe_id, 'lines', v_count);
end; $$;

-- ============================================================================
-- scale_recipe — THE auto-scale + cost engine (read-only, STABLE). Given a menu
-- item + guest count, scales every line and rolls cost up from live inventory
-- cost. linear → continuous; batch → round UP to whole batches; no recipe →
-- empty list (not an error). per_plate_cost = base food cost per serving;
-- total_food_cost = actual at N (incl. batch rounding waste).
-- ============================================================================
create or replace function public.scale_recipe(
  p_org uuid, p_menu_item_id uuid, p_guest_count numeric
) returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_recipe public.catering_recipes%rowtype;
  v_base_sum numeric(14,4);   -- cost to produce base_yield servings
  v_factor   numeric;          -- linear multiplier OR batch count
  v_batches  int;
  v_lines    jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_guest_count is null or p_guest_count < 0 then raise exception 'bad_guest_count' using errcode='22023'; end if;

  select * into v_recipe from public.catering_recipes where menu_item_id = p_menu_item_id and org_id = p_org;
  if not found then
    return jsonb_build_object('has_recipe', false, 'guest_count', p_guest_count,
      'per_plate_cost', 0, 'total_food_cost', 0, 'lines', '[]'::jsonb);
  end if;

  if v_recipe.scale_mode = 'batch' then
    v_batches := ceil(p_guest_count / v_recipe.base_yield);
    v_factor  := v_batches;                       -- whole batches
  else
    v_factor  := p_guest_count / v_recipe.base_yield;  -- continuous
    v_batches := null;
  end if;

  -- base cost (per base_yield) from LIVE inventory cost — never stored/stale
  select coalesce(sum(rl.quantity * ii.cost), 0) into v_base_sum
    from public.catering_recipe_lines rl
    join public.inventory_items ii on ii.id = rl.inventory_item_id
    where rl.recipe_id = v_recipe.id;

  select coalesce(jsonb_agg(jsonb_build_object(
            'inventory_item_id', rl.inventory_item_id, 'name', ii.name, 'unit', rl.unit,
            'base_quantity', rl.quantity,
            'scaled_quantity', round(rl.quantity * v_factor, 4),
            'unit_cost', ii.cost,
            'line_cost', round(rl.quantity * ii.cost * v_factor, 2)
          ) order by ii.name), '[]'::jsonb) into v_lines
    from public.catering_recipe_lines rl
    join public.inventory_items ii on ii.id = rl.inventory_item_id
    where rl.recipe_id = v_recipe.id;

  return jsonb_build_object(
    'has_recipe', true, 'guest_count', p_guest_count, 'scale_mode', v_recipe.scale_mode,
    'base_yield', v_recipe.base_yield, 'batches', v_batches,
    'per_plate_cost', round(v_base_sum / v_recipe.base_yield, 2),   -- food cost per serving
    'total_food_cost', round(v_base_sum * v_factor, 2),             -- actual at N (batch incl. rounding)
    'lines', v_lines);
end; $$;

-- grants: members act (self-auth inside); service_role = system path
do $$
declare fn text;
begin
  foreach fn in array array[
    'upsert_menu_item(uuid,text,text,text,numeric,text,uuid,uuid)',
    'set_recipe(uuid,uuid,numeric,text,jsonb,text,uuid)',
    'scale_recipe(uuid,uuid,numeric)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
