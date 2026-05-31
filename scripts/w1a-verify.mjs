#!/usr/bin/env node
/**
 * W1a CATERING menu/recipe/cost harness — proves the scale + cost engine against
 * the live DB. Self-cleaning, re-runnable, exit-coded. Throwaway orgs only.
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
const errcode = (r) => r.error?.code ?? r.error?.message ?? '';
const rid = () => randomUUID().slice(0, 8);
const num = (x) => Number(x);
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (W1a applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId) {
  const email = `pn-w1a-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities: [] });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}
const mkItem = async (org, name, cost) => (await db.from('inventory_items').insert({ org_id: org, name: `${name}-${rid()}`, unit: 'kg', cost }).select('id').single()).data.id;
const mkMenu = async (org, name) => (await db.rpc('upsert_menu_item', { p_org: org, p_name: `${name}-${rid()}`, p_supply_type: 'catering_composite' })).data.menu_item_id;
const lineOf = (res, id) => (res.data.lines || []).find((l) => l.inventory_item_id === id);

async function main() {
  const A = await mkOrg('W1a Org A'), B = await mkOrg('W1a Org B');
  const userA = await mkMember(A);
  const paneer = await mkItem(A, 'Paneer', 320), spice = await mkItem(A, 'Spice', 200), rice = await mkItem(A, 'Rice', 60);

  // ── 1. per-plate (linear) recipe scales linearly ──
  console.log('\n1. Per-plate recipe scales linearly');
  const pbm = await mkMenu(A, 'Paneer Butter Masala');
  await db.rpc('set_recipe', { p_org: A, p_menu_item_id: pbm, p_base_yield: 1, p_scale_mode: 'linear',
    p_lines: [{ inventory_item_id: paneer, quantity: 0.2, unit: 'kg' }, { inventory_item_id: spice, quantity: 0.1, unit: 'kg' }] });
  const s500 = await db.rpc('scale_recipe', { p_org: A, p_menu_item_id: pbm, p_guest_count: 500 });
  ok(!s500.error && s500.data.has_recipe === true, 'recipe scales');
  ok(num(lineOf(s500, paneer)?.scaled_quantity) === 100 && num(lineOf(s500, spice)?.scaled_quantity) === 50, 'every ingredient ×500 exactly (0.2→100, 0.1→50)');

  // ── 4. costing: per-plate = sum at base yield; total at N = scaled ──
  console.log('\n4. Costing (rolls up from inventory cost)');
  ok(num(s500.data.per_plate_cost) === 84, `per-plate cost = 0.2*320 + 0.1*200 = 84 (got ${s500.data.per_plate_cost})`);
  ok(num(s500.data.total_food_cost) === 42000, `total at 500 = 84*500 = 42000 (got ${s500.data.total_food_cost})`);

  // ── 5. live inventory cost flows through (no stale cost) ──
  console.log('\n5. Inventory cost change flows through');
  await db.rpc('record_stock_movement', { p_org: A, p_item_id: paneer, p_direction: 'in', p_quantity: 1 }); // touch (no cost change) — sanity
  await db.from('inventory_items').update({ cost: 400 }).eq('id', paneer);
  const s500b = await db.rpc('scale_recipe', { p_org: A, p_menu_item_id: pbm, p_guest_count: 500 });
  ok(num(s500b.data.per_plate_cost) === 100 && num(s500b.data.total_food_cost) === 50000, `paneer 320→400 ⇒ per-plate 100, total 50000 (got ${s500b.data.per_plate_cost}/${s500b.data.total_food_cost})`);

  // ── 2. per-batch rounds UP to whole batches ──
  console.log('\n2. Per-batch recipe rounds UP');
  const biryani = await mkMenu(A, 'Biryani');
  await db.rpc('set_recipe', { p_org: A, p_menu_item_id: biryani, p_base_yield: 50, p_scale_mode: 'batch',
    p_lines: [{ inventory_item_id: rice, quantity: 5, unit: 'kg' }] });
  const b230 = await db.rpc('scale_recipe', { p_org: A, p_menu_item_id: biryani, p_guest_count: 230 });
  ok(b230.data.batches === 5, `230 guests / batch-of-50 → 5 batches (not 4.6) (got ${b230.data.batches})`);
  ok(num(lineOf(b230, rice)?.scaled_quantity) === 25, 'rice 5kg × 5 batches = 25kg');
  ok(num(b230.data.per_plate_cost) === 6 && num(b230.data.total_food_cost) === 1500, `per-serving 6, total 300*5=1500 (got ${b230.data.per_plate_cost}/${b230.data.total_food_cost})`);

  // ── 3. menu item with NO recipe → empty, no error ──
  console.log('\n3. No-recipe item → empty (not error)');
  const water = await mkMenu(A, 'Bottled Water');
  const sw = await db.rpc('scale_recipe', { p_org: A, p_menu_item_id: water, p_guest_count: 100 });
  ok(!sw.error && sw.data.has_recipe === false && Array.isArray(sw.data.lines) && sw.data.lines.length === 0 && num(sw.data.total_food_cost) === 0, 'no recipe → has_recipe false, empty lines, 0 cost');

  // ── 7. atomic + audited ──
  console.log('\n7. Audited writes');
  const setRecipeAudits = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'catering.set_recipe')).count;
  const menuAudits = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'catering.menu_item_upsert')).count;
  ok(setRecipeAudits === 2 && menuAudits === 3, `audit rows: 2 set_recipe + 3 menu upsert (got ${setRecipeAudits}/${menuAudits})`);

  // ── 6. org isolation ──
  console.log('\n6. Tenant isolation');
  const bMenu = await mkMenu(B, 'B Dish');
  for (const t of ['catering_menu_items', 'catering_recipes', 'catering_recipe_lines']) {
    const r = await userA.from(t).select('id').eq('org_id', B);
    ok(!r.error && r.data.length === 0, `A-member cannot read B.${t}`);
  }
  const cross = await userA.rpc('upsert_menu_item', { p_org: B, p_name: 'Intruder', p_supply_type: 'x' });
  ok(!!cross.error && /42501|forbidden/.test(errcode(cross)), 'A-member upsert_menu_item in B → forbidden');
  const crossScale = await userA.rpc('scale_recipe', { p_org: B, p_menu_item_id: bMenu, p_guest_count: 10 });
  ok(!!crossScale.error && /42501|forbidden/.test(errcode(crossScale)), 'A-member scale_recipe in B → forbidden');
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('catering_menu_items').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
