#!/usr/bin/env node
/**
 * W0 SHARED-CORE harness — proves the four shared-core entities against the live
 * DB: Guest find-or-create + family-distinctness + atomic merge, atomic inventory
 * movement, tagged ledger write, and org-scoping (no cross-tenant leakage) on all
 * four. Self-cleaning, re-runnable, exit-coded. Uses its own throwaway orgs — does
 * NOT touch the real seeded PN tenant.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK ' : 'XX '} ${m}`); if (!c) fails++; };
const errcode = (r) => r.error?.code ?? r.error?.message ?? '';
const rid = () => randomUUID().slice(0, 8);
const created = { users: [], orgs: [] };

async function mkOrg(name) { const o = await db.from('orgs').insert({ name }).select('id').single(); if (o.error) { console.error('SETUP (W0 migration applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId) {
  const email = `pn-w0-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (c.error) throw new Error('createUser: ' + c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities: ['booking.confirm'] });
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await client.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error('signIn: ' + s.error.message);
  return client;
}

async function main() {
  const A = await mkOrg('W0 Org A'), B = await mkOrg('W0 Org B');
  const userA = await mkMember(A);

  // ── 1. Guest find-or-create idempotent by (org, phone, name) ──
  console.log('\n1. Guest find-or-create (idempotent by phone+name)');
  const phone = `+9170${rid()}`;
  const g1 = await db.rpc('find_or_create_guest', { p_org: A, p_phone: phone, p_name: 'Ramesh' });
  const g1b = await db.rpc('find_or_create_guest', { p_org: A, p_phone: phone, p_name: 'Ramesh' });
  ok(!g1.error && g1.data.created === true, 'first call creates Ramesh');
  ok(!g1b.error && g1b.data.created === false && g1b.data.guest_id === g1.data.guest_id, 'repeat (same phone+name) → SAME guest, not created');

  // ── 2. Two names on ONE phone stay distinct (family, not fused) ──
  console.log('\n2. Two names, one phone → distinct guests');
  const g2 = await db.rpc('find_or_create_guest', { p_org: A, p_phone: phone, p_name: 'Suresh' });
  ok(!g2.error && g2.data.created === true && g2.data.guest_id !== g1.data.guest_id, 'same phone + different name → DISTINCT new guest');
  const activeOnPhone = (await db.from('guests').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('phone', phone).eq('status', 'active')).count;
  ok(activeOnPhone === 2, `2 active guests share the phone (got ${activeOnPhone})`);

  // ── 3. Merge is atomic + audited ──
  console.log('\n3. Merge (atomic + audited)');
  const mg = await db.rpc('merge_guests', { p_org: A, p_keep_id: g1.data.guest_id, p_merge_id: g2.data.guest_id });
  ok(!mg.error && mg.data.kept === g1.data.guest_id, 'merge returns kept id');
  const merged = (await db.from('guests').select('status, merged_into_id').eq('id', g2.data.guest_id).single()).data;
  ok(merged?.status === 'merged' && merged?.merged_into_id === g1.data.guest_id, 'merged guest → status merged, points to keeper');
  ok((await db.from('guests').select('status').eq('id', g1.data.guest_id).single()).data?.status === 'active', 'keeper stays active');
  const mAudit = (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', A).eq('action', 'guest.merge')).count;
  ok(mAudit === 1, 'merge wrote exactly 1 audit row');
  const reSuresh = await db.rpc('find_or_create_guest', { p_org: A, p_phone: phone, p_name: 'Suresh' });
  ok(!reSuresh.error && reSuresh.data.created === true && reSuresh.data.guest_id !== g2.data.guest_id, 'merged row does NOT block re-creating that name (dedup is on active only)');

  // ── 4. Inventory stock movement (atomic; out cannot go negative) ──
  console.log('\n4. Inventory stock movement (atomic)');
  const item = (await db.from('inventory_items').insert({ org_id: A, name: `Paneer-${rid()}`, unit: 'kg', cost: 320 }).select('id').single()).data;
  const inMv = await db.rpc('record_stock_movement', { p_org: A, p_item_id: item.id, p_direction: 'in', p_quantity: 100 });
  ok(!inMv.error && Number(inMv.data.new_on_hand) === 100, 'in 100 → on_hand 100');
  const outMv = await db.rpc('record_stock_movement', { p_org: A, p_item_id: item.id, p_direction: 'out', p_quantity: 30 });
  ok(!outMv.error && Number(outMv.data.new_on_hand) === 70, 'out 30 → on_hand 70');
  const adjMv = await db.rpc('record_stock_movement', { p_org: A, p_item_id: item.id, p_direction: 'adjust', p_quantity: 50 });
  ok(!adjMv.error && Number(adjMv.data.new_on_hand) === 50, 'adjust → on_hand 50');
  const overdraw = await db.rpc('record_stock_movement', { p_org: A, p_item_id: item.id, p_direction: 'out', p_quantity: 999 });
  const onHandNow = Number((await db.from('inventory_items').select('quantity_on_hand').eq('id', item.id).single()).data?.quantity_on_hand);
  ok(!!overdraw.error && /insufficient_stock|23514/.test(errcode(overdraw)) && onHandNow === 50, 'over-draw rejected; on_hand unchanged (atomic)');

  // ── 5. Ledger write (atomic + supply-type tagged) ──
  console.log('\n5. Ledger write (one ledger, tagged streams)');
  const led = await db.rpc('write_ledger', { p_org: A, p_supply_type: 'catering', p_amount: 50000, p_direction: 'credit', p_source_domain: 'catering', p_description: 'test' });
  ok(!led.error && !!led.data.ledger_id, 'ledger entry written');
  const row = (await db.from('finance_ledger').select('supply_type, source_domain, direction, amount').eq('id', led.data.ledger_id).single()).data;
  ok(row?.supply_type === 'catering' && row?.source_domain === 'catering' && row?.direction === 'credit' && Number(row?.amount) === 50000, 'entry correctly tagged (supply_type + domain + direction)');
  const badLed = await db.rpc('write_ledger', { p_org: A, p_supply_type: 'x', p_amount: 1, p_direction: 'sideways', p_source_domain: 'core' });
  ok(!!badLed.error, 'bad direction rejected');

  // ── 6. Staff create ──
  console.log('\n6. Staff (profile; capabilities live in org_members)');
  const st = await db.rpc('create_staff', { p_org: A, p_name: 'Kitchen Helper', p_role: 'kitchen' });
  ok(!st.error && !!st.data.staff_id, 'staff profile created');

  // ── 7. Org-scoping: no cross-tenant read or write, all four entities ──
  console.log('\n7. Tenant isolation (no cross-tenant leak)');
  // seed one row of each in org B (system path)
  await db.rpc('find_or_create_guest', { p_org: B, p_phone: `+9171${rid()}`, p_name: 'B Guest' });
  const bItem = (await db.from('inventory_items').insert({ org_id: B, name: `B-item-${rid()}`, unit: 'kg' }).select('id').single()).data;
  await db.rpc('write_ledger', { p_org: B, p_supply_type: 'room', p_amount: 1, p_direction: 'credit', p_source_domain: 'stays' });
  await db.rpc('create_staff', { p_org: B, p_name: 'B Staff', p_role: 'operative' });
  // userA (member of A only) must see none of B's rows (RLS) ...
  for (const t of ['guests', 'inventory_items', 'finance_ledger', 'staff']) {
    const r = await userA.from(t).select('id').eq('org_id', B);
    ok(!r.error && r.data.length === 0, `A-member cannot read B.${t} (RLS)`);
  }
  // ... and cannot write into B via the RPC (self-auth)
  const crossWrite = await userA.rpc('find_or_create_guest', { p_org: B, p_phone: `+9172${rid()}`, p_name: 'Intruder' });
  ok(!!crossWrite.error && /42501|forbidden/.test(errcode(crossWrite)), 'A-member find_or_create in B → forbidden');
  const crossStock = await userA.rpc('record_stock_movement', { p_org: B, p_item_id: bItem.id, p_direction: 'in', p_quantity: 5 });
  ok(!!crossStock.error && /42501|forbidden/.test(errcode(crossStock)), 'A-member stock-movement in B → forbidden');
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('guests').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
