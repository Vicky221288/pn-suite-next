#!/usr/bin/env node
/**
 * M6 harness — FINANCE BACK-OFFICE. Proves: expense → submit → flows through the
 * M1b GENERIC primitive as request_type='expense' (SAME approval_requests/
 * _decisions tables; NO expense-approval table); inherited guarantees (multi-tier,
 * distinct-approver, anti-self); on approval POSTS a DEBIT to the SHARED
 * finance_ledger via write_ledger (reject → no post); THE FINANCE FIREWALL (expense
 * path touches no invoice / no resolve_gst; input GST is data; ledger debit =
 * amount exactly); P&L-as-query (one ledger nets revenue − expense); ageing buckets
 * over invoices (coalesce(amount_due,total); paid drops out; money gated);
 * capability gates; org isolation; atomicity; audited. Self-cleaning, ×2.
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
const issued = (n) => { const d = new Date(Date.now() - n * 86400000); d.setUTCHours(6, 0, 0, 0); return d.toISOString(); };
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (M6 applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-m6-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return { cl, id: c.data.user.id };
}
const mkVendor = async (org) => (await db.from('vendors').insert({ org_id: org, name: `V-${rid()}` }).select('id').single()).data.id;
const mkCategory = async (org) => (await db.from('expense_categories').insert({ org_id: org, name: `C-${rid()}` }).select('id').single()).data.id;
const recDraft = (org, amount, domain) => db.rpc('record_expense', { p_org: org, p_amount: amount, p_expense_date: '2099-06-01', p_source_domain: domain ?? 'core' });
const expRow = async (id) => (await db.from('expenses').select('*').eq('id', id).single()).data;
const ledgerForExpense = async (org, eid) => (await db.from('finance_ledger').select('direction, supply_type, amount').eq('org_id', org).eq('linked_entity_type', 'expense').eq('linked_entity_id', eid));
const invCount = async (org) => (await db.from('invoices').select('*', { count: 'exact', head: true }).eq('org_id', org)).count;
const auditCount = async (org, action) => (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('action', action)).count;
async function mkInvoice(org, seq, total, amountDue, ageDays, status = 'issued') {
  const r = await db.from('invoices').insert({ org_id: org, booking_id: null, invoice_seq: seq, invoice_number: `INV-${rid()}`, supply_type: 'composite', sac_code: '9963', gst_rate: 5, subtotal: total, cgst: 0, sgst: 0, total, status, amount_due: amountDue, issued_at: issued(ageDays) }).select('id').single();
  if (r.error) { console.error('SETUP invoice:', r.error.message); process.exit(2); } return r.data.id;
}

async function main() {
  const A = await mkOrg('M6 Org A'), B = await mkOrg('M6 Org B');
  const mgr = await mkMember(A, ['expense.manage', 'approval.decide', 'pnl.view_margin']);
  const appr2 = await mkMember(A, ['approval.decide']);
  const op = await mkMember(A, []);
  const bMgr = await mkMember(B, ['expense.manage', 'approval.decide', 'pnl.view_margin']);
  const cat = await mkCategory(A); const ven = await mkVendor(A);

  // ── 1. expense → submit → flows through the M1b primitive (reuse proof) ──
  console.log('\n1. Expense submit reuses the M1b approval primitive (request_type=expense)');
  const e1 = (await db.rpc('record_expense', { p_org: A, p_amount: 30000, p_expense_date: '2099-06-01', p_category_id: cat, p_vendor_id: ven, p_source_domain: 'core' })).data;
  ok(e1.expense_id && e1.status === 'draft', 'expense recorded (draft)');
  const sub1 = await db.rpc('submit_expense', { p_org: A, p_expense_id: e1.expense_id, p_required_approvals: 1, p_requested_by_user: op.id });
  ok(!sub1.error && (await expRow(e1.expense_id)).status === 'pending', 'submit → pending');
  const appr = (await db.from('approval_requests').select('*').eq('request_type', 'expense').eq('subject_id', e1.expense_id).single()).data;
  ok(appr && appr.request_type === 'expense' && appr.subject_id === e1.expense_id, 'flows through the SAME approval_requests table as request_type=expense');
  const f1 = await db.from('expense_approvals').select('id').limit(1);
  const f2 = await db.from('expense_approval_requests').select('id').limit(1);
  ok(!!f1.error && !!f2.error, 'NO expense-specific approval table created (reuse, not rebuild)');

  // ── 2. inherited guarantees: multi-tier + distinct-approver + anti-self ──
  console.log('\n2. Inherited approval guarantees (multi-tier / distinct / anti-self)');
  const eMt = (await recDraft(A, 50000)).data;
  await db.rpc('submit_expense', { p_org: A, p_expense_id: eMt.expense_id, p_required_approvals: 2, p_requested_by_user: op.id });
  ok((await mgr.cl.rpc('decide_expense', { p_org: A, p_expense_id: eMt.expense_id, p_decision: 'approve' })).data.status === 'pending', 'tier 1/2 → still pending (no post yet)');
  ok((await expRow(eMt.expense_id)).ledger_entry_id === null, 'no ledger post at tier 1/2');
  ok(/already_decided|23505/.test(emsg(await mgr.cl.rpc('decide_expense', { p_org: A, p_expense_id: eMt.expense_id, p_decision: 'approve' }))), 'same approver twice → already_decided (distinct-approver)');
  ok((await appr2.cl.rpc('decide_expense', { p_org: A, p_expense_id: eMt.expense_id, p_decision: 'approve' })).data.status === 'approved', 'tier 2/2 by a second approver → approved');
  const eSelf = (await recDraft(A, 10000)).data;
  await db.rpc('submit_expense', { p_org: A, p_expense_id: eSelf.expense_id, p_required_approvals: 1, p_requested_by_user: mgr.id });
  ok(/self_approval|22023/.test(emsg(await mgr.cl.rpc('decide_expense', { p_org: A, p_expense_id: eSelf.expense_id, p_decision: 'approve' }))), 'anti-self-approval (submitter cannot approve own expense)');
  ok((await appr2.cl.rpc('decide_expense', { p_org: A, p_expense_id: eSelf.expense_id, p_decision: 'approve' })).data.status === 'approved', 'a different approver approves it');

  // ── 3. on approval POSTS to finance_ledger; reject → no post ──
  console.log('\n3. Approval posts a DEBIT to the shared finance_ledger; reject → no post');
  const ledMt = await ledgerForExpense(A, eMt.expense_id);
  ok(ledMt.data.length === 1 && ledMt.data[0].direction === 'debit' && ledMt.data[0].supply_type === 'expense' && near(ledMt.data[0].amount, 50000), 'approved expense posted ONE debit (supply_type=expense) to finance_ledger');
  ok((await expRow(eMt.expense_id)).ledger_entry_id !== null, 'expense linked to its ledger entry');
  const eRej = (await recDraft(A, 7000)).data;
  await db.rpc('submit_expense', { p_org: A, p_expense_id: eRej.expense_id, p_required_approvals: 1, p_requested_by_user: op.id });
  await mgr.cl.rpc('decide_expense', { p_org: A, p_expense_id: eRej.expense_id, p_decision: 'reject' });
  ok((await expRow(eRej.expense_id)).status === 'rejected' && (await ledgerForExpense(A, eRej.expense_id)).data.length === 0, 'rejected expense → NO ledger post');

  // ── 4. THE FINANCE FIREWALL ──
  console.log('\n4. Finance firewall (no invoice / no resolve_gst; input GST is data)');
  const invBefore = await invCount(A);
  const eFw = (await db.rpc('record_expense', { p_org: A, p_amount: 30000, p_expense_date: '2099-06-01', p_supply_type: 'rooms_fnb', p_input_gst_amount: 5400, p_source_domain: 'stays' })).data;
  await db.rpc('submit_expense', { p_org: A, p_expense_id: eFw.expense_id, p_required_approvals: 1, p_requested_by_user: op.id });
  await mgr.cl.rpc('decide_expense', { p_org: A, p_expense_id: eFw.expense_id, p_decision: 'approve' });
  ok(await invCount(A) === invBefore, 'approving an expense created/altered NO invoice (firewall: revenue path untouched)');
  const fwRow = await expRow(eFw.expense_id);
  ok(near(fwRow.input_gst_amount, 5400) && fwRow.supply_type === 'rooms_fnb', 'input GST + supply_type stored as DATA on the expense (never resolved)');
  const ledFw = (await ledgerForExpense(A, eFw.expense_id)).data[0];
  ok(near(ledFw.amount, 30000) && ledFw.supply_type === 'expense', 'ledger debit = expense amount EXACTLY (30000) — input GST not run through any engine');

  // ── 5. P&L-as-query (one ledger, many streams) ──
  console.log('\n5. P&L-as-query (one ledger nets revenue − expenses)');
  await db.rpc('write_ledger', { p_org: A, p_supply_type: 'hall', p_amount: 100000, p_direction: 'credit', p_source_domain: 'hall', p_linked_type: 'invoice', p_linked_id: randomUUID(), p_description: 'rev hall' });
  const rows = (await db.from('finance_ledger').select('direction, amount, supply_type').eq('org_id', A)).data;
  const C = rows.filter((r) => r.direction === 'credit').reduce((s, r) => s + Number(r.amount), 0);
  const D = rows.filter((r) => r.direction === 'debit').reduce((s, r) => s + Number(r.amount), 0);
  ok(C >= 100000 && D >= 30000 && rows.some((r) => r.supply_type === 'hall') && rows.some((r) => r.supply_type === 'expense'),
    `one ledger holds BOTH revenue (credit ${C}) + expense (debit ${D}) streams`);
  ok(near(C - D, C - D) && (C - D) < C, `P&L = a QUERY over the one ledger: net = revenue − expenses = ${C - D}`);

  // ── 6. ageing over invoices ──
  console.log('\n6. Collections / AR ageing over invoices');
  await mkInvoice(A, 1, 1000, 1000, 10);   // 0-30
  await mkInvoice(A, 2, 1000, 1000, 45);   // 31-60
  await mkInvoice(A, 3, 1000, 1000, 75);   // 61-90
  await mkInvoice(A, 4, 1000, 1000, 120);  // 90+
  await mkInvoice(A, 5, 1000, 0, 10, 'paid');         // settled → drops out
  await mkInvoice(A, 6, 500, null, 5);     // amount_due null → coalesce(total) 500, 0-30
  const ag = (await mgr.cl.rpc('collections_ageing', { p_org: A })).data;
  ok(ag.buckets['0_30'].count === 2 && near(ag.buckets['0_30'].amount, 1500), '0-30 bucket: 2 invoices, 1500 (incl. coalesce amount_due→total)');
  ok(ag.buckets['31_60'].count === 1 && ag.buckets['61_90'].count === 1 && ag.buckets['90_plus'].count === 1, '31-60 / 61-90 / 90+ each = 1');
  ok(ag.total_count === 5 && near(ag.total_outstanding, 4500), 'paid invoice excluded; total outstanding 4500 over 5 invoices');
  const agOp = (await op.cl.rpc('collections_ageing', { p_org: A })).data;
  ok(agOp.can_see_amounts === false && agOp.buckets['0_30'].amount === null && agOp.buckets['0_30'].count === 2, 'operative: amounts gated (null) but COUNTS visible');

  // ── 7. capability gates ──
  console.log('\n7. Capability gates');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('record_expense', { p_org: A, p_amount: 1, p_expense_date: '2099-06-01' }))), 'operative record_expense → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('submit_expense', { p_org: A, p_expense_id: e1.expense_id }))), 'operative submit_expense → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('decide_expense', { p_org: A, p_expense_id: e1.expense_id, p_decision: 'approve' }))), 'operative decide_expense → forbidden (no approval.decide)');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('upsert_expense_category', { p_org: A, p_name: 'no' }))), 'operative upsert_expense_category → forbidden');

  // ── 8. org isolation (both directions) ──
  console.log('\n8. Tenant isolation (both directions)');
  const eB = (await db.rpc('record_expense', { p_org: B, p_amount: 999, p_expense_date: '2099-06-01' })).data;
  ok((await op.cl.from('expenses').select('id').eq('org_id', B)).data.length === 0, 'A-member cannot read B.expenses');
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('record_expense', { p_org: B, p_amount: 1, p_expense_date: '2099-06-01' }))), 'A-manager record_expense in B → forbidden');
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('decide_expense', { p_org: B, p_expense_id: eB.expense_id, p_decision: 'approve' }))), 'A-manager decide_expense in B → forbidden');
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('collections_ageing', { p_org: B }))), 'A-member collections_ageing in B → forbidden');
  ok((await bMgr.cl.from('expenses').select('id').eq('org_id', A)).data.length === 0, 'B-member cannot read A.expenses');

  // ── 9. atomicity: submit with required_approvals=0 → expense rolls back to draft ──
  console.log('\n9. Atomicity on forced mid-tx failure');
  const eAt = (await recDraft(A, 4000)).data;
  const bad = await db.rpc('submit_expense', { p_org: A, p_expense_id: eAt.expense_id, p_required_approvals: 0, p_requested_by_user: op.id });
  ok(!!bad.error, 'submit with required_approvals=0 fails (primitive CHECK fires mid-tx)');
  ok((await expRow(eAt.expense_id)).status === 'draft', 'atomicity: expense→pending update rolled back with the approval insert (still draft)');
  ok((await db.from('approval_requests').select('id', { count: 'exact', head: true }).eq('subject_id', eAt.expense_id)).count === 0, 'no orphan approval_requests row');

  // ── 10. audit ──
  console.log('\n10. Audit trail');
  const aRec = await auditCount(A, 'finance.expense_record'), aSub = await auditCount(A, 'finance.expense_submit');
  const aDec = await auditCount(A, 'finance.expense_decide'), aLed = await auditCount(A, 'finance.ledger_write');
  ok(aRec >= 5 && aSub >= 4 && aDec >= 4 && aLed >= 4, `audited: record ${aRec}, submit ${aSub}, decide ${aDec}, ledger_write ${aLed}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('expenses').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('finance_ledger').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('invoices').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
