# CLAUDE.md — PN Master Suite (rebuild)

**Read this first at the start of every session.** This is the load-bearing
handoff for the PN re-platform.

## What this repo is
The from-scratch rebuild of **PN Master Suite** — a multi-tenant hospitality
operating system for banquet-halls-with-rooms (first tenant: Pooranam Nachiyar
Marriage Hall + PN Stays, Red Hills, Chennai). **Next.js 15 (App Router) +
Supabase + Vercel**, replacing the legacy React/Vite/Cloudflare-Pages build
(audited at **45/100** — see `docs/AUDIT-2.0.md`).

This is an **independent project**: PN's own GitHub / Supabase / Vercel / email,
fully separate from RHS CRM NXT (which is only a *convention donor* — see
`docs/REUSE-ANALYSIS.md`). No shared infra, no shared credentials.

## Supabase projects (read before any schema work)
- **New build (THIS repo, the active target):** ref `kvyhyeqwyafpizecfbnt`
  (`kvyhyeqwyafpizecfbnt.supabase.co`) — a **fresh, empty** project. All migrations
  and the running app point here (`.env.local`). Verified live: anon connectivity
  (health 200) + middleware guard + service-role admin (200) + end-to-end auth
  flow (createUser → signIn → getUser → cleanup, 0 failures). The audit-write
  probe closes once `audit_log` is applied (Vicky runs SQL).
- **Legacy:** ref `rvabhitxdjeqwgkszbvs` — the OLD React/Vite build's project.
  **Untouched.** It is a **later migration SOURCE only** (we will lift PN's
  historical data from it during the spine/data-migration wave). Never point the
  rebuild at it; never write to it.
- RHS CRM NXT runs on its own separate project — no relation to either.

## Sources of truth (read in this order)
1. `docs/PN-OP-MODEL-v1.2.md` — the operating model. All §12 decisions LOCKED.
   Internalize §10 (multi-tenant), §6 (automation/messaging), §11 (invariants).
2. `docs/PN-Foundation-Wave-Build-Plan-v1.md` — the sequenced wave plan.
3. `docs/REUSE-ANALYSIS.md` — what lifts from RHS vs what's greenfield.
4. `docs/AUDIT-2.0.md` — why we're rebuilding (the finding IDs we answer to).

