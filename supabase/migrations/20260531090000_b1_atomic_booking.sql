-- ============================================================================
-- B1 — ATOMIC WRITE FOUNDATION (OP MODEL inv. #1, #2, #5; §5.2 booking confirm)
-- ----------------------------------------------------------------------------
-- The reference implementation of the wrapper+RPC pattern: ALL mutations for a
-- booking-confirm happen inside ONE SECURITY DEFINER function / ONE transaction.
-- Never a multi-step client/server write (the legacy PN + RHS cost_sheet.ts:360
-- orphan-data bug is made structurally impossible here).
--
-- org_id is a first-class column/param everywhere NOW (inv. #3) so B2 is a pure
-- RLS-policy layer, not a reshape. These are lean B1 scaffolding tables; the full
-- domain schema arrives in later waves.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;   -- enables uuid '=' inside the GiST EXCLUDE

-- ── halls: the bookable resource ───────────────────────────────────────────
create table if not exists public.halls (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid        not null,
  name       text        not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_halls_org on public.halls (org_id);

-- ── bookings: the spine row (B1 subset of the §5.2 state machine) ───────────
create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid        not null,
  hall_id         uuid        not null references public.halls(id) on delete restrict,
  event_date      date        not null,
  slot            text        not null check (slot in ('morning','evening','full_day')),
  status          text        not null check (status in
                    ('tentative_hold','confirmed','completed','settled','closed','cancelled','postponed')),
  hall_rent       numeric(12,2) not null check (hall_rent >= 0),
  customer_name   text        not null,
  idempotency_key text        not null,
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- inv. #2: a repeated write with the same key is a safe no-op, not a 2nd row.
  constraint uq_bookings_idem unique (org_id, idempotency_key)
);
create index if not exists idx_bookings_org_hall_date on public.bookings (org_id, hall_id, event_date);
create index if not exists idx_bookings_org_status     on public.bookings (org_id, status);

-- ── date_blocks: the race-proof double-booking guard ────────────────────────
-- Each active block reserves a time range on a hall. The GiST EXCLUDE makes two
-- overlapping active ranges on the same (org, hall) impossible — enforced at
-- COMMIT, so concurrent confirms serialize and exactly one wins. The slot time
-- ranges encode the conflict semantics + the 3h turnaround buffer:
--   morning  [09:00,14:00)  evening [17:00,23:00)  full_day [09:00,23:00)
-- → morning & evening don't overlap (both bookable); full_day blocks both.
create table if not exists public.date_blocks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid        not null,
  hall_id     uuid        not null references public.halls(id) on delete restrict,
  booking_id  uuid        not null references public.bookings(id) on delete cascade,
  block_date  date        not null,
  slot        text        not null,
  during      tstzrange   not null,
  released_at timestamptz,                      -- soft-release (cancellation) keeps history
  created_at  timestamptz not null default now(),
  constraint no_overlapping_active_block
    exclude using gist (org_id with =, hall_id with =, during with &&)
    where (released_at is null)
);

-- ── deposit_ledger: the 50%-hall-rent escrowed LIABILITY (§12 #6) ───────────
-- A held deposit is NEVER revenue. inv. #5: every money op writes a ledger row.
create table if not exists public.deposit_ledger (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid        not null,
  booking_id  uuid        not null references public.bookings(id) on delete cascade,
  amount      numeric(12,2) not null check (amount >= 0),
  entry_type  text        not null check (entry_type in
                ('deposit_held','deposit_refunded','deposit_forfeited','deposit_adjusted')),
  is_liability boolean    not null default true,
  status      text        not null check (status in ('held','refunded','forfeited','adjusted')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_deposit_ledger_booking on public.deposit_ledger (org_id, booking_id);

-- ── RLS: enable now; service-role-only (the admin-client path). Tenant-scoped
--    authenticated policies are B2. Append-only-ish: no broad grants yet. ─────
alter table public.halls          enable row level security;
alter table public.bookings       enable row level security;
alter table public.date_blocks    enable row level security;
alter table public.deposit_ledger enable row level security;

do $$
declare t text;
begin
  foreach t in array array['halls','bookings','date_blocks','deposit_ledger'] loop
    execute format('drop policy if exists %I_service_all on public.%I', t, t);
    execute format('create policy %I_service_all on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;

-- ============================================================================
-- confirm_booking — THE atomic RPC (OP MODEL §5.2 CONFIRMED transition)
-- One transaction: idempotency check → booking(CONFIRMED) → hard-block(slot) →
-- deposit liability → in-tx audit. Any failure rolls back EVERYTHING.
--   • exclusion_violation → 'slot_taken' (clean reject; full rollback, no orphans)
--   • unique_violation on idem key → return the existing booking (no 2nd write)
--   • p_force_rollback = true → raises AFTER all inserts (test seam to prove
--     all-or-nothing incl. the deposit; harmless in prod — it only rolls back)
-- ============================================================================
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
  p_force_rollback  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_deposit    numeric(12,2);
  v_range      tstzrange;
  v_existing   public.bookings%rowtype;
  v_audit_id   uuid;
begin
  -- 1. Idempotency: same key already used → return it, do NOT write again.
  select * into v_existing from public.bookings
    where org_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('booking_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;

  if p_slot not in ('morning','evening','full_day') then
    raise exception 'invalid_slot' using errcode = '22023', detail = p_slot;
  end if;

  -- 2. Slot → IST time range (3h turnaround lives in the 14:00–17:00 gap).
  v_range := case p_slot
    when 'morning'  then tstzrange((p_event_date + time '09:00') at time zone 'Asia/Kolkata',
                                   (p_event_date + time '14:00') at time zone 'Asia/Kolkata', '[)')
    when 'evening'  then tstzrange((p_event_date + time '17:00') at time zone 'Asia/Kolkata',
                                   (p_event_date + time '23:00') at time zone 'Asia/Kolkata', '[)')
    when 'full_day' then tstzrange((p_event_date + time '09:00') at time zone 'Asia/Kolkata',
                                   (p_event_date + time '23:00') at time zone 'Asia/Kolkata', '[)')
  end;

  v_deposit := round(p_hall_rent * 0.5, 2);

  -- 3. Booking → CONFIRMED.
  insert into public.bookings(org_id, hall_id, event_date, slot, status, hall_rent,
                              customer_name, idempotency_key, confirmed_at)
    values (p_org_id, p_hall_id, p_event_date, p_slot, 'confirmed', p_hall_rent,
            p_customer_name, p_idempotency_key, now())
    returning id into v_booking_id;

  -- 4. Hard-block the slot. The EXCLUDE constraint raises 23P01 on any overlap.
  insert into public.date_blocks(org_id, hall_id, booking_id, block_date, slot, during)
    values (p_org_id, p_hall_id, v_booking_id, p_event_date, p_slot, v_range);

  -- 5. Deposit = 50% hall rent, held as an escrowed liability (never revenue).
  insert into public.deposit_ledger(org_id, booking_id, amount, entry_type, is_liability, status)
    values (p_org_id, v_booking_id, v_deposit, 'deposit_held', true, 'held');

  -- 6. Atomic domain audit (completed) — rolls back with everything else if the
  --    tx aborts, so an orphan 'completed' can never outlive a failed write.
  insert into public.audit_log(org_id, action, sub_event, actor_id, entity_type,
                               entity_id, parent_audit_id, meta)
    values (p_org_id, 'booking.confirm', 'completed', p_actor_id, 'booking',
            v_booking_id::text, p_parent_audit_id,
            jsonb_build_object('slot', p_slot, 'event_date', p_event_date,
                               'hall_rent', p_hall_rent, 'deposit', v_deposit))
    returning id into v_audit_id;

  -- Test seam: prove all-or-nothing including the deposit + audit.
  if p_force_rollback then
    raise exception 'forced_rollback_for_test' using errcode = 'P0001';
  end if;

  return jsonb_build_object('booking_id', v_booking_id, 'status', 'confirmed',
                            'deposit', v_deposit, 'audit_id', v_audit_id, 'idempotent', false);

exception
  when exclusion_violation then
    -- Lost the (hall,date,slot) race. The whole tx (booking+deposit) rolls back.
    raise exception 'slot_taken' using errcode = '23P01',
      detail = format('hall %s %s %s is already blocked', p_hall_id, p_event_date, p_slot);
  when unique_violation then
    -- Idempotency-key race: the other tx won; return its booking, no 2nd write.
    select * into v_existing from public.bookings
      where org_id = p_org_id and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('booking_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
    end if;
    raise;
end;
$$;

-- Authorization is in the app wrapper for the admin-client path only. Do NOT
-- grant to `authenticated` yet — a SECURITY DEFINER fn callable by any logged-in
-- user with an arbitrary p_org_id would be the F-SEC-04 cross-tenant hole. B2
-- adds the org-scoped authorization gate, then widens execution deliberately.
revoke all on function public.confirm_booking(uuid,uuid,date,text,numeric,text,text,uuid,uuid,boolean) from public;
grant execute on function public.confirm_booking(uuid,uuid,date,text,numeric,text,text,uuid,uuid,boolean) to service_role;
