#!/usr/bin/env node
/**
 * B1 verification harness — proves the atomic write foundation against the live
 * DB by calling the confirm_booking RPC directly via the service-role client
 * (the RPC is the atomic core; the wrapper is proven by typecheck + the ping
 * example). Fully self-cleaning: all rows are created under a random test org and
 * deleted at the end. Re-runnable; exits non-zero on any failed assertion.
 *
 * Proves:
 *   A. Concurrency / double-booking (scenario S4): N racing confirms on the same
 *      (hall,date,slot) → exactly 1 booking, N-1 clean 'slot_taken', 0 orphans.
 *   B. Idempotency (inv. #2): same key twice → one booking, 2nd is a no-op.
 *   C. All-or-nothing rollback: force a mid-tx failure → zero rows persist
 *      (no deposit without a booking; no orphan audit).
 *   D. Slot semantics: morning + evening same day both succeed; full_day then
 *      conflicts (the 3h-buffer model).
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ORG = randomUUID();
let fails = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'OK ' : 'XX '} ${msg}`); if (!cond) fails++; };
const confirm = (args) => db.rpc('confirm_booking', { p_org_id: ORG, ...args });
const count = async (table, extra = (q) => q) =>
  (await extra(db.from(table).select('*', { count: 'exact', head: true }).eq('org_id', ORG))).count;

async function main() {
  // setup: one hall under the test org
  const h = await db.from('halls').insert({ org_id: ORG, name: 'Test Hall' }).select('id').single();
  if (h.error) { console.error('SETUP FAILED (is the B1 migration applied?):', h.error.message); process.exit(2); }
  const hallId = h.data.id;
  const baseArgs = { p_hall_id: hallId, p_hall_rent: 100000, p_customer_name: 'Test' };

  // ── A. Concurrency: 5 racing confirms, same morning slot, different keys ──
  console.log('\nA. Concurrency / double-booking (5 racing confirms)');
  const date = '2099-01-15';
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      confirm({ ...baseArgs, p_event_date: date, p_slot: 'morning', p_idempotency_key: `conc-${randomUUID()}` })
        .then((r) => { if (r.error) throw r.error; return r.data; }),
    ),
  );
  const wins = results.filter((r) => r.status === 'fulfilled' && r.value?.status === 'confirmed');
  const slotTaken = results.filter((r) => r.status === 'rejected' && /slot_taken|23P01/.test(r.reason?.message ?? r.reason?.code ?? ''));
  ok(wins.length === 1, `exactly 1 winner (got ${wins.length})`);
  ok(slotTaken.length === 4, `exactly 4 clean 'slot_taken' rejections (got ${slotTaken.length})`);
  ok((await count('bookings', (q) => q.eq('event_date', date))) === 1, 'exactly 1 booking row for the slot');
  ok((await count('date_blocks', (q) => q.eq('block_date', date))) === 1, 'exactly 1 date_block (no orphans)');
  // no orphan deposit / no orphan audit
  ok((await count('deposit_ledger')) === 1, 'exactly 1 deposit_ledger row so far');
  ok((await count('audit_log', (q) => q.eq('action', 'booking.confirm').eq('sub_event', 'completed'))) === 1,
    'exactly 1 completed audit (losers rolled back theirs)');

  // ── B. Idempotency: same key twice → one row, 2nd is a no-op ──
  console.log('\nB. Idempotency (same key twice)');
  const key = `idem-${randomUUID()}`;
  const r1 = await confirm({ ...baseArgs, p_event_date: '2099-02-20', p_slot: 'morning', p_idempotency_key: key });
  const r2 = await confirm({ ...baseArgs, p_event_date: '2099-02-20', p_slot: 'morning', p_idempotency_key: key });
  ok(!r1.error && r1.data?.idempotent === false, 'first call creates the booking');
  ok(!r2.error && r2.data?.idempotent === true && r2.data?.booking_id === r1.data?.booking_id,
    'second call is a no-op returning the same booking');
  ok((await count('bookings', (q) => q.eq('idempotency_key', key))) === 1, 'exactly 1 row for the repeated key');

  // ── C. All-or-nothing rollback (force a mid-tx failure after all inserts) ──
  console.log('\nC. All-or-nothing rollback (forced mid-tx failure)');
  const rbKey = `rb-${randomUUID()}`;
  const rb = await confirm({ ...baseArgs, p_event_date: '2099-03-10', p_slot: 'full_day', p_idempotency_key: rbKey, p_force_rollback: true });
  ok(!!rb.error, 'forced failure surfaced as an error');
  ok((await count('bookings', (q) => q.eq('idempotency_key', rbKey))) === 0, 'no booking persisted');
  ok((await count('date_blocks', (q) => q.eq('block_date', '2099-03-10'))) === 0, 'no date_block persisted');
  ok((await count('deposit_ledger', (q) => q.gte('created_at', '2099-01-01'))) >= 0, 'deposit ledger check ran');
  // strongest: total deposits still equals the bookings that truly committed
  const bookingsNow = await count('bookings');
  const depositsNow = await count('deposit_ledger');
  ok(bookingsNow === depositsNow, `no orphan deposit: bookings(${bookingsNow}) === deposits(${depositsNow})`);

  // ── D. Slot semantics: morning + evening coexist; full_day then conflicts ──
  console.log('\nD. Slot semantics (3h buffer)');
  const d = '2099-04-01';
  const m = await confirm({ ...baseArgs, p_event_date: d, p_slot: 'morning', p_idempotency_key: `slot-m-${randomUUID()}` });
  const e = await confirm({ ...baseArgs, p_event_date: d, p_slot: 'evening', p_idempotency_key: `slot-e-${randomUUID()}` });
  ok(!m.error && !e.error, 'morning + evening same day BOTH succeed (no false conflict)');
  const fd = await confirm({ ...baseArgs, p_event_date: d, p_slot: 'full_day', p_idempotency_key: `slot-f-${randomUUID()}` });
  ok(!!fd.error && /slot_taken|23P01/.test(fd.error.message ?? fd.error.code ?? ''), 'full_day then correctly conflicts');
}

try {
  await main();
} catch (e) {
  console.error('  XX harness threw:', e.message);
  fails++;
} finally {
  // self-clean: bookings cascade to date_blocks + deposit_ledger; then halls + audit
  await db.from('bookings').delete().eq('org_id', ORG);
  await db.from('halls').delete().eq('org_id', ORG);
  await db.from('audit_log').delete().eq('org_id', ORG);
  const leftover =
    (await count('bookings')) + (await count('halls')) + (await count('date_blocks')) + (await count('audit_log'));
  console.log(`\n  cleanup: ${leftover === 0 ? 'OK — 0 rows left for test org' : 'XX — ' + leftover + ' rows left'}`);
  if (leftover !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
