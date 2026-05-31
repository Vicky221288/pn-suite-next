#!/usr/bin/env node
/**
 * W2 harness — Hall completion (6 pieces). Proves: (1) contract generates from a
 * confirmed booking + e-sign immutable-once-signed + new version supersedes;
 * (2) payment milestones compute against the locked schedule (balance due T-45)
 * + paid/overdue transitions; (3) staff roster assignment + status; (4) checklist
 * completion with photo-proof enforced; (5) vendor linked to a hall event w/
 * commission; (6) revenue analytics reads finance_ledger hall stream + is
 * margin-gated; org isolation; atomic + audited. Self-cleaning, re-runnable,
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
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const errcode = (r) => r.error?.code ?? r.error?.message ?? '';
const rid = () => randomUUID().slice(0, 8);
const minusDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const plusDaysFromToday = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (W2 applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-w2-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}
async function booking(org, rent, eventDate, status = 'confirmed') {
  const hall = (await db.from('halls').insert({ org_id: org, name: `Hall-${rid()}` }).select('id').single()).data.id;
  const bk = (await db.from('bookings').insert({ org_id: org, hall_id: hall, event_date: eventDate, slot: 'evening', status, hall_rent: rent, customer_name: 'Test', idempotency_key: rid(), confirmed_at: status === 'confirmed' ? new Date().toISOString() : null }).select('id').single()).data.id;
  const ev = (await db.from('events').insert({ org_id: org, booking_id: bk, event_date: eventDate, slot: 'evening', status: 'planning' }).select('id').single()).data.id;
  return { hall, bk, ev };
}
const mkStaff = async (org, name) => (await db.from('staff').insert({ org_id: org, name, role: 'operative', active: true }).select('id').single()).data.id;
const contractRow = async (id) => (await db.from('hall_contracts').select('status,version,signed_by_name').eq('id', id).single()).data;

async function main() {
  const A = await mkOrg('W2 Org A'), B = await mkOrg('W2 Org B');
  const userOwner = await mkMember(A, ['pnl.view_margin']);
  const userOp = await mkMember(A, []);
  const EVDATE = '2099-12-12';
  const { bk, ev } = await booking(A, 100000, EVDATE, 'confirmed');

  // ── 1. contract from confirmed booking + e-sign immutable + versioning ──
  console.log('\n1. Contract: generate from confirmed booking + e-sign immutable + supersede');
  const c1 = await db.rpc('generate_contract', { p_org: A, p_booking_id: bk, p_terms: 'Standard hall terms' });
  ok(!c1.error && c1.data.version === 1 && c1.data.status === 'draft', 'contract generated v1 (draft) from confirmed booking');
  const c1again = await db.rpc('generate_contract', { p_org: A, p_booking_id: bk });
  ok(c1again.data.idempotent === true && c1again.data.contract_id === c1.data.contract_id, 're-generate (unsigned) → idempotent, no pile-up');
  await db.rpc('send_contract', { p_org: A, p_contract_id: c1.data.contract_id });
  await db.rpc('sign_contract', { p_org: A, p_contract_id: c1.data.contract_id, p_signed_by_name: 'Vicky' });
  const c1r = await contractRow(c1.data.contract_id);
  ok(c1r.status === 'signed' && c1r.signed_by_name === 'Vicky', 'send → sign → signed + signature recorded');
  const edit = await db.rpc('update_contract_terms', { p_org: A, p_contract_id: c1.data.contract_id, p_terms: 'changed' });
  ok(!!edit.error && /contract_immutable|22023/.test(errcode(edit)), 'signed contract rejects edits (immutable)');
  const c2 = await db.rpc('generate_contract', { p_org: A, p_booking_id: bk });
  ok(c2.data.version === 2 && (await contractRow(c1.data.contract_id)).status === 'superseded', 'change → new version v2; old contract superseded');
  const tent = await booking(A, 50000, '2099-11-01', 'tentative_hold');
  const cNo = await db.rpc('generate_contract', { p_org: A, p_booking_id: tent.bk });
  ok(!!cNo.error && /not_confirmed|22023/.test(errcode(cNo)), 'cannot generate a contract from a non-confirmed booking');

  // ── 2. payment milestones — locked schedule (balance due T-45) + transitions ──
  console.log('\n2. Payment milestones: locked schedule (balance due T-45) + paid/overdue');
  const sched = await db.rpc('set_payment_schedule', { p_org: A, p_booking_id: bk, p_advance_amount: 50000 });
  ok(!sched.error && near(sched.data.advance, 50000) && near(sched.data.balance, 50000), 'advance 50000 + balance 50000 (= hall_rent 100000)');
  ok(sched.data.balance_due === minusDays(EVDATE, 45), `balance due_date = event_date − 45 = ${minusDays(EVDATE, 45)} (got ${sched.data.balance_due})`);
  const ms = (await db.from('payment_milestones').select('id, kind, status, due_date').eq('booking_id', bk)).data;
  ok(ms.length === 2, '2 milestones (advance + balance)');
  const adv = ms.find((m) => m.kind === 'advance');
  await db.rpc('mark_milestone_paid', { p_org: A, p_milestone_id: adv.id, p_amount: 50000 });
  ok((await db.from('payment_milestones').select('status').eq('id', adv.id).single()).data.status === 'paid', 'advance milestone → paid');
  // overdue: a booking whose balance due (event−45) is in the past
  const od = await booking(A, 80000, plusDaysFromToday(10), 'confirmed');  // balance due = today−35
  await db.rpc('set_payment_schedule', { p_org: A, p_booking_id: od.bk, p_advance_amount: 0 });
  const nOver = await db.rpc('refresh_milestone_overdue', { p_org: A });
  const odBal = (await db.from('payment_milestones').select('status').eq('booking_id', od.bk).eq('kind', 'balance').single()).data;
  ok(!nOver.error && nOver.data >= 1 && odBal.status === 'overdue', 'past-due balance flagged overdue');

  // ── 3. resource scheduling / staff roster ──
  console.log('\n3. Resource scheduling: staff roster');
  const s1 = await mkStaff(A, 'Captain'), s2 = await mkStaff(A, 'Server');
  const es1 = await db.rpc('assign_event_staff', { p_org: A, p_event_id: ev, p_staff_id: s1, p_role: 'captain' });
  await db.rpc('assign_event_staff', { p_org: A, p_event_id: ev, p_staff_id: s2, p_role: 'server' });
  await db.rpc('set_event_staff_status', { p_org: A, p_event_staff_id: es1.data.event_staff_id, p_status: 'checked_in' });
  const roster = (await db.from('event_staff').select('status').eq('event_id', ev)).data;
  ok(roster.length === 2 && roster.some((r) => r.status === 'checked_in'), '2 staff rostered; status transition (checked_in) recorded');

  // ── 4. execution checklists + photo-proof ──
  console.log('\n4. Execution checklists + photo-proof');
  const ck = await db.rpc('create_event_checklist', { p_org: A, p_event_id: ev, p_title: 'Setup', p_assigned_staff_id: s1, p_items: [{ label: 'Stage decor', requires_photo: true }, { label: 'Mic check', requires_photo: false }] });
  ok(!ck.error && ck.data.items === 2, 'checklist created with 2 items');
  const items = (await db.from('event_checklist_items').select('id, label, requires_photo').eq('checklist_id', ck.data.checklist_id)).data;
  const stage = items.find((i) => i.requires_photo), mic = items.find((i) => !i.requires_photo);
  ok(!(await db.rpc('complete_checklist_item', { p_org: A, p_item_id: mic.id })).error, 'non-photo item completes without a photo');
  const noPhoto = await db.rpc('complete_checklist_item', { p_org: A, p_item_id: stage.id });
  ok(!!noPhoto.error && /photo_required|22023/.test(errcode(noPhoto)), 'photo-required item REJECTS completion without photo-proof');
  const withPhoto = await db.rpc('complete_checklist_item', { p_org: A, p_item_id: stage.id, p_photo_ref: 'events/stage-123.jpg' });
  const stageRow = (await db.from('event_checklist_items').select('done, photo_ref').eq('id', stage.id).single()).data;
  ok(!withPhoto.error && stageRow.done === true && stageRow.photo_ref === 'events/stage-123.jpg', 'completes with photo-proof; photo_ref tracked');

  // ── 5. vendor coordination ──
  console.log('\n5. Vendor coordination');
  const v1 = (await db.rpc('upsert_vendor', { p_org: A, p_name: 'Bloom Decor' })).data.vendor_id;
  const evV = await db.rpc('assign_event_vendor', { p_org: A, p_event_id: ev, p_vendor_id: v1, p_service_type: 'decor', p_amount: 30000, p_commission: 3000 });
  await db.rpc('set_event_vendor_status', { p_org: A, p_event_vendor_id: evV.data.event_vendor_id, p_status: 'confirmed' });
  const ev_v = (await db.from('event_vendors').select('service_type, amount, commission_amount, status').eq('id', evV.data.event_vendor_id).single()).data;
  ok(ev_v.service_type === 'decor' && near(ev_v.commission_amount, 3000) && ev_v.status === 'confirmed', 'vendor linked to event: decor, commission 3000, confirmed');

  // ── 6. revenue analytics — finance_ledger hall stream + margin gate ──
  console.log('\n6. Revenue analytics (finance_ledger hall stream; margin-gated)');
  await db.rpc('write_ledger', { p_org: A, p_supply_type: 'hall', p_amount: 100000, p_direction: 'credit', p_source_domain: 'hall', p_linked_type: 'invoice', p_linked_id: bk });
  const anOwner = (await userOwner.rpc('hall_analytics', { p_org: A })).data;
  ok(anOwner.can_see_revenue === true && near(anOwner.realized_hall_revenue, 100000), 'Owner sees realized hall revenue from the ledger (100000)');
  ok(Object.keys(anOwner.bookings_by_status).length > 0 && Object.keys(anOwner.occupancy_by_slot).length > 0, 'analytics returns bookings-by-status + occupancy-by-slot');
  const anOp = (await userOp.rpc('hall_analytics', { p_org: A })).data;
  ok(anOp.can_see_revenue === false && anOp.realized_hall_revenue === null && anOp.pipeline_value === null, 'operative: revenue + pipeline nulled (margin gate); counts still visible');
  ok(Object.keys(anOp.bookings_by_status).length > 0, 'operative still sees booking counts');

  // ── 7. org isolation + audit ──
  console.log('\n7. Tenant isolation + audit');
  const cross = await userOp.rpc('generate_contract', { p_org: B, p_booking_id: randomUUID() });
  ok(!!cross.error && /42501|forbidden/.test(errcode(cross)), 'A-member generate_contract in B → forbidden');
  for (const t of ['hall_contracts', 'payment_milestones', 'event_staff', 'event_vendors']) {
    const r = await userOp.from(t).select('id').eq('org_id', B);
    ok(!r.error && r.data.length === 0, `A-member cannot read B.${t}`);
  }
  const aSign = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'hall.contract_sign')).count;
  const aCk = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'hall.checklist_complete')).count;
  const aSched = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'hall.payment_schedule')).count;
  ok(aSign >= 1 && aCk >= 2 && aSched >= 2, `audited: contract_sign ${aSign}, checklist_complete ${aCk}, payment_schedule ${aSched}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('hall_contracts').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('event_checklists').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
