#!/usr/bin/env node
/**
 * seed-pn-tenant.mjs — one-shot provisioning of the FIRST real PN tenant.
 *
 * IDEMPOTENT (safe to re-run): every write is keyed on a fixed id or a unique
 * constraint and uses upsert / lookup-then-skip. TENANT-SCOPED: it only ever
 * touches the canonical PN org row (+ that org's membership/hall/senders) and
 * does a READ-ONLY lookup of the owner's auth user. No global or other-tenant
 * data is modified.
 *
 * Creates: the org, your user as Owner (all caps), one hall, and the two senders
 * (stays + hall_catering) so the A1 acknowledgement can resolve a sender.
 *
 * Run (from repo root):
 *   node scripts/seed-pn-tenant.mjs
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (read from the env
 * or from .env.local). Override the owner with OWNER_EMAIL=you@example.com.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// ── canonical, fixed ids → re-running upserts the SAME rows (idempotent) ──────
const PN_ORG_ID = '11111111-1111-4111-8111-111111111111';
const PN_HALL_ID = '22222222-2222-4222-8222-222222222222';
const ORG_NAME = 'Pooranam Nachiyar Marriage Hall & PN Stays';
const HALL_NAME = 'Main Hall';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'mail2vignessh@gmail.com';

// Owner = ALL capabilities (mirrors lib/auth/capabilities.ts ROLE_CAPABILITIES.owner).
const OWNER_CAPS = ['booking.confirm', 'settlement.process', 'record.delete', 'pnl.view_margin', 'discount.approve'];

// Placeholder sender numbers — REPLACE with the real AiSensy-registered numbers
// in the WhatsApp session. Mock provider doesn't dial them; they only need to
// exist so outbound (A1 ack, reminders) and inbound routing resolve a sender.
const SENDERS = [
  { function_area: 'stays', display_name: 'PN Stays', phone_number: '+910000000001', manager_phone: '+910000000009' },
  { function_area: 'hall_catering', display_name: 'PN Hall & Catering', phone_number: '+910000000002', manager_phone: '+910000000009' },
];

// ── env ──────────────────────────────────────────────────────────────────────
const env = { ...process.env };
try {
  for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* env may come entirely from process.env */ }
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('❌ Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (env or .env.local)'); process.exit(2); }
const db = createClient(URL_, KEY, { auth: { persistSession: false } });

const log = (m) => console.log(`  ${m}`);

async function findOwner() {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error('listUsers: ' + error.message);
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === OWNER_EMAIL.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  console.log(`\nSeeding PN tenant on ${URL_.replace(/^https:\/\//, '')}\n`);

  // 0. owner auth user (read-only lookup)
  const ownerId = await findOwner();
  if (!ownerId) { console.error(`❌ Auth user ${OWNER_EMAIL} not found. Sign in once (so the account exists), then re-run.`); process.exit(1); }
  log(`owner: ${OWNER_EMAIL} → ${ownerId}`);

  // 1. org (fixed id → idempotent)
  let r = await db.from('orgs').upsert({ id: PN_ORG_ID, name: ORG_NAME }, { onConflict: 'id' }).select('id').single();
  if (r.error) throw new Error('orgs upsert: ' + r.error.message);
  log(`org: ${ORG_NAME} (${PN_ORG_ID})`);

  // 2. owner membership (unique org_id+user_id → idempotent; refreshes caps/role)
  r = await db.from('org_members').upsert(
    { org_id: PN_ORG_ID, user_id: ownerId, role: 'owner', capabilities: OWNER_CAPS },
    { onConflict: 'org_id,user_id' },
  );
  if (r.error) throw new Error('org_members upsert: ' + r.error.message);
  log(`membership: owner with caps [${OWNER_CAPS.join(', ')}]`);

  // 3. hall (fixed id → idempotent). Note: rent is per-booking (no hall.rent col).
  r = await db.from('halls').upsert({ id: PN_HALL_ID, org_id: PN_ORG_ID, name: HALL_NAME }, { onConflict: 'id' });
  if (r.error) throw new Error('halls upsert: ' + r.error.message);
  log(`hall: ${HALL_NAME} (${PN_HALL_ID}) — set the rent (e.g. ₹200,000) at quote/booking time`);

  // 4. senders (unique org_id+function_area → idempotent)
  for (const s of SENDERS) {
    r = await db.from('message_senders').upsert(
      { org_id: PN_ORG_ID, function_area: s.function_area, display_name: s.display_name, phone_number: s.phone_number, manager_phone: s.manager_phone, provider: 'mock', active: true },
      { onConflict: 'org_id,function_area' },
    );
    if (r.error) throw new Error(`sender ${s.function_area}: ` + r.error.message);
    log(`sender: ${s.function_area} → ${s.display_name} (${s.phone_number}) [mock — replace # for live]`);
  }

  // 5. summary (scoped reads)
  const memberCount = (await db.from('org_members').select('*', { count: 'exact', head: true }).eq('org_id', PN_ORG_ID)).count;
  const senderCount = (await db.from('message_senders').select('*', { count: 'exact', head: true }).eq('org_id', PN_ORG_ID)).count;
  console.log(`\n✅ Seed complete (idempotent). PN org has ${memberCount} member(s), ${senderCount} sender(s), 1 hall.`);
  console.log('   You can now create an enquiry, confirm a booking, and settle on the live UI.\n');
}

main().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });
