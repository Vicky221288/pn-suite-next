#!/usr/bin/env node
/**
 * M2 harness — OPS EXECUTION: tasks · incidents · checklist-TEMPLATE engine.
 * Proves: task create→assign→guarded lifecycle (illegal txn rejected) + priority/
 * due + POLYMORPHIC entity link resolves; incident report→resolve guarded +
 * severity, DISTINCT from tasks (separate tables); checklist template GENERATES
 * an execution checklist INTO THE EXISTING W2 tables (event_checklists/_items,
 * with template_id provenance) — NOT a new table; requires_photo carries through
 * and completion still runs the UNCHANGED W2 path with the KL-3 photo-proof gate
 * (no-ref completion rejected); NO parallel execution table exists; capability
 * gates; org isolation both directions; atomicity on a forced mid-tx failure
 * (zero partial rows); audited. Self-cleaning, re-runnable, exit-coded.
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
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (M2 applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-m2-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return { cl, id: c.data.user.id };
}
const mkStaff = async (org, name) => (await db.from('staff').insert({ org_id: org, name, role: 'operative', active: true }).select('id').single()).data.id;
async function mkEvent(org) {
  const e = await db.from('events').insert({ org_id: org, event_date: '2099-12-01', status: 'planning', event_type: 'wedding' }).select('id').single();
  if (e.error) { console.error('SETUP (events insert):', e.error.message); process.exit(2); }
  return e.data.id;
}
const auditCount = async (org, action) => (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('action', action)).count;
const taskStatus = async (id) => (await db.from('tasks').select('status').eq('id', id).single()).data?.status;

async function main() {
  const A = await mkOrg('M2 Org A'), B = await mkOrg('M2 Org B');
  const mgr = await mkMember(A, ['ops.manage']);
  const op = await mkMember(A, []);
  const bMgr = await mkMember(B, ['ops.manage']);
  const s1 = await mkStaff(A, 'Anbu'); await mkStaff(B, 'Bharath');
  const evA = await mkEvent(A);

  // ── A. tasks: create + polymorphic link + assign + guarded lifecycle ──
  console.log('\nA. Tasks (create → assign → guarded lifecycle; polymorphic link)');
  const t1 = await mgr.cl.rpc('create_task', { p_org: A, p_title: 'Stage setup', p_priority: 'high', p_due_date: '2099-06-01', p_assigned_staff_id: s1, p_entity_type: 'event', p_entity_id: evA });
  ok(!t1.error && t1.data.task_id, 'task created (priority high, due, assigned, linked to event)');
  const t1row = (await db.from('tasks').select('priority, due_date, status, assigned_staff_id, entity_type, entity_id').eq('id', t1.data.task_id).single()).data;
  ok(t1row.priority === 'high' && t1row.due_date === '2099-06-01' && t1row.assigned_staff_id === s1 && t1row.status === 'open', 'priority/due/assignee/status stored');
  const linked = await db.from('events').select('id').eq('id', t1row.entity_id).maybeSingle();
  ok(t1row.entity_type === 'event' && linked.data?.id === evA, 'POLYMORPHIC entity link resolves to the event');
  // guarded lifecycle
  const t2 = await mgr.cl.rpc('create_task', { p_org: A, p_title: 'Quick task' });
  const illegal = await mgr.cl.rpc('set_task_status', { p_org: A, p_task_id: t2.data.task_id, p_status: 'done' }); // open→done skips in_progress
  ok(!!illegal.error && /illegal_transition/.test(emsg(illegal)), 'illegal task transition (open → done) REJECTED');
  await mgr.cl.rpc('set_task_status', { p_org: A, p_task_id: t1.data.task_id, p_status: 'in_progress' });
  ok(!(await mgr.cl.rpc('set_task_status', { p_org: A, p_task_id: t1.data.task_id, p_status: 'done' })).error && await taskStatus(t1.data.task_id) === 'done', 'open → in_progress → done');
  ok(!(await mgr.cl.rpc('assign_task', { p_org: A, p_task_id: t2.data.task_id, p_staff_id: s1 })).error, 'assign_task to W0 staff');
  const badEntity = await mgr.cl.rpc('create_task', { p_org: A, p_title: 'x', p_entity_type: 'event', p_entity_id: randomUUID() });
  ok(!!badEntity.error && /entity_not_found|P0002/.test(emsg(badEntity)), 'dangling polymorphic link rejected (entity_not_found)');
  const badType = await mgr.cl.rpc('create_task', { p_org: A, p_title: 'x', p_entity_type: 'bogus', p_entity_id: evA });
  ok(!!badType.error && /bad_entity_type/.test(emsg(badType)), 'unknown entity_type rejected');

  // ── B. incidents: report (open) → guarded resolve; severity; distinct ──
  console.log('\nB. Incidents (report → guarded resolve; severity; distinct domain)');
  const i1 = await op.cl.rpc('report_incident', { p_org: A, p_title: 'AC failure in hall', p_severity: 'high', p_entity_type: 'event', p_entity_id: evA });
  ok(!i1.error && i1.data.incident_id, 'operative CAN report an incident (open to members)');
  const i1row = (await db.from('incidents').select('severity, status').eq('id', i1.data.incident_id).single()).data;
  ok(i1row.severity === 'high' && i1row.status === 'reported', 'severity + status stored');
  const incIllegal = await mgr.cl.rpc('set_incident_status', { p_org: A, p_incident_id: i1.data.incident_id, p_status: 'resolved' }); // skips in_progress
  ok(!!incIllegal.error && /illegal_transition/.test(emsg(incIllegal)), 'illegal incident transition (reported → resolved) REJECTED');
  await mgr.cl.rpc('set_incident_status', { p_org: A, p_incident_id: i1.data.incident_id, p_status: 'in_progress', p_assigned_staff_id: s1 });
  const resolved = await mgr.cl.rpc('set_incident_status', { p_org: A, p_incident_id: i1.data.incident_id, p_status: 'resolved', p_resolution: 'Compressor reset' });
  const i1final = (await db.from('incidents').select('status, resolution, resolved_at, assigned_staff_id').eq('id', i1.data.incident_id).single()).data;
  ok(!resolved.error && i1final.status === 'resolved' && i1final.resolution === 'Compressor reset' && !!i1final.resolved_at, 'reported → in_progress → resolved (+ resolution + resolved_at)');
  ok((await db.from('tasks').select('id').eq('id', i1.data.incident_id)).data.length === 0, 'incident id is NOT a task — tasks and incidents are distinct tables');

  // ── C. checklist-template engine → generates INTO the EXISTING W2 tables ──
  console.log('\nC. Checklist-template engine (reuse seam: W2 execution tables + KL-3 gate)');
  const tpl = await mgr.cl.rpc('upsert_checklist_template', { p_org: A, p_name: `Setup-${rid()}`, p_kind: 'event', p_items: [{ label: 'Stage decor', requires_photo: true }, { label: 'Mic check', requires_photo: false }] });
  ok(!tpl.error && tpl.data.items === 2, 'template created with 2 items');
  const gen = await mgr.cl.rpc('generate_checklist_from_template', { p_org: A, p_template_id: tpl.data.template_id, p_event_id: evA });
  ok(!gen.error && gen.data.items === 2, 'generated an execution checklist (2 items)');
  // landed in the EXISTING W2 tables, with provenance
  const cl = (await db.from('event_checklists').select('id, event_id, template_id').eq('id', gen.data.checklist_id).single()).data;
  ok(cl.event_id === evA && cl.template_id === tpl.data.template_id, 'checklist landed in event_checklists (W2 table) w/ template_id provenance');
  const items = (await db.from('event_checklist_items').select('id, requires_photo').eq('checklist_id', gen.data.checklist_id)).data;
  ok(items.length === 2 && items.filter((x) => x.requires_photo).length === 1, 'items landed in event_checklist_items (W2 table); requires_photo carried through');
  // NO parallel execution table forked
  const fork1 = await db.from('checklist_instances').select('id').limit(1);
  const fork2 = await db.from('m2_checklist_executions').select('id').limit(1);
  ok(!!fork1.error && !!fork2.error, 'NO parallel execution table created (checklist_instances / m2_checklist_executions absent)');
  // photo-proof gate intact via the UNCHANGED W2 complete_checklist_item
  const photoItem = items.find((x) => x.requires_photo), plainItem = items.find((x) => !x.requires_photo);
  const noRef = await mgr.cl.rpc('complete_checklist_item', { p_org: A, p_item_id: photoItem.id });
  ok(!!noRef.error && /photo_required/.test(emsg(noRef)), 'KL-3 photo-proof intact: photo-required item REJECTS completion without a ref');
  const withRef = await mgr.cl.rpc('complete_checklist_item', { p_org: A, p_item_id: photoItem.id, p_photo_ref: `${A}/event_checklist/x.jpg` });
  ok(!withRef.error && (await db.from('event_checklist_items').select('done').eq('id', photoItem.id).single()).data.done === true, 'completes with a photo ref (W2 path)');
  ok(!(await mgr.cl.rpc('complete_checklist_item', { p_org: A, p_item_id: plainItem.id })).error, 'non-photo item completes without a ref (W2 path)');

  // ── D. capability gates (ops.manage) ──
  console.log('\nD. Capability gate (ops.manage)');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('create_task', { p_org: A, p_title: 'no' }))), 'operative create_task → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('set_task_status', { p_org: A, p_task_id: t2.data.task_id, p_status: 'in_progress' }))), 'operative set_task_status → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('set_incident_status', { p_org: A, p_incident_id: i1.data.incident_id, p_status: 'cancelled' }))), 'operative set_incident_status → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('upsert_checklist_template', { p_org: A, p_name: 'no', p_items: [] }))), 'operative upsert_checklist_template → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('generate_checklist_from_template', { p_org: A, p_template_id: tpl.data.template_id, p_event_id: evA }))), 'operative generate_checklist → forbidden');

  // ── E. atomicity: forced mid-tx failure on template update (delete+reinsert) ──
  console.log('\nE. Atomicity on forced mid-tx failure');
  const tx = await mgr.cl.rpc('upsert_checklist_template', { p_org: A, p_name: `Tx-${rid()}`, p_items: [{ label: 'A', requires_photo: false }, { label: 'B', requires_photo: false }] });
  const before = (await db.from('checklist_template_items').select('*', { count: 'exact', head: true }).eq('template_id', tx.data.template_id)).count;
  const bad = await mgr.cl.rpc('upsert_checklist_template', { p_org: A, p_name: `Tx-${rid()}`, p_items: [{ requires_photo: true }], p_template_id: tx.data.template_id }); // label omitted → NULL
  ok(!!bad.error, 'template update with a null-label item fails (NOT NULL fires after the delete, mid-tx)');
  const after = (await db.from('checklist_template_items').select('*', { count: 'exact', head: true }).eq('template_id', tx.data.template_id)).count;
  ok(before === 2 && after === 2, `atomicity: delete+reinsert rolled back together (items ${before} → ${after}, zero partial change)`);

  // ── F. org isolation (both directions) ──
  console.log('\nF. Tenant isolation (both directions)');
  await db.rpc('create_task', { p_org: B, p_title: 'B task' });
  await db.rpc('report_incident', { p_org: B, p_title: 'B incident' });
  await db.rpc('upsert_checklist_template', { p_org: B, p_name: 'B tpl', p_items: [{ label: 'x', requires_photo: false }] });
  for (const t of ['tasks', 'incidents', 'checklist_templates', 'checklist_template_items']) {
    const r = await op.cl.from(t).select('*').eq('org_id', B);
    ok(!r.error && r.data.length === 0, `A-member cannot read B.${t}`);
  }
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('create_task', { p_org: B, p_title: 'cross' }))), 'A-manager create_task in B → forbidden');
  const bReadA = await bMgr.cl.from('tasks').select('*').eq('org_id', A);
  ok(!bReadA.error && bReadA.data.length === 0, 'B-manager cannot read A.tasks');

  // ── G. audit ──
  console.log('\nG. Audit trail');
  const aTc = await auditCount(A, 'ops.task_create'), aTs = await auditCount(A, 'ops.task_status');
  const aIr = await auditCount(A, 'ops.incident_report'), aIs = await auditCount(A, 'ops.incident_status');
  const aTpl = await auditCount(A, 'ops.checklist_template_upsert'), aGen = await auditCount(A, 'ops.checklist_generate');
  ok(aTc >= 2 && aTs >= 2 && aIr >= 1 && aIs >= 2 && aTpl >= 2 && aGen >= 1,
    `audited: task_create ${aTc}, task_status ${aTs}, incident_report ${aIr}, incident_status ${aIs}, template ${aTpl}, generate ${aGen}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('tasks').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('incidents').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('checklist_templates').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('event_checklists').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
