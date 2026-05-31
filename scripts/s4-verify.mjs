#!/usr/bin/env node
/**
 * S4 harness — room folio + F&B-to-folio + settlement + reporting (Stays closer).
 * Proves: room-night charges at the type rate; a W1d room-dining order posts an
 * F&B line to the folio AND drew inventory (KL-2 closed); settlement via the W1e
 * engine at 5% no-ITC (resolved from rooms_fnb, not hardcoded — premises flip
 * changes the rate), posts revenue to finance_ledger stream=stays, stay→SETTLED;
 * deposit escrowed/discharged not revenue; occupancy/ADR/RevPAR correct, revenue
 * Owner/PM-gated; settle idempotent; org isolation; atomic + audited.
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

async function mkOrg(n, specified = false) { const o = await db.from('orgs').insert({ name: n, specified_premises: specified }).select('id').single(); if (o.error) { console.error('SETUP (S4 applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-s4-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}
const mkRoom = async (org, rtype) => (await db.rpc('create_room', { p_org: org, p_room_type_id: rtype, p_number: `R-${rid()}`, p_name: null })).data.room_id;
const reserve = (org, room, ci, co, phone = '+9170000001', name = 'Latha') => db.rpc('create_room_stay', { p_org: org, p_phone: phone, p_name: name, p_room_id: room, p_room_type_id: null, p_check_in: ci, p_check_out: co });
const folioCharges = async (stayId) => (await db.from('folio_charges').select('charge_type, amount').eq('stay_id', stayId)).data;
const onHand = async (id) => Number((await db.from('inventory_items').select('quantity_on_hand').eq('id', id).single()).data.quantity_on_hand);
async function checkInOut(org, stayId) { await db.rpc('check_in_stay', { p_org: org, p_stay_id: stayId }); await db.rpc('check_out_stay', { p_org: org, p_stay_id: stayId }); }

async function main() {
  const A = await mkOrg('S4 Org A', false), B = await mkOrg('S4 Org B', true);
  const userOwner = await mkMember(A, ['settlement.process', 'pnl.view_margin']);
  const userOp = await mkMember(A, []);
  const RT = (await db.rpc('upsert_room_type', { p_org: A, p_name: 'Deluxe', p_base_rate: 5000 })).data.room_type_id;

  // ── 1. room-night charges at the type rate ──
  console.log('\n1. Room-night charges accrue at the room_type rate');
  const r1 = await mkRoom(A, RT);
  const s1 = (await reserve(A, r1, '2099-06-10', '2099-06-15')).data.stay_id;   // 5 nights @ 5000 = 25000
  await db.rpc('check_in_stay', { p_org: A, p_stay_id: s1 });
  await db.rpc('post_room_nights', { p_org: A, p_stay_id: s1 });
  const c1 = await folioCharges(s1);
  ok(c1.length === 1 && c1[0].charge_type === 'room_night' && near(c1[0].amount, 25000), '5 nights × 5000 = 25000 room-night charge');

  // ── 2. F&B-to-folio (KL-2): room-dining posts an F&B line + drew inventory ──
  console.log('\n2. W1d room-dining → F&B line on the folio (KL-2 closed)');
  const paneer = (await db.from('inventory_items').insert({ org_id: A, name: `Paneer-${rid()}`, unit: 'kg', cost: 320, quantity_on_hand: 10 }).select('id').single()).data.id;
  const mi = (await db.rpc('upsert_menu_item', { p_org: A, p_name: `PBM-${rid()}`, p_selling_price: 300, p_supply_type: 'catering_composite' })).data.menu_item_id;
  await db.rpc('set_recipe', { p_org: A, p_menu_item_id: mi, p_base_yield: 1, p_scale_mode: 'linear', p_lines: [{ inventory_item_id: paneer, quantity: 0.1, unit: 'kg' }] });
  const before = await onHand(paneer);
  const ticket = (await db.rpc('create_room_dining', { p_org: A, p_lines: [{ menu_item_id: mi, portion_count: 2 }], p_label: 'Room 10 dining' })).data.ticket_id;
  await db.rpc('close_production', { p_org: A, p_ticket_id: ticket });   // draws inventory (W1d)
  ok(near(await onHand(paneer), before - 0.2), `room-dining drew inventory (paneer ${before} → ${await onHand(paneer)})`);
  await db.rpc('post_room_dining_to_folio', { p_org: A, p_ticket_id: ticket, p_stay_id: s1 });
  const c2 = await folioCharges(s1);
  const fnb = c2.find((c) => c.charge_type === 'fnb');
  ok(!!fnb && near(fnb.amount, 600), 'F&B line on the folio = 2 × 300 = 600 (from menu config, not hardcoded)');
  const dup = await db.rpc('post_room_dining_to_folio', { p_org: A, p_ticket_id: ticket, p_stay_id: s1 });
  ok(dup.data.posted === false && (await folioCharges(s1)).filter((c) => c.charge_type === 'fnb').length === 1, 're-posting the same ticket → no duplicate F&B line (idempotent)');

  // ── 3. settlement via W1e engine: 5% no-ITC resolved, revenue→ledger, →SETTLED ──
  console.log('\n3. Settlement → GST invoice (5% no-ITC, resolved) → ledger stream=stays → SETTLED');
  ok(near((await db.rpc('resolve_gst', { p_org: A, p_supply_type: 'rooms_fnb' })).data.rate, 5)
     && near((await db.rpc('resolve_gst', { p_org: B, p_supply_type: 'rooms_fnb' })).data.rate, 18),
     'rate RESOLVED from rooms_fnb + premises flag (A non-specified 5%; B specified 18%) — not hardcoded');
  await db.rpc('check_out_stay', { p_org: A, p_stay_id: s1 });
  const opSettle = await userOp.rpc('settle_folio', { p_org: A, p_stay_id: s1 });
  ok(!!opSettle.error && /42501|forbidden/.test(errcode(opSettle)), 'operative settle → forbidden (Owner/PM only)');
  const settle = await userOwner.rpc('settle_folio', { p_org: A, p_stay_id: s1 });
  ok(!settle.error && near(settle.data.gst_rate, 5) && near(settle.data.total, 26880), `invoice @5%: 25600 + 1280 GST = 26880 (got ${settle.data?.total})`);
  ok((await db.from('room_stays').select('status').eq('id', s1).single()).data.status === 'settled', 'stay → SETTLED');
  const led = (await db.from('finance_ledger').select('amount, source_domain').eq('org_id', A).eq('supply_type', 'rooms_fnb').eq('direction', 'credit')).data;
  ok(led.some((x) => near(x.amount, 25600) && x.source_domain === 'stays'), 'revenue 25600 posted to finance_ledger (domain stays)');

  // ── 4. deposit escrowed/discharged, not revenue ──
  console.log('\n4. Deposit applied as discharge (not revenue)');
  const r3 = await mkRoom(A, RT);
  const s3 = (await reserve(A, r3, '2099-07-01', '2099-07-02', '+9198881111', 'Deva')).data.stay_id;  // 1 night = 5000
  await checkInOut(A, s3);
  const st = await db.rpc('settle_folio', { p_org: A, p_stay_id: s3, p_deposit_applied: 2000 });
  ok(near(st.data.total, 5250) && near(st.data.deposit_applied, 2000) && near(st.data.amount_due, 3250), 'total 5250, deposit 2000, amount_due = 3250');
  const led3 = (await db.from('finance_ledger').select('amount').eq('org_id', A).eq('supply_type', 'rooms_fnb').eq('direction', 'credit')).data;
  ok(led3.some((x) => near(x.amount, 5000)) && !led3.some((x) => near(x.amount, 2000)), 'revenue posted = net 5000 (taxable); deposit 2000 NOT posted as revenue');

  // ── 5. settle idempotent ──
  console.log('\n5. Idempotent settlement');
  const again = await db.rpc('settle_folio', { p_org: A, p_stay_id: s1 });
  ok(again.data.idempotent === true, 're-settling a settled stay → idempotent (no double-post)');

  // ── 6. occupancy / ADR / RevPAR + gating (dedicated 2-room org) ──
  console.log('\n6. Occupancy / ADR / RevPAR + revenue gate');
  const R = await mkOrg('S4 Org R', false);
  const ownerR = await mkMember(R, ['settlement.process', 'pnl.view_margin']);
  const opR = await mkMember(R, []);
  const rt2 = (await db.rpc('upsert_room_type', { p_org: R, p_name: 'Std', p_base_rate: 5000 })).data.room_type_id;
  const ra = await mkRoom(R, rt2), rb = await mkRoom(R, rt2);  // total_rooms = 2
  const sa = (await reserve(R, ra, '2099-06-01', '2099-06-06', '+9197770001', 'A')).data.stay_id;  // 5 nights
  const sb = (await reserve(R, rb, '2099-06-01', '2099-06-03', '+9197770002', 'B')).data.stay_id;  // 2 nights
  for (const s of [sa, sb]) { await checkInOut(R, s); await db.rpc('settle_folio', { p_org: R, p_stay_id: s }); }
  const rep = (await ownerR.rpc('stays_report', { p_org: R, p_from: '2099-06-01', p_to: '2099-06-11' })).data; // 10 nights, avail 20
  ok(rep.total_rooms === 2 && near(rep.available_room_nights, 20) && near(rep.sold_room_nights, 7), 'available 20, sold 7 room-nights');
  ok(near(rep.occupancy_pct, 35) && near(rep.adr, 5000) && near(rep.revpar, 1750), `occupancy 35%, ADR 5000, RevPAR 1750 (got ${rep.occupancy_pct}/${rep.adr}/${rep.revpar})`);
  const repOp = (await opR.rpc('stays_report', { p_org: R, p_from: '2099-06-01', p_to: '2099-06-11' })).data;
  ok(repOp.can_see_revenue === false && repOp.room_revenue === null && repOp.adr === null && near(repOp.occupancy_pct, 35), 'operative: revenue/ADR/RevPAR gated null; occupancy counts visible');

  // ── 7. org isolation + audit ──
  console.log('\n7. Tenant isolation + audit');
  const cross = await userOp.rpc('add_folio_charge', { p_org: B, p_stay_id: randomUUID(), p_charge_type: 'other', p_description: 'x', p_amount: 1 });
  ok(!!cross.error && /42501|forbidden/.test(errcode(cross)), 'A-member add_folio_charge in B → forbidden');
  const iso = await userOp.from('folio_charges').select('id').eq('org_id', B);
  ok(!iso.error && iso.data.length === 0, 'A-member cannot read B.folio_charges');
  const aSettle = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'stays.folio_settle')).count;
  const aFnb = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'stays.fnb_to_folio')).count;
  ok(aSettle >= 2 && aFnb >= 1, `audited: folio_settle ${aSettle}, fnb_to_folio ${aFnb}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('room_folios').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('invoices').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
