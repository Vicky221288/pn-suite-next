# Legacy PN Master Suite — Module Inventory (pre-migration recon)

**Source:** `~/Desktop/pn-master-suite` — `git@github.com:Vicky221288/pn-master-suite.git`
(React 18 + Vite + Cloudflare Pages; the build audited **45/100** in `AUDIT-2.0.md`).
**This is read-only reconnaissance** for the module-migration wave — nothing ported yet.
Evidence: 36 SQL migrations (40 tables), ~50 routes (`src/App.jsx`), 40 hooks, 28 component dirs.

> **Two corrections to working assumptions, up front:**
> 1. **Catering/kitchen is NOT greenfield.** The legacy app has a real **Kitchen & Vendor Operations** module (migration `028_kitchen_module.sql`, routes `kitchen/*`, `useEventCatering`/`useCateringPackages`/`useMenuItems`/`useBreakfastOrders`/`useKitchenPrep`/`useVendors`). It has portable logic (per-plate catering math, vendor commissions, breakfast orders, prep lists). The *new* catering scope (full banquet-catering E2E + PN Stays room-dining/F&B) **extends** this, but there IS a legacy donor — see §Catering.
> 2. **There is NO OTA channel-manager, NO smart-lock/Yale, NO Yanolja anything.** Legacy "OTA" is just **source labels** in a dropdown (`OTA_SOURCES` in constants) on manually-entered room bookings. All of Rooms-channel-management and key-activation is genuinely greenfield + external-integration-gated.

---

## 1. Module list (16) — what, screens, data

| # | Module | What it does | Main routes | Core tables |
|---|---|---|---|---|
| 1 | **Staff Dashboard & Shifts** | Shift start/end with **GPS check-in** (geofence flag) + shift-enforcement gate; activity feed | `/` (StaffDashboard), shifts inline | `shifts`, `activity_log`, `staff` |
| 2 | **Event Command Center** | Enquiry→pipeline→Event; follow-ups; **double-booking guard** (hall/date); venues; date-holds | `/enquiries`,`/enquiries/:id`,`/events`,`/events/:id`,`/calendar` | `enquiries`, `follow_ups`, `events`, `venues`, `date_holds` |
| 3 | **Room Operations / PN Stays** | Room status board, room enquiries, check-in/out, caution deposit, OTA-**source tagging** (no sync), Form-C-ish register export | `/rooms`,`/rooms/:id`,`/bookings`,`/bookings/new`,`/bookings/:id`,`/room-enquiries*` | `rooms`, `room_bookings`, `room_enquiries` |
| 4 | **Calendar & Availability** | Availability calendar across venues/rooms; holds painted | `/calendar` | `date_holds`, `events`, `room_bookings` |
| 5 | **Revenue & Expenses** | Per-stream revenue log, expenses, P&L, **GST report** (18/12/5 buckets), collections/ageing | `/revenue`,`/revenue/add`,`/revenue/expenses*` | `revenue_entries`, `expense_entries` |
| 6 | **Guest CRM** | Guest profiles, interactions timeline, LTV roll-up, special dates (anniversary/birthday), WhatsApp templates, review-request | `/guests`,`/guests/:id`,`/guests/new`,`/templates*` | `guests`, `guest_interactions`, `guest_special_dates`, `whatsapp_templates` |
| 7 | **Checklists** | Photo-proof checklists (daily/event/room), auto-generation, versioned items | `/checklists` | `checklist_templates`, `checklist_instances` |
| 8 | **Tasks & Incidents** | Task assignment/priority; incident reporting/resolution | `/tasks`,`/incidents` | `tasks`, `incidents` |
| 9 | **HR & Attendance** | Attendance matrix, compliance score, staff performance | `/hr`,`/hr/:staffId` | `attendance_records`, `staff`, `daily_reports` |
| 10 | **Leave & Roster** | Leave request/approve; weekly shift roster | `/leave`,`/leave/new`,`/roster` | `leave_requests`, `shift_roster` |
| 11 | **Staff Admin** | Create/edit staff, roles; secondary-client signup; PWA | `/admin/staff*`,`/profile` | `staff` |
| 12 | **Kitchen & Vendor Ops** *(catering!)* | In-house catering **per-plate** packages, menu items, **breakfast orders** (room F&B, 5% GST), **vendor commissions**, kitchen **prep lists**, event-catering link | `/kitchen`,`/kitchen/menu`,`/kitchen/packages`,`/kitchen/vendors*`,`/kitchen/breakfast`,`/kitchen/prep` | `menu_items`, `catering_packages`, `vendors`, `event_catering`, `event_vendors`, `breakfast_orders`, `kitchen_prep_lists` |
| 13 | **Dynamic Pricing** | Seasonal/festival/weekend rate rules; room rate calendar; hall pricing overrides (MD-only) | `/pricing` | `room_rate_calendar`, `rate_rules`, `hall_pricing_overrides` |
| 14 | **Expense Approval** | Staff requests expense → MD approves (tiered) | `/expenses/approvals` | `expense_requests` |
| 15 | **Inventory** | Stock items + transactions (draw-down, low-stock) | `/inventory` | `inventory_items`, `inventory_transactions` |
| 16 | **Campaigns + LED Advertising + Reports** | Marketing campaigns & lead-source attribution; LED ad-slot revenue; admin reports (P&L/GST/occupancy/pipeline/staff) | `/campaigns*`,`/led*`,`/reports`,`/admin-reports` | `campaigns`, `led_advertisers` (+ reads many) |

