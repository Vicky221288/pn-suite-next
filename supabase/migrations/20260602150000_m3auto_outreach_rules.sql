-- ============================================================================
-- M3-auto — CRM recurring outreach: two B4 REGISTRY rules (closes KL-8)
-- ----------------------------------------------------------------------------
-- The two recurring outreach behaviours deferred from M3. These are AUTOMATION
-- → they live in the B4 rule registry (lib/automation/registry.ts) as declarative
-- entries (already wired: A_review_requests, A_special_dates), each backed by an
-- atomic, idempotent, IST-anchored, quiet-hours-aware rule RPC that sends via B3 —
-- EXACTLY like run_sla_escalations / run_rent_reminders (per-entity subtransaction;
-- one bad recipient can't sink the tick). Driven by the EXISTING /api/cron/tick →
-- runTick; NO new automation path, NO new cron route.
--
--  RULE 1 — run_review_requests (A_review): for each CONCLUDED event with no
--    review request yet, create the review_requests record + send via B3 (reuses
--    M3 create_review_request). "Concluded" = event_date strictly before today
--    (IST) AND the event has a guest to contact AND it isn't cancelled. Per-event
--    dedup via the EXISTING review_requests unique (org,guest,event) → re-tick = 0.
--
--  RULE 2 — run_special_date_outreach (A_special): for each guest_special_date
--    whose month/day matches today (IST), send the matching template via B3.
--    PER-YEAR idempotency via the B3 outbound idempotency key with the YEAR
--    embedded ('special:<type>:<guest>:<YYYY>') — re-tick same day = 0, same date
--    next year = 1. No marker table needed (reuses outbound_messages idempotency).
--
-- REUSE-ONLY schema touch: one nullable `purpose` column + a per-(org,purpose)
-- partial unique on the EXISTING message_templates — org config that wires which
-- template each rule uses (no hardcoded literal, no new table). Both rules send
-- ONLY via enqueue_outbound (idempotent + quiet-hours-aware; deferred sends drain
-- via the existing drain_outbound). Atomic + audited + tenant-scoped.
-- ============================================================================

-- ── REUSE-ONLY wiring: which template does each automation rule use? (org config)
alter table public.message_templates add column if not exists purpose text;   -- e.g. 'review_request' | 'anniversary' | 'birthday' | 'other'
create unique index if not exists uq_message_templates_org_purpose
  on public.message_templates (org_id, purpose) where purpose is not null;

-- ============================================================================
-- RULE 1 — run_review_requests (A_review). per-org, every tick. Reuses M3
-- create_review_request (record + B3 send + idempotency). Concluded = past-dated,
-- has a guest, not cancelled, and no existing review request.
-- ============================================================================
create or replace function public.run_review_requests(p_org uuid, p_now timestamptz default now())
  returns integer language plpgsql security definer set search_path = public as $$
declare
  v_today date := (p_now at time zone 'Asia/Kolkata')::date;
  v_tpl   record;
  r       record;
  v_count int := 0;
begin
  -- org config: which template is the review-request template? none → nothing to do.
  select id, function_area into v_tpl
    from public.message_templates
    where org_id = p_org and purpose = 'review_request' and active
    order by created_at limit 1;
  if v_tpl.id is null then return 0; end if;

  for r in
    select e.id as event_id, e.guest_id
    from public.events e
    where e.org_id = p_org
      and e.guest_id is not null
      and e.event_date < v_today                                  -- CONCLUDED: date has passed (IST)
      and coalesce(e.status, '') <> 'cancelled'
      and not exists (                                            -- per-event dedup (M3 uniqueness)
        select 1 from public.review_requests rr
        where rr.org_id = p_org and rr.guest_id = e.guest_id and rr.event_id = e.id
      )
  loop
    begin
      -- reuse M3's atomic record + B3 send path (idempotent per guest+event)
      perform public.create_review_request(p_org, r.guest_id, v_tpl.id, r.event_id, null, p_now, null);
      insert into public.audit_log(org_id, action, sub_event, entity_type, entity_id, meta)
        values (p_org, 'rule.A_review.outreach', 'completed', 'event', r.event_id::text,
                jsonb_build_object('guest_id', r.guest_id));
      v_count := v_count + 1;
    exception when others then
      -- isolate this event; the rest of the batch proceeds (mirror SLA escalation)
      insert into public.audit_log(org_id, action, sub_event, entity_type, entity_id, error_message)
        values (p_org, 'rule.A_review.outreach', 'failed', 'event', r.event_id::text, sqlerrm);
    end;
  end loop;
  return v_count;
end; $$;

-- ============================================================================
-- RULE 2 — run_special_date_outreach (A_special). per-org, every tick. Matches
-- guest_special_dates on month/day = today (IST). Per-year idempotency via the
-- B3 key (year embedded). Template chosen by purpose = the date_type.
-- ============================================================================
create or replace function public.run_special_date_outreach(p_org uuid, p_now timestamptz default now())
  returns integer language plpgsql security definer set search_path = public as $$
declare
  v_today date := (p_now at time zone 'Asia/Kolkata')::date;     -- IST-anchored (no UTC drift)
  v_year  text := to_char(v_today, 'YYYY');
  r       record;
  v_tpl   record;
  v_render text;
  v_res   jsonb;
  v_count int := 0;
begin
  for r in
    select sd.id as sd_id, sd.guest_id, sd.date_type, g.phone, g.name
    from public.guest_special_dates sd
    join public.guests g on g.id = sd.guest_id and g.org_id = p_org
    where sd.org_id = p_org
      and g.phone is not null
      and extract(month from sd.the_date) = extract(month from v_today)
      and extract(day   from sd.the_date) = extract(day   from v_today)
  loop
    begin
      -- org config: template for THIS date_type (anniversary/birthday/other); none → skip
      select id, function_area, body, name into v_tpl
        from public.message_templates
        where org_id = p_org and purpose = r.date_type and active
        order by created_at limit 1;
      if v_tpl.id is null then continue; end if;

      v_render := public.pn_render_template(v_tpl.body, jsonb_build_object('guest', r.name));
      -- THE ONLY SEND PATH (B3). Per-year idempotency key (year embedded).
      v_res := public.enqueue_outbound(p_org, v_tpl.function_area, r.phone, v_tpl.name,
                 jsonb_build_object('rendered', v_render, 'kind', 'special_date', 'date_type', r.date_type),
                 'special:' || r.date_type || ':' || r.guest_id::text || ':' || v_year, 'template', p_now);

      if coalesce((v_res->>'idempotent')::boolean, false) = false then    -- count only NEW sends
        insert into public.audit_log(org_id, action, sub_event, entity_type, entity_id, meta)
          values (p_org, 'rule.A_special.outreach', 'completed', 'guest_special_date', r.sd_id::text,
                  jsonb_build_object('date_type', r.date_type, 'status', v_res->>'status', 'year', v_year));
        v_count := v_count + 1;
      end if;
    exception when others then
      -- isolate this guest; the rest of the batch proceeds (e.g. a no-sender area)
      insert into public.audit_log(org_id, action, sub_event, entity_type, entity_id, error_message)
        values (p_org, 'rule.A_special.outreach', 'failed', 'guest_special_date', r.sd_id::text, sqlerrm);
    end;
  end loop;
  return v_count;
end; $$;

-- ============================================================================
-- set_template_purpose — org config: designate which template a rule uses
-- (crm.manage). Reassigns cleanly (clears the purpose off any other template in
-- the org first) so the per-(org,purpose) unique never blocks. Pass null to clear.
-- ============================================================================
create or replace function public.set_template_purpose(
  p_org uuid, p_template_id uuid, p_purpose text, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'crm.manage') then raise exception 'forbidden' using errcode='42501', detail='crm.manage required'; end if;
  if p_purpose is not null and coalesce(btrim(p_purpose),'') = '' then raise exception 'bad_purpose' using errcode='22023'; end if;
  if not exists (select 1 from public.message_templates where id = p_template_id and org_id = p_org) then raise exception 'template_not_found' using errcode='P0002'; end if;
  if p_purpose is not null then
    update public.message_templates set purpose = null, updated_at = now()
      where org_id = p_org and purpose = btrim(p_purpose) and id <> p_template_id;   -- one template per purpose
  end if;
  update public.message_templates set purpose = nullif(btrim(p_purpose), ''), updated_at = now()
    where id = p_template_id and org_id = p_org;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'crm.template_purpose_set', 'completed', coalesce(p_actor_id, auth.uid()), 'message_template', p_template_id::text, jsonb_build_object('purpose', p_purpose));
  return jsonb_build_object('template_id', p_template_id, 'purpose', p_purpose);
end; $$;

-- ── grants (cron drives the rules via service_role; mirror the B4 rule grants) ─
revoke all on function public.run_review_requests(uuid,timestamptz)        from public;
revoke all on function public.run_special_date_outreach(uuid,timestamptz)  from public;
revoke all on function public.set_template_purpose(uuid,uuid,text,uuid)    from public;
grant execute on function public.run_review_requests(uuid,timestamptz)       to service_role;
grant execute on function public.run_special_date_outreach(uuid,timestamptz) to service_role;
grant execute on function public.set_template_purpose(uuid,uuid,text,uuid)   to authenticated, service_role;
