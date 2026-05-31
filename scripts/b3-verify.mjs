#!/usr/bin/env node
/**
 * B3 MESSAGING harness — proves the messaging foundation against the live DB
 * (mock adapter). Self-cleaning, re-runnable, exit-coded.
 *
 * Parts 1–2 (outbound + inbound) call the atomic RPCs directly via service_role
 * (the system path the automation engine uses). Part 3 (inbound webhook auth)
 * POSTs to the running dev route to exercise signature verification end-to-end;
 * it SKIPS (loudly, non-fatal) if the dev server / MESSAGING_WEBHOOK_SECRET are
 * absent — run it with: MESSAGING_WEBHOOK_SECRET=<x> next dev, then this script.
 */
import { readFileSync } from 'node:fs';
import { randomUUID, createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const WEBHOOK_SECRET = process.env.MESSAGING_WEBHOOK_SECRET || env.MESSAGING_WEBHOOK_SECRET || null;
const BASE = process.env.PN_BASE_URL || 'http://localhost:3000';

let fails = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'OK ' : 'XX '} ${msg}`); if (!cond) fails++; };
const errcode = (res) => res.error?.code ?? res.error?.message ?? '';
const rid = () => randomUUID().slice(0, 8);

let ORG;
const STAYS_NUM = `+9190000${rid()}`;
const HALL_NUM = `+9191111${rid()}`;
const out = (args) => db.rpc('enqueue_outbound', args);
const inb = (args) => db.rpc('ingest_inbound', args);

async function main() {
  const o = await db.from('orgs').insert({ name: 'B3 Test Org' }).select('id').single();
  if (o.error) { console.error('SETUP FAILED (B3 migration applied?):', o.error.message); process.exit(2); }
  ORG = o.data.id;
  const sStays = await db.from('message_senders').insert({ org_id: ORG, function_area: 'stays', display_name: 'PN Stays', phone_number: STAYS_NUM }).select('id').single();
  const sHall = await db.from('message_senders').insert({ org_id: ORG, function_area: 'hall_catering', display_name: 'PN Hall', phone_number: HALL_NUM }).select('id').single();
  if (sStays.error || sHall.error) { console.error('sender setup failed:', sStays.error?.message || sHall.error?.message); process.exit(2); }

  // ── 1. Outbound: multi-sender routing + quiet hours + idempotency ──
  console.log('\n1. Outbound pipeline (mock adapter via enqueue_outbound)');
  const day = '2099-01-01T04:30:00Z'; // 10:00 IST — sending window
  const night = '2099-01-01T16:30:00Z'; // 22:00 IST — quiet hours
  const rStays = await out({ p_org_id: ORG, p_function_area: 'stays', p_recipient: '+91999', p_template: 't', p_payload: {}, p_idempotency_key: `o-${rid()}`, p_now: day });
  const rHall = await out({ p_org_id: ORG, p_function_area: 'hall_catering', p_recipient: '+91999', p_template: 't', p_payload: {}, p_idempotency_key: `o-${rid()}`, p_now: day });
  ok(!rStays.error && rStays.data.sender_id === sStays.data.id && rStays.data.status === 'sent', 'Stays message → Stays sender, sent');
  ok(!rHall.error && rHall.data.sender_id === sHall.data.id && rHall.data.status === 'sent', 'Hall message → Hall sender, sent');
  ok(rStays.data.sender_id !== rHall.data.sender_id, 'the two function areas resolved to DIFFERENT senders (multi-sender)');

  const noSender = await out({ p_org_id: ORG, p_function_area: 'kitchen', p_recipient: '+91999', p_template: 't', p_payload: {}, p_idempotency_key: `o-${rid()}`, p_now: day });
  ok(!!noSender.error && /no_sender|P0002/.test(errcode(noSender)), 'area with no sender → no_sender error');

  const deferred = await out({ p_org_id: ORG, p_function_area: 'stays', p_recipient: '+91999', p_template: 't', p_payload: {}, p_idempotency_key: `o-${rid()}`, p_now: night });
  ok(!deferred.error && deferred.data.status === 'deferred' && !!deferred.data.scheduled_for, 'quiet-hours message DEFERRED (not sent) with scheduled_for set');

  const key = `idem-${rid()}`;
  const i1 = await out({ p_org_id: ORG, p_function_area: 'stays', p_recipient: '+91999', p_template: 't', p_payload: {}, p_idempotency_key: key, p_now: day });
  const i2 = await out({ p_org_id: ORG, p_function_area: 'stays', p_recipient: '+91999', p_template: 't', p_payload: {}, p_idempotency_key: key, p_now: day });
  ok(!i1.error && i1.data.idempotent === false && !i2.error && i2.data.idempotent === true && i1.data.id === i2.data.id, 'duplicate idempotency key → single send');
  const sentCount = await db.from('outbound_messages').select('*', { count: 'exact', head: true }).eq('org_id', ORG).eq('idempotency_key', key);
  ok(sentCount.count === 1, 'exactly 1 outbound row for the repeated key');

  // ── 2. Inbound: dedup/replay + lead create/match + unknown number (RPC) ──
  console.log('\n2. Inbound ingest (atomic, tenant-scoped, replay-safe)');
  const fromA = `+9170000${rid()}`;
  const msg1 = `mock-${randomUUID()}`;
  const r1 = await inb({ p_provider: 'mock', p_provider_message_id: msg1, p_to_phone: STAYS_NUM, p_from_phone: fromA, p_body: 'hi', p_raw: {} });
  ok(!r1.error && r1.data.created_lead === true && r1.data.function_area === 'stays' && r1.data.org_id === ORG, 'unknown number on Stays line → 1 new lead in org, area=stays');
  const replay = await inb({ p_provider: 'mock', p_provider_message_id: msg1, p_to_phone: STAYS_NUM, p_from_phone: fromA, p_body: 'hi', p_raw: {} });
  ok(!replay.error && replay.data.deduped === true && replay.data.lead_id === r1.data.lead_id, 'replayed message id → deduped, same lead (no dupe)');
  const msg2 = `mock-${randomUUID()}`;
  const r2 = await inb({ p_provider: 'mock', p_provider_message_id: msg2, p_to_phone: STAYS_NUM, p_from_phone: fromA, p_body: 'again', p_raw: {} });
  ok(!r2.error && r2.data.created_lead === false && r2.data.lead_id === r1.data.lead_id, 'second message from known number → matched existing lead (no 2nd lead)');
  const leadCount = await db.from('leads').select('*', { count: 'exact', head: true }).eq('org_id', ORG).eq('phone', fromA);
  ok(leadCount.count === 1, 'exactly 1 lead for that phone');
  const unknownNum = await inb({ p_provider: 'mock', p_provider_message_id: `mock-${randomUUID()}`, p_to_phone: '+91000NOPE', p_from_phone: fromA, p_body: 'x', p_raw: {} });
  ok(!!unknownNum.error && /unknown_sender_number|P0002/.test(errcode(unknownNum)), 'inbound on an unregistered number → unknown_sender_number');

  // ── 3. Inbound webhook AUTH over HTTP (needs dev server + secret) ──
  console.log('\n3. Inbound webhook signature auth (HTTP route)');
  if (!WEBHOOK_SECRET) { console.log('  -- SKIPPED: MESSAGING_WEBHOOK_SECRET not set (run dev with it to test auth)'); return; }
  let reachable = true;
  const url = `${BASE}/api/messaging/inbound`;
  const body = JSON.stringify({ id: `mock-${randomUUID()}`, from: `+9170000${rid()}`, to: STAYS_NUM, text: 'webhook hi' });
  const goodSig = createHmac('sha256', WEBHOOK_SECRET).update(body, 'utf8').digest('hex');
  try {
    const bad = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pn-signature': 'deadbeef' }, body });
    ok(bad.status === 401, `forged signature → 401 (got ${bad.status})`);
    const good = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pn-signature': goodSig }, body });
    const gj = await good.json();
    ok(good.status === 200 && gj.ok && gj.created_lead === true, `valid signature → 200 + lead created (got ${good.status})`);
    const replayHttp = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pn-signature': goodSig }, body });
    const rj = await replayHttp.json();
    ok(replayHttp.status === 200 && rj.deduped === true && rj.lead_id === gj.lead_id, 'replayed webhook (same id+sig) → deduped, same lead');
  } catch (e) {
    reachable = false;
    console.log(`  -- SKIPPED: dev server not reachable at ${BASE} (${e.message})`);
  }
  void reachable;
}

try {
  await main();
} catch (e) {
  console.error('  XX harness threw:', e.message);
  fails++;
} finally {
  if (ORG) {
    await db.from('orgs').delete().eq('id', ORG); // cascades senders/outbound/inbound/leads
    await db.from('audit_log').delete().eq('org_id', ORG);
    const left = (await db.from('leads').select('*', { count: 'exact', head: true }).eq('org_id', ORG)).count
      + (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', ORG)).count;
    console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test org' : 'XX — ' + left + ' rows left'}`);
    if (left !== 0) fails++;
  }
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
