# BUILD-HISTORY.md — PN Master Suite (rebuild)

**Archive of completed-phase detail.** This file holds the full per-phase build
records, harness verdicts, divergence notes, and the one-off token-adjustment log.
It exists so `CLAUDE.md` can stay a lean index. **`CLAUDE.md` remains the
load-bearing handoff** (current state, standing rules, locked decisions, infra
IDs, open items, the GST model, and the Hard don'ts). Read that first; come here
only for the detail behind a completed phase.

Nothing in here is live working memory — it is the proven past. Every phase below
was verified live on `kvyhyeqwyafpizecfbnt` and is **COMPLETE ✅** unless its own
text says otherwise.

---

## FOUNDATION WAVE (B0–B5) — COMPLETE ✅

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

### Audit findings closed-by-test (Foundation wave)
First PN tenant seeded (`scripts/seed-pn-tenant.mjs`). Audit findings
**closed-by-test:** `F-SEC-04` (cross-tenant isolation), `F-AUTO-01` (no
automation → the rule engine), `F-DATA-01` (room/hall double-booking → GiST
EXCLUDE), `F-DATA-02` (UTC→IST dates), `F-FIN-03` (no GST invoice → composite-5%).

---

## WAVE C — module build (sequence LOCKED, OP MODEL v2 Part 4)

### W0 — minimal shared core: COMPLETE ✅ — verified live on kvyhyeqwyafpizecfbnt
Four shared-core entities on the proven pattern (atomic RPC + org-scoped
default-deny RLS + audit + auth.uid() self-auth): **guests** (dedup by phone+name;
family on one phone stays distinct; `find_or_create_guest` + atomic audited
`merge_guests`), **inventory_items + inventory_movements** (atomic
`record_stock_movement`, in/out/adjust, no-negative guard; cost gross of input
GST), **staff** (profile; user_id→auth.users, capabilities stay in org_members —
no identity dup), **finance_ledger** (`write_ledger`, supply-type + source-domain
tags — invariant #10). Migration `20260531233000_w0_shared_core.sql` WRITTEN, not
applied. Minimal Guest UI (`/guests` + `/guests/[id]`, search/create/merge).
typecheck/lint/build green.
- ✅ `scripts/w0-verify.mjs` passes twice identical (exit 0, self-cleaning):
  find-or-create idempotency, family-distinctness (2 names/1 phone), atomic+
  audited merge (merged rows re-creatable), atomic stock movement (over-draw
  rejected, on-hand unchanged), tagged ledger write, and cross-tenant isolation
  (RLS read + RPC self-auth) on all four entities.

### W1 — CATERING (the ~2-week clock = the new manager's domain): COMPLETE ✅ — all of W1a–e verified live on kvyhyeqwyafpizecfbnt
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
  *(KL-1 subsequently CLOSED — see Hardening pass below.)*
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
  *(KL-2 subsequently CLOSED in S4 — see Stays core below.)*
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

### W2 — HALL completion: COMPLETE ✅ — verified live on kvyhyeqwyafpizecfbnt (w2-verify ×2, exit 0)
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
   *(KL-3 subsequently CLOSED — see Hardening pass below.)*
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

### W4–6 — STAYS core (sub-phased S1–S4; in-suite PMS, NO OTA/Yale/Yanolja yet)

- **S1 — RoomStay foundation + double-booking guard: COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt (s1-verify ×2, exit 0).
  Room inventory + the reservation lifecycle + the race-proof overlap guard.
  Tables: `room_types` (config-driven `base_rate`; **GST NOT applied here — 5%
  no-ITC is S4 folio**), `rooms` (placeholder status; housekeeping is S3),
  `room_stays` (reuses the **shared W0 Guest** via find_or_create_guest;
  status reserved→checked_in→checked_out→settled + cancelled/no_show branches,
  guarded transitions). **THE GUARD** = B1 GiST-EXCLUDE replicated:
  `exclude using gist (org_id =, room_id =, daterange(check_in, check_out, '[)') &&)
  where (room_id is not null and status in ('reserved','checked_in'))`. The
  half-open `[)` makes **same-day turnover** (checkout day = next check-in)
  NOT a conflict; only ACTIVE stays block (cancelled/no_show/checked_out free
  the dates). **This fixes legacy F-DATA-01 (unguarded room booking) in-suite.**
  RPCs: upsert_room_type, create_room, set_room_status, create_room_stay
  (reuses Guest; GiST rejects overlap atomically), assign_room, set_room_stay_status
  (guarded graph). Migration `20260601230000_s1_roomstay_foundation.sql` APPLIED.
  UI: /stays (rooms+types) /stays/reservations (create/list/cancel).
  typecheck/lint/build green. Scope guard: NO walk-in/check-in/Form C/folio (S2–S4).
  - Harness `scripts/s1-verify.mjs` (run ×2): overlap rejected; **same-day
    turnover allowed**; full boundary matrix (contained/partial rejected,
    adjacent/gap allowed); cancelled/no_show don't block; different rooms OK;
    shared Guest reused; transitions guarded; atomicity on failure; org isolation; audited.
- **S2 — walk-ins + check-in/out + Form C: COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt (s2-verify ×2, exit 0).
  Guest-movement layer on the S1 reservation. ALTER `room_stays` +
  `checked_in_at`/`checked_out_at`/`is_foreign`. NEW `form_c_records` (FRRO
  dataset, one per stay, stay+guest-linked). RPCs: `create_walk_in` (stay
  created + immediate check-in in one atomic RPC; still subject to the S1 GiST
  guard + Form C gate; reuses shared Guest), `check_in_stay` (RESERVED→CHECKED_IN,
  assigns room if unassigned, timestamps; **Form C gate** — foreign-national
  check-in REJECTED server-side via `pn_form_c_complete` unless passport +
  nationality + DOB + visa# + arrived-from present; domestic = no friction),
  `check_out_stay` (CHECKED_IN→CHECKED_OUT, timestamp only — **NO money; SETTLED
  is S4**). Migration `20260602010000_s2_frontdesk_formc.sql` WRITTEN, not
  APPLIED. UI: /stays/frontdesk (walk-in + check-in w/ conditional Form C panel
  + check-out). **Form C is captured only — electronic FRRO submission deferred,
  logged docs/KNOWN-LIMITATIONS.md KL-4.** typecheck/lint/build green. Scope:
  NO housekeeping/room-status (S3), NO folio/billing (S4).
  - Harness `scripts/s2-verify.mjs` (run ×2): walk-in → checked-in (guard holds
    on occupied room); RESERVED→CHECKED_IN timestamped, cancelled rejected;
    Form C gate (foreign w/o fields rejected, incomplete rejected, complete
    stored; domestic none); CHECKED_IN→CHECKED_OUT timestamped, non-checked-in
    rejected; shared Guest reused; org isolation; atomicity; audited.
- **S3 — housekeeping + room status board + maintenance: COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt (s3-verify ×2, exit 0).
  **TWO INDEPENDENT DIMENSIONS** (modelled separately, not collapsed):
  *occupancy* DERIVED from S1 room_stays (a checked_in stay = occupied,
  never stored) + *housekeeping* STORED on the room
  (`rooms.housekeeping_status` clean/dirty/inspected/out_of_order). **Sellable =
  in-service (rooms.status='available') AND vacant AND hk ∈ (inspected,clean).**
  Tables: `housekeeping_tasks` (turns; assignable to W0 staff; **W2 photo-proof
  gate** reused), `maintenance_requests` (open→in_progress→resolved, priority,
  assignable). RPCs: set_housekeeping_status, create/assign/complete_housekeeping_task
  (complete → room inspected/clean; photo-required rejected w/o ref),
  create_maintenance_request, set_maintenance_status (guarded), set_room_out_of_order
  / restore_room, `room_board` (READ: occupancy+housekeeping+sellable grid).
  **CHECK-OUT→DIRTY MECHANISM CHOICE: extended the S2 `check_out_stay` RPC INLINE
  (CREATE OR REPLACE, same atomic tx) — NOT a DB trigger, NOT a B4 async rule.
  Rationale: same-tx atomicity+audit, write logic in one discoverable RPC, the
  codebase uses explicit RPCs (no triggers); a B4 rule would be eventual (wrong
  for an on-checkout side-effect).** Migration `20260602030000_s3_housekeeping_maintenance.sql`
  APPLIED. UI: /stays/housekeeping (board + turn queue + maintenance).
  typecheck/lint/build green. Scope: NO folio/billing or occupancy/revenue
  reporting (S4).
  - Harness `scripts/s3-verify.mjs` (run ×2): occupancy⊥housekeeping independence;
    checkout→dirty+turn task; turn assign→complete (photo-proof gate) → inspected/
    clean; maintenance lifecycle + OOO not-sellable; sellable formula; org
    isolation; atomicity; audited.
- **S4 — folio + F&B-to-folio + settlement + reporting: COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt (s4-verify ×2, exit 0). **🎉 STAYS CORE (S1–S4) COMPLETE & verified live.**
  The Stays-core closer. `room_folios` (one per stay) + `folio_charges`
  (room_night/fnb/other, tagged rooms_fnb). **NO parallel billing path** —
  settlement REUSES the W1e engine: same `invoices`/`invoice_lines` tables
  (invoices ALTERed +stay_id + supply_type 'folio'), `resolve_gst('rooms_fnb')`
  for the rate (5% no-ITC; 18% if specified — never hardcoded), and W1e
  `settle_invoice` for the `finance_ledger` posting (rooms_fnb → domain stays;
  its deposit branch is booking-gated so it cleanly skips for a stay invoice).
  **KL-2 CLOSED:** `post_room_dining_to_folio` wires a W1d room-dining
  `kitchen_ticket` onto the guest folio as an `fnb` line (sell amount from menu
  config; idempotent) — one kitchen / one inventory / one folio. RPCs:
  add_folio_charge, post_room_nights (nights × rate_quoted; idempotent),
  post_room_dining_to_folio, `settle_folio` (assembles invoice via resolve_gst,
  reuses settle_invoice, stay CHECKED_OUT→SETTLED, deposit shown as discharge
  not revenue, idempotent, Owner/PM-gated), `stays_report` (occupancy%/ADR/RevPAR
  + revenue-by-stream; revenue margin-gated, occupancy counts visible).
  Migration `20260602050000_s4_folio_settlement_reporting.sql` APPLIED.
  UI: /stays/folio (charges + F&B + settle) /stays/reporting (occ/ADR/
  RevPAR). typecheck/lint/build green.
  - Harness `scripts/s4-verify.mjs` (run ×2): room-night charge at rate; room-
    dining → F&B line on folio + drew inventory (KL-2); settle @5% no-ITC
    (resolved, premises-flip changes rate) → ledger stream=stays → SETTLED;
    deposit discharge not revenue; occupancy 35%/ADR 5000/RevPAR 1750; revenue
    gated; idempotent settle; org isolation; audited.

  *Built while Yanolja still runs live.*

### Internal hardening pass (KL-1 + KL-3)

- **KL-1 — cost-column visibility lockdown: COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt (kl1-verify ×2, exit 0).
  Approach (approved): **column-revoke + gated RPC**, INCLUDING `purchase_order_lines.unit_cost`.
  The one security-sensitive schema change. Closes 3 cost-leak vectors so an
  operational role cannot read raw cost by ANY path: (1) `SELECT` on
  `inventory_items.cost` + `purchase_order_lines.unit_cost` revoked from
  authenticated/anon (other cols re-granted; one `authenticated` role → column
  GRANTs all-or-nothing → cap gating stays in RPCs); (2) **`scale_recipe`
  found leaking cost unconditionally** (menu scale-preview showed it to all
  members) — now capability-gated (cost null for non-priv; quantities always;
  service_role/system path unchanged so W1a/W1b/W1d harnesses still pass);
  (3) new `po_line_costs` gated accessor. SECURITY DEFINER fns + service_role
  bypass the revoke → scale engine intact. Leaky UIs (catering/menu/[id],
  catering/purchase-orders) rewritten to gated paths. Migration
  `20260602070000_kl1_cost_visibility_lockdown.sql` APPLIED.
  typecheck/lint/build green. **docs/KNOWN-LIMITATIONS.md KL-1 → CLOSED.**
  - Harness `scripts/kl1-verify.mjs` (run ×2): operative blocked on direct
    select / embed / unit_cost / scale_recipe (all paths); safe columns still
    read; Owner/PM + service_role engine cost reads intact; quote_summary still
    gated; org isolation.
- **KL-3 — Storage for photo-proof: COMPLETE ✅ — verified live** on kvyhyeqwyafpizecfbnt (kl3-verify ×2, exit 0).
  PRIVATE `proof-photos` bucket (migration: `insert into storage.buckets`
  public=false, image-only, 10 MB cap) + org-scoped RLS on `storage.objects`
  (path `{org_id}/{entity}/{id}/{file}`; policies gate on
  `is_org_member((storage.foldername(name))[1]::uuid)` — same tenant isolation
  as every entity). Photos served via **short-lived signed URLs** (60 s,
  `lib/actions/storage.ts` `getProofPhotoUrl`; bucket private, never public
  links). `components/photo-upload.tsx` uploads browser→Storage (RLS-gated) and
  returns the object path, passed as `photo_ref` into the EXISTING W2
  `complete_checklist_item` + S3 `complete_housekeeping_task` RPCs (the photo
  metadata write still goes through the action layer; only the binary goes
  direct-to-Storage under RLS). `components/view-photo-link.tsx` opens via
  signed URL. Wired into `checklist-actions` (W2) + `housekeeping-board` (S3),
  replacing the old `window.prompt` ref. **The photo-proof gate is UNCHANGED** —
  completion still rejects an empty `photo_ref`; the ref is now a real object
  key. Migration `20260602090000_kl3_storage_proof_photos.sql` APPLIED.
  typecheck/lint/build green. **docs/KNOWN-LIMITATIONS.md KL-3 → CLOSED.**
  - Harness `scripts/kl3-verify.mjs` (run ×2): upload→path→signed-URL retrieval;
    bucket private (public URL fails); org-A member cannot sign/download/upload
    org-B photos (RLS isolation); W2 + S3 gates still reject no-ref and accept a
    real uploaded path; self-cleaning (removes objects + orgs).
- **🔒 HARDENING PASS (KL-1 + KL-3) COMPLETE & verified live.** Remaining KL: KL-4
  (Form C → FRRO e-submission), parked in the external-integration lane with
  Yale/OTA.

---

## MODULE MIGRATION WAVE (M1a–M8) — sequence LOCKED
Plan: `docs/PN-Module-Migration-Wave-Plan.md` (16 legacy modules = 4 DONE / 5
PARTIAL / 7 GAP; sequence M1a → M1b → M2 → M3 → M4 → M5 → M6 → M7 → M8,
benchmarked, not re-skinned). **M1a–M3-auto are APPLIED + VERIFIED LIVE on
`kvyhyeqwyafpizecfbnt`** — each proven by a self-cleaning, exit-coded harness run
×2 identical. M4–M8 not started.

### M1a — staff scheduling: COMPLETE ✅
Port of the legacy Shifts module, benchmarked vs **Deputy / 7shifts**. Reuses W0
`staff` (no parallel person record) + the W2 `event_staff` roster PATTERN,
generalized to calendar shifts. Tables: `shift_templates` (recurring;
days_of_week 0–6), `staff_rosters` (draft→published), `shifts` (concrete; IST
wall-clock window; idempotent template expansion), `shift_assignments` (lifecycle
scheduled→acknowledged→completed + cancelled/no_show; **THE GUARD** = B1/S1 GiST
`EXCLUDE (org_id =, staff_id =, tstzrange(start_at,end_at,'[)') &&) where status in
active` → no overlapping staff double-booking; half-open ⇒ adjacent allowed;
cancelled/no_show free the slot). RPCs: `upsert_shift_template`, `create_roster`,
`generate_shifts_from_template`, `upsert_shift`, `publish_roster`, `assign_shift`,
`set_shift_assignment_status`, `roster_board` (read; draft hidden from non-managers).
Manager capability **`roster.manage`** gates every write. UI `/scheduling`. Migration
`20260602110000_m1a_staff_scheduling.sql` (+ fix `20260602113000_m1a_fix_oncflict.sql`:
the `generate_shifts_from_template` ON CONFLICT needed the partial-index predicate
`where template_id is not null` to match `uq_shift_template_date`). Deferrals → KL-5.
Harness `scripts/m1a-verify.mjs` (×2): template→2 shifts/7-day window + idempotent
re-gen; assign + guarded lifecycle (illegal txn rejected); overlap REJECTED /
adjacent allowed / cancelled+no_show free; atomicity (rejected overlap = 0 partial
rows); draft hidden from operative, visible after publish; shared W0 staff reused;
capability gate; org isolation both directions; audited. Scope guards: NO
attendance/geofence, NO leave/HR, NO approval, NO payroll, NO messaging.

### M1b — attendance + leave + HR + GENERIC tiered-approval: COMPLETE ✅
Benchmarked vs **greytHR / Connecteam**. Reuses W0 `staff` (HR fields ALTER, no
parallel person). **(A) HR fields** — `staff` gains `employee_code` (org-unique),
`date_of_joining`, `designation`, `employment_type`
(full_time/part_time/contract/temporary), `email`; RPC `set_hr_fields` (cap
`staff.manage`). NO payroll/pay/salary. **(B) Geofenced on-premise attendance
(DPDP)** — `attendance_geofences` (per-org property centre+radius, manager-set,
never a PN literal) + `attendance_records` (`on_premise` boolean + timestamp +
optional M1a `shift_id`) — **NO lat/long column anywhere**; the DEVICE evaluates
the fence (`lib/geo.ts` `withinGeofence`) and sends ONLY the boolean
(`record_attendance`); raw coordinates never reach nor persist on the server.
`set_geofence` (cap `staff.manage`). **(C) Leave** — `leave_requests`
(request→pending→approved/rejected, guarded, audited); `request_leave` (open to
members; first consumer of the primitive) + `decide_leave` (cap `approval.decide`;
syncs leave status). **(D) GENERIC tiered-approval primitive** — `approval_requests`
(**polymorphic `(request_type, subject_id)` — NO leave_id FK**, so M6 plugs in
`request_type='expense'` unchanged) + `approval_decisions` (distinct per-approver,
no double-vote); `submit_approval_request` (open) + `decide_approval` (cap
`approval.decide`; anti-self-approval; `required_approvals` tiers → approved; reject
terminal; guarded from pending). New caps `staff.manage` + `approval.decide`. UI
`/staff`. Migration `20260602120000_m1b_attendance_leave_approval.sql`. Deferral →
KL-6 (leave↔shift-assignment cross-check). Harness `scripts/m1b-verify.mjs` (×2):
HR on same staff row (no dup); geofence per-org + on_premise true/false + **NO
coordinate column persisted**; leave approve+reject guarded (illegal txn rejected);
primitive polymorphic (no leave_id col) + multi-tier + distinct-approver +
anti-self-approval; approver capability gate; org isolation both directions;
atomicity (required_approvals=0 → leave insert rolls back with the approval insert,
zero partial rows); audited.

### M2 — ops execution (tasks + incidents + checklist-TEMPLATE engine): COMPLETE ✅
Benchmarked vs **Quore / Amadeus HotSOS · Xenia**. **(A) Tasks** — `tasks`
(create→assign→guarded open→in_progress→done +cancelled, priority, due_date,
assignee = W0 `staff`) with a **POLYMORPHIC** spine link `(entity_type, entity_id)`
— no FK soup, both-or-neither CHECK, validated via `pn_entity_exists` over
event/room/room_stay/booking. RPCs `create_task`/`assign_task`/`set_task_status`.
**(B) Incidents** — `incidents` (distinct domain: report→in_progress→resolved
+cancelled, severity, resolution + resolved_at, same polymorphic link), generalizing
the S3 maintenance shape; `report_incident` (open to any member) +
`set_incident_status` (cap). **(C) Checklist-TEMPLATE engine — REUSE SEAM:**
`checklist_templates` + `checklist_template_items` (the template layer Module 7
lacked) + a provenance `event_checklists.template_id` ALTER (the ONLY touch to
execution tables); `generate_checklist_from_template` emits a W2 execution checklist
**INTO the existing `event_checklists`/`event_checklist_items`** — NO new execution
table, NO re-implemented completion/photo-proof; completion stays on the UNCHANGED
W2 `complete_checklist_item` (KL-3 Storage photo-proof intact). New cap **`ops.manage`**
gates create/assign/resolve/template work; reporting an incident is open to members.
UI `/ops`. Migration `20260602130000_m2_ops_execution.sql`. Deferral → KL-7 (no SLA
auto-escalation; a later B4 registry entry). Harness `scripts/m2-verify.mjs` (×2):
task create→assign→guarded lifecycle + polymorphic link resolves + dangling/
unknown-type rejected; incident report (operative allowed)→guarded resolve +
severity, distinct table; template GENERATES into `event_checklists`/`_items` w/
template_id provenance, requires_photo carried, **W2 completion + KL-3 photo-proof
gate intact**, **NO parallel execution table**; capability gates; org isolation;
atomicity (null-label item → delete+reinsert rolls back together); audited.

### M3 — Guest CRM enrichment: COMPLETE ✅
Benchmarked vs **Revinate / Salesforce Hospitality**. All on the SHARED W0 `guests`
entity (invariant #7). **(A) Interactions** — `guest_interactions` timeline
(`log_interaction`). **(B) LTV computed LIVE** — `guest_ltv` read RPC sums
`finance_ledger` credit revenue (hall/stays/catering) for invoices resolving to the
guest via event/stay (invariant #10: a QUERY, **no stored ltv column**); gated by
`pnl.view_margin`. **(C) Special dates** — `guest_special_dates` (`set_special_date`,
data only). **(D) Templates** — `message_templates` (org config; `function_area`
routes the B3 sender; `{{placeholder}}` body) + `pn_render_template`;
`upsert_message_template`. **(E) Sending — STRICT B3 FIREWALL:**
`send_template_to_guest` (manual, now) + `create_review_request` (records
`review_requests` + sends) route through the B3 `enqueue_outbound` **ONLY**
(idempotent + quiet-hours-aware; per-(org,function_area) sender) — no new send path,
no wa.me. New cap **`crm.manage`** gates CRM writes + sends. UI: enriched
`/guests/[id]` + `/crm` template manager. Migration `20260602140000_m3_guest_crm.sql`.
**SPLIT (M1a→M1b discipline):** the two recurring outreach rules deferred to M3-auto
(KL-8). Harness `scripts/m3-verify.mjs` (×2): interactions on same W0 guest (no dup)
+ ordered; LTV live (hall→100k, +stays→150k) + **no ltv column** + gated; special
dates store/upsert; placeholder render; **B3 firewall** — send lands in
`outbound_messages`, idempotent, quiet-hours deferral, **no parallel send table**;
review_requests recorded + idempotent per (guest,event); capability gates; org
isolation; atomicity (no-sender → review record rolls back); audited.

### M3-auto — recurring CRM outreach (two B4 registry rules): COMPLETE ✅ — CRM DOMAIN CLOSED (KL-8)
Two rules deferred from M3, as declarative B4-registry entries (`A_review_requests`,
`A_special_dates`) + atomic, idempotent, IST-anchored, quiet-hours-aware rule RPCs
sending via B3 — same shape as `run_sla_escalations`. **`run_review_requests`**
(per-org, every tick): each CONCLUDED event (`event_date < today_IST` AND `guest_id`
present AND not cancelled) with no review request → reuses M3 `create_review_request`;
per-event dedup via the M3 `review_requests` uniqueness → re-tick = 0.
**`run_special_date_outreach`** (per-org, every tick): each `guest_special_dates`
whose month/day = today (IST) → sends the matching template; **per-year idempotency
via the B3 key `special:<type>:<guest>:<YYYY>`** (no marker table). Both send ONLY
via `enqueue_outbound` (deferred drains via `drain_outbound`); per-entity
subtransactions isolate a bad recipient. **REUSE-ONLY schema:** nullable
`message_templates.purpose` + per-(org,purpose) partial unique + `set_template_purpose`
config RPC (cap `crm.manage`); template-manager UI gains a purpose selector. NO new
cron route (existing `/api/cron/tick` drives it). Migration
`20260602150000_m3auto_outreach_rules.sql`. Harness `scripts/m3auto-verify.mjs` (×2):
review concluded→1/re-tick→0/future→0 + B3 enqueue to right recipient; special-date
match→1/re-tick→0/non-match→0/next-year→1 + **IST anchoring** (a Jun-15 date fires
under IST when UTC is still Jun-14, Jun-14 control does not); quiet-hours defer→drain;
registry-driven (+ cron auth when exercised); per-entity isolation; org isolation;
audited. B4/B3 regression green (new rules only ADD registry entries).

---

## B0.6 token adjustments (logged for transparency)
The contrast checker (authorized by tokens.css §CONTRAST-NOTES "adjust if <4.5:1")
darkened two status colors and brightened dark-mode brand text so all pairs pass
WCAG AA: `--green-500` #2F7D52→#256840, `--amber-500` #B5791E→#8A5912, dark
`--color-text-on-brand` #FBF1F1→#FFFFFF.
