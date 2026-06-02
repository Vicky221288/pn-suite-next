# KNOWN LIMITATIONS

Carried-forward items that are deliberate, scoped-out, or deferred to a later pass.
Each entry: what it is, why it's acceptable now, and when it gets addressed.

---

## KL-1 — Inventory cost column member-readable — ✅ CLOSED & verified live (hardening pass, kl1-verify ×2)

**Introduced:** W0 (`inventory_items.cost`), surfaced again in W1b.

**What:** Raw `inventory_items.cost` is readable by any org member via the
`inventory_items` SELECT RLS policy (member-of-org). Cost/margin *exposure in the
catering flow* is gated server-side — `quote_summary` and the BEO/quote surfaces
only reveal food cost + margin when the caller holds `pnl.view_margin` OR
`catering.view_cost` (see `lib/auth/capabilities.ts` → `canSeeCateringCost`).

**Why acceptable now:** the margin gate lives at the quote/BEO level (the place a
non-finance role actually looks), so derived margin never leaks through the
catering UI. A member would have to query the base `inventory_items` table
directly to read unit cost — not something the app surfaces.

**The gap:** this is *not* column-level RLS on the `cost` column itself. A
determined member with raw table access (e.g. a direct PostgREST call) can read
unit costs. Org-wide cost-column visibility hardening — masking/splitting `cost`
behind its own capability at the row/column-security layer — is a later pass, not
part of any catering sub-phase (W1a–W1e).

**Addressed by:** a future security pass (post-Wave-C), e.g. a `cost`-bearing
view + capability-gated column security, or moving cost to a side table with its
own default-deny policy.

**✅ CLOSED — `20260602070000_kl1_cost_visibility_lockdown.sql`** (column-revoke +
gated-RPC approach, approved). Three vectors closed so an operational role cannot
read raw cost by ANY path:
1. **Direct table reads** — `SELECT` on `inventory_items.cost` AND
   `purchase_order_lines.unit_cost` revoked from `authenticated`/`anon` (every
   other column re-granted). Supabase maps all logged-in users to one
   `authenticated` Postgres role, so column GRANTs are all-or-nothing → raw cost
   is unreadable directly by anyone; capability gating stays in the RPC layer.
2. **`scale_recipe`** — *found during the build* to be a SECURITY DEFINER RPC that
   returned `per_plate_cost`/`total_food_cost`/`line_cost` UNCONDITIONALLY (the
   menu scale-preview showed it to every member). Now capability-gated (cost null
   for non-privileged; scaled quantities always — production/quote internals
   unaffected; `service_role`/system path unchanged so existing harnesses pass).
3. **PO unit costs** — new `po_line_costs(p_org)` gated accessor so Owner/PM still
   see PO unit costs; ops get none.
`service_role` + SECURITY DEFINER functions (run as owner) bypass the revoke, so
the scale engine + system paths keep reading cost. The two leaky UIs
(`catering/menu/[id]`, `catering/purchase-orders`) were rewritten to the gated
paths. Proven by `scripts/kl1-verify.mjs` (×2): operative blocked on every path;
Owner/PM + engine reads intact.

---

## KL-2 — Room-dining (Stays F&B) path is intentionally minimal — ✅ CLOSED in S4

**Introduced:** W1d.

**What:** W1d proves *one kitchen / one inventory* serves both banquet (BEO-driven)
and Stays room-dining via `create_room_dining` → `close_production`, both drawing
from the same `inventory_items` ledger through `record_stock_movement`. The
room-dining path here is deliberately thin: an ad-hoc ticket with menu-item
portions and consumption draw-down — no room/folio linkage, no F&B menu/pricing
UX, no per-room running tab.

**Why acceptable now:** W1d's scope is production/purchasing/consumption against
the shared inventory. The point to prove was that the kitchen + inventory are
shared, not siloed — which the harness demonstrates. Full F&B ordering is a
Stays-domain concern.

**Addressed by:** the STAYS core wave (W4–6) — room-stay folio integration, F&B
menu/pricing, posting F&B consumption to the guest folio at 5% no-ITC (W1e wires
the GST treatment; Stays wires the folio UX).

