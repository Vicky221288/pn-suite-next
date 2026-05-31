#!/usr/bin/env node
/**
 * S1 harness — RoomStay foundation + double-booking guard. Proves the guard's
 * boundaries EXPLICITLY: overlap rejected; same-day turnover (checkout=checkin)
 * ALLOWED (half-open [) — the make-or-break); contained/partial rejected;
 * gap/adjacent allowed; CANCELLED/NO_SHOW don't block; different rooms OK; shared
 * Guest reused; status transitions guarded; atomicity on failure; org isolation;
 * audited. Self-cleaning, re-runnable, exit-coded. Throwaway orgs.
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
const errcode = (r) => r.error?.code ?? r.error?.message ?? '';
const rid = () => randomUUID().slice(0, 8);
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (S1 applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId) {
  const email = `pn-s1-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities: [] });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}
const mkRoom = async (org, rtype, num) => (await db.rpc('create_room', { p_org: org, p_room_type_id: rtype, p_number: num ?? `R-${rid()}`, p_name: null })).data.room_id;
const stay = (org, room, ci, co, phone = '+9170000001', name = 'Latha') => db.rpc('create_room_stay', { p_org: org, p_phone: phone, p_name: name, p_room_id: room, p_room_type_id: null, p_check_in: ci, p_check_out: co });
const isReject = (r) => !!r.error && /23P01|room_double_booked/.test(errcode(r));

async function main() {
  const A = await mkOrg('S1 Org A'), B = await mkOrg('S1 Org B');
  const userA = await mkMember(A);
  const RT = (await db.rpc('upsert_room_type', { p_org: A, p_name: 'Deluxe', p_base_rate: 5000 })).data.room_type_id;

  // ── 1. overlap rejected ──
  console.log('\n1. Overlapping reservations on the same room');
  const r1 = await mkRoom(A, RT);
  const s1 = await stay(A, r1, '2099-06-10', '2099-06-15');
  ok(!s1.error, 'base reservation [06-10, 06-15) created');
  ok(isReject(await stay(A, r1, '2099-06-12', '2099-06-14')), 'overlapping (contained) reservation → REJECTED');

  // ── 2. same-day turnover ALLOWED (the make-or-break boundary) ──
  console.log('\n2. Same-day turnover (checkout = next check-in) is NOT a conflict');
  const r2 = await mkRoom(A, RT);
  ok(!(await stay(A, r2, '2099-06-10', '2099-06-12')).error, 'guest A [06-10, 06-12)');
  ok(!(await stay(A, r2, '2099-06-12', '2099-06-15')).error, 'guest B [06-12, 06-15) — checkout day frees the room → ALLOWED');

  // ── 3. boundary matrix (fresh room per case; base = [06-10, 06-15)) ──
  console.log('\n3. Boundary matrix vs base [06-10, 06-15)');
  async function boundary(label, ci, co, expectAllowed) {
    const room = await mkRoom(A, RT);
    await stay(A, room, '2099-06-10', '2099-06-15');
    const res = await stay(A, room, ci, co);
    const allowed = !res.error;
    ok(allowed === expectAllowed, `${label} [${ci}, ${co}) → ${expectAllowed ? 'ALLOWED' : 'REJECTED'}${allowed === expectAllowed ? '' : ' (got ' + (allowed ? 'allowed' : errcode(res)) + ')'}`);
  }
  await boundary('contained', '2099-06-11', '2099-06-13', false);
  await boundary('partial-late', '2099-06-14', '2099-06-17', false);
  await boundary('partial-early', '2099-06-08', '2099-06-11', false);
  await boundary('adjacent-after (starts on base checkout)', '2099-06-15', '2099-06-18', true);
  await boundary('adjacent-before (ends on base checkin)', '2099-06-07', '2099-06-10', true);
  await boundary('one-night gap after', '2099-06-16', '2099-06-18', true);

  // ── 4. CANCELLED / NO_SHOW do not block ──
  console.log('\n4. Cancelled / no-show reservations do NOT block');
  const r4 = await mkRoom(A, RT);
  const sc = await stay(A, r4, '2099-07-01', '2099-07-05');
  await db.rpc('set_room_stay_status', { p_org: A, p_stay_id: sc.data.stay_id, p_status: 'cancelled' });
  ok(!(await stay(A, r4, '2099-07-01', '2099-07-05')).error, 'same room+dates after CANCEL → ALLOWED');
  const r4b = await mkRoom(A, RT);
  const sn = await stay(A, r4b, '2099-07-01', '2099-07-05');
  await db.rpc('set_room_stay_status', { p_org: A, p_stay_id: sn.data.stay_id, p_status: 'no_show' });
  ok(!(await stay(A, r4b, '2099-07-01', '2099-07-05')).error, 'same room+dates after NO_SHOW → ALLOWED');

  // ── 5. different rooms, same dates → both allowed ──
  console.log('\n5. Different rooms, same dates');
  const rx = await mkRoom(A, RT), ry = await mkRoom(A, RT);
  ok(!(await stay(A, rx, '2099-08-01', '2099-08-03')).error && !(await stay(A, ry, '2099-08-01', '2099-08-03')).error, 'two different rooms, identical dates → both ALLOWED');

  // ── 6. shared Guest reuse ──
  console.log('\n6. Reservation reuses the shared Guest');
  const ra = await mkRoom(A, RT), rb = await mkRoom(A, RT);
  const g1 = await stay(A, ra, '2099-09-01', '2099-09-02', '+9199999001', 'Ravi');
  const g2 = await stay(A, rb, '2099-09-10', '2099-09-11', '+9199999001', 'Ravi');
  ok(g1.data.guest_id === g2.data.guest_id, 'same phone+name → same Guest (no duplicate)');

  // ── 7. status transitions guarded ──
  console.log('\n7. Status transitions guarded');
  const rt = await mkRoom(A, RT);
  const st = (await stay(A, rt, '2099-10-01', '2099-10-04')).data.stay_id;
  ok(!(await db.rpc('set_room_stay_status', { p_org: A, p_stay_id: st, p_status: 'checked_in' })).error, 'reserved → checked_in OK');
  ok(!(await db.rpc('set_room_stay_status', { p_org: A, p_stay_id: st, p_status: 'checked_out' })).error, 'checked_in → checked_out OK');
  ok(!(await db.rpc('set_room_stay_status', { p_org: A, p_stay_id: st, p_status: 'settled' })).error, 'checked_out → settled OK');
  const bad = await db.rpc('set_room_stay_status', { p_org: A, p_stay_id: st, p_status: 'checked_in' });
  ok(!!bad.error && /illegal_transition|22023/.test(errcode(bad)), 'settled → checked_in REJECTED (terminal)');
  const rc = await mkRoom(A, RT);
  const sc2 = (await stay(A, rc, '2099-10-10', '2099-10-12')).data.stay_id;
  await db.rpc('set_room_stay_status', { p_org: A, p_stay_id: sc2, p_status: 'cancelled' });
  ok(/illegal_transition|22023/.test(errcode(await db.rpc('set_room_stay_status', { p_org: A, p_stay_id: sc2, p_status: 'checked_in' }))), 'cannot check-in a CANCELLED stay');

  // ── 8. atomicity: a rejected booking leaves no partial write ──
  console.log('\n8. Atomicity on failure');
  const rA = await mkRoom(A, RT);
  await stay(A, rA, '2099-11-01', '2099-11-05');
  const before = (await db.from('room_stays').select('*', { count: 'exact', head: true }).eq('room_id', rA)).count;
  await stay(A, rA, '2099-11-02', '2099-11-03'); // rejected
  const after = (await db.from('room_stays').select('*', { count: 'exact', head: true }).eq('room_id', rA)).count;
  ok(before === 1 && after === 1, 'rejected reservation wrote nothing (no partial row)');

  // ── 9. org isolation + audit ──
  console.log('\n9. Tenant isolation + audit');
  const cross = await userA.rpc('create_room_stay', { p_org: B, p_phone: '+91700', p_name: 'X', p_room_id: randomUUID(), p_room_type_id: null, p_check_in: '2099-12-01', p_check_out: '2099-12-02' });
  ok(!!cross.error && /42501|forbidden/.test(errcode(cross)), 'A-member create_room_stay in B → forbidden');
  for (const t of ['rooms', 'room_stays', 'room_types']) {
    const r = await userA.from(t).select('id').eq('org_id', B);
    ok(!r.error && r.data.length === 0, `A-member cannot read B.${t}`);
  }
  const aCreate = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'stays.stay_create')).count;
  const aStatus = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'stays.stay_status')).count;
  ok(aCreate >= 1 && aStatus >= 1, `audited: stay_create ${aCreate}, stay_status ${aStatus}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('room_stays').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('rooms').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
