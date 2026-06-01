#!/usr/bin/env node
/**
 * M3 harness — GUEST CRM ENRICHMENT. Proves: interactions attach to the SAME W0
 * guest (no duplicate guest), timeline reads ordered; LTV computed LIVE from
 * finance_ledger (settle activity → LTV reflects it) with NO stored ltv column,
 * capability-gated (pnl.view_margin); special dates store/read; template create +
 * placeholder render; SENDING via the B3 enqueue_outbound ONLY — manual send
 * lands in outbound_messages, idempotent (same key → one row), quiet-hours
 * deferral honored, NO parallel send path; review_requests recorded + idempotent
 * per (guest,event); capability gates; org isolation both directions; atomicity
 * (no-sender → review record rolls back, zero partial rows); audited.
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
const emsg = (r) => `${r.error?.code ?? ''} ${r.error?.message ?? ''} ${r.error?.details ?? ''} ${r.error?.hint ?? ''}`;
const rid = () => randomUUID().slice(0, 8);
const DAY = '2099-06-15T06:00:00Z';   // 11:30 IST — daytime (not quiet hours)
const NIGHT = '2099-06-15T18:00:00Z'; // 23:30 IST — quiet hours
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (M3 applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-m3-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return { cl, id: c.data.user.id };
}
const mkGuest = async (org, name, phone) => (await db.from('guests').insert({ org_id: org, name, phone }).select('id').single()).data.id;
const mkSender = async (org, area) => db.from('message_senders').insert({ org_id: org, function_area: area, display_name: `S-${rid()}`, phone_number: `+9199${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, provider: 'mock', active: true });
const mkEvent = async (org, guest) => { const e = await db.from('events').insert({ org_id: org, event_date: '2099-12-01', status: 'planning', event_type: 'wedding', guest_id: guest }).select('id').single(); if (e.error) { console.error('SETUP events:', e.error.message); process.exit(2); } return e.data.id; };
async function mkInvoiceForEvent(org, eventId, seq) {
  const i = await db.from('invoices').insert({ org_id: org, booking_id: null, invoice_seq: seq, invoice_number: `INV-${rid()}`, supply_type: 'consolidated', sac_code: '9963', gst_rate: 5, subtotal: 100000, cgst: 2500, sgst: 2500, total: 105000, status: 'paid', event_id: eventId }).select('id').single();
  if (i.error) { console.error('SETUP invoice:', i.error.message); process.exit(2); } return i.data.id;
}
async function mkStayInvoice(org, guest, seq) {
  const rt = (await db.from('room_types').insert({ org_id: org, name: `RT-${rid()}`, base_rate: 5000 }).select('id').single()).data.id;
  const stay = (await db.from('room_stays').insert({ org_id: org, guest_id: guest, room_type_id: rt, check_in: '2099-11-01', check_out: '2099-11-03', status: 'checked_out', rate_quoted: 5000 }).select('id').single()).data.id;
  const i = await db.from('invoices').insert({ org_id: org, booking_id: null, invoice_seq: seq, invoice_number: `INV-${rid()}`, supply_type: 'folio', sac_code: '9963', gst_rate: 5, subtotal: 50000, cgst: 1250, sgst: 1250, total: 52500, status: 'paid', stay_id: stay }).select('id').single();
  if (i.error) { console.error('SETUP stay invoice:', i.error.message); process.exit(2); } return i.data.id;
}
const auditCount = async (org, action) => (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('action', action)).count;
const ltvOf = async (cl, org, guest) => (await cl.rpc('guest_ltv', { p_org: org, p_guest: guest })).data;

async function main() {
  const A = await mkOrg('M3 Org A'), B = await mkOrg('M3 Org B');
  const mgr = await mkMember(A, ['crm.manage', 'pnl.view_margin']);
  const op = await mkMember(A, []);
  const bMgr = await mkMember(B, ['crm.manage', 'pnl.view_margin']);
  await mkSender(A, 'hall_catering'); await mkSender(B, 'hall_catering');
  const G = await mkGuest(A, 'Anbu', '900000001');
  const guestCountBefore = (await db.from('guests').select('*', { count: 'exact', head: true }).eq('org_id', A)).count;

  const tpl = (await mgr.cl.rpc('upsert_message_template', { p_org: A, p_name: `Thanks-${rid()}`, p_function_area: 'hall_catering', p_body: 'Hi {{guest}}, thanks for visiting {{place}}.' })).data;
  const ghostTpl = (await mgr.cl.rpc('upsert_message_template', { p_org: A, p_name: `Ghost-${rid()}`, p_function_area: 'ghost_area', p_body: 'Hi {{guest}}' })).data;

  // ── A. interactions on the SAME W0 guest ──
  console.log('\nA. Interactions timeline (shared W0 guest)');
  ok(!(await mgr.cl.rpc('log_interaction', { p_org: A, p_guest: G, p_type: 'call', p_note: 'first call' })).error, 'logged interaction 1');
  await mgr.cl.rpc('log_interaction', { p_org: A, p_guest: G, p_type: 'visit', p_note: 'walk-in' });
  const tl = (await db.from('guest_interactions').select('guest_id, interaction_type, occurred_at').eq('guest_id', G).order('occurred_at', { ascending: false })).data;
  ok(tl.length === 2 && tl.every((x) => x.guest_id === G), 'timeline reads 2 interactions, all on guest G');
  ok((await db.from('guests').select('*', { count: 'exact', head: true }).eq('org_id', A)).count === guestCountBefore, 'no duplicate guest record created (guest count unchanged)');

  // ── B. LTV computed LIVE from finance_ledger; no stored column; gated ──
  console.log('\nB. LTV computed live (no stored column; capability-gated)');
  const ltv0 = await ltvOf(mgr.cl, A, G);
  ok(ltv0.can_see === true && Number(ltv0.ltv) === 0, 'initial LTV = 0 (manager can see)');
  const ev = await mkEvent(A, G); const inv = await mkInvoiceForEvent(A, ev, 1);
  await db.rpc('write_ledger', { p_org: A, p_supply_type: 'hall', p_amount: 100000, p_direction: 'credit', p_source_domain: 'hall', p_linked_type: 'invoice', p_linked_id: inv, p_description: 'rev hall' });
  const ltv1 = await ltvOf(mgr.cl, A, G);
  ok(Number(ltv1.ltv) === 100000, `LTV reflects settled hall revenue live (100000, got ${ltv1.ltv})`);
  const inv2 = await mkStayInvoice(A, G, 2);
  await db.rpc('write_ledger', { p_org: A, p_supply_type: 'rooms_fnb', p_amount: 50000, p_direction: 'credit', p_source_domain: 'stays', p_linked_type: 'invoice', p_linked_id: inv2, p_description: 'rev stays' });
  const ltv2 = await ltvOf(mgr.cl, A, G);
  ok(Number(ltv2.ltv) === 150000, `LTV adds stays revenue live (150000, got ${ltv2.ltv})`);
  const gRow = (await db.from('guests').select('*').eq('id', G).single()).data;
  ok(!Object.keys(gRow).some((k) => /ltv/i.test(k)), `NO stored ltv column on guests (keys: ${Object.keys(gRow).join(',')})`);
  const ltvOp = await ltvOf(op.cl, A, G);
  ok(ltvOp.can_see === false && ltvOp.ltv === null, 'operative: LTV gated (can_see false, ltv null)');

  // ── C. special dates ──
  console.log('\nC. Special dates');
  ok(!(await mgr.cl.rpc('set_special_date', { p_org: A, p_guest: G, p_date_type: 'anniversary', p_the_date: '2020-06-15', p_label: 'Wedding' })).error, 'special date set');
  await mgr.cl.rpc('set_special_date', { p_org: A, p_guest: G, p_date_type: 'anniversary', p_the_date: '2020-06-15', p_label: 'Wedding day' }); // upsert
  const sd = (await db.from('guest_special_dates').select('id, label').eq('guest_id', G)).data;
  ok(sd.length === 1 && sd[0].label === 'Wedding day', 'special date stored + upsert (1 row, label updated)');

  // ── D. template placeholder render ──
  console.log('\nD. Template placeholder render');
  const rendered = (await db.rpc('pn_render_template', { p_body: 'Hi {{guest}} at {{place}}', p_payload: { guest: 'Anbu', place: 'PN Hall' } })).data;
  ok(rendered === 'Hi Anbu at PN Hall', `placeholders render (got "${rendered}")`);

  // ── E. SENDING via B3 only (idempotent + quiet-hours), review records ──
  console.log('\nE. Sending via the B3 firewall (idempotent + quiet-hours) + review records');
  const s1 = await mgr.cl.rpc('send_template_to_guest', { p_org: A, p_guest: G, p_template_id: tpl.template_id, p_payload: { guest: 'Anbu', place: 'PN Hall' }, p_idempotency_key: 'k1', p_now: DAY });
  ok(!s1.error && s1.data.status === 'sent' && s1.data.rendered === 'Hi Anbu, thanks for visiting PN Hall.', 'manual send: status sent + rendered body');
  const ob = (await db.from('outbound_messages').select('id, status, recipient, function_area, idempotency_key').eq('org_id', A).eq('idempotency_key', 'k1')).data;
  ok(ob.length === 1 && ob[0].status === 'sent' && ob[0].recipient === '900000001' && ob[0].function_area === 'hall_catering', 'send landed in B3 outbound_messages (correct sender/recipient)');
  const s1b = await mgr.cl.rpc('send_template_to_guest', { p_org: A, p_guest: G, p_template_id: tpl.template_id, p_payload: { guest: 'Anbu', place: 'PN Hall' }, p_idempotency_key: 'k1', p_now: DAY });
  ok(s1b.data.idempotent === true && (await db.from('outbound_messages').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('idempotency_key', 'k1')).count === 1, 'idempotent: same key twice → ONE queued row');
  const s2 = await mgr.cl.rpc('send_template_to_guest', { p_org: A, p_guest: G, p_template_id: tpl.template_id, p_payload: {}, p_idempotency_key: 'k2', p_now: NIGHT });
  ok(s2.data.status === 'deferred' && !!s2.data.scheduled_for, 'quiet-hours: 23:30 IST send DEFERRED with scheduled_for');
  // no parallel send path
  const fork1 = await db.from('crm_messages').select('id').limit(1);
  const fork2 = await db.from('guest_outbound').select('id').limit(1);
  ok(!!fork1.error && !!fork2.error, 'NO parallel send table (crm_messages / guest_outbound absent) — B3 is the only path');
  // review request records + idempotent per (guest,event)
  const rr = await mgr.cl.rpc('create_review_request', { p_org: A, p_guest: G, p_template_id: tpl.template_id, p_event: ev, p_now: DAY });
  ok(!rr.error && rr.data.review_request_id, 'review request created + sent via B3');
  const rrRow = (await db.from('review_requests').select('status, outbound_message_id').eq('id', rr.data.review_request_id).single()).data;
  ok(rrRow.status === 'sent' && !!rrRow.outbound_message_id, 'review_requests record: status sent + linked outbound_message');
  const rr2 = await mgr.cl.rpc('create_review_request', { p_org: A, p_guest: G, p_template_id: tpl.template_id, p_event: ev, p_now: DAY });
  ok(rr2.data.idempotent === true && (await db.from('review_requests').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('guest_id', G).eq('event_id', ev)).count === 1, 'review request idempotent per (guest,event) → one record');

  // ── F. capability gate (crm.manage) ──
  console.log('\nF. Capability gate (crm.manage)');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('log_interaction', { p_org: A, p_guest: G, p_type: 'note' }))), 'operative log_interaction → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('set_special_date', { p_org: A, p_guest: G, p_date_type: 'birthday', p_the_date: '2000-01-01' }))), 'operative set_special_date → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('upsert_message_template', { p_org: A, p_name: 'no', p_function_area: 'x', p_body: 'y' }))), 'operative upsert_message_template → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('send_template_to_guest', { p_org: A, p_guest: G, p_template_id: tpl.template_id }))), 'operative send_template_to_guest → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('create_review_request', { p_org: A, p_guest: G, p_template_id: tpl.template_id }))), 'operative create_review_request → forbidden');

  // ── G. atomicity: no-sender → review record rolls back (zero partial rows) ──
  console.log('\nG. Atomicity on forced mid-tx failure');
  const ev2 = await mkEvent(A, G);
  const before = (await db.from('review_requests').select('*', { count: 'exact', head: true }).eq('guest_id', G).eq('event_id', ev2)).count;
  const bad = await mgr.cl.rpc('create_review_request', { p_org: A, p_guest: G, p_template_id: ghostTpl.template_id, p_event: ev2, p_now: DAY });
  ok(!!bad.error && /no_sender|P0002/.test(emsg(bad)), 'create_review_request with a no-sender template fails (no_sender, mid-tx)');
  const after = (await db.from('review_requests').select('*', { count: 'exact', head: true }).eq('guest_id', G).eq('event_id', ev2)).count;
  ok(before === 0 && after === 0, `atomicity: the review record rolled back with the failed enqueue (count ${before} → ${after}, zero partial rows)`);

  // ── H. org isolation (both directions) ──
  console.log('\nH. Tenant isolation (both directions)');
  const GB = await mkGuest(B, 'Bharath', '900000002');
  const tplB = (await db.rpc('upsert_message_template', { p_org: B, p_name: 'B tpl', p_function_area: 'hall_catering', p_body: 'Hi {{guest}}' })).data;
  await db.rpc('log_interaction', { p_org: B, p_guest: GB, p_type: 'note', p_note: 'b note' });
  await db.rpc('set_special_date', { p_org: B, p_guest: GB, p_date_type: 'birthday', p_the_date: '1990-01-01' });
  await db.rpc('create_review_request', { p_org: B, p_guest: GB, p_template_id: tplB.template_id, p_now: DAY });
  for (const t of ['guest_interactions', 'guest_special_dates', 'message_templates', 'review_requests']) {
    const r = await op.cl.from(t).select('*').eq('org_id', B);
    ok(!r.error && r.data.length === 0, `A-member cannot read B.${t}`);
  }
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('log_interaction', { p_org: B, p_guest: GB, p_type: 'note' }))), 'A-manager log_interaction in B → forbidden');
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('guest_ltv', { p_org: B, p_guest: GB }))), 'A-manager guest_ltv in B → forbidden');
  const bReadA = await bMgr.cl.from('guest_interactions').select('*').eq('org_id', A);
  ok(!bReadA.error && bReadA.data.length === 0, 'B-member cannot read A.guest_interactions');

  // ── I. audit ──
  console.log('\nI. Audit trail');
  const aI = await auditCount(A, 'crm.interaction_log'), aSd = await auditCount(A, 'crm.special_date_set'), aTpl = await auditCount(A, 'crm.template_upsert');
  const aSend = await auditCount(A, 'crm.template_send'), aRev = await auditCount(A, 'crm.review_request');
  ok(aI >= 2 && aSd >= 1 && aTpl >= 1 && aSend >= 1 && aRev >= 1, `audited: interaction ${aI}, special_date ${aSd}, template ${aTpl}, send ${aSend}, review ${aRev}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('guest_interactions').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('message_templates').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('review_requests').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('outbound_messages').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
