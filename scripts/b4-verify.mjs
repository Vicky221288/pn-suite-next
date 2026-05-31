#!/usr/bin/env node
/**
 * B4 SCHEDULER / AUTOMATION harness — proves the rule engine against the live DB
 * with INJECTED time (each rule RPC takes p_now), so the 2h SLA, T-50/47/45
 * reminders, quiet-hours deferral, queue drain, and 07:00 Today build are all
 * deterministic. Part 6 hits the secured cron route over HTTP (auth only).
 * Self-cleaning, re-runnable, exit-coded.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CRON_SECRET = process.env.CRON_SECRET || env.CRON_SECRET || null;
const BASE = process.env.PN_BASE_URL || 'http://localhost:3000';

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK ' : 'XX '} ${m}`); if (!c) fails++; };
const rid = () => randomUUID().slice(0, 8);

const H = 3600e3;
const baseNow = new Date('2099-06-15T05:00:00Z'); // 10:30 IST (daytime)
const night = new Date('2099-06-15T17:00:00Z');   // 22:30 IST (quiet)
const morning = new Date('2099-06-16T02:00:00Z'); // 07:30 IST next day
const iso = (d) => d.toISOString();
const baseDate = '2099-06-15';
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

let ORG, STAYS_MGR;
const STAYS_NUM = `+9190${rid()}`, HALL_NUM = `+9191${rid()}`;
const obByKey = async (key) => (await db.from('outbound_messages').select('status,scheduled_for').eq('org_id', ORG).eq('idempotency_key', key).maybeSingle()).data;

async function mkBooking(eventDate, { confirmed = true, phone = `+9180${rid()}` } = {}) {
  const r = await db.from('bookings').insert({
    org_id: ORG, hall_id: HALL_ID, event_date: eventDate, slot: 'full_day',
    status: confirmed ? 'confirmed' : 'tentative_hold', hall_rent: 200000,
    customer_name: 'Cust', customer_phone: phone, idempotency_key: `bk-${randomUUID()}`,
  }).select('id').single();
  if (r.error) throw new Error('booking insert: ' + r.error.message);
  return r.data.id;
}
async function mkLead(area, { ageHours = 0, followedUp = false } = {}) {
  const r = await db.from('leads').insert({ org_id: ORG, function_area: area, phone: `+9170${rid()}`, status: 'new' }).select('id').single();
  if (r.error) throw new Error('lead insert: ' + r.error.message);
  await db.from('leads').update({
    created_at: iso(new Date(baseNow.getTime() - ageHours * H)),
    last_follow_up_at: followedUp ? iso(new Date(baseNow.getTime() - 1 * H)) : null,
  }).eq('id', r.data.id);
  return r.data.id;
}

let HALL_ID;
async function main() {
  ORG = (await db.from('orgs').insert({ name: 'B4 Test Org' }).select('id').single()).data?.id;
  if (!ORG) { console.error('SETUP FAILED (B4 migration applied?)'); process.exit(2); }
  STAYS_MGR = `+9199${rid()}`;
  const s1 = await db.from('message_senders').insert({ org_id: ORG, function_area: 'stays', display_name: 'Stays', phone_number: STAYS_NUM, manager_phone: STAYS_MGR }).select('id').single();
  await db.from('message_senders').insert({ org_id: ORG, function_area: 'hall_catering', display_name: 'Hall', phone_number: HALL_NUM, manager_phone: `+9198${rid()}` });
  if (s1.error) { console.error('sender setup failed:', s1.error.message); process.exit(2); }
  HALL_ID = (await db.from('halls').insert({ org_id: ORG, name: 'Hall' }).select('id').single()).data.id;

  // ── 1. A2 — SLA escalation (F-AUTO-01) ──
  console.log('\n1. SLA escalation (A2 — F-AUTO-01)');
  const leadOverdue = await mkLead('stays', { ageHours: 3 });           // 3h old, no follow-up → overdue
  const leadFollowed = await mkLead('stays', { ageHours: 3, followedUp: true }); // has follow-up → not overdue
  const leadRecent = await mkLead('stays', { ageHours: 0.5 });          // 30m old → not overdue
  const esc1 = await db.rpc('run_sla_escalations', { p_org: ORG, p_now: iso(baseNow) });
  ok(!esc1.error && esc1.data === 1, `exactly 1 escalation (got ${esc1.data})`);
  const lo = await db.from('leads').select('escalated_at').eq('id', leadOverdue).single();
  ok(!!lo.data?.escalated_at, 'overdue lead flagged escalated_at');
  const lf = await db.from('leads').select('escalated_at').eq('id', leadFollowed).single();
  const lr = await db.from('leads').select('escalated_at').eq('id', leadRecent).single();
  ok(!lf.data?.escalated_at && !lr.data?.escalated_at, 'followed-up + recent leads NOT escalated');
  ok(!!(await obByKey(`sla-escalate:${leadOverdue}`)), 'manager notified via B3 (outbound to Stays manager)');
  const esc2 = await db.rpc('run_sla_escalations', { p_org: ORG, p_now: iso(baseNow) });
  ok(!esc2.error && esc2.data === 0, 'second identical tick → 0 (idempotent / catch-up-safe)');

  // ── 2. A5 — rent reminders T-50/47/45 (daytime → sent) ──
  console.log('\n2. Rent reminders (A5) at T-50/47/45');
  const b50 = await mkBooking(addDays(baseDate, 50));
  const b47 = await mkBooking(addDays(baseDate, 47));
  const b45 = await mkBooking(addDays(baseDate, 45));
  const b30 = await mkBooking(addDays(baseDate, 30)); // not a milestone
  const rr1 = await db.rpc('run_rent_reminders', { p_org: ORG, p_now: iso(baseNow) });
  ok(!rr1.error && rr1.data === 3, `3 reminders fired (T-50/47/45), got ${rr1.data}`);
  ok((await obByKey(`rent-reminder:T50:${b50}`))?.status === 'sent', 'T-50 reminder sent (daytime)');
  ok((await obByKey(`rent-reminder:T47:${b47}`))?.status === 'sent', 'T-47 reminder sent');
  ok((await obByKey(`rent-reminder:T45:${b45}`))?.status === 'sent', 'T-45 reminder sent');
  ok(!(await obByKey(`rent-reminder:T30:${b30}`)), 'T-30 (not a milestone) → no reminder');
  const rr2 = await db.rpc('run_rent_reminders', { p_org: ORG, p_now: iso(baseNow) });
  // second run re-enqueues but all are idempotent hits → no NEW outbound rows
  const obCount = await db.from('outbound_messages').select('*', { count: 'exact', head: true }).eq('org_id', ORG).like('idempotency_key', 'rent-reminder:%');
  ok(!rr2.error && obCount.count === 3, 'second run → still exactly 3 reminder rows (idempotent)');

  // ── 3. Quiet hours: a reminder fired at night DEFERS, not sends ──
  console.log('\n3. Quiet-hours deferral');
  const bNight = await mkBooking(addDays(baseDate, 50));
  await db.rpc('run_rent_reminders', { p_org: ORG, p_now: iso(night) });
  const nightRow = await obByKey(`rent-reminder:T50:${bNight}`);
  ok(nightRow?.status === 'deferred' && !!nightRow?.scheduled_for, 'reminder fired at 22:30 IST → DEFERRED with scheduled_for');

  // ── 4. Drain the deferred queue: only after 07:00 IST ──
  console.log('\n4. Deferred-queue drain');
  const drainNight = await db.rpc('drain_outbound', { p_now: iso(night), p_limit: 500 });
  ok(!drainNight.error && (await obByKey(`rent-reminder:T50:${bNight}`))?.status === 'deferred', 'drain at 22:30 IST → still deferred (not before 07:00)');
  const drainMorning = await db.rpc('drain_outbound', { p_now: iso(morning), p_limit: 500 });
  ok(!drainMorning.error && (await obByKey(`rent-reminder:T50:${bNight}`))?.status === 'sent', 'drain at 07:30 IST → sent (queue drained after quiet hours)');

  // ── 5. A10 — daily Today builder (role-aware) ──
  console.log('\n5. Today builder (A10)');
  await mkBooking(baseDate); // an event today
  const bt = await db.rpc('build_today', { p_org: ORG, p_now: iso(baseNow) });
  ok(!bt.error && bt.data === 4, `built 4 role snapshots (got ${bt.data})`);
  const owner = (await db.from('today_snapshots').select('payload').eq('org_id', ORG).eq('role', 'owner').eq('snapshot_date', baseDate).single()).data;
  const mgr = (await db.from('today_snapshots').select('payload').eq('org_id', ORG).eq('role', 'hall_manager').eq('snapshot_date', baseDate).single()).data;
  ok(owner?.payload?.exceptions === 1, `owner Today: exceptions=1 (escalated lead) (got ${owner?.payload?.exceptions})`);
  ok(owner?.payload?.events_today >= 1, 'owner Today: events_today >= 1');
  ok('money_to_collect' in (owner?.payload ?? {}), 'owner Today INCLUDES money_to_collect');
  ok(!('money_to_collect' in (mgr?.payload ?? {})), 'manager Today OMITS money (operational-only, §12 #3)');
  const bt2 = await db.rpc('build_today', { p_org: ORG, p_now: iso(baseNow) });
  const snapCount = await db.from('today_snapshots').select('*', { count: 'exact', head: true }).eq('org_id', ORG).eq('snapshot_date', baseDate);
  ok(!bt2.error && snapCount.count === 4, 'rebuild idempotent (still 4 snapshots, upserted)');

  // ── 6. Cron route auth (HTTP; needs dev server + CRON_SECRET) ──
  console.log('\n6. Cron route authentication (HTTP)');
  if (!CRON_SECRET) { console.log('  -- SKIPPED: CRON_SECRET not set'); return; }
  try {
    const noauth = await fetch(`${BASE}/api/cron/tick`);
    ok(noauth.status === 401, `no secret → 401 (got ${noauth.status})`);
    const wrong = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: 'Bearer wrong' } });
    ok(wrong.status === 401, `wrong secret → 401 (got ${wrong.status})`);
    const good = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    const gj = await good.json().catch(() => ({}));
    ok(good.status === 200 && gj.ok === true, `valid secret → 200 + tick ran (got ${good.status})`);
  } catch (e) {
    console.log(`  -- SKIPPED: dev server not reachable at ${BASE} (${e.message})`);
  }
}

try {
  await main();
} catch (e) {
  console.error('  XX harness threw:', e.message);
  fails++;
} finally {
  if (ORG) {
    await db.from('orgs').delete().eq('id', ORG); // cascades leads/bookings/senders/outbound/today_snapshots
    await db.from('audit_log').delete().eq('org_id', ORG);
    const left = (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', ORG)).count
      + (await db.from('leads').select('*', { count: 'exact', head: true }).eq('org_id', ORG)).count;
    console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test org' : 'XX — ' + left + ' rows left'}`);
    if (left !== 0) fails++;
  }
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