Cross-cutting (not "modules"): **Notifications/exception bell** (`useNotifications` — overdue follow-ups, cleaning rooms, expiring holds, anniversaries), **WhatsApp** (deep-link only), **`activity_log`** audit, the single-row `properties` tenant.

---

## 2. Domain logic worth porting (donor) vs scaffolding to discard

| Module | **Port (logic donor)** | Discard (scaffolding) |
|---|---|---|
| Event Command | enquiry **stages + outcome-derived follow-up dates**; **double-booking guard intent** (date-only — upgrade to slot-aware GiST, B1); date-hold lifecycle tied to pipeline | client-side multi-step writes; React/Vite scaffolding |
| Rooms/Stays | **caution-deposit reconciliation** math; check-in/out flow; room-status model; OTA source taxonomy (as labels) | **no double-booking guard (defect — must fix)**; manual OTA entry |
| Revenue/GST | **per-stream P&L**, collections/ageing, the **correct 3-rate GST model (18/12/5)** | ratio-inferred GST bucketing; CSV/print "report" |
| Guest CRM | **LTV roll-up, anniversary/special-date seeding, review-request trigger, phone-dedup upsert** | deep-link WhatsApp send |
| Checklists | **photo-proof gating + auto-generation + versioned items** (the accountability moat) | render-time generation |
| Kitchen/Catering | **per-plate × guest-count + GST**, **vendor-commission accounting**, breakfast orders, prep lists, kitchen-rental fee | form-as-source-of-truth (non-atomic) |
| Dynamic Pricing | **rule resolution order** (festival/weekend/override), rate calendar | MD-only UI plumbing |
| HR/Attendance | compliance-score weights, late-grace logic, roster model | — |
| Expense Approval | **tiered request→recommend→approve** state machine | — |
| Campaigns | **lead-source attribution** + campaignable-source mapping | — |
| Notifications | the **exception-surface query set** (feeds the new `/today`) | render-time polling |

**Universal discard:** every legacy write is **non-atomic client-side** (AUDIT `F-BE-01`) and **single-tenant**; port the *rules*, re-express on the spine's atomic wrapper+RPC + `org_id`/RLS (OP MODEL inv. #1, #3, #6 — "port domain logic, not architecture").

---

## 3. What the spine (foundation wave) already covers — DON'T re-port

| Legacy area | Spine status |
|---|---|
| Enquiry → Quote → **Booking → Event → Settlement** (Hall) | ✅ **done** (B5 slice): `create_enquiry`/`create_quote`/`confirm_booking`/`create_event`/`settle_booking` |
| Hall **double-booking guard** | ✅ **done + upgraded** — GiST `EXCLUDE`, slot-aware + 3h buffer (B1; legacy was date-only & rooms had none) |
| **Deposit = 50% hall rent, escrowed liability** | ✅ done (B1/B5) |
| **GST tax invoice (composite-5%)** | ✅ done (B5; legacy had no invoice — `F-FIN-03` closed) |
| Lead capture (omni-source) + dedup | ✅ inbound webhook → atomic deduped lead (B3); manual create (B5) |
| Follow-up SLA enforcement, rent reminders, Today | ✅ automation engine (B4; legacy had none — `F-AUTO-01` closed) |
| WhatsApp send (real) | ✅ interface + mock; live AiSensy gated (B3; legacy was deep-link) |
| Multi-tenant + RBAC | ✅ org_id + RLS + capabilities (B2; `F-SEC-04` closed; legacy single-tenant) |

**Net:** Module 2 (Event Command) **core flow is largely DONE**; Module 5's GST/settlement slice is done (but full revenue dashboard/P&L/reports are NOT); Guest-CRM has a lead seed but not the full CRM. Everything else (3,7–16) is **to migrate**.

---

## 4. Inter-module dependencies (port order matters)

