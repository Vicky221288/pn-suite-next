-- ============================================================================
-- B4 — SCHEDULER / AUTOMATION RUNTIME (OP MODEL §6, §8; fixes AUDIT-2.0 F-AUTO-01)
-- ----------------------------------------------------------------------------
-- Rules are atomic, idempotent, tenant-scoped, quiet-hours-aware RPCs that take
-- an injectable p_now (IST-anchored). Each does find+act with a PER-ENTITY
-- subtransaction (one bad row can't fail the batch). Sends go through the B3
-- enqueue_outbound (so quiet-hours deferral + idempotency are inherited). A TS
-- registry behind a secret cron route orchestrates these (engine = generic;
-- rules = entries). The product now ACTS, by itself, on time.
-- ============================================================================

-- ── Schema deltas for the rules ──────────────────────────────────────────────
alter table public.leads add column if not exists last_follow_up_at timestamptz;
alter table public.leads add column if not exists escalated_at      timestamptz;
alter table public.leads add column if not exists assigned_to       uuid;
-- index the SLA-scan predicate
create index if not exists idx_leads_sla on public.leads (org_id, status, created_at)
  where escalated_at is null and last_follow_up_at is null;

alter table public.bookings        add column if not exists customer_phone text;  -- rent-reminder recipient
alter table public.message_senders add column if not exists manager_phone  text;  -- escalation recipient (per area)

-- ── today_snapshots: the 07:00 IST "Today" build per role (OP MODEL §8) ──────
create table if not exists public.today_snapshots (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  role          text not null,
  snapshot_date date not null,
  payload       jsonb not null,
  built_at      timestamptz not null default now(),
  constraint uq_today_org_role_date unique (org_id, role, snapshot_date)
);
create index if not exists idx_today_org on public.today_snapshots (org_id, snapshot_date desc);

alter table public.today_snapshots enable row level security;
drop policy if exists today_snapshots_member_select on public.today_snapshots;
create policy today_snapshots_member_select on public.today_snapshots
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists today_snapshots_service_all on public.today_snapshots;
create policy today_snapshots_service_all on public.today_snapshots
  for all to service_role using (true) with check (true);

-- ============================================================================
-- A2 — SLA escalation (THE F-AUTO-01 FIX). An active lead with no follow-up
-- within 2h and not yet escalated → flag escalated_at + notify the area manager
-- via B3 (quiet-hours-deferred if at night). Idempotent: the escalated_at guard
-- fires once; the notify carries idempotency key 'sla-escalate:<lead>'.
-- ============================================================================
create or replace function public.run_sla_escalations(p_org uuid, p_now timestamptz default now())
  returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_count int := 0;
  v_mgr   text;
begin
  for r in
    select id, function_area from public.leads
    where org_id = p_org
      and status in ('new','qualifying')
      and escalated_at is null
      and last_follow_up_at is null
      and p_now - created_at >= interval '2 hours'
  loop
    begin
      update public.leads set escalated_at = p_now, updated_at = p_now
        where id = r.id and escalated_at is null;
      if found then
        select manager_phone into v_mgr from public.message_senders
          where org_id = p_org and function_area = r.function_area and active;
        if v_mgr is not null then
          perform public.enqueue_outbound(p_org, r.function_area, v_mgr, 'sla_escalation',
            jsonb_build_object('lead_id', r.id),
            'sla-escalate:' || r.id::text, 'template', p_now);
        end if;
        insert into public.audit_log(org_id, action, sub_event, entity_type, entity_id, meta)
          values (p_org, 'rule.A2.sla_escalation', 'completed', 'lead', r.id::text,
                  jsonb_build_object('notified', v_mgr is not null));
        v_count := v_count + 1;
      end if;
    exception when others then
      -- isolate this lead; the rest of the batch proceeds
      insert into public.audit_log(org_id, action, sub_event, entity_type, entity_id, error_message)
        values (p_org, 'rule.A2.sla_escalation', 'failed', 'lead', r.id::text, sqlerrm);
    end;
  end loop;
  return v_count;
end;
$$;

-- ============================================================================
-- A5 — rent reminders at T-50 / T-47 / T-45 days before a confirmed event.
-- Sends via B3 to the customer (quiet-hours-deferred). Idempotent per milestone
-- via outbound key 'rent-reminder:T<N>:<booking>'.
-- ============================================================================
create or replace function public.run_rent_reminders(p_org uuid, p_now timestamptz default now())
  returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_today date := (p_now at time zone 'Asia/Kolkata')::date;
  v_n int;
  v_count int := 0;
begin
  for r in
    select id, event_date, customer_phone from public.bookings
    where org_id = p_org and status = 'confirmed'
      and (event_date - v_today) in (50, 47, 45)
      and customer_phone is not null
  loop
    v_n := r.event_date - v_today;
    begin
      perform public.enqueue_outbound(p_org, 'hall_catering', r.customer_phone, 'rent_reminder',
        jsonb_build_object('milestone', v_n, 'event_date', r.event_date),
        'rent-reminder:T' || v_n::text || ':' || r.id::text, 'template', p_now);
      v_count := v_count + 1;
    exception when others then
      insert into public.audit_log(org_id, action, sub_event, entity_type, entity_id, error_message)
        values (p_org, 'rule.A5.rent_reminder', 'failed', 'booking', r.id::text, sqlerrm);
    end;
  end loop;
  return v_count;
end;
$$;

-- ============================================================================
-- A10 — daily 07:00 IST "Today" builder. One snapshot per role per day
-- (idempotent upsert). Money figures are Owner/PM-only (OP MODEL §12 #3:
-- managers see operational numbers, not margin/P&L).
-- ============================================================================
create or replace function public.build_today(p_org uuid, p_now timestamptz default now())
  returns integer language plpgsql security definer set search_path = public as $$
declare
  v_date      date := (p_now at time zone 'Asia/Kolkata')::date;
  v_events    int;
  v_money     numeric(14,2);
  v_exceptions int;
  v_role      text;
  v_payload   jsonb;
  v_count     int := 0;
begin
  select count(*) into v_events from public.bookings
    where org_id = p_org and event_date = v_date and status <> 'cancelled';
  select coalesce(sum(hall_rent),0) into v_money from public.bookings
    where org_id = p_org and status = 'confirmed' and event_date >= v_date;
  select count(*) into v_exceptions from public.leads
    where org_id = p_org and escalated_at is not null;

  foreach v_role in array array['owner','property_manager','hall_manager','stays_manager'] loop
    v_payload := jsonb_build_object('events_today', v_events, 'exceptions', v_exceptions);
    if v_role in ('owner','property_manager') then
      v_payload := v_payload || jsonb_build_object('money_to_collect', v_money);
    end if;
    insert into public.today_snapshots(org_id, role, snapshot_date, payload, built_at)
      values (p_org, v_role, v_date, v_payload, p_now)
      on conflict (org_id, role, snapshot_date)
      do update set payload = excluded.payload, built_at = excluded.built_at;
    v_count := v_count + 1;
  end loop;

  insert into public.audit_log(org_id, action, sub_event, entity_type, entity_id, meta)
    values (p_org, 'rule.A10.today', 'completed', 'today', v_date::text,
            jsonb_build_object('events_today', v_events, 'exceptions', v_exceptions));
  return v_count;
end;
$$;

-- ============================================================================
-- Drain the B3 deferred-outbound queue: messages whose quiet-hours hold has
-- elapsed (scheduled_for <= now). Mock "send" = flip to sent. Idempotent (only
-- touches status='deferred'). Global/system (all orgs). The live AiSensy adapter
-- will perform the HTTP send here instead of the status flip.
-- ============================================================================
create or replace function public.drain_outbound(p_now timestamptz default now(), p_limit int default 500)
  returns integer language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with due as (
    select id from public.outbound_messages
    where status = 'deferred' and scheduled_for <= p_now
    order by scheduled_for limit p_limit
  ), upd as (
    update public.outbound_messages o
      set status = 'sent', sent_at = p_now,
          provider_message_id = coalesce(o.provider_message_id, 'mock-' || gen_random_uuid()::text)
      from due where o.id = due.id
      returning o.id, o.org_id
  )
  select count(*) into v_count from upd;
  if v_count > 0 then
    insert into public.audit_log(org_id, action, sub_event, entity_type, entity_id, meta)
      values (null, 'rule.drain_outbound', 'completed', 'outbound_queue', null,
              jsonb_build_object('drained', v_count));
  end if;
  return v_count;
end;
$$;

-- System/cron path only (service_role). Not granted to authenticated.
revoke all on function public.run_sla_escalations(uuid,timestamptz) from public;
revoke all on function public.run_rent_reminders(uuid,timestamptz)  from public;
revoke all on function public.build_today(uuid,timestamptz)         from public;
revoke all on function public.drain_outbound(timestamptz,int)       from public;
grant execute on function public.run_sla_escalations(uuid,timestamptz) to service_role;
grant execute on function public.run_rent_reminders(uuid,timestamptz)  to service_role;
grant execute on function public.build_today(uuid,timestamptz)         to service_role;
grant execute on function public.drain_outbound(timestamptz,int)       to service_role;
