#!/usr/bin/env node
/**
 * S3 harness — housekeeping + room status board + maintenance. Proves: occupancy
 * (derived) and housekeeping (stored) are INDEPENDENT dimensions; check-out sets
 * the room DIRTY + opens a turn task; a turn assigned to staff + completed (with
 * photo-proof if required) → room INSPECTED/CLEAN, photo-required rejected without
 * a ref; maintenance lifecycle open→in_progress→resolved; OUT_OF_ORDER flags
 * not-sellable; sellable = vacant AND inspected/clean AND in-service; org
 * isolation; atomicity; audited. Self-cleaning, re-runnable, exit-coded.
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

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (S3 applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId) {
  const email = `pn-s3-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities: [] });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}
const mkRoom = async (org, rtype, num) => (await db.rpc('create_room', { p_org: org, p_room_type_id: rtype, p_number: num ?? `R-${rid()}`, p_name: null })).data.room_id;
const mkStaff = async (org, name) => (await db.from('staff').insert({ org_id: org, name, role: 'operative', active: true }).select('id').single()).data.id;
const reserve = (org, room, ci, co, phone = '+9170000001', name = 'Latha') => db.rpc('create_room_stay', { p_org: org, p_phone: phone, p_name: name, p_room_id: room, p_room_type_id: null, p_check_in: ci, p_check_out: co });
const board = async (org) => (await db.rpc('room_board', { p_org: org })).data.rooms;
const boardRoom = async (org, roomId) => (await board(org)).find((r) => r.room_id === roomId);
const hk = async (id) => (await db.from('rooms').select('housekeeping_status').eq('id', id).single()).data.housekeeping_status;

async function main() {
  const A = await mkOrg('S3 Org A'), B = await mkOrg('S3 Org B');
  const userA = await mkMember(A);
  const RT = (await db.rpc('upsert_room_type', { p_org: A, p_name: 'Deluxe', p_base_rate: 5000 })).data.room_type_id;
  const cleaner = await mkStaff(A, 'Cleaner');

  // ── 1. occupancy and housekeeping are independent ──
  console.log('\n1. Occupancy (derived) and housekeeping (stored) are independent');
  const rv = await mkRoom(A, RT);
  await db.rpc('set_housekeeping_status', { p_org: A, p_room_id: rv, p_status: 'dirty' });
  let bv = await boardRoom(A, rv);
  ok(bv.occupied === false && bv.housekeeping_status === 'dirty', 'vacant + dirty (a vacant room can be dirty)');
  await db.rpc('set_housekeeping_status', { p_org: A, p_room_id: rv, p_status: 'inspected' });
  bv = await boardRoom(A, rv);
  ok(bv.occupied === false && bv.housekeeping_status === 'inspected' && bv.sellable === true, 'vacant + inspected = sellable');
  const ro = await mkRoom(A, RT);
  const stay = (await reserve(A, ro, '2099-06-10', '2099-06-15')).data.stay_id;
  await db.rpc('check_in_stay', { p_org: A, p_stay_id: stay });
  await db.rpc('set_housekeeping_status', { p_org: A, p_room_id: ro, p_status: 'inspected' });
  const bo = await boardRoom(A, ro);
  ok(bo.occupied === true && bo.sellable === false, 'occupied room shows occupied + not sellable regardless of housekeeping');

  // ── 2. check-out → DIRTY + turn task ──
  console.log('\n2. Check-out dirties the room + opens a turn task');
  const co = await db.rpc('check_out_stay', { p_org: A, p_stay_id: stay });
  ok(!co.error && (await hk(ro)) === 'dirty', 'checkout set the room DIRTY');
  const task = (await db.from('housekeeping_tasks').select('id, status, kind').eq('room_id', ro).eq('stay_id', stay).single()).data;
  ok(!!task && task.kind === 'turnover' && task.status === 'pending', 'checkout created a pending turnover task');

  // ── 3. turn assigned + completed (photo-proof) → INSPECTED ──
  console.log('\n3. Housekeeping turn: assign → complete (photo-proof) → inspected');
  await db.rpc('assign_housekeeping_task', { p_org: A, p_task_id: task.id, p_staff_id: cleaner });
  ok((await db.from('housekeeping_tasks').select('status, assigned_staff_id').eq('id', task.id).single()).data.assigned_staff_id === cleaner, 'turn assigned to staff (in_progress)');
  // a photo-required turn
  const rp = await mkRoom(A, RT);
  await db.rpc('set_housekeeping_status', { p_org: A, p_room_id: rp, p_status: 'dirty' });
  const ptask = (await db.rpc('create_housekeeping_task', { p_org: A, p_room_id: rp, p_kind: 'deep_clean', p_requires_photo: true })).data.task_id;
  const noPhoto = await db.rpc('complete_housekeeping_task', { p_org: A, p_task_id: ptask });
  ok(!!noPhoto.error && /photo_required|22023/.test(errcode(noPhoto)) && (await hk(rp)) === 'dirty', 'photo-required turn rejected without photo_ref; room stays dirty (atomic)');
  await db.rpc('complete_housekeeping_task', { p_org: A, p_task_id: ptask, p_photo_ref: 'hk/room-clean.jpg', p_result: 'inspected' });
  ok((await hk(rp)) === 'inspected', 'turn completed with photo-proof → room INSPECTED');
  await db.rpc('complete_housekeeping_task', { p_org: A, p_task_id: task.id, p_result: 'clean' });
  ok((await hk(ro)) === 'clean', 'non-photo turn completes → room CLEAN');

  // ── 4. maintenance lifecycle + out-of-order ──
  console.log('\n4. Maintenance lifecycle + out-of-order');
  const rm = await mkRoom(A, RT);
  await db.rpc('set_housekeeping_status', { p_org: A, p_room_id: rm, p_status: 'inspected' });
  ok((await boardRoom(A, rm)).sellable === true, 'room sellable before maintenance');
  const req = (await db.rpc('create_maintenance_request', { p_org: A, p_room_id: rm, p_description: 'AC broken', p_priority: 'critical' })).data.request_id;
  await db.rpc('set_maintenance_status', { p_org: A, p_request_id: req, p_status: 'in_progress', p_staff_id: cleaner });
  ok((await db.from('maintenance_requests').select('status').eq('id', req).single()).data.status === 'in_progress', 'request open → in_progress');
  const badT = await db.rpc('set_maintenance_status', { p_org: A, p_request_id: req, p_status: 'open' });
  ok(!!badT.error && /illegal_transition|22023/.test(errcode(badT)), 'in_progress → open rejected (illegal transition)');
  await db.rpc('set_room_out_of_order', { p_org: A, p_room_id: rm });
  ok((await hk(rm)) === 'out_of_order' && (await boardRoom(A, rm)).sellable === false, 'room OUT_OF_ORDER → not sellable');
  await db.rpc('set_maintenance_status', { p_org: A, p_request_id: req, p_status: 'resolved' });
  ok(!!(await db.from('maintenance_requests').select('resolved_at').eq('id', req).single()).data.resolved_at, 'request resolved (timestamped)');
  await db.rpc('restore_room', { p_org: A, p_room_id: rm });
  ok((await hk(rm)) === 'dirty', 'restore from OOO → dirty (needs cleaning)');

  // ── 5. sellable formula ──
  console.log('\n5. Sellable = vacant AND inspected/clean AND in-service');
  const rs = await mkRoom(A, RT);
  await db.rpc('set_housekeeping_status', { p_org: A, p_room_id: rs, p_status: 'dirty' });
  ok((await boardRoom(A, rs)).sellable === false, 'vacant but dirty → NOT sellable');
  await db.rpc('set_housekeeping_status', { p_org: A, p_room_id: rs, p_status: 'inspected' });
  ok((await boardRoom(A, rs)).sellable === true, 'vacant + inspected → sellable');
  await db.rpc('set_room_status', { p_org: A, p_room_id: rs, p_status: 'out_of_service' });
  ok((await boardRoom(A, rs)).sellable === false, 'out_of_service (S1) → NOT sellable even if inspected');

  // ── 6. org isolation + audit ──
  console.log('\n6. Tenant isolation + audit');
  const cross = await userA.rpc('set_housekeeping_status', { p_org: B, p_room_id: randomUUID(), p_status: 'dirty' });
  ok(!!cross.error && /42501|forbidden/.test(errcode(cross)), 'A-member set_housekeeping_status in B → forbidden');
  for (const t of ['housekeeping_tasks', 'maintenance_requests']) {
    const r = await userA.from(t).select('id').eq('org_id', B);
    ok(!r.error && r.data.length === 0, `A-member cannot read B.${t}`);
  }
  const aCo = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'stays.hk_task_complete')).count;
  const aMaint = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'stays.maint_status')).count;
  ok(aCo >= 2 && aMaint >= 2, `audited: hk_task_complete ${aCo}, maint_status ${aMaint}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('housekeeping_tasks').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('maintenance_requests').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