## Non-negotiable invariants (OP MODEL §11)
1. **Every write is atomic and server-side** via the **wrapper + RPC** pattern:
   a server action (`lib/actions/wrapper.ts` → `ActionResult<T>` + two-write
   audit) wrapping a **single atomic Postgres RPC**. NEVER a multi-step client
   write. (Retires the audit's #1 re-platform risk.)
2. **Every automated action is idempotent and audited.**
3. **No hardcoded single-property values** — everything is `org_id`/tenant-config.
4. **Foundation before services** — identity/tenancy/automation/billing spine
   first; rooms/kitchen/vendor modules hang off it after.
5. **Money operations always write a ledger entry + audit trail.**
6. **Port domain logic, not architecture** — re-express PN's rules on the new
   atomic, multi-tenant, server-side foundation; never copy old client patterns.

## Working posture (this wave)
- Every CC prompt: **CONTEXT + STOP markers + RESUME** (standing rule).
- All writes via the wrapper+RPC pattern. No exceptions.
- Reads use the RLS-enforced user client; writes use the `'server-only'` admin
  client (`lib/supabase/admin.ts`) **after** authorization, **always** scoped by
  `org_id`. Run the **5-step pre-flight** (`docs/PRE-FLIGHT-5-STEP.md`) before any
  schema change.
- **CC never deploys and never pushes.** Vicky reviews, runs SQL, pushes, deploys.
- Phase-by-phase: complete a phase, print its RESUME line, **stop and wait**.
- A phase exits only when its exit criterion is **demonstrably** met (a passing
  test, not a claim).

## Where things live
```
app/                      # App Router
  (app)/                  # authenticated surfaces (today = the command screen)
  login/                  # email+password sign-in
  auth/signout/route.ts   # sign-out handler
  layout.tsx, globals.css, tokens.css   # Maroon Meridian token layer
lib/
  supabase/{client,server,admin,middleware}.ts   # dual-client trust model
  actions/{types,wrapper,ping,booking}.ts  # ActionResult<T> + wrapper + ping + booking.confirm (B1 ref)
  audit/emit.ts           # loud two-write audit util
  today/date-utils.ts     # IST-correct dates (fixes AUDIT F-DATA-02)
  auth/{context,authorize,capabilities}.ts  # session→org+capabilities gate (B2, F-SEC-04)
  env.ts                  # lazy, validated env access
components/ui/, components/*   # token-driven primitives
scripts/check-contrast.mjs     # WCAG AA gate on token pairs
.github/workflows/ci.yml       # lint + typecheck + build + contrast
docs/                     # the four sources of truth + pre-flight discipline
```

## Build state
- **Phase B0 (genesis & guardrails): COMPLETE ✅ — all exit criteria met**
  against the fresh `kvyhyeqwyafpizecfbnt` project. Scaffold, dual-client auth
  spine, admin client + loud audit util, the `ActionResult<T>` wrapper, IST
  date-utils, Maroon Meridian tokens (light+dark, 12/12 AA), CI, and docs are in.
  Build gate green: `npm audit` 0; typecheck/lint/build/contrast all pass.
  - ✅ Verified live (gate-1 GREEN): anon connectivity (health 200); service-role
    admin (200); middleware guard (`/today`,`/`,`/*` → 307 → `/login`; `/login`
    200); end-to-end auth flow (createUser → signIn → getUser validates →
    cleanup, 0 failures, self-cleaning temp user).
  - ✅ audit-write probe GREEN: the two-write pattern (attempted → completed +
    parent link) writes, reads back, and self-cleans against the live
    `audit_log` table (`scripts/probe-audit.mjs`).
  - gate-2 (Vercel link/deploy) is Vicky's — not a B0 blocker.
- **Phase B1 (atomic write foundation): COMPLETE ✅ — verified live** on
  `kvyhyeqwyafpizecfbnt` (migration applied). The wrapper+RPC pattern is built and
  codified (`docs/WRITE-PATTERN.md`): `confirm_booking` atomic RPC + `booking.confirm`
  action + idempotency + GiST `EXCLUDE` double-booking guard. `scripts/b1-verify.mjs`
  passes deterministically (run twice, identical, exit 0, self-cleaning):
  - ✅ Concurrency (S4): 5 racing confirms → exactly 1 winner, 4 clean `slot_taken`,
    1 booking + 1 block + 1 deposit + 1 completed audit, 0 orphans.
  - ✅ Idempotency (inv. #2): same key twice → one row, 2nd is a no-op.
  - ✅ All-or-nothing: forced mid-tx failure → zero rows persist (no deposit
    without a booking; bookings === deposits).
  - ✅ Slot semantics: morning + evening coexist; full_day then conflicts (3h buffer).
  - typecheck/lint/build green. The orphan-data class of bug is structurally dead.
- **Phase B2 (multi-tenant skeleton): COMPLETE ✅ — verified live** on
  `kvyhyeqwyafpizecfbnt`. Tenant root
  (`orgs`) + `org_members` (composable capabilities, OP MODEL §3), membership
  helpers (`is_org_member`/`has_capability`), `org_id`-scoped RLS (default-deny;
  members SELECT their org, no direct authenticated writes), FKs org_id→orgs, and
  the **F-SEC-04 fix**: `confirm_booking` now self-authorizes on `auth.uid()`
  (membership + `booking.confirm`) so cross-tenant confirm is impossible even via
  a forged RPC call. App gate: `lib/auth/{authorize,capabilities}.ts` +
  wrapper resolves org/caps from session (never client input); booking action
  drops client org_id, calls the RPC via the user client. Migration
  `supabase/migrations/20260531120000_b2_multitenant.sql` WRITTEN, not applied.
  typecheck/lint/build green.
  - ✅ `scripts/b2-verify.mjs` (two-tenant isolation) + `scripts/b1-verify.mjs`
    (regression) BOTH pass twice identical, exit 0, self-cleaning: 0 cross-tenant
    read/confirm/delete in either direction; capability rights enforced (manager
    w/o `booking.confirm` rejected; owner-in-A powerless in B); B1
    atomic/concurrency/idempotency guarantees intact under RLS+FK. **F-SEC-04
    closed-by-test.**
- **Phase B3 (messaging foundation): COMPLETE ✅ — verified live** on
  `kvyhyeqwyafpizecfbnt`. Provider-agnostic `MessagingProvider` interface
  (`lib/messaging/`); **multi-sender** (`message_senders`, keyed `(org_id,
  function_area)` — `stays` + `hall_catering`, routed server-side; inbound routed
  by receiving number). `enqueue_outbound` RPC: idempotent + quiet-hours-aware
  (defer 21:00–07:00 IST → next 07:00) + audited. `ingest_inbound` RPC: replay-safe
  dedup + atomic tenant-scoped lead create/match. Inbound route
  `app/api/messaging/inbound/route.ts`: HMAC-SHA256 signature auth (path made
  public in middleware — webhooks self-authenticate, no session).
  **MockProvider** records (default); **AiSensyProvider** is a shell — **live
  wiring DEFERRED to the WhatsApp/Meta session (gate)**; never call live AiSensy/
  Meta until then. See `docs/MESSAGING.md`.
  - ✅ `scripts/b3-verify.mjs` passes twice identical (exit 0, self-cleaning, dev
    server up): multi-sender routing (Stays→Stays, Hall→Hall), no_sender, quiet-
    hours deferral, idempotent single-send; inbound dedup/replay → one lead,
    unknown-number → one tenant-scoped lead, unregistered number rejected; HTTP
    webhook forged-sig → 401, valid → 200 + lead, replay → deduped. B2/B1
    regressions green. **A real bug was caught + fixed**: the auth middleware was
    redirecting the webhook to /login; `/api/messaging` is now a public path.
- **Phase B4 (scheduler / automation runtime): COMPLETE ✅ — verified live** on
  `kvyhyeqwyafpizecfbnt`. **F-AUTO-01 closed-by-test.**
  The F-AUTO-01 engine (OP MODEL §6/§8): **Vercel Cron** → secret-auth'd
  `GET /api/cron/tick` (`vercel.json`, hourly; `/api/cron` public in middleware;
  locked-500 without `CRON_SECRET`) → **rule registry** (`lib/automation/registry.ts`,
  declarative; adding a rule = an entry) → atomic, idempotent, IST-anchored,
  quiet-hours-aware **rule RPCs** with per-entity subtransactions:
  `run_sla_escalations` (A2 — overdue lead → flag + notify manager via B3),
  `run_rent_reminders` (A5 — T-50/47/45), `build_today` (A10 — role-aware 07:00
  Today; money Owner/PM-only), `drain_outbound` (release B3 quiet-hours queue).
  Migration `supabase/migrations/20260531180000_b4_automation.sql` WRITTEN, not
  applied. Mock send path (AiSensy still deferred). typecheck/lint/build green.
  See `docs/AUTOMATION.md`.
  - ✅ `scripts/b4-verify.mjs` passes twice identical (exit 0, self-cleaning, dev
    server up): SLA escalation (overdue → exactly 1 + manager notified, timely →
    0, idempotent re-tick → 0); T-50/47/45 reminders once each (T-30 none);
    quiet-hours deferral; drain only after 07:00 IST; role-aware Today (owner has
    money, manager omits); cron-route auth (no/wrong → 401, valid → 200).
    **B3/B2/B1 regressions all green** (twice each). F-AUTO-01 — the 2/10 layer —
    is structurally addressed.
  - Next: **B5 — the vertical slice** (Enquiry → Booking → Event → Settlement
    end-to-end; the foundation-wave go/no-go gate).
- **Phase B5 (vertical slice — GO/NO-GO GATE): COMPLETE ✅ — verified live. 🎉 FOUNDATION WAVE DONE.**
  Composes B1–B4 into ONE thread: Enquiry → Quote → Booking → Event → Settlement.
  Spine tables `quotes`/`events`/`invoices` (+ `bookings.lead_id`), tenant-scoped
  RLS. Transition RPCs (atomic, audited, self-auth): `create_enquiry` (A1 ack via
  B3), `record_followup`, `create_quote`, `confirm_booking` (EXTENDED with
  `p_lead_id` — links won lead), `create_event`, `settle_booking` (composite-5%
  GST invoice — SAC 9963, per-org numbering — + deposit resolution; Owner/PM-only
  via `settlement.process`). Deposit stays a separate escrowed liability, NEVER
  in the invoice (§12 #6); invoice fixes F-FIN-03. UI: `/today` wired to the B4
  builder (real command surface), `/enquiries` + `/enquiries/[id]` drive the
  thread (server actions `lib/actions/slice.ts`). Migration
  `supabase/migrations/20260531210000_b5_vertical_slice.sql` WRITTEN, not applied.
  typecheck/lint/build green. See `docs/B5-WALKTHROUGH.md`.
  - ✅ Verified live (b5 migration + b5a fix applied): `scripts/b5-verify.mjs`
    passes twice identical (exit 0, self-cleaning) — full thread, atomic confirm +
    deposit-as-liability, A1/A2/A5 fired, role-aware Today, composite-5% GST
    invoice (₹200k + 5% = ₹210k; deposit ₹100k OFF the bill; per-org INV-00001;
    F-FIN-03 closed), Owner/PM-only settlement. **B4/B3/B2/B1 regressions all
    green, twice each.** The gate surfaced ONE composition seam (confirm_booking
    didn't carry customer_phone → A5 had no recipient); fixed cleanly via b5a
    (derive from lead). Composition verdict: **clean, modulo that one seam now
    closed** — four in-spirit primitive extensions total (p_lead_id, getRoleContext
    role/caps, customer_phone), no bypasses.
  - **FOUNDATION WAVE COMPLETE** — PN crosses from Capable Tool (audit 45/100)
    toward Product. The four pillars compose; the spine runs end-to-end.
  - **NOT STARTED (separate waves, await go):** module migration (the 16 legacy
    modules), productization/billing/white-label, live AiSensy wiring (the
    WhatsApp/Meta session — MockProvider still default; AiSensyProvider throws).

### B0.6 token adjustments (logged for transparency)
The contrast checker (authorized by tokens.css §CONTRAST-NOTES "adjust if <4.5:1")
darkened two status colors and brightened dark-mode brand text so all pairs pass
WCAG AA: `--green-500` #2F7D52→#256840, `--amber-500` #B5791E→#8A5912, dark
`--color-text-on-brand` #FBF1F1→#FFFFFF.

## Hard don'ts
- Do NOT import `lib/supabase/admin` into client code (the `'server-only'` guard
  enforces this; a violation is a P0 security incident).
- Do NOT write multi-step (non-atomic) mutations. The wrapper+RPC pattern in
  `docs/WRITE-PATTERN.md` is the ONLY sanctioned write path — review rejects
  sequential client/server writes. Conflicts are enforced by DB constraints
  (e.g. GiST `EXCLUDE`), never check-then-insert.
- Do NOT trust a client-supplied `org_id` for an authenticated call — resolve it
  from the session (the F-SEC-04 fix). Every new table ships RLS-default-deny +
  an `org_id`-scoped SELECT policy; writes go through a SECURITY DEFINER RPC that
  self-authorizes on `auth.uid()`. No god-role: even `owner` is property-scoped.
- Do NOT call a WhatsApp/BSP SDK directly — all messaging goes through the
  `MessagingProvider` interface (`docs/MESSAGING.md`). Outbound is idempotent +
  quiet-hours-aware (21:00–07:00 IST); inbound is signature-authenticated +
  replay-safe. Senders are per-(org, function_area) config, never literals. Live
  AiSensy/Meta wiring is DEFERRED — do not call live endpoints until that session.
- Do NOT add automation outside the rule registry (`docs/AUTOMATION.md`). A new
  automation = an atomic, idempotent, IST-anchored, quiet-hours-aware RPC + a
  registry entry; it sends via B3 and writes via the atomic path. Cron/webhook
  routes are secret/signature-authenticated and excluded from the session
  redirect — never public, never bypassing auth.
- Do NOT hardcode any single-property value ("PN", "10 rooms", GSTIN, addresses).
- Do NOT commit secrets or `.har`/`.env*` files (AUDIT F-SEC-01 — the legacy leak).
- Do NOT push or deploy — that's Vicky's.
