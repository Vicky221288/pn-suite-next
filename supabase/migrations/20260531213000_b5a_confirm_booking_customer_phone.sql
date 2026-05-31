-- ============================================================================
-- B5a — composition fix surfaced by the b5 slice gate.
-- ----------------------------------------------------------------------------
-- confirm_booking created bookings WITHOUT customer_phone, so the A5 rent
-- reminders (B4) had no recipient when the pillars composed (they only worked in
-- the B4 harness because bookings were inserted there with a phone). Clean fix:
-- confirm_booking now carries customer_phone, deriving it from the linked lead
-- when not supplied. Re-creates the function with one more trailing default
-- param (B1/B2/B4 named-arg callers, which omit it, are unaffected).
-- ============================================================================
drop function if exists public.confirm_booking(uuid,uuid,date,text,numeric,text,text,uuid,uuid,boolean,uuid);

create or replace function public.confirm_booking(
  p_org_id          uuid,
  p_hall_id         uuid,
  p_event_date      date,
  p_slot            text,
  p_hall_rent       numeric,
  p_customer_name   text,
  p_idempotency_key text,
  p_actor_id        uuid    default null,
  p_parent_audit_id uuid    default null,
  p_force_rollback  boolean default false,
  p_lead_id         uuid    default null,
  p_customer_phone  text    default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_booking_id uuid; v_deposit numeric(12,2); v_range tstzrange;
  v_existing public.bookings%rowtype; v_audit_id uuid; v_phone text;
begin
  if auth.uid() is not null
     and not exists (select 1 from public.org_members
                     where user_id = auth.uid() and org_id = p_org_id
                       and 'booking.confirm' = any(capabilities)) then
    raise exception 'forbidden' using errcode = '42501', detail = 'caller lacks booking.confirm in this org';
  end if;

  select * into v_existing from public.bookings where org_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('booking_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;
  if p_slot not in ('morning','evening','full_day') then
    raise exception 'invalid_slot' using errcode = '22023', detail = p_slot;
  end if;

  v_range := case p_slot
    when 'morning'  then tstzrange((p_event_date + time '09:00') at time zone 'Asia/Kolkata', (p_event_date + time '14:00') at time zone 'Asia/Kolkata', '[)')
    when 'evening'  then tstzrange((p_event_date + time '17:00') at time zone 'Asia/Kolkata', (p_event_date + time '23:00') at time zone 'Asia/Kolkata', '[)')
    when 'full_day' then tstzrange((p_event_date + time '09:00') at time zone 'Asia/Kolkata', (p_event_date + time '23:00') at time zone 'Asia/Kolkata', '[)')
  end;
  v_deposit := round(p_hall_rent * 0.5, 2);
  -- carry the customer's phone (so A5 rent reminders can reach them); derive
  -- from the linked lead when not explicitly supplied.
  v_phone := coalesce(p_customer_phone,
    case when p_lead_id is not null
         then (select phone from public.leads where id = p_lead_id and org_id = p_org_id)
         else null end);

  insert into public.bookings(org_id, hall_id, lead_id, event_date, slot, status, hall_rent, customer_name, customer_phone, idempotency_key, confirmed_at)
    values (p_org_id, p_hall_id, p_lead_id, p_event_date, p_slot, 'confirmed', p_hall_rent, p_customer_name, v_phone, p_idempotency_key, now())
    returning id into v_booking_id;
  insert into public.date_blocks(org_id, hall_id, booking_id, block_date, slot, during)
    values (p_org_id, p_hall_id, v_booking_id, p_event_date, p_slot, v_range);
  insert into public.deposit_ledger(org_id, booking_id, amount, entry_type, is_liability, status)
    values (p_org_id, v_booking_id, v_deposit, 'deposit_held', true, 'held');
  if p_lead_id is not null then
    update public.leads set status = 'won', updated_at = now() where id = p_lead_id and org_id = p_org_id;
  end if;
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type, entity_id, parent_audit_id, meta)
    values (p_org_id, 'booking.confirm', 'completed', coalesce(p_actor_id, auth.uid()), 'booking', v_booking_id::text, p_parent_audit_id,
            jsonb_build_object('slot', p_slot, 'event_date', p_event_date, 'hall_rent', p_hall_rent, 'deposit', v_deposit, 'lead_id', p_lead_id))
    returning id into v_audit_id;
  if p_force_rollback then raise exception 'forced_rollback_for_test' using errcode = 'P0001'; end if;

  return jsonb_build_object('booking_id', v_booking_id, 'status', 'confirmed', 'deposit', v_deposit, 'audit_id', v_audit_id, 'idempotent', false);
exception
  when exclusion_violation then
    raise exception 'slot_taken' using errcode = '23P01', detail = format('hall %s %s %s is already blocked', p_hall_id, p_event_date, p_slot);
  when unique_violation then
    select * into v_existing from public.bookings where org_id = p_org_id and idempotency_key = p_idempotency_key;
    if found then return jsonb_build_object('booking_id', v_existing.id, 'status', v_existing.status, 'idempotent', true); end if;
    raise;
end; $$;

grant execute on function public.confirm_booking(uuid,uuid,date,text,numeric,text,text,uuid,uuid,boolean,uuid,text) to authenticated, service_role;
