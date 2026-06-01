#!/usr/bin/env node
/**
 * M1b harness — WORKFORCE: attendance + leave + HR + GENERIC tiered-approval.
 * Proves: (A) HR fields persist on the SAME W0 staff row (no duplicate person);
 * (B) geofence config is per-org; device-evaluated on_premise stored true/false;
 * **NO lat/long column is ever persisted on the attendance event**; (C) leave
 * lifecycle request → approved AND → rejected, guarded (illegal txn rejected),
 * audited; (D) the approval primitive is GENERIC — a leave flows through as
 * request_type='leave' with a POLYMORPHIC subject_id (no leave_id column),
 * multi-tier (required_approvals), distinct-approver, anti-self-approval;
 * approver capability gate; org isolation both directions; atomicity on a forced
 * mid-tx failure (zero partial rows); audited. Self-cleaning, re-runnable,
 * exit-coded. Throwaway orgs.
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
const emsg = (r) => `${r.error?.code ?? ''} ${r.error?.message ?? ''} ${r.error?.details ?? ''} ${r.error?.hint ?? ''}`;
const rid = () => randomUUID().slice(0, 8);
const plusDays = (n) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const created = { users: [], orgs: [] };

// device-side geofence math (mirrors lib/geo.ts) — produces the boolean the device would send
const within = (cLat, cLng, rad, lat, lng) => {
  const R = 6371000, r = (d) => (d * Math.PI) / 180;
  const dLa = r(lat - cLat), dLo = r(lng - cLng);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(r(cLat)) * Math.cos(r(lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a)) <= rad;
};

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (M1b applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-m1b-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return { cl, id: c.data.user.id };
}
const mkStaff = async (org, name) => (await db.from('staff').insert({ org_id: org, name, role: 'operative', active: true }).select('id').single()).data.id;
const auditCount = async (org, action) => (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('action', action)).count;
const leaveStatus = async (id) => (await db.from('leave_requests').select('status').eq('id', id).single()).data?.status;

async function main() {
  const A = await mkOrg('M1b Org A'), B = await mkOrg('M1b Org B');
  const appr1 = await mkMember(A, ['approval.decide', 'staff.manage']);
  const appr2 = await mkMember(A, ['approval.decide']);
  const op = await mkMember(A, []);
  const bAppr = await mkMember(B, ['approval.decide', 'staff.manage']);
  const s1 = await mkStaff(A, 'Anbu'); const sB = await mkStaff(B, 'Bharath');
  const staffCountBefore = (await db.from('staff').select('*', { count: 'exact', head: true }).eq('org_id', A)).count;

  // M1a shift to link attendance to (honors the dependency)
  const ros = (await db.rpc('create_roster', { p_org: A, p_name: `R-${rid()}`, p_period_start: plusDays(7), p_period_end: plusDays(7) })).data.roster_id;
  const shift = (await db.rpc('upsert_shift', { p_org: A, p_roster_id: ros, p_shift_date: plusDays(7), p_start_time: '09:00', p_end_time: '17:00' })).data.shift_id;

  // ── A. HR fields on the SAME W0 staff row ──
  console.log('\nA. HR fields extend the W0 staff row (no duplicate person)');
  const hr = await db.rpc('set_hr_fields', { p_org: A, p_staff_id: s1, p_employee_code: `EMP-${rid()}`, p_date_of_joining: '2020-01-15', p_designation: 'Captain', p_employment_type: 'full_time', p_email: 'anbu@example.com' });
  ok(!hr.error, 'set_hr_fields ok');
  const s1row = (await db.from('staff').select('id, name, employee_code, designation, employment_type, date_of_joining, email').eq('id', s1).single()).data;
  ok(s1row.designation === 'Captain' && s1row.employment_type === 'full_time' && !!s1row.employee_code && s1row.date_of_joining === '2020-01-15', 'HR fields persisted on the staff row');
  const staffCountAfter = (await db.from('staff').select('*', { count: 'exact', head: true }).eq('org_id', A)).count;
  ok(staffCountAfter === staffCountBefore, `no duplicate person record (staff count unchanged: ${staffCountAfter})`);

  // ── B. geofence per-org + on_premise boolean + NO coordinates persisted ──
  console.log('\nB. Geofenced on-premise attendance (boolean only; no coordinates)');
  await db.rpc('set_geofence', { p_org: A, p_center_lat: 13.10, p_center_lng: 80.18, p_radius_m: 200 });
  await db.rpc('set_geofence', { p_org: B, p_center_lat: 28.61, p_center_lng: 77.20, p_radius_m: 150 });
  const fenceA = (await db.from('attendance_geofences').select('center_lat, center_lng, radius_m').eq('org_id', A).single()).data;
  const fenceB = (await db.from('attendance_geofences').select('center_lat, center_lng, radius_m').eq('org_id', B).single()).data;
  ok(Number(fenceA.center_lat) === 13.1 && Number(fenceB.center_lat) === 28.61, 'geofence config is per-org (A and B distinct)');
  const insideBool = within(13.10, 80.18, 200, 13.10, 80.18);   // at centre → inside
  const outsideBool = within(13.10, 80.18, 200, 13.20, 80.18);  // ~11km away → outside
  ok(insideBool === true && outsideBool === false, 'device geofence eval: inside → true, outside → false');
  const inAtt = await db.rpc('record_attendance', { p_org: A, p_staff_id: s1, p_kind: 'check_in', p_on_premise: insideBool, p_shift_id: shift });
  const outAtt = await db.rpc('record_attendance', { p_org: A, p_staff_id: s1, p_kind: 'check_out', p_on_premise: outsideBool });
  const inRow = (await db.from('attendance_records').select('*').eq('id', inAtt.data.attendance_id).single()).data;
  const outRow = (await db.from('attendance_records').select('*').eq('id', outAtt.data.attendance_id).single()).data;
  ok(inRow.on_premise === true && outRow.on_premise === false, 'on_premise stored faithfully (true / false) + timestamped');
  const coordKeys = Object.keys(inRow).filter((k) => /lat|lng|long|coord|geo|location/i.test(k));
  ok(coordKeys.length === 0, `NO coordinate column persisted on the attendance event (keys: ${Object.keys(inRow).join(',')})`);

  // ── C/D. leave lifecycle through the GENERIC approval primitive ──
  console.log('\nC/D. Leave via the generic tiered-approval primitive');
  // L1: single-tier APPROVE (requester = op, so approvers differ)
  const L1 = (await db.rpc('request_leave', { p_org: A, p_staff_id: s1, p_leave_type: 'casual', p_start: plusDays(30), p_end: plusDays(31), p_reason: 'family', p_required_approvals: 1, p_requested_by_user: op.id })).data.leave_id;
  ok(await leaveStatus(L1) === 'pending', 'L1 created pending');
  ok(!(await appr1.cl.rpc('decide_leave', { p_org: A, p_leave_id: L1, p_decision: 'approve' })).error, 'approver approves L1');
  ok(await leaveStatus(L1) === 'approved', 'L1 → approved');
  const reDecide = await appr1.cl.rpc('decide_leave', { p_org: A, p_leave_id: L1, p_decision: 'approve' });
  ok(!!reDecide.error && /not_pending/.test(emsg(reDecide)), 'deciding an already-approved leave REJECTED (illegal transition)');

  // polymorphism: the approval thread references the leave by (request_type, subject_id), NOT a leave_id FK
  const appr = (await db.from('approval_requests').select('*').eq('request_type', 'leave').eq('subject_id', L1).single()).data;
  ok(appr && appr.request_type === 'leave' && appr.subject_id === L1, 'approval thread is polymorphic: request_type=leave + subject_id=leave id');
  ok(!('leave_id' in appr) && !Object.keys(appr).some((k) => /leave/i.test(k)), `NO leave_id/leave-specific column on approval_requests (generic; keys: ${Object.keys(appr).join(',')})`);

  // L2: single-tier REJECT
  const L2 = (await db.rpc('request_leave', { p_org: A, p_staff_id: s1, p_leave_type: 'sick', p_start: plusDays(40), p_end: plusDays(40), p_required_approvals: 1, p_requested_by_user: op.id })).data.leave_id;
  ok(!(await appr1.cl.rpc('decide_leave', { p_org: A, p_leave_id: L2, p_decision: 'reject' })).error, 'approver rejects L2');
  ok(await leaveStatus(L2) === 'rejected', 'L2 → rejected');

  // L3: anti-self-approval — requester is appr1; appr1 cannot decide; appr2 can
  const L3 = (await db.rpc('request_leave', { p_org: A, p_staff_id: s1, p_leave_type: 'casual', p_start: plusDays(50), p_end: plusDays(50), p_required_approvals: 1, p_requested_by_user: appr1.id })).data.leave_id;
  const selfDec = await appr1.cl.rpc('decide_leave', { p_org: A, p_leave_id: L3, p_decision: 'approve' });
  ok(!!selfDec.error && /self_approval/.test(emsg(selfDec)), 'self-approval REJECTED (approver = requester)');
  ok(!(await appr2.cl.rpc('decide_leave', { p_org: A, p_leave_id: L3, p_decision: 'approve' })).error && await leaveStatus(L3) === 'approved', 'a DIFFERENT approver approves L3 → approved');

  // L4: multi-tier (required_approvals = 2) + distinct-approver
  const L4 = (await db.rpc('request_leave', { p_org: A, p_staff_id: s1, p_leave_type: 'casual', p_start: plusDays(60), p_end: plusDays(61), p_required_approvals: 2, p_requested_by_user: op.id })).data.leave_id;
  ok(!(await appr1.cl.rpc('decide_leave', { p_org: A, p_leave_id: L4, p_decision: 'approve' })).error && await leaveStatus(L4) === 'pending', 'tier 1/2 approved → still pending');
  const dbl = await appr1.cl.rpc('decide_leave', { p_org: A, p_leave_id: L4, p_decision: 'approve' });
  ok(!!dbl.error && /already_decided/.test(emsg(dbl)), 'same approver cannot decide twice (distinct-approver)');
  ok(!(await appr2.cl.rpc('decide_leave', { p_org: A, p_leave_id: L4, p_decision: 'approve' })).error && await leaveStatus(L4) === 'approved', 'tier 2/2 by a second approver → approved');

  // ── capability gate ──
  console.log('\nE. Capability gate (approval.decide / staff.manage)');
  const L5 = (await db.rpc('request_leave', { p_org: A, p_staff_id: s1, p_leave_type: 'casual', p_start: plusDays(70), p_end: plusDays(70), p_required_approvals: 1, p_requested_by_user: appr1.id })).data.leave_id;
  const opDecide = await op.cl.rpc('decide_leave', { p_org: A, p_leave_id: L5, p_decision: 'approve' });
  ok(!!opDecide.error && /forbidden|42501/.test(emsg(opDecide)), 'operative decide_leave → forbidden (no approval.decide)');
  const opHr = await op.cl.rpc('set_hr_fields', { p_org: A, p_staff_id: s1, p_designation: 'x' });
  ok(!!opHr.error && /forbidden|42501/.test(emsg(opHr)), 'operative set_hr_fields → forbidden (no staff.manage)');
  const opRequest = await op.cl.rpc('request_leave', { p_org: A, p_staff_id: s1, p_leave_type: 'casual', p_start: plusDays(80), p_end: plusDays(80), p_required_approvals: 1 });
  ok(!opRequest.error, 'operative CAN request leave (requesting is open to members)');

  // ── atomicity: forced mid-tx failure (required_approvals = 0) → zero partial rows ──
  console.log('\nF. Atomicity on forced mid-tx failure');
  const lvBefore = (await db.from('leave_requests').select('*', { count: 'exact', head: true }).eq('staff_id', s1)).count;
  const bad = await db.rpc('request_leave', { p_org: A, p_staff_id: s1, p_leave_type: 'bad', p_start: plusDays(90), p_end: plusDays(90), p_required_approvals: 0, p_requested_by_user: op.id });
  ok(!!bad.error, 'request_leave with required_approvals=0 fails (CHECK fires in the approval insert, mid-tx)');
  const lvAfter = (await db.from('leave_requests').select('*', { count: 'exact', head: true }).eq('staff_id', s1)).count;
  ok(lvAfter === lvBefore, `atomicity: the leave insert rolled back with the approval insert (count ${lvBefore} → ${lvAfter}, zero partial rows)`);

  // ── org isolation (both directions) ──
  console.log('\nG. Tenant isolation (both directions)');
  await db.rpc('record_attendance', { p_org: B, p_staff_id: sB, p_kind: 'check_in', p_on_premise: true });
  const LB = (await db.rpc('request_leave', { p_org: B, p_staff_id: sB, p_leave_type: 'casual', p_start: plusDays(30), p_end: plusDays(30), p_required_approvals: 1, p_requested_by_user: bAppr.id })).data.leave_id;
  for (const t of ['attendance_geofences', 'attendance_records', 'leave_requests', 'approval_requests', 'approval_decisions']) {
    const r = await op.cl.from(t).select('*').eq('org_id', B);
    ok(!r.error && r.data.length === 0, `A-member cannot read B.${t}`);
  }
  const aIntoB = await appr1.cl.rpc('decide_leave', { p_org: B, p_leave_id: LB, p_decision: 'approve' });
  ok(!!aIntoB.error && /forbidden|42501/.test(emsg(aIntoB)), 'A-approver decide_leave in B → forbidden');
  const bReadA = await bAppr.cl.from('leave_requests').select('*').eq('org_id', A);
  ok(!bReadA.error && bReadA.data.length === 0, 'B-member cannot read A.leave_requests');

  // ── audit ──
  console.log('\nH. Audit trail');
  const aHr = await auditCount(A, 'workforce.hr_fields_set'), aFence = await auditCount(A, 'workforce.geofence_set');
  const aAtt = await auditCount(A, 'workforce.attendance_record'), aLv = await auditCount(A, 'workforce.leave_request');
  const aSub = await auditCount(A, 'workforce.approval_submit'), aDec = await auditCount(A, 'workforce.approval_decide'), aLvD = await auditCount(A, 'workforce.leave_decide');
  ok(aHr >= 1 && aFence >= 1 && aAtt >= 2 && aLv >= 5 && aSub >= 5 && aDec >= 4 && aLvD >= 4,
    `audited: hr ${aHr}, geofence ${aFence}, attendance ${aAtt}, leave_req ${aLv}, approval_submit ${aSub}, approval_decide ${aDec}, leave_decide ${aLvD}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('leave_requests').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('approval_requests').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('attendance_records').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
