-- ============================================================================
-- M4 — DYNAMIC PRICING: rate-rule engine (SELLING PRICE ONLY)
-- ----------------------------------------------------------------------------
-- Benchmarked vs Cloudbeds PIE / Mews rate management (NOT a legacy re-skin). A
-- config-driven rule engine that computes an effective SELLING price from a base,
-- ON DEMAND. v1 = rules (data) + a pure read resolver. NO materialized calendar,
-- NO scheduled auto-application (that would be M4-auto — see KL-9).
--
-- v1 CONDITION SET (vs the benchmarks' rate-plan levers):
--   • always       — blanket / seasonal base adjustment
--   • date_range   — festival / season / event window  [date_from..date_to]
--   • day_of_week  — weekend / weekday pricing          [days_of_week 0=Sun..6=Sat]
--   • occupancy    — demand threshold                   [occupancy_min %, fires when ctx >= min]
-- ADJUSTMENT: 'percent' (stacks multiplicatively) or 'absolute' (hard OVERRIDE,
-- terminal — wins over everything below it in priority). An "override" is just an
-- absolute rule; there is no separate overrides table.
-- PRECEDENCE: rules applied in deterministic order (priority ASC, created_at ASC,
-- id ASC); the first firing absolute terminates. Same inputs → same output.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ THE GST FIREWALL (the central constraint of this phase) — STRUCTURAL.      ║
-- ║  resolve_price reads ONLY: p_base, rate_rules, p_date, p_occupancy_pct.    ║
-- ║  It NEVER reads orgs.specified_premises, NEVER calls/duplicates resolve_gst,║
-- ║  and returns NO rate/gst/tax field — only a PRE-TAX selling figure.        ║
-- ║  resolve_gst reads ONLY: orgs.specified_premises + supply_type.            ║
-- ║  The two functions share NO table and NO call edge → their inputs are      ║
-- ║  DISJOINT. Therefore a pricing-rule change cannot move the GST rate, and a ║
-- ║  specified_premises flip cannot move resolve_price. Independence is by     ║
-- ║  CONSTRUCTION, not discipline. GST is applied downstream by the UNCHANGED  ║
-- ║  invoice/settlement engine via resolve_gst(org, supply_type).              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- PARKED (NOT M4's to decide): room_types.base_rate is GST-EXCLUSIVE today.
-- resolve_price treats the passed base as an opaque pre-tax number — it does NOT
-- rewrite base_rate and does NOT convert exclusive<->inclusive.
--
-- Atomic + audited + tenant-scoped (RLS default-deny + auth.uid() self-auth).
-- Cap `pricing.manage` gates rule WRITES; resolve_price (a selling-price read) is
-- open to any org member (it is the quoted price, not cost/margin).
-- ============================================================================

create table if not exists public.rate_rules (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  name             text not null,
  subject_type     text not null check (subject_type in ('room_type','hall')),  -- what it prices
  subject_id       uuid,                                  -- null = all subjects of that type; else a specific one (no FK — generic across room_types/halls)
  condition_type   text not null check (condition_type in ('always','date_range','day_of_week','occupancy')),
  date_from        date,
  date_to          date,
  days_of_week     int[],                                 -- 0=Sun..6=Sat
  occupancy_min    numeric(5,2),                          -- 0..100; fires when context occupancy >= this
  adjustment_kind  text not null check (adjustment_kind in ('percent','absolute')),
  adjustment_value numeric(12,2) not null,                -- percent: e.g. 20 / -10  |  absolute: a price
  priority         int not null default 100,              -- lower = higher precedence (applied first)
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- NO rate / gst / tax / supply_type column anywhere (the firewall).
  constraint chk_condition_fields check (
    (condition_type = 'always')
    or (condition_type = 'date_range'  and date_from is not null and date_to is not null and date_to >= date_from)
    or (condition_type = 'day_of_week' and days_of_week is not null and array_length(days_of_week, 1) >= 1)
    or (condition_type = 'occupancy'   and occupancy_min is not null)
  ),
  constraint chk_absolute_nonneg check (adjustment_kind <> 'absolute' or adjustment_value >= 0)
);
create index if not exists idx_rate_rules_lookup on public.rate_rules (org_id, subject_type, active, priority);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
alter table public.rate_rules enable row level security;
drop policy if exists rate_rules_member_select on public.rate_rules;
create policy rate_rules_member_select on public.rate_rules for select to authenticated using (public.is_org_member(org_id));
drop policy if exists rate_rules_service_all on public.rate_rules;
create policy rate_rules_service_all on public.rate_rules for all to service_role using (true) with check (true);

-- ============================================================================
-- upsert_rate_rule — create/update a pricing rule (cap pricing.manage). The
-- table CHECKs enforce condition completeness + non-negative absolute; a bad
-- combo fails the insert mid-RPC (atomicity: no row, no audit).
-- ============================================================================
create or replace function public.upsert_rate_rule(
  p_org uuid, p_name text, p_subject_type text, p_condition_type text,
  p_adjustment_kind text, p_adjustment_value numeric,
  p_subject_id uuid default null, p_priority int default 100,
  p_date_from date default null, p_date_to date default null,
  p_days_of_week int[] default null, p_occupancy_min numeric default null,
  p_active boolean default true, p_rule_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; d int;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'pricing.manage') then raise exception 'forbidden' using errcode='42501', detail='pricing.manage required'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'bad_name' using errcode='22023'; end if;
  if p_subject_type not in ('room_type','hall') then raise exception 'bad_subject_type' using errcode='22023'; end if;
  if p_condition_type not in ('always','date_range','day_of_week','occupancy') then raise exception 'bad_condition_type' using errcode='22023'; end if;
  if p_adjustment_kind not in ('percent','absolute') then raise exception 'bad_adjustment_kind' using errcode='22023'; end if;
  if p_days_of_week is not null then
    foreach d in array p_days_of_week loop
      if d < 0 or d > 6 then raise exception 'bad_dow' using errcode='22023'; end if;
    end loop;
  end if;

  if p_rule_id is null then
    insert into public.rate_rules(org_id, name, subject_type, subject_id, condition_type, date_from, date_to, days_of_week, occupancy_min, adjustment_kind, adjustment_value, priority, active)
      values (p_org, btrim(p_name), p_subject_type, p_subject_id, p_condition_type, p_date_from, p_date_to, p_days_of_week, p_occupancy_min, p_adjustment_kind, p_adjustment_value, coalesce(p_priority,100), coalesce(p_active,true))
      returning id into v_id;
  else
    update public.rate_rules set name = btrim(p_name), subject_type = p_subject_type, subject_id = p_subject_id,
        condition_type = p_condition_type, date_from = p_date_from, date_to = p_date_to, days_of_week = p_days_of_week,
        occupancy_min = p_occupancy_min, adjustment_kind = p_adjustment_kind, adjustment_value = p_adjustment_value,
        priority = coalesce(p_priority,100), active = coalesce(p_active,true), updated_at = now()
      where id = p_rule_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'rule_not_found' using errcode='P0002'; end if;
  end if;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'pricing.rule_upsert', 'completed', coalesce(p_actor_id, auth.uid()), 'rate_rule', v_id::text,
            jsonb_build_object('subject_type', p_subject_type, 'condition', p_condition_type, 'kind', p_adjustment_kind, 'priority', coalesce(p_priority,100)));
  return jsonb_build_object('rule_id', v_id);
end; $$;

-- ============================================================================
-- set_rate_rule_active — activate/deactivate a rule (cap pricing.manage).
-- ============================================================================
create or replace function public.set_rate_rule_active(p_org uuid, p_rule_id uuid, p_active boolean, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'pricing.manage') then raise exception 'forbidden' using errcode='42501', detail='pricing.manage required'; end if;
  update public.rate_rules set active = p_active, updated_at = now() where id = p_rule_id and org_id = p_org;
  if not found then raise exception 'rule_not_found' using errcode='P0002'; end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'pricing.rule_active', 'completed', coalesce(p_actor_id, auth.uid()), 'rate_rule', p_rule_id::text, jsonb_build_object('active', p_active));
  return jsonb_build_object('rule_id', p_rule_id, 'active', p_active);
