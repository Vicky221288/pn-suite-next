# PN Suite NXT — Module Migration Wave Plan (M0)

**Status:** PLAN ONLY — awaiting Vicky review + lock before M1a. No schema, no
migrations, no RPCs, no UI were written for this phase. This document is the
sequencing artifact for the **module-migration wave** (program step 1 of 5:
module migration → per-module UI polish → W6–8 channel manager → external lane →
productization).

**Method of record:** every DONE/PARTIAL/GAP call below is cited against the
*live* spine on `kvyhyeqwyafpizecfbnt` — actual tables (`supabase/migrations/*`),
RPCs, and routes (`app/(app)/*`). No hand-waving; if a thing is claimed DONE, the
object that does it is named.

---

## Executive summary

Against the 16-module legacy map (`docs/LEGACY-MODULE-INVENTORY.md`), the
foundation + Wave-C builds (B0–B5, W0, W1a–e, W2, S1–S4, KL-1/2/3) have already
re-expressed **4 modules DONE, 5 PARTIAL, 7 GAP** on the shared spine. The Event
spine (Module 2), the full Stays room lifecycle (Module 3), Staff identity +
capabilities (Module 11), and the entire Catering/Kitchen domain (Module 12) are
live and harness-proven. What genuinely remains is the **staff-operations layer**
(shifts/HR/leave/roster, tasks/incidents, checklist templates), **CRM enrichment**
(interactions/LTV/special-dates/templates), **dynamic pricing**, a **unified
availability calendar + date-hold lifecycle**, the **finance back-office**
(expenses + tiered approval + AR ageing), **inventory reorder automation**, and
the **reporting + marketing leaf** (consolidated P&L / GST-return / campaigns /
LED). These slice into **nine dependency-ordered sub-phases M1a–M8** (the
workforce domain is built as two independently-verified increments, M1a→M1b),
sequenced low-coupling-first / leaf-consumer-last exactly as OP MODEL Part 4
sequenced Wave C:

| Sub-phase | Slice | Benchmark held to |
|---|---|---|
| **M1a** | Staff scheduling: shifts + roster + shift assignment/status | Deputy · 7shifts |
| **M1b** | Attendance (geofenced on-premise boolean) + leave + HR fields + tiered-approval primitive | greytHR · Connecteam |
| **M2** | Ops execution: tasks + incidents + checklist-template engine | Quore/HotSOS · Xenia |
| **M3** | Guest CRM enrichment: interactions + LTV + special-dates + templates + review loop | Revinate · Salesforce Hospitality |
| **M4** | Dynamic pricing: rate-rule engine (selling price, not GST) | Cloudbeds PIE · Mews rate management |
| **M5** | Unified availability calendar + tentative date-hold lifecycle | Oracle OPERA · Cloudbeds calendar |
| **M6** | Finance back-office: expense ledger + tiered approval + collections/ageing | Zoho Books/Expense · SAP Concur |
| **M7** | Inventory reorder-point + procurement automation (A11/A12) | MarketMan · Apicbase |
| **M8** | Reporting + marketing leaf: consolidated P&L / GST-return / campaigns / LED / lead-source | Oracle OPERA reporting · Revinate Marketing |

Every sub-phase honors the non-negotiables: atomic wrapper+RPC writes, org-scoped
default-deny RLS + `auth.uid()` self-auth, config-driven GST via `resolve_gst`
(never a hardcoded rate), no hardcoded single-property values, messaging only via
`MessagingProvider`, automation only via the B4 rule registry. Each exits only on
a self-cleaning, exit-coded `scripts/<mX>-verify.mjs` that runs **×2 identical**.

---

## Part A — Classification of all 16 legacy modules against the live spine

Legend: **DONE** = re-expressed and harness-proven · **PARTIAL** = some coverage
exists, named gap remains · **GAP** = not built.

### Module 1 — Staff Dashboard & Shifts → **GAP**
**Legacy:** shift start/end with GPS geofence check-in + shift-enforcement gate;
activity feed (`shifts`, `activity_log`, `staff`).
**Spine evidence:** the **Staff identity** is DONE — `staff` table + `create_staff`
RPC (W0), and capabilities live in `org_members` (`has_capability`, B2). The
`audit_log` (B0) is a *system* audit, not a staff activity feed.
**Verdict GAP:** there is **no** `shifts` table, no shift start/end RPC, no
GPS/geofence capture, no shift-enforcement gate, no per-staff activity feed.
Identity is the foundation under it, but the shift module itself is unbuilt.

### Module 2 — Event Command Center → **DONE**
**Legacy:** enquiry→pipeline→Event, follow-ups, hall/date double-booking guard,
venues, date-holds (`enquiries`, `follow_ups`, `events`, `venues`, `date_holds`).
**Spine evidence:** `create_enquiry` → `record_followup` → `create_quote` →
`confirm_booking` → `create_event` → `settle_booking` (B5), over `leads`/`quotes`/
`events`/`bookings`/`halls` with the **slot-aware GiST `EXCLUDE`** on `date_blocks`
(B1, +3h buffer — strictly *upgrades* the legacy date-only guard). Routes
`/enquiries`, `/enquiries/[id]`. A1/A2 automation (ack + SLA) fires via B4.
**Verdict DONE.** Carve-out: the *cross-domain availability calendar* and the
*tentative date-hold* lifecycle (legacy `date_holds` as a soft hold distinct from
a confirmed block) are split out to **M5** — `date_blocks` today is the confirmed
guard, not a tentative hold with expiry.

### Module 3 — Room Operations / PN Stays → **DONE**
**Legacy:** room status board, room enquiries, check-in/out, caution deposit, OTA
source tagging, Form-C-ish export (`rooms`, `room_bookings`, `room_enquiries`).
**Spine evidence:** S1–S4 in full — `room_types`/`rooms`/`room_stays` with the
**GiST overlap guard** (`create_room_stay`, fixes legacy F-DATA-01), walk-in +
check-in/out + **Form C gate** (`create_walk_in`/`check_in_stay`/`check_out_stay`,
`form_c_records`, `pn_form_c_complete`), housekeeping/room-board/maintenance
(`room_board`, S3), folio + settlement at 5% no-ITC via the shared invoice engine
(`add_folio_charge`/`settle_folio`, S4). Routes `/stays/*`.
**Verdict DONE.** Carve-outs (correctly placed in other lanes, not gaps in this
wave): OTA *channel sync* and Yale locks are the W6–8 + external lane; FRRO
e-submission is **KL-4** (external lane); OTA *source attribution* tagging is a
minor data add folded into the channel-manager wave.