**✅ CLOSED in S4 (`20260602050000_s4_folio_settlement_reporting.sql`):**
`post_room_dining_to_folio` wires a W1d room-dining `kitchen_ticket` onto the
guest's `room_folios`/`folio_charges` as an `fnb` line (sell amount from menu
config, idempotent per ticket). `settle_folio` bills it at rooms_fnb 5% no-ITC via
the W1e `resolve_gst` engine and posts revenue to `finance_ledger` (domain stays).
Proven by `scripts/s4-verify.mjs`: the F&B charge appears on the folio AND the
order drew inventory — one kitchen, one inventory, one guest folio.

---

## KL-3 — Execution-checklist photo-proof stores a reference, not the binary — ✅ CLOSED & verified live (hardening pass, kl3-verify ×2)

**Introduced:** W2 (execution checklists).

**What:** `event_checklist_items.photo_ref` holds a path/URL string, and
`complete_checklist_item` enforces the accountability rule — an item flagged
`requires_photo` cannot be completed without a non-empty `photo_ref` (proven by
`scripts/w2-verify.mjs`). But the actual image bytes are NOT uploaded anywhere
yet: no Supabase Storage bucket is wired, and the UI captures `photo_ref` as a
typed string (via a prompt), not a file upload.

**Why acceptable now:** the *moat* W2 set out to build is the enforced
requirement + the audit trail (who completed what, with a photo reference, when)
— that is live and tested. The binary store is an additive wiring, not a
correctness gap in the lifecycle.

**The gap:** `photo_ref` can currently point at a path that has no backing
object. There is no upload, no signed-URL retrieval, no thumbnail.

**Addressed by:** a later Storage pass — create a private `event-photos` bucket
with org-scoped RLS, swap the checklist UI to a real file upload that writes the
object and stores its key in `photo_ref`, and serve via signed URLs. Pairs
naturally with any other Storage need (e.g. signed-contract PDFs).

**✅ CLOSED — `20260602090000_kl3_storage_proof_photos.sql`.** A PRIVATE
`proof-photos` bucket (image-only, 10 MB) + org-scoped RLS on `storage.objects`
(path `{org_id}/{entity}/{id}/{file}`; policies gate on
`is_org_member((storage.foldername(name))[1]::uuid)` — same tenant isolation as
every entity). `components/photo-upload.tsx` uploads browser→Storage (RLS-gated)
and returns the object path, stored as `photo_ref` via the EXISTING W2
`complete_checklist_item` + S3 `complete_housekeeping_task` RPCs (covers BOTH
`event_checklist_items.photo_ref` and `housekeeping_tasks.photo_ref`). Retrieval
is via short-lived (60 s) signed URLs (`lib/actions/storage.ts` → `getProofPhotoUrl`;
bucket private, never public). The photo-proof gate is UNCHANGED — completion
still rejects an empty ref; the ref is now a real object key. Proven by
`scripts/kl3-verify.mjs` (×2): upload→signed-URL retrieval; private bucket; org-A
cannot touch org-B photos (RLS); both gates still enforce.

---

## KL-4 — Form C data is captured in-suite; electronic FRRO submission is deferred

**Introduced:** S2 (check-in / Form C capture).

**What:** At check-in, a foreign national's Form C dataset (passport, nationality,
DOB, visa type/number, arrived-from, intended-stay, next-destination) is captured
and stored in `form_c_records`, and check-in is **hard-gated server-side** — a
foreign-national check-in cannot complete without the required fields (proven by
`scripts/s2-verify.mjs`). This brings the legal dataset on-system with an audit
trail.

**Why acceptable now:** the operational + record-keeping obligation (collect and
retain the Form C dataset, refuse check-in without it) is met. Electronic filing
is a separate, external, credentialed integration.