end; $$;

-- ============================================================================
-- resolve_price — PURE READ. Computes the effective PRE-TAX SELLING price from a
-- base + context, applying matching active rules in deterministic precedence.
-- Returns the price + an ordered breakdown of which rules fired. Writes NOTHING.
-- Reads ONLY rate_rules (+ the given base/date/occupancy) — NOT specified_premises,
-- NOT resolve_gst. Returns NO rate/gst/tax field (the firewall). Open to members.
-- ============================================================================
create or replace function public.resolve_price(
  p_org uuid, p_subject_type text, p_subject_id uuid, p_base numeric,
  p_date date default null, p_occupancy_pct numeric default null
) returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  r record;
  v_price numeric(12,2) := round(coalesce(p_base, 0), 2);
  v_overridden boolean := false;
  v_fires boolean;
  v_steps jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;

  for r in
    select * from public.rate_rules
    where org_id = p_org and active and subject_type = p_subject_type
      and (subject_id is null or subject_id = p_subject_id)
    order by priority asc, created_at asc, id asc           -- DETERMINISTIC
  loop
    v_fires := case r.condition_type
      when 'always'      then true
      when 'date_range'  then (p_date is not null and p_date between r.date_from and r.date_to)
      when 'day_of_week' then (p_date is not null and extract(dow from p_date)::int = any(r.days_of_week))
      when 'occupancy'   then (p_occupancy_pct is not null and p_occupancy_pct >= r.occupancy_min)
      else false
    end;

    if v_fires then
      if r.adjustment_kind = 'percent' then
        v_price := round(v_price * (1 + r.adjustment_value / 100.0), 2);
      else
        v_price := round(r.adjustment_value, 2);
        v_overridden := true;
      end if;
    end if;

    v_steps := v_steps || jsonb_build_object(
      'rule_id', r.id, 'name', r.name, 'priority', r.priority, 'condition', r.condition_type,
      'kind', r.adjustment_kind, 'value', r.adjustment_value, 'fired', v_fires,
      'running_after', v_price);

    if v_fires and r.adjustment_kind = 'absolute' then exit; end if;   -- override is terminal
  end loop;

  -- PRE-TAX selling figure ONLY. NO rate/gst/tax/supply_type key (the firewall).
  return jsonb_build_object('base', round(coalesce(p_base,0),2), 'effective_price', v_price,
    'overridden', v_overridden, 'steps', v_steps);
end; $$;

-- ── grants ────────────────────────────────────────────────────────────────--
-- WRITES: revoke from public; the app role executes, and each RPC self-checks the
-- pricing.manage capability in-body.
do $$
declare fn text;
begin
  foreach fn in array array[
    'upsert_rate_rule(uuid,text,text,text,text,numeric,uuid,int,date,date,int[],numeric,boolean,uuid,uuid)',
    'set_rate_rule_active(uuid,uuid,boolean,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;

-- resolve_price: a MEMBER-OPEN READ (the quoted SELLING price, not cost/margin) —
-- executable by ANY authenticated org member. Cross-tenant access stays blocked by
-- the in-body is_org_member() self-auth, NOT by a capability. Same revoke-from-public
-- + grant-to-authenticated,service_role convention as roster_board / quote_summary.
revoke all    on function public.resolve_price(uuid,text,uuid,numeric,date,numeric) from public;
grant execute on function public.resolve_price(uuid,text,uuid,numeric,date,numeric) to authenticated, service_role;
