#!/usr/bin/env node
/**
 * W1e harness — consolidated multi-rate GST invoice over the shared Event.
 * Proves: one Event with hall + rooms/F&B + catering → ONE invoice, three rates
 * each RESOLVED from supply_type + premises flag (not hardcoded; flipping the
 * flag/supply_type changes the rate); catering billed on max(actual,guarantee);
 * multi-rate tax summary groups CGST/SGST per rate; deposit applied as a
 * DISCHARGE (not a revenue line, not taxed; amount_due = total − deposit);
 * on settle, revenue posts to finance_ledger tagged by stream and the deposit
 * discharge hits deposit_ledger (forfeit ⇒ taxable income); per-org sequential
 * numbering; settlement Owner/PM-gated; org isolation; atomic + audited.
 * Self-cleaning, re-runnable, exit-coded. Throwaway orgs.
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
const created = { users: [], orgs: [] };

async function mkOrg(n, specified = false) {
  const o = await db.from('orgs').insert({ name: n, specified_premises: specified }).select('id').single();
  if (o.error) { console.error('SETUP (W1e applied?):', o.error.message); process.exit(2); }
  created.orgs.push(o.data.id); return o.data.id;
}
async function mkMember(orgId, capabilities = []) {
  const email = `pn-w1e-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}
const guestId = async (org, name) => (await db.from('guests').insert({ org_id: org, name, phone: `+9170${rid()}`, status: 'active' }).select('id').single()).data.id;
async function hallEvent(org, hallRent, deposit, guestCount, guarantee) {
  const hall = (await db.from('halls').insert({ org_id: org, name: `Hall-${rid()}` }).select('id').single()).data.id;
  const bk = (await db.from('bookings').insert({ org_id: org, hall_id: hall, event_date: '2099-12-12', slot: 'evening', status: 'confirmed', hall_rent: hallRent, customer_name: 'Test', idempotency_key: rid() }).select('id').single()).data.id;
  if (deposit > 0) await db.from('deposit_ledger').insert({ org_id: org, booking_id: bk, amount: deposit, entry_type: 'deposit_held', is_liability: true, status: 'held' });
  const g = await guestId(org, 'Latha');
  const ev = (await db.from('events').insert({ org_id: org, booking_id: bk, guest_id: g, event_date: '2099-12-12', slot: 'evening', guest_count: guestCount, status: 'planning', event_type: 'wedding' }).select('id').single()).data.id;
  let beo = null;
  if (guarantee != null) beo = (await db.from('catering_beos').insert({ org_id: org, event_id: ev, guest_id: g, beo_type: 'kitchen', version: 1, status: 'signed', guest_count: guestCount, guest_guarantee: guarantee }).select('id').single()).data.id;
  return { bk, ev, beo };
}
async function main() {
  const A = await mkOrg('W1e Org A', false);  // PN = non-specified premises
  const B = await mkOrg('W1e Org B', true);   // specified premises (for the flag-flip proof)
  const userOwner = await mkMember(A, ['settlement.process']);
  const userOp = await mkMember(A, []);

  // ── 1. rate resolved from supply_type + premises flag (NOT hardcoded) ──
  console.log('\n1. GST engine: rate resolved from supply_type + premises flag (config-driven)');
  const gHallA = (await db.rpc('resolve_gst', { p_org: A, p_supply_type: 'hall' })).data;
  const gRoomA = (await db.rpc('resolve_gst', { p_org: A, p_supply_type: 'rooms_fnb' })).data;
  const gCatA = (await db.rpc('resolve_gst', { p_org: A, p_supply_type: 'catering' })).data;
  const gRoomB = (await db.rpc('resolve_gst', { p_org: B, p_supply_type: 'rooms_fnb' })).data;
  ok(near(gHallA.rate, 18) && gHallA.itc === true, 'hall → 18% w/ITC');
  ok(near(gRoomA.rate, 5) && gRoomA.itc === false, 'rooms/F&B (non-specified) → 5% no-ITC');
  ok(near(gCatA.rate, 5) && gCatA.sac_code === '9963', 'catering → composite 5% (SAC 9963)');
  ok(near(gRoomB.rate, 18), 'SAME rooms/F&B supply_type → 18% when premises flag flipped (rate is resolved, not stored)');

  // ── consolidated invoice: hall 100000 (18%), rooms/F&B 20000 (5%), catering 800×250 (5%) ──
  console.log('\n2. ONE consolidated invoice over the Event, three resolved rates');
  const { ev, beo } = await hallEvent(A, 100000, 50000, 250, 250);
  const lines = [
    { stream: 'hall', description: 'Hall rent', taxable_value: 100000, source_ref: 'booking' },
    { stream: 'rooms_fnb', description: 'Room + room-dining', taxable_value: 20000 },
    { stream: 'catering', description: 'Catering', unit_price: 800, actual_count: 200, beo_id: beo }, // actual 200 < guarantee 250
  ];
  const inv = (await db.rpc('generate_consolidated_invoice', { p_org: A, p_event_id: ev, p_lines: lines })).data;
  const invLines = inv.lines;
  const hl = invLines.find((l) => l.stream === 'hall'), rf = invLines.find((l) => l.stream === 'rooms_fnb'), cl = invLines.find((l) => l.stream === 'catering');
  ok(near(hl.gst_rate, 18) && near(hl.cgst, 9000) && near(hl.sgst, 9000), 'hall line: 18% → CGST 9000 + SGST 9000');
  ok(near(rf.gst_rate, 5) && near(rf.cgst, 500), 'rooms/F&B line: 5% → CGST 500');
  ok(near(cl.gst_rate, 5), 'catering line: composite 5%');

  // ── 3. catering billed on max(actual, guarantee) ──
  console.log('\n3. Catering billed on max(actual, guarantee)');
  ok(near(cl.billed_count, 250) && near(cl.taxable_value, 200000), `actual 200 < guarantee 250 → bill 250 × 800 = 200000 (got ${cl.billed_count}/${cl.taxable_value})`);

  // ── 4. multi-rate tax summary groups CGST/SGST per rate ──
  console.log('\n4. Multi-rate tax summary (grouped per resolved rate)');
  const sum18 = inv.tax_summary.find((s) => near(s.gst_rate, 18)), sum5 = inv.tax_summary.find((s) => near(s.gst_rate, 5));
  ok(near(sum18.taxable, 100000) && near(sum18.cgst, 9000) && near(sum18.sgst, 9000) && sum18.itc === true, '18% group: taxable 100000, CGST/SGST 9000, w/ITC');
  ok(near(sum5.taxable, 220000) && near(sum5.cgst, 5500) && near(sum5.sgst, 5500) && sum5.itc === false, '5% group: rooms 20000 + catering 200000 = 220000, CGST/SGST 5500, no-ITC');
  ok(near(inv.subtotal, 320000) && near(inv.total, 349000), `subtotal 320000, total 349000 (got ${inv.subtotal}/${inv.total})`);

  // ── 5. deposit applied as discharge — not a revenue line, not taxed ──
  console.log('\n5. Deposit applied as discharge (not revenue, not taxed)');
  ok(near(inv.deposit_applied, 50000) && near(inv.amount_due, 299000), `deposit_applied 50000; amount_due = 349000 − 50000 = 299000 (got ${inv.amount_due})`);
  ok(invLines.every((l) => ['hall', 'rooms_fnb', 'catering'].includes(l.stream)), 'no deposit line on the invoice (deposit is never a taxable supply)');

  // ── 6. settlement posts revenue per stream; deposit discharge hits deposit_ledger ──
  console.log('\n6. Settle → revenue to finance_ledger by stream; deposit discharge to deposit_ledger');
  const opSettle = await userOp.rpc('settle_invoice', { p_org: A, p_invoice_id: inv.invoice_id });
  ok(!!opSettle.error && /42501|forbidden/.test(errcode(opSettle)), 'operative settle → forbidden (Owner/PM only)');
  const settled = await userOwner.rpc('settle_invoice', { p_org: A, p_invoice_id: inv.invoice_id, p_deposit_resolution: 'discharge' });
  ok(!settled.error && settled.data.status === 'paid' && settled.data.deposit === 'discharged', 'Owner settle → paid, deposit discharged');
  const led = (await db.from('finance_ledger').select('supply_type, amount, direction, source_domain').eq('org_id', A).eq('direction', 'credit')).data;
  const fHall = led.find((x) => x.supply_type === 'hall'), fRoom = led.find((x) => x.supply_type === 'rooms_fnb'), fCat = led.find((x) => x.supply_type === 'catering');
  ok(near(fHall?.amount, 100000) && fHall.source_domain === 'hall', 'revenue: hall 100000 → domain hall');
  ok(near(fRoom?.amount, 20000) && fRoom.source_domain === 'stays', 'revenue: rooms/F&B 20000 → domain stays');
  ok(near(fCat?.amount, 200000) && fCat.source_domain === 'catering', 'revenue: catering 200000 → domain catering');
  ok(!led.some((x) => x.supply_type === 'deposit_forfeit'), 'discharge did NOT post the deposit as revenue');
  const adj = (await db.from('deposit_ledger').select('id', { count: 'exact', head: true }).eq('org_id', A).eq('entry_type', 'deposit_adjusted').eq('status', 'adjusted')).count;
  ok(adj === 1, 'deposit discharge recorded in deposit_ledger (deposit_adjusted)');

  // ── forfeit path: deposit becomes taxable income ──
  console.log('\n6b. Forfeit path → deposit becomes taxable income (finance_ledger)');
  const e2 = await hallEvent(A, 50000, 30000, 100, null);
  const inv2 = (await db.rpc('generate_consolidated_invoice', { p_org: A, p_event_id: e2.ev, p_lines: [{ stream: 'hall', taxable_value: 50000 }] })).data;
  await userOwner.rpc('settle_invoice', { p_org: A, p_invoice_id: inv2.invoice_id, p_deposit_resolution: 'forfeit' });
  const ff = (await db.from('finance_ledger').select('amount').eq('org_id', A).eq('supply_type', 'deposit_forfeit')).data;
  ok(ff.length === 1 && near(ff[0].amount, 30000), 'forfeited deposit 30000 posted as taxable income (finance_ledger credit)');

  // ── 7. per-org sequential numbering + idempotency ──
  console.log('\n7. Per-org sequential numbering + idempotency');
  ok(inv.invoice_number === 'INV-00001' && inv2.invoice_number === 'INV-00002', `sequential per org (got ${inv.invoice_number}, ${inv2.invoice_number})`);
  const again = (await db.rpc('generate_consolidated_invoice', { p_org: A, p_event_id: ev, p_lines: lines })).data;
  ok(again.idempotent === true && again.invoice_id === inv.invoice_id, 're-generate same Event → idempotent (same invoice, no new number)');

  // ── 8. org isolation + audit ──
  console.log('\n8. Tenant isolation + audit');
  const cross = await userOp.rpc('generate_consolidated_invoice', { p_org: B, p_event_id: randomUUID(), p_lines: [{ stream: 'hall', taxable_value: 1 }] });
  ok(!!cross.error && /42501|forbidden/.test(errcode(cross)), 'A-member generate in B → forbidden');
  const isoLines = await userOp.from('invoice_lines').select('id').eq('org_id', B);
  ok(!isoLines.error && isoLines.data.length === 0, 'A-member cannot read B.invoice_lines');
  const aGen = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'invoice.generate')).count;
  const aSettle = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'invoice.settle')).count;
  const aLedger = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'finance.ledger_write')).count;
  ok(aGen === 2 && aSettle === 2 && aLedger >= 5, `audited: generate ${aGen}, settle ${aSettle}, ledger ${aLedger}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('invoices').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('finance_ledger').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
