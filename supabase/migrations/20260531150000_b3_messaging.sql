-- ============================================================================
-- B3 — MESSAGING FOUNDATION (OP MODEL §6; fixes AUDIT-2.0 F-AUTO-01)
-- ----------------------------------------------------------------------------
-- Multi-sender by design: PN runs TWO WhatsApp numbers (function areas: 'stays'
-- and 'hall_catering'), each its own advertised number + BSP registration. A
-- message routes to a sender by (org_id, function_area); inbound routes by the
-- number it arrived on. All outbound is idempotent + quiet-hours-aware
-- (21:00–07:00 IST). All inbound is dedup/replay-safe and creates leads through
-- the atomic path (B1) under tenant RLS (B2). Live BSP wiring (AiSensy) is the
-- app-layer adapter, deferred; this layer is provider-agnostic.
-- ============================================================================

-- ── Sender registry (per org, per function area) ────────────────────────────
-- function_area is config-driven: adding a number = a row; the set of valid
-- areas IS this table (a message with no sender row → 'no_sender').
create table if not exists public.message_senders (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  function_area text not null,                 -- e.g. 'stays', 'hall_catering'
  display_name  text not null,
  phone_number  text not null,                 -- advertised number; routes inbound
  provider      text not null default 'mock' check (provider in ('mock','aisensy')),
  config        jsonb not null default '{}',   -- non-secret provider refs only
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint uq_sender_org_area unique (org_id, function_area),
  constraint uq_sender_number   unique (phone_number)
);
create index if not exists idx_senders_org on public.message_senders (org_id);

-- ── Outbound log = the mock "sent" record + idempotency + quiet-hours queue ──
create table if not exists public.outbound_messages (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  function_area       text not null,
  sender_id           uuid not null references public.message_senders(id) on delete restrict,
  recipient           text not null,
  kind                text not null default 'template' check (kind in ('template','session')),
  template            text,
  payload             jsonb not null default '{}',
  idempotency_key     text not null,
  status              text not null check (status in ('sent','deferred','failed')),
  provider_message_id text,
  scheduled_for       timestamptz,             -- set when deferred for quiet hours
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  constraint uq_outbound_idem unique (org_id, idempotency_key)
);
create index if not exists idx_outbound_org on public.outbound_messages (org_id, created_at desc);
create index if not exists idx_outbound_deferred on public.outbound_messages (scheduled_for) where status = 'deferred';

-- ── Inbound dedup/replay table ───────────────────────────────────────────────
create table if not exists public.inbound_messages (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  function_area       text not null,
  provider            text not null,
  provider_message_id text not null,
  from_phone          text not null,
  to_phone            text not null,
  body                text,
  raw                 jsonb,
  lead_id             uuid,
  received_at         timestamptz not null default now(),
  constraint uq_inbound_provider_msg unique (provider, provider_message_id)
);
create index if not exists idx_inbound_org on public.inbound_messages (org_id, received_at desc);

