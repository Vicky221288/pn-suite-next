# Automation runtime (B4) — the rule engine

OP MODEL §6 + §8. The structural fix for audit **F-AUTO-01** (the legacy build had
zero server-side automation → "automations" were render-time queries → 2/10).
After B4 the product **acts on its own**: chases, reminds, escalates, builds the
daily Today.

## Shape
- **Scheduler:** **Vercel Cron** → `GET /api/cron/tick`. Chosen over pg_cron
  because rules send via the B3 `MessagingProvider` (a TS interface; live AiSensy
  makes HTTP calls) — the engine must run in the app runtime, versioned with code.
  The route is **secret-authenticated** (`Authorization: Bearer $CRON_SECRET`),
  `/api/cron` is excluded from the session redirect in middleware, and with no
  secret set it is **locked (500)**, never open.

  **Cadence — Vercel plan-dependent (crons run in UTC):**
  - **Hobby (current): once daily.** `vercel.json` = `30 1 * * *` (01:30 UTC =
    **07:00 IST**) — pinned to the A10 window. ⚠️ Do NOT use `0 7 * * *`: that's
    07:00 UTC = 12:30 IST, and A10 (`hourIST===7`) would never fire.
  - **Pro (later): hourly.** Restore `0 * * * *`. A10 still fires once (at the
    7 o'clock IST tick); A2/A5/drain run every hour.

  **Daily-tick behaviour & limitation (Hobby):**
  | Rule | Daily-tick correctness |
  |---|---|
  | A10 Today | ✅ builds at the 07:00 IST tick (exactly once/day; idempotent per date) |
  | A5 rent reminders | ✅ date-milestone based (event_date − today ∈ {50,47,45}); a daily tick hits each milestone exactly once on its day |
  | drain_outbound | ✅ quiet-hours-deferred messages (`scheduled_for` = next 07:00 IST) drain at the 07:00 tick |
  | **A2 SLA escalation** | ⚠️ **granularity reduced to daily.** The rule still escalates correctly, but only at the daily tick — so an unanswered enquiry is escalated at the next 07:00 IST, not within 2h. **The 2-hour SLA is enforced ~daily on Hobby; restore hourly cron on Vercel Pro to get true 2-hour granularity.** (The rule logic is unchanged — only how often it's evaluated.)
- **Rule registry** (`lib/automation/registry.ts`): declarative entries
  `{ key, rpc, cadence, scope }`. The executor (`runTick`) is generic — **adding a
  rule is a registry entry**, not engine surgery. It lists orgs and invokes each
  due rule's RPC with `p_now`.
- **Rules are atomic RPCs** (B4 migration), each taking an injectable IST-anchored
  `p_now`, doing find+act with a **per-entity subtransaction** (one bad row can't
  fail the batch).

## The five correctness guarantees (every rule)
1. **Idempotent / catch-up-safe** — natural dedup keys, not "last tick": SLA uses
   the `leads.escalated_at` flag; reminders use the B3 outbound idempotency key
   (`rent-reminder:T<N>:<booking>`); Today uses `unique(org,role,date)` upsert;
   drain only touches `status='deferred'`. A missed tick is recovered next run; a
   repeat tick does nothing new.
2. **Quiet-hours-aware** — sends go through B3 `enqueue_outbound`, so anything
   user-facing fired 21:00–07:00 IST is **deferred** to next 07:00; the drain rule
   releases it after. Nothing pings a customer at 2 a.m.
3. **Atomic + audited** — each action is one transaction with an `audit_log` row.
4. **Tenant-scoped** — rules run per-org; no cross-tenant action (B2 holds).
5. **IST-anchored** — all time via `lib/today/date-utils.ts` (no UTC drift).

## Implemented rules (subset of §6)
| Key | Rule | RPC | Cadence |
|---|---|---|---|
| `drain_outbound` | release quiet-hours-deferred sends (B3 queue) | `drain_outbound` | every tick (global) |
| `A2_sla_escalation` | **F-AUTO-01**: lead, no follow-up in 2h → flag + notify manager | `run_sla_escalations` | every tick (per org) |
| `A5_rent_reminders` | rent reminders at T-50/47/45 before an event | `run_rent_reminders` | every tick (per org) |
| `A10_today` | 07:00 IST per-role Today (events / money[Owner-PM] / exceptions) | `build_today` | daily 07:00 IST (per org) |

A1/A3/A4/A7/A8/A9 (richer spine/data flows) slot in as registry entries in later
waves — the engine already supports them.

## Adding a rule (the sanctioned path)
1. Write an atomic, idempotent, `p_now`-driven RPC (find+act, per-entity
   subtransaction, send via `enqueue_outbound`, write `audit_log`). Run the
   5-step pre-flight.
2. Add a registry entry in `lib/automation/registry.ts`.
3. Add an assertion to `scripts/b4-verify.mjs` (injected time).
Never bypass the atomic write path or the B3 send pipeline.

## Proof
`scripts/b4-verify.mjs` (injected time, self-cleaning): idempotent/catch-up-safe
firing, SLA escalation (overdue → 1, timely → 0), T-50/47/45 once each,
quiet-hours deferral, queue drain only after 07:00, role-aware Today, cron-route
auth. B1/B2/B3 regressions stay green.