**The gap:** there is NO electronic submission to the government FRRO portal
(https://indianfrro.gov.in / the Form C API). Filing is still whatever manual/
portal process the property uses today — the suite captures, it does not transmit.

**Addressed by:** a later external-integration pass — FRRO portal/API submission
with the property's registered hotel credentials, submission status tracking on
`form_c_records` (e.g. submitted_at / acknowledgement ref), and retry handling.
External-gated like the OTA/Yale integrations (W6–8+).

---

## KL-5 — M1a staff scheduling: deliberate scope trims (deferred to M1a polish / M1b)

**Introduced:** M1a (staff scheduling).

**What:** three intentional simplifications in the M1a scheduling slice, none of
which is a correctness gap in the guard/lifecycle:
1. **Assignment window is a SNAPSHOT.** `shift_assignments` copies the shift's
   `[start_at, end_at)` at assignment time so the single-table GiST `EXCLUDE` can
   enforce per-staff overlap. If a shift's time is later edited via `upsert_shift`,
   existing assignments keep the OLD window (the overlap guard then reflects the
   stale window for those rows). M1a does not re-sync assignment windows on a
   shift-time edit.
2. **Publish is one-way.** A roster goes `draft → published`; there is no
   un-publish / re-open-to-draft, and shifts cannot be added/edited once published
   (`roster_published` guard). Adding shifts to a live roster = a new draft roster
   for that period in M1a.
3. **No staff self-service.** `set_shift_assignment_status` (acknowledge, etc.) is
   manager-gated (`roster.manage`); staff acknowledging their own shift from a
   staff view is not built. Roster-published **staff notifications** are noted as a
   future hook only — B3 messaging is deliberately NOT wired in M1a (scope guard).

**Why acceptable now:** M1a's contract is "define shifts → roster → assign with a
race-proof staff double-booking guard + a guarded status lifecycle," all of which
is live and harness-proven (`scripts/m1a-verify.mjs`). The trims above are
ergonomics/additive wiring, not invariant or guard gaps.

**Addressed by:** the per-module UI-polish pass (program step 2) for re-sync on
shift edit + un-publish + a staff self-service view; B3-routed roster-published
notifications when messaging is wired. None block M1b.

---

## KL-6 — M1b: leave ⊥ shift-assignment cross-check is deferred

**Introduced:** M1b (leave + scheduling).

**What:** Approved leave (M1b `leave_requests`) and shift assignment (M1a
`shift_assignments`) are **independent** — approving a staff member's leave does
NOT auto-cancel/block their overlapping shift assignments, and assigning a shift
does NOT check whether the staff member is on approved leave for that date. The
two subsystems share the W0 `staff` entity but are not yet cross-validated.

**Why acceptable now:** M1b's contract is the four pieces (HR fields, geofenced
on-premise attendance, leave lifecycle, the generic tiered-approval primitive),
each atomic/audited/tenant-scoped and harness-proven (`scripts/m1b-verify.mjs`).
The cross-check is a coordination rule between two already-correct subsystems, not
a correctness gap in either. The TASK scoped it OUT explicitly to keep M1b a clean
increment. The staff double-booking guard (M1a GiST EXCLUDE) and the leave
approval guard both stand on their own.

**The gap:** a manager could assign a shift to someone on approved leave (or
approve leave that overlaps already-assigned shifts) with no warning or block.

**Addressed by:** a later workforce-coordination pass (per-module UI-polish, or a
small follow-up) — e.g. `assign_shift` consults approved-leave windows for the
staff/date, and `decide_leave` (on approve) flags/optionally releases overlapping
`shift_assignments`. Cleanly implementable on the existing tables (both carry
`staff_id` + a date/time range); deferred, not blocked. Does not block M2.

---

## KL-7 — M2: no SLA auto-escalation on tasks/incidents (B4 registry territory)

**Introduced:** M2 (ops execution).

**What:** M2 tasks and incidents carry priority/severity, due dates, and guarded
status lifecycles, but there is **no automated SLA escalation** — an overdue task
or an unresolved high-severity incident does not auto-notify, auto-reassign, or
auto-raise priority. The benchmark (Quore/HotSOS) has SLA timers; M2 captures the
data, not the timer.

**Why acceptable now:** M2's contract is the three ops domains (tasks, incidents,
checklist templates) with atomic/audited/tenant-scoped writes and guarded
lifecycles — all harness-proven (`scripts/m2-verify.mjs`). SLA escalation is
explicitly **automation**, which the codebase confines to the B4 rule registry
(`docs/AUTOMATION.md`) — it is NOT an M2 RPC. Adding it here would violate the
"no automation outside the registry" Hard don't.

