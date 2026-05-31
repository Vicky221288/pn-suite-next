-- ============================================================================
-- W1b — CATERING: ENQUIRY → QUOTE → PACKAGE (OP MODEL v2 §3.2; the revenue door)
-- ----------------------------------------------------------------------------
-- Reuses the shared core: enquiry create-or-links a Guest via W0
-- find_or_create_guest (phone is the key — no duplicate Guest); quote cost rolls
-- up via W1a scale_recipe (live cost). Quotes store SELLING prices (point-in-time
-- offer); margin is computed LIVE at view time and is capability-gated server-side
-- (Owner/PM via pnl.view_margin OR Catering-Lead via catering.view_cost). Quotes
-- do NOT post to the finance ledger — that's billing (W1e). Config-driven GST
-- (supply-type tag on menu items; no rate here). Atomic + audited + org-scoped.
-- ============================================================================

-- ── Catering enquiry (links to a shared Guest) ───────────────────────────────
create table if not exists public.catering_enquiries (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  guest_id      uuid not null references public.guests(id) on delete restrict,
  event_type    text,
  event_date    date,
  guest_count   int check (guest_count is null or guest_count >= 0),
  contact_name  text,
  contact_phone text,
  status        text not null default 'new' check (status in ('new','quoting','quoted','won','lost')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_cat_enq_org on public.catering_enquiries (org_id, created_at desc);
create index if not exists idx_cat_enq_guest on public.catering_enquiries (org_id, guest_id);

-- ── Package = reusable menu+price template ("Standard Veg Wedding") ──────────
create table if not exists public.catering_packages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- normalized-name uniqueness as a unique INDEX (table-level UNIQUE can't take an
-- expression — the W1a f9ed6ce lesson).
create unique index if not exists uq_cat_pkg_org_name on public.catering_packages (org_id, lower(btrim(name)));
create index if not exists idx_cat_pkg_org on public.catering_packages (org_id);

create table if not exists public.catering_package_items (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs(id) on delete cascade,
  package_id         uuid not null references public.catering_packages(id) on delete cascade,
  menu_item_id       uuid not null references public.catering_menu_items(id) on delete restrict,
  unit_selling_price numeric(12,2) not null default 0 check (unit_selling_price >= 0),  -- per plate
  constraint uq_pkg_item unique (package_id, menu_item_id)
);
create index if not exists idx_pkg_items_pkg on public.catering_package_items (package_id);

-- ── Quote (point-in-time offer) + lines (selling stored; cost computed live) ──
create table if not exists public.catering_quotes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  enquiry_id  uuid not null references public.catering_enquiries(id) on delete cascade,
  guest_id    uuid not null references public.guests(id) on delete restrict,
  guest_count int not null check (guest_count >= 0),
  status      text not null default 'draft' check (status in ('draft','sent','accepted','rejected')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_cat_quote_org on public.catering_quotes (org_id, created_at desc);
create index if not exists idx_cat_quote_enq on public.catering_quotes (enquiry_id);

create table if not exists public.catering_quote_lines (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs(id) on delete cascade,
  quote_id           uuid not null references public.catering_quotes(id) on delete cascade,
  menu_item_id       uuid not null references public.catering_menu_items(id) on delete restrict,
  unit_selling_price numeric(12,2) not null check (unit_selling_price >= 0),  -- per plate, point-in-time
  constraint uq_quote_line unique (quote_id, menu_item_id)
);
create index if not exists idx_quote_lines_quote on public.catering_quote_lines (quote_id);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC).
--    Note: lines store SELLING only — never cost — so reading them can't leak
--    margin; cost/margin come only from quote_summary (capability-gated). ──────
do $$
declare t text;
begin
  foreach t in array array['catering_enquiries','catering_packages','catering_package_items','catering_quotes','catering_quote_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ============================================================================
-- create_catering_enquiry — capture a lead; create-or-LINK a shared Guest (W0).
-- ============================================================================
create or replace function public.create_catering_enquiry(
  p_org uuid, p_event_type text, p_event_date date, p_guest_count int,
  p_contact_name text, p_contact_phone text, p_notes text default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g jsonb; v_guest_id uuid; v_created boolean; v_enq_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  -- REUSE the shared-core Guest dedup (phone is the key) — never duplicate Guest
  v_g := public.find_or_create_guest(p_org, p_contact_phone, p_contact_name, null, null, null, '{}', '{}', p_actor_id);
  v_guest_id := (v_g->>'guest_id')::uuid;
  v_created := (v_g->>'created')::boolean;

  insert into public.catering_enquiries(org_id, guest_id, event_type, event_date, guest_count, contact_name, contact_phone, notes)
    values (p_org, v_guest_id, p_event_type, p_event_date, p_guest_count, p_contact_name, p_contact_phone, p_notes)
    returning id into v_enq_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'catering.enquiry_create', 'completed', coalesce(p_actor_id, auth.uid()), 'catering_enquiry', v_enq_id::text,
            jsonb_build_object('guest_id', v_guest_id, 'guest_created', v_created, 'event_type', p_event_type));
  return jsonb_build_object('enquiry_id', v_enq_id, 'guest_id', v_guest_id, 'guest_created', v_created);
end; $$;

-- ============================================================================
-- upsert_package — reusable menu+price template; replaces items atomically.
-- p_items = jsonb [{ menu_item_id, unit_selling_price }].
-- ============================================================================
create or replace function public.upsert_package(
  p_org uuid, p_name text, p_description text, p_items jsonb, p_package_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pkg_id uuid; v_line jsonb; v_item_org uuid; v_count int := 0;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_package_id is null then
    insert into public.catering_packages(org_id, name, description) values (p_org, btrim(p_name), p_description) returning id into v_pkg_id;
  else
    update public.catering_packages set name = btrim(p_name), description = p_description, updated_at = now()
      where id = p_package_id and org_id = p_org returning id into v_pkg_id;
    if v_pkg_id is null then raise exception 'package_not_found' using errcode='P0002'; end if;
  end if;
  delete from public.catering_package_items where package_id = v_pkg_id;
  for v_line in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    select org_id into v_item_org from public.catering_menu_items where id = (v_line->>'menu_item_id')::uuid;
    if v_item_org is null or v_item_org <> p_org then raise exception 'menu_item_not_in_org' using errcode='42501'; end if;
    insert into public.catering_package_items(org_id, package_id, menu_item_id, unit_selling_price)
      values (p_org, v_pkg_id, (v_line->>'menu_item_id')::uuid, coalesce((v_line->>'unit_selling_price')::numeric, 0));
    v_count := v_count + 1;
  end loop;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'catering.package_upsert', 'completed', coalesce(p_actor_id, auth.uid()), 'catering_package', v_pkg_id::text,
            jsonb_build_object('name', btrim(p_name), 'items', v_count));
  return jsonb_build_object('package_id', v_pkg_id, 'items', v_count);
end; $$;

-- ============================================================================
-- create_quote — compose lines (explicit p_lines OR pre-fill from a package).
-- unit_selling_price defaults: provided → package price → menu default.
-- ============================================================================
create or replace function public.create_quote(
  p_org uuid, p_enquiry_id uuid, p_guest_count int, p_lines jsonb default '[]'::jsonb,
  p_package_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_guest_id uuid; v_quote_id uuid; v_line jsonb; v_mid uuid; v_price numeric; v_count int := 0; v_src jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select guest_id into v_guest_id from public.catering_enquiries where id = p_enquiry_id and org_id = p_org;
  if v_guest_id is null then raise exception 'enquiry_not_found' using errcode='P0002'; end if;

  insert into public.catering_quotes(org_id, enquiry_id, guest_id, guest_count, status)
    values (p_org, p_enquiry_id, v_guest_id, p_guest_count, 'draft') returning id into v_quote_id;

  -- source lines: explicit, else pre-fill from the package's items
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb)) > 0 then
    v_src := p_lines;
  elsif p_package_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('menu_item_id', menu_item_id, 'unit_selling_price', unit_selling_price)), '[]'::jsonb)
      into v_src from public.catering_package_items where package_id = p_package_id and org_id = p_org;
  else
    v_src := '[]'::jsonb;
  end if;

  for v_line in select * from jsonb_array_elements(v_src) loop
    v_mid := (v_line->>'menu_item_id')::uuid;
    select default_selling_price into v_price from public.catering_menu_items where id = v_mid and org_id = p_org;
    if v_price is null then raise exception 'menu_item_not_in_org' using errcode='42501'; end if;
    v_price := coalesce((v_line->>'unit_selling_price')::numeric, v_price);  -- provided/package price overrides default
    insert into public.catering_quote_lines(org_id, quote_id, menu_item_id, unit_selling_price)
      values (p_org, v_quote_id, v_mid, v_price);
    v_count := v_count + 1;
  end loop;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'catering.quote_create', 'completed', coalesce(p_actor_id, auth.uid()), 'catering_quote', v_quote_id::text,
            jsonb_build_object('enquiry_id', p_enquiry_id, 'guest_count', p_guest_count, 'lines', v_count, 'from_package', p_package_id));
  return jsonb_build_object('quote_id', v_quote_id, 'lines', v_count);