### Module 4 — Calendar & Availability → **PARTIAL**
**Legacy:** availability calendar across venues + rooms; holds painted
(`date_holds`, `events`, `room_bookings`).
**Spine evidence:** the underlying data exists — `date_blocks` (hall, B1),
`room_stays` GiST (S1), `room_board` (S3 read). **Missing:** a unified
cross-domain availability *surface*/read RPC spanning hall slots + room inventory,
and the **tentative date-hold** lifecycle (a soft, expiring hold that converts to
a booking) — `date_blocks` is hard-confirmed only, no expiry sweep.
**Verdict PARTIAL** → completed in **M5**.

### Module 5 — Revenue & Expenses → **PARTIAL**
**Legacy:** per-stream revenue log, expenses, P&L, GST report (18/12/5),
collections/ageing (`revenue_entries`, `expense_entries`).
**Spine evidence:** the **revenue** side is DONE — `finance_ledger` +
`write_ledger` (W0, supply-type + source-domain tagged, invariant #10), realized
revenue posted by `settle_invoice`/`settle_booking`/`settle_folio`; per-domain
analytics `hall_analytics` (W2) and `stays_report` (S4). The GST *invoice* engine
(`resolve_gst`, `generate_consolidated_invoice`) is DONE.
**Missing:** an **expense** ledger/capture, a **consolidated cross-domain P&L**
report (the legacy "report" view), a **GST-return** report (period buckets for
filing — distinct from per-invoice GST), and **collections/AR ageing**.
**Verdict PARTIAL** → expense capture + approval + ageing in **M6**; consolidated
P&L + GST-return report in **M8**.

### Module 6 — Guest CRM → **PARTIAL**
**Legacy:** guest profiles, interactions timeline, LTV roll-up, special dates
(anniversary/birthday), WhatsApp templates, review-request (`guests`,
`guest_interactions`, `guest_special_dates`, `whatsapp_templates`).
**Spine evidence:** the **Guest identity** is DONE — `guests` + `find_or_create_guest`
(phone+name dedup, family-distinct) + `merge_guests` (W0), routes `/guests`,
`/guests/[id]`. Invariant #7 (one Guest, many roles) holds; every domain links the
same Guest.
**Missing:** the **interactions timeline**, **LTV roll-up** (a query over
`finance_ledger`, not a stored field — invariant #10), **special-dates** seeding,
the **message-template library** (must route through `MessagingProvider`, never a
`wa.me` deep-link), and the **review-request / anniversary loop** (a B4 A7 rule).
**Verdict PARTIAL** → completed in **M3**.

### Module 7 — Checklists → **PARTIAL**
**Legacy:** photo-proof checklists (daily/event/room), auto-generation, versioned
items (`checklist_templates`, `checklist_instances`).
**Spine evidence:** **event-execution checklists with the photo-proof moat** are
DONE — `event_checklists`/`event_checklist_items`, `complete_checklist_item`
(rejects completion of a `requires_photo` item without a `photo_ref`; W2), now
backed by real **Storage** (private `proof-photos` bucket + signed URLs, KL-3).
S3 `housekeeping_tasks` reuse the same photo gate.
**Missing:** the **template library + auto-generation** (legacy
`checklist_templates` → auto-instantiate per event/day/room) and the **daily /
recurring / room-type** checklist *kinds* (today's checklists are event-attached
only, hand-created).
**Verdict PARTIAL** → template engine in **M2**.

### Module 8 — Tasks & Incidents → **GAP**
**Legacy:** task assignment/priority; incident reporting/resolution (`tasks`,
`incidents`).
**Spine evidence:** the only analogue is S3 `maintenance_requests` (open→
in_progress→resolved, priority, assignable to staff) — a narrow room-maintenance
slice, **not** a generic cross-domain task or incident entity.
**Verdict GAP** → generic Tasks + Incidents in **M2** (maintenance_requests stays
as the proven shape to generalize from).

### Module 9 — HR & Attendance → **GAP**
**Legacy:** attendance matrix, compliance score, staff performance
(`attendance_records`, `staff`, `daily_reports`).
**Spine evidence:** `staff` profile exists (W0); **nothing** for attendance,
compliance scoring, or daily reports.
**Verdict GAP** → **M1b**.

### Module 10 — Leave & Roster → **GAP**
**Legacy:** leave request/approve; weekly shift roster (`leave_requests`,
`shift_roster`).
**Spine evidence:** `event_staff` (W2) is an **event-day** roster only
(`assign_event_staff`/`set_event_staff_status`) — not a general weekly staffing
roster, and there is no leave request/approval.
**Verdict GAP** → **M1a** (general roster) + **M1b** (leave; the tiered approval
primitive M1b establishes is later reused by M6, mirroring how W1c e-sign was
reused by W2).

### Module 11 — Staff Admin → **DONE**
**Legacy:** create/edit staff, roles; signup (`staff`).
**Spine evidence:** `create_staff` RPC + `staff` table (W0) + composable
capabilities in `org_members` (`is_org_member`/`has_capability`, B2). No god-role;
even owner is property-scoped (F-SEC-04).
**Verdict DONE** at the data/RPC layer. (A dedicated `/admin/staff` *UI* is in the
per-module UI-polish wave, program step 2 — not a migration gap.)

### Module 12 — Kitchen & Vendor Ops (Catering) → **DONE**
**Legacy:** per-plate packages, menu items, breakfast orders (room F&B 5%), vendor
commissions, kitchen prep lists, event-catering link.
**Spine evidence:** the **entire** Catering domain W1a–e — menu/recipe/cost
auto-scale (`scale_recipe`, `upsert_menu_item`, `set_recipe`), enquiry/quote/
package (`create_catering_enquiry`, `upsert_package`, `quote_summary`), BEO
lifecycle (`generate_beo`/`send_beo`/`sign_beo`), production/KOT + purchasing +
consumption (`generate_production`, `plan_purchase`, `receive_purchase_order`,
`close_production`), and the consolidated multi-rate GST invoice
(`generate_consolidated_invoice`/`settle_invoice`). Legacy **breakfast orders →**
`create_room_dining` + `post_room_dining_to_folio` (KL-2 closed). Legacy **vendor
commissions →** `vendors` + `upsert_vendor` + `event_vendors.commission_amount`
(W1d/W2). Legacy **prep lists →** `kitchen_tickets`/`production_consumption`.
**Verdict DONE** — exceeds the legacy donor (BEO, guest-guarantee, KOT, real
inventory draw-down were all legacy gaps now built).

### Module 13 — Dynamic Pricing → **GAP**
**Legacy:** seasonal/festival/weekend rate rules; room rate calendar; hall pricing
overrides (`room_rate_calendar`, `rate_rules`, `hall_pricing_overrides`).
**Spine evidence:** `room_types.base_rate` (S1, flat), catering package/quote
selling prices (point-in-time) — **no** rate-rule engine, no seasonal/festival/
weekend calendar, no override-resolution order.
**Verdict GAP** → **M4**. (Critical guard: this prices *selling rates*; it must
**never** touch GST — `resolve_gst` remains the sole rate authority for tax.)

### Module 14 — Expense Approval → **GAP**
**Legacy:** staff request → MD approve, tiered (`expense_requests`).
**Spine evidence:** none — no expense entity, no approval state machine. (The RHS
donor `approval_requests` pattern is REFERENCE-only, per REUSE-ANALYSIS #5.)
**Verdict GAP** → **M6** (reusing the tiered-approval primitive established in M1
for leave).

### Module 15 — Inventory → **PARTIAL**
**Legacy:** stock items + transactions, draw-down, low-stock (`inventory_items`,
`inventory_transactions`).
**Spine evidence:** the **core is DONE** — `inventory_items` + `inventory_movements`
+ `record_stock_movement` (W0, in/out/adjust, no-negative guard), the **single**
stock ledger all consumers draw from (invariant #9: W1d production + Stays
room-dining both route through it), with cost hardened (KL-1).
**Missing:** a **reorder-point / low-stock** model and its automation — there is
no `reorder_point` and **A11/A12 are not in the B4 registry** (`lib/automation/
registry.ts` holds only A2/A5/A10/drain).
**Verdict PARTIAL** → reorder-point + A11/A12 automation in **M7**.

### Module 16 — Campaigns + LED Advertising + Reports → **GAP**
**Legacy:** marketing campaigns + lead-source attribution; LED ad-slot revenue;
admin reports (P&L/GST/occupancy/pipeline/staff) (`campaigns`, `led_advertisers`).
**Spine evidence:** lead source is captured on `leads` (B3 inbound) and per-domain
analytics exist (`hall_analytics`, `stays_report`) — but there is **no** campaign
entity, **no** LED-advertiser entity, **no** lead-source attribution roll-up, and
**no** consolidated admin-reports surface.
**Verdict GAP** → the reporting leaf + marketing in **M8** (migrated last, as it
reads from every other domain).

### Tally
| Verdict | Count | Modules |
|---|---|---|
| **DONE** | **4** | 2 (Event Command), 3 (Room Ops), 11 (Staff Admin), 12 (Catering) |
| **PARTIAL** | **5** | 4 (Calendar), 5 (Revenue/Expenses), 6 (Guest CRM), 7 (Checklists), 15 (Inventory) |
| **GAP** | **7** | 1 (Shifts), 8 (Tasks/Incidents), 9 (HR/Attendance), 10 (Leave/Roster), 13 (Pricing), 14 (Expense Approval), 16 (Campaigns/LED/Reports) |

---

## Part B — The migration sequence (M1a–M8)

Dependency-ordered, low-coupling-first / leaf-consumer-last. Every sub-phase is a
single coherent slice on the proven shared core; none introduces a silo
(invariant #11). All writes are atomic wrapper+RPC, org-scoped default-deny RLS +
`auth.uid()` self-auth; all RPC/table names below are **anticipated design, not
DDL**. The workforce domain is built as two independently-verified increments
(M1a→M1b) — not three thin ports, and not one fused mega-phase.

```
W0 (shared core, DONE) ─┬─► M1a Scheduling ──► M1b Attendance/Leave/HR ──► (approval primitive) ──► M6 Finance
                        ├─► M2 Ops Execution                                                         ▲
                        ├─► M3 Guest CRM ───────────────────────────────────────────────────────────┼──► M8 Reporting+Marketing (LEAF, LAST)
                        ├─► M4 Dynamic Pricing ──► M5 Unified Calendar ──────────────────────────────┤
                        └─► M7 Inventory Reorder ────────────────────────────────────────────────────┘
```

---

### M1a — Staff scheduling (shifts · roster · shift assignment/status)
*Covers Module 1 (scheduling half) + Module 10 (roster half). One workforce
domain, first of two independently-verified increments.*

- **Scope:** the staffing-time layer — define shifts, build a general (non-event)
  weekly **roster**, and assign staff to shifts with a status lifecycle
  (scheduled → confirmed → completed / no-show). "Who is scheduled to work, when."
  No attendance/clock-in, no leave, no approvals here — those are M1b.
- **Benchmark:** **Deputy / 7shifts** (shift scheduling + weekly rostering +
  assignment/status). *Adopt:* shift definitions, weekly roster grid, assign +
  status lifecycle, double-assignment conflict rejection. *Scope out:* attendance/
  clock-in (M1b), leave (M1b), shift-swap marketplaces, payroll.
- **Shared core touched:** **Staff** (reuse `staff` + `org_members` capabilities;
  no identity duplication). Reuses the proven **W2 `event_staff` roster pattern**
  (`assign_event_staff`/`set_event_staff_status`) generalized to a non-event
  weekly roster — not a new silo (invariant #11). Invariants: #1 (atomic
  shift/roster writes), #3 (shift templates are org-config, never PN literals),
  F-SEC-04 (every roster/shift row org-scoped, self-authed).
- **New tables (anticipated):** `shifts`, `staff_rosters`, `roster_assignments`.
- **New RPCs (anticipated):** `upsert_shift`, `set_roster`, `assign_shift` /
  `set_shift_assignment_status`, `roster_board` (read).
- **Exit criterion — `scripts/m1a-verify.mjs` (×2 identical, self-cleaning, exit
  0):** define shift; build roster; assign staff → status transitions guarded
  (scheduled→confirmed→completed / no-show; illegal transitions rejected);
  double-assigning the same staff to overlapping shifts rejected; `roster_board`
  reads the week; cross-org isolation (org-A cannot read/assign org-B
  shifts/roster); every write audited. **STOP after M1a.**
- **Scope guards (NOT in M1a):** no attendance/clock-in/geofence (M1b), no leave
  (M1b), no tiered-approval primitive (M1b), no payroll, no biometric hardware.
- **Dependencies:** W0 (`staff`) only.

---

### M1b — Attendance + leave + HR fields + tiered-approval primitive
*Covers Module 1 (attendance half) + Module 9 (HR/attendance) + Module 10 (leave
half). Second workforce increment; depends on M1a.*

- **Scope:** the accountability + people-record layer on top of M1a's schedule —
  attendance check-in recorded against the assigned shift with a **geofenced
  on-premise boolean** (see below), late-grace + compliance score, leave
  request→approve with balances, and HR profile fields. **The reusable
  tiered-approval primitive lands HERE** (`approval_requests`: request → recommend
  → decide, anti-self-approval, tier-by-limit) — first consumed by leave, later
  reused by M6 expense approval, mirroring the W1c-e-sign → W2-contract reuse.
- **Benchmark:** **greytHR** (India-compliant attendance/leave/HR records +
  compliance) · **Connecteam** (mobile geofenced clock-in). *Adopt:* geofenced
  on-premise attendance, late-grace/compliance scoring, leave-balance + tiered
  approval, HR profile fields. *Scope out:* payroll calculation/payslips/statutory
  filing (PF/ESI/TDS), biometric-device integration, and full raw-GPS tracking
  (deliberately — see attendance design).
- **Attendance location = geofenced ON-PREMISE BOOLEAN, not raw GPS (DECISION,
  recorded):** at check-in the device evaluates whether it is within the
  property's configured geofence and records a **single audited boolean
  (`on_premise` true/false) + timestamp**, org-scoped. **Raw coordinates are
  evaluated on-device and are NOT persisted** — only the boolean result is stored,
  never lat/long. *Rationale:* this answers the only operational question that
  matters ("did staff clock in on-site?") without collecting or retaining
  sensitive persisted location data — lighter, privacy-respecting, and DPDP-aligned
  (cf. AUDIT `F-SEC-02` posture on PII). Full raw-GPS tracking is deliberately out
  of scope; if ever needed for multi-site, it becomes its own separately-consented
  feature later, not a default.
- **Shared core touched:** **Staff** (reuse `staff` + `org_members`; HR fields
  extend the profile, no identity dup). The geofence center/radius is **per-org
  config** (invariant #3 — never a hardcoded PN lat/long). Invariants: #1 (atomic
  attendance/leave writes; the leave decision is a single atomic RPC), #2 (any
  auto-escalation idempotent+audited), F-SEC-04 (org-scoped + self-authed).
- **New tables (anticipated):** `attendance_records` (stores `on_premise` boolean
  + timestamp, never coordinates), `leave_requests`, `leave_balances`,
  `approval_requests` (generic, tiered — the reusable primitive).
- **New RPCs (anticipated):** `record_attendance` (evaluates geofence boolean —
  receives only the boolean result, not coordinates), `request_leave` /
  `recommend_leave` / `decide_leave` (via `approval_requests`), `set_hr_fields`,
  `hr_summary` (read; compliance score; margin-free — counts visible to managers).
- **Exit criterion — `scripts/m1b-verify.mjs` (×2 identical, self-cleaning, exit
  0):** attendance recorded against an M1a shift; **`on_premise` true/false stored
  with timestamp and NO coordinate column is ever persisted** (assert the row has
  no lat/long); late-grace flips the compliance score deterministically; leave
  request → recommend → approve transitions guarded, self-approval rejected,
  balance decremented atomically (all-or-nothing on forced mid-tx failure); the
  tiered-approval primitive routes over-limit to the higher tier; cross-org
  isolation; every write audited. **STOP after M1b.**
- **Scope guards (NOT in M1b):** **no raw GPS / coordinate persistence** (boolean
  only), no payroll/payslips, no statutory filings, no biometric hardware, no
  expense approval (M6 reuses this primitive), no tasks/incidents (M2).
- **Dependencies:** **M1a** (attendance attaches to scheduled shifts), W0 (`staff`).

---

### M2 — Ops execution (tasks · incidents · checklist-template engine)
*Covers Module 8 (GAP) + Module 7 (PARTIAL — template engine).*

- **Scope:** a generic cross-domain **Task** entity (assign/priority/due/complete)
  and **Incident** entity (report→triage→resolve), plus the **checklist template
  library + auto-generation** that Module 7 still lacks — templates that
  instantiate per event / per day / per room-type, with the **photo-proof gate +
  Storage** carried over unchanged.
- **Benchmark:** **Quore / Amadeus HotSOS** (hotel work-orders + incident/glitch
  tracking), **Xenia** (SOP checklist templates + scheduled recurrence). *Adopt:*
  generic assignable work items, incident severity + resolution SLA, template→
  auto-instantiate checklists with required-photo steps. *Scope out:* IoT/sensor
  triggers and guest-facing service-request portals.
- **Shared core touched:** **Staff** (assignee), **Event** + **RoomStay**
  (checklist/task subjects). Generalize the proven S3 `maintenance_requests`
  shape; reuse W2 photo-proof + KL-3 `proof-photos` Storage verbatim. Invariants:
  #1, #2 (recurring checklist auto-gen is idempotent via the registry), #11
  (tasks/checklists are views over shared entities, not a silo).
- **New tables (anticipated):** `tasks`, `incidents`, `checklist_templates`,
  `checklist_template_items`. (Reuse existing `event_checklists`/
  `event_checklist_items` as the instance tables the templates populate.)
- **New RPCs (anticipated):** `create_task` / `assign_task` / `complete_task`,
  `report_incident` / `set_incident_status` / `resolve_incident`,
  `upsert_checklist_template`, `instantiate_checklist` (from template; required-
  photo carried), and a registry rule `A-CHK` for daily/recurring auto-generation.
- **Exit criterion — `scripts/m2-verify.mjs` (×2):** task create→assign→complete
  guarded; incident report→resolve with severity; checklist template →
  instantiate produces items, a `requires_photo` item still rejects completion
  without a `photo_ref` and accepts a real uploaded Storage key; recurring
  auto-gen is idempotent (re-tick creates no duplicate); cross-org isolation;
  audited.
- **Scope guards (NOT in M2):** no payroll/HR (M1b), no automation outside the B4
  registry, no new Storage bucket (reuse `proof-photos`).
- **Dependencies:** W0 (`staff`); B4 registry (for recurrence); W2/KL-3 (photo
  gate + Storage). Soft: M1a (richer assignee/roster context) — not blocking.

---

### M3 — Guest CRM enrichment (interactions · LTV · special-dates · templates · review loop)
*Covers Module 6 (PARTIAL).*

- **Scope:** turn the Guest *identity* into a Guest *relationship* — an
  interactions timeline, an LTV roll-up (a **query** over `finance_ledger`, never
  a stored balance — invariant #10), special-date (anniversary/birthday) capture,
  a reusable message-template library, and the review-request + anniversary
  lifecycle loop.
- **Benchmark:** **Revinate** (hospitality guest CRM + lifecycle messaging),
  **Salesforce Hospitality / For-Sight** (interaction timeline + segmentation).
  *Adopt:* unified interaction history, computed LTV, lifecycle automations
  (post-stay review, anniversary win-back), templated outreach. *Scope out:*
  marketing-campaign send (that's M8) and predictive/AI segmentation.
- **Shared core touched:** **Guest** (reuse `guests`; one Guest, many roles —
  interactions span hall/stays/catering), **Finance/Ledger** (LTV query),
  **Messaging** (templates + sends via `MessagingProvider` only — never a `wa.me`
  deep-link; the legacy anti-pattern), **Automation** (A7 review/anniversary via
  the B4 registry, quiet-hours-aware).
- **Review/solicitation loop = B3 `MessagingProvider` ONLY (firewall):** the
  post-stay/post-event review request and the anniversary win-back send **only**
  through the existing B3 path (`enqueue_outbound` → the per-(org, function_area)
  sender) — **idempotent** (one request per concluded event/anniversary, dedup on
  the entity key) and **quiet-hours-aware** (21:00–07:00 IST deferral via B3).
  **No new send path, no SDK call, no `wa.me` deep-link** — the legacy review
  anti-pattern is explicitly retired. Live AiSensy stays deferred (MockProvider
  default).
- **New tables (anticipated):** `guest_interactions`, `guest_special_dates`,
  `message_templates`.
- **New RPCs (anticipated):** `log_interaction`, `set_special_date`,
  `upsert_message_template`, `guest_ltv` (read, computed from `finance_ledger`),
  `request_review` (enqueues via B3 `enqueue_outbound`, idempotent); registry rule
  **A7** (event-concluded → review request; anniversary loop — both B3-routed).
- **Exit criterion — `scripts/m3-verify.mjs` (×2):** interaction logged + ordered;
  LTV recomputes when a new settled invoice posts to the ledger (proves it's a
  live query, not a stored number); special-date set; template render +
  enqueue_outbound routes through the correct per-(org,function_area) sender and
  respects quiet hours; A7 fires once per concluded event (idempotent re-tick →
  0, proving the review loop is B3-only and does not double-send); cross-org
  isolation; audited.
- **Scope guards (NOT in M3):** no campaign blasts / lead-source attribution
  (M8), no live AiSensy wiring (still deferred — MockProvider default), no LTV
  stored as a column.
- **Dependencies:** W0 (`guests`, `finance_ledger`), B3 (messaging), B4
  (registry).

---

### M4 — Dynamic pricing (rate-rule engine — selling price, NOT GST)
*Covers Module 13 (GAP).*

- **Scope:** a config-driven rate-rule engine resolving **selling price** by
  precedence (manual override → festival → weekend → seasonal → base) for room
  types and hall packages, with a materialized rate calendar. This sets what the
  guest is *charged*; it is strictly separate from tax.
- **Benchmark:** **Cloudbeds PIE** + **Mews rate management** (rule-based rate
  plans + calendars). *Adopt:* layered rule precedence, date-range rules, per-
  room-type/per-package overrides, a resolved rate calendar. *Scope out:* true
  ML/demand-based RMS (IDeaS/Duetto-style yield optimization) — explicitly later.
- **Shared core touched:** **RoomStay** (feeds `room_stays.rate_quoted` and
  `room_types`), **Event/Hall** (feeds hall quote pricing). Invariant #3 (rules
  are org-config, never a hardcoded PN tariff). **CRITICAL GUARD:** the engine
  resolves *selling price only* — it **never** computes or stores a GST rate;
  `resolve_gst(org, supply_type)` remains the **sole** tax-rate authority, and a
  line's `gst_rate` stays the resolved output snapshot (GST model, non-negotiable).
- **New tables (anticipated):** `rate_rules`, `rate_calendar` (resolved/
  materialized), `pricing_overrides`.
- **New RPCs (anticipated):** `upsert_rate_rule`, `resolve_rate` (returns the
  winning rule + price for a date/room-type/package), `rebuild_rate_calendar`,
  `set_pricing_override`.
- **Exit criterion — `scripts/m4-verify.mjs` (×2):** precedence resolves
  deterministically (override beats festival beats weekend beats seasonal beats
  base); a festival date returns the festival rate, an ordinary weekday the base;
  override wins even over festival; `resolve_rate` feeds a reservation's quoted
  rate; **a tax assertion proves GST is untouched** — flipping a rate rule does
  not change any `resolve_gst` output; cross-org isolation; audited.
- **Scope guards (NOT in M4):** no ML/demand pricing, no OTA rate push (channel-
  manager wave), no change to the GST engine.
- **Dependencies:** S1 (`room_types`), B5/W2 (hall quotes). Soft-feeds M5.

---

### M5 — Unified availability calendar + tentative date-hold lifecycle
*Covers Module 4 (PARTIAL).*

- **Scope:** one cross-domain availability surface (hall slots + room inventory +
  events, on one read), and the **tentative date-hold** lifecycle the legacy had
  (`date_holds`) but the spine doesn't — a soft, expiring hold that paints the
  calendar, distinct from the hard `date_blocks` / `room_stays` GiST guard.
- **Benchmark:** **Oracle OPERA** + **Cloudbeds** availability calendar (unified
  property/room/function-space view, holds painted, tentative vs definite).
  *Adopt:* one calendar across venues + rooms, tentative-hold states with expiry,
  convert-to-booking. *Scope out:* drag-to-rebook UI and OTA availability overlay
  (channel-manager wave).
- **THE SEAM — tentative hold vs the B1/S1 GiST `EXCLUDE` guard (named explicitly,
  so F-DATA-01 cannot be reintroduced):**
  - A **hold is a SOFT, EXPIRING claim** — a row in a *separate* `date_holds`
    table with a mandatory `expires_at`. It is **NOT** a confirmed block and lives
    **outside** the `date_blocks` / `room_stays` GiST `EXCLUDE` constraint, so a
    hold can never throw a hard `slot_taken` and can never wedge the booking path.
  - A hold **MUST auto-expire** — the B4 registry rule `A-HOLD` releases stale
    holds at the IST-anchored tick (idempotent). A hold left to lapse simply
    disappears; it never lingers as a phantom block.
  - A hold **NEVER silently becomes a booking and NEVER bypasses the EXCLUDE
    constraint.** `convert_hold` does **not** insert a block directly — it calls
    the existing `confirm_booking` / `create_room_stay`, so the GiST `EXCLUDE`
    remains the **single source of truth** for confirmed overlap. If two holds sit
    on the same slot, the *first to convert wins* and the second's `convert_hold`
    is **rejected by GiST** (the exact B1 race semantics), never by a bespoke
    check-then-insert. The hold layer is advisory paint; the constraint is law.
  - Because holds live outside the constraint, two overlapping *holds* are allowed
    (both painted as tentative) — only **confirmation** collides, and it collides
    at the database constraint, preserving the F-DATA-01 fix unchanged.
- **Shared core touched:** **Event** (`date_blocks`, B1 GiST), **RoomStay**
  (`room_stays` GiST, S1), read-composes with `room_board` (S3). Invariant #2
  (hold-expiry sweep idempotent via the B4 registry). No check-then-insert anywhere
  (Hard don't) — overlap is enforced only by GiST `EXCLUDE`.
- **New tables (anticipated):** `date_holds` (tentative, mandatory `expires_at`;
  separate from `date_blocks`).
- **New RPCs (anticipated):** `place_hold` / `release_hold` / `convert_hold` (the
  last delegates to `confirm_booking` / `create_room_stay`),
  `availability_calendar` (read, cross-domain). Registry rule **A-HOLD** (expire
  stale holds at the IST-anchored tick).
- **Exit criterion — `scripts/m5-verify.mjs` (×2):** place a hold → it paints the
  calendar but does **not** create a `date_blocks`/`room_stays` row (assert no
  GiST entry exists for a mere hold); **a hold auto-expires** via the A-HOLD sweep
  and is gone (idempotent re-tick → 0); two overlapping holds coexist; `convert_hold`
  routes through the real `confirm_booking`/`create_room_stay` so a conflicting
  convert is **rejected by GiST** (not a bespoke check) — proving a hold **never
  collides with nor silently becomes** a confirmed booking and **never bypasses
  the EXCLUDE guard** (F-DATA-01 stays closed); `availability_calendar` returns
  hall + rooms in one read; cross-org isolation; audited.
- **Scope guards (NOT in M5):** no OTA/channel availability, no drag-rebook UI,
  no duplicate overlap logic (GiST stays authoritative), no hold that writes
  directly into `date_blocks`/`room_stays`.
- **Dependencies:** B1 (`date_blocks`), S1 (`room_stays`), B5 (`events`), B4
  (registry). Soft: M4 (calendar shows resolved rates).

---

### M6 — Finance back-office (expense ledger · tiered approval · collections/ageing)
*Covers Module 14 (GAP) + Module 5 (PARTIAL — expense + AR side).*

- **Scope:** expense capture posting to the **one** finance ledger, the tiered
  **expense approval** state machine (staff request → recommend → owner/PM
  decide), and a **collections / AR-ageing** read over outstanding invoices. The
  money-out + receivables back-office that complements the already-done revenue
  posting.
- **Benchmark:** **Zoho Books** (India GST-aware bookkeeping + AR ageing) +
  **Zoho Expense / SAP Concur** (multi-tier expense approval). *Adopt:* expense
  categories posting to the ledger, tiered approval with limits + anti-self-
  approval, AR ageing buckets. *Scope out:* full double-entry GL, bank
  reconciliation, and payment-gateway capture (gateway is a separate net-new
  scoping item).
- **Shared core touched:** **Finance/Ledger** (expenses are ledger entries with a
  supply-type/source-domain tag — invariant #10, P&L stays a query), **Staff**
  (requester/approver). **Reuses the tiered-approval primitive built in M1b**
  (`approval_requests`) — mirrors W1c-e-sign→W2-contract reuse; no second approval
  engine. Invariant #5 (every money op writes a ledger entry + audit), #1 (the
  approval decision + ledger post are one atomic RPC, not sequential writes — the
  exact bug RHS had).
- **New tables (anticipated):** `expenses`, `expense_categories`. (Reuse
  `approval_requests` from M1b; reuse `finance_ledger`.)
- **New RPCs (anticipated):** `record_expense`, `submit_expense_request` /
  `recommend_expense` / `decide_expense` (atomic decide+ledger-post),
  `collections_ageing` (read; AR buckets over open `invoices`).
- **Exit criterion — `scripts/m6-verify.mjs` (×2):** expense recorded → one tagged
  ledger entry; tiered approval transitions guarded, self-approval rejected,
  over-limit routed to the higher tier; approve **atomically** posts the ledger
  entry (forced mid-tx failure → zero rows persist, all-or-nothing); ageing
  buckets compute correctly from invoice dates; Owner/PM-gated; cross-org
  isolation; audited.
- **Scope guards (NOT in M6):** no double-entry GL, no bank rec, no payment
  gateway, no consolidated P&L report (M8 reads this data).
- **Dependencies:** W0 (`finance_ledger`), **M1b** (`approval_requests` primitive),
  B5/W1e (`invoices` for ageing).

---

### M7 — Inventory reorder-point + procurement automation (A11/A12)
*Covers Module 15 (PARTIAL).*

- **Scope:** close the inventory gap — a reorder-point/par-level model and the two
  procurement automations the registry is missing: **A11** (booked-event recipes →
  auto-draft purchase orders from ingredient needs) and **A12** (stock below
  reorder point → alert + draft PO). Small, mostly automation wiring on the
  already-proven W0/W1d stock + purchasing engine.
- **Benchmark:** **MarketMan / Apicbase** (F&B inventory + auto-replenishment +
  par levels). *Adopt:* par/reorder levels, auto-PO from forecast + from low
  stock, supplier-grouped drafts. *Scope out:* multi-warehouse transfers and
  demand forecasting beyond booked-event recipe needs.
- **Shared core touched:** **Inventory** (one ledger, many consumers — reuse
  `inventory_items`/`inventory_movements`/`record_stock_movement`, KL-1 cost
  gating intact), **Vendor** (reuse `vendors`; reuse W1d `plan_purchase` which
  already groups drafts by supplier). Invariant #2 (A11/A12 idempotent + audited
  via the B4 registry — adding a rule = a registry entry), #9 (no parallel stock
  path). Messaging via B3 (MessagingProvider), quiet-hours-aware.
- **New tables (anticipated):** none required — add `reorder_point` /
  `par_level` columns to `inventory_items`.
- **New RPCs (anticipated):** `set_reorder_point`; registry rules **A11**
  (recipe-driven auto-PO, reusing `plan_purchase`) and **A12** (low-stock → alert
  + draft PO).
- **Exit criterion — `scripts/m7-verify.mjs` (×2):** setting a reorder point then
  drawing stock below it makes A12 produce exactly one alert + one supplier-grouped
  draft PO; a re-tick produces none (idempotent); A11 from a booked event's recipes
  drafts the right shortfall PO; both route messaging through B3 and respect quiet
  hours; cross-org isolation; audited. **W1d/W0 regressions green.**
- **Scope guards (NOT in M7):** no multi-warehouse, no new stock path, no
  demand-ML forecasting.
- **Dependencies:** W0 (inventory), W1d (`plan_purchase`, `vendors`), B4
  (registry), B3 (alerts).

---

### M8 — Reporting + marketing leaf (consolidated P&L · GST-return · campaigns · LED · lead-source) — ✅ COMPLETE (pending apply+verify; migration `20260602200000_m8_reporting_marketing.sql`)
*Covers Module 16 (GAP) + Module 5 (PARTIAL — consolidated reports/GST-return).*
*Built: `consolidated_pnl` / `gst_return_report` (firewall: reads resolve_gst output, never recomputes) / `ar_ageing_by_customer` (closes KL-11) / `campaigns` + `leads.campaign_id` + `led_bookings` (LED revenue → existing finance_ledger) / `upsert_campaign` / `set_lead_source` / `lead_source_report` / `record_ad_revenue`. **M1a–M8 module-migration wave structurally complete.***

- **Scope:** the **leaf consumer**, migrated last because it reads from every
  other domain — a consolidated cross-domain **P&L** (a query over the one ledger),
  a period **GST-return** report (output-tax buckets per rate for filing),
  occupancy/pipeline/staff admin reports, plus the marketing layer: **campaigns**
  + **lead-source attribution** roll-up and **LED advertising** ad-slot revenue
  (posted to the ledger as its own revenue stream).
- **Benchmark:** **Oracle OPERA / Cloudbeds** reporting suites (consolidated
  financial + operational reporting) + **Revinate Marketing** (campaign +
  attribution). *Adopt:* one-click cross-domain P&L, GST-return buckets, occupancy/
  ADR/RevPAR + pipeline rollups, campaign ROI by lead source. *Scope out:* a BI
  warehouse / external analytics export (accounting export is a separate later
  integration).
- **Shared core touched:** **Finance/Ledger** (P&L + GST-return are *queries* —
  invariant #10, "P&L is a query, not a reconciliation"), **CRM/Guest** (lead-
  source attribution joins `leads` + campaigns), all domains (read). LED ad
  revenue is a `write_ledger` revenue stream (invariant #5/#10) tagged its own
  source-domain; **no hardcoded rate** — if LED revenue is taxable it goes through
  `resolve_gst` like every other supply type.
- **GST FIREWALL — the reporting/GST-return surface is READ-ONLY over the ledger +
  `resolve_gst` output (same firewall as M4, stated explicitly for M8):** the
  `gst_return_report` and every revenue/P&L figure **read** the resolved
  `gst_rate`/`tax_summary` already snapshotted on `invoice_lines` (the W1e/S4
  output of `resolve_gst`) and the `finance_ledger`. M8 **never computes a rate,
  never stores a rate, never re-derives tax** — it only buckets and sums an
  already-resolved output. `resolve_gst(org, supply_type)` remains the **sole**
  rate authority; the GST-return is a grouping query, not a tax engine. (The one
  write M8 makes — `record_ad_revenue` — also takes its rate from `resolve_gst`,
  never a literal.)
- **New tables (anticipated):** `campaigns`, `ad_inventory` (LED slots/advertisers).
- **New RPCs (anticipated):** `consolidated_pnl` (read), `gst_return_report`
  (read; output-tax grouped per rate/period), `occupancy_pipeline_report` (read),
  `upsert_campaign`, `attribute_lead_source` (read roll-up), `record_ad_revenue`
  (→ `write_ledger`). Revenue figures **margin-gated** (`pnl.view_margin`); counts
  always visible (the W2/S4 reporting posture).
- **Exit criterion — `scripts/m8-verify.mjs` (×2):** consolidated P&L sums the
  ledger across hall/stays/catering streams and reconciles to the sum of per-domain
  analytics (proves it's one ledger, not a reconciliation); GST-return buckets
  group output tax per resolved rate for a period; **assert the report computes
  and stores NO rate of its own — every rate it reports traces back to a
  `resolve_gst`-snapshotted `invoice_lines.gst_rate`** (flipping `specified_premises`
  changes the report only because the underlying snapshots changed, never because
  M8 recomputed); campaign + lead-source attribution roll-up counts conversions;
  LED ad revenue posts one tagged ledger entry (taxed via `resolve_gst` if
  applicable, never a literal); revenue gated to `pnl.view_margin` / counts visible
  to operatives; cross-org isolation; audited.
- **Scope guards (NOT in M8):** no external BI/warehouse, no accounting-software
  export, no payment gateway, no double-entry GL.
- **Dependencies:** **M6** (expense ledger for true P&L), **M3** (interactions/
  leads for attribution), and DONE per-domain analytics (`hall_analytics`,
  `stays_report`, `finance_ledger`). Sequenced **last**.

---

## Part C — Cross-cutting compliance check (every sub-phase)

| Non-negotiable | How M1a–M8 honor it |
|---|---|
| Atomic wrapper+RPC (inv. #1) | Every state change above is a single SECURITY DEFINER RPC behind the `ActionResult<T>` wrapper; M1b's leave-decide and M6's decide+ledger-post explicitly all-or-nothing (the RHS orphan-bug avoided). |
| Default-deny RLS + `auth.uid()` self-auth (F-SEC-04) | Every new table ships RLS-default-deny + org-scoped SELECT; every RPC self-authorizes on `auth.uid()` membership + capability. No client-supplied `org_id`. |
| Config-driven GST (non-negotiable) | `resolve_gst` stays the **only** rate authority. M4 prices *selling* only and its harness asserts GST is untouched; M8 reports tax **read-only** over `resolve_gst`-snapshotted rates (computes/stores none) and `record_ad_revenue` taxes via `resolve_gst`. No rate is ever stored as an input. |
| No hardcoded single-property values (inv. #3) | M1b geofence center/radius, M4 rate rules, M2 checklist templates, M7 reorder points are all per-org config, never a PN literal. |
| Privacy / minimal PII (DPDP, F-SEC-02 posture) | M1b attendance persists only a `on_premise` boolean + timestamp — raw coordinates are evaluated on-device and never stored. Full raw-GPS is out of scope. |
| Messaging via `MessagingProvider` only | M3 templates + review/anniversary loop (idempotent, quiet-hours-aware) and M7 stock alerts route through B3 only (the legacy `wa.me` deep-link is explicitly retired); live AiSensy stays deferred. |
| Automation via the B4 registry only | A7 (M3), A-CHK (M2), A-HOLD (M5), A11/A12 (M7) are registry entries — atomic, idempotent, IST-anchored, quiet-hours-aware; no automation outside the registry. |
| Money writes a ledger entry + audit (inv. #5) | M6 expenses + M8 ad revenue post to `finance_ledger`; P&L is a query over it (inv. #10). |
| Reuse, never silo (inv. #11) | M1a reuses `staff` + generalizes the W2 `event_staff` roster; M1b extends the staff profile (no identity dup) and builds the `approval_requests` primitive reused by M6; M2 generalizes `maintenance_requests` + reuses photo-Storage; M3 reuses `guests`+ledger; M5 holds live outside the GiST guard; M7 reuses the W0/W1d stock+PO engine. No new databases. |
| Phase exit = proof, not claim | Each sub-phase exits only on a self-cleaning, exit-coded `scripts/<mX>-verify.mjs` run **×2 identical**, with prior-phase regressions green, and a STOP before the next. |

---

## Part D — Ambiguity log (judgment calls made)

The legacy inventory was specific; where it left room, these calls were made:

1. **Modules 1+9+10 = one workforce domain, built as two verified increments
   (M1a→M1b).** The inventory lists Shifts, HR/Attendance, and Leave/Roster as
   three modules, but they are one workforce-time domain over the same `staff`
   core with heavy shared structure (a roster needs shifts; attendance attaches to
   a shift; leave needs the approval primitive). The M0 plan fused them into one
   M1; the M0.1 architect review **split that into M1a (scheduling) → M1b
   (attendance/leave/HR/approval)** — two independently exit-coded increments, each
   with its own ×2 harness and STOP. Judgment: not three thin ports, and not one
   fused mega-phase — coherence with verifiable checkpoints.
2. **The tiered-approval primitive placed in M1b, reused by M6.** Leave-approval
   (M1b) precedes expense-approval (M6) in the sequence, so the generic
   `approval_requests` state machine is built where first needed and reused later —
   mirroring the W1c-e-sign → W2-contract reuse precedent. (The RHS
   `approval_requests` is REFERENCE-only per REUSE-ANALYSIS; we build our own
   atomic version.)
3. **Module 7 (Checklists) split DONE/PARTIAL across waves.** Execution + photo-
   proof is DONE (W2/KL-3); only the *template-library + auto-generation* remains,
   placed in M2 (ops execution) rather than a standalone phase, since templates +
   tasks + incidents are one ops-execution slice.
4. **Module 5 (Revenue & Expenses) split across M6 and M8.** Revenue posting is
   DONE; the expense + AR-ageing side is operational (M6) while the consolidated-
   report + GST-return side is a leaf read (M8). Splitting respects the
   leaf-last dependency rule rather than forcing one mega-phase.
5. **Module 15 (Inventory) called PARTIAL, not DONE.** The stock *ledger* is
   solidly done (W0/W1d); only reorder-point + the A11/A12 automations are missing.
   Called PARTIAL (not DONE) specifically because the registry today lacks A11/A12,
   and placed in a deliberately small M7.
6. **Dynamic Pricing (M4) firewalled from GST.** The legacy "pricing" mixed
   selling rates and could be misread as touching tax. Judgment: M4 prices selling
   only; its harness must *prove* `resolve_gst` is untouched — protecting the
   non-negotiable GST invariant.
7. **OTA source-attribution, Yale, FRRO e-submission excluded from this wave.**
   Per the inventory's §5 flags + KL-4, these are external-integration-lane /
   channel-manager-wave items, not module migrations — explicitly out of M1a–M8.
8. **Module 11 (Staff Admin) called DONE despite no `/admin/staff` UI.** The
   data/RPC layer (`create_staff` + `org_members`) is complete; the admin UI is
   program step 2 (per-module UI polish), not a migration gap. Judgment: migration
   = logic on the spine; UI is the next program step.
9. **Attendance = geofenced on-premise boolean, NOT raw GPS (M0.1 decision).**
   The legacy module captured a GPS check-in with a geofence flag. The M0.1 review
   locked attendance to recording **only a `on_premise` true/false + timestamp** —
   raw coordinates are evaluated on-device and never persisted. Rationale: it
   answers the only operational question ("did staff clock in on-site?") without
   collecting/retaining sensitive persisted location data (DPDP-aligned, cf.
   `F-SEC-02`). Full raw-GPS tracking is deliberately out of scope; if ever needed
   for multi-site it becomes its own separately-consented feature later.

---

## Revision log

- **M0** (initial): plan written — 4 DONE / 5 PARTIAL / 7 GAP, sequence M1–M8.
- **M0.1** (architect review): (1) M1 split into **M1a** (scheduling, Deputy/7shifts)
  → **M1b** (attendance/leave/HR + tiered-approval primitive, greytHR/Connecteam),
  each independently ×2-verified with its own STOP; (2) attendance locked to a
  **geofenced on-premise boolean** (no raw-GPS persistence); (3) **M5 hold/GiST
  seam named** — holds are soft, expiring, live outside the `EXCLUDE` constraint,
  auto-expire via A-HOLD, and `convert_hold` delegates to `confirm_booking`/
  `create_room_stay` so GiST stays the sole overlap authority (F-DATA-01 cannot
  recur); (4) **M3 review/anniversary loop** stated as B3 `MessagingProvider`-only,
  idempotent + quiet-hours-aware, no new send path; (5) **M8 GST firewall** — the
  GST-return/reporting surface is read-only over `resolve_gst`-snapshotted output,
  computes/stores no rate of its own; (6) all sub-phases re-confirmed to carry
  benchmark + shared-core/invariants + named tables/RPCs + ×2 exit harness + scope
  guards + dependencies, with the M4 GST-untouched firewall and the external-lane
  exclusions (OTA attribution / Yale / FRRO / KL-4) intact.

---

**RESUME:** M0.1 complete — plan revised (M1 split into M1a/M1b,
geofenced-boolean attendance, M5 hold/GiST seam named, M3 via B3, M8 GST read-only
firewall). Sequence M1a…M8 locked pending Vicky final review. Awaiting go for M1a.
