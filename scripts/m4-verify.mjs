#!/usr/bin/env node
/**
 * M4 harness — DYNAMIC PRICING (selling price only). Proves: a rule adjusts the
 * selling price + breakdown lists which rules fired; stacking/priority is
 * DETERMINISTIC (same result ×N); conditions gate (date_range / day_of_week /
 * occupancy fire only in-condition); **THE GST FIREWALL** — a pricing-rule change
 * moves resolve_price but NOT the resolve_gst rate, and a specified_premises flip
 * moves resolve_gst but NOT resolve_price (independence both directions); resolve_price
 * returns a PRE-TAX figure with no rate/gst field; base_rate is never rewritten;
 * capability gate; org isolation both directions; atomicity (rejected write → zero
 * rows); audited. Self-cleaning, re-runnable, exit-coded.
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
const emsg = (r) => `${r.error?.code ?? ''} ${r.error?.message ?? ''} ${r.error?.details ?? ''}`;
const rid = () => randomUUID().slice(0, 8);
const created = { users: [], orgs: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (M4 applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId, capabilities = []) {
  const email = `pn-m4-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return { cl, id: c.data.user.id };
}
const mkRoomType = async (org, base) => (await db.from('room_types').insert({ org_id: org, name: `RT-${rid()}`, base_rate: base }).select('id, base_rate').single()).data;
const rule = (org, args, actor) => db.rpc('upsert_rate_rule', { p_org: org, p_actor_id: actor ?? null, ...args });
const price = (cl, org, subjId, base, date, occ) => cl.rpc('resolve_price', { p_org: org, p_subject_type: 'room_type', p_subject_id: subjId, p_base: base, p_date: date ?? null, p_occupancy_pct: occ ?? null });
const gstRate = async (org) => (await db.rpc('resolve_gst', { p_org: org, p_supply_type: 'rooms_fnb' })).data.rate;
const auditCount = async (org, action) => (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('action', action)).count;
const ruleCountByName = async (org, name) => (await db.from('rate_rules').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('name', name)).count;

async function main() {
  const A = await mkOrg('M4 Org A'), B = await mkOrg('M4 Org B');
  const mgr = await mkMember(A, ['pricing.manage']);
  const op = await mkMember(A, []);
  const bMgr = await mkMember(B, ['pricing.manage']);

  // ── 1 + 2. Rule applies + THE GST FIREWALL (both directions) ──
  console.log('\n1/2. Rule applies + GST FIREWALL (independence both directions)');
  const RT1 = await mkRoomType(A, 5000);
  const gst0 = await gstRate(A);
  const p0 = (await price(db, A, RT1.id, 5000)).data;
  ok(near(p0.effective_price, 5000) && p0.steps.length === 0, 'no rules → effective price = base (5000)');
  await rule(A, { p_name: `room20-${rid()}`, p_subject_type: 'room_type', p_subject_id: RT1.id, p_condition_type: 'always', p_adjustment_kind: 'percent', p_adjustment_value: 20, p_priority: 100 });
  const p1 = (await price(db, A, RT1.id, 5000)).data;
  ok(near(p1.effective_price, 6000) && p1.steps.filter((s) => s.fired).length === 1, 'a +20% rule applies → 6000; breakdown shows it fired');
  const gst1 = await gstRate(A);
  ok(near(gst0, 5) && near(gst1, 5) && near(p1.effective_price, 6000), 'DIRECTION 1: pricing rule changed price (5000→6000) but GST rate UNCHANGED (5→5)');
  // flip specified_premises → GST changes; price must NOT
  await db.from('orgs').update({ specified_premises: true }).eq('id', A);
  const gst2 = await gstRate(A);
  const p2 = (await price(db, A, RT1.id, 5000)).data;
  ok(near(gst2, 18) && near(p2.effective_price, 6000), 'DIRECTION 2: specified_premises flip changed GST (5→18) but resolve_price UNCHANGED (6000)');
  // resolve_price returns a PRE-TAX figure with no rate/gst/tax field
  const topKeys = Object.keys(p2), stepKeys = Object.keys(p2.steps[0] ?? {});
  const taxy = [...topKeys, ...stepKeys].filter((k) => /gst|tax|cgst|sgst|itc|supply/i.test(k));
  ok(taxy.length === 0, `resolve_price output has NO rate/gst/tax field (keys: ${topKeys.join(',')} | step: ${stepKeys.join(',')})`);
  await db.from('orgs').update({ specified_premises: false }).eq('id', A);

  // ── 3. base_rate untouched (parked question) ──
  console.log('\n3. base_rate untouched (resolve_price reads, never rewrites)');
  const baseAfter = (await db.from('room_types').select('base_rate').eq('id', RT1.id).single()).data.base_rate;
  ok(near(baseAfter, 5000) && near(p2.base, 5000), 'room_types.base_rate still 5000 after all pricing ops; resolve_price echoes base, never converts');

  // ── 4. stacking / priority deterministic + override precedence ──
  console.log('\n4. Deterministic stacking + override precedence');
  const RT2 = await mkRoomType(A, 5000);
  await rule(A, { p_name: `p10-${rid()}`, p_subject_type: 'room_type', p_subject_id: RT2.id, p_condition_type: 'always', p_adjustment_kind: 'percent', p_adjustment_value: 10, p_priority: 10 });
  await rule(A, { p_name: `p20-${rid()}`, p_subject_type: 'room_type', p_subject_id: RT2.id, p_condition_type: 'always', p_adjustment_kind: 'percent', p_adjustment_value: 20, p_priority: 20 });
  const s1 = (await price(db, A, RT2.id, 5000)).data, s2 = (await price(db, A, RT2.id, 5000)).data;
  ok(near(s1.effective_price, 6600) && near(s2.effective_price, 6600), 'two % rules stack (5000×1.10×1.20=6600), identical across runs (deterministic)');
  ok(s1.steps[0].priority === 10 && s1.steps[1].priority === 20, 'breakdown ordered by priority (10 before 20)');
  await rule(A, { p_name: `ovr-${rid()}`, p_subject_type: 'room_type', p_subject_id: RT2.id, p_condition_type: 'always', p_adjustment_kind: 'absolute', p_adjustment_value: 9999, p_priority: 5 });
  const so = (await price(db, A, RT2.id, 5000)).data;
  ok(near(so.effective_price, 9999) && so.overridden === true && so.steps.length === 1 && so.steps[0].kind === 'absolute', 'absolute override (priority 5) wins + is TERMINAL (percents skipped)');

  // ── 5. conditions gate (date_range / day_of_week / occupancy) ──
  console.log('\n5. Conditions gate in/out');
  const RTd = await mkRoomType(A, 1000);
  await rule(A, { p_name: `fest-${rid()}`, p_subject_type: 'room_type', p_subject_id: RTd.id, p_condition_type: 'date_range', p_adjustment_kind: 'percent', p_adjustment_value: 50, p_date_from: '2099-12-20', p_date_to: '2099-12-31', p_priority: 100 });
  ok(near((await price(db, A, RTd.id, 1000, '2099-12-25')).data.effective_price, 1500), 'date_range: in-range date → +50% (1500)');
  ok(near((await price(db, A, RTd.id, 1000, '2099-06-15')).data.effective_price, 1000), 'date_range: out-of-range date → base (1000)');
  const RTw = await mkRoomType(A, 1000);
  const sat = '2099-06-13', satDow = new Date(`${sat}T00:00:00Z`).getUTCDay();
  const other = '2099-06-15', otherDow = new Date(`${other}T00:00:00Z`).getUTCDay();
  await rule(A, { p_name: `wknd-${rid()}`, p_subject_type: 'room_type', p_subject_id: RTw.id, p_condition_type: 'day_of_week', p_adjustment_kind: 'percent', p_adjustment_value: 30, p_days_of_week: [satDow], p_priority: 100 });
  ok(near((await price(db, A, RTw.id, 1000, sat)).data.effective_price, 1300), `day_of_week: matching dow (${satDow}) → +30% (1300)`);
  ok(satDow !== otherDow && near((await price(db, A, RTw.id, 1000, other)).data.effective_price, 1000), `day_of_week: non-matching dow (${otherDow}) → base (1000)`);
  const RTo = await mkRoomType(A, 1000);
  await rule(A, { p_name: `occ-${rid()}`, p_subject_type: 'room_type', p_subject_id: RTo.id, p_condition_type: 'occupancy', p_adjustment_kind: 'percent', p_adjustment_value: 40, p_occupancy_min: 80, p_priority: 100 });
  ok(near((await price(db, A, RTo.id, 1000, null, 90)).data.effective_price, 1400), 'occupancy: ctx 90 ≥ 80 → +40% (1400)');
  ok(near((await price(db, A, RTo.id, 1000, null, 50)).data.effective_price, 1000), 'occupancy: ctx 50 < 80 → base (1000)');
  ok(near((await price(db, A, RTo.id, 1000, null, null)).data.effective_price, 1000), 'occupancy: no ctx → does not fire (1000)');

  // ── 6. capability gate ──
  console.log('\n6. Capability gate (pricing.manage)');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('upsert_rate_rule', { p_org: A, p_name: 'no', p_subject_type: 'room_type', p_condition_type: 'always', p_adjustment_kind: 'percent', p_adjustment_value: 5 }))), 'operative upsert_rate_rule → forbidden');
  ok(/forbidden|42501/.test(emsg(await op.cl.rpc('set_rate_rule_active', { p_org: A, p_rule_id: randomUUID(), p_active: false }))), 'operative set_rate_rule_active → forbidden');
  const RTmgr = await mkRoomType(A, 1000);
  ok(!(await mgr.cl.rpc('upsert_rate_rule', { p_org: A, p_name: `mgr-${rid()}`, p_subject_type: 'room_type', p_subject_id: RTmgr.id, p_condition_type: 'always', p_adjustment_kind: 'percent', p_adjustment_value: 5 })).error, 'manager upsert_rate_rule → allowed');
  // member-open read — self-contained: a FRESH subject + one known rule → expected price is correct by construction
  // (no cross-cutting / org-wide rule is in scope for this subject, so the value can't drift on earlier sections).
  const RTop = await mkRoomType(A, 2000);
  await rule(A, { p_name: `op-rule-${rid()}`, p_subject_type: 'room_type', p_subject_id: RTop.id, p_condition_type: 'always', p_adjustment_kind: 'percent', p_adjustment_value: 25, p_priority: 100 });
  const opPrice = await price(op.cl, A, RTop.id, 2000);
  ok(!opPrice.error && near(opPrice.data.effective_price, 2500), 'operative (no pricing.manage) CAN resolve_price (member-open) → correct rule-adjusted price (2000 +25% = 2500)');

  // ── 7. org isolation (both directions) ──
  console.log('\n7. Tenant isolation (both directions)');
  await rule(B, { p_name: 'b-rule', p_subject_type: 'room_type', p_condition_type: 'always', p_adjustment_kind: 'percent', p_adjustment_value: 5 });
  ok((await op.cl.from('rate_rules').select('id').eq('org_id', B)).data.length === 0, 'A-member cannot read B.rate_rules');
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('upsert_rate_rule', { p_org: B, p_name: 'x', p_subject_type: 'room_type', p_condition_type: 'always', p_adjustment_kind: 'percent', p_adjustment_value: 5 }))), 'A-manager upsert in B → forbidden');
  ok(/forbidden|42501/.test(emsg(await mgr.cl.rpc('resolve_price', { p_org: B, p_subject_type: 'room_type', p_subject_id: null, p_base: 100 }))), 'A-member resolve_price in B → forbidden');
  ok((await bMgr.cl.from('rate_rules').select('id').eq('org_id', A)).data.length === 0, 'B-member cannot read A.rate_rules');

  // ── 8. atomicity: forced mid-tx failure → zero partial rows ──
  console.log('\n8. Atomicity on forced mid-tx failure');
  const badName = `bad-${rid()}`;
  const bad = await mgr.cl.rpc('upsert_rate_rule', { p_org: A, p_name: badName, p_subject_type: 'room_type', p_condition_type: 'always', p_adjustment_kind: 'absolute', p_adjustment_value: -100 });
  ok(!!bad.error, 'negative absolute rejected (CHECK fires)');
  ok(await ruleCountByName(A, badName) === 0, 'atomicity: rejected rule persisted 0 rows (no partial write, no audit)');

  // ── 9. audit ──
  console.log('\n9. Audit trail');
  const aUp = await auditCount(A, 'pricing.rule_upsert');
  ok(aUp >= 6, `audited: pricing.rule_upsert ${aUp}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('rate_rules').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('room_types').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
