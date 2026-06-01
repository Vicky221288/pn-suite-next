# CLAUDE.md — PN Master Suite (rebuild)

**Read this first at the start of every session.** This is the load-bearing
handoff for the PN re-platform — a lean index. **Full per-phase narratives,
harness verdicts, divergence notes, and the token-adjustment log live in
`docs/BUILD-HISTORY.md`** (the proven past). This file is current state + the
rules that bind every future phase.

## What this repo is
The from-scratch rebuild of **PN Master Suite** — a multi-tenant hospitality
operating system for banquet-halls-with-rooms (first tenant: Pooranam Nachiyar
Marriage Hall + PN Stays, Red Hills, Chennai). PN Suite NXT = **ONE integrated
hospitality OS: Hall + Stays + Catering** as three views over a shared core.
**Next.js 15 (App Router) + Supabase + Vercel**, replacing the legacy
React/Vite/Cloudflare-Pages build (audited at **45/100** — see `docs/AUDIT-2.0.md`).
An **independent project** (PN's own GitHub / Supabase / Vercel / email); RHS CRM
NXT is only a *convention donor* (`docs/REUSE-ANALYSIS.md`). No shared infra,
no shared credentials.

## Infra IDs
- **Production Supabase (THIS repo, the active target):** ref `kvyhyeqwyafpizecfbnt`
  (`kvyhyeqwyafpizecfbnt.supabase.co`). All migrations and the running app point
  here (`.env.local`).
- **Legacy Supabase:** ref `rvabhitxdjeqwgkszbvs` — the OLD React/Vite build's
  project. **Untouched. A later migration SOURCE only.** Never point the rebuild
  at it; **never write to it.**
- RHS CRM NXT runs on its own separate project — no relation to either.
- **GitHub:** `Vicky221288/pn-suite-next`. **Hosting:** Vercel. **Stack:**
  Next.js 15 (App Router) + Supabase + Vercel; Maroon Meridian token layer.

## Sources of truth (read in this order)
1. **`docs/PN-Suite-NXT-OP-MODEL-v2.md` — THE GOVERNING DESIGN (supersedes v1.2).**
   Internalize Part 2 (shared core + integration invariants 7–11), Part 3 (three
   domain designs), Part 4 (the locked Wave C build sequence).
2. `docs/PN-OP-MODEL-v1.2.md` — SUPERSEDED by v2 but still valid as the shared-core
   contract (spine, atomicity, multi-tenancy, messaging, automation, GST, §12
   locked decisions all carry forward into v2).
3. `docs/LEGACY-MODULE-INVENTORY.md` — the legacy map (16 modules; what to port).
4. `docs/PN-Foundation-Wave-Build-Plan-v1.md` — the (completed) foundation-wave plan.
5. `docs/REUSE-ANALYSIS.md` — what lifts from RHS vs what's greenfield.
6. `docs/AUDIT-2.0.md` — why we're rebuilding (the finding IDs we answer to).
7. `docs/BUILD-HISTORY.md` — full detail of every completed phase (B0–B5, W0,
   W1a–e, W2, S1–S4, KL-1, KL-3).
8. `docs/KNOWN-LIMITATIONS.md` — the live KL ledger.

## Current state (wave stamp)
- **✅ FOUNDATION WAVE COMPLETE (B0–B5)** — atomic write spine, multi-tenant RLS,
  messaging, automation runtime, and the Enquiry→Quote→Booking→Event→Settlement
  vertical slice. Live on Vercel, walked end-to-end. First PN tenant seeded.
- **✅ W0 — minimal shared core** (Guest / Inventory / Staff / Finance-Ledger).
- **✅ W1 CATERING (W1a–e)** — menu/recipe/cost → enquiry/quote/package → BEO →
  production/KOT/purchasing/consumption → consolidated multi-rate GST invoice → ledger.
- **✅ W2 HALL completion** — contracts/e-sign, payment milestones, roster,
  photo-proof checklists, vendor coordination, revenue analytics.
- **✅ STAYS CORE (S1–S4)** — RoomStay + GiST double-booking guard, walk-in/
  check-in/out + Form C gate, housekeeping/room-board/maintenance, folio +
  F&B-to-folio + settlement (reuses W1e engine) + occ/ADR/RevPAR reporting.
- **✅ HARDENING (KL-1 + KL-3)** — cost-column visibility lockdown; private
  Storage bucket + signed-URL photo-proof.
- All of the above **verified live on `kvyhyeqwyafpizecfbnt`**, each proven by a
  self-cleaning, exit-coded harness run ×2 identical. Detail → `docs/BUILD-HISTORY.md`.
- **Audit findings closed-by-test:** `F-SEC-04` (cross-tenant isolation),
  `F-AUTO-01` (automation engine), `F-DATA-01` (room/hall double-booking → GiST
  EXCLUDE), `F-DATA-02` (UTC→IST dates), `F-FIN-03` (GST invoice).
- **▶ Next / not started (await go):** W6–8 channel manager; Yanolja cutover;
  legacy module migration; productization/billing/white-label; live AiSensy wiring.

## Locked decisions
- **OP MODEL v2 governs everything** (supersedes v1.2). PN Suite NXT = ONE
  integrated OS — Hall + Stays + Catering as views over a **shared core** (Guest,
  Event, RoomStay, Inventory, Finance/Ledger, Staff, Vendor, CRM, Compliance +
  the messaging/automation/slice services). Everything in v1.2 carries forward.
- **Integration invariants 7–11 (in force):** 7) one Guest, many roles; 8) one
  Event, many services; 9) one Inventory, many consumers; 10) one Ledger, many
  streams (P&L is a query, not a reconciliation); 11) domains are views + rules
  over the shared core, **never separate databases/silos**.
