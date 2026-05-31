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
1. **`docs/PN-Suite-NXT-OP-MODEL-v2.md` — THE GOVERNING DESIGN (supersedes v1.2).**
   PN Suite NXT = ONE integrated hospitality OS: **Hall + Stays + Catering** over a
   shared core. Internalize Part 2 (shared core + integration invariants 7–11),
   Part 3 (three domain designs), Part 4 (the locked Wave C build sequence).
2. `docs/PN-OP-MODEL-v1.2.md` — SUPERSEDED by v2 but still valid as the shared-core
   contract (spine, atomicity, multi-tenancy, messaging, automation, GST, §12
   locked decisions all carry forward into v2).
3. `docs/LEGACY-MODULE-INVENTORY.md` — the legacy map (16 modules; what to port).
4. `docs/PN-Foundation-Wave-Build-Plan-v1.md` — the (completed) foundation-wave plan.
5. `docs/REUSE-ANALYSIS.md` — what lifts from RHS vs what's greenfield.
6. `docs/AUDIT-2.0.md` — why we're rebuilding (the finding IDs we answer to).

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
  `GET /api/cron/tick` (`vercel.json` = `30 1 * * *` = 07:00 IST daily on Hobby —
  pinned to the A10 window; restore `0 * * * *` hourly on Pro. SLA-escalation
  granularity is daily on Hobby — see `docs/AUTOMATION.md`. `/api/cron` public in
  middleware; locked-500 without `CRON_SECRET`) → **rule registry** (`lib/automation/registry.ts`,
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

## Wave status (stamp)
- **✅ FOUNDATION WAVE COMPLETE (B0–B5)** — live on Vercel, walked end-to-end by a
  human. First PN tenant seeded (`scripts/seed-pn-tenant.mjs`). Audit findings
  **closed-by-test:** `F-SEC-04` (cross-tenant isolation), `F-AUTO-01` (no
  automation → the rule engine), `F-DATA-01` (room/hall double-booking → GiST
  EXCLUDE), `F-DATA-02` (UTC→IST dates), `F-FIN-03` (no GST invoice → composite-5%).
- **🧭 OP MODEL v2 LOCKED — governs everything now (supersedes v1.2).**
  `docs/PN-Suite-NXT-OP-MODEL-v2.md`. PN Suite NXT = **ONE integrated hospitality
  OS** — Hall + Stays + Catering as three views over a **shared core** (Guest,
  Event, RoomStay, Inventory, Finance/Ledger, Staff, Vendor, CRM, Compliance +
  the B3/B4/B5 services). Everything in v1.2 (spine, atomicity, multi-tenancy,
  messaging, automation, GST) carries forward as that shared core.
  - **Integration invariants 7–11 (new, in force):** 7) one Guest, many roles;
    8) one Event, many services; 9) one Inventory, many consumers; 10) one Ledger,
    many streams (P&L is a query, not a reconciliation); 11) domains are views +
    rules over the shared core, **never separate databases/silos**.
