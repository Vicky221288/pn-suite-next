#!/usr/bin/env node
/**
 * B2 TWO-TENANT ISOLATION HARNESS (the F-SEC-04 proof, OP MODEL §10).
 *
 * Stands up two orgs (A, B) with their own auth users + capabilities and proves,
 * in BOTH directions, zero cross-tenant read / write / confirm / delete — plus
 * capability enforcement and that B1's within-tenant guarantees still hold.
 * Uses real user-session clients (signed-in A/B/manager) so RLS + the RPC's
 * auth.uid() self-check are exercised exactly as in production. Self-cleaning;
 * exit-coded; re-runnable.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const OWNER_CAPS = ['booking.confirm', 'record.delete', 'pnl.view_margin', 'discount.approve'];
const MANAGER_CAPS = []; // hall_manager: operational-only, no elevated caps

let fails = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'OK ' : 'XX '} ${msg}`); if (!cond) fails++; };
const forbidden = (res) => !!res.error && (res.error.code === '42501' || /forbidden/.test(res.error.message ?? ''));
const slotTaken = (res) => !!res.error && (res.error.code === '23P01' || /slot_taken/.test(res.error.message ?? ''));

const created = { users: [], orgs: [] };

async function makeUser() {
  const email = `pn-b2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `Pn!${randomUUID()}Aa1`;
  const c = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (c.error) throw new Error('createUser: ' + c.error.message);
  created.users.push(c.data.user.id);
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await client.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error('signIn: ' + s.error.message);
  return { id: c.data.user.id, client };
}

async function setupOrg(name, caps, role) {
  const o = await admin.from('orgs').insert({ name }).select('id').single();
  if (o.error) throw new Error('orgs insert (B2 applied?): ' + o.error.message);
  const orgId = o.data.id;
  created.orgs.push(orgId);
  const h = await admin.from('halls').insert({ org_id: orgId, name: `${name} Hall` }).select('id').single();
  if (h.error) throw new Error('halls insert: ' + h.error.message);
  const user = await makeUser();
  const m = await admin.from('org_members').insert({ org_id: orgId, user_id: user.id, role, capabilities: caps });
  if (m.error) throw new Error('member insert: ' + m.error.message);
  return { orgId, hallId: h.data.id, user };
}

const confirmAs = (client, args) => client.rpc('confirm_booking', args);

async function main() {
  // ── setup: org A (owner), org B (owner), + a manager in A (no confirm cap) ──
  const A = await setupOrg('Tenant A', OWNER_CAPS, 'owner');
  const B = await setupOrg('Tenant B', OWNER_CAPS, 'owner');
  const mgr = await makeUser();
  await admin.from('org_members').insert({ org_id: A.orgId, user_id: mgr.id, role: 'hall_manager', capabilities: MANAGER_CAPS });

  // seed one booking in each org via the trusted system path (service_role)
  const seed = (org, hall, date) => confirmAs(admin, {
    p_org_id: org, p_hall_id: hall, p_event_date: date, p_slot: 'morning',
    p_hall_rent: 100000, p_customer_name: 'Seed', p_idempotency_key: `seed-${randomUUID()}`,
  });
  const sa = await seed(A.orgId, A.hallId, '2099-06-01');
  const sb = await seed(B.orgId, B.hallId, '2099-06-01');
  ok(!sa.error && !sb.error, 'seed: one booking created in each org (system path)');
  const bookingB_id = sb.data?.booking_id;

  // ── 1. RLS read isolation (both directions) ──
  console.log('\n1. RLS read isolation');
  const aHalls = await A.user.client.from('halls').select('id, org_id');
  const aSeesOnlyA = !aHalls.error && aHalls.data.every((r) => r.org_id === A.orgId) && aHalls.data.length === 1;
  ok(aSeesOnlyA, `A sees only its own halls (got ${aHalls.data?.length}, all org A: ${aHalls.data?.every((r) => r.org_id === A.orgId)})`);
  const aSeesBbooking = await A.user.client.from('bookings').select('id').eq('org_id', B.orgId);
  ok(!aSeesBbooking.error && aSeesBbooking.data.length === 0, "A cannot read B's bookings (RLS)");
  const aSeesBdeposits = await A.user.client.from('deposit_ledger').select('id').eq('org_id', B.orgId);
  ok(!aSeesBdeposits.error && aSeesBdeposits.data.length === 0, "A cannot read B's deposits (RLS)");
  const bHalls = await B.user.client.from('halls').select('id, org_id');
  ok(!bHalls.error && bHalls.data.length === 1 && bHalls.data[0].org_id === B.orgId, 'B sees only its own halls');
  const bSeesA = await B.user.client.from('bookings').select('id').eq('org_id', A.orgId);
  ok(!bSeesA.error && bSeesA.data.length === 0, "B cannot read A's bookings (RLS)");

  // ── 2. RPC confirm cross-org (authorization gate / F-SEC-04) ──
  console.log('\n2. Cross-tenant confirm blocked (RPC self-authorizes)');
  const aIntoB = await confirmAs(A.user.client, {
    p_org_id: B.orgId, p_hall_id: B.hallId, p_event_date: '2099-07-01', p_slot: 'morning',
    p_hall_rent: 50000, p_customer_name: 'Intruder', p_idempotency_key: `x-${randomUUID()}`,
  });
  ok(forbidden(aIntoB), "A confirming in B → forbidden");
  const bIntoA = await confirmAs(B.user.client, {
    p_org_id: A.orgId, p_hall_id: A.hallId, p_event_date: '2099-07-01', p_slot: 'morning',
    p_hall_rent: 50000, p_customer_name: 'Intruder', p_idempotency_key: `x-${randomUUID()}`,
  });
  ok(forbidden(bIntoA), "B confirming in A → forbidden");
  // nothing leaked into either org from the rejected attempts
  const bCount = await admin.from('bookings').select('*', { count: 'exact', head: true }).eq('org_id', B.orgId);
  ok(bCount.count === 1, "B still has exactly its 1 seeded booking (A's attempt wrote nothing)");

  // ── 3. Capability enforcement ──
  console.log('\n3. Capability enforcement');
  const mgrConfirm = await confirmAs(mgr.client, {
    p_org_id: A.orgId, p_hall_id: A.hallId, p_event_date: '2099-08-01', p_slot: 'evening',
    p_hall_rent: 50000, p_customer_name: 'Mgr', p_idempotency_key: `m-${randomUUID()}`,
  });
  ok(forbidden(mgrConfirm), 'manager in A WITHOUT booking.confirm → forbidden');
  const ownerConfirm = await confirmAs(A.user.client, {
    p_org_id: A.orgId, p_hall_id: A.hallId, p_event_date: '2099-08-01', p_slot: 'evening',
    p_hall_rent: 120000, p_customer_name: 'Owner', p_idempotency_key: `o-${randomUUID()}`,
  });
  ok(!ownerConfirm.error && ownerConfirm.data?.status === 'confirmed', 'owner in A WITH cap → confirm succeeds');

  // ── 4. No cross-org (or direct) authenticated writes ──
  console.log('\n4. Direct authenticated writes denied');
  await A.user.client.from('bookings').delete().eq('id', bookingB_id); // A tries to delete B's booking
  const bStill = await admin.from('bookings').select('id').eq('id', bookingB_id);
  ok(bStill.data?.length === 1, "A's delete of B's booking affected nothing (RLS)");
  await A.user.client.from('bookings').update({ customer_name: 'HACKED' }).eq('id', bookingB_id);
  const bRow = await admin.from('bookings').select('customer_name').eq('id', bookingB_id).single();
  ok(bRow.data?.customer_name !== 'HACKED', "A's update of B's booking did nothing (RLS)");

  // ── 5. B1 guarantees intact WITHIN a tenant (under RLS + auth) ──
  console.log('\n5. B1 guarantees intact within a tenant');
  const idem = `within-${randomUUID()}`;
  const c1 = await confirmAs(A.user.client, {
    p_org_id: A.orgId, p_hall_id: A.hallId, p_event_date: '2099-09-09', p_slot: 'full_day',
    p_hall_rent: 200000, p_customer_name: 'X', p_idempotency_key: idem,
  });
  const c2 = await confirmAs(A.user.client, {
    p_org_id: A.orgId, p_hall_id: A.hallId, p_event_date: '2099-09-09', p_slot: 'full_day',
    p_hall_rent: 200000, p_customer_name: 'X', p_idempotency_key: idem,
  });
  ok(!c1.error && c1.data?.idempotent === false && !c2.error && c2.data?.idempotent === true, 'idempotency holds within tenant');
  const dbl = await confirmAs(A.user.client, {
    p_org_id: A.orgId, p_hall_id: A.hallId, p_event_date: '2099-09-09', p_slot: 'morning',
    p_hall_rent: 50000, p_customer_name: 'Y', p_idempotency_key: `dbl-${randomUUID()}`,
  });
  ok(slotTaken(dbl), 'double-booking guard holds within tenant (full_day then morning → slot_taken)');
}

try {
  await main();
} catch (e) {
  console.error('  XX harness threw:', e.message);
  fails++;
} finally {
  for (const orgId of created.orgs) {
    await admin.from('orgs').delete().eq('id', orgId);     // cascades halls/bookings/blocks/deposits/members
    await admin.from('audit_log').delete().eq('org_id', orgId);
  }
  for (const uid of created.users) await admin.auth.admin.deleteUser(uid);
  // leftover check across both test orgs
  let left = 0;
  for (const orgId of created.orgs) {
    const b = await admin.from('bookings').select('*', { count: 'exact', head: true }).eq('org_id', orgId);
    const o = await admin.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId);
    left += (b.count ?? 0) + (o.count ?? 0);
  }
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' rows left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
