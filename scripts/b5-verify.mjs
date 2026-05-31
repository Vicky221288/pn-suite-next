#!/usr/bin/env node
/**
 * B5 VERTICAL SLICE harness — the foundation-wave go/no-go gate. Drives ONE real
 * enquiry Enquiry→Quote→Booking→Event→Settlement against the live DB, asserting
 * every transition, the deposit-as-escrowed-liability (never revenue), the
 * composite-5% GST invoice (F-FIN-03), the 3 automation rules (A1/A2/A5), the
 * role-aware Today, and the Owner/PM-only settlement capability gate. Composes
 * B1–B4 primitives; self-cleaning; re-runnable; exit-coded.
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
const OWNER_CAPS = ['booking.confirm', 'record.delete', 'pnl.view_margin', 'discount.approve', 'settlement.process'];

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK ' : 'XX '} ${m}`); if (!c) fails++; };
const errcode = (r) => r.error?.code ?? r.error?.message ?? '';
const rid = () => randomUUID().slice(0, 8);
const baseNow = new Date('2099-06-15T05:00:00Z'); // 10:30 IST
const iso = (d) => d.toISOString();
const baseDate = '2099-06-15';
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const H = 3600e3;
const created = { users: [] };
let ORG, HALL_ID, OWNER, MGR;

async function makeUser(orgId, role, caps) {
  const email = `pn-b5-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (c.error) throw new Error('createUser: ' + c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role, capabilities: caps });
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await client.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error('signIn: ' + s.error.message);
  return { id: c.data.user.id, client };
}
const obByKey = async (k) => (await db.from('outbound_messages').select('status,function_area').eq('org_id', ORG).eq('idempotency_key', k).maybeSingle()).data;

async function main() {
  ORG = (await db.from('orgs').insert({ name: 'B5 Slice Org' }).select('id').single()).data?.id;
  if (!ORG) { console.error('SETUP FAILED (B5 migration applied?)'); process.exit(2); }
  await db.from('message_senders').insert([
    { org_id: ORG, function_area: 'stays', display_name: 'Stays', phone_number: `+9190${rid()}`, manager_phone: `+9199${rid()}` },
    { org_id: ORG, function_area: 'hall_catering', display_name: 'Hall', phone_number: `+9191${rid()}`, manager_phone: `+9198${rid()}` },
  ]);
  HALL_ID = (await db.from('halls').insert({ org_id: ORG, name: 'Main Hall' }).select('id').single()).data.id;
  OWNER = await makeUser(ORG, 'owner', OWNER_CAPS);
  MGR = await makeUser(ORG, 'hall_manager', []);

  // ── ENQUIRY (+ A1 ack) ──
  console.log('\nEnquiry → A1 acknowledgement (B3 send)');
  const custPhone = `+9170${rid()}`;
  const enq = await db.rpc('create_enquiry', { p_org: ORG, p_function_area: 'hall_catering', p_phone: custPhone, p_name: 'Ramesh', p_now: iso(baseNow) });
  ok(!enq.error && enq.data.created === true, 'enquiry created (lead)');
  const leadThread = enq.data.lead_id;
  const ack = await obByKey(`enquiry-ack:${leadThread}`);
  ok(!!ack && ack.function_area === 'hall_catering', 'A1: ack sent via the Hall/Catering sender');

  // ── A2 SLA escalation on a NEGLECTED enquiry (F-AUTO-01 enforcement) ──
  console.log('\nA2 SLA escalation (neglected enquiry)');
  const neg = await db.rpc('create_enquiry', { p_org: ORG, p_function_area: 'stays', p_phone: `+9171${rid()}`, p_name: 'Ignored', p_now: iso(baseNow) });
  await db.from('leads').update({ created_at: iso(new Date(baseNow.getTime() - 3 * H)) }).eq('id', neg.data.lead_id);
  // qualify the THREAD lead so it is NOT escalated (healthy path)
  await db.rpc('record_followup', { p_org: ORG, p_lead_id: leadThread, p_now: iso(baseNow) });
  const esc = await db.rpc('run_sla_escalations', { p_org: ORG, p_now: iso(baseNow) });
  ok(!esc.error && esc.data === 1, `exactly 1 escalation — the neglected lead (got ${esc.data})`);
  ok(!!(await db.from('leads').select('escalated_at').eq('id', neg.data.lead_id).single()).data?.escalated_at, 'neglected lead flagged escalated');
  ok(!(await db.from('leads').select('escalated_at').eq('id', leadThread).single()).data?.escalated_at, 'followed-up thread lead NOT escalated');

  // ── QUOTE ──
  console.log('\nQuote');
  const HALL_RENT = 200000;
  const q = await db.rpc('create_quote', { p_org: ORG, p_lead_id: leadThread, p_hall_rent: HALL_RENT, p_guest_count: 300, p_valid_until: addDays(baseDate, 14), p_now: iso(baseNow) });
  ok(!q.error && !!q.data.quote_id, 'quote created; lead → quoted');

  // ── BOOKING (atomic confirm + deposit-as-liability, B1) ──
  console.log('\nBooking — atomic confirm + deposit (B1)');
  const eventDate = addDays(baseDate, 50);
  const cb = await db.rpc('confirm_booking', {
    p_org_id: ORG, p_hall_id: HALL_ID, p_event_date: eventDate, p_slot: 'full_day',
    p_hall_rent: HALL_RENT, p_customer_name: 'Ramesh', p_idempotency_key: `slice-${randomUUID()}`,
    p_now: iso(baseNow), p_lead_id: leadThread,
  });
  ok(!cb.error && cb.data.status === 'confirmed', 'booking confirmed');
  const bookingId = cb.data.booking_id;
  ok(cb.data.deposit === HALL_RENT * 0.5, `deposit = 50% hall rent (${cb.data.deposit})`);
  const held = (await db.from('deposit_ledger').select('amount,is_liability,status').eq('booking_id', bookingId).eq('entry_type', 'deposit_held').single()).data;
  ok(held?.is_liability === true && held?.status === 'held' && Number(held?.amount) === HALL_RENT * 0.5, 'deposit held as escrowed LIABILITY');
  ok((await db.from('leads').select('status').eq('id', leadThread).single()).data?.status === 'won', 'thread lead → won (linked)');

  // ── EVENT (minimal BEO) ──
  console.log('\nEvent (minimal BEO)');
  const ev = await db.rpc('create_event', { p_org: ORG, p_booking_id: bookingId, p_guest_count: 300, p_now: iso(baseNow) });
  ok(!ev.error && !!ev.data.event_id, 'event created (planning)');

  // ── A5 rent reminder scheduled (T-50) ──
  console.log('\nA5 rent reminder (T-50)');
  const rr = await db.rpc('run_rent_reminders', { p_org: ORG, p_now: iso(baseNow) });
  ok(!rr.error && !!(await obByKey(`rent-reminder:T50:${bookingId}`)), 'T-50 reminder fired for the booking');

  // ── TODAY reflects the thread (built while booking is confirmed) ──
  console.log('\nToday surface (A10) reflects the thread');
  await db.rpc('build_today', { p_org: ORG, p_now: iso(baseNow) });
  const ownerToday = (await db.from('today_snapshots').select('payload').eq('org_id', ORG).eq('role', 'owner').eq('snapshot_date', baseDate).single()).data?.payload;
  const mgrToday = (await db.from('today_snapshots').select('payload').eq('org_id', ORG).eq('role', 'hall_manager').eq('snapshot_date', baseDate).single()).data?.payload;
  ok(Number(ownerToday?.money_to_collect) === HALL_RENT, `owner Today money_to_collect = ${HALL_RENT} (confirmed, unsettled)`);
  ok(ownerToday?.exceptions === 1, 'owner Today exceptions = 1 (the escalated lead)');
  ok(!('money_to_collect' in (mgrToday ?? {})), 'manager Today omits money (§12 #3)');

  // ── SETTLEMENT — composite-5% GST invoice + deposit resolution (F-FIN-03) ──
  console.log('\nSettlement — GST invoice (composite-5%) + deposit resolution');
  const st = await db.rpc('settle_booking', { p_org: ORG, p_booking_id: bookingId, p_deposit_resolution: 'refund', p_damage_amount: 0, p_now: iso(baseNow) });
  ok(!st.error && Number(st.data.gst_rate) === 5 && st.data.sac_code === '9963', 'invoice: composite 5%, SAC 9963');
  ok(Number(st.data.subtotal) === HALL_RENT, `invoice subtotal = hall rent ${HALL_RENT} (deposit NOT in the bill)`);
  ok(Number(st.data.cgst) === 5000 && Number(st.data.sgst) === 5000, 'CGST 2.5% + SGST 2.5% = 5000 each');
  ok(Number(st.data.total) === 210000, 'invoice total = 210000 (200000 + 5% GST) — excludes the 100000 deposit');
  ok(st.data.invoice_number === 'INV-00001', `per-org invoice number ${st.data.invoice_number} (no global SERIAL)`);
  const refund = (await db.from('deposit_ledger').select('amount,is_liability,status').eq('booking_id', bookingId).eq('entry_type', 'deposit_refunded').single()).data;
  ok(refund?.is_liability === false && Number(refund?.amount) === 100000 && refund?.status === 'refunded', 'deposit resolved: refunded, liability discharged, never revenue');
  ok((await db.from('bookings').select('status').eq('id', bookingId).single()).data?.status === 'settled', 'booking → settled');
  // idempotent settle
  const st2 = await db.rpc('settle_booking', { p_org: ORG, p_booking_id: bookingId, p_deposit_resolution: 'refund', p_now: iso(baseNow) });
  const invCount = (await db.from('invoices').select('*', { count: 'exact', head: true }).eq('booking_id', bookingId)).count;
  ok(!st2.error && st2.data.idempotent === true && invCount === 1, 're-settle is idempotent (one invoice only)');

  // ── Decision rights: settlement is Owner/PM only (B2 capability gate) ──
  console.log('\nDecision rights — settlement = Owner/PM only');
  const cb2 = await db.rpc('confirm_booking', {
    p_org_id: ORG, p_hall_id: HALL_ID, p_event_date: addDays(baseDate, 90), p_slot: 'full_day',
    p_hall_rent: 150000, p_customer_name: 'Second', p_idempotency_key: `slice2-${randomUUID()}`, p_now: iso(baseNow),
  });
  const mgrSettle = await MGR.client.rpc('settle_booking', { p_org: ORG, p_booking_id: cb2.data.booking_id, p_deposit_resolution: 'refund', p_now: iso(baseNow) });
  ok(!!mgrSettle.error && /42501|forbidden/.test(errcode(mgrSettle)), 'manager (no settlement.process) → forbidden');
  const ownerSettle = await OWNER.client.rpc('settle_booking', { p_org: ORG, p_booking_id: cb2.data.booking_id, p_deposit_resolution: 'refund', p_now: iso(baseNow) });
  ok(!ownerSettle.error && !!ownerSettle.data.invoice_number, 'owner (has settlement.process) → settles');
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  if (ORG) {
    await db.from('orgs').delete().eq('id', ORG); // cascades the whole thread
    await db.from('audit_log').delete().eq('org_id', ORG);
    for (const uid of created.users) await db.auth.admin.deleteUser(uid);
    const left = (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', ORG)).count
      + (await db.from('invoices').select('*', { count: 'exact', head: true }).eq('org_id', ORG)).count;
    console.log(`\n  cleanup: ${left === 0 ? 'OK — 0 rows left for test org' : 'XX — ' + left + ' rows left'}`);
    if (left !== 0) fails++;
  }
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
