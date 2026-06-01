#!/usr/bin/env node
/**
 * M5 harness — DATE HOLDS + AVAILABILITY CALENDAR. The hold/GiST seam is the
 * HEADLINE: a hold is advisory + expiring; two holds coexist; a hold NEVER blocks
 * a confirmed booking; convert_hold DELEGATES to confirm_booking/create_room_stay
 * (the GiST EXCLUDE decides) — a conflicting convert FAILS cleanly and the hold
 * does NOT mutate (zero orphan, F-DATA-01 stays closed); an expired hold is
 * ignored by reads BEFORE the sweep runs, then run_hold_expiry sweeps it
 * (idempotent); release + guarded transitions; the calendar composes confirmed +
 * active holds; capability gates; org isolation; atomicity; audited.
 * Self-cleaning, re-runnable, exit-coded.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK ' : 'XX '} ${m}`); if (!c) fails++; };
const emsg = (r) => `${r.error?.code ?? ''} ${r.error?.message ?? ''} ${r.error?.details ?? ''}`;
const rid = () => randomUUID().slice(0, 8);
const future = () => new Date(Date.now() + 86400000).toISOString();   // +1 day
const PAST = '2000-01-01T00:00:00Z';
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (M5 applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-m5-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return { cl, id: c.data.user.id };
}
const mkHall = async (org) => (await db.from('halls').insert({ org_id: org, name: `Hall-${rid()}` }).select('id').single()).data.id;
const mkRoomType = async (org) => (await db.from('room_types').insert({ org_id: org, name: `RT-${rid()}`, base_rate: 5000 }).select('id').single()).data.id;
const mkRoom = async (org, rt) => (await db.from('rooms').insert({ org_id: org, room_type_id: rt, number: `R${Math.floor(Math.random() * 9000 + 1000)}` }).select('id').single()).data.id;
const holdRow = async (id) => (await db.from('date_holds').select('*').eq('id', id).single()).data;
const placeHall = (org, hall, date, name, exp) => db.rpc('place_hold', { p_org: org, p_domain: 'hall', p_expires_at: exp ?? future(), p_hall_id: hall, p_event_date: date, p_slot: 'full_day', p_hall_rent: 100000, p_guest_name: name });
const confirmHall = (org, hall, date) => db.rpc('confirm_booking', { p_org_id: org, p_hall_id: hall, p_event_date: date, p_slot: 'full_day', p_hall_rent: 100000, p_customer_name: 'Direct', p_idempotency_key: `direct-${rid()}` });
const auditCount = async (org, action) => (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('action', action)).count;
const bookingCount = async (org, hall, date) => (await db.from('bookings').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('hall_id', hall).eq('event_date', date)).count;

async function main() {
  const A = await mkOrg('M5 Org A'), B = await mkOrg('M5 Org B');
  const mgr = await mkMember(A, ['hold.manage', 'booking.confirm']);
  const mgr2 = await mkMember(A, ['hold.manage']);       // holds but NOT booking.confirm
  const op = await mkMember(A, []);
  const bMgr = await mkMember(B, ['hold.manage', 'booking.confirm']);
  const hallA = await mkHall(A); const rtA = await mkRoomType(A); const room1 = await mkRoom(A, rtA);

  // ── 1. create a hold (pending, expires_at) — and NO GiST row from a mere hold ──
  console.log('\n1. Place a hold (advisory; creates no confirmed block)');
  const D1 = '2099-07-01';
  const h1 = (await placeHall(A, hallA, D1, 'GuestOne')).data;
  ok(h1.hold_id && h1.status === 'pending', 'hold created (pending, expires_at set)');
  ok(await bookingCount(A, hallA, D1) === 0, 'a mere hold created NO confirmed booking/date_block (no GiST entry)');

  // ── 2. two holds on the same slot coexist ──
  console.log('\n2. Two holds on the same slot coexist');
  const h1b = await placeHall(A, hallA, D1, 'GuestTwo');
  ok(!h1b.error, 'a SECOND hold on the same hall/date/slot is allowed (a hold never blocks a hold)');

  // ── 3. a hold does NOT block a confirmed booking ──
  console.log('\n3. A hold does NOT block a confirm (GiST is the only authority)');
  const conf1 = await confirmHall(A, hallA, D1);
  ok(!conf1.error && conf1.data.booking_id, 'confirm on a HELD date SUCCEEDS — the holds are advisory only');

  // ── 4. convert_hold delegates → real booking ──
  console.log('\n4. convert_hold delegates to confirm_booking → real booking');
  const D2 = '2099-07-05';
  const h2 = (await placeHall(A, hallA, D2, 'GuestConv')).data;
  const cv = await db.rpc('convert_hold', { p_org: A, p_hold_id: h2.hold_id });
  ok(!cv.error && cv.data.status === 'converted' && cv.data.result.booking_id, 'convert → real booking via confirm_booking');
  const h2row = await holdRow(h2.hold_id);
  ok(h2row.status === 'converted' && h2row.converted_booking_id === cv.data.result.booking_id, 'hold marked converted + linked to the real booking');
  ok(await bookingCount(A, hallA, D2) === 1, 'exactly one confirmed booking exists for the converted slot');

  // ── 5. THE SEAM: conflicting convert fails cleanly, hold does NOT mutate ──
  console.log('\n5. Conflicting convert → GiST rejects → hold stays pending (zero orphan)');
  const D3 = '2099-07-10';
  await confirmHall(A, hallA, D3);                          // slot now confirmed-taken
  const h3 = (await placeHall(A, hallA, D3, 'GuestLate')).data;   // a hold on the now-taken slot is still allowed
  const conflict = await db.rpc('convert_hold', { p_org: A, p_hold_id: h3.hold_id });
  ok(!!conflict.error && /23P01|slot_taken|double_booked/.test(emsg(conflict)), 'convert REJECTED by GiST (slot_taken) — not a bespoke check');
  const h3row = await holdRow(h3.hold_id);
  ok(h3row.status === 'pending' && h3row.converted_booking_id === null, 'hold did NOT mutate into a booking (still pending, no link)');
  ok(await bookingCount(A, hallA, D3) === 1, 'no orphan booking — only the original confirm exists (F-DATA-01 stays closed)');

  // ── 6. expired hold ignored by reads BEFORE the sweep; then swept (idempotent) ──
  console.log('\n6. Expiry: read-filter ignores a lapsed hold before the sweep, then sweep');
  const D4 = '2099-07-15';
  const h4 = (await placeHall(A, hallA, D4, 'GuestExp')).data;
  await db.from('date_holds').update({ expires_at: PAST }).eq('id', h4.hold_id);   // simulate lapse WITHOUT sweeping (status still pending)
  const calPre = (await db.rpc('availability_calendar', { p_org: A, p_from: '2099-07-01', p_to: '2099-07-31' })).data;
  ok(!calPre.hall_holds.some((x) => x.hold_id === h4.hold_id), 'lapsed hold is EXCLUDED by the read-filter even though the sweep has NOT run');
  const convExp = await db.rpc('convert_hold', { p_org: A, p_hold_id: h4.hold_id });
  ok(!!convExp.error && /hold_expired|22023/.test(emsg(convExp)), 'converting a lapsed hold is rejected (read-filter, independent of the sweep)');
  const sweep1 = await db.rpc('run_hold_expiry', { p_org: A, p_now: new Date().toISOString() });
  ok(!sweep1.error && sweep1.data >= 1 && (await holdRow(h4.hold_id)).status === 'expired', 'run_hold_expiry sweeps the lapsed hold → expired');
  const sweep2 = await db.rpc('run_hold_expiry', { p_org: A, p_now: new Date().toISOString() });
  ok(sweep2.data === 0, 're-tick → 0 (idempotent)');

  // ── 7. release lifecycle + guarded transitions ──
  console.log('\n7. Release + guarded transitions');
  const D5 = '2099-07-20';
  const h5 = (await placeHall(A, hallA, D5, 'GuestRel')).data;
  ok(!(await db.rpc('release_hold', { p_org: A, p_hold_id: h5.hold_id })).error && (await holdRow(h5.hold_id)).status === 'released', 'manual release → released');
  ok(/hold_not_pending|22023/.test(emsg(await db.rpc('release_hold', { p_org: A, p_hold_id: h5.hold_id }))), 'releasing a released hold rejected (guarded)');
  ok(/hold_not_pending|22023/.test(emsg(await db.rpc('convert_hold', { p_org: A, p_hold_id: h5.hold_id }))), 'converting a released hold rejected (guarded)');

  // ── 8. stays seam: convert delegates to create_room_stay (success + conflict) ──
  console.log('\n8. Stays seam (create_room_stay delegate: success + GiST conflict)');
  const hsOk = (await db.rpc('place_hold', { p_org: A, p_domain: 'stays', p_expires_at: future(), p_room_id: room1, p_room_type_id: rtA, p_check_in: '2099-08-20', p_check_out: '2099-08-22', p_guest_phone: '900000501', p_guest_name: 'StayConv' })).data;
  const cvs = await db.rpc('convert_hold', { p_org: A, p_hold_id: hsOk.hold_id });
  ok(!cvs.error && cvs.data.result.stay_id, 'stays convert → real room_stay via create_room_stay');
  await db.rpc('create_room_stay', { p_org: A, p_phone: '900000502', p_name: 'Occupant', p_room_id: room1, p_room_type_id: rtA, p_check_in: '2099-09-10', p_check_out: '2099-09-12' });
  const hsBad = (await db.rpc('place_hold', { p_org: A, p_domain: 'stays', p_expires_at: future(), p_room_id: room1, p_room_type_id: rtA, p_check_in: '2099-09-11', p_check_out: '2099-09-13', p_guest_phone: '900000503', p_guest_name: 'StayLate' })).data;
  const cvsBad = await db.rpc('convert_hold', { p_org: A, p_hold_id: hsBad.hold_id });
  ok(!!cvsBad.error && /23P01|double_booked/.test(emsg(cvsBad)), 'overlapping stays convert REJECTED by GiST');
  ok((await holdRow(hsBad.hold_id)).status === 'pending', 'rejected stays hold stays pending (no mutation)');

  // ── 9. availability_calendar composes confirmed + active holds ──
  console.log('\n9. Availability calendar composition');
  const D6 = '2099-07-25';
  const h6 = (await placeHall(A, hallA, D6, 'GuestActive')).data;
  const cal = (await db.rpc('availability_calendar', { p_org: A, p_from: '2099-07-01', p_to: '2099-09-30' })).data;
  ok(cal.hall_confirmed.some((x) => x.block_date === D2) && cal.hall_confirmed.some((x) => x.block_date === D3), 'calendar lists CONFIRMED hall bookings (D2, D3)');
  ok(cal.hall_holds.some((x) => x.hold_id === h6.hold_id), 'calendar lists the ACTIVE hold (D6)');
  ok(!cal.hall_holds.some((x) => x.event_date === D2), 'a CONVERTED hold no longer shows as an active hold');
  ok(cal.room_confirmed.length >= 1, 'calendar lists confirmed room stays');

  // ── 10. capability gates ──
  console.log('\n10. Capability gates');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('place_hold', { p_org: A, p_domain: 'hall', p_expires_at: future(), p_hall_id: hallA, p_event_date: '2099-10-01', p_slot: 'full_day', p_guest_name: 'x' }))), 'operative place_hold → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('release_hold', { p_org: A, p_hold_id: h6.hold_id }))), 'operative release_hold → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('convert_hold', { p_org: A, p_hold_id: h6.hold_id }))), 'operative convert_hold → forbidden');
  ok(!(await mgr.cl.rpc('place_hold', { p_org: A, p_domain: 'hall', p_expires_at: future(), p_hall_id: hallA, p_event_date: '2099-10-05', p_slot: 'full_day', p_guest_name: 'MgrHold' })).error, 'manager (hold.manage) place_hold → allowed');
  // a hold.manage user WITHOUT booking.confirm cannot convert a HALL hold (the delegate's own gate)
  const hm2 = (await mgr2.cl.rpc('place_hold', { p_org: A, p_domain: 'hall', p_expires_at: future(), p_hall_id: hallA, p_event_date: '2099-10-09', p_slot: 'full_day', p_guest_name: 'NoConfirm' })).data;
  ok(/forbidden|42501/.test(emsg(await mgr2.cl.rpc('convert_hold', { p_org: A, p_hold_id: hm2.hold_id }))), 'hold.manage WITHOUT booking.confirm cannot convert a hall hold (confirm_booking gate enforced by the delegate)');
  ok(!(await op.cl.rpc('availability_calendar', { p_org: A, p_from: '2099-07-01', p_to: '2099-07-31' })).error, 'operative CAN read availability_calendar (member-open)');

  // ── 11. org isolation (both directions) ──
  console.log('\n11. Tenant isolation (both directions)');
  const hallB = await mkHall(B);
  await db.rpc('place_hold', { p_org: B, p_domain: 'hall', p_expires_at: future(), p_hall_id: hallB, p_event_date: '2099-07-01', p_slot: 'full_day', p_guest_name: 'Bguest' });
  ok((await op.cl.from('date_holds').select('id').eq('org_id', B)).data.length === 0, 'A-member cannot read B.date_holds');
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('place_hold', { p_org: B, p_domain: 'hall', p_expires_at: future(), p_hall_id: hallB, p_event_date: '2099-07-02', p_slot: 'full_day', p_guest_name: 'x' }))), 'A-manager place_hold in B → forbidden');
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('availability_calendar', { p_org: B, p_from: '2099-07-01', p_to: '2099-07-31' }))), 'A-member availability_calendar in B → forbidden');
  ok((await bMgr.cl.from('date_holds').select('id').eq('org_id', A)).data.length === 0, 'B-member cannot read A.date_holds');

  // ── 12. atomicity: bad expiry rejected → zero rows ──
  console.log('\n12. Atomicity on forced failure');
  const holdsBefore = (await db.from('date_holds').select('*', { count: 'exact', head: true }).eq('org_id', A)).count;
  const badExp = await db.rpc('place_hold', { p_org: A, p_domain: 'hall', p_expires_at: PAST, p_hall_id: hallA, p_event_date: '2099-11-01', p_slot: 'full_day', p_guest_name: 'x' });
  ok(!!badExp.error && /bad_expiry|22023/.test(emsg(badExp)), 'place_hold with past expiry rejected');
  ok((await db.from('date_holds').select('*', { count: 'exact', head: true }).eq('org_id', A)).count === holdsBefore, 'rejected hold persisted 0 rows (atomicity)');

  // ── 13. audit ──
  console.log('\n13. Audit trail');
  const aPlace = await auditCount(A, 'hold.place'), aConv = await auditCount(A, 'hold.convert'), aRel = await auditCount(A, 'hold.release'), aExp = await auditCount(A, 'rule.A_hold.expiry');
  ok(aPlace >= 6 && aConv >= 2 && aRel >= 1 && aExp >= 1, `audited: place ${aPlace}, convert ${aConv}, release ${aRel}, expiry ${aExp}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('date_holds').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('bookings').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('room_stays').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
