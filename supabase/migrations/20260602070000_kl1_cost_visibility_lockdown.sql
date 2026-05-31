-- ============================================================================
-- KL-1 — COST-COLUMN VISIBILITY LOCKDOWN (the one security-sensitive change)
-- ----------------------------------------------------------------------------
-- Goal: an operational role cannot read raw ingredient cost by ANY path, while
-- the scale engine + Owner/PM legitimate cost reads still work. Three vectors:
--   (1) direct table reads of inventory_items.cost (e.g. the menu page embed)
--       AND purchase_order_lines.unit_cost (a stored copy) — locked via column
--       privilege revoke (Supabase maps all logged-in users to ONE `authenticated`
--       role, so column GRANTs are all-or-nothing → cost becomes unreadable
--       directly by anyone; capability gating stays in the RPC layer).
--   (2) scale_recipe (W1a) — a SECURITY DEFINER RPC that returned cost
--       UNCONDITIONALLY to any caller (the menu scale-preview showed it to every
--       member). Now gated by capability — cost null for non-privileged; scaled
--       quantities always returned (production/quote internals are unaffected).
--   (3) po_line_costs — a gated accessor so Owner/PM still see PO unit costs.
-- The existing gated RPCs (quote_summary, production_variance) already null cost
-- and are SECURITY DEFINER (bypass the column revoke) — untouched.
-- service_role + SECURITY DEFINER functions (run as owner) bypass the revoke, so
-- the scale engine / system paths keep reading cost. Atomic; access-control only.
-- ============================================================================

-- ── (1) revoke direct SELECT on the cost columns; re-grant every other column ─
revoke select on public.inventory_items from authenticated, anon;
grant  select (id, org_id, name, category, unit, quantity_on_hand, reorder_point, supplier_id, created_at, updated_at)
  on public.inventory_items to authenticated, anon;

revoke select on public.purchase_order_lines from authenticated, anon;
grant  select (id, org_id, po_id, item_id, name, quantity, unit)
  on public.purchase_order_lines to authenticated, anon;

-- ── (2) scale_recipe — gate cost output (quantities always; cost only if
--    pnl.view_margin OR catering.view_cost; service_role/system = auth.uid null). ─
create or replace function public.scale_recipe(
  p_org uuid, p_menu_item_id uuid, p_guest_count numeric
) returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_recipe public.catering_recipes%rowtype;
  v_base_sum numeric(14,4);
  v_factor   numeric;
  v_batches  int;
  v_lines    jsonb;
  v_can      boolean;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_guest_count is null or p_guest_count < 0 then raise exception 'bad_guest_count' using errcode='22023'; end if;
  v_can := (auth.uid() is null) or public.has_capability(p_org, 'pnl.view_margin') or public.has_capability(p_org, 'catering.view_cost');

  select * into v_recipe from public.catering_recipes where menu_item_id = p_menu_item_id and org_id = p_org;
  if not found then
    return jsonb_build_object('has_recipe', false, 'guest_count', p_guest_count, 'can_see_cost', v_can,
      'per_plate_cost', case when v_can then 0 else null end, 'total_food_cost', case when v_can then 0 else null end, 'lines', '[]'::jsonb);
  end if;

  if v_recipe.scale_mode = 'batch' then
    v_batches := ceil(p_guest_count / v_recipe.base_yield);
    v_factor  := v_batches;
  else
    v_factor  := p_guest_count / v_recipe.base_yield;
    v_batches := null;
  end if;

  -- base cost from LIVE inventory cost (definer reads cost regardless of the revoke)
  select coalesce(sum(rl.quantity * ii.cost), 0) into v_base_sum
    from public.catering_recipe_lines rl
    join public.inventory_items ii on ii.id = rl.inventory_item_id
    where rl.recipe_id = v_recipe.id;

  select coalesce(jsonb_agg(jsonb_build_object(
            'inventory_item_id', rl.inventory_item_id, 'name', ii.name, 'unit', rl.unit,
            'base_quantity', rl.quantity,
            'scaled_quantity', round(rl.quantity * v_factor, 4),
            'unit_cost', case when v_can then ii.cost else null end,                                   -- GATED
            'line_cost', case when v_can then round(rl.quantity * ii.cost * v_factor, 2) else null end -- GATED
          ) order by ii.name), '[]'::jsonb) into v_lines
    from public.catering_recipe_lines rl
    join public.inventory_items ii on ii.id = rl.inventory_item_id
    where rl.recipe_id = v_recipe.id;

  return jsonb_build_object(
    'has_recipe', true, 'guest_count', p_guest_count, 'scale_mode', v_recipe.scale_mode,
    'base_yield', v_recipe.base_yield, 'batches', v_batches, 'can_see_cost', v_can,
    'per_plate_cost',  case when v_can then round(v_base_sum / v_recipe.base_yield, 2) else null end,   -- GATED
    'total_food_cost', case when v_can then round(v_base_sum * v_factor, 2) else null end,              -- GATED
    'lines', v_lines);
end; $$;

-- ── (3) po_line_costs — gated accessor (Owner/PM see PO unit costs; ops don't) ─
create or replace function public.po_line_costs(p_org uuid)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_can boolean; v_costs jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  v_can := (auth.uid() is null) or public.has_capability(p_org, 'pnl.view_margin') or public.has_capability(p_org, 'catering.view_cost');
  if not v_can then return jsonb_build_object('can_see_cost', false, 'costs', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('line_id', id, 'unit_cost', unit_cost)), '[]'::jsonb) into v_costs
    from public.purchase_order_lines where org_id = p_org;
  return jsonb_build_object('can_see_cost', true, 'costs', v_costs);
end; $$;

do $$
begin
  execute 'revoke all on function public.po_line_costs(uuid) from public';
  execute 'grant execute on function public.po_line_costs(uuid) to authenticated, service_role';
end $$;

notify pgrst, 'reload schema';
