-- ============================================================================
-- M7 — INVENTORY REORDER-POINT + PROCUREMENT AUTOMATION (A11 detect / A12 draft)
-- ----------------------------------------------------------------------------
-- Benchmarked vs MarketMan / Apicbase (NOT a legacy re-skin). Mostly B4-registry
-- wiring over the EXISTING W0 inventory + W1d purchasing — reuse the proven
-- engines, add config + one rule. Minimal schema. v1 is THRESHOLD reorder (no
-- demand-forecasting/ML — that tier is out).
--
--  A) REORDER CONFIG (per-item opt-in, org config; never hardcoded). W0
--     inventory_items.reorder_point already existed as NOT NULL DEFAULT 0; M7
--     makes it NULLABLE (NULL = NOT monitored) and backfills the legacy default 0
--     → NULL (so monitoring is opt-in, not auto-enrolled). Adds reorder_qty (the
--     draft amount). set_reorder_point (cap inventory.manage) sets both.
--
--  B/C) A11+A12 — run_reorder_check (B4 registry rule A_reorder; per-org, every
--     tick; atomic, idempotent, IST-anchored, audited). Scans W0 inventory_items
--     where reorder_point IS NOT NULL AND quantity_on_hand <= reorder_point (ON-HAND
--     read from the EXISTING W0 field record_stock_movement maintains — NO parallel
--     on-hand). For uncovered shortfalls it DRAFTS into the EXISTING W1d
--     purchase_orders / purchase_order_lines tables (status='draft', source='reorder',
--     grouped by supplier — the W1d PO path, NOT a parallel one) and sends ONE B3
--     notification to the manager (enqueue_outbound; idempotent + quiet-hours-aware).
--     DRAFT ONLY — nothing ordered/received/paid (manual W1d flow does that).
--
--  IDEMPOTENCY: an item already covered by an OPEN DRAFT reorder PO line is NOT
--  re-drafted (no duplicate). Once that draft leaves 'draft' (ordered/received) or
--  is removed, a later tick re-drafts if the item is still short.
--
-- Atomic + audited + tenant-scoped. Cap `inventory.manage` gates reorder config.
-- ============================================================================

-- ── A) reorder config: make reorder_point opt-in + add the draft qty ─────────
alter table public.inventory_items alter column reorder_point drop default;
alter table public.inventory_items alter column reorder_point drop not null;
update public.inventory_items set reorder_point = null where reorder_point = 0;   -- legacy default 0 → NOT monitored (opt-in)
alter table public.inventory_items add column if not exists reorder_qty numeric(14,3);   -- draft amount when short

-- ── C) reuse the W1d PO path; tag reorder-origin drafts for dedup (no new table)
alter table public.purchase_orders add column if not exists source text not null default 'manual';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chk_po_source') then
    alter table public.purchase_orders add constraint chk_po_source check (source in ('manual','reorder'));
  end if;
end $$;

-- ============================================================================
-- set_reorder_point — per-item config (cap inventory.manage). reorder_point NULL
-- clears monitoring; a non-null point REQUIRES a positive reorder_qty (the draft
-- amount). Never a hardcoded value.
-- ============================================================================
create or replace function public.set_reorder_point(
  p_org uuid, p_item_id uuid, p_reorder_point numeric, p_reorder_qty numeric default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'inventory.manage') then raise exception 'forbidden' using errcode='42501', detail='inventory.manage required'; end if;
  if not exists (select 1 from public.inventory_items where id = p_item_id and org_id = p_org) then raise exception 'item_not_found' using errcode='P0002'; end if;
  if p_reorder_point is not null then
    if p_reorder_point < 0 then raise exception 'bad_reorder_point' using errcode='22023'; end if;
    if p_reorder_qty is null or p_reorder_qty <= 0 then raise exception 'reorder_qty_required' using errcode='22023', detail='a monitored item needs a positive reorder_qty'; end if;
  end if;
  update public.inventory_items
    set reorder_point = p_reorder_point,
        reorder_qty = case when p_reorder_point is null then null else p_reorder_qty end,
        updated_at = now()
    where id = p_item_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'inventory.reorder_config', 'completed', coalesce(p_actor_id, auth.uid()), 'inventory_item', p_item_id::text,
            jsonb_build_object('reorder_point', p_reorder_point, 'reorder_qty', p_reorder_qty));
  return jsonb_build_object('item_id', p_item_id, 'reorder_point', p_reorder_point, 'reorder_qty', p_reorder_qty);