- **Guest** is the spine identity — Rooms, Events, Catering, CRM all reference a guest/customer. (Spine has `leads`; a unified `guest` entity is a prerequisite for CRM + Rooms + repeat-business.)
- **Event → Catering**: `event_catering`/`event_vendors` hang off an Event (per-plate, room-block cross-sell). Catering depends on Event + Vendors + Menu.
- **Catering → Vendors → (commission) → Revenue**: vendor commission auto-logs as a revenue stream.
- **Catering/Kitchen → Inventory**: legacy has them as **separate** (no automatic draw-down — AUDIT S6 gap); a real link is greenfield.
- **Rooms → Event** (optional): room-block-against-event cross-sell (`useCrossSelling`).
- **Pricing → Rooms + Events**: rate rules feed room tariffs + hall package pricing.
- **Revenue/Reports** reads from Events, Rooms, Catering, Expenses, LED — it's a **leaf consumer** (migrate last).
- **Checklists/Tasks/HR/Shifts** are largely **standalone** (staff-ops), depend only on `staff` — migratable independently/early.

---

## 5. Rooms / Stays / OTA / Smart-lock — explicit flags (Yale + Yanolja incoming)

- **Legacy Rooms = manual + basic.** `rooms` (status board), `room_bookings` (check-in/out, caution deposit, `guest_id_number` plaintext — AUDIT `F-SEC-02`), `room_enquiries`. Booking source includes OTA **labels** (`ota_booking_com`, `ota_makemytrip`, `ota_goibibo`, `ota_agoda`, `ota_airbnb`) — **for attribution only**.
- **NO OTA channel manager / sync / iCal** — confirmed (AUDIT L6: "OTA sync ABSENT — source enums only"). Bookings are hand-keyed.
- **NO smart-lock / Yale / key-activation** — confirmed (grep for `yale|lock|channel|yanolja` matched only CSS/realtime "lock" false-positives). Zero key/access logic.
- **NO Yanolja** — nothing.
- **Room double-booking is UNGUARDED** in legacy (AUDIT `F-DATA-01`: no overlap constraint, no client check) — a **defect to fix on migration** by applying the spine's GiST-`EXCLUDE` pattern (B1) to `room_bookings(room_id, daterange)`.
- **Implication:** the Rooms/Stays sub-system is **heavy + external-integration-gated**: (a) port the room lifecycle + caution-deposit onto the spine (atomic, slot/overlap-guarded, multi-tenant); (b) Yale key-activation = greenfield, needs Yale API access; (c) Yanolja/OTA channel management = greenfield, needs OTA scoping. None exist to port.

---

## 6. Honest gaps — what the business needs that legacy DOESN'T have

- **No OTA channel manager**, **no Yale/smart-lock**, **no Yanolja** (all greenfield + external-gated).
- **No real WhatsApp API send** (deep-link only) → done in spine B3 (live AiSensy gated).
- **No server-side automation** (render-time only) → done B4.
- **No GST tax invoice / CGST-SGST / HSN-SAC / invoice numbering** → done B5.
- **No payment gateway / payment links / reconciliation** — manual ledger only. **Still greenfield.**
- **No BEO / function-sheet** generation (AUDIT S5) — **greenfield.**
- **No guest-guarantee catering model** (flat plate count only) — extend in the new Catering.
- **No room-dining/F&B service flow / KOT** — the new Catering scope; only `breakfast_orders` exists.
- **No catering↔inventory draw-down link** — greenfield.
- **No multi-tenant / white-label / billing** (single property) → tenancy done B2; billing/white-label are later waves.
- **Compliance moat absent:** no FSSAI/Fire-NOC/music-licence trackers; "Form C" lacks nationality/passport-country (can't satisfy FRRO) — AUDIT L7.
- **Catering verdict (the correction):** catering is **NOT** wholly greenfield — legacy Kitchen module donates per-plate math, vendor commissions, breakfast orders, prep lists. The **new** parts are: full banquet-catering E2E, PN Stays **room-dining/F&B**, guest-guarantee, KOT, and inventory linkage.

---

## 7. Suggested migration shape (for the wave plan — not started)

Three work-types (also stamped in CLAUDE.md):
- **(a) True migrations** — port legacy logic onto the spine: Guest CRM (unify identity first), Checklists/Tasks (moat, standalone, early), HR/Attendance/Leave/Roster (standalone), Vendors+commissions, Inventory, Dynamic Pricing, Revenue/Reports/P&L (leaf, last), Campaigns/lead-source, LED, Expense Approval. *(Hall Event flow already done via the slice.)*
- **(b) Catering (extend, not greenfield)** — port the legacy Kitchen donor (per-plate, vendor commission, breakfast, prep) **and** design the new E2E (banquet catering + PN Stays room-dining/F&B + guest-guarantee + inventory link).
- **(c) Rooms/Stays + Yale + Yanolja/OTA** — heaviest: port room lifecycle onto the spine *with the double-booking fix*, then the external-gated builds (Yale key-activation, OTA channel management).

Sequence intuition: standalone staff-ops + Guest identity first (low coupling), Catering + Rooms after (high coupling + external gates), Revenue/Reports last (leaf consumer).
