#!/usr/bin/env node
/**
 * M3-auto harness — CRM recurring outreach (two B4 registry rules). Proves
 * against the live DB with INJECTED time (each rule takes p_now):
 *  REVIEW: a concluded event with no request → 1 review_request + 1 B3 enqueue;
 *    re-tick → 0 (per-event idempotent); a not-yet-concluded event → 0.
 *  SPECIAL-DATE: a date matching today (IST) → 1 B3 send; re-tick same day → 0
 *    (per-year idempotent); non-matching → 0; same date next year → 1; IST
 *    anchoring proven (a date that is "today" only under IST, not UTC, fires).
 *  QUIET-HOURS: a send in 21:00–07:00 IST is DEFERRED, then drains via drain_outbound.
 *  REGISTRY-DRIVEN: rules are wired into lib/automation/registry.ts; cron-route
 *    auth intact (no/wrong → 401, valid → 200) when exercised.
 *  PER-ENTITY SUBTXN ISOLATION: one bad recipient fails alone, others still send.
 *  Org isolation both directions; sends ONLY via B3; audited. Self-cleaning, ×2.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CRON_SECRET = process.env.CRON_SECRET || env.CRON_SECRET || null;
const BASE = process.env.PN_BASE_URL || 'http://localhost:3000';

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK ' : 'XX '} ${m}`); if (!c) fails++; };
const rid = () => randomUUID().slice(0, 8);
const created = { orgs: [] };

// Injected times. IST = UTC+5:30.
const DAY15 = '2099-06-15T06:00:00Z';      // 11:30 IST Jun 15 (daytime)
const NIGHT_PREVUTC = '2099-06-14T22:00:00Z'; // 03:30 IST Jun 15 (IST date = 15, UTC date = 14; quiet hours)
const DRAIN_MORN = '2099-06-15T02:00:00Z'; // 07:30 IST Jun 15 (after the 07:00 drain window)
const NEXTYEAR = '2100-06-15T06:00:00Z';   // 11:30 IST Jun 15, 2100

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP (M3-auto applied?):', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
const mkGuest = async (org, name) => (await db.from('guests').insert({ org_id: org, name, phone: `90${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}` }).select('id, phone').single()).data;
const mkSender = async (org, area) => { const r = await db.from('message_senders').insert({ org_id: org, function_area: area, display_name: `S-${rid()}`, phone_number: `+9199${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, provider: 'mock', active: true }); if (r.error) { console.error('SETUP sender:', r.error.message); process.exit(2); } };
const mkEvent = async (org, guest, date) => { const e = await db.from('events').insert({ org_id: org, event_date: date, status: 'planning', event_type: 'wedding', guest_id: guest }).select('id').single(); if (e.error) { console.error('SETUP event:', e.error.message); process.exit(2); } return e.data.id; };
async function mkTemplate(org, area, body, purpose) {
  const t = await db.from('message_templates').insert({ org_id: org, name: `T-${rid()}`, function_area: area, channel: 'whatsapp', body }).select('id').single();
  if (t.error) { console.error('SETUP template:', t.error.message); process.exit(2); }
  if (purpose) { const p = await db.rpc('set_template_purpose', { p_org: org, p_template_id: t.data.id, p_purpose: purpose }); if (p.error) { console.error('SETUP purpose:', p.error.message); process.exit(2); } }
  return t.data.id;
}
const mkSpecialDate = async (org, guest, type, theDate) => db.from('guest_special_dates').insert({ org_id: org, guest_id: guest, date_type: type, the_date: theDate });
const obByKey = async (org, key) => (await db.from('outbound_messages').select('status, recipient, function_area, scheduled_for').eq('org_id', org).eq('idempotency_key', key).maybeSingle()).data;
const obCount = async (org, key) => (await db.from('outbound_messages').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('idempotency_key', key)).count;
const auditCount = async (org, action, sub) => (await db.from('audit_log').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('action', action).eq('sub_event', sub)).count;
const reviewCount = async (org, guest, event) => (await db.from('review_requests').select('*', { count: 'exact', head: true }).eq('org_id', org).eq('guest_id', guest).eq('event_id', event)).count;
const skey = (type, guest, year) => `special:${type}:${guest}:${year}`;

async function main() {
  const A = await mkOrg('M3auto Org A'), B = await mkOrg('M3auto Org B');
  await mkSender(A, 'hall_catering'); await mkSender(B, 'hall_catering');
  // templates are matched by `purpose` inside the rules, so the returned ids aren't referenced here
  await mkTemplate(A, 'hall_catering', 'Hi {{guest}}, please review us.', 'review_request');
  await mkTemplate(A, 'hall_catering', 'Happy anniversary {{guest}}!', 'anniversary');
  await mkTemplate(A, 'ghost_area', 'Happy birthday {{guest}}!', 'birthday');  // function_area has NO sender → forced failure

  // ── 1. REVIEW: concluded event fires once; not-concluded → 0 ──
  console.log('\n1. Review-request outreach (concluded events)');
  const gr = await mkGuest(A, 'Anbu');
  const erConcluded = await mkEvent(A, gr.id, '2099-06-10');   // before Jun 15 → concluded
  const grF = await mkGuest(A, 'Future');
  const efFuture = await mkEvent(A, grF.id, '2099-12-31');     // after → not concluded
  const rev1 = await db.rpc('run_review_requests', { p_org: A, p_now: DAY15 });
  ok(!rev1.error && rev1.data >= 1, `review rule fired (count ${rev1.data})`);
  ok(await reviewCount(A, gr.id, erConcluded) === 1, 'exactly 1 review_request for the concluded event');
  ok(await reviewCount(A, grF.id, efFuture) === 0, 'not-yet-concluded event → 0 review requests');
  const rr = (await db.from('review_requests').select('outbound_message_id, status').eq('event_id', erConcluded).single()).data;
  ok(rr.status === 'sent' && !!rr.outbound_message_id, 'review record sent + linked to a B3 outbound message');
  const obRev = (await db.from('outbound_messages').select('recipient').eq('id', rr.outbound_message_id).single()).data;
  ok(obRev.recipient === gr.phone, 'review enqueued via B3 to the guest phone (right recipient)');
  const rev2 = await db.rpc('run_review_requests', { p_org: A, p_now: DAY15 });
  ok(rev2.data === 0 && await reviewCount(A, gr.id, erConcluded) === 1, 're-tick → 0 (per-event idempotent; still one record)');

  // ── 2. SPECIAL-DATE: match today (IST) fires once; re-tick 0; non-match 0 ──
  console.log('\n2. Special-date outreach (IST match, per-year idempotent)');
  const gs = await mkGuest(A, 'Bala');
  await mkSpecialDate(A, gs.id, 'anniversary', '2000-06-15');   // month/day = Jun 15
  const gsNo = await mkGuest(A, 'Chitra');
  await mkSpecialDate(A, gsNo.id, 'anniversary', '2000-03-03'); // never matches Jun 15
  const sp1 = await db.rpc('run_special_date_outreach', { p_org: A, p_now: DAY15 });
  ok(!sp1.error && sp1.data >= 1, `special-date rule fired (count ${sp1.data})`);
  const obGs = await obByKey(A, skey('anniversary', gs.id, '2099'));
  ok(obGs && obGs.status === 'sent' && obGs.recipient === gs.phone, 'matching guest → 1 B3 send (sent, right recipient)');
  ok(!(await obByKey(A, skey('anniversary', gsNo.id, '2099'))), 'non-matching date (Mar 3) → 0 sends');
  const sp2 = await db.rpc('run_special_date_outreach', { p_org: A, p_now: DAY15 });
  ok(sp2.data === 0 && await obCount(A, skey('anniversary', gs.id, '2099')) === 1, 're-tick same day → 0 (per-year idempotent; one queued row)');
  const spNext = await db.rpc('run_special_date_outreach', { p_org: A, p_now: NEXTYEAR });
  ok(spNext.data >= 1 && await obCount(A, skey('anniversary', gs.id, '2100')) === 1, 'same date NEXT YEAR → fires again (year-keyed)');

  // ── 3. IST anchoring + quiet-hours deferral + drain ──
  console.log('\n3. IST anchoring + quiet-hours deferral + drain');
  const gIst = await mkGuest(A, 'Deepa');
  await mkSpecialDate(A, gIst.id, 'anniversary', '2001-06-15');  // matches IST date Jun 15
  const gUtc = await mkGuest(A, 'Esha');
  await mkSpecialDate(A, gUtc.id, 'anniversary', '2001-06-14');  // = the UTC date of NIGHT_PREVUTC, NOT IST today
  const spIst = await db.rpc('run_special_date_outreach', { p_org: A, p_now: NIGHT_PREVUTC }); // UTC Jun 14 22:00 → IST Jun 15 03:30
  const obIst = await obByKey(A, skey('anniversary', gIst.id, '2099'));
  ok(obIst && obIst.status === 'deferred' && !!obIst.scheduled_for, 'IST-anchored: Jun-15 date fires under IST (not UTC Jun-14) → DEFERRED (quiet hours)');
  ok(!(await obByKey(A, skey('anniversary', gUtc.id, '2099'))), 'the UTC-date (Jun-14) special date does NOT fire (proves IST, not UTC)');
  ok(spIst.data >= 1, 'IST run produced a (deferred) send');
  await db.rpc('drain_outbound', { p_now: DRAIN_MORN, p_limit: 500 });
  ok((await obByKey(A, skey('anniversary', gIst.id, '2099'))).status === 'sent', 'deferred send DRAINS to sent after 07:00 IST (drain_outbound)');

  // ── 4. per-entity subtransaction isolation (one bad recipient) ──
  console.log('\n4. Per-entity subtransaction isolation');
  const gNew = await mkGuest(A, 'Farah');
  await mkSpecialDate(A, gNew.id, 'anniversary', '2002-06-15');     // good (anniversary → hall_catering sender)
  const gBad = await mkGuest(A, 'Ghost');
  await mkSpecialDate(A, gBad.id, 'birthday', '2002-06-15');        // bad (birthday → ghost_area, NO sender)
  const failBefore = await auditCount(A, 'rule.A_special.outreach', 'failed');
  const spIso = await db.rpc('run_special_date_outreach', { p_org: A, p_now: DAY15 });
  ok(!!(await obByKey(A, skey('anniversary', gNew.id, '2099'))), 'good recipient still SENT despite a sibling failure');
  ok(!(await obByKey(A, skey('birthday', gBad.id, '2099'))), 'bad recipient (no sender) produced NO outbound (atomic per-entity)');
  ok(await auditCount(A, 'rule.A_special.outreach', 'failed') > failBefore, 'the one bad entity logged a per-entity FAILED audit (batch survived)');
  ok(spIso.data >= 1, 'isolation run still counted the good send');

  // ── 5. registry-driven + cron-route auth ──
  console.log('\n5. Registry-driven + cron-route auth');
  const reg = readFileSync(new URL('../lib/automation/registry.ts', import.meta.url), 'utf8');
  ok(/run_review_requests/.test(reg) && /run_special_date_outreach/.test(reg), 'both rules are wired into the registry (run via the tick, not ad hoc)');
  ok(/A_review_requests/.test(reg) && /A_special_dates/.test(reg), 'registry keys present (A_review_requests, A_special_dates)');
  if (CRON_SECRET) {
    try {
      const noauth = await fetch(`${BASE}/api/cron/tick`);
      const wrong = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: 'Bearer wrong' } });
      const good = await fetch(`${BASE}/api/cron/tick`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
      ok(noauth.status === 401 && wrong.status === 401, 'cron route rejects missing/wrong secret (401)');
      ok(good.status === 200, 'cron route accepts the valid secret (200) — drives the registry tick incl. the new rules');
    } catch { console.log('  -- cron HTTP skipped (dev server not reachable)'); }
  } else { console.log('  -- cron HTTP skipped (CRON_SECRET not set)'); }

  // ── 6. org isolation (both directions) ──
  console.log('\n6. Tenant isolation (both directions)');
  await mkTemplate(B, 'hall_catering', 'Hi {{guest}}, review B.', 'review_request');
  const gB = await mkGuest(B, 'Bharath');
  const evB = await mkEvent(B, gB.id, '2099-06-10');
  // running A's rules must NOT touch B
  await db.rpc('run_review_requests', { p_org: A, p_now: DAY15 });
  ok(await reviewCount(B, gB.id, evB) === 0, 'A review run did NOT create a B review request');
  // running B's rule creates B's own
  const revB = await db.rpc('run_review_requests', { p_org: B, p_now: DAY15 });
  ok(revB.data >= 1 && await reviewCount(B, gB.id, evB) === 1, 'B review run creates B record (tenant-scoped)');

  // ── 7. audit ──
  console.log('\n7. Audit trail');
  const aRev = await auditCount(A, 'rule.A_review.outreach', 'completed');
  const aSpec = await auditCount(A, 'rule.A_special.outreach', 'completed');
  ok(aRev >= 1 && aSpec >= 1, `audited: review completed ${aRev}, special completed ${aSpec}`);
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count
    + (await db.from('review_requests').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('outbound_messages').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count
    + (await db.from('guest_special_dates').select('*', { count: 'exact', head: true }).eq('org_id', orgId)).count;
  console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test orgs' : 'XX — ' + left + ' left'}`);
  if (left !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