**The gap:** overdue/unresolved items rely on a human watching the board; there is
no timed nudge.

**Addressed by:** a later B4 registry entry (atomic, idempotent, IST-anchored,
quiet-hours-aware) — e.g. `run_ops_sla` that flags overdue tasks / aging
high-severity incidents and notifies via B3 (when messaging is wired). A registry
rule + an entry, not an M2 change. The existing `tasks.due_date` /
`incidents.severity` + `status` columns already carry everything such a rule needs.
Does not block M3.

---

## KL-8 — M3-auto: recurring CRM outreach rules — ✅ CLOSED (pending apply+verify)

**Introduced:** M3 (Guest CRM enrichment). Deliberate split, M1a→M1b style.
**Closed:** M3-auto (`20260602150000_m3auto_outreach_rules.sql`) — both rules built.

**What:** M3 shipped the CRM data layer (interactions, special dates, message
templates), live LTV, the **manual** "send template to guest now" action, and
**review_requests records**. The two RECURRING / time-triggered outreach behaviours
are NOT yet built:
1. **Review-request outreach** — on event-concluded (A7), auto-create + send a
   review request once per concluded event.
2. **Special-date outreach** — daily, find guests whose anniversary/birthday
   (month/day) matches today and send the configured template, idempotent per
   (guest, special_date, year).

**Why split out (not crammed into M3):** both are AUTOMATION, which the codebase
confines to the B4 rule registry (`docs/AUTOMATION.md`) — "adding a rule = an
entry," but each of these carries real logic (concluded-event scanning + per-event
dedup; date-matching + per-year idempotency) and its own B4-style harness surface
(prove fires-once, idempotent re-tick → 0, IST-anchored, quiet-hours-aware, via
B3). Two such rules together would bloat M3. The TASK explicitly invited this
judgment call and the clean split. M3's data layer + manual send + review records
are self-contained and fully harness-proven without them.

**The gap:** outreach is manual-trigger only today; no automatic post-event review
nudge and no automatic anniversary/birthday greeting.

**✅ CLOSED — `20260602150000_m3auto_outreach_rules.sql`** (WRITTEN, not applied).
Two B4-registry rules, atomic + idempotent + IST-anchored + quiet-hours-aware,
sending ONLY via B3 `enqueue_outbound`, with per-entity subtransactions:
- **`run_review_requests`** (registry `A_review_requests`) — CONCLUDED event
  (`event_date < today_IST` AND has guest AND not cancelled) with no review request
  → reuses M3 `create_review_request` (record + B3 send). Per-event dedup via the
  M3 `review_requests` unique (org,guest,event) → re-tick = 0.
- **`run_special_date_outreach`** (registry `A_special_dates`) — `guest_special_dates`
  whose month/day = today (IST) → send the matching template (chosen by
  `message_templates.purpose = date_type`). **Per-year idempotency via the B3 key
  `special:<type>:<guest>:<YYYY>`** (no marker table — reuses `outbound_messages`
  idempotency).
Reuse-only schema: `message_templates.purpose` (nullable + per-(org,purpose)
partial unique) + `set_template_purpose` config RPC — wires which template each
rule uses; no new table. No new cron route (existing `/api/cron/tick` drives it).
Proven by `scripts/m3auto-verify.mjs` (×2) + B4/B3 regression. **CRM domain
(M3 + M3-auto) closed.**

---

## KL-9 — M4: scheduled auto-repricing deferred (M4-auto)

**Introduced:** M4 (dynamic pricing). Deliberate split — the TASK scoped v1 to
on-demand resolution only.

**What:** M4 ships the rate-rule engine (`rate_rules`) + a pure on-demand resolver
(`resolve_price`). What it does NOT do: automatically push/materialize adjusted
selling rates onto a schedule. There is no rate calendar materialization and no
scheduled re-pricing — a price is computed when someone asks (preview, or a quote/
reservation flow reading `resolve_price`), never auto-applied in the background.