- **▶ WAVE C — module build, sequence LOCKED (v2 Part 4):**
  - **W0 — minimal shared core: COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt. Four shared-core
    entities on the proven pattern (atomic RPC + org-scoped default-deny RLS +
    audit + auth.uid() self-auth): **guests** (dedup by phone+name; family on one
    phone stays distinct; `find_or_create_guest` + atomic audited `merge_guests`),
    **inventory_items + inventory_movements** (atomic `record_stock_movement`,
    in/out/adjust, no-negative guard; cost gross of input GST), **staff** (profile;
    user_id→auth.users, capabilities stay in org_members — no identity dup),
    **finance_ledger** (`write_ledger`, supply-type + source-domain tags —
    invariant #10). Migration `20260531233000_w0_shared_core.sql` WRITTEN, not
    applied. Minimal Guest UI (`/guests` + `/guests/[id]`, search/create/merge).
    typecheck/lint/build green.
    - ✅ `scripts/w0-verify.mjs` passes twice identical (exit 0, self-cleaning):
      find-or-create idempotency, family-distinctness (2 names/1 phone), atomic+
      audited merge (merged rows re-creatable), atomic stock movement (over-draw
      rejected, on-hand unchanged), tagged ledger write, and cross-tenant isolation
      (RLS read + RPC self-auth) on all four entities.
    - Next: **W1 Catering** (sub-phased; see below).
  - **W1 — CATERING (the ~2-week clock = the new manager's domain): COMPLETE ✅ — all of W1a–e verified live on kvyhyeqwyafpizecfbnt.**
    Port the legacy Kitchen donor + benchmark structure; **port-and-extend, NOT
    greenfield.** Sub-phase plan:
    - **W1a — menu/recipe/cost foundation: COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt.
      `catering_menu_items` + `catering_recipes` + `catering_recipe_lines`
      (recipe lines link W0 `inventory_items`). `scale_recipe` RPC = the auto-scale
      + cost engine: **linear** (per-plate, continuous) / **batch** (round UP to
      whole batches) / **no-recipe → empty (not error)**; costs roll up from LIVE
      `inventory_items.cost` (never stored/stale; gross of input GST). `upsert_menu_item`
      + `set_recipe` (atomic + audited). Items carry a **supply-type TAG, never a
      rate** (config-driven GST). Migration `20260601090000_w1a_catering_menu_recipe.sql`
      WRITTEN, not applied. UI `/catering/menu` + `/catering/menu/[id]` (list /
      recipe / scale-preview). typecheck/lint/build green.
      - ✅ `scripts/w1a-verify.mjs` passes twice identical (exit 0, self-cleaning):
        linear ×500 exact, batch round-UP (230/50→5), no-recipe→empty, per-plate
        cost = Σ line costs (₹84) + total at N (₹42k), live inventory-cost
        flow-through (320→400 ⇒ ₹100/₹50k), org isolation, audited writes.
    - **W1b — enquiry → quote → package: COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt.
      `catering_enquiries` (create-or-LINKS a Guest via W0 find_or_create_guest —
      no dup), `catering_packages` + `_items` (reusable menu+price templates),
      `catering_quotes` + `_lines` (selling stored point-in-time). RPCs:
      `create_catering_enquiry`, `upsert_package`, `create_quote` (explicit lines
      OR package pre-fill), `quote_summary` (read; **margin/cost capability-gated
      server-side** — Owner/PM via `pnl.view_margin` OR Catering-Lead via
      `catering.view_cost`; selling always visible; cost computed LIVE via W1a
      scale_recipe). NOT posted to the finance ledger (that's W1e). Migration
      `20260601120000_w1b_catering_enquiry_quote.sql` WRITTEN, not applied. UI:
      /catering/enquiries(+[id] quote builder) /catering/quotes/[id] /catering/packages.
      typecheck/lint/build green.
      - ✅ `scripts/w1b-verify.mjs` passes twice identical (exit 0, self-cleaning):
        Guest create-then-LINK (no dup), quote compute (sell 99000 / cost 20700 /
        margin 78300), cost-drift moves margin (→73500) but NOT selling, package
        pre-fill, margin gate (Owner+Catering-Lead see, operative doesn't), org
        isolation, audited writes.
    - **W1c — BEO (Banquet Event Order): COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt (w1c-verify ×2, exit 0).
      BEO attaches to the **shared `events` spine** — one wedding = one Event (no
      parallel catering-only event object). `events` ALTERed: `booking_id`/`slot`
      → nullable, ADD `guest_id` + `event_type`, so a standalone catering job lives
      on the spine. `generate_beo` reuses the Guest's existing Event for the date
      (e.g. a Hall event) or creates one. Tables: `catering_beos` (beo_type
      kitchen|foh, version, status draft→sent→signed, **guest_count vs distinct
      guest_guarantee** — the contracted billable min for W1e, dietary_flags pulled
      from the Guest, signature name/at/method) + `catering_beo_lines` (menu
      snapshot from the accepted quote). RPCs: `accept_quote`, `generate_beo`
      (versioned; multiple BEOs per event), `update_beo` (**rejected once signed —
      immutable**), `send_beo`, `sign_beo` (terminal + records signature). All
      atomic + audited + tenant-scoped. Migration
      `20260601150000_w1c_catering_beo.sql` APPLIED. UI:
      /catering/beo (generate from accepted quote) + /catering/beo/[id] (view, mark
      sent, capture signature); Accept-quote button on /catering/quotes/[id].
      Cost-visibility carve-out logged in **`docs/KNOWN-LIMITATIONS.md` (KL-1)** —
      raw `inventory_items.cost` is member-readable; margin gate is at quote/BEO
      level, not column-level RLS; org-wide cost-column hardening is a later pass.
      - Harness `scripts/w1c-verify.mjs` (run ×2): accepted quote → BEO on shared
        Event (NEW spine event, and SAME event when the Guest already has a Hall
        event), guest_count distinct from guest_guarantee, kitchen+FOH BEOs on one
        event, dietary from Guest, send→sign→signed records signature, signed BEO
        rejects edits (immutable), org isolation, audited.
    - **W1d — production/KOT + purchasing + consumption: COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt (w1d-verify ×2, exit 0).
      First catering sub-phase that **MOVES REAL STOCK** — every inventory change
      routes through the W0 `record_stock_movement` RPC (NO parallel stock path).
      **NEWLY WIRED:** `vendors` table + the FK on `inventory_items.supplier_id`
      (a W0 forward-ref since W0). Tables: `kitchen_tickets` (KOT; source_type
      banquet|room_dining — one banquet ticket per BEO via partial unique index),
      `kitchen_ticket_lines`, `production_consumption` (planned + actual per
      ingredient → variance), `purchase_orders` + `_lines`. RPCs: `generate_production`
      (from a SIGNED BEO; scales each dish via W1a `scale_recipe` × **max(guest_count,
      guest_guarantee)** — never under-produce — and **consolidates shared
      ingredients** across dishes), `create_room_dining` (Stays F&B, no BEO — proves
      one kitchen/one inventory), `plan_purchase` (shortfall = requirement − on-hand →
      DRAFT POs **grouped by supplier**; idempotent replan), `order_purchase_order`,
      `receive_purchase_order` (stock **IN** via record_stock_movement; re-receive
      rejected), `close_production` (consumption **OUT**; **IDEMPOTENT** — non-open
      ticket rejected, no double-deduct; over-draw rejected by W0 → tx rollback,
      on-hand unchanged), `production_variance` (READ; variance + cost **gated** to
      pnl.view_margin OR catering.view_cost, nulled for operatives), `upsert_vendor`.
      Migration `20260601170000_w1d_production_purchasing_consumption.sql` APPLIED.
      UI: /catering/production (+/[id] requirement/variance/plan/close)
      + /catering/purchase-orders (order→receive). Billing/invoice stays OUT (W1e).
      Room-dining kept minimal — logged in **docs/KNOWN-LIMITATIONS.md (KL-2)**.
      - Harness `scripts/w1d-verify.mjs` (run ×2): production at max(count,guarantee)
        with consolidated oil across PBM+Biryani; shortfall→2 POs grouped by S1/S2;
        receive increments on-hand via record_stock_movement (audited) + re-receive
        rejected; close decrements; **2nd close rejected — no double-deduct**;
        over-draw rejected (ghee unchanged); room-dining draws same ledger; variance
        +cost shown to Owner / nulled for operative; org isolation; audited.
    - **W1e — consolidated multi-rate GST invoice: COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt (w1e-verify ×2, exit 0).
      The catering loop closer — most accounting-sensitive phase. ONE invoice over
      the shared Event spanning up to 3 supply-types. **Config-driven GST engine
      `resolve_gst(org, supply_type)`** is the ONLY place rates live — resolved
      from supply_type + the property's `specified_premises` flag (NEW column on
      `orgs`; PN = false/non-specified), **never stored on a line or menu item as
      an input**: hall 18% w/ITC, rooms/F&B 5% no-ITC (→18% if specified), catering
      composite 5% (SAC 9963). **EXTENDED the B5 invoices engine** (no parallel
      path): `invoices` gained event_id/tax_summary/deposit_applied/amount_due +
      `supply_type 'consolidated'` + nullable booking_id/gst_rate/sac; new
      `invoice_lines` (per-stream; gst_rate is the RESOLVED output snapshot). RPCs:
      `generate_consolidated_invoice` (per-line rate via engine; **catering billed
      on max(actual_count, guarantee)** pulled from the BEO; multi-rate tax summary
      grouped per rate; per-org sequential INV-#####; idempotent per Event; deposit
      SHOWN applied → amount_due = total − deposit), `settle_invoice` (posts
      realized REVENUE per stream to W0 `write_ledger` tagged supply_type+domain
      hall→hall/rooms_fnb→stays/catering→catering; **deposit = escrowed liability
      §12#6 — discharged in deposit_ledger, NOT a finance_ledger revenue line, NOT
      taxed; FORFEIT ⇒ taxable income credit**; Owner/PM-gated; idempotent).
      Migration `20260601190000_w1e_consolidated_gst_invoice.sql` APPLIED.
      UI: /catering/invoice (+/[id]) generate / per-line + tax summary +
      deposit + due / settle. typecheck/lint/build green.
      - Harness `scripts/w1e-verify.mjs` (run ×2): 3 rates resolved from supply_type
        (flag flip changes rooms/F&B 5→18 — proves not hardcoded); catering on
        max(200,250)=250; tax summary groups 18%/5%; deposit discharge not revenue/
        not taxed, amount_due correct; settle posts revenue per stream + deposit to
        deposit_ledger; forfeit → taxable income; per-org seq; Owner/PM gate; org
        isolation; audited.
    - ✅ **CATERING DOMAIN (W1a–e) COMPLETE & verified live** — enquiry→quote→
      package→BEO→production/KOT→purchasing→consumption→consolidated GST invoice→
      ledger, all on the shared Guest/Event/Inventory/Ledger core.
  - **W2 — HALL completion: COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt (w2-verify ×2, exit 0).
    Hall is NOT greenfield — the spine already does enquiry→quote→booking→event→
    settlement, atomic date-blocking, deposit-as-liability, composite GST. W2
    completes all SIX named gaps (dependency-ordered), reusing proven primitives:
    1. **Contracts/e-sign** — `hall_contracts`, **REUSES the W1c e-sign lifecycle**
       (draft→sent→signed, versioned, immutable-once-signed). *Divergence:* keyed
       to `booking_id` (not event/beo_type); adds terms+clauses+contract_value
       snapshot; signed→change = new version (old superseded). RPCs generate/send/
       sign/update_contract_terms.
    2. **Payment milestones** — `payment_milestones` (advance@confirm + balance due
       **T-45**, §12 #9). **REUSES B4 A5 `run_rent_reminders`** (already fires
       T-50/47/45) for messaging — NOT rebuilt; W2 adds only the records + due/paid/
       overdue. RPCs set_payment_schedule / mark_milestone_paid / refresh_milestone_overdue.
    3. **Resource scheduling** — `event_staff` roster (**REUSES W0 staff**); B1
       date_block GiST already prevents slot double-booking (this is the human
       roster + read view). RPCs assign_event_staff / set_event_staff_status.
    4. **Execution checklists** — `event_checklists` + `_items` with **photo-proof**
       (requires_photo → completion REJECTED without a photo_ref — the accountability
       moat). *Divergence:* photo_ref stores a path/URL; binary upload to Supabase
       Storage DEFERRED (no bucket wired yet — logged **docs/KNOWN-LIMITATIONS.md
       KL-3**). RPCs create_event_checklist / complete_checklist_item.
    5. **Vendor coordination** — `event_vendors` (**REUSES W1d vendors**); service_type
       + amount + commission_amount + status. RPCs assign_event_vendor / set_event_vendor_status.
    6. **Revenue analytics** — `hall_analytics` READ RPC over `finance_ledger` hall
       stream (realized revenue + pipeline + bookings-by-status + occupancy-by-slot);
       revenue figures **margin-gated** (pnl.view_margin), counts always visible.
    Migration `20260601210000_w2_hall_completion.sql` APPLIED. UI:
    /hall (analytics + bookings + events), /hall/bookings/[id] (contract + milestones),
    /hall/events/[id] (roster + checklists + vendors). typecheck/lint/build green.
    NONE deferred — all six built (only Storage binary-upload for photos is a later
    wiring; photo_ref is captured now). Reuse-divergences flagged above.
    - Harness `scripts/w2-verify.mjs` (run ×2): contract from confirmed booking +
      immutable-once-signed + supersede + non-confirmed rejected; balance due T-45 +
      paid/overdue; roster assign+status; checklist photo-proof enforced; vendor
      linked w/ commission; analytics reads ledger hall stream + margin-gated; org
      isolation; audited.
  - **W4–6 — STAYS core (NEXT after W2 verifies)** (RoomStay lifecycle **+ apply the
    B1 GiST double-booking guard to `room_bookings`**, walk-ins, check-in/out +
    Form C, housekeeping, folio 5% no-ITC, Yale lock integration) — built while
    Yanolja still runs live.
  - **W6–8 — STAYS channel manager** (the Yanolja-replacement core: real-time
    two-way OTA sync + booking engine), **run in parallel with Yanolja.**
  - **W8+ — Yanolja cutover** = its own slow sub-project: **parallel-run → switch
    ONE OTA at a time → gradual; NEVER a hard flip** (a dropped reservation is a
    real guest at the door — highest-risk operation in the program).
  - **Later:** CRM frills (LTV/anniversary/reviews), Compliance/renewals tracker.
- **Deferred gates / standing lead-time clocks (OPEN — start now):** **Yale API
  access** scoping · **Yanolja export** scoping (CSV/API for reservations/guests/
  rates/OTA-mappings/folios) · live **AiSensy** (WhatsApp/Meta) · payment-gateway
  choice · OTA credentials · **UI-polish pass** (spine screens are minimal-but-real).

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
