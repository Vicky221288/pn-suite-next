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
- **▶ MODULE MIGRATION WAVE — plan LOCKED** (`docs/PN-Module-Migration-Wave-Plan.md`):
  16 legacy modules = 4 DONE / 5 PARTIAL / 7 GAP; sequence **M1a → M1b → M2 → M3 →
  M4 → M5 → M6 → M7 → M8** (benchmarked, not re-skinned).
  - **M1a — staff scheduling: COMPLETE ✅ pending apply+verify.** Port of the legacy
    Shifts module, benchmarked vs **Deputy / 7shifts**. Reuses W0 `staff` (no
    parallel person record) + the W2 `event_staff` roster PATTERN, generalized to
    calendar shifts. Tables: `shift_templates` (recurring; days_of_week 0–6),
    `staff_rosters` (draft→published), `shifts` (concrete; IST wall-clock window;
    idempotent template expansion), `shift_assignments` (lifecycle scheduled→
    acknowledged→completed + cancelled/no_show; **THE GUARD** = B1/S1 GiST
    `EXCLUDE (org_id =, staff_id =, tstzrange(start_at,end_at,'[)') &&) where status
    in active` → no overlapping staff double-booking; half-open ⇒ adjacent allowed;
    cancelled/no_show free the slot). RPCs: `upsert_shift_template`, `create_roster`,
    `generate_shifts_from_template`, `upsert_shift`, `publish_roster`, `assign_shift`,
    `set_shift_assignment_status`, `roster_board` (read; draft hidden from
    non-managers). Manager capability **`roster.manage`** gates every write
    (`lib/auth/capabilities.ts`). All atomic+audited+tenant-scoped (RLS default-deny
    + `auth.uid()` self-auth). UI `/scheduling` (`components/scheduling-manager.tsx`,
    `lib/actions/scheduling.ts`). Migration
    `supabase/migrations/20260602110000_m1a_staff_scheduling.sql` **WRITTEN, NOT
    APPLIED**. typecheck/lint/build green. Deferrals → `docs/KNOWN-LIMITATIONS.md`
    **KL-5**. Exit harness `scripts/m1a-verify.mjs` (run ×2): template→2 shifts over
    a 7-day window + idempotent re-gen; assign + guarded lifecycle (illegal txn
    rejected); overlap REJECTED / adjacent allowed / cancelled+no_show free the
    slot; atomicity (rejected overlap = 0 partial rows); draft hidden from
    operative, visible after publish; shared W0 staff reused; capability gate; org
    isolation both directions; audited. Scope guards held: NO attendance/geofence,
    NO leave/HR, NO approval, NO payroll, NO messaging (all M1b/later).
  - **M1b — attendance + leave + HR + GENERIC tiered-approval: COMPLETE ✅ pending
    apply+verify.** Benchmarked vs **greytHR / Connecteam**. Reuses W0 `staff`
    (HR fields ALTER, no parallel person). **(A) HR fields** — `staff` gains
    `employee_code` (org-unique), `date_of_joining`, `designation`,
    `employment_type` (full_time/part_time/contract/temporary), `email`; RPC
    `set_hr_fields` (cap `staff.manage`). NO payroll/pay/salary. **(B) Geofenced
    on-premise attendance (DPDP)** — `attendance_geofences` (per-org property
    centre+radius, manager-set, never a PN literal) + `attendance_records`
    (`on_premise` boolean + timestamp + optional M1a `shift_id`) — **NO lat/long
    column anywhere**; the DEVICE evaluates the fence (`lib/geo.ts`
    `withinGeofence`) and sends ONLY the boolean (`record_attendance`); raw
    coordinates never reach nor persist on the server. `set_geofence` (cap
    `staff.manage`). **(C) Leave** — `leave_requests` (request→pending→approved/
    rejected, guarded, audited); `request_leave` (open to members; first consumer
    of the primitive) + `decide_leave` (cap `approval.decide`; syncs leave status).
    **(D) GENERIC tiered-approval primitive** — `approval_requests`
    (**polymorphic `(request_type, subject_id)` — NO leave_id FK**, so M6 plugs in
    `request_type='expense'` unchanged) + `approval_decisions` (distinct per-approver,
    no double-vote); `submit_approval_request` (open) + `decide_approval`
    (cap `approval.decide`; anti-self-approval; `required_approvals` tiers →
    `approvals_count` reaches it ⇒ approved; reject terminal; guarded from
    pending). New caps `staff.manage` + `approval.decide` (`lib/auth/capabilities.ts`).
    All atomic+audited+tenant-scoped (RLS default-deny + `auth.uid()` self-auth).
    UI `/staff` (`components/workforce-manager.tsx`, `lib/actions/workforce.ts`).
    Migration `supabase/migrations/20260602120000_m1b_attendance_leave_approval.sql`
    **WRITTEN, NOT APPLIED**. typecheck/lint/build green. Deferral → KL-6
    (leave↔shift-assignment cross-check). Exit harness `scripts/m1b-verify.mjs`
    (run ×2): HR on same staff row (no dup); geofence per-org + on_premise
    true/false + **NO coordinate column persisted**; leave approve+reject guarded
    (illegal txn rejected); primitive polymorphic (no leave_id col) + multi-tier +
    distinct-approver + anti-self-approval; approver capability gate; org isolation
    both directions; atomicity (required_approvals=0 → leave insert rolls back with
    the approval insert, zero partial rows); audited. Scope guards held: NO raw
    coordinate storage, NO payroll, NO leave↔assignment cross-check (KL-6), NO B3
    messaging, NO M2 scope.
  - **M2 — ops execution (tasks + incidents + checklist-TEMPLATE engine):
    COMPLETE ✅ pending apply+verify.** Benchmarked vs **Quore / Amadeus HotSOS ·
    Xenia**. **(A) Tasks** — `tasks` (create→assign→guarded open→in_progress→done
    +cancelled, priority, due_date, assignee = W0 `staff`) with a **POLYMORPHIC**
    spine link `(entity_type, entity_id)` — no FK soup, both-or-neither CHECK,
    validated via `pn_entity_exists` over event/room/room_stay/booking (same
    discipline as M1b's `(request_type, subject_id)`). RPCs `create_task`/
    `assign_task`/`set_task_status`. **(B) Incidents** — `incidents` (distinct
    domain: report→in_progress→resolved +cancelled, severity, resolution +
    resolved_at, same polymorphic link), generalizing the S3 maintenance shape;
    `report_incident` (open to any member) + `set_incident_status` (cap). **(C)
    Checklist-TEMPLATE engine — REUSE SEAM:** `checklist_templates` +
    `checklist_template_items` (the template layer Module 7 lacked) + a provenance
    `event_checklists.template_id` ALTER (the ONLY touch to execution tables);
    `generate_checklist_from_template` emits a W2 execution checklist **INTO the
    existing `event_checklists`/`event_checklist_items`** — NO new execution table,
    NO re-implemented completion/photo-proof. Completion stays on the UNCHANGED W2
    `complete_checklist_item` (KL-3 Storage photo-proof intact). `upsert_checklist_template`
    manages templates. New cap **`ops.manage`** gates create/assign/resolve/template
    work; reporting an incident is open to members. All atomic+audited+tenant-scoped
    (RLS default-deny + `auth.uid()` self-auth). UI `/ops`
    (`components/ops-manager.tsx`, `lib/actions/ops.ts`). Migration
    `supabase/migrations/20260602130000_m2_ops_execution.sql` **WRITTEN, NOT
    APPLIED**. typecheck/lint/build green. Deferral → KL-7 (no SLA auto-escalation;
    that's a later B4 registry entry). Exit harness `scripts/m2-verify.mjs` (run
    ×2): task create→assign→guarded lifecycle (illegal txn rejected) + polymorphic
    link resolves + dangling/unknown-type rejected; incident report (operative
    allowed)→guarded resolve + severity, distinct table; template GENERATES into
    `event_checklists`/`_items` w/ template_id provenance, requires_photo carried,
    **W2 completion + KL-3 photo-proof gate intact** (no-ref rejected, ref accepted),
    **NO parallel execution table**; capability gates; org isolation both
    directions; atomicity (null-label item → delete+reinsert rolls back together,
    zero partial change); audited. Scope guards held: NO new execution tables, NO
    re-implemented completion/photo-proof, NO B3 messaging, NO SLA escalation (KL-7),
    NO M3 scope.
  - **M3 — Guest CRM enrichment: COMPLETE ✅ pending apply+verify.** Benchmarked
    vs **Revinate / Salesforce Hospitality**. All on the SHARED W0 `guests` entity
    (invariant #7). **(A) Interactions** — `guest_interactions` timeline (`log_interaction`).
    **(B) LTV computed LIVE** — `guest_ltv` read RPC sums `finance_ledger` credit
    revenue (hall/stays/catering) for invoices resolving to the guest via
    event/stay (invariant #10: a QUERY, **no stored ltv column**); gated by
    `pnl.view_margin`. **(C) Special dates** — `guest_special_dates`
    (`set_special_date`, data only). **(D) Templates** — `message_templates`
    (org config; `function_area` routes the B3 sender; `{{placeholder}}` body) +
    `pn_render_template`; `upsert_message_template`. **(E) Sending — STRICT B3
    FIREWALL:** `send_template_to_guest` (manual, now) + `create_review_request`
    (records `review_requests` + sends) route through the B3 `enqueue_outbound`
    **ONLY** (idempotent + quiet-hours-aware 21:00–07:00 IST; per-(org,function_area)
    sender) — no new send path, no wa.me. New cap **`crm.manage`** gates CRM writes
    + sends; LTV gated by `pnl.view_margin`. All atomic+audited+tenant-scoped (RLS
    default-deny + `auth.uid()` self-auth). UI: enriched `/guests/[id]`
    (`components/guest-crm.tsx`) + `/crm` template manager
    (`components/template-manager.tsx`); `lib/actions/crm.ts`. Migration
    `supabase/migrations/20260602140000_m3_guest_crm.sql` **WRITTEN, NOT APPLIED**.
    typecheck/lint/build green.
    - **SPLIT (M1a→M1b discipline):** the two RECURRING outreach rules
      (review-request on event-concluded; special-date anniversary/birthday) are
      AUTOMATION → B4 registry, each non-trivial with its own harness surface, so
      **DEFERRED to M3-auto** (KL-8). M3's data layer + manual send + review
      records stand alone and are fully verified without them.
    - Exit harness `scripts/m3-verify.mjs` (run ×2): interactions on the same W0
      guest (no dup) + ordered timeline; LTV live from the ledger (hall→100k,
      +stays→150k) + **no ltv column** + gated; special dates store/upsert;
      template placeholder render; **B3 firewall** — manual send lands in
      `outbound_messages`, idempotent (same key → one row), quiet-hours deferral,
      **no parallel send table**; review_requests recorded + idempotent per
      (guest,event); capability gates; org isolation both directions; atomicity
      (no-sender → review record rolls back, zero partial rows); audited. Scope
      guards held: NO stored LTV, NO direct/wa.me send (B3 only), NO live AiSensy,
      NO M4 scope.
  - **Next:** **M3-auto** (the two B4-registry outreach rules) OR **M4** (dynamic
    pricing) — per Vicky's call — after apply+verify of M3.
- **▶ Next / not started (await go):** M3-auto (deferred outreach rules, KL-8);
  rest of module migration (M4–M8); W6–8 channel manager; Yanolja cutover;
  productization/billing/white-label; live AiSensy wiring.

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
