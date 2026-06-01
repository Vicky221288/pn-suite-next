-- ============================================================================
-- M1a FIX — generate_shifts_from_template ON CONFLICT must match the PARTIAL
-- unique index. uq_shift_template_date is `... where template_id is not null`,
-- so a bare `on conflict (roster_id, template_id, shift_date)` fails to infer it
-- (42P10 — no matching ON CONFLICT constraint) and the whole tx rolls back → 0
-- shifts generated. The arbiter predicate `where template_id is not null` makes
-- Postgres infer the partial index. Single-line change; everything else (sig,
-- security definer, search_path, auth/capability gates, day-matching, IST window,
-- audit, return shape) is byte-identical to 20260602110000.
-- ============================================================================
create or replace function public.generate_shifts_from_template(
  p_org uuid, p_roster_id uuid, p_template_id uuid, p_actor_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r_status text; r_start date; r_end date; t record; d date; v_start timestamptz; v_end timestamptz; v_n int := 0;
begin
  if auth.uid() is not null and not public.is_org_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  if auth.uid() is not null and not public.has_capability(p_org, 'roster.manage') then raise exception 'forbidden' using errcode='42501', detail='roster.manage required'; end if;
  select status, period_start, period_end into r_status, r_start, r_end from public.staff_rosters where id = p_roster_id and org_id = p_org;
  if r_status is null then raise exception 'roster_not_found' using errcode='P0002'; end if;
  if r_status <> 'draft' then raise exception 'roster_published' using errcode='22023', detail='cannot add shifts to a published roster'; end if;
  select * into t from public.shift_templates where id = p_template_id and org_id = p_org;
  if t.id is null then raise exception 'template_not_found' using errcode='P0002'; end if;

  d := r_start;
  while d <= r_end loop
    if extract(dow from d)::int = any(t.days_of_week) then
      v_start := (d + t.start_time) at time zone 'Asia/Kolkata';
      if t.end_time <= t.start_time then
        v_end := ((d + 1) + t.end_time) at time zone 'Asia/Kolkata';   -- overnight
      else
        v_end := (d + t.end_time) at time zone 'Asia/Kolkata';
      end if;
      insert into public.shifts(org_id, roster_id, template_id, shift_date, start_at, end_at, role, location)
        values (p_org, p_roster_id, p_template_id, d, v_start, v_end, t.role, t.location)
        on conflict (roster_id, template_id, shift_date) where template_id is not null do nothing;
      if found then v_n := v_n + 1; end if;
    end if;
    d := d + 1;
  end loop;

  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, meta)
    values (p_org, 'workforce.shifts_generate', 'completed', coalesce(p_actor_id, auth.uid()), 'staff_roster', p_roster_id::text,
            jsonb_build_object('template_id', p_template_id, 'generated', v_n));
  return jsonb_build_object('roster_id', p_roster_id, 'template_id', p_template_id, 'generated', v_n);
end; $$;

-- re-grant (revoke from public; grant to the app) per convention after create-or-replace
revoke all on function public.generate_shifts_from_template(uuid,uuid,uuid,uuid) from public;
grant execute on function public.generate_shifts_from_template(uuid,uuid,uuid,uuid) to authenticated, service_role;
