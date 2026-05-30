#!/usr/bin/env node
/**
 * Audit-write probe (B0.3 exit criterion). Exercises the two-write pattern
 * (attempted → completed + parent link) directly against audit_log via the
 * service-role client — the same path lib/audit/emit.ts uses. Self-cleaning:
 * deletes its test rows. Prints only status, never secrets.
 *
 * Before the audit_log migration is applied → it loudly reports the table is
 * absent (proving the util fires + degrades safely). After → it writes and
 * reads back a real attempted/completed pair.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const base = { org_id: null, action: 'system.ping', actor_id: null, entity_type: 'system', meta: { probe: true } };

const attempted = await admin.from('audit_log').insert({ ...base, sub_event: 'attempted' }).select('id').single();
if (attempted.error) {
  const missing = /relation|does not exist|find the table|PGRST205|not found/i.test(attempted.error.message);
  console.log(`  ⚠️  audit util FIRED but could not persist: ${attempted.error.message}`);
  console.log(missing
    ? '      → audit_log table not applied yet. Run the B0.3 migration, then re-run.\n'
    : '      → unexpected error (not a missing-table case).\n');
  process.exit(missing ? 3 : 1);
}

const attemptedId = attempted.data.id;
const completed = await admin
  .from('audit_log')
  .insert({ ...base, sub_event: 'completed', parent_audit_id: attemptedId })
  .select('id')
  .single();

const readBack = await admin
  .from('audit_log')
  .select('id, action, sub_event, parent_audit_id')
  .eq('action', 'system.ping')
  .in('id', [attemptedId, completed.data?.id].filter(Boolean));

const linked = readBack.data?.find((r) => r.sub_event === 'completed')?.parent_audit_id === attemptedId;
console.log('  ✅ attempted row written:', attemptedId);
console.log('  ✅ completed row written:', completed.data?.id, '(parent →', completed.data ? attemptedId : 'n/a', ')');
console.log('  ✅ read-back rows:', readBack.data?.length, '· parent link intact:', linked);

// Cleanup (probe rows only).
await admin.from('audit_log').delete().in('id', [attemptedId, completed.data?.id].filter(Boolean));
console.log('  ✅ probe rows cleaned up\n');
process.exit(linked ? 0 : 1);
