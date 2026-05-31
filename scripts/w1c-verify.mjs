#!/usr/bin/env node
/**
 * W1c BEO harness — BEO attaches to the SHARED Event (one wedding, one Event),
 * carries guest_count + distinct guest-guarantee, supports multiple BEOs
 * (kitchen+FOH) per event, e-sign lifecycle + immutability, dietary from Guest,
 * org isolation, audited. Self-cleaning, re-runnable, exit-coded. Throwaway orgs.
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
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (W1c applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId) {
  const email = `pn-w1c-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities: [] });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}
const mkInv = async (org, n, cost) => (await db.from('inventory_items').insert({ org_id: org, name: `${n}-${rid()}`, unit: 'kg', cost }).select('id').single()).data.id;
async function mkMenu(org, n, price, inv, qty) {
  const mi = (await db.rpc('upsert_menu_item', { p_org: org, p_name: `${n}-${rid()}`, p_selling_price: price, p_supply_type: 'catering_composite' })).data.menu_item_id;
  await db.rpc('set_recipe', { p_org: org, p_menu_item_id: mi, p_base_yield: 1, p_scale_mode: 'linear', p_lines: [{ inventory_item_id: inv, quantity: qty, unit: 'kg' }] });
  return mi;
}
async function enquiryQuoteAccepted(org, name, phone, date, guests, lines) {
  const e = await db.rpc('create_catering_enquiry', { p_org: org, p_event_type: 'wedding', p_event_date: date, p_guest_count: guests, p_contact_name: name, p_contact_phone: phone });
  const q = await db.rpc('create_quote', { p_org: org, p_enquiry_id: e.data.enquiry_id, p_guest_count: guests, p_lines: lines });
  await db.rpc('accept_quote', { p_org: org, p_quote_id: q.data.quote_id });
  return { enquiryId: e.data.enquiry_id, quoteId: q.data.quote_id, guestId: e.data.guest_id };
}
const beoRow = async (id) => (await db.from('catering_beos').select('guest_count,guest_guarantee,dietary_flags,status,signed_by_name,signed_at,event_id,beo_type,version').eq('id', id).single()).data;

async function main() {
  const A = await mkOrg('W1c Org A'), B = await mkOrg('W1c Org B');
  const userA = await mkMember(A);
  const paneer = await mkInv(A, 'Paneer', 320);
  const pbm = await mkMenu(A, 'PBM', 250, paneer, 0.2), dessert = await mkMenu(A, 'Dessert', 80, paneer, 0.05);

  // ── 1 (standalone) + 2 + 5: BEO on a NEW shared Event; counts + dietary ──
  console.log('\n1. Accepted quote → BEO on a shared Event (standalone)');
  const t2 = await enquiryQuoteAccepted(A, 'Latha', `+9170${rid()}`, '2099-11-20', 300, [{ menu_item_id: pbm, unit_selling_price: 250 }, { menu_item_id: dessert, unit_selling_price: 80 }]);
  await db.from('guests').update({ dietary_flags: ['jain', 'nut-free'] }).eq('id', t2.guestId); // dietary on the Guest
  const beoK = await db.rpc('generate_beo', { p_org: A, p_quote_id: t2.quoteId, p_beo_type: 'kitchen', p_guest_guarantee: 250 });
  ok(!beoK.error && beoK.data.event_created === true, 'BEO created a NEW shared Event');
  const ev2 = (await db.from('events').select('id, guest_id, booking_id, event_type').eq('id', beoK.data.event_id).single()).data;
  ok(!!ev2 && ev2.guest_id === t2.guestId && ev2.booking_id === null, 'event is a real spine `events` row (guest-linked, no hall booking — not a parallel object)');
  const bk = await beoRow(beoK.data.beo_id);
  ok(bk.guest_count === 300 && bk.guest_guarantee === 250, `BEO carries guest_count 300 AND distinct guest_guarantee 250 (got ${bk.guest_count}/${bk.guest_guarantee})`);
  ok(JSON.stringify((bk.dietary_flags || []).sort()) === JSON.stringify(['jain', 'nut-free']), 'dietary flags pulled from the Guest');

  // ── 3. multiple BEOs (kitchen + FOH) off ONE event ──
  console.log('\n3. Multiple BEOs per event (kitchen + FOH)');
  const beoF = await db.rpc('generate_beo', { p_org: A, p_quote_id: t2.quoteId, p_beo_type: 'foh', p_guest_guarantee: 250 });
  ok(!beoF.error && beoF.data.event_created === false && beoF.data.event_id === beoK.data.event_id, 'FOH BEO attaches to the SAME event (event_created false)');
  const beoCount = (await db.from('catering_beos').select('*', { count: 'exact', head: true }).eq('event_id', beoK.data.event_id)).count;
  ok(beoCount === 2, `2 BEOs (kitchen + foh) on one event (got ${beoCount})`);

  // ── 4. e-sign lifecycle + immutability ──
  console.log('\n4. E-sign lifecycle + immutability');
  await db.rpc('send_beo', { p_org: A, p_beo_id: beoK.data.beo_id });
  const signed = await db.rpc('sign_beo', { p_org: A, p_beo_id: beoK.data.beo_id, p_signed_by_name: 'Latha', p_signed_method: 'click' });
  const bk2 = await beoRow(beoK.data.beo_id);
  ok(!signed.error && bk2.status === 'signed' && bk2.signed_by_name === 'Latha' && !!bk2.signed_at, 'sign → status signed + signature recorded');
  const edit = await db.rpc('update_beo', { p_org: A, p_beo_id: beoK.data.beo_id, p_guest_guarantee: 999 });
  const bk3 = await beoRow(beoK.data.beo_id);
  ok(!!edit.error && /beo_signed_immutable|22023/.test(errcode(edit)) && bk3.guest_guarantee === 250, 'signed BEO rejects in-place edit (immutable; guarantee unchanged)');

  // ── 1 (same-event): if the Guest already has a Hall event, BEO attaches to it ──
  console.log('\n1b. Existing Hall event → BEO attaches to SAME Event');
  const t1 = await enquiryQuoteAccepted(A, 'Ramesh', `+9171${rid()}`, '2099-12-05', 200, [{ menu_item_id: pbm, unit_selling_price: 250 }]);
  const hallEv = (await db.from('events').insert({ org_id: A, guest_id: t1.guestId, event_date: '2099-12-05', status: 'planning', event_type: 'hall', guest_count: 200 }).select('id').single()).data;
  const beoH = await db.rpc('generate_beo', { p_org: A, p_quote_id: t1.quoteId, p_beo_type: 'kitchen', p_guest_guarantee: 180 });
  ok(!beoH.error && beoH.data.event_created === false && beoH.data.event_id === hallEv.id, 'catering BEO attached to the Guest\'s existing (hall) Event — one wedding, one Event');

  // ── 6. audit + org isolation ──
  console.log('\n6. Audit + tenant isolation');
  const genAudits = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'catering.beo_generate')).count;
  const signAudits = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'catering.beo_sign')).count;
  ok(genAudits === 3 && signAudits === 1, `audited: 3 generate + 1 sign (got ${genAudits}/${signAudits})`);
  for (const t of ['catering_beos', 'catering_beo_lines']) {
    const r = await userA.from(t).select('id').eq('org_id', B);
    ok(!r.error && r.data.length === 0, `A-member cannot read B.${t}`);
  }
  const cross = await userA.rpc('generate_beo', { p_org: B, p_quote_id: randomUUID(), p_beo_type: 'kitchen', p_guest_guarantee: 1 });
  ok(!!cross.error && /42501|forbidden/.test(errcode(cross)), 'A-member generate_beo in B → forbidden');
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('catering_beos').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
