#!/usr/bin/env node
/**
 * W1d harness — kitchen production/KOT + purchasing + consumption draw-down.
 * Proves: production from a signed BEO scales at max(count,guarantee) and
 * consolidates shared ingredients; shortfall → draft POs grouped by supplier;
 * receive increments inventory via W0 record_stock_movement; consume decrements
 * via the same path; closing the SAME ticket twice does NOT double-deduct;
 * over-draw rejected (on-hand unchanged); planned-vs-actual variance + cost gated
 * to Owner/PM+Catering-Lead (nulled for operative); a room-dining order draws
 * from the same inventory ledger; org isolation; atomic + audited.
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
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-6;
const errcode = (r) => r.error?.code ?? r.error?.message ?? '';
const rid = () => randomUUID().slice(0, 8);
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (W1d applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-w1d-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}
const onHand = async (id) => Number((await db.from('inventory_items').select('quantity_on_hand').eq('id', id).single()).data.quantity_on_hand);
async function mkInv(org, n, cost, qty, supplier) {
  return (await db.from('inventory_items').insert({ org_id: org, name: `${n}-${rid()}`, unit: 'kg', cost, quantity_on_hand: qty, supplier_id: supplier ?? null }).select('id').single()).data.id;
}
async function mkMenu(org, n, price, lines) {
  const mi = (await db.rpc('upsert_menu_item', { p_org: org, p_name: `${n}-${rid()}`, p_selling_price: price, p_supply_type: 'catering_composite' })).data.menu_item_id;
  await db.rpc('set_recipe', { p_org: org, p_menu_item_id: mi, p_base_yield: 1, p_scale_mode: 'linear', p_lines: lines });
  return mi;
}
async function signedBeo(org, name, date, guests, guarantee, menuLines) {
  const e = await db.rpc('create_catering_enquiry', { p_org: org, p_event_type: 'wedding', p_event_date: date, p_guest_count: guests, p_contact_name: name, p_contact_phone: `+9170${rid()}` });
  const q = await db.rpc('create_quote', { p_org: org, p_enquiry_id: e.data.enquiry_id, p_guest_count: guests, p_lines: menuLines.map((mi) => ({ menu_item_id: mi, unit_selling_price: 100 })) });
  await db.rpc('accept_quote', { p_org: org, p_quote_id: q.data.quote_id });
  const beo = await db.rpc('generate_beo', { p_org: org, p_quote_id: q.data.quote_id, p_beo_type: 'kitchen', p_guest_guarantee: guarantee });
  await db.rpc('send_beo', { p_org: org, p_beo_id: beo.data.beo_id });
  await db.rpc('sign_beo', { p_org: org, p_beo_id: beo.data.beo_id, p_signed_by_name: name, p_signed_method: 'click' });
  return beo.data.beo_id;
}
const reqOf = (arr, id) => (arr ?? []).find((x) => x.item_id === id);

async function main() {
  const A = await mkOrg('W1d Org A'), B = await mkOrg('W1d Org B');
  const userOwner = await mkMember(A, ['pnl.view_margin']);
  const userOp = await mkMember(A, []);

  const S1 = (await db.rpc('upsert_vendor', { p_org: A, p_name: 'Supplier One' })).data.vendor_id;
  const S2 = (await db.rpc('upsert_vendor', { p_org: A, p_name: 'Supplier Two' })).data.vendor_id;
  const paneer = await mkInv(A, 'Paneer', 320, 100, S1);
  const rice = await mkInv(A, 'Rice', 60, 5, S1);
  const oil = await mkInv(A, 'Oil', 120, 0, S2);
  const ghee = await mkInv(A, 'Ghee', 500, 6, S1);
  const pbm = await mkMenu(A, 'PBM', 250, [{ inventory_item_id: paneer, quantity: 0.2, unit: 'kg' }, { inventory_item_id: oil, quantity: 0.01, unit: 'kg' }]);
  const biryani = await mkMenu(A, 'Biryani', 180, [{ inventory_item_id: rice, quantity: 0.15, unit: 'kg' }, { inventory_item_id: oil, quantity: 0.02, unit: 'kg' }]);
  const sweet = await mkMenu(A, 'GheeSweet', 90, [{ inventory_item_id: ghee, quantity: 1.0, unit: 'kg' }]);

  // ── 1. production from a signed BEO: max(count,guarantee), consolidated ──
  console.log('\n1. Production from a signed BEO (scale at max(count,guarantee); consolidate shared ingredient)');
  const beoId = await signedBeo(A, 'Latha', '2099-11-20', 200, 250, [pbm, biryani]); // count 200, guarantee 250
  const gp = await db.rpc('generate_production', { p_org: A, p_beo_id: beoId });
  ok(!gp.error && near(gp.data.billable_count, 250), `billable = max(200,250) = 250 (never under-produce) (got ${gp.data?.billable_count})`);
  const ticket = gp.data.ticket_id;
  ok(near(reqOf(gp.data.requirement, paneer)?.planned_quantity, 50), `paneer 0.2×250 = 50 (got ${reqOf(gp.data.requirement, paneer)?.planned_quantity})`);
  ok(near(reqOf(gp.data.requirement, rice)?.planned_quantity, 37.5), `rice 0.15×250 = 37.5 (got ${reqOf(gp.data.requirement, rice)?.planned_quantity})`);
  ok(near(reqOf(gp.data.requirement, oil)?.planned_quantity, 7.5), `oil CONSOLIDATED (0.01+0.02)×250 = 7.5 across PBM+Biryani (got ${reqOf(gp.data.requirement, oil)?.planned_quantity})`);

  // ── 2. shortfall → draft POs grouped by supplier ──
  console.log('\n2. Shortfall vs on-hand → draft POs grouped by supplier');
  const pp = await db.rpc('plan_purchase', { p_org: A, p_ticket_id: ticket });
  ok(!pp.error && pp.data.pos.length === 2, `2 POs (one per supplier with shortfall) (got ${pp.data?.pos?.length})`);
  const poS1 = pp.data.pos.find((p) => p.supplier_id === S1), poS2 = pp.data.pos.find((p) => p.supplier_id === S2);
  const s1lines = (await db.from('purchase_order_lines').select('item_id, quantity').eq('po_id', poS1.po_id)).data;
  const s2lines = (await db.from('purchase_order_lines').select('item_id, quantity').eq('po_id', poS2.po_id)).data;
  ok(s1lines.length === 1 && s1lines[0].item_id === rice && near(s1lines[0].quantity, 32.5), `S1 PO = rice shortfall 37.5−5 = 32.5 (paneer had enough) (got ${s1lines.map((l) => l.quantity)})`);
  ok(s2lines.length === 1 && s2lines[0].item_id === oil && near(s2lines[0].quantity, 7.5), `S2 PO = oil shortfall 7.5−0 = 7.5 (got ${s2lines.map((l) => l.quantity)})`);

  // ── 3. receive PO → inventory IN via record_stock_movement (atomic, audited) ──
  console.log('\n3. Receive PO increments inventory via W0 record_stock_movement');
  await db.rpc('order_purchase_order', { p_org: A, p_po_id: poS1.po_id });
  await db.rpc('receive_purchase_order', { p_org: A, p_po_id: poS1.po_id });
  await db.rpc('order_purchase_order', { p_org: A, p_po_id: poS2.po_id });
  await db.rpc('receive_purchase_order', { p_org: A, p_po_id: poS2.po_id });
  ok(near(await onHand(rice), 37.5), `rice 5 + 32.5 = 37.5 after receive (got ${await onHand(rice)})`);
  ok(near(await onHand(oil), 7.5), `oil 0 + 7.5 = 7.5 after receive (got ${await onHand(oil)})`);
  const inMoves = (await db.from('inventory_movements').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('direction', 'in').eq('linked_entity_type', 'purchase_order')).count;
  ok(inMoves === 2, `2 inventory IN movements logged via record_stock_movement (got ${inMoves})`);
  const reRecv = await db.rpc('receive_purchase_order', { p_org: A, p_po_id: poS2.po_id });
  ok(!!reRecv.error && /already_received|22023/.test(errcode(reRecv)) && near(await onHand(oil), 7.5), 're-receiving a PO is rejected; oil unchanged (idempotent receive)');

  // ── 4. consume (close) → inventory OUT; idempotent (no double-deduct) ──
  console.log('\n4. Close production decrements inventory; closing twice does NOT double-deduct');
  const close1 = await db.rpc('close_production', { p_org: A, p_ticket_id: ticket, p_actuals: [{ item_id: paneer, actual_quantity: 52 }] }); // actual 52 vs planned 50
  ok(!close1.error && near(await onHand(paneer), 48), `paneer 100 − 52 (actual) = 48 (got ${await onHand(paneer)})`);
  ok(near(await onHand(rice), 0) && near(await onHand(oil), 0), `rice 37.5→0, oil 7.5→0 (defaulted to planned) (got ${await onHand(rice)}/${await onHand(oil)})`);
  const close2 = await db.rpc('close_production', { p_org: A, p_ticket_id: ticket });
  ok(!!close2.error && /already_closed|22023/.test(errcode(close2)) && near(await onHand(paneer), 48), 'second close REJECTED; paneer still 48 (idempotent — no double-deduct)');

  // ── 5. over-draw rejected, on-hand unchanged ──
  console.log('\n5. Over-draw beyond on-hand rejected (on-hand unchanged on failure)');
  const od = await db.rpc('create_room_dining', { p_org: A, p_lines: [{ menu_item_id: sweet, portion_count: 7 }], p_label: 'Room 101' }); // need 7 ghee, have 6
  const odClose = await db.rpc('close_production', { p_org: A, p_ticket_id: od.data.ticket_id });
  ok(!!odClose.error && /insufficient_stock|23514/.test(errcode(odClose)) && near(await onHand(ghee), 6), 'over-draw (need 7, have 6) rejected; ghee unchanged at 6');

  // ── 6. room-dining draws from the SAME inventory ledger (one kitchen/one inventory) ──
  console.log('\n6. Stays room-dining draws from the same inventory ledger');
  const rd = await db.rpc('create_room_dining', { p_org: A, p_lines: [{ menu_item_id: sweet, portion_count: 2 }], p_label: 'Room 102' });
  ok(!rd.error && near(reqOf(rd.data.requirement, ghee)?.planned_quantity, 2), 'room-dining requirement = 2 ghee (no BEO)');
  await db.rpc('close_production', { p_org: A, p_ticket_id: rd.data.ticket_id });
  ok(near(await onHand(ghee), 4), `ghee 6 − 2 = 4 — same ledger serves banquet AND room-dining (got ${await onHand(ghee)})`);

  // ── 7. planned-vs-actual variance + cost gate ──
  console.log('\n7. Planned-vs-actual variance; cost/variance gated to Owner/PM + Catering-Lead');
  const vOwner = (await userOwner.rpc('production_variance', { p_org: A, p_ticket_id: ticket })).data;
  const pOwner = (vOwner.lines ?? []).find((l) => l.item_id === paneer);
  ok(vOwner.can_see_cost === true && near(pOwner.variance_quantity, 2) && near(pOwner.variance_cost, 640), `Owner sees variance: paneer 52−50 = +2, ×320 = ₹640 (got ${pOwner?.variance_quantity}/${pOwner?.variance_cost})`);
  const vOp = (await userOp.rpc('production_variance', { p_org: A, p_ticket_id: ticket })).data;
  const pOp = (vOp.lines ?? []).find((l) => l.item_id === paneer);
  ok(vOp.can_see_cost === false && pOp.variance_quantity === null && pOp.unit_cost === null && pOp.variance_cost === null, 'operative: variance + cost nulled (can_see_cost false)');

  // ── 8. org isolation + audit ──
  console.log('\n8. Tenant isolation + audit');
  const cross = await userOp.rpc('generate_production', { p_org: B, p_beo_id: randomUUID() });
  ok(!!cross.error && /42501|forbidden/.test(errcode(cross)), 'A-member generate_production in B → forbidden');
  for (const t of ['kitchen_tickets', 'purchase_orders', 'production_consumption']) {
    const r = await userOp.from(t).select('id').eq('org_id', B);
    ok(!r.error && r.data.length === 0, `A-member cannot read B.${t}`);
  }
  const aGen = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'catering.production_generate')).count;
  const aRecv = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'catering.po_receive')).count;
  const aClose = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'catering.production_close')).count;
  ok(aGen >= 1 && aRecv === 2 && aClose >= 1, `audited: generate ${aGen}, po_receive ${aRecv}, close ${aClose}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('kitchen_tickets').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('purchase_orders').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
