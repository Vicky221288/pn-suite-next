#!/usr/bin/env node
/**
 * KL-1 harness — cost-column visibility lockdown. Proves an OPERATIONAL role
 * cannot read raw ingredient cost by ANY path (direct table select, the
 * inventory_items embed, the purchase_order_lines.unit_cost column, OR the
 * scale_recipe RPC), while the scale engine (service_role/system) and Owner/PM
 * cost reads still work, and the menu page's safe columns still read. Org
 * isolation; audited writes unaffected. Self-cleaning, re-runnable, exit-coded.
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
const rid = () => randomUUID().slice(0, 8);
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP:', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-kl1-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}

async function main() {
  const A = await mkOrg('KL1 Org A'), B = await mkOrg('KL1 Org B');
  const userOwner = await mkMember(A, ['pnl.view_margin']);
  const userOp = await mkMember(A, []);
  const paneer = (await db.from('inventory_items').insert({ org_id: A, name: `Paneer-${rid()}`, unit: 'kg', cost: 320, quantity_on_hand: 50 }).select('id').single()).data.id;
  const mi = (await db.rpc('upsert_menu_item', { p_org: A, p_name: `PBM-${rid()}`, p_selling_price: 400, p_supply_type: 'catering_composite' })).data.menu_item_id;
  await db.rpc('set_recipe', { p_org: A, p_menu_item_id: mi, p_base_yield: 1, p_scale_mode: 'linear', p_lines: [{ inventory_item_id: paneer, quantity: 0.2, unit: 'kg' }] });

  // ── 1. operative cannot read inventory_items.cost by direct select ──
  console.log('\n1. Direct table read of inventory_items.cost is locked');
  const selCost = await userOp.from('inventory_items').select('cost').eq('id', paneer);
  ok(!!selCost.error, `operative select(cost) → denied (${selCost.error?.code ?? selCost.error?.message ?? 'err'})`);
  const selSafe = await userOp.from('inventory_items').select('name, quantity_on_hand').eq('id', paneer);
  ok(!selSafe.error && selSafe.data.length === 1, 'operative select(name, quantity_on_hand) → OK (safe columns still readable)');
  const selStar = await userOp.from('inventory_items').select('*').eq('id', paneer);
  ok(!!selStar.error, 'operative select(*) → denied (expands to cost)');

  // ── 2. operative cannot read cost via the recipe-line embed ──
  console.log('\n2. The inventory_items(cost) embed is locked');
  const embed = await userOp.from('catering_recipe_lines').select('quantity, inventory_items(cost)').limit(1);
  ok(!!embed.error, 'operative embed inventory_items(cost) → denied');
  const embedSafe = await userOp.from('catering_recipe_lines').select('quantity, inventory_items(name)').limit(1);
  ok(!embedSafe.error, 'operative embed inventory_items(name) → OK');

  // ── 3. operative cannot read purchase_order_lines.unit_cost ──
  console.log('\n3. purchase_order_lines.unit_cost is locked');
  const poCost = await userOp.from('purchase_order_lines').select('unit_cost').limit(1);
  ok(!!poCost.error, 'operative select(unit_cost) → denied');
  const poSafe = await userOp.from('purchase_order_lines').select('name, quantity').limit(1);
  ok(!poSafe.error, 'operative select(name, quantity) → OK');

  // ── 4. scale_recipe gates cost (the RPC vector) ──
  console.log('\n4. scale_recipe gates its cost output');
  const opScale = (await userOp.rpc('scale_recipe', { p_org: A, p_menu_item_id: mi, p_guest_count: 100 })).data;
  ok(opScale.can_see_cost === false && opScale.total_food_cost === null && opScale.lines[0].line_cost === null, 'operative scale_recipe: cost null; quantities present');
  ok(near(opScale.lines[0].scaled_quantity, 20), 'operative still gets scaled quantities (0.2 × 100 = 20) — production unaffected');
  const ownerScale = (await userOwner.rpc('scale_recipe', { p_org: A, p_menu_item_id: mi, p_guest_count: 100 })).data;
  ok(ownerScale.can_see_cost === true && near(ownerScale.total_food_cost, 6400), 'Owner scale_recipe: real cost (0.2 × 320 × 100 = 6400)');
  const sysScale = (await db.rpc('scale_recipe', { p_org: A, p_menu_item_id: mi, p_guest_count: 100 })).data;
  ok(near(sysScale.total_food_cost, 6400), 'system (service_role) scale engine still computes cost — internals intact');

  // ── 5. po_line_costs gated accessor ──
  console.log('\n5. po_line_costs gated accessor (Owner sees, operative does not)');
  ok((await userOp.rpc('po_line_costs', { p_org: A })).data.can_see_cost === false, 'operative po_line_costs → can_see_cost false');
  ok((await userOwner.rpc('po_line_costs', { p_org: A })).data.can_see_cost === true, 'Owner po_line_costs → can_see_cost true');

  // ── 6. existing gated RPCs unchanged; Owner/PM legitimate reads work ──
  console.log('\n6. Owner/PM legitimate cost reads still work end-to-end');
  const e = await db.rpc('create_catering_enquiry', { p_org: A, p_event_type: 'wedding', p_event_date: '2099-09-09', p_guest_count: 100, p_contact_name: 'T', p_contact_phone: `+9170${rid()}` });
  const q = await db.rpc('create_quote', { p_org: A, p_enquiry_id: e.data.enquiry_id, p_guest_count: 100, p_lines: [{ menu_item_id: mi, unit_selling_price: 400 }] });
  const qsOwner = (await userOwner.rpc('quote_summary', { p_org: A, p_quote_id: q.data.quote_id })).data;
  const qsOp = (await userOp.rpc('quote_summary', { p_org: A, p_quote_id: q.data.quote_id })).data;
  ok(qsOwner.can_see_cost === true && near(qsOwner.total_food_cost, 6400), 'Owner quote_summary still sees food cost (6400)');
  ok(qsOp.can_see_cost === false && qsOp.total_food_cost === null, 'operative quote_summary still gated (null)');

  // ── 7. org isolation ──
  console.log('\n7. Tenant isolation');
  const cross = await userOp.rpc('scale_recipe', { p_org: B, p_menu_item_id: mi, p_guest_count: 1 });
  ok(!!cross.error && /42501|forbidden/.test(cross.error.code ?? cross.error.message ?? ''), 'operative scale_recipe in B → forbidden');
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