end; $$;

-- ============================================================================
-- run_reorder_check — B4 registry rule (A_reorder; per-org, every tick). A11
-- detect (on-hand <= reorder_point, read from W0) + A12 draft (W1d PO path,
-- grouped by supplier, source='reorder') + B3 notify. Idempotent: items already
-- covered by an open draft reorder PO are skipped. Returns # of POs drafted.
-- ============================================================================
create or replace function public.run_reorder_check(p_org uuid, p_now timestamptz default now())
  returns integer language plpgsql security definer set search_path = public as $$
declare v_sup record; v_po uuid; v_n int; v_drafted int := 0; v_items int := 0; v_mgr text;
begin
  -- group UNCOVERED shortfall items (monitored, below point, not already in an open draft reorder PO) by supplier
  for v_sup in
    select ii.supplier_id as sup
    from public.inventory_items ii
    where ii.org_id = p_org
      and ii.reorder_point is not null
      and ii.quantity_on_hand <= ii.reorder_point          -- ON-HAND from the EXISTING W0 field (no parallel on-hand)
      and coalesce(ii.reorder_qty, 0) > 0
      and not exists (
        select 1 from public.purchase_order_lines pol
        join public.purchase_orders po on po.id = pol.po_id
        where po.org_id = p_org and po.status = 'draft' and po.source = 'reorder' and pol.item_id = ii.id)
    group by ii.supplier_id
  loop
    -- DRAFT into the EXISTING W1d purchase_orders / _lines (the W1d PO path; NOT a parallel table)
    insert into public.purchase_orders(org_id, supplier_id, status, source, notes)
      values (p_org, v_sup.sup, 'draft', 'reorder', 'auto reorder (below reorder point)')
      returning id into v_po;
    insert into public.purchase_order_lines(org_id, po_id, item_id, name, quantity, unit, unit_cost)
      select p_org, v_po, ii.id, ii.name, round(ii.reorder_qty, 4), ii.unit, ii.cost
      from public.inventory_items ii
      where ii.org_id = p_org and ii.reorder_point is not null and ii.quantity_on_hand <= ii.reorder_point
        and coalesce(ii.reorder_qty, 0) > 0
        and ii.supplier_id is not distinct from v_sup.sup
        and not exists (
          select 1 from public.purchase_order_lines pol
          join public.purchase_orders po on po.id = pol.po_id
          where po.org_id = p_org and po.status = 'draft' and po.source = 'reorder' and pol.item_id = ii.id);
    select count(*) into v_n from public.purchase_order_lines where po_id = v_po;
    if v_n = 0 then
      delete from public.purchase_orders where id = v_po;   -- defensive: no lines → drop empty draft
    else
      v_drafted := v_drafted + 1; v_items := v_items + v_n;
      insert into public.audit_log(org_id, action, sub_event, entity_type, entity_id, meta)
        values (p_org, 'rule.A_reorder.draft', 'completed', 'purchase_order', v_po::text,
                jsonb_build_object('supplier_id', v_sup.sup, 'lines', v_n));
    end if;
  end loop;

  -- B3 notify the manager that drafts were raised (idempotent per org per day; quiet-hours-aware)
  if v_drafted > 0 then
    select manager_phone into v_mgr from public.message_senders where org_id = p_org and function_area = 'hall_catering' and active;
    if v_mgr is not null then
      begin
        perform public.enqueue_outbound(p_org, 'hall_catering', v_mgr, 'reorder_alert',
          jsonb_build_object('pos', v_drafted, 'items', v_items),
          'reorder-alert:' || p_org::text || ':' || to_char(p_now at time zone 'Asia/Kolkata', 'YYYY-MM-DD'),
          'template', p_now);
      exception when others then
        insert into public.audit_log(org_id, action, sub_event, entity_type, error_message)
          values (p_org, 'rule.A_reorder.notify', 'failed', 'message', sqlerrm);
      end;
    end if;
  end if;

  return v_drafted;
end; $$;

-- ── grants ────────────────────────────────────────────────────────────────--
revoke all    on function public.set_reorder_point(uuid,uuid,numeric,numeric,uuid) from public;
grant execute on function public.set_reorder_point(uuid,uuid,numeric,numeric,uuid) to authenticated, service_role;
revoke all    on function public.run_reorder_check(uuid,timestamptz) from public;
grant execute on function public.run_reorder_check(uuid,timestamptz) to service_role;