end; $$;

-- ============================================================================
-- quote_summary — read-only. Selling is always shown; food cost + margin are
-- computed LIVE (W1a scale_recipe) and ONLY returned if the caller holds
-- pnl.view_margin OR catering.view_cost (server-side enforced). service_role
-- (system) sees cost. STABLE.
-- ============================================================================
create or replace function public.quote_summary(p_org uuid, p_quote_id uuid)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare
  v_q public.catering_quotes%rowtype; v_can_cost boolean; v_lines jsonb;
  v_total_sell numeric(14,2) := 0; v_total_cost numeric(14,2) := 0; r record; v_line_cost numeric(14,2); v_line_sell numeric(14,2);
  v_arr jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_q from public.catering_quotes where id = p_quote_id and org_id = p_org;
  if not found then raise exception 'quote_not_found' using errcode='P0002'; end if;

  v_can_cost := (auth.uid() is null)
                or public.has_capability(p_org, 'pnl.view_margin')
                or public.has_capability(p_org, 'catering.view_cost');

  for r in
    select ql.menu_item_id, ql.unit_selling_price, mi.name
    from public.catering_quote_lines ql join public.catering_menu_items mi on mi.id = ql.menu_item_id
    where ql.quote_id = p_quote_id order by mi.name
  loop
    v_line_sell := round(r.unit_selling_price * v_q.guest_count, 2);
    v_total_sell := v_total_sell + v_line_sell;
    if v_can_cost then
      v_line_cost := coalesce((public.scale_recipe(p_org, r.menu_item_id, v_q.guest_count)->>'total_food_cost')::numeric, 0);
      v_total_cost := v_total_cost + v_line_cost;
    else
      v_line_cost := null;
    end if;
    v_arr := v_arr || jsonb_build_object(
      'menu_item_id', r.menu_item_id, 'name', r.name, 'unit_selling_price', r.unit_selling_price,
      'line_selling', v_line_sell,
      'line_food_cost', case when v_can_cost then v_line_cost else null end,
      'line_margin', case when v_can_cost then round(v_line_sell - v_line_cost, 2) else null end);
  end loop;

  return jsonb_build_object(
    'quote_id', p_quote_id, 'guest_count', v_q.guest_count, 'status', v_q.status,
    'can_see_cost', v_can_cost, 'total_selling', v_total_sell,
    'total_food_cost', case when v_can_cost then v_total_cost else null end,
    'total_margin', case when v_can_cost then round(v_total_sell - v_total_cost, 2) else null end,
    'lines', v_arr);
end; $$;

-- grants
do $$
declare fn text;
begin
  foreach fn in array array[
    'create_catering_enquiry(uuid,text,date,int,text,text,text,uuid)',
    'upsert_package(uuid,text,text,jsonb,uuid,uuid)',
    'create_quote(uuid,uuid,int,jsonb,uuid,uuid)',
    'quote_summary(uuid,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
