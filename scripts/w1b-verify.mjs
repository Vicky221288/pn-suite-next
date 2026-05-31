#!/usr/bin/env node
/**
 * W1b CATERING enquiry→quote→package harness. Proves Guest reuse, quote
 * compute (selling/cost/margin), live-cost margin drift vs point-in-time
 * selling, package pre-fill, server-side margin capability gate, org isolation.
 * Self-cleaning, re-runnable, exit-coded. Throwaway orgs only.
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

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (W1b applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, caps) {
  const email = `pn-w1b-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'x', capabilities: caps });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}
const mkInv = async (org, name, cost) => (await db.from('inventory_items').insert({ org_id: org, name: `${name}-${rid()}`, unit: 'kg', cost }).select('id').single()).data.id;
async function mkMenuWithRecipe(org, name, price, invId, qtyPerPlate) {
  const mi = (await db.rpc('upsert_menu_item', { p_org: org, p_name: `${name}-${rid()}`, p_selling_price: price, p_supply_type: 'catering_composite' })).data.menu_item_id;
  await db.rpc('set_recipe', { p_org: org, p_menu_item_id: mi, p_base_yield: 1, p_scale_mode: 'linear', p_lines: [{ inventory_item_id: invId, quantity: qtyPerPlate, unit: 'kg' }] });
  return mi;
}

async function main() {
  const A = await mkOrg('W1b Org A'), B = await mkOrg('W1b Org B');
  const owner = await mkMember(A, ['booking.confirm', 'pnl.view_margin']);
  const cateringLead = await mkMember(A, ['catering.view_cost']);
  const operative = await mkMember(A, []);
  const paneer = await mkInv(A, 'Paneer', 320), sugar = await mkInv(A, 'Sugar', 50);
  const pbm = await mkMenuWithRecipe(A, 'Paneer Masala', 250, paneer, 0.2);   // food cost 64/plate
  const dessert = await mkMenuWithRecipe(A, 'Dessert', 80, sugar, 0.1);        // food cost 5/plate

  // ── 1. enquiry create-or-LINK Guest (shared-core reuse) ──
  console.log('\n1. Enquiry create-or-link Guest');
  const phone = `+9170${rid()}`;
  const e1 = await db.rpc('create_catering_enquiry', { p_org: A, p_event_type: 'wedding', p_event_date: '2099-12-01', p_guest_count: 300, p_contact_name: 'Ramesh', p_contact_phone: phone });
  ok(!e1.error && e1.data.guest_created === true, 'first enquiry creates a Guest');
  const e2 = await db.rpc('create_catering_enquiry', { p_org: A, p_event_type: 'reception', p_event_date: '2099-12-15', p_guest_count: 200, p_contact_name: 'Ramesh', p_contact_phone: phone });
  ok(!e2.error && e2.data.guest_created === false && e2.data.guest_id === e1.data.guest_id, 'second enquiry (same phone+name) LINKS same Guest (no duplicate)');

  // ── 2. quote compute: selling / food cost / margin ──
  console.log('\n2. Quote compute');
  const q1 = await db.rpc('create_quote', { p_org: A, p_enquiry_id: e1.data.enquiry_id, p_guest_count: 300, p_lines: [{ menu_item_id: pbm, unit_selling_price: 250 }, { menu_item_id: dessert, unit_selling_price: 80 }] });
  ok(!q1.error && q1.data.lines === 2, 'quote created with 2 lines');
  const s1 = await db.rpc('quote_summary', { p_org: A, p_quote_id: q1.data.quote_id }); // service-role → cost visible
  ok(num(s1.data.total_selling) === 99000, `total selling = (250+80)*300 = 99000 (got ${s1.data.total_selling})`);
  ok(num(s1.data.total_food_cost) === 20700, `food cost = 64*300 + 5*300 = 20700 (got ${s1.data.total_food_cost})`);
  ok(num(s1.data.total_margin) === 78300, `margin = 99000 - 20700 = 78300 (got ${s1.data.total_margin})`);

  // ── 3. inventory cost change moves MARGIN (live) but NOT stored SELLING ──
  console.log('\n3. Cost drift → margin moves, selling fixed');
  await db.from('inventory_items').update({ cost: 400 }).eq('id', paneer); // paneer 320→400 ⇒ PBM cost 80/plate
  const s1b = await db.rpc('quote_summary', { p_org: A, p_quote_id: q1.data.quote_id });
  ok(num(s1b.data.total_selling) === 99000, 'stored selling UNCHANGED (point-in-time offer)');
  ok(num(s1b.data.total_food_cost) === 25500 && num(s1b.data.total_margin) === 73500, `cost→25500, margin→73500 (live) (got ${s1b.data.total_food_cost}/${s1b.data.total_margin})`);

  // ── 4. quote from a package pre-fills the package lines ──
  console.log('\n4. Package pre-fill');
  const pkg = await db.rpc('upsert_package', { p_org: A, p_name: 'Standard Veg', p_description: 'veg wedding', p_items: [{ menu_item_id: pbm, unit_selling_price: 300 }, { menu_item_id: dessert, unit_selling_price: 100 }] });
  const q2 = await db.rpc('create_quote', { p_org: A, p_enquiry_id: e2.data.enquiry_id, p_guest_count: 100, p_lines: [], p_package_id: pkg.data.package_id });
  ok(!q2.error && q2.data.lines === 2, 'quote from package pre-filled 2 lines');
  const s2 = await db.rpc('quote_summary', { p_org: A, p_quote_id: q2.data.quote_id });
  const pbmLine = (s2.data.lines || []).find((l) => l.menu_item_id === pbm);
  ok(num(pbmLine?.unit_selling_price) === 300 && num(s2.data.total_selling) === 40000, `package prices used (PBM @300; total (300+100)*100=40000) (got ${s2.data.total_selling})`);

  // ── 5. margin gate (server-side): Owner/PM + Catering-Lead see cost; operative does NOT ──
  console.log('\n5. Margin/cost capability gate (server-side)');
  const asOwner = await owner.rpc('quote_summary', { p_org: A, p_quote_id: q1.data.quote_id });
  const asLead = await cateringLead.rpc('quote_summary', { p_org: A, p_quote_id: q1.data.quote_id });
  const asOp = await operative.rpc('quote_summary', { p_org: A, p_quote_id: q1.data.quote_id });
  ok(!asOwner.error && asOwner.data.can_see_cost === true && asOwner.data.total_margin != null, 'Owner (pnl.view_margin) sees margin');
  ok(!asLead.error && asLead.data.can_see_cost === true && asLead.data.total_food_cost != null, 'Catering Lead (catering.view_cost) sees cost');
  ok(!asOp.error && asOp.data.can_see_cost === false && asOp.data.total_food_cost === null && asOp.data.total_margin === null, 'operative does NOT see cost/margin (selling only)');
  ok(num(asOp.data.total_selling) === 99000, 'operative still sees selling total');

  // ── 6. audited writes + org isolation ──
  console.log('\n6. Audit + tenant isolation');
  const enqAudits = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'catering.enquiry_create')).count;
  const quoteAudits = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'catering.quote_create')).count;
  ok(enqAudits === 2 && quoteAudits === 2, `audited: 2 enquiry + 2 quote (got ${enqAudits}/${quoteAudits})`);
  await db.rpc('create_catering_enquiry', { p_org: B, p_event_type: 'x', p_event_date: '2099-01-01', p_guest_count: 10, p_contact_name: 'B', p_contact_phone: `+9171${rid()}` });
  for (const t of ['catering_enquiries', 'catering_quotes', 'catering_packages']) {
    const r = await owner.from(t).select('id').eq('org_id', B);
    ok(!r.error && r.data.length === 0, `A-member cannot read B.${t}`);
  }
  const cross = await owner.rpc('create_catering_enquiry', { p_org: B, p_event_type: 'x', p_event_date: '2099-01-01', p_guest_count: 10, p_contact_name: 'I', p_contact_phone: `+9172${rid()}` });
  ok(!!cross.error && /42501|forbidden/.test(errcode(cross)), 'A-member enquiry in B → forbidden');
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('catering_quotes').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