**Why deferred:** scheduled auto-repricing is AUTOMATION, which the codebase
confines to the B4 rule registry (`docs/AUTOMATION.md`) — it would be a separate
phase (M4-auto) with its own atomic, idempotent, IST-anchored, quiet-hours-aware
registry rule + harness, exactly like M3-auto. Cramming a cron rule into M4 would
violate the "no automation outside the registry" Hard don't and bloat the phase.

**The gap:** rate changes take effect only where `resolve_price` is read at the
moment of quoting; there is no nightly "rebuild tomorrow's rates" job and no
materialized `rate_calendar`.

**Addressed by:** a later **M4-auto** — a B4 registry rule (e.g. `rebuild_rate_calendar`
or a per-night repricing pass) that calls the EXISTING `resolve_price` and writes
a materialized calendar / suggested rates, atomic + idempotent + IST-anchored.
The engine it needs already exists (`resolve_price`, `rate_rules`); M4-auto only
adds the scheduling. The **parked base_rate exclusive↔inclusive question** is also
NOT M4's and remains open (a separate finance decision). Neither blocks M5.

---

## KL-10 — M5: availability calendar is read-only aggregation (no materialization / no auto-release-on-confirm)

**Introduced:** M5 (date holds + availability calendar).

**What:** M5 ships the tentative-hold lifecycle + a read-only `availability_calendar`
that composes confirmed bookings/stays + active holds on demand. Two deliberate trims:
1. **No materialized availability** — the calendar is computed per request over the
   given range; there is no cached/materialized day-grid. Fine at PN's scale; a
   future perf pass could materialize if ranges get large.
2. **A hold is not auto-released when its slot is independently confirmed.** A hold
   and a confirmed booking can coexist (the hold is advisory); a converted hold is
   excluded from active holds, but a *pending* hold whose slot someone else
   confirmed directly lingers until it expires (or is released). This is by design
   (holds are advisory paint; the GiST is the authority) — not a correctness gap.
   Its `convert_hold` would simply fail at GiST (zero orphan), and the read-filter +
   `run_hold_expiry` clear it on lapse.

**Why acceptable now:** M5's contract — advisory holds that never block/become a
booking except via the delegating `convert_hold`, expiry independent of the sweep,
and a composed availability read — is fully met and harness-proven
(`scripts/m5-verify.mjs`). The trims are ergonomics/perf, not invariant gaps.

**Addressed by:** a later UI-polish / perf pass (materialized day-grid if needed)
and, optionally, a small `convert_hold`/`confirm_booking` courtesy that releases
sibling pending holds on the same slot. The data already supports both. Does not
block M6. (OTA/channel availability overlay remains W6–8, not here.)

---

## KL-11 — M6: finance back-office scope trims (no GL / bank-rec / payment rails / per-guest ageing)

**Introduced:** M6 (finance back-office).

