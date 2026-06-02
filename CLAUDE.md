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
   W1a–e, W2, S1–S4, KL-1/KL-3, and the module-migration wave M1a–M3-auto).
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
  M4 → M5 → M6 → M7 → M8** (benchmarked, not re-skinned). Per-phase detail (objects,
  guards, harness assertions) → `docs/BUILD-HISTORY.md`.
  - **✅ M1a–M1b — WORKFORCE domain.** Staff scheduling (shifts/roster/assignment;
    GiST staff-overlap guard; cap `roster.manage`) + attendance (geofenced
    on-premise **boolean only**, no coords) / leave / HR fields / **generic
    polymorphic tiered-approval primitive** (`approval_requests`, reused by M6;
    caps `staff.manage`, `approval.decide`).
  - **✅ M2 — OPS EXECUTION.** Tasks + incidents (polymorphic spine link) +
    checklist-TEMPLATE engine that generates INTO the existing W2 execution tables
    (no fork; KL-3 photo-proof intact); cap `ops.manage`. Deferral → KL-7 (SLA
    auto-escalation = later B4 entry).
  - **✅ M3 + M3-auto — CRM domain CLOSED.** Interactions, **live LTV** (ledger
    query, no stored column), special dates, message templates, **manual + recurring
    outreach via the B3 firewall ONLY** (review-request + special-date rules as B4
    registry entries; cap `crm.manage`). KL-8 closed.
  - M1a–M3-auto **applied + verified live on `kvyhyeqwyafpizecfbnt`** — each
    `scripts/m{1a,1b,2,3,3auto}-verify.mjs` passed ×2 identical (exit 0, self-cleaning).
  - **▶ M4 — DYNAMIC PRICING (selling price only): COMPLETE ✅ pending apply+verify.**
    Benchmarked vs **Cloudbeds PIE / Mews rate management**. One table `rate_rules`
    (org-scoped declarative rules: subject_type room_type|hall + optional subject_id;
    condition `always`/`date_range`/`day_of_week`/`occupancy`; adjustment `percent`
    stacks / `absolute` = terminal override; `priority`; active). RPCs
    `upsert_rate_rule` / `set_rate_rule_active` (cap **`pricing.manage`**) +
    **`resolve_price`** (pure READ, member-open: applies matching active rules in
    deterministic priority order → PRE-TAX effective selling price + an ordered
    fired/not-fired breakdown). **THE GST FIREWALL is STRUCTURAL:** `resolve_price`
    reads only {base, rate_rules, date, occupancy}; `resolve_gst` reads only
    {specified_premises, supply_type} — disjoint inputs, no shared table, no call
    edge, so neither can move the other. `resolve_price` returns NO rate/gst/tax
    field. **base_rate is untouched** (read as an opaque pre-tax base; no exclusive↔
    inclusive conversion — that question stays parked). NO materialized calendar, NO
    scheduled auto-application (deferred → KL-9 / M4-auto). UI `/pricing`
    (`components/pricing-manager.tsx`, `lib/actions/pricing.ts`). Migration
    `supabase/migrations/20260602160000_m4_dynamic_pricing.sql` **WRITTEN, NOT
    APPLIED**. typecheck/lint/build green. Exit harness `scripts/m4-verify.mjs`
    (run ×2): rule applies + breakdown; deterministic stacking + terminal override;
    conditions gate in/out (all three types); **GST firewall both directions**
    (rule change moves price not GST rate; premises flip moves GST rate not price;
    no tax field in output); base_rate untouched; capability gate (resolve_price
    member-open); org isolation both directions; atomicity (negative-absolute
    rejected → 0 rows); audited.
  - **▶ M5 — DATE HOLDS + AVAILABILITY CALENDAR: COMPLETE ✅ pending apply+verify.**
    Benchmarked vs **Oracle OPERA / Cloudbeds calendar**. Table `date_holds` (soft,
    advisory, expiring; polymorphic hall|stays subject; **NO GiST EXCLUDE / NO
    overlap-unique** → holds never block holds or confirms). RPCs `place_hold` /
    `release_hold` / `convert_hold` (cap **`hold.manage`**) + `availability_calendar`
    (member-open READ) + B4 registry rule **`run_hold_expiry`** (`A_hold_expiry`,
    per-org/every-tick). **THE HOLD/GiST SEAM is STRUCTURAL:** a hold creates no
    `date_blocks`/`room_stays` row, so the B1/S1 GiST EXCLUDE never sees it; the
    ONLY mutation to `converted` is `convert_hold`, which **delegates** to the
    existing `confirm_booking` / `create_room_stay` — GiST decides, and a conflict
    (23P01) rolls back the convert leaving the hold pending (zero orphan, F-DATA-01
    stays closed). **EXPIRY belt-and-suspenders:** mandatory `expires_at` + every
    read filters `expires_at > now()` (correctness independent of the sweep) + the
    idempotent `run_hold_expiry` sweep. UI `/calendar` (`components/holds-calendar.tsx`,
    `lib/actions/holds.ts`). Migration
    `supabase/migrations/20260602170000_m5_date_holds_calendar.sql` **WRITTEN, NOT
    APPLIED**. typecheck/lint/build green. Exit harness `scripts/m5-verify.mjs`
    (run ×2): hold created (no GiST row); two holds coexist; hold doesn't block a
    confirm; convert delegates → real booking/stay; conflicting convert rejected by
    GiST + hold unchanged (zero orphan); lapsed hold ignored by reads pre-sweep then
    swept (idempotent); release + guarded transitions; calendar composes confirmed +
    active holds (converted/expired excluded); stays delegate (success + GiST
    conflict); capability gates (incl. hold.manage-without-booking.confirm can't
    convert a hall hold); org isolation both directions; atomicity; audited.
    **B4/B3 regression run alongside — `run_hold_expiry` only ADDS a registry entry.**
  - **▶ M6 — FINANCE BACK-OFFICE: COMPLETE ✅ pending apply+verify.** Benchmarked
    vs **Zoho Books/Expense · SAP Concur**. Tables `expense_categories` + `expenses`
    (payee = W1d `vendors` reuse; `supply_type`/`input_gst_amount` are DATA tags
    only). **(A) Expense ledger** — on approval the expense POSTS a DEBIT to the
    EXISTING W0 `finance_ledger` via `write_ledger` (supply_type tag `expense`,
    source_domain hall|stays|catering|core, linked to the expense) — NO parallel
    ledger; P&L stays a query. **(B) Tiered approval REUSES the M1b primitive** —
    `submit_expense` → `submit_approval_request(request_type='expense', subject=expense)`;
    `decide_expense` → `decide_approval` (anti-self / distinct-approver / multi-tier
    inherited; on reaching threshold → atomic decide+post; reject → no post). NO new
    approval table. **(C) Collections/ageing** — `collections_ageing` READ over the
    EXISTING `invoices` (outstanding = status issued ∧ coalesce(amount_due,total)>0,
    bucketed 0-30/31-60/61-90/90+); NO new AR table; money figures gated by
    `pnl.view_margin`, counts member-visible. **FINANCE FIREWALL:** M6 never touches
    `resolve_gst` / invoices / the revenue path; input GST is recorded data, never
    resolved; ledger debit = expense amount exactly. New cap **`expense.manage`**
    (decide reuses `approval.decide`; ageing money reuses `pnl.view_margin`).
    `mark_expense_paid` is status-only (NO payment execution). UI `/finance`
    (`components/finance-manager.tsx`, `lib/actions/finance.ts`). Migration
    `supabase/migrations/20260602180000_m6_finance_backoffice.sql` **WRITTEN, NOT
    APPLIED**. typecheck/lint/build green. Deferral → KL-11. Exit harness
    `scripts/m6-verify.mjs` (run ×2): submit reuses the SAME approval tables as
    request_type=expense (no expense-approval table); inherited multi-tier/distinct/
    anti-self; approve→ledger debit / reject→no post; firewall (no invoice touched,
    input GST data, debit = amount); P&L-as-query (one ledger nets revenue−expense);
    ageing buckets + coalesce + paid-drops-out + money gating; capability gates; org
    isolation both directions; atomicity (required_approvals=0 → expense rolls back
    to draft); audited.
  - **▶ M7 — INVENTORY REORDER + PROCUREMENT AUTOMATION: COMPLETE ✅ pending
    apply+verify.** Benchmarked vs **MarketMan / Apicbase** (threshold reorder; no
    ML forecast). Mostly B4-registry wiring over W0 inventory + W1d purchasing.
    **Config:** `inventory_items.reorder_point` made NULLABLE (NULL = NOT monitored;
    legacy default-0 backfilled → NULL = opt-in) + new `reorder_qty`;
    `set_reorder_point` (cap **`inventory.manage`**) sets both (a monitored item
    needs a positive qty). **Rule `run_reorder_check`** (registry **`A_reorder`**,
    per-org/every-tick): A11 detects `quantity_on_hand <= reorder_point` reading the
    EXISTING W0 field (no parallel on-hand) → A12 drafts into the EXISTING W1d
    `purchase_orders`/`purchase_order_lines` (status `draft`, new `source='reorder'`
    tag, grouped by supplier — the W1d PO path, no parallel table) + ONE B3 manager
    notify (`enqueue_outbound`, idempotent per-org-per-day + quiet-hours-aware).
    **Idempotent:** an item already in an OPEN draft reorder PO is skipped; once that
    draft leaves `draft` (ordered/received) the item re-drafts if still short. DRAFT
    ONLY — no ordering/receiving/payment (manual W1d flow). UI `/inventory`
    (`components/inventory-reorder.tsx`, `lib/actions/inventory.ts`; KL-1-safe column
    selection). Migration `supabase/migrations/20260602190000_m7_inventory_reorder.sql`
    **WRITTEN, NOT APPLIED**. typecheck/lint/build green. Deferral → KL-12. Exit
    harness `scripts/m7-verify.mjs` (run ×2): NULL not monitored; detect <= point /
    not > point; supplier-grouped draft via W1d (no parallel table); on-hand from W0
    drives detection; idempotent re-tick → 0; re-draft after order; B3 notify sent
    (day) / deferred (night); capability gate; org isolation both directions;
    atomicity (qty 0 rejected, unchanged); audited.
    **B4/B3 regression run alongside — A_reorder only ADDS a registry entry.**
  - **▶ M8 — REPORTING + MARKETING LEAF (final sub-phase): COMPLETE ✅ pending
    apply+verify.** Benchmarked vs **Oracle OPERA reporting / Revinate Marketing**.
    The leaf — reads what every prior phase wrote. **(A) `consolidated_pnl`** — pure
    READ over the ONE `finance_ledger`: revenue credits − expense debits (incl. M6)
    by source_domain (hall/stays/catering/core); NO stored P&L (invariant #10);
    money gated. **(B) `gst_return_report`** — READ-ONLY over the resolve_gst OUTPUT
    snapshot on `invoice_lines` (output tax by rate) + input GST as DATA from
    expenses; **GST FIREWALL: never calls resolve_gst, never recomputes/stores a
    rate, never alters invoices** (a `specified_premises` flip does NOT change the
    reported snapshot). Reporting only — GSTN filing is external-lane. **(C)
    `ar_ageing_by_customer`** — per-guest AR buckets (0-30/31-60/61-90/90+) over
    outstanding invoices → **closes KL-11** (M6 ageing was aggregate-only); money
    gated. **(D) Marketing leaf** — `campaigns` + `leads.campaign_id` ALTER (reuses
    existing `leads.source`; no parallel lead store) + `led_bookings` whose revenue
    posts to the EXISTING `finance_ledger` via `write_ledger` (supply_type 'led',
    core stream; M8 sets NO rate); RPCs `upsert_campaign`/`set_lead_source`/
    `lead_source_report`/`record_ad_revenue`. NO marketing automation (M3-auto owns
    outreach), NO ML, NO ad scheduling. New cap **`marketing.manage`** (report money
    gated by `pnl.view_margin`). UI `/reports` (`components/reports-view.tsx`,
    `lib/actions/reporting.ts`). Migration
    `supabase/migrations/20260602200000_m8_reporting_marketing.sql` **WRITTEN, NOT
    APPLIED**. typecheck/lint/build green. Deferral → KL-13. Exit harness
    `scripts/m8-verify.mjs` (run ×2): P&L nets M6 expense by stream + no stored
    table + gated; GST firewall (snapshot rates; premises-flip doesn't change report;
    invoices unaltered) + input GST data; per-customer ageing + settled-drops-out +
    gated; marketing (lead source + conversions + campaign tie + LED → existing
    ledger, no parallel ledger); capability gates; org isolation both directions;
    atomicity (negative LED → 0 rows); audited.
  - **🎉 MODULE-MIGRATION WAVE (M1a–M8) STRUCTURALLY COMPLETE pending apply+verify.**
    16 legacy modules now re-expressed on the shared spine (4 were already DONE pre-wave;
    M1a–M8 closed the 5 PARTIAL + 7 GAP). Wave-complete stamp lands once Vicky applies
    M8 + `scripts/m8-verify.mjs` passes ×2.
- **▶ Next / not started (await go):** M4-auto (scheduled auto-repricing, KL-9);
  per-module UI-polish pass (program step 2); W6–8 channel manager; Yanolja cutover;
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
