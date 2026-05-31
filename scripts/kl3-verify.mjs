#!/usr/bin/env node
/**
 * KL-3 harness — Storage for photo-proof. Proves: upload → object path →
 * short-lived signed-URL retrieval works; the bucket is PRIVATE (public URL
 * fails); an org-A member cannot retrieve/insert an org-B proof photo (Storage
 * RLS isolation); the W2 + S3 photo-proof gate still rejects a photo-required
 * completion with no ref and accepts a real uploaded path. Self-cleaning
 * (removes uploaded objects + orgs), re-runnable, exit-coded.
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
const BUCKET = 'proof-photos';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG signature + IHDR start

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'OK ' : 'XX '} ${m}`); if (!c) fails++; };
const errcode = (r) => r.error?.code ?? r.error?.message ?? '';
const rid = () => randomUUID().slice(0, 8);
const created = { users: [], orgs: [], objects: [] };

async function mkOrg(n) { const o = await db.from('orgs').insert({ name: n }).select('id').single(); if (o.error) { console.error('SETUP:', o.error.message); process.exit(2); } created.orgs.push(o.data.id); return o.data.id; }
async function mkMember(orgId) {
  const email = `pn-kl3-${Date.now()}-${rid()}@example.com`, password = `Pn!${randomUUID()}Aa1`;
  const c = await db.auth.admin.createUser({ email, password, email_confirm: true }); if (c.error) throw new Error(c.error.message);
  created.users.push(c.data.user.id);
  await db.from('org_members').insert({ org_id: orgId, user_id: c.data.user.id, role: 'owner', capabilities: [] });
  const cl = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await cl.auth.signInWithPassword({ email, password }); if (s.error) throw new Error(s.error.message);
  return cl;
}
async function upload(client, path) { created.objects.push(path); return client.storage.from(BUCKET).upload(path, PNG, { contentType: 'image/png', upsert: true }); }

async function main() {
  // bucket present?
  const probe = await db.storage.from(BUCKET).upload(`probe/${rid()}.png`, PNG, { contentType: 'image/png' });
  if (probe.error && /Bucket not found/i.test(probe.error.message)) { console.error('SETUP: bucket proof-photos missing (KL-3 migration applied?)'); process.exit(2); }
  if (probe.data?.path) await db.storage.from(BUCKET).remove([probe.data.path]);

  const A = await mkOrg('KL3 Org A'), B = await mkOrg('KL3 Org B');
  const userA = await mkMember(A), userB = await mkMember(B);

  // ── 1. upload → path → signed-URL retrieval ──
  console.log('\n1. Upload → object path → signed-URL retrieval');
  const pathA = `${A}/checklist/${rid()}/proof.png`;
  const up = await upload(userA, pathA);
  ok(!up.error && up.data?.path === pathA, `member upload to own-org path succeeded (${up.error?.message ?? 'ok'})`);
  const su = await userA.storage.from(BUCKET).createSignedUrl(pathA, 60);
  ok(!su.error && !!su.data?.signedUrl, 'short-lived signed URL created');
  const fetched = su.data?.signedUrl ? await fetch(su.data.signedUrl) : { ok: false };
  ok(fetched.ok, 'signed URL retrieves the object (HTTP 200)');

  // ── 2. bucket is PRIVATE (no public link) ──
  console.log('\n2. Bucket is private (public URL must fail)');
  const pub = userA.storage.from(BUCKET).getPublicUrl(pathA).data.publicUrl;
  const pubRes = await fetch(pub);
  ok(!pubRes.ok, `public URL does NOT serve the object (HTTP ${pubRes.status})`);

  // ── 3. Storage RLS isolation (org A cannot touch org B's photos) ──
  console.log('\n3. Storage RLS isolation');
  const pathB = `${B}/checklist/${rid()}/proof.png`;
  const upB = await upload(db, pathB); // service-role seeds B's object (bypasses RLS)
  ok(!upB.error, 'service-role seeded an org-B object');
  const aReadsB = await userA.storage.from(BUCKET).createSignedUrl(pathB, 60);
  ok(!!aReadsB.error || !(await fetch(aReadsB.data?.signedUrl ?? 'http://x')).ok, 'org-A member CANNOT sign/retrieve org-B photo (RLS)');
  const aDownB = await userA.storage.from(BUCKET).download(pathB);
  ok(!!aDownB.error, 'org-A member CANNOT download org-B photo (RLS)');
  const aWritesB = await userA.storage.from(BUCKET).upload(`${B}/checklist/${rid()}/x.png`, PNG, { contentType: 'image/png' });
  ok(!!aWritesB.error, 'org-A member CANNOT upload into org-B path (RLS)');
  const bReadsB = await userB.storage.from(BUCKET).createSignedUrl(pathB, 60);
  ok(!bReadsB.error && !!bReadsB.data?.signedUrl, 'org-B member CAN sign its own photo');

  // ── 4. W2 checklist photo-proof gate still enforces (ref now a real object) ──
  console.log('\n4. W2 checklist photo-proof gate (unchanged)');
  const ev = (await db.from('events').insert({ org_id: A, event_date: '2099-09-09', status: 'planning' }).select('id').single()).data.id;
  const ck = await db.rpc('create_event_checklist', { p_org: A, p_event_id: ev, p_title: 'Setup', p_assigned_staff_id: null, p_items: [{ label: 'Stage', requires_photo: true }] });
  const item = (await db.from('event_checklist_items').select('id').eq('checklist_id', ck.data.checklist_id).single()).data.id;
  const noRef = await db.rpc('complete_checklist_item', { p_org: A, p_item_id: item });
  ok(!!noRef.error && /photo_required|22023/.test(errcode(noRef)), 'photo-required item rejected without a ref');
  const withRef = await db.rpc('complete_checklist_item', { p_org: A, p_item_id: item, p_photo_ref: pathA });
  const stored = (await db.from('event_checklist_items').select('done, photo_ref').eq('id', item).single()).data;
  ok(!withRef.error && stored.done && stored.photo_ref === pathA, 'completes with the real uploaded object path stored as photo_ref');

  // ── 5. S3 housekeeping photo-proof gate still enforces ──
  console.log('\n5. S3 housekeeping photo-proof gate (unchanged)');
  const rt = (await db.rpc('upsert_room_type', { p_org: A, p_name: 'Std', p_base_rate: 1000 })).data.room_type_id;
  const room = (await db.rpc('create_room', { p_org: A, p_room_type_id: rt, p_number: `R-${rid()}` })).data.room_id;
  const task = (await db.rpc('create_housekeeping_task', { p_org: A, p_room_id: room, p_kind: 'deep_clean', p_requires_photo: true })).data.task_id;
  const hkNo = await db.rpc('complete_housekeeping_task', { p_org: A, p_task_id: task });
  ok(!!hkNo.error && /photo_required|22023/.test(errcode(hkNo)), 'photo-required turn rejected without a ref');
  const pathHk = `${A}/housekeeping/${task}/clean.png`;
  await upload(db, pathHk);
  const hkYes = await db.rpc('complete_housekeeping_task', { p_org: A, p_task_id: task, p_photo_ref: pathHk, p_result: 'inspected' });
  ok(!hkYes.error && (await db.from('rooms').select('housekeeping_status').eq('id', room).single()).data.housekeeping_status === 'inspected', 'turn completes with uploaded photo → room inspected');
}

try { await main(); }
catch (e) { console.error('  XX harness threw:', e.message); fails++; }
finally {
  if (created.objects.length) await db.storage.from(BUCKET).remove(created.objects);
  for (const orgId of created.orgs) { await db.from('orgs').delete().eq('id', orgId); await db.from('audit_log').delete().eq('org_id', orgId); }
  for (const uid of created.users) await db.auth.admin.deleteUser(uid);
  let left = 0;
  for (const orgId of created.orgs) left += (await db.from('orgs').select('*', { count: 'exact', head: true }).eq('id', orgId)).count;
  // confirm objects gone
  let objLeft = 0;
  for (const p of created.objects) { const d = await db.storage.from(BUCKET).download(p); if (!d.error) objLeft++; }
  console.log(`\n  cleanup: ${left === 0 && objLeft === 0 ? 'OK — 0 rows / 0 objects left' : 'XX — ' + left + ' rows, ' + objLeft + ' objects left'}`);
  if (left !== 0 || objLeft !== 0) fails++;
  console.log(`\n  ${fails} failure(s)\n`);
  process.exit(fails > 0 ? 1 : 0);
}
