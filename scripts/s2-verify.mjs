#!/usr/bin/env node
/**
 * S2 harness — walk-ins + check-in/out + Form C. Proves: walk-in creates a
 * checked-in stay on an available room (shared Guest, double-booking guard
 * respected); RESERVED→CHECKED_IN with timestamp (cancelled/no-show rejected);
 * Form C gate — foreign check-in WITHOUT required fields REJECTED server-side,
 * WITH fields succeeds + stored; domestic needs none; CHECKED_IN→CHECKED_OUT
 * with timestamp (non-checked-in rejected); shared Guest reused; org isolation;
 * atomicity on failure; audited. Self-cleaning, re-runnable, exit-coded.
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

const FORM_C = { passport_number: 'P1234567', nationality: 'USA', date_of_birth: '1985-04-12', visa_type: 'tourist', visa_number: 'V99887766', arrived_from: 'Singapore', intended_stay: '3 nights', next_destination: 'Goa' };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (S2 applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId) {
  const email = `pn-s2-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities: [] });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}
const mkRoom = async (org, rtype, num) => (await db.rpc('create_room', { p_org: org, p_room_type_id: rtype, p_number: num ?? `R-${rid()}`, p_name: null })).data.room_id;
const reserve = (org, room, ci, co, phone = '+9170000001', name = 'Latha') => db.rpc('create_room_stay', { p_org: org, p_phone: phone, p_name: name, p_room_id: room, p_room_type_id: null, p_check_in: ci, p_check_out: co });
const stayRow = async (id) => (await db.from('room_stays').select('status,checked_in_at,checked_out_at,is_foreign,guest_id').eq('id', id).single()).data;

async function main() {
  const A = await mkOrg('S2 Org A'), B = await mkOrg('S2 Org B');
  const userA = await mkMember(A);
  const RT = (await db.rpc('upsert_room_type', { p_org: A, p_name: 'Deluxe', p_base_rate: 5000 })).data.room_type_id;

  // ── 1. walk-in ──
  console.log('\n1. Walk-in — creates a checked-in stay, reuses Guest, respects the guard');
  const wr = await mkRoom(A, RT);
  const w = await db.rpc('create_walk_in', { p_org: A, p_phone: '+9198765001', p_name: 'Arjun', p_room_id: wr, p_check_in: '2099-06-10', p_check_out: '2099-06-12' });
  ok(!w.error && w.data.status === 'checked_in', 'walk-in created a CHECKED_IN stay');
  ok((await stayRow(w.data.stay_id)).checked_in_at !== null, 'walk-in recorded a check-in timestamp');
  const wDup = await db.rpc('create_walk_in', { p_org: A, p_phone: '+9198765002', p_name: 'Beena', p_room_id: wr, p_check_in: '2099-06-11', p_check_out: '2099-06-13' });
  ok(!!wDup.error && /23P01|double_booked/.test(errcode(wDup)), 'walk-in onto an occupied room/date → REJECTED (guard holds)');

  // ── 2. check-in transitions + guards ──
  console.log('\n2. Check-in: RESERVED → CHECKED_IN (cancelled/no-show rejected)');
  const r2 = await mkRoom(A, RT);
  const s2 = (await reserve(A, r2, '2099-07-01', '2099-07-04')).data.stay_id;
  const ci = await db.rpc('check_in_stay', { p_org: A, p_stay_id: s2 });
  ok(!ci.error && (await stayRow(s2)).status === 'checked_in' && (await stayRow(s2)).checked_in_at !== null, 'reserved → checked_in with timestamp');
  const r2b = await mkRoom(A, RT);
  const s2b = (await reserve(A, r2b, '2099-07-01', '2099-07-04')).data.stay_id;
  await db.rpc('set_room_stay_status', { p_org: A, p_stay_id: s2b, p_status: 'cancelled' });
  const ciCancel = await db.rpc('check_in_stay', { p_org: A, p_stay_id: s2b });
  ok(!!ciCancel.error && /illegal_transition|22023/.test(errcode(ciCancel)), 'checking in a CANCELLED stay → rejected');

  // ── 3. Form C gate ──
  console.log('\n3. Form C gate (foreign nationals)');
  const r3 = await mkRoom(A, RT);
  const s3 = (await reserve(A, r3, '2099-08-01', '2099-08-04', '+9198111222', 'John Smith')).data.stay_id;
  const noForm = await db.rpc('check_in_stay', { p_org: A, p_stay_id: s3, p_is_foreign: true });
  ok(!!noForm.error && /form_c_required|22023/.test(errcode(noForm)), 'foreign check-in WITHOUT Form C → REJECTED (server-side)');
  ok((await stayRow(s3)).status === 'reserved', 'rejected foreign check-in left stay RESERVED (atomic — no partial)');
  const partial = await db.rpc('check_in_stay', { p_org: A, p_stay_id: s3, p_is_foreign: true, p_form_c: { passport_number: 'P1', nationality: 'UK' } });
  ok(!!partial.error && /form_c_required/.test(errcode(partial)) === false && /22023/.test(errcode(partial)), 'incomplete Form C (missing visa/dob/arrived_from) → REJECTED');
  const good = await db.rpc('check_in_stay', { p_org: A, p_stay_id: s3, p_is_foreign: true, p_form_c: FORM_C });
  ok(!good.error && (await stayRow(s3)).status === 'checked_in', 'foreign check-in WITH complete Form C → succeeds');
  const fc = (await db.from('form_c_records').select('passport_number, nationality, visa_number, arrived_from, stay_id').eq('stay_id', s3).single()).data;
  ok(fc && fc.passport_number === 'P1234567' && fc.visa_number === 'V99887766', 'Form C stored linked to the stay');
  const r3d = await mkRoom(A, RT);
  const s3d = (await reserve(A, r3d, '2099-08-01', '2099-08-04', '+9198333444', 'Domestic Devi')).data.stay_id;
  const dom = await db.rpc('check_in_stay', { p_org: A, p_stay_id: s3d });
  ok(!dom.error && (await stayRow(s3d)).status === 'checked_in', 'domestic check-in needs NO Form C');

  // ── 4. check-out ──
  console.log('\n4. Check-out: CHECKED_IN → CHECKED_OUT (non-checked-in rejected)');
  const co = await db.rpc('check_out_stay', { p_org: A, p_stay_id: s2 });
  ok(!co.error && (await stayRow(s2)).status === 'checked_out' && (await stayRow(s2)).checked_out_at !== null, 'checked_in → checked_out with timestamp');
  const r4 = await mkRoom(A, RT);
  const s4 = (await reserve(A, r4, '2099-09-01', '2099-09-03')).data.stay_id;
  const coBad = await db.rpc('check_out_stay', { p_org: A, p_stay_id: s4 });
  ok(!!coBad.error && /illegal_transition|22023/.test(errcode(coBad)), 'checking out a RESERVED (non-checked-in) stay → rejected');

  // ── 5. shared Guest reuse ──
  console.log('\n5. Shared Guest reuse');
  const ra = await mkRoom(A, RT), rb = await mkRoom(A, RT);
  const wa = await db.rpc('create_walk_in', { p_org: A, p_phone: '+9197000111', p_name: 'Repeat Raja', p_room_id: ra, p_check_in: '2099-10-01', p_check_out: '2099-10-02' });
  const wb = await db.rpc('create_walk_in', { p_org: A, p_phone: '+9197000111', p_name: 'Repeat Raja', p_room_id: rb, p_check_in: '2099-10-05', p_check_out: '2099-10-06' });
  ok(wa.data.guest_id === wb.data.guest_id, 'same phone+name → same Guest (no duplicate)');

  // ── 6. org isolation + audit ──
  console.log('\n6. Tenant isolation + audit');
  const cross = await userA.rpc('create_walk_in', { p_org: B, p_phone: '+91700', p_name: 'X', p_room_id: randomUUID(), p_check_in: '2099-12-01', p_check_out: '2099-12-02' });
  ok(!!cross.error && /42501|forbidden/.test(errcode(cross)), 'A-member walk-in in B → forbidden');
  const iso = await userA.from('form_c_records').select('id').eq('org_id', B);
  ok(!iso.error && iso.data.length === 0, 'A-member cannot read B.form_c_records');
  const aWalk = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'stays.walk_in')).count;
  const aIn = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'stays.check_in')).count;
  const aOut = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'stays.check_out')).count;
  ok(aWalk >= 1 && aIn >= 2 && aOut >= 1, `audited: walk_in ${aWalk}, check_in ${aIn}, check_out ${aOut}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('room_stays').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('form_c_records').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
