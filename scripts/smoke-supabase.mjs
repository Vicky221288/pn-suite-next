#!/usr/bin/env node
/**
 * Live connectivity smoke test for PN's Supabase project.
 * Reads .env.local, checks anon + service-role reachability, and reports whether
 * the audit_log table exists yet. Prints ONLY status codes + verdicts — never
 * key values. Safe to run any time; not part of CI (needs live env).
 */
import { readFileSync } from 'node:fs';

function loadEnvLocal() {
  const env = {};
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    console.error('❌ .env.local not found');
    process.exit(2);
  }
  return env;
}

const env = loadEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;

const present = (v) => (v && v.length > 20 && !v.includes('YOUR-') ? 'set' : 'MISSING/placeholder');
console.log('\n  PN Supabase — live smoke test');
console.log('  ' + '-'.repeat(50));
console.log(`  URL .................. ${url ? url.replace(/^https:\/\//, '') : 'MISSING'}`);
console.log(`  anon key ............. ${present(anon)}`);
console.log(`  service-role key ..... ${present(service)}`);
if (!url || present(anon) !== 'set' || present(service) !== 'set') {
  console.error('\n  ❌ env incomplete — fill .env.local with real PN values.\n');
  process.exit(2);
}

let failures = 0;
async function check(label, p, okCodes) {
  try {
    const res = await p;
    const ok = okCodes.includes(res.status);
    console.log(`  ${ok ? '✅' : '❌'} ${label} → HTTP ${res.status}`);
    if (!ok) failures++;
    return res;
  } catch (e) {
    console.log(`  ❌ ${label} → ${e.message}`);
    failures++;
    return null;
  }
}

console.log('  ' + '-'.repeat(50));
// 1. Auth health (anon).
await check('auth/v1/health (anon)', fetch(`${url}/auth/v1/health`, { headers: { apikey: anon } }), [200]);
// 2. REST root reachable (anon). A bare REST root commonly returns 401 (needs a
//    table path / RLS context) — that still proves reachability.
await check('rest/v1 reachable (anon)', fetch(`${url}/rest/v1/`, { headers: { apikey: anon } }), [200, 401, 404]);
// 3. Service-role auth admin (proves the service key works + is privileged).
await check(
  'auth/v1/admin/users (service-role)',
  fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  }),
  [200],
);
// 4. audit_log table existence (service-role REST).
const auditRes = await check(
  'audit_log table (service-role)',
  fetch(`${url}/rest/v1/audit_log?select=id&limit=1`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` },
  }),
  [200, 404, 400],
);
if (auditRes) {
  console.log(
    auditRes.status === 200
      ? '       └─ audit_log EXISTS (audit-write probe can fully close).'
      : '       └─ audit_log NOT created yet (expected — schema phase / B1).',
  );
}

console.log('  ' + '-'.repeat(50));
console.log(`  ${failures} connectivity failure(s)\n`);
process.exit(failures > 0 ? 1 : 0);
