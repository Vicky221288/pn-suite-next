#!/usr/bin/env node
/**
 * M7 harness — INVENTORY REORDER + PROCUREMENT AUTOMATION (A11 detect / A12 draft).
 * Proves: reorder_point is per-item opt-in (NULL = not monitored); A11 detects
 * on-hand <= reorder_point reading the EXISTING W0 quantity_on_hand (move stock via
 * record_stock_movement → detection reflects it; no parallel on-hand); A12 drafts
 * via the EXISTING W1d purchase_orders/_lines path grouped by supplier (status
 * draft, source reorder; NO parallel PO table); IDEMPOTENT (covered item not
 * re-drafted; re-drafts once the draft leaves 'draft'); B3 notify (idempotent +
 * quiet-hours-aware); registry-driven; capability gate; org isolation; atomicity;
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
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.001;
const emsg = (r) => `${r.error?.code ?? ''} ${r.error?.message ?? ''} ${r.error?.details ?? ''}`;
const rid = () => randomUUID().slice(0, 8);
const DAY = '2099-06-15T06:00:00Z';        // 11:30 IST 2099-06-15 (daytime)
const NIGHT = '2099-06-16T18:00:00Z';      // 23:30 IST 2099-06-16 (quiet hours, distinct IST date)
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (M7 applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-m7-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return { cl, id: c.data.user.id };
}
const mkVendor = async (org) => (await db.from('vendors').insert({ org_id: org, name: `V-${rid()}` }).select('id').single()).data.id;
const mkItem = async (org, supplier) => (await db.from('inventory_items').insert({ org_id: org, name: `Item-${rid()}`, unit: 'kg', supplier_id: supplier }).select('id').single()).data.id;
const mkSender = async (org, mgrPhone) => { const r = await db.from('message_senders').insert({ org_id: org, function_area: 'hall_catering', display_name: `S-${rid()}`, phone_number: `+9199${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, manager_phone: mgrPhone, provider: 'mock', active: true }); if (r.error) { console.error('SETUP sender:', r.error.message); process.exit(2); } };
const setRP = (org, item, point, qty) => db.rpc('set_reorder_point', { p_org: org, p_item_id: item, p_reorder_point: point, p_reorder_qty: qty });
const move = (org, item, dir, q) => db.rpc('record_stock_movement', { p_org: org, p_item_id: item, p_direction: dir, p_quantity: q });
const reorderPOs = async (org) => (await db.from('purchase_orders').select('id, supplier_id, status, source, purchase_order_lines(item_id, quantity)').eq('org_id', org).eq('source', 'reorder')).data;
const onHand = async (item) => Number((await db.from('inventory_items').select('quantity_on_hand').eq('id', item).single()).data.quantity_on_hand);
const auditCount = async (org, action) => (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('action', action)).count;
const openDraftLinesFor = (pos, itemId) => pos.filter((p) => p.status === 'draft').flatMap((p) => p.purchase_order_lines).filter((l) => l.item_id === itemId);

async function main() {
  const A = await mkOrg('M7 Org A'), B = await mkOrg('M7 Org B');
  const mgr = await mkMember(A, ['inventory.manage']);
  const op = await mkMember(A, []);
  const bMgr = await mkMember(B, ['inventory.manage']);
  const S1 = await mkVendor(A), S2 = await mkVendor(A);
  const MGR_PHONE = `+9180${rid()}`; await mkSender(A, MGR_PHONE);

  // items (new items default reorder_point NULL = not monitored)
  const I1 = await mkItem(A, S1), I2 = await mkItem(A, S1), I3 = await mkItem(A, S2), I4 = await mkItem(A, S1), I5 = await mkItem(A, S1), I6 = await mkItem(A, S1);
  await setRP(A, I1, 10, 20); await move(A, I1, 'in', 50);   // on-hand 50 (> 10, not short)
  await setRP(A, I2, 10, 15); await move(A, I2, 'in', 5);    // on-hand 5  (<= 10, short)
  await setRP(A, I3, 8, 30);  await move(A, I3, 'in', 3);    // on-hand 3  (<= 8, short; supplier S2)
  /* I4: NOT configured (reorder_point NULL) */ await move(A, I4, 'in', 0);  // on-hand 0 but NOT monitored
  await setRP(A, I5, 10, 5);  await move(A, I5, 'in', 50);   // on-hand 50 (not short)
  await setRP(A, I6, 10, 7);  await move(A, I6, 'in', 2);    // on-hand 2  (<= 10, short; supplier S1)

  // ── 1. A11 detect + A12 draft (W1d path, supplier-grouped) + NULL not monitored ──
  console.log('\n1. Detect shortfalls + draft via the W1d PO path (supplier-grouped)');
  const run1 = await db.rpc('run_reorder_check', { p_org: A, p_now: DAY });
  ok(!run1.error && run1.data === 2, `drafted exactly 2 POs (S1 group {I2,I6} + S2 group {I3}) (got ${run1.data})`);
  let pos = await reorderPOs(A);
  const s1po = pos.find((p) => p.supplier_id === S1), s2po = pos.find((p) => p.supplier_id === S2);
  ok(s1po && s1po.status === 'draft' && s1po.purchase_order_lines.length === 2, 'S1 draft PO groups TWO short items (I2 + I6) in one PO');
  ok(s2po && s2po.purchase_order_lines.length === 1 && near(s2po.purchase_order_lines[0].quantity, 30), 'S2 draft PO has I3 (qty 30 = its reorder_qty)');
  const i2line = s1po.purchase_order_lines.find((l) => l.item_id === I2);
  ok(i2line && near(i2line.quantity, 15), 'I2 line qty = its reorder_qty (15)');
  ok(!pos.flatMap((p) => p.purchase_order_lines).some((l) => l.item_id === I4), 'I4 (reorder_point NULL) is NOT monitored → never drafted');
  ok(!pos.flatMap((p) => p.purchase_order_lines).some((l) => l.item_id === I1 || l.item_id === I5), 'on-hand > reorder_point (I1, I5) → not detected');

  // ── 2. B3 notify (sent at daytime, to the manager) ──
  console.log('\n2. B3 reorder notification');
  const obKey = `reorder-alert:${A}:2099-06-15`;
  const ob = (await db.from('outbound_messages').select('status, recipient').eq('org_id', A).eq('idempotency_key', obKey)).data;
  ok(ob.length === 1 && ob[0].status === 'sent' && ob[0].recipient === MGR_PHONE, 'one B3 notify to the manager (sent, daytime)');

  // ── 3. on-hand read from the EXISTING W0 source (move stock → detection reflects it) ──
  console.log('\n3. On-hand from W0 (record_stock_movement) drives detection');
  ok(await onHand(I1) === 50, 'I1 on-hand 50 (W0 field) — not short in run 1');
  await move(A, I1, 'out', 45);   // on-hand 5 <= 10 → now short
  ok(await onHand(I1) === 5, 'record_stock_movement out → I1 on-hand 5 (the SAME W0 field the rule reads)');
  const run2 = await db.rpc('run_reorder_check', { p_org: A, p_now: DAY });
  ok(run2.data === 1, 'run 2 drafts I1 now that it is short (1 new PO) — proves detection uses W0 on-hand');
  pos = await reorderPOs(A);
  ok(openDraftLinesFor(pos, I1).length === 1, 'I1 now has an open draft reorder line');
  ok(openDraftLinesFor(pos, I2).length === 1 && openDraftLinesFor(pos, I3).length === 1, 'I2/I3 NOT re-drafted in run 2 (still single open draft each — idempotent)');

  // ── 4. idempotency: re-tick → 0 new (covered items skipped) ──
  console.log('\n4. Idempotency (covered items not re-drafted)');
  const poCountBefore = (await reorderPOs(A)).length;
  const run3 = await db.rpc('run_reorder_check', { p_org: A, p_now: DAY });
  ok(run3.data === 0 && (await reorderPOs(A)).length === poCountBefore, 're-tick → 0 new POs (all short items covered by open drafts)');

  // ── 5. re-draft after the draft leaves 'draft' (consumed/ordered) ──
  console.log('\n5. Re-draft once the prior draft is ordered (no longer open draft)');
  await db.from('purchase_orders').update({ status: 'ordered' }).eq('id', s1po.id);   // simulate manual order of the S1 draft (I2,I6)
  pos = await reorderPOs(A);
  ok(openDraftLinesFor(pos, I2).length === 0, 'after ordering, I2 is no longer covered by an OPEN draft');
  const run5 = await db.rpc('run_reorder_check', { p_org: A, p_now: DAY });
  ok(run5.data >= 1 && openDraftLinesFor(await reorderPOs(A), I2).length === 1, 'I2 (still short) RE-DRAFTS into a new open draft (re-draft mechanism)');

  // ── 6. no parallel PO table ──
  console.log('\n6. No parallel PO table (reuses W1d purchase_orders)');
  const f1 = await db.from('reorder_pos').select('id').limit(1);
  const f2 = await db.from('reorder_purchase_orders').select('id').limit(1);
  ok(!!f1.error && !!f2.error, 'NO parallel reorder PO table (drafts live in W1d purchase_orders/_lines)');

  // ── 7. quiet-hours-aware notify (separate org C, night tick) ──
  console.log('\n7. Quiet-hours-aware notify');
  const C = await mkOrg('M7 Org C'); const Sc = await mkVendor(C); const MGR_C = `+9181${rid()}`; await mkSender(C, MGR_C);
  const Ic = await mkItem(C, Sc); await setRP(C, Ic, 10, 5); await move(C, Ic, 'in', 2);   // short
  const runC = await db.rpc('run_reorder_check', { p_org: C, p_now: NIGHT });
  const obC = (await db.from('outbound_messages').select('status, scheduled_for').eq('org_id', C).eq('idempotency_key', `reorder-alert:${C}:2099-06-16`)).data;
  ok(runC.data >= 1 && obC.length === 1 && obC[0].status === 'deferred' && !!obC[0].scheduled_for, 'night-tick notify is DEFERRED (quiet-hours-aware)');

  // ── 8. capability gate on reorder config ──
  console.log('\n8. Capability gate (inventory.manage)');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('set_reorder_point', { p_org: A, p_item_id: I1, p_reorder_point: 5, p_reorder_qty: 5 }))), 'operative set_reorder_point → forbidden');
  ok(!(await mgr.cl.rpc('set_reorder_point', { p_org: A, p_item_id: I5, p_reorder_point: 12, p_reorder_qty: 4 })).error, 'manager set_reorder_point → allowed');

  // ── 9. org isolation (both directions) ──
  console.log('\n9. Tenant isolation (both directions)');
  const Sb = await mkVendor(B); const Ib = await mkItem(B, Sb); await setRP(B, Ib, 10, 5); await move(B, Ib, 'in', 2);
  await db.rpc('run_reorder_check', { p_org: A, p_now: DAY });
  ok((await reorderPOs(B)).length === 0, 'running A’s reorder rule created NO B purchase orders (tenant-scoped)');
  const runB = await db.rpc('run_reorder_check', { p_org: B, p_now: DAY });
  ok(runB.data >= 1 && (await reorderPOs(B)).length >= 1, 'B’s reorder rule drafts B’s own PO');
  ok((await op.cl.from('inventory_items').select('id').eq('org_id', B)).data.length === 0, 'A-member cannot read B.inventory_items');
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('set_reorder_point', { p_org: B, p_item_id: Ib, p_reorder_point: 1, p_reorder_qty: 1 }))), 'A-manager set_reorder_point in B → forbidden');
  ok((await bMgr.cl.from('inventory_items').select('id').eq('org_id', A)).data.length === 0, 'B-member cannot read A.inventory_items');

  // ── 10. atomicity: bad config (point set, qty 0) rejected → unchanged ──
  console.log('\n10. Atomicity on forced failure');
  const Iat = await mkItem(A, S1);
  const bad = await mgr.cl.rpc('set_reorder_point', { p_org: A, p_item_id: Iat, p_reorder_point: 5, p_reorder_qty: 0 });
  ok(!!bad.error && /reorder_qty_required|22023/.test(emsg(bad)), 'reorder_point with qty 0 rejected (monitoring needs a positive qty)');
  ok((await db.from('inventory_items').select('reorder_point').eq('id', Iat).single()).data.reorder_point === null, 'rejected config left the item unchanged (still not monitored)');

  // ── 11. registry-driven ──
  console.log('\n11. Registry-driven');
  const reg = readFileSync(new URL('../lib/automation/registry.ts', import.meta.url), 'utf8');
  ok(/run_reorder_check/.test(reg) && /A_reorder/.test(reg), 'the rule is wired into the B4 registry (A_reorder / run_reorder_check)');

  // ── 12. audit ──
  console.log('\n12. Audit trail');
  const aDraft = await auditCount(A, 'rule.A_reorder.draft'), aCfg = await auditCount(A, 'inventory.reorder_config'), aMov = await auditCount(A, 'inventory.movement');
  ok(aDraft >= 3 && aCfg >= 6 && aMov >= 6, `audited: reorder draft ${aDraft}, reorder_config ${aCfg}, movements ${aMov}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('inventory_items').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('purchase_orders').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('outbound_messages').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
