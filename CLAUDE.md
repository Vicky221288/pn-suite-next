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
  actions/{types,wrapper,ping}.ts   # ActionResult<T> + THE wrapper + example
  audit/emit.ts           # loud two-write audit util
  today/date-utils.ts     # IST-correct dates (fixes AUDIT F-DATA-02)
  auth/context.ts         # role/tenant context (stub → B2)
  env.ts                  # lazy, validated env access
components/ui/, components/*   # token-driven primitives
scripts/check-contrast.mjs     # WCAG AA gate on token pairs
.github/workflows/ci.yml       # lint + typecheck + build + contrast
docs/                     # the four sources of truth + pre-flight discipline
```

## Build state
- **Phase B0 (genesis & guardrails): code COMPLETE; gate-1 PARTIALLY verified**
  against the fresh `kvyhyeqwyafpizecfbnt` project. Scaffold, dual-client auth
  spine, admin client + loud audit util, the `ActionResult<T>` wrapper, IST
  date-utils, Maroon Meridian tokens (light+dark, 12/12 AA), CI, and docs are in.
  Build gate green: `npm audit` 0; typecheck/lint/build/contrast all pass.
  - ✅ Verified live (gate-1 GREEN): anon connectivity (health 200); service-role
    admin (200); middleware guard (`/today`,`/`,`/*` → 307 → `/login`; `/login`
    200); end-to-end auth flow (createUser → signIn → getUser validates →
    cleanup, 0 failures, self-cleaning temp user).
  - ⏳ Only open item: apply `supabase/migrations/20260530120000_b0_audit_log.sql`
    (Vicky runs SQL) + `node scripts/probe-audit.mjs` → green closes the
    audit-write probe. gate-2 (Vercel link) is Vicky's.
  - Next: **B1 — the atomic write foundation.**

### B0.6 token adjustments (logged for transparency)
The contrast checker (authorized by tokens.css §CONTRAST-NOTES "adjust if <4.5:1")
darkened two status colors and brightened dark-mode brand text so all pairs pass
WCAG AA: `--green-500` #2F7D52→#256840, `--amber-500` #B5791E→#8A5912, dark
`--color-text-on-brand` #FBF1F1→#FFFFFF.

## Hard don'ts
- Do NOT import `lib/supabase/admin` into client code (the `'server-only'` guard
  enforces this; a violation is a P0 security incident).
- Do NOT write multi-step (non-atomic) mutations.
- Do NOT hardcode any single-property value ("PN", "10 rooms", GSTIN, addresses).
- Do NOT commit secrets or `.har`/`.env*` files (AUDIT F-SEC-01 — the legacy leak).
- Do NOT push or deploy — that's Vicky's.
