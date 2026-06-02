#!/usr/bin/env node
/**
 * M8 harness — REPORTING + MARKETING LEAF. Proves: P&L-as-query over the ONE
 * finance_ledger nets revenue − expenses (incl. an M6 expense debit) by stream
 * (no stored P&L); GST-return reads the resolve_gst OUTPUT snapshot on
 * invoice_lines WITHOUT recomputing/storing a rate or touching invoices (firewall:
 * a specified_premises flip does NOT change the reported snapshot rate);
 * per-customer AR ageing buckets per guest (closes KL-11); marketing — lead-source
 * breakdown + conversions + campaign tie + an LED booking posting revenue to the
 * EXISTING ledger (no parallel ledger); capability gates; org isolation; atomicity;
 * audited. Self-cleaning, re-runnable, exit-coded.
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
const emsg = (r) => `${r.error?.code ?? ''} ${r.error?.message ?? ''} ${r.error?.details ?? ''}`;
const rid = () => randomUUID().slice(0, 8);
const today = () => new Date().toISOString().slice(0, 10);
const fromYr = () => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); };
const issuedAt = (n) => { const d = new Date(Date.now() - n * 86400000); d.setUTCHours(6, 0, 0, 0); return d.toISOString(); };
let seq = 0;
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (M8 applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-m8-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return { cl, id: c.data.user.id };
}
const mkGuest = async (org, name = `Guest-${rid()}`) => (await db.from('guests').insert({ org_id: org, name, phone: `90${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}` }).select('id').single()).data.id;
const mkEvent = async (org, guest) => (await db.from('events').insert({ org_id: org, event_date: '2099-12-01', status: 'planning', event_type: 'wedding', guest_id: guest }).select('id').single()).data.id;
const mkRoomType = async (org) => (await db.from('room_types').insert({ org_id: org, name: `RT-${rid()}`, base_rate: 5000 }).select('id').single()).data.id;
const mkStay = async (org, guest, rt) => (await db.from('room_stays').insert({ org_id: org, guest_id: guest, room_type_id: rt, check_in: '2099-11-01', check_out: '2099-11-03', status: 'checked_out', rate_quoted: 5000 }).select('id').single()).data.id;
async function mkInvoice(org, { eventId = null, stayId = null, status = 'issued', amountDue, total, ageDays = 0 }) {
  const r = await db.from('invoices').insert({ org_id: org, booking_id: null, invoice_seq: ++seq, invoice_number: `INV-${rid()}`, supply_type: 'composite', sac_code: '9963', gst_rate: 5, subtotal: total, cgst: 0, sgst: 0, total, status, amount_due: amountDue, issued_at: issuedAt(ageDays), event_id: eventId, stay_id: stayId }).select('id').single();
  if (r.error) { console.error('SETUP invoice:', r.error.message); process.exit(2); } return r.data.id;
}
async function mkLine(org, invId, stream, rate, taxable, cgst, sgst) {
  const r = await db.from('invoice_lines').insert({ org_id: org, invoice_id: invId, stream, sac_code: '9963', taxable_value: taxable, gst_rate: rate, itc: false, cgst, sgst, line_total: taxable + cgst + sgst }).select('id').single();
  if (r.error) { console.error('SETUP invoice_line:', r.error.message); process.exit(2); }
}
const wl = (org, supply, amount, dir, domain, linkedId) => db.rpc('write_ledger', { p_org: org, p_supply_type: supply, p_amount: amount, p_direction: dir, p_source_domain: domain, p_linked_type: 'invoice', p_linked_id: linkedId ?? randomUUID(), p_description: 'seed' });
const mkLead = async (org, source, status = 'new') => (await db.from('leads').insert({ org_id: org, function_area: 'hall_catering', phone: `91${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, name: `L-${rid()}`, source, status }).select('id').single()).data.id;
const auditCount = async (org, action) => (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('action', action)).count;

async function main() {
  const A = await mkOrg('M8 Org A'), B = await mkOrg('M8 Org B');
  const mgr = await mkMember(A, ['pnl.view_margin', 'marketing.manage', 'expense.manage', 'approval.decide']);
  const appr2 = await mkMember(A, ['approval.decide']);
  const op = await mkMember(A, []);
  const bMgr = await mkMember(B, ['pnl.view_margin', 'marketing.manage']);
  const FROM = fromYr(), TO = today();

  // ── 1. P&L-as-query (one ledger, nets M6 expense) ──
  console.log('\n1. Consolidated P&L (query over the one ledger; nets an M6 expense)');
  await wl(A, 'hall', 100000, 'credit', 'hall');
  await wl(A, 'rooms_fnb', 50000, 'credit', 'stays');
  // a REAL M6 expense debit (record → submit → approve via the M6 path)
  const e1 = (await db.rpc('record_expense', { p_org: A, p_amount: 20000, p_expense_date: today(), p_source_domain: 'hall' })).data;
  await db.rpc('submit_expense', { p_org: A, p_expense_id: e1.expense_id, p_required_approvals: 1, p_requested_by_user: op.id });
  await appr2.cl.rpc('decide_expense', { p_org: A, p_expense_id: e1.expense_id, p_decision: 'approve' });
  const pnl = (await mgr.cl.rpc('consolidated_pnl', { p_org: A, p_from: FROM, p_to: TO })).data;
  ok(near(pnl.streams.hall.revenue, 100000) && near(pnl.streams.hall.expenses, 20000) && near(pnl.streams.hall.net, 80000), 'hall stream: revenue 100000 − M6 expense 20000 = net 80000');
  ok(near(pnl.streams.stays.revenue, 50000), 'stays stream revenue 50000');
  ok(near(pnl.total.revenue, 150000) && near(pnl.total.expenses, 20000) && near(pnl.total.net, 130000), 'total: 150000 − 20000 = 130000');
  const pnlOp = (await op.cl.rpc('consolidated_pnl', { p_org: A, p_from: FROM, p_to: TO })).data;
  ok(pnlOp.can_see === false && pnlOp.total.net === null, 'operative: P&L money gated (null)');
  const noStore = await db.from('pnl_reports').select('id').limit(1);
  ok(!!noStore.error, 'no stored P&L table (pnl_reports absent — P&L is a query)');

  // ── 2. GST FIREWALL ──
  console.log('\n2. GST-return reads resolve_gst OUTPUT (firewall: no recompute / no invoice touch)');
  const gG = await mkGuest(A), gEv = await mkEvent(A, gG);
  const inv = await mkInvoice(A, { eventId: gEv, status: 'issued', amountDue: 0, total: 159000, ageDays: 0 });
  await mkLine(A, inv, 'rooms_fnb', 5, 100000, 2500, 2500);    // RESOLVED snapshot: 5%
  await mkLine(A, inv, 'hall', 18, 50000, 4500, 4500);         // RESOLVED snapshot: 18%
  const lineBefore = (await db.from('invoice_lines').select('gst_rate, cgst').eq('invoice_id', inv).eq('stream', 'rooms_fnb').single()).data;
  const gst = (await mgr.cl.rpc('gst_return_report', { p_org: A, p_from: FROM, p_to: TO })).data;
  const r5 = gst.output_by_rate.find((x) => near(x.gst_rate, 5)), r18 = gst.output_by_rate.find((x) => near(x.gst_rate, 18));
  ok(r5 && near(r5.taxable_value, 100000) && near(r5.tax, 5000), 'output bucket @5% from invoice_lines (taxable 100000, tax 5000)');
  ok(r18 && near(r18.tax, 9000) && near(gst.output_total_tax, 14000), 'output bucket @18% (tax 9000); total output tax 14000');
  // FIREWALL: flip specified_premises (resolve_gst would now say 18 for rooms_fnb) — the report must STILL read the 5% snapshot
  await db.from('orgs').update({ specified_premises: true }).eq('id', A);
  const gst2 = (await mgr.cl.rpc('gst_return_report', { p_org: A, p_from: FROM, p_to: TO })).data;
  ok(gst2.output_by_rate.some((x) => near(x.gst_rate, 5) && near(x.taxable_value, 100000)), 'after specified_premises flip, the report STILL shows the 5% snapshot (reads output, never resolve_gst)');
  const lineAfter = (await db.from('invoice_lines').select('gst_rate, cgst').eq('invoice_id', inv).eq('stream', 'rooms_fnb').single()).data;
  ok(near(lineAfter.gst_rate, lineBefore.gst_rate) && near(lineAfter.cgst, lineBefore.cgst), 'the report did NOT alter invoice_lines (snapshot unchanged)');
  await db.from('orgs').update({ specified_premises: false }).eq('id', A);
  // input GST from expenses (data)
  await db.rpc('record_expense', { p_org: A, p_amount: 18000, p_expense_date: today(), p_supply_type: 'rooms_fnb', p_input_gst_amount: 3000, p_source_domain: 'stays' });
  const gst3 = (await mgr.cl.rpc('gst_return_report', { p_org: A, p_from: FROM, p_to: TO })).data;
  ok(near(gst3.input_gst_total, 3000), 'input GST shown as DATA from expenses (3000)');

  // ── 3. per-customer AR ageing (closes KL-11) ──
  console.log('\n3. Per-customer AR ageing');
  const G1 = await mkGuest(A), G2 = await mkGuest(A);
  const rt = await mkRoomType(A); const rs1 = await mkStay(A, G2, rt);
  // invoices is unique per event (uq_invoice_event) → each invoice gets its own event; ageing groups by guest
  await mkInvoice(A, { eventId: await mkEvent(A, G1), status: 'issued', amountDue: 1000, total: 1000, ageDays: 10 });   // G1 0-30
  await mkInvoice(A, { eventId: await mkEvent(A, G1), status: 'issued', amountDue: 2000, total: 2000, ageDays: 75 });   // G1 61-90
  await mkInvoice(A, { stayId: rs1, status: 'issued', amountDue: 5000, total: 5000, ageDays: 45 });                     // G2 31-60
  await mkInvoice(A, { eventId: await mkEvent(A, G1), status: 'paid', amountDue: 0, total: 9000, ageDays: 10 });        // settled → drops out
  const ag = (await mgr.cl.rpc('ar_ageing_by_customer', { p_org: A })).data;
  const c1 = ag.customers.find((c) => c.guest_id === G1), c2 = ag.customers.find((c) => c.guest_id === G2);
  ok(c1 && near(c1.buckets['0_30'], 1000) && near(c1.buckets['61_90'], 2000) && near(c1.total, 3000), 'G1 bucketed: 1000 @0-30, 2000 @61-90, total 3000');
  ok(c2 && near(c2.buckets['31_60'], 5000) && near(c2.total, 5000), 'G2 bucketed: 5000 @31-60');
  ok(!ag.customers.some((c) => near(c.total, 9000)), 'settled invoice excluded');
  const agOp = (await op.cl.rpc('ar_ageing_by_customer', { p_org: A })).data;
  ok(agOp.can_see_amounts === false && agOp.customers.length >= 2 && agOp.customers[0].total === null, 'operative: ageing amounts gated, customer rows still visible');

  // ── 4. marketing: lead source + campaign + LED ──
  console.log('\n4. Marketing leaf (lead source / campaign / LED → existing ledger)');
  const L1 = await mkLead(A, 'whatsapp_inbound', 'won');
  ok(!(await mgr.cl.rpc('set_lead_source', { p_org: A, p_lead_id: L1, p_source: 'instagram' })).error, 'lead source tagged (instagram)');
  const camp = (await mgr.cl.rpc('upsert_campaign', { p_org: A, p_name: `Diwali-${rid()}`, p_spend: 10000 })).data;
  await mgr.cl.rpc('set_lead_source', { p_org: A, p_lead_id: L1, p_source: 'instagram', p_campaign_id: camp.campaign_id });
  const lr = (await mgr.cl.rpc('lead_source_report', { p_org: A, p_from: FROM, p_to: TO })).data;
  ok(lr.by_source.some((s) => s.source === 'instagram' && s.leads >= 1 && s.conversions >= 1), 'lead-source breakdown: instagram with a conversion');
  ok(lr.by_campaign.some((c) => c.campaign_id === camp.campaign_id && c.leads >= 1 && near(c.spend, 10000)), 'campaign ties lead→campaign + spend visible (manager)');
  const lrOp = (await op.cl.rpc('lead_source_report', { p_org: A, p_from: FROM, p_to: TO })).data;
  ok(lrOp.by_campaign.every((c) => c.spend === null) && lrOp.by_source.length >= 1, 'operative: campaign spend gated, source counts visible');
  // LED revenue → existing finance_ledger
  const ad = (await mgr.cl.rpc('record_ad_revenue', { p_org: A, p_advertiser: 'BrandX', p_amount: 25000 })).data;
  const ledRow = (await db.from('finance_ledger').select('direction, supply_type, source_domain, amount').eq('org_id', A).eq('linked_entity_type', 'led_booking').eq('linked_entity_id', ad.led_booking_id)).data;
  ok(ledRow.length === 1 && ledRow[0].direction === 'credit' && ledRow[0].supply_type === 'led' && ledRow[0].source_domain === 'core' && near(ledRow[0].amount, 25000), 'LED revenue posted ONE credit to the EXISTING finance_ledger (no rate set by M8)');
  const fk = await db.from('led_revenue').select('id').limit(1);
  ok(!!fk.error, 'no parallel marketing/ad ledger (led_revenue absent)');
  const pnlAfter = (await mgr.cl.rpc('consolidated_pnl', { p_org: A, p_from: FROM, p_to: TO })).data;
  ok(near(pnlAfter.streams.core.revenue, 25000), 'LED revenue flows into the P&L core stream (one ledger)');

  // ── 5. capability gates ──
  console.log('\n5. Capability gates');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('upsert_campaign', { p_org: A, p_name: 'no' }))), 'operative upsert_campaign → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('set_lead_source', { p_org: A, p_lead_id: L1, p_source: 'x' }))), 'operative set_lead_source → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('record_ad_revenue', { p_org: A, p_advertiser: 'x', p_amount: 1 }))), 'operative record_ad_revenue → forbidden');

  // ── 6. org isolation (both directions) ──
  console.log('\n6. Tenant isolation (both directions)');
  const campB = (await db.rpc('upsert_campaign', { p_org: B, p_name: 'B-camp' })).data;
  await db.rpc('record_ad_revenue', { p_org: B, p_advertiser: 'Bad', p_amount: 1000 });
  ok((await op.cl.from('campaigns').select('id').eq('org_id', B)).data.length === 0, 'A-member cannot read B.campaigns');
  ok((await op.cl.from('led_bookings').select('id').eq('org_id', B)).data.length === 0, 'A-member cannot read B.led_bookings');
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('upsert_campaign', { p_org: B, p_name: 'x' }))), 'A-manager upsert_campaign in B → forbidden');
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('consolidated_pnl', { p_org: B, p_from: FROM, p_to: TO }))), 'A-member consolidated_pnl in B → forbidden');
  ok((await bMgr.cl.from('campaigns').select('id').eq('org_id', A)).data.length === 0, 'B-member cannot read A.campaigns');
  void campB;

  // ── 7. atomicity: bad LED amount → zero rows (booking + ledger) ──
  console.log('\n7. Atomicity on forced failure');
  const bad = await mgr.cl.rpc('record_ad_revenue', { p_org: A, p_advertiser: 'NegAd', p_amount: -100 });
  ok(!!bad.error, 'record_ad_revenue with negative amount rejected (CHECK)');
  ok((await db.from('led_bookings').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('advertiser_name', 'NegAd')).count === 0, 'atomicity: rejected LED booking persisted 0 rows (no booking, no ledger)');

  // ── 8. audit ──
  console.log('\n8. Audit trail');
  const aCamp = await auditCount(A, 'marketing.campaign_upsert'), aSrc = await auditCount(A, 'marketing.lead_source_set'), aAd = await auditCount(A, 'marketing.ad_revenue'), aLed = await auditCount(A, 'finance.ledger_write');
  ok(aCamp >= 1 && aSrc >= 2 && aAd >= 1 && aLed >= 3, `audited: campaign ${aCamp}, lead_source ${aSrc}, ad_revenue ${aAd}, ledger_write ${aLed}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('campaigns').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('led_bookings').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('finance_ledger').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