-- ── Leads (B3 lean subset of the §5.1 enquiry spine; full model later) ───────
create table if not exists public.leads (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  function_area text not null,
  phone         text not null,
  name          text,
  source        text not null default 'whatsapp_inbound',
  status        text not null default 'new' check (status in ('new','qualifying','quoted','won','lost','dormant')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_lead_org_phone unique (org_id, phone)   -- dedup: one lead per number per org
);
create index if not exists idx_leads_org on public.leads (org_id, created_at desc);

-- ── RLS: tenant-scoped default-deny (members SELECT own org; writes via RPC) ──
do $$
declare t text;
begin
  foreach t in array array['message_senders','outbound_messages','inbound_messages','leads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select to authenticated using (public.is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ============================================================================
-- enqueue_outbound — atomic outbound (idempotent + multi-sender + quiet-hours).
-- System/automation path (service_role). Mock "send" = recording this row.
-- The live AiSensy adapter will call this to reserve idempotently + decide
-- deferral, then perform the HTTP send + status update (documented seam).
-- ============================================================================
create or replace function public.enqueue_outbound(
  p_org_id          uuid,
  p_function_area   text,
  p_recipient       text,
  p_template        text,
  p_payload         jsonb,
  p_idempotency_key text,
  p_kind            text        default 'template',
  p_now             timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing  public.outbound_messages%rowtype;
  v_sender    public.message_senders%rowtype;
  v_ist       timestamp;
  v_hour      int;
  v_status    text;
  v_sched     timestamptz;
  v_pmid      text;
  v_id        uuid;
begin
  -- idempotency: same key → return prior result, never double-send
  select * into v_existing from public.outbound_messages
    where org_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('id', v_existing.id, 'status', v_existing.status,
      'sender_id', v_existing.sender_id, 'function_area', v_existing.function_area,
      'provider_message_id', v_existing.provider_message_id, 'idempotent', true);
  end if;

  -- multi-sender resolution (server-side, from config)
  select * into v_sender from public.message_senders
    where org_id = p_org_id and function_area = p_function_area and active;
  if not found then
    raise exception 'no_sender' using errcode = 'P0002',
      detail = format('no active sender for org %s area %s', p_org_id, p_function_area);
  end if;

  -- quiet hours 21:00–07:00 IST → defer to next 07:00 IST
  v_ist  := p_now at time zone 'Asia/Kolkata';
  v_hour := extract(hour from v_ist);
  if v_hour >= 21 or v_hour < 7 then
    v_status := 'deferred';
    v_sched  := (case when v_hour < 7
                   then date_trunc('day', v_ist) + time '07:00'
                   else date_trunc('day', v_ist) + interval '1 day' + time '07:00'
                 end) at time zone 'Asia/Kolkata';
    v_pmid := null;
  else
    v_status := 'sent';                       -- mock: recording IS the send
    v_pmid   := 'mock-' || gen_random_uuid()::text;
  end if;

  insert into public.outbound_messages(org_id, function_area, sender_id, recipient, kind,
                                       template, payload, idempotency_key, status,
                                       provider_message_id, scheduled_for, sent_at)
    values (p_org_id, p_function_area, v_sender.id, p_recipient, p_kind, p_template,
            coalesce(p_payload,'{}'::jsonb), p_idempotency_key, v_status, v_pmid, v_sched,
            case when v_status = 'sent' then p_now else null end)
    returning id into v_id;

  insert into public.audit_log(org_id, action, sub_event, entity_type, entity_id, meta)
    values (p_org_id, 'message.outbound', 'completed', 'outbound_message', v_id::text,
            jsonb_build_object('function_area', p_function_area, 'sender_id', v_sender.id,
                               'status', v_status, 'recipient', p_recipient));

  return jsonb_build_object('id', v_id, 'status', v_status, 'sender_id', v_sender.id,
    'function_area', p_function_area, 'provider_message_id', v_pmid,
    'scheduled_for', v_sched, 'idempotent', false);

exception
  when unique_violation then          -- idempotency-key race
    select * into v_existing from public.outbound_messages
      where org_id = p_org_id and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('id', v_existing.id, 'status', v_existing.status,
        'sender_id', v_existing.sender_id, 'function_area', v_existing.function_area,
        'provider_message_id', v_existing.provider_message_id, 'idempotent', true);
    end if;
    raise;
end;
$$;

-- ============================================================================
-- ingest_inbound — atomic, replay-safe inbound → deduped tenant-scoped lead.
-- System path (webhook, service_role). Org/area resolved from the RECEIVING
-- number (never trusted from the payload). Replay (same provider msg id) is a
-- no-op returning the prior lead. Unknown sender = one new lead; known = matched.
-- ============================================================================
create or replace function public.ingest_inbound(
  p_provider            text,
  p_provider_message_id text,
  p_to_phone            text,
  p_from_phone          text,
  p_body                text,
  p_raw                 jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sender   public.message_senders%rowtype;
  v_existing public.inbound_messages%rowtype;
  v_lead_id  uuid;
  v_created  boolean := false;
begin
  -- replay-safe: same provider message id → return prior, do nothing new
  select * into v_existing from public.inbound_messages
    where provider = p_provider and provider_message_id = p_provider_message_id;
  if found then
    return jsonb_build_object('lead_id', v_existing.lead_id, 'deduped', true, 'created_lead', false);
  end if;

  -- resolve tenant + area from the number it arrived on (NOT from the payload)
  select * into v_sender from public.message_senders
    where phone_number = p_to_phone and active;
  if not found then
    raise exception 'unknown_sender_number' using errcode = 'P0002', detail = p_to_phone;
  end if;

  -- lead dedup: unknown number → new lead; known → match existing (no dupe)
  insert into public.leads(org_id, function_area, phone, source, status)
    values (v_sender.org_id, v_sender.function_area, p_from_phone, 'whatsapp_inbound', 'new')
    on conflict (org_id, phone) do nothing
    returning id into v_lead_id;
  if v_lead_id is null then
    select id into v_lead_id from public.leads where org_id = v_sender.org_id and phone = p_from_phone;
  else
    v_created := true;
  end if;

  insert into public.inbound_messages(org_id, function_area, provider, provider_message_id,
                                      from_phone, to_phone, body, raw, lead_id)
    values (v_sender.org_id, v_sender.function_area, p_provider, p_provider_message_id,
            p_from_phone, p_to_phone, p_body, coalesce(p_raw,'{}'::jsonb), v_lead_id);

  insert into public.audit_log(org_id, action, sub_event, entity_type, entity_id, meta)
    values (v_sender.org_id, 'message.inbound', 'completed', 'lead', v_lead_id::text,
            jsonb_build_object('function_area', v_sender.function_area, 'from', p_from_phone,
                               'created_lead', v_created, 'provider_message_id', p_provider_message_id));

  return jsonb_build_object('lead_id', v_lead_id, 'deduped', false, 'created_lead', v_created,
                            'org_id', v_sender.org_id, 'function_area', v_sender.function_area);

exception
  when unique_violation then          -- inbound replay race
    select * into v_existing from public.inbound_messages
      where provider = p_provider and provider_message_id = p_provider_message_id;
    if found then
      return jsonb_build_object('lead_id', v_existing.lead_id, 'deduped', true, 'created_lead', false);
    end if;
    raise;
end;
$$;

revoke all on function public.enqueue_outbound(uuid,text,text,text,jsonb,text,text,timestamptz) from public;
revoke all on function public.ingest_inbound(text,text,text,text,text,jsonb) from public;
grant execute on function public.enqueue_outbound(uuid,text,text,text,jsonb,text,text,timestamptz) to service_role;
grant execute on function public.ingest_inbound(text,text,text,text,text,jsonb) to service_role;
