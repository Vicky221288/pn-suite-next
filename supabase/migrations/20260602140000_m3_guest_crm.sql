-- ============================================================================
-- M3 — GUEST CRM ENRICHMENT: interactions · LIVE LTV · special dates · message
--      templates · manual B3 send · review-request records
-- ----------------------------------------------------------------------------
-- Benchmarked vs Revinate / Salesforce Hospitality (NOT a legacy re-skin). All
-- on the SHARED W0 `guests` entity (invariant #7: one guest, many roles) —
-- never a parallel guest record.
--
--  A) INTERACTIONS — guest_interactions timeline (type/channel/note/when/actor).
--  B) LTV — COMPUTED LIVE by `guest_ltv` (a QUERY over finance_ledger,
--     invariant #10). NO ltv column anywhere. Revenue gated by pnl.view_margin
--     (consistent with hall_analytics / stays_report). Attribution: revenue
--     ledger rows (credit, hall/stays/catering) → their linked invoice →
--     event.guest_id OR room_stay.guest_id.
--  C) SPECIAL DATES — guest_special_dates (anniversary/birthday/…); data only.
--  D) MESSAGE TEMPLATES — message_templates (name, function_area for B3 sender
--     routing, channel, body with {{placeholders}}); org config, never a literal.
--  E) SENDING — STRICT B3 FIREWALL. ALL sends go through the B3 `enqueue_outbound`
--     ONLY (idempotent + quiet-hours-aware 21:00–07:00 IST; per-(org,function_area)
--     sender). NO new send path, NO wa.me, NO BSP SDK. M3 ships the MANUAL
--     "send template to guest now" RPC + review_requests records.
--
-- *** SPLIT (reported in STOP): the RECURRING/time-triggered outreach rules
--     (review-request on event-concluded; special-date anniversary/birthday) are
--     AUTOMATION and belong in the B4 registry. Each is a non-trivial rule with
--     its own harness surface, so to avoid bloating M3 they are DEFERRED to a
--     follow-on phase M3-auto (logged KL-8), exactly the M1a→M1b split discipline.
--     M3's data layer + manual send + review records stand alone. ***
--
-- Every write atomic + audited + tenant-scoped (RLS default-deny + auth.uid()
-- self-auth). Cap `crm.manage` gates CRM writes + manual send; LTV gated by
-- pnl.view_margin.
-- ============================================================================

-- ── A) guest_interactions — timeline on the shared W0 guest ──────────────────
create table if not exists public.guest_interactions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  guest_id         uuid not null references public.guests(id) on delete cascade,
  interaction_type text not null check (interaction_type in ('call','visit','message','note','email','other')),
  channel          text,
  note             text,
  occurred_at      timestamptz not null default now(),
  actor_id         uuid,
  created_at       timestamptz not null default now()
);
create index if not exists idx_guest_interactions_guest on public.guest_interactions (guest_id, occurred_at desc);
create index if not exists idx_guest_interactions_org on public.guest_interactions (org_id);

-- ── C) guest_special_dates — per-guest significant dates (data only) ─────────
create table if not exists public.guest_special_dates (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  guest_id   uuid not null references public.guests(id) on delete cascade,
  date_type  text not null check (date_type in ('anniversary','birthday','other')),
  the_date   date not null,
  label      text,
  created_at timestamptz not null default now(),
  constraint uq_special_date unique (org_id, guest_id, date_type, the_date)
);
create index if not exists idx_special_dates_guest on public.guest_special_dates (guest_id);

-- ── D) message_templates — org config; function_area routes the B3 sender ────
create table if not exists public.message_templates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  name          text not null,
  function_area text not null,                 -- routes to message_senders (org, function_area)
  channel       text not null default 'whatsapp',
  body          text not null,                 -- {{placeholder}} tokens
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists uq_message_templates_org_name on public.message_templates (org_id, lower(btrim(name)));

