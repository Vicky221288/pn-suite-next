-- ============================================================================
-- W1c — CATERING BEO (Banquet Event Order) on the SHARED Event (OP MODEL v2 §3.2)
-- ----------------------------------------------------------------------------
-- A BEO is a DOCUMENT + lifecycle (draft→sent→signed), not money movement. It
-- attaches to the shared `events` spine — one wedding = ONE Event carrying hall
-- + catering (invariant #8). Multiple BEOs per event (kitchen + FOH). Signed BEO
-- is immutable; changes require a new version. Atomic + audited + tenant-scoped.
-- ============================================================================

-- ── Extend the shared Event so it can also represent a standalone catering job
--    (no hall booking) and carry the shared Guest. Loosening NOT NULL is safe
--    (events has 0 rows; existing-shape inserts still provide booking_id+slot). ─
alter table public.events alter column booking_id drop not null;
alter table public.events alter column slot drop not null;
alter table public.events add column if not exists guest_id   uuid references public.guests(id) on delete set null;
alter table public.events add column if not exists event_type text;
create index if not exists idx_events_guest on public.events (org_id, guest_id, event_date);

-- ── BEO header ───────────────────────────────────────────────────────────────
create table if not exists public.catering_beos (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs(id) on delete cascade,
  event_id             uuid not null references public.events(id) on delete cascade,        -- the SHARED Event
  guest_id             uuid not null references public.guests(id) on delete restrict,
  source_quote_id      uuid references public.catering_quotes(id) on delete set null,
  beo_type             text not null check (beo_type in ('kitchen','foh')),                 -- extensible (more types = 1-line check change)
  version              int  not null default 1 check (version >= 1),
  status               text not null default 'draft' check (status in ('draft','sent','signed')),
  guest_count          int  not null check (guest_count >= 0),                              -- expected headcount
  guest_guarantee      int  not null check (guest_guarantee >= 0),                          -- CONTRACTED minimum billable (W1e bills max(actual,guarantee))
  service_date         date,
  service_time         text,
  venue                text,
  timeline             text,
  special_instructions text,
  dietary_flags        text[] not null default '{}',                                        -- pulled from the Guest
  signed_by_name       text,
  signed_at            timestamptz,
  signed_method        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint uq_beo_event_type_version unique (event_id, beo_type, version)
);
create index if not exists idx_beos_org on public.catering_beos (org_id, created_at desc);
create index if not exists idx_beos_event on public.catering_beos (event_id);

-- ── BEO menu lines (snapshot of the accepted quote — immutable document) ─────
create table if not exists public.catering_beo_lines (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  beo_id       uuid not null references public.catering_beos(id) on delete cascade,
  menu_item_id uuid references public.catering_menu_items(id) on delete set null,
  name         text not null,                       -- snapshotted name (document stays valid if menu changes)
  constraint uq_beo_line unique (beo_id, menu_item_id)
);
create index if not exists idx_beo_lines_beo on public.catering_beo_lines (beo_id);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['catering_beos','catering_beo_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ============================================================================
-- accept_quote — mark a quote accepted (the trigger for a BEO). Sets enquiry won.
-- ============================================================================
create or replace function public.accept_quote(p_org uuid, p_quote_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_enq uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  update public.catering_quotes set status = 'accepted', updated_at = now()
    where id = p_quote_id and org_id = p_org and status in ('draft','sent') returning enquiry_id into v_enq;
  if v_enq is null then raise exception 'quote_not_acceptable' using errcode='P0002'; end if;
  update public.catering_enquiries set status = 'won', updated_at = now() where id = v_enq and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'catering.quote_accept', 'completed', coalesce(p_actor_id, auth.uid()), 'catering_quote', p_quote_id::text);
  return jsonb_build_object('quote_id', p_quote_id, 'enquiry_id', v_enq);
end; $$;

-- ============================================================================
-- generate_beo — from an ACCEPTED quote, produce a BEO on the SHARED Event.
-- Finds the Guest's existing Event for that date (one wedding, one Event) or
-- creates one on the spine (no parallel catering-only event object). Snapshots
-- the quote's menu; pulls dietary flags from the Guest. New version if a BEO of
-- that type already exists (supports the post-signing "new version" path).
-- ============================================================================
create or replace function public.generate_beo(
  p_org uuid, p_quote_id uuid, p_beo_type text, p_guest_guarantee int,
  p_service_time text default null, p_venue text default null, p_timeline text default null,
  p_special text default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_q public.catering_quotes%rowtype; v_event_date date; v_guest_id uuid;
  v_event_id uuid; v_event_created boolean := false; v_dietary text[]; v_version int; v_beo_id uuid; v_count int := 0;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_beo_type not in ('kitchen','foh') then raise exception 'bad_beo_type' using errcode='22023'; end if;

  select * into v_q from public.catering_quotes where id = p_quote_id and org_id = p_org;
  if not found then raise exception 'quote_not_found' using errcode='P0002'; end if;
  if v_q.status <> 'accepted' then raise exception 'quote_not_accepted' using errcode='22023'; end if;
  v_guest_id := v_q.guest_id;
  select event_date into v_event_date from public.catering_enquiries where id = v_q.enquiry_id and org_id = p_org;

  -- attach to the Guest's existing Event for that date (one wedding → one Event),
  -- else create one on the SHARED spine (no fork)
  select id into v_event_id from public.events
    where org_id = p_org and guest_id = v_guest_id and event_date is not distinct from v_event_date limit 1;
  if v_event_id is null then
    insert into public.events(org_id, guest_id, event_date, status, event_type, guest_count)
      values (p_org, v_guest_id, v_event_date, 'planning', 'catering', v_q.guest_count)
      returning id into v_event_id;
    v_event_created := true;
  end if;

  select dietary_flags into v_dietary from public.guests where id = v_guest_id;
  select coalesce(max(version),0) + 1 into v_version from public.catering_beos where event_id = v_event_id and beo_type = p_beo_type;

  insert into public.catering_beos(org_id, event_id, guest_id, source_quote_id, beo_type, version, status,
                                   guest_count, guest_guarantee, service_date, service_time, venue, timeline,
                                   special_instructions, dietary_flags)
    values (p_org, v_event_id, v_guest_id, p_quote_id, p_beo_type, v_version, 'draft',
            v_q.guest_count, p_guest_guarantee, v_event_date, p_service_time, p_venue, p_timeline,
            p_special, coalesce(v_dietary,'{}'))
    returning id into v_beo_id;

  -- snapshot the menu from the accepted quote's lines
  insert into public.catering_beo_lines(org_id, beo_id, menu_item_id, name)
    select p_org, v_beo_id, ql.menu_item_id, mi.name
    from public.catering_quote_lines ql join public.catering_menu_items mi on mi.id = ql.menu_item_id
    where ql.quote_id = p_quote_id;
  get diagnostics v_count = row_count;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'catering.beo_generate', 'completed', coalesce(p_actor_id, auth.uid()), 'catering_beo', v_beo_id::text,
            jsonb_build_object('event_id', v_event_id, 'event_created', v_event_created, 'beo_type', p_beo_type, 'version', v_version, 'lines', v_count));
  return jsonb_build_object('beo_id', v_beo_id, 'event_id', v_event_id, 'event_created', v_event_created,
                            'beo_type', p_beo_type, 'version', v_version, 'lines', v_count);
end; $$;

-- ============================================================================
-- update_beo — edit mutable fields ONLY while not signed (immutability).
-- ============================================================================
create or replace function public.update_beo(
  p_org uuid, p_beo_id uuid, p_guest_guarantee int default null, p_service_time text default null,
  p_venue text default null, p_timeline text default null, p_special text default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select status into v_status from public.catering_beos where id = p_beo_id and org_id = p_org;
  if v_status is null then raise exception 'beo_not_found' using errcode='P0002'; end if;
  if v_status = 'signed' then raise exception 'beo_signed_immutable' using errcode='22023', detail='signed BEOs are immutable — generate a new version'; end if;
  update public.catering_beos set
    guest_guarantee      = coalesce(p_guest_guarantee, guest_guarantee),
    service_time         = coalesce(p_service_time, service_time),
    venue                = coalesce(p_venue, venue),
    timeline             = coalesce(p_timeline, timeline),
    special_instructions = coalesce(p_special, special_instructions),
    updated_at = now()
  where id = p_beo_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'catering.beo_update', 'completed', coalesce(p_actor_id, auth.uid()), 'catering_beo', p_beo_id::text);
  return jsonb_build_object('beo_id', p_beo_id, 'ok', true);
end; $$;

-- ============================================================================
-- send_beo / sign_beo — the e-sign lifecycle. Signing is terminal + records the
-- signature; immutable thereafter.
-- ============================================================================
create or replace function public.send_beo(p_org uuid, p_beo_id uuid, p_actor_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select status into v_status from public.catering_beos where id = p_beo_id and org_id = p_org;
  if v_status is null then raise exception 'beo_not_found' using errcode='P0002'; end if;
  if v_status <> 'draft' then raise exception 'beo_not_draft' using errcode='22023', detail=v_status; end if;
  update public.catering_beos set status = 'sent', updated_at = now() where id = p_beo_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'catering.beo_send', 'completed', coalesce(p_actor_id, auth.uid()), 'catering_beo', p_beo_id::text);
  return jsonb_build_object('beo_id', p_beo_id, 'status', 'sent');
end; $$;

create or replace function public.sign_beo(
  p_org uuid, p_beo_id uuid, p_signed_by_name text, p_signed_method text default 'click', p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_signed_by_name is null or btrim(p_signed_by_name) = '' then raise exception 'signature_required' using errcode='22023'; end if;
  select status into v_status from public.catering_beos where id = p_beo_id and org_id = p_org;
  if v_status is null then raise exception 'beo_not_found' using errcode='P0002'; end if;
  if v_status = 'signed' then raise exception 'already_signed' using errcode='22023'; end if;
  if v_status <> 'sent' then raise exception 'beo_not_sent' using errcode='22023', detail=v_status; end if;
  update public.catering_beos set status = 'signed', signed_by_name = btrim(p_signed_by_name), signed_at = now(),
         signed_method = p_signed_method, updated_at = now()
    where id = p_beo_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'catering.beo_sign', 'completed', coalesce(p_actor_id, auth.uid()), 'catering_beo', p_beo_id::text,
            jsonb_build_object('signed_by', btrim(p_signed_by_name), 'method', p_signed_method));
  return jsonb_build_object('beo_id', p_beo_id, 'status', 'signed');
end; $$;

-- grants
do $$
declare fn text;
begin
  foreach fn in array array[
    'accept_quote(uuid,uuid,uuid)',
    'generate_beo(uuid,uuid,text,int,text,text,text,text,uuid)',
    'update_beo(uuid,uuid,int,text,text,text,text,uuid)',
    'send_beo(uuid,uuid,uuid)',
    'sign_beo(uuid,uuid,text,text,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
