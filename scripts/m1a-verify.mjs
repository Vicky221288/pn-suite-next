#!/usr/bin/env node
/**
 * M1a harness — WORKFORCE: staff scheduling. Proves: (1) shift template →
 * concrete shifts (recurring expansion correct + idempotent re-generate);
 * (2) assign staff + guarded status lifecycle (illegal transition rejected);
 * (3) THE GUARD — a staff member assigned to an overlapping shift is REJECTED by
 * the GiST EXCLUDE; adjacent shifts allowed; cancelled/no_show FREE the slot
 * (S1 boundary matrix); (4) draft vs published (unpublished not surfaced as
 * published to a non-manager); (5) reuses the SAME W0 staff row (no parallel
 * person record); (6) capability gate (manager can publish/assign, operative
 * cannot); (7) org isolation both directions; (8) atomicity on the rejected
 * overlap (zero partial rows); (9) audited. Self-cleaning, re-runnable,
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
const errcode = (r) => r.error?.code ?? r.error?.message ?? '';
const rid = () => randomUUID().slice(0, 8);
const plusDays = (n) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (M1a applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-m1a-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}
const mkStaff = async (org, name) => (await db.from('staff').insert({ org_id: org, name, role: 'operative', active: true }).select('id').single()).data.id;
const auditCount = async (org, action) => (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('action', action)).count;

async function main() {
  const A = await mkOrg('M1a Org A'), B = await mkOrg('M1a Org B');
  const mgr = await mkMember(A, ['roster.manage']);
  const op = await mkMember(A, []);
  const bMgr = await mkMember(B, ['roster.manage']);
  const s1 = await mkStaff(A, 'Anbu'), s2 = await mkStaff(A, 'Bala'), s3 = await mkStaff(A, 'Chitra'), s4 = await mkStaff(A, 'Devi');

  // ── 1. template → concrete shifts (recurring expansion + idempotent) ──
  console.log('\n1. Shift template → generate concrete shifts (recurring + idempotent)');
  const tpl = await db.rpc('upsert_shift_template', { p_org: A, p_name: `Floor-${rid()}`, p_role: 'server', p_start_time: '09:00', p_end_time: '17:00', p_days_of_week: [1, 3] }); // Mon + Wed
  ok(!tpl.error && tpl.data.template_id, 'template created (Mon+Wed 09:00–17:00)');
  const RP = plusDays(14), RPe = plusDays(20); // 7-day window: each weekday once → exactly 2 matches (Mon,Wed)
  const ros = await db.rpc('create_roster', { p_org: A, p_name: `W-${rid()}`, p_period_start: RP, p_period_end: RPe });
  ok(!ros.error && ros.data.roster_id, 'draft roster created');
  const gen = await db.rpc('generate_shifts_from_template', { p_org: A, p_roster_id: ros.data.roster_id, p_template_id: tpl.data.template_id });
  ok(!gen.error && gen.data.generated === 2, `generated exactly 2 shifts over a 7-day window (Mon+Wed) (got ${gen.data?.generated})`);
  const gen2 = await db.rpc('generate_shifts_from_template', { p_org: A, p_roster_id: ros.data.roster_id, p_template_id: tpl.data.template_id });
  ok(!gen2.error && gen2.data.generated === 0, 're-generate → 0 new (idempotent)');
  const genShifts = (await db.from('shifts').select('id, shift_date, start_at, end_at').eq('roster_id', ros.data.roster_id).order('shift_date')).data;
  ok(genShifts.length === 2, '2 concrete shift rows persisted');

  // ── 2. assign + guarded status lifecycle ──
  console.log('\n2. Assign staff + guarded status lifecycle');
  const a1 = await db.rpc('assign_shift', { p_org: A, p_shift_id: genShifts[0].id, p_staff_id: s1 });
  ok(!a1.error && a1.data.assignment_id, 'assigned staff to a generated shift');
  ok(!(await db.rpc('set_shift_assignment_status', { p_org: A, p_assignment_id: a1.data.assignment_id, p_status: 'acknowledged' })).error, 'scheduled → acknowledged');
  ok(!(await db.rpc('set_shift_assignment_status', { p_org: A, p_assignment_id: a1.data.assignment_id, p_status: 'completed' })).error, 'acknowledged → completed');
  const a2 = await db.rpc('assign_shift', { p_org: A, p_shift_id: genShifts[1].id, p_staff_id: s2 });
  const illegal = await db.rpc('set_shift_assignment_status', { p_org: A, p_assignment_id: a2.data.assignment_id, p_status: 'completed' }); // scheduled→completed skips acknowledged
  ok(!!illegal.error && /illegal_transition|22023/.test(errcode(illegal)), 'illegal transition (scheduled → completed) REJECTED');

  // ── 3. THE GUARD — staff overlap rejected; adjacent allowed; cancelled/no_show free ──
  console.log('\n3. THE GUARD: staff double-booking (EXCLUDE) + boundary matrix');
  const D = plusDays(7);
  const R2 = (await db.rpc('create_roster', { p_org: A, p_name: `Guard-${rid()}`, p_period_start: D, p_period_end: D })).data.roster_id;
  const mk = async (st, en) => (await db.rpc('upsert_shift', { p_org: A, p_roster_id: R2, p_shift_date: D, p_start_time: st, p_end_time: en, p_role: 'floor' })).data.shift_id;
  const mX = await mk('09:00', '12:00'), mY = await mk('11:00', '13:00'), mZ = await mk('12:00', '14:00'), mW = await mk('16:00', '18:00');

  ok(!(await db.rpc('assign_shift', { p_org: A, p_shift_id: mX, p_staff_id: s1 })).error, 's1 → mX (09–12) assigned');
  const overlap = await db.rpc('assign_shift', { p_org: A, p_shift_id: mY, p_staff_id: s1 }); // 11–13 overlaps mX
  ok(!!overlap.error && /staff_double_booked|23P01/.test(errcode(overlap)), 'OVERLAP s1 → mY (11–13) REJECTED by EXCLUDE');
  // atomicity: the rejected overlap left ZERO partial rows
  const partial = (await db.from('shift_assignments').select('id', { count: 'exact', head: true }).eq('shift_id', mY).eq('staff_id', s1)).count;
  ok(partial === 0, 'atomicity: rejected overlap persisted 0 assignment rows (no partial write)');
  ok(!(await db.rpc('assign_shift', { p_org: A, p_shift_id: mZ, p_staff_id: s1 })).error, 'ADJACENT s1 → mZ (12–14, starts as mX ends) ALLOWED (half-open)');
  ok(!(await db.rpc('assign_shift', { p_org: A, p_shift_id: mW, p_staff_id: s1 })).error, 's1 → mW (16–18, isolated) allowed');
  ok(!(await db.rpc('assign_shift', { p_org: A, p_shift_id: mY, p_staff_id: s2 })).error, 'DIFFERENT staff s2 → mY allowed (guard is per-staff)');

  // cancelled frees the slot
  const s2mY = (await db.from('shift_assignments').select('id').eq('shift_id', mY).eq('staff_id', s2).single()).data.id;
  const s2mXblock = await db.rpc('assign_shift', { p_org: A, p_shift_id: mX, p_staff_id: s2 }); // mX 09–12 overlaps s2's mY 11–13
  ok(!!s2mXblock.error && /staff_double_booked|23P01/.test(errcode(s2mXblock)), 's2 → mX REJECTED (overlaps s2 mY)');
  await db.rpc('set_shift_assignment_status', { p_org: A, p_assignment_id: s2mY, p_status: 'cancelled' });
  ok(!(await db.rpc('assign_shift', { p_org: A, p_shift_id: mX, p_staff_id: s2 })).error, 'after CANCEL of mY, s2 → mX now ALLOWED (cancelled frees the slot)');

  // no_show frees the slot
  await db.rpc('assign_shift', { p_org: A, p_shift_id: mX, p_staff_id: s3 });
  const s3mX = (await db.from('shift_assignments').select('id').eq('shift_id', mX).eq('staff_id', s3).single()).data.id;
  const s3mYblock = await db.rpc('assign_shift', { p_org: A, p_shift_id: mY, p_staff_id: s3 }); // overlaps s3 mX
  ok(!!s3mYblock.error && /staff_double_booked|23P01/.test(errcode(s3mYblock)), 's3 → mY REJECTED (overlaps s3 mX)');
  await db.rpc('set_shift_assignment_status', { p_org: A, p_assignment_id: s3mX, p_status: 'no_show' });
  ok(!(await db.rpc('assign_shift', { p_org: A, p_shift_id: mY, p_staff_id: s3 })).error, 'after NO_SHOW of mX, s3 → mY now ALLOWED (no_show frees the slot)');

  // ── 4. draft vs published ──
  console.log('\n4. Draft vs published visibility');
  const opBoardDraft = (await op.rpc('roster_board', { p_org: A, p_from: D, p_to: D })).data;
  ok(opBoardDraft.can_manage === false, 'operative roster_board: can_manage = false');
  ok((opBoardDraft.shifts ?? []).every((s) => s.roster_status === 'published'), 'operative sees NO draft-roster shifts (unpublished not surfaced)');
  const opSeesR2Draft = (opBoardDraft.shifts ?? []).some((s) => s.shift_id === mX);
  ok(opSeesR2Draft === false, 'specifically: draft R2 shift mX hidden from operative');
  const mgrBoardDraft = (await mgr.rpc('roster_board', { p_org: A, p_from: D, p_to: D })).data;
  ok(mgrBoardDraft.can_manage === true && (mgrBoardDraft.shifts ?? []).some((s) => s.shift_id === mX), 'manager sees draft shifts (can_manage = true)');
  await db.rpc('publish_roster', { p_org: A, p_roster_id: R2 });
  const pubAgain = await db.rpc('publish_roster', { p_org: A, p_roster_id: R2 });
  ok(pubAgain.data.idempotent === true, 're-publish → idempotent no-op');
  const opBoardPub = (await op.rpc('roster_board', { p_org: A, p_from: D, p_to: D })).data;
  ok((opBoardPub.shifts ?? []).some((s) => s.shift_id === mX), 'after publish, operative now sees R2 shifts');

  // ── 5. reuses the SAME W0 staff row (no parallel person record) ──
  console.log('\n5. Reuses the shared W0 staff entity');
  const mXrow = (opBoardPub.shifts ?? []).find((s) => s.shift_id === mX);
  const s2staff = (await db.from('staff').select('name').eq('id', s2).single()).data;
  ok(mXrow.assignments.some((a) => a.staff_id === s2 && a.staff_name === s2staff.name), 'assignment references the W0 staff row (id + name match; no duplicate person record)');

  // ── 6. capability gate (manager can, operative cannot) ──
  console.log('\n6. Capability gate (roster.manage)');
  const opRoster = await op.rpc('create_roster', { p_org: A, p_name: 'nope', p_period_start: D, p_period_end: D });
  ok(!!opRoster.error && /forbidden|42501/.test(errcode(opRoster)), 'operative create_roster → forbidden (no roster.manage)');
  const opAssign = await op.rpc('assign_shift', { p_org: A, p_shift_id: mW, p_staff_id: s4 });
  ok(!!opAssign.error && /forbidden|42501/.test(errcode(opAssign)), 'operative assign_shift → forbidden');
  const mgrR = await mgr.rpc('create_roster', { p_org: A, p_name: `MgrW-${rid()}`, p_period_start: plusDays(20), p_period_end: plusDays(20) });
  ok(!mgrR.error, 'manager create_roster → allowed');
  const mgrShift = await mgr.rpc('upsert_shift', { p_org: A, p_roster_id: mgrR.data.roster_id, p_shift_date: plusDays(20), p_start_time: '09:00', p_end_time: '10:00', p_role: 'x' });
  const mgrAssign = await mgr.rpc('assign_shift', { p_org: A, p_shift_id: mgrShift.data.shift_id, p_staff_id: s4 });
  ok(!mgrShift.error && !mgrAssign.error, 'manager upsert_shift + assign_shift → allowed');
  ok(!(await mgr.rpc('publish_roster', { p_org: A, p_roster_id: mgrR.data.roster_id })).error, 'manager publish_roster → allowed');

  // ── 7. org isolation (both directions) ──
  console.log('\n7. Tenant isolation (both directions)');
  // seed a published roster+shift in B (service role)
  const RB = (await db.rpc('create_roster', { p_org: B, p_name: 'B-week', p_period_start: D, p_period_end: D })).data.roster_id;
  const shB = (await db.rpc('upsert_shift', { p_org: B, p_roster_id: RB, p_shift_date: D, p_start_time: '09:00', p_end_time: '12:00' })).data.shift_id;
  await db.rpc('publish_roster', { p_org: B, p_roster_id: RB });
  const sB = await mkStaff(B, 'Bharath');
  for (const t of ['shift_templates', 'staff_rosters', 'shifts', 'shift_assignments']) {
    const r = await op.from(t).select('id').eq('org_id', B);
    ok(!r.error && r.data.length === 0, `A-member cannot read B.${t}`);
  }
  const aIntoB = await mgr.rpc('assign_shift', { p_org: B, p_shift_id: shB, p_staff_id: sB });
  ok(!!aIntoB.error && /forbidden|42501/.test(errcode(aIntoB)), 'A-manager assign_shift into B → forbidden');
  const bIntoA = await bMgr.rpc('assign_shift', { p_org: A, p_shift_id: mW, p_staff_id: s1 });
  ok(!!bIntoA.error && /forbidden|42501/.test(errcode(bIntoA)), 'B-manager assign_shift into A → forbidden');
  const bReadA = await bMgr.from('shifts').select('id').eq('org_id', A);
  ok(!bReadA.error && bReadA.data.length === 0, 'B-manager cannot read A.shifts');

  // ── 8/9. audited ──
  console.log('\n8. Audit trail');
  const aTpl = await auditCount(A, 'workforce.shift_template_upsert');
  const aGen = await auditCount(A, 'workforce.shifts_generate');
  const aPub = await auditCount(A, 'workforce.roster_publish');
  const aAsg = await auditCount(A, 'workforce.shift_assign');
  const aSt = await auditCount(A, 'workforce.shift_status');
  ok(aTpl >= 1 && aGen >= 1 && aPub >= 1 && aAsg >= 5 && aSt >= 3, `audited: template ${aTpl}, generate ${aGen}, publish ${aPub}, assign ${aAsg}, status ${aSt}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('staff_rosters').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('shifts').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('shift_assignments').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