-- ── E) review_requests — solicitation state per guest/event ──────────────────
create table if not exists public.review_requests (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  guest_id            uuid not null references public.guests(id) on delete cascade,
  event_id            uuid references public.events(id) on delete set null,
  status              text not null default 'pending' check (status in ('pending','sent','responded','skipped')),
  outbound_message_id uuid references public.outbound_messages(id) on delete set null,
  requested_at        timestamptz,
  created_at          timestamptz not null default now(),
  constraint uq_review_guest_event unique (org_id, guest_id, event_id)  -- one per guest+event (NULL event → ad-hoc, distinct)
);
create index if not exists idx_review_requests_guest on public.review_requests (guest_id);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['guest_interactions','guest_special_dates','message_templates','review_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ── helper: render {{placeholder}} tokens from a jsonb payload (pure) ────────
create or replace function public.pn_render_template(p_body text, p_payload jsonb)
  returns text language plpgsql immutable set search_path = public as $$
declare v text := coalesce(p_body, ''); k text; val text;
begin
  for k, val in select key, value from jsonb_each_text(coalesce(p_payload, '{}'::jsonb)) loop
    v := replace(v, '{{' || k || '}}', coalesce(val, ''));
  end loop;
  return v;
end; $$;

-- ============================================================================
-- A) log_interaction — append to the guest's timeline (crm.manage).
-- ============================================================================
create or replace function public.log_interaction(
  p_org uuid, p_guest uuid, p_type text, p_channel text default null, p_note text default null,
  p_occurred_at timestamptz default now(), p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'crm.manage') then raise exception 'forbidden' using errcode='42501', detail='crm.manage required'; end if;
  if p_type not in ('call','visit','message','note','email','other') then raise exception 'bad_type' using errcode='22023'; end if;
  if not exists (select 1 from public.guests where id = p_guest and org_id = p_org) then raise exception 'guest_not_found' using errcode='P0002'; end if;
  insert into public.guest_interactions(org_id, guest_id, interaction_type, channel, note, occurred_at, actor_id)
    values (p_org, p_guest, p_type, p_channel, p_note, coalesce(p_occurred_at, now()), coalesce(p_actor_id, auth.uid()))
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'crm.interaction_log', 'completed', coalesce(p_actor_id, auth.uid()), 'guest_interaction', v_id::text, jsonb_build_object('type', p_type, 'guest_id', p_guest));
  return jsonb_build_object('interaction_id', v_id);
end; $$;

-- ============================================================================
-- B) guest_ltv — LIVE computation (a QUERY over finance_ledger). NO stored
-- column. Revenue gated by pnl.view_margin. (read)
-- ============================================================================
create or replace function public.guest_ltv(p_org uuid, p_guest uuid)
  returns jsonb language plpgsql security definer stable set search_path = public as $$
declare v_can boolean; v_ltv numeric(14,2);
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  v_can := (auth.uid() is null) or public.has_capability(p_org, 'pnl.view_margin');
  if not v_can then return jsonb_build_object('can_see', false, 'ltv', null, 'guest_id', p_guest); end if;
  select coalesce(sum(fl.amount), 0) into v_ltv
    from public.finance_ledger fl
    where fl.org_id = p_org and fl.direction = 'credit'
      and fl.source_domain in ('hall','stays','catering')
      and fl.linked_entity_type = 'invoice'
      and fl.linked_entity_id in (
        select i.id::text from public.invoices i
        where i.org_id = p_org and (
          i.event_id in (select e.id from public.events e where e.org_id = p_org and e.guest_id = p_guest)
          or i.stay_id in (select rs.id from public.room_stays rs where rs.org_id = p_org and rs.guest_id = p_guest)
        )
      );
  return jsonb_build_object('can_see', true, 'ltv', v_ltv, 'guest_id', p_guest);
end; $$;