- **§12 #6 — Deposit is a separate escrowed liability**, NEVER on the invoice;
  discharged in `deposit_ledger`, not a revenue line, not taxed; FORFEIT ⇒
  taxable income credit.
- **§12 #9 — Hall balance due T-45**; A5 reminders fire T-50/47/45.

## GST model (NON-NEGOTIABLE)
Config-driven only. **`resolve_gst(org, supply_type)` is the ONLY place rates
live** — resolved from `supply_type` + the property's `specified_premises` flag
(on `orgs`; PN = false/non-specified). A rate is **never stored on a line or menu
item as an input** — items carry a supply-type **tag, never a rate**; a line's
`gst_rate` is the RESOLVED output snapshot.
- **Hall:** 18% w/ITC.
- **Rooms / F&B:** 5% no-ITC (→ 18% if `specified_premises`).
- **Catering:** composite 5%, SAC 9963.
- One consolidated invoice spans multiple supply-types; tax summary groups per rate;
  per-org sequential `INV-#####`.

## Non-negotiable invariants (OP MODEL §11)
1. **Every write is atomic and server-side** via the **wrapper + RPC** pattern:
   a server action (`lib/actions/wrapper.ts` → `ActionResult<T>` + two-write
   audit) wrapping a **single atomic Postgres RPC**. NEVER a multi-step client write.
2. **Every automated action is idempotent and audited.**
3. **No hardcoded single-property values** — everything is `org_id`/tenant-config.
4. **Foundation before services** — identity/tenancy/automation/billing spine
   first; rooms/kitchen/vendor modules hang off it after.
5. **Money operations always write a ledger entry + audit trail.**
6. **Port domain logic, not architecture** — re-express PN's rules on the new
   atomic, multi-tenant, server-side foundation; never copy old client patterns.

## Working posture / conventions (standing rules)
- Every CC prompt: **CONTEXT + STOP markers + RESUME** (standing rule).
- All writes via the wrapper+RPC pattern. No exceptions.
- Reads use the RLS-enforced user client; writes use the `'server-only'` admin
  client (`lib/supabase/admin.ts`) **after** authorization, **always** scoped by
  `org_id`. Run the **5-step pre-flight** (`docs/PRE-FLIGHT-5-STEP.md`) before any
  schema change.
- **CC never deploys, never pushes, never runs SQL.** Vicky reviews, runs SQL,
  pushes, deploys.
- Phase-by-phase: complete a phase, print its RESUME line, **stop and wait**. A
  phase exits only when its exit criterion is **demonstrably** met — a passing,
  self-cleaning, exit-coded harness run **×2 identical**, not a claim.
- CLAUDE.md is persistent project memory, updated every phase; detail archives to
  `docs/BUILD-HISTORY.md`.

## Where things live
```
app/                      # App Router
  (app)/                  # authenticated surfaces (today = the command screen)
  login/                  # email+password sign-in
  auth/signout/route.ts   # sign-out handler
  layout.tsx, globals.css, tokens.css   # Maroon Meridian token layer
lib/
  supabase/{client,server,admin,middleware}.ts   # dual-client trust model
  actions/{types,wrapper,ping,booking}.ts  # ActionResult<T> + wrapper + ping + booking.confirm
  audit/emit.ts           # loud two-write audit util
  today/date-utils.ts     # IST-correct dates (fixes AUDIT F-DATA-02)
  auth/{context,authorize,capabilities}.ts  # session→org+capabilities gate (F-SEC-04)
  env.ts                  # lazy, validated env access
components/ui/, components/*   # token-driven primitives
scripts/                  # per-phase *-verify.mjs harnesses + probes
.github/workflows/ci.yml       # lint + typecheck + build + contrast
docs/                     # sources of truth + BUILD-HISTORY + pre-flight discipline
```

## Open / deferred
- **KL-2 — CLOSED in S4** (`post_room_dining_to_folio`). KL-1, KL-3 — CLOSED
  (hardening pass). **KL-1, KL-2, KL-3 are done; the live KL ledger is
  `docs/KNOWN-LIMITATIONS.md`.**
- **KL-4 (Form C → FRRO e-submission): OPEN** — parked in the external-integration
  lane (credentialed gov-portal filing). Form C is captured in-suite today.
- **External-integration lane / standing lead-time clocks (OPEN — start now):**
  **Yale API** access scoping · **Yanolja export** scoping (CSV/API for
  reservations/guests/rates/OTA-mappings/folios) · live **AiSensy** (WhatsApp/Meta)
  wiring · payment-gateway choice · OTA credentials · **UI-polish pass** (spine
  screens are minimal-but-real; deferred per-module pass against the maroon
  Meridian tokens).
- **W6–8 — STAYS channel manager** (Yanolja-replacement core: real-time two-way
  OTA sync + booking engine), run in parallel with Yanolja.
- **W8+ — Yanolja cutover** = its own slow sub-project: **parallel-run → switch
  ONE OTA at a time → gradual; NEVER a hard flip** (a dropped reservation is a
  real guest at the door — highest-risk operation in the program).
- **Later:** CRM frills (LTV/anniversary/reviews), Compliance/renewals tracker.

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
