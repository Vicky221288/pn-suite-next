import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { hourIST } from '@/lib/today/date-utils';

/**
 * The rule registry + tick executor (OP MODEL §6; the F-AUTO-01 engine).
 *
 * Rules are declarative entries that map to the atomic, idempotent,
 * quiet-hours-aware RPCs (B4 migration). The executor is generic: adding a rule
 * is a REGISTRY ENTRY, not engine surgery. Each RPC takes an injectable p_now
 * (IST-anchored) and is safe to re-run (idempotent / catch-up-safe), so a missed
 * tick is recovered on the next run without duplicating effects.
 *
 * Sends go through the B3 enqueue_outbound (inheriting quiet-hours deferral +
 * idempotency). The deferred queue is drained when scheduled_for has elapsed.
 */
type Cadence = 'every_tick' | 'daily_0700';
type Scope = 'global' | 'per_org';

interface Rule {
  key: string;
  rpc: string;
  cadence: Cadence;
  scope: Scope;
}

const RULES: Rule[] = [
  { key: 'drain_outbound', rpc: 'drain_outbound', cadence: 'every_tick', scope: 'global' },
  { key: 'A2_sla_escalation', rpc: 'run_sla_escalations', cadence: 'every_tick', scope: 'per_org' },
  { key: 'A5_rent_reminders', rpc: 'run_rent_reminders', cadence: 'every_tick', scope: 'per_org' },
  { key: 'A10_today', rpc: 'build_today', cadence: 'daily_0700', scope: 'per_org' },
  // M3-auto — CRM recurring outreach (idempotent, IST-anchored, quiet-hours-aware, B3-only)
  { key: 'A_review_requests', rpc: 'run_review_requests', cadence: 'every_tick', scope: 'per_org' },
  { key: 'A_special_dates', rpc: 'run_special_date_outreach', cadence: 'every_tick', scope: 'per_org' },
  // M5 — expire lapsed tentative date holds (belt to the read-filter suspenders; idempotent)
  { key: 'A_hold_expiry', rpc: 'run_hold_expiry', cadence: 'every_tick', scope: 'per_org' },
];

function isDue(rule: Rule, now: Date): boolean {
  if (rule.cadence === 'every_tick') return true;
  // A10 fires in the 07:00 IST hour. COUPLED to the cron schedule in vercel.json:
  // Vercel crons run in UTC, and on the Hobby plan we get ONE daily tick — it MUST
  // be `30 1 * * *` (01:30 UTC = 07:00 IST) so this window matches. (`0 7 * * *`
  // would be 12:30 IST and A10 would never fire.) On Vercel Pro we restore hourly
  // (`0 * * * *`); this window still fires exactly once (at the 7 o'clock tick).
  if (rule.cadence === 'daily_0700') return hourIST(now) === 7;
  return false;
}

export interface TickResult {
  tickAt: string;
  ran: Record<string, number>;
  orgs: number;
  errors: { rule: string; orgId?: string; error: string }[];
}

export async function runTick(now: Date = new Date()): Promise<TickResult> {
  const admin = createAdminClient();
  const nowIso = now.toISOString();
  const result: TickResult = { tickAt: nowIso, ran: {}, orgs: 0, errors: [] };
  const bump = (k: string, n: number) => (result.ran[k] = (result.ran[k] ?? 0) + (n ?? 0));

  // global rules (e.g. drain the deferred outbound queue)
  for (const rule of RULES.filter((r) => r.scope === 'global' && isDue(r, now))) {
    const { data, error } = await admin.rpc(rule.rpc, { p_now: nowIso });
    if (error) result.errors.push({ rule: rule.key, error: error.message });
    else bump(rule.key, (data as number) ?? 0);
  }

  // per-org rules
  const { data: orgs, error: orgErr } = await admin.from('orgs').select('id');
  if (orgErr) {
    result.errors.push({ rule: 'list_orgs', error: orgErr.message });
    return result;
  }
  result.orgs = orgs?.length ?? 0;
  for (const org of orgs ?? []) {
    for (const rule of RULES.filter((r) => r.scope === 'per_org' && isDue(r, now))) {
      const { data, error } = await admin.rpc(rule.rpc, { p_org: org.id as string, p_now: nowIso });
      if (error) result.errors.push({ rule: rule.key, orgId: org.id as string, error: error.message });
      else bump(rule.key, (data as number) ?? 0);
    }
  }
  return result;
}