-- ============================================================================
-- C) set_special_date — per-guest significant date (crm.manage). Upsert by key.
-- ============================================================================
create or replace function public.set_special_date(
  p_org uuid, p_guest uuid, p_date_type text, p_the_date date, p_label text default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'crm.manage') then raise exception 'forbidden' using errcode='42501', detail='crm.manage required'; end if;
  if p_date_type not in ('anniversary','birthday','other') then raise exception 'bad_date_type' using errcode='22023'; end if;
  if not exists (select 1 from public.guests where id = p_guest and org_id = p_org) then raise exception 'guest_not_found' using errcode='P0002'; end if;
  insert into public.guest_special_dates(org_id, guest_id, date_type, the_date, label)
    values (p_org, p_guest, p_date_type, p_the_date, p_label)
    on conflict (org_id, guest_id, date_type, the_date) do update set label = excluded.label
    returning id into v_id;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'crm.special_date_set', 'completed', coalesce(p_actor_id, auth.uid()), 'guest_special_date', v_id::text, jsonb_build_object('type', p_date_type, 'guest_id', p_guest));
  return jsonb_build_object('special_date_id', v_id);
end; $$;

-- ============================================================================
-- D) upsert_message_template — reusable template (crm.manage). function_area
-- routes the B3 sender; body carries {{placeholders}}.
-- ============================================================================
create or replace function public.upsert_message_template(
  p_org uuid, p_name text, p_function_area text, p_body text, p_channel text default 'whatsapp',
  p_template_id uuid default null, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'crm.manage') then raise exception 'forbidden' using errcode='42501', detail='crm.manage required'; end if;
  if coalesce(btrim(p_name),'') = '' or coalesce(btrim(p_function_area),'') = '' or coalesce(btrim(p_body),'') = '' then raise exception 'bad_template' using errcode='22023'; end if;
  if p_template_id is null then
    insert into public.message_templates(org_id, name, function_area, channel, body)
      values (p_org, btrim(p_name), btrim(p_function_area), p_channel, p_body) returning id into v_id;
  else
    update public.message_templates set name = btrim(p_name), function_area = btrim(p_function_area), channel = p_channel, body = p_body, updated_at = now()
      where id = p_template_id and org_id = p_org returning id into v_id;
    if v_id is null then raise exception 'template_not_found' using errcode='P0002'; end if;
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id)
    values (p_org, 'crm.template_upsert', 'completed', coalesce(p_actor_id, auth.uid()), 'message_template', v_id::text);
  return jsonb_build_object('template_id', v_id);
end; $$;

-- ============================================================================
-- E) send_template_to_guest — MANUAL send NOW. STRICT B3 FIREWALL: the ONLY
-- send path is enqueue_outbound (idempotent + quiet-hours-aware). Renders the
-- template body with the payload. (crm.manage.)
-- ============================================================================
create or replace function public.send_template_to_guest(
  p_org uuid, p_guest uuid, p_template_id uuid, p_payload jsonb default '{}',
  p_idempotency_key text default null, p_now timestamptz default now(), p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g record; v_t record; v_render text; v_key text; v_payload jsonb; v_res jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'crm.manage') then raise exception 'forbidden' using errcode='42501', detail='crm.manage required'; end if;
  select id, name, phone into v_g from public.guests where id = p_guest and org_id = p_org;
  if v_g.id is null then raise exception 'guest_not_found' using errcode='P0002'; end if;
  select id, name, function_area, body into v_t from public.message_templates where id = p_template_id and org_id = p_org;
  if v_t.id is null then raise exception 'template_not_found' using errcode='P0002'; end if;

  v_render  := public.pn_render_template(v_t.body, p_payload);
  v_key     := coalesce(p_idempotency_key, 'crm-send:' || p_template_id::text || ':' || p_guest::text || ':' || gen_random_uuid()::text);
  v_payload := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('rendered', v_render);

  -- THE ONLY SEND PATH (B3). Raises 'no_sender' if no (org, function_area) sender.
  v_res := public.enqueue_outbound(p_org, v_t.function_area, v_g.phone, v_t.name, v_payload, v_key, 'template', p_now);

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'crm.template_send', 'completed', coalesce(p_actor_id, auth.uid()), 'guest', p_guest::text,
            jsonb_build_object('template_id', p_template_id, 'outbound_id', v_res->>'id', 'status', v_res->>'status'));
  return v_res || jsonb_build_object('rendered', v_render);