**What:** M6 delivers expense capture → tiered approval (reusing the M1b primitive)
→ a DEBIT post to the shared `finance_ledger`, plus a collections/AR-ageing READ
over `invoices`. Deliberately NOT built:
1. **No double-entry general ledger / chart of accounts** — expenses post a single
   tagged debit to the one `finance_ledger` (invariant #10: P&L is a query). A full
   GL is out of scope (and not needed at PN's scale).
2. **No bank reconciliation / no payment execution / no payment rails.**
   `mark_expense_paid` is a status flag only; CC never moves money.
3. **Ageing is AGGREGATE buckets, not per-guest/per-customer.** ✅ **CLOSED in M8**
   — `ar_ageing_by_customer` (`20260602200000_m8_reporting_marketing.sql`) buckets
   outstanding invoices PER GUEST (0-30/31-60/61-90/90+, money-gated). M6's
   aggregate `collections_ageing` stands; M8 adds the per-customer breakdown.
4. **Input GST is captured as data only** (`expenses.input_gst_amount`/`supply_type`
   tag) — there is no input-tax-credit (ITC) computation/claim engine. The output
   GST engine (`resolve_gst`) is firewalled off entirely.

**Why acceptable now:** M6's contract — expenses on the one ledger via the reused
approval primitive, the finance firewall, and AR ageing over invoices — is fully
met and harness-proven (`scripts/m6-verify.mjs`). The trims are accounting-depth /
external-rail concerns, not invariant gaps.

**Addressed by:** later phases — the **M8 reporting leaf** consumes these ledger
entries + ageing for the consolidated P&L (and can add per-guest AR); a **payment
gateway** is a separate net-new external-lane scoping item (already noted); an ITC
engine, if ever needed, is a dedicated finance phase. None block M7.

---

## KL-12 — M7: threshold reorder only (no demand forecast; recipe-driven auto-PO not built)

**Introduced:** M7 (inventory reorder + procurement automation).

**What:** M7 ships **threshold** reorder — A11 detects `on_hand <= reorder_point`
and A12 drafts a supplier-grouped PO via the W1d path + notifies. Deliberately NOT
built:
1. **No demand forecasting / ML** — reorder fires on a static per-item threshold,
   not a forecast (MarketMan/Apicbase's predictive replenishment tier is out).
2. **No recipe-driven / booked-event auto-PO.** The wave plan's M7 sketch also
   floated an A11 variant that drafts POs from *booked-event recipe needs*
   (forward demand). M7 implements the TASK-scoped threshold reorder only; the
   recipe→requirement→PO path already exists manually in W1d
   (`generate_production` + `plan_purchase` off a signed BEO), so forward-demand
   auto-drafting would be a thin later rule reusing those, not net-new machinery.
3. **No multi-warehouse / location transfers** — single stock pool per org.
4. **Reorder draft qty is a fixed `reorder_qty`** (not target-minus-on-hand /
   economic-order-quantity). Simple and predictable for v1.

**Why acceptable now:** M7's contract — opt-in per-item reorder config, on-hand
detection from the one W0 source, idempotent supplier-grouped DRAFT POs via the
W1d path, B3 notify, all registry-driven — is met and harness-proven
(`scripts/m7-verify.mjs`). The trims are forecasting depth, not invariant gaps;
nothing here orders, receives, or moves money (manual W1d flow does).

**Addressed by:** an optional later rule (recipe/booked-event forward-demand auto-PO
reusing W1d `plan_purchase`) and, much later, a demand-forecast tier if the
business needs it. None block M8.

---

## KL-13 — M8: reporting leaf scope trims (GST-return = reporting not filing; invoice_lines-sourced; minimal marketing)

**Introduced:** M8 (reporting + marketing leaf — the final module-migration phase).

**What:** M8 ships read reports (consolidated P&L, GST-return, per-customer ageing)
+ a minimal marketing layer. Deliberately NOT built:
1. **GST-return is a REPORTING surface, not a filing one.** It assembles return
   figures from the resolved snapshot; actual GSTN/portal SUBMISSION is
   external-lane (credentialed gov filing, like FRRO/KL-4) and out of scope.
2. **GST-return reads `invoice_lines`** (the W1e/S4 per-line resolve_gst output).
   Legacy B5 *composite* invoices that carry header-level GST without
   `invoice_lines` are not included; all modern settlement paths (W1e/S4) emit
   `invoice_lines`, so this matches current production. A later tweak could union
   header-GST invoices if any legacy composite invoices need to appear.
3. **Marketing is minimal** — lead-source attribution + a simple campaign record +
   LED revenue posting to the ledger. NO marketing automation (M3-auto owns B3
   outreach), NO ML/attribution-modelling, NO LED ad-scheduling/playout, NO BI
   warehouse / accounting-software export.
4. **LED revenue posts NET** to the ledger; if a GST invoice for LED advertising
   is needed, that is the existing invoice/`resolve_gst` path — M8 sets no rate.

**Why acceptable now:** M8's contract — P&L-as-query over the one ledger, a
GST-return that reads (never recomputes) the resolve_gst output, per-customer
ageing, and a minimal real marketing leaf — is met and harness-proven
(`scripts/m8-verify.mjs`). The trims are external-filing / BI / forecasting depth,
not invariant gaps.

**Addressed by:** the external-integration lane (GSTN filing, accounting export)
and any later BI/marketing-depth phase. **This is the last module-migration
sub-phase — the wave ends here.**