end; $$;

-- ============================================================================
-- E) create_review_request — record solicitation state + send via B3 (manual).
-- Idempotent per (guest, event). Two writes in ONE tx: the record insert then
-- enqueue_outbound — a missing sender raises mid-tx and rolls back the record
-- (atomicity). (crm.manage.)
-- ============================================================================
create or replace function public.create_review_request(
  p_org uuid, p_guest uuid, p_template_id uuid, p_event uuid default null,
  p_idempotency_key text default null, p_now timestamptz default now(), p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g record; v_t record; v_existing uuid; v_rr uuid; v_render text; v_key text; v_res jsonb;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'crm.manage') then raise exception 'forbidden' using errcode='42501', detail='crm.manage required'; end if;
  select id, name, phone into v_g from public.guests where id = p_guest and org_id = p_org;
  if v_g.id is null then raise exception 'guest_not_found' using errcode='P0002'; end if;
  select id, name, function_area, body into v_t from public.message_templates where id = p_template_id and org_id = p_org;
  if v_t.id is null then raise exception 'template_not_found' using errcode='P0002'; end if;
  if p_event is not null and not exists (select 1 from public.events where id = p_event and org_id = p_org) then raise exception 'event_not_found' using errcode='P0002'; end if;

  -- idempotent per (guest, event) when event present
  if p_event is not null then
    select id into v_existing from public.review_requests where org_id = p_org and guest_id = p_guest and event_id = p_event;
    if v_existing is not null then return jsonb_build_object('review_request_id', v_existing, 'idempotent', true); end if;
  end if;

  insert into public.review_requests(org_id, guest_id, event_id, status, requested_at)
    values (p_org, p_guest, p_event, 'pending', coalesce(p_now, now())) returning id into v_rr;   -- write 1

  v_render := public.pn_render_template(v_t.body, jsonb_build_object('guest', v_g.name));
  v_key    := coalesce(p_idempotency_key, 'review:' || p_guest::text || ':' || coalesce(p_event::text, 'adhoc') || ':' || v_rr::text);
  -- write 2 (B3) — raises 'no_sender' mid-tx if no sender ⇒ write 1 rolls back
  v_res := public.enqueue_outbound(p_org, v_t.function_area, v_g.phone, v_t.name,
             jsonb_build_object('rendered', v_render, 'kind', 'review_request'), v_key, 'template', p_now);

  update public.review_requests set status = 'sent', outbound_message_id = (v_res->>'id')::uuid where id = v_rr;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'crm.review_request', 'completed', coalesce(p_actor_id, auth.uid()), 'review_request', v_rr::text,
            jsonb_build_object('guest_id', p_guest, 'event_id', p_event, 'outbound_id', v_res->>'id'));
  return jsonb_build_object('review_request_id', v_rr, 'send', v_res, 'idempotent', false);
end; $$;

-- ── grants (RPC is the only write path; revoke from public, grant to the app) ─
do $$
declare fn text;
begin
  foreach fn in array array[
    'pn_render_template(text,jsonb)',
    'log_interaction(uuid,uuid,text,text,text,timestamptz,uuid)',
    'guest_ltv(uuid,uuid)',
    'set_special_date(uuid,uuid,text,date,text,uuid)',
    'upsert_message_template(uuid,text,text,text,text,uuid,uuid)',
    'send_template_to_guest(uuid,uuid,uuid,jsonb,text,timestamptz,uuid)',
    'create_review_request(uuid,uuid,uuid,uuid,text,timestamptz,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to authenticated, service_role', fn);
  end loop;
end $$;
