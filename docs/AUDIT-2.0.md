# PN MASTER SUITE — GRAND AUDIT v2.0
**Phase 0 ground truth · Read-only · Multi-persona expert board · As-is + full re-platform feasibility**

- **Repo:** `~/Desktop/pn-master-suite` · branch `main` · HEAD `9873836`
- **Stack:** React 18.3 + Vite 5 + Tailwind 3.4 + Supabase JS 2.45 + react-router 6 + @sentry/react 10 + lucide-react. Deployed Cloudflare Pages. PWA (SW v2.0.0).
- **Scale audited:** 36,137 LOC in `src/` · 47 pages · 41 hooks · ~120 components · 36 SQL migrations (3,070 LOC) · 41 tables.
- **Build:** **CLEAN** (`vite build` exit 0, 2.38s; main chunk 627 KB / 189 KB gzip + ~50 route chunks).
- **Method:** Six specialist board chairs ran parallel evidence sweeps (every claim carries `file:line` or migration ref); cross-cutting synthesis and the two load-bearing security claims verified firsthand by the chair.
- **Files changed by this audit:** ZERO (this file is the only artifact).

> **Reading note.** Sections 1–9 are the **as-is audit** (the code on its own terms). Section 10 is the **progressive performance path**. Section 11 is a **distinct feasibility judgment** on the Next.js/Vercel/multi-tenant re-platform. An as-is finding is never graded against the future stack.

---

## 1. BOARD VERDICT

**Overall maturity band: `Capable Tool` (trending `Product` on the front-end, stuck at `Prototype` on automation, security-for-scale, and multi-tenancy).**
**Composite: 45 / 100.**

PN Master Suite is a genuinely impressive **single-tenant operations app built by a small team under fire** — the commit trail (PN-001/002/003, FIXES_ROUND2/4, 28-finding audit pass) shows real production scars healed with care. The front-end engineering is the strongest layer: a reference-counted realtime manager, three-tier error boundaries, hard-won auth-boot resilience, role-aware shallow navigation, and a notification "command surface" that most ₹-funded SaaS lacks. The data model is competently typed, RLS is enabled on 100% of tables, and — rare for an Indian hospitality MVP — the **GST model is genuinely correct per revenue stream (18% hall / 12% room / 5% F&B)**.

But the product's reason to exist — *let 3 people do the work of 6 through automation* — **is mostly unbuilt.** There is **zero server-side compute**: no Supabase Edge Functions, no cron, no webhooks, no message/payment/email send. Every "automation" is a client-side query that fires only when a human happens to open the right screen. Overdue follow-ups, expiring date-holds, anniversary nudges, and review requests all "fire" by sitting in a notification badge. The WhatsApp integration is a `wa.me` deep-link, not MCube (which appears nowhere in code). Payments are a manually-typed ledger.

And it is **not safe to put a second tenant on.** A 974 KB HAR file committed to git carries a real session JWT + live guest phone numbers + staff records (CRITICAL breach). Guest Aadhaar/passport numbers are stored plaintext and readable by *every* logged-in role. `is_super_admin()` has no property scope — the instant a second property's admin exists, they can read the first tenant's revenue, PII, and GST data. Multi-tenancy is *accidentally ~70% present in the schema* and *0% present in the product* (no org layer, no provisioning, no billing, no white-label theming — brand color is compiled into the bundle).

### The 5 things that matter most (each ties to a finding ID)
1. **`F-SEC-01` — Purge the committed HAR and rotate.** A live-once session JWT + customer PII + staff salaries are in git history. This is a reportable DPDP breach today, before any rebuild conversation.
2. **`F-DATA-01` — Rooms have no double-booking guard at any layer.** Halls are protected (DB unique index `019`); the 10 rooms — the actual revenue-at-risk inventory — can be double-sold silently. One SQL migration fixes it.
3. **`F-AUTO-01` — There is no server. Nothing fires on a schedule.** The entire efficiency thesis depends on automation that does not exist. Hold-expiry is written but never enforced; expired holds block availability forever.
4. **`F-PROD-01` / `F-SEC-04` — Multi-tenant security is a landmine, not a retrofit chore.** `is_super_admin()` (`018:12`) and the older `EXISTS(staff…)` read policies leak across tenants the moment tenant #2 exists. This gates productization, not the UI.
5. **`F-FIN-03` — No GST-compliant tax invoice exists.** The rates are right, but there is no CGST/SGST split, no HSN/SAC, no invoice number — only a summary report. A B2B sales blocker and compliance gap for every future tenant.

### The 5 biggest risks
- **`R1` Data breach (live):** committed HAR + plaintext Aadhaar readable by housekeeping + ID images on 1-year signed URLs.
- **`R2` Revenue loss / reputation:** silent room double-booking on a wedding weekend.
- **`R3` Data integrity:** client-side multi-step "transactions" (`convertEnquiryToEvent`, settle flow) are non-atomic — partial failure leaves orphaned events/revenue (the code *admits* this, `useEnquiries.js:318`).
- **`R4` One-way door:** global `SERIAL` booking/event/enquiry numbers become an un-fixable cross-tenant numbering leak the moment a second tenant is onboarded.
- **`R5` Operational blindness:** no offline write path — a venue WiFi drop halts check-ins, payments, and checklists with only a toast error.

### The single most important sentence
**The hard part — the India-specific banquet-plus-rooms domain logic — is already built and worth porting; the product's value (automation) and its path to a platform (multi-tenant security + theming + billing) are the parts that are missing, so the transformation is a *retrofit-and-add-the-server*, not a rewrite.**

---

## 2. SCORECARD

| Layer | Score /10 | Maturity band | Top defect | Top opportunity |
|---|---|---|---|---|
| **L0 Business / Operating Model** | 5.0 | Capable Tool | Two parallel silos (events / rooms) loosely cross-sold; no single explicit "spine" object | Promote enquiry→booking→event→settlement to one event-spine with a state machine |
| **L1 Demand & Customer Journey** | 5.5 | Capable Tool | Follow-up *recording* is good but *nothing fires* on overdue (`F-AUTO-02`) | Server-side SLA escalation + omni-channel intake dedup |
| **L2 Product / UX / Workflow** | 7.0 | Product | 30 custom modals with no focus-trap/`role=dialog`/Esc (`F-UX-01`) | One shared accessible `<Modal>`; surface "money to collect today" |
| **L3 Frontend Engineering** | 6.5 | Product | No server-state cache → ~17 parallel fetches per MD dashboard (`F-FE-01`) | TanStack Query + move side-effects to RPCs |
| **L4 Backend & API** | 3.5 | Prototype | All business logic client-side; multi-step writes non-atomic (`F-BE-01`) | Postgres RPCs / Edge Functions for transactional writes |
| **L5 Data & Schema** | 5.5 | Capable Tool | Room double-booking unguarded (`F-DATA-01`); UTC "today" bug (`F-DATA-02`) | GiST `EXCLUDE` constraint; per-property counters |
| **L6 Integrations & Automation** | 2.0 | Prototype | Zero server compute; WhatsApp is a deep-link, not MCube (`F-AUTO-01`) | Edge Functions + cron + WhatsApp API send w/ idempotency |
| **L7 Security / Privacy / Compliance** | 3.0 | Prototype | Committed HAR w/ live JWT+PII (`F-SEC-01`); plaintext Aadhaar all-staff-readable (`F-SEC-02`) | Column-masked PII views; DPDP consent/retention/erasure |
| **L8 Infra / DevOps / Reliability / Cost** | 4.0 | Capable Tool | No CI, no tests, no lint gate; forward-only migrations (`F-OPS-01`) | CI pipeline + edge cron + transactional outbox |
| **L9 Productization & Multi-tenancy** | 2.5 | Prototype | Brand compiled into bundle; no org/billing/provisioning (`F-PROD-02`) | Runtime theming + org layer + subscription/entitlements |
| *Dimension: Revenue / Finance* | 5.5 | Capable Tool | No GST tax invoice (`F-FIN-03`); ≤₹7,500 room threshold not enforced (`F-FIN-01`) | Invoice generator on the correct rate model already present |
| *Dimension: Business Intelligence* | 4.0 | Capable Tool | 17-card browse wall; no "do this today" synthesis (`F-BI-01`) | Single action/north-star surface; pacing-to-target alerts |

**Composite = mean(L0–L9) ≈ 4.45/10 → 45/100.** The spread is the story: a 7/6.5 front-end bolted to a 2/3 automation-and-security core.

---

## 3. PER-LAYER DEEP FINDINGS (L0–L9)

### L0 — Business & Operating Model — 5.0
The code encodes a *real* operating model, but as **two loosely-joined silos rather than one spine**:
- **Hall spine:** `enquiries → follow_ups → events → event_catering/event_vendors → revenue_entries` with a status flow `confirmed→preparation→in_progress→completed→settled` (`constants.js:311`). This is coherent and is the strongest domain model.
- **Rooms spine:** `room_enquiries → room_bookings` with `reserved→checked_in→checked_out` (`constants.js:448`), cross-sold to events via `EventRoomCrossSell` + `getEventRoomSuggestion` (`useCrossSelling.js:10`).
- **Cross-cutting:** Guest CRM (`guests` auto-upserted by phone), checklists/tasks, HR/attendance/roster, revenue/expense, kitchen, dynamic pricing.

There is **no single canonical "booking/event" object** — a hall event and a room stay are different tables with different lifecycles, joined only by `linked_event_id` and a JSONB `events.rooms_blocked`. The implicit model the code enforces is *"a venue that does halls AND rooms AND has staff ops,"* which is exactly the niche — but it's expressed as modules, not a spine. **Opportunity:** an event-spine architecture (the stated target) is the right call; the domain logic to feed it already exists.

### L1 — Demand & Customer Journey — 5.5
- **Capture (S1):** 14 sources (`constants.js:198`), campaign attribution for `CAMPAIGNABLE_SOURCES`. **No dedup at capture** — `createEnquiry` (`useEnquiries.js:156`) checks blacklist by phone but not for an existing open enquiry → duplicate pipeline cards. All intake is hand-keyed; no inbound WhatsApp/web-form/missed-call ingestion.
- **Qualify (S2):** `createFollowUp` auto-derives `next_follow_up_date` from outcome (`useFollowUps.js:14,116`) — the one genuine enforcement-leaning mechanism. But **overdue follow-ups fire nothing** (`F-AUTO-02`): `useOverdueFollowUps` is a pull query computed on screen mount; SLA granularity is a DATE, so the "2-hour rule" in comments is uncomputable.
- **Retain (S9):** auto-CRM works well — `recordCompletion` bumps guest LTV counters, wedding events auto-seed `wedding_anniversary` special dates (`useEvents.js:237`), completion auto-creates a +2h review-request task (`:280`). Repeat/LTV roll-up **Works**. Referral is captured (`referred_by`) but has **no reward loop / no attribution back to the referrer**.

### L2 — Product / UX / Workflow — 7.0 (highest layer)
- **Navigation:** role-aware bottom nav of 3–4 tabs (`BottomNav.jsx:6-28`); 24 secondary destinations behind a role-filtered **More** page. Shallow, scannable, overdue badge on Pipeline.
- **Daily-action click counts:** walk-in check-in = **1 tap** (surfaced on stays dashboard, `StaffDashboard.jsx:176`); enquiry follow-up ≈ 3–4 taps; **record payment ≈ 4 taps and buried** inside EventDetail (a daily action with no Home shortcut).
- **Consistency:** standardized `LoadingSpinner` (39 files), `Skeleton` (35), `EmptyState` (29). The `NotificationBell` (`useNotifications.js`) is a real "what needs me now" surface — overdue tasks/follow-ups, cleaning rooms, expiring holds, anniversaries, all role-scoped + deep-linked.
- **Weak spots:** the **MD dashboard is a 17-card scroll wall** with no prioritization beyond order (`MDDashboard.jsx:47-62`); `Home.jsx:27` frames it as "daily overview… tap the bell" (browse, not command).
- **Accessibility — weakest UX area:** **30 `fixed inset-0` modals** with no `role="dialog"`, `aria-modal`, focus trap, or Escape (only `BottomSheet.jsx:87` is correct) — a WCAG 2.1 AA blocker. Toasts not in an `aria-live` region. `--text-tertiary #8a8a8a` = 3.5:1 (fails AA body text); `text-gray-400/500` used 320+ times. Tap targets pass (44px min, `global.css:103`).
- **Design tokens:** real system (maroon/gold/ink + CSS vars + DM Serif/DM Sans) but ~70% adopted — ~600 off-token `text-gray-*` utilities + scattered raw hex. **Doc drift:** CLAUDE.md says Playfair; app uses **DM Serif Display**. Legacy **`ink-*` inversion hack** (`tailwind.config.js:46`) inverts the scale (`bg-ink-900` = light page bg) across 59 files — a semantic footgun.

### L3 — Frontend Engineering — 6.5
- **State:** hand-rolled `useState+useEffect+supabase` in all 33 list-tier hooks; **no React Query/SWR/Redux** (`package.json:14`). No cross-hook cache → the MD dashboard mounts ~17 hooks = ~17 parallel round-trips per Home load (`F-FE-01`). `AppShell.jsx:38` `key={location.pathname}` full-remounts + refetches on every navigation.
- **Realtime (`realtimeManager.js`) — best module in the app:** reference-counted shared channels, snapshot-iterate subscribers to survive sync-unsubscribe (`:51`), one-retry-then-blacklist on CLOSED for free-tier quota (`:84`), callback-via-ref so changing callbacks don't tear the socket (`:159`).
- **Error handling:** three-tier boundaries (root→screen→fallthrough around the shift gate, `AppShell.jsx:52`); uniform hook try/catch → inline error text. **But best-effort writes swallow silently** — activity log, CRM links, revenue auto-log all `console.warn` and continue (`useEvents.js:23,308`), invisible to user and Sentry. `useChecklists.js:16` `logActivity` lacks try/catch (will reject the mutation).
- **Bundle:** 627 KB / 189 KB gzip main chunk; route + hook chunks already split correctly. Dominated by `@supabase` + `@sentry/react` (synchronous in `main.jsx:3`, ~60–80 KB gzip in the cold-load critical path) + `lucide` shell icons. `manualChunks: undefined` (`vite.config.js`) = no stable vendor chunk → app-code deploys re-download react/supabase. **Quick wins:** lazy-init Sentry; add a vendor `manualChunks` split.
- **PWA/SW:** sound — scripts/styles network-only (fixes stale-chunk MIME bug), Supabase never cached, nav network-first w/ `/` fallback. **Gap:** iOS apple-touch-icon is SVG (ignored by iOS); needs a PNG.

### L4 — Backend & API — 3.5
- **There is no backend.** All logic is client-side; the only server is Supabase (Postgres + RLS + Realtime + Storage + Auth). **No Edge Functions** (`supabase/functions/` does not exist), no API layer, no RPCs for the multi-step flows.
- **Non-atomic "transactions" (`F-BE-01`):** `convertEnquiryToEvent` (`useEnquiries.js:322`) and the settle path in `updateEvent` (`useEvents.js:132-314`, 180 lines) chain 6–8 sequential client writes (event insert → revenue auto-log → guest upsert → LTV → anniversary → review task). The code explicitly notes partial-failure leaves an orphaned event (`:318`). This belongs in a Postgres function with a transaction.
- **Concurrency:** optimistic `version` column on checklist items (`027`) enforced only app-side; events/bookings are **last-write-wins** (realtime reload overwrites local edits); catering is explicitly "form is sole source of truth" (`useEventCatering.js:12`).
- **Validation** lives in forms only; a direct `supabase` call from devtools bypasses all of it (RLS is the only real gate).

### L5 — Data & Schema — 5.5
- **Strengths:** 41 tables, all UUID PK, `TIMESTAMPTZ` throughout, real Postgres enums in the core modules, generated columns (`room_bookings.nights`, `leave_requests.days`), sensible FK graph, RLS on every table, two thoughtful partial-unique concurrency guards.
- **`F-DATA-01` Room double-booking unguarded (CRITICAL):** no `EXCLUDE`/unique/overlap constraint on `room_bookings`; `idx_room_bookings_dates` (`010:114`) is plain B-tree; `createBooking` (`useRoomBookings.js:156`) inserts with zero availability check. Two overlapping bookings both commit. (Halls *are* protected by `uq_events_venue_date_active`, `019:17` — rooms were forgotten.)
- **`F-DATA-02` UTC "today" bug:** `todayISO()` / `toISOString().slice(0,10)` (`useDateHolds.js:29`, `useRoomBookings.js:587`) ignore `properties.timezone='Asia/Kolkata'`; wrong date 00:00–05:30 IST for occupancy, check-in matching, hold ranges.
- **`F-DATA-03` Type-discipline regression:** migrations ≤016 use enums; **028 onward revert to bare `TEXT` with no CHECK** (~15 status/category fields, e.g. `028:77,93`, `030:33`, `032:11`, `033:13`). `rooms.room_number` and `venues.code` are **not unique even within a property**. No `ON DELETE` anywhere; `021:65`'s "cascade" comment is **false** (no `ON DELETE CASCADE` exists — a guest delete will FK-error, not cascade).
- **`F-DATA-04` Missing indexes** on hot RLS columns (`staff(property_id, role)`, `revenue/expense.*_by`, `guest_interactions.staff_id`).
- **`F-DATA-05` Date holds race:** `ensureHoldForEnquiry` is SELECT-then-INSERT with no DB uniqueness (`useDateHolds.js:67`) — TOCTOU duplicate holds.

### L6 — Integrations & Automation — 2.0 (lowest layer)
| Integration | True status | Evidence |
|---|---|---|
| WhatsApp / MCube | **STUB (deep-link)** | `wa.me` link + `window.open` (`useWhatsAppTemplates.js:25`, `SendMessageModal.jsx:92`); **MCube absent from code** |
| Payments | **ABSENT (manual ledger)** | `recordPayment` writes amount fields (`EventDetail.jsx:247`); no Razorpay/UPI/webhook |
| Google reviews | **MANUAL deep-link** | `ReviewRequestButton`; `016` adds columns only, no trigger |
| OTA sync | **ABSENT** | source enums only; no channel-manager/iCal |
| Email / SMS | **ABSENT** | no provider anywhere |
| Anniversary/review/follow-up nudges | **BUILT-BUT-PASSIVE** | pull queries on mount/focus (`useNotifications.js:311`) |
| Sentry | **LIVE** (errors + 10% traces; replay dropped) | `src/lib/sentry.js` |
| PWA/SW | **LIVE** | `public/sw.js` v2.0.0 |
- **`F-AUTO-01`** Zero server-side compute. **`F-AUTO-02`** Nothing fires on a schedule — automations are render-time queries. **`F-AUTO-03` Hold-expiry written but never released** (`useDateHolds.js:80`): an expired hold keeps blocking availability (`useDateAvailability.js:48`) forever; no sweeper. **`F-AUTO-04`** Fire-and-forget everywhere — no retry/idempotency/outbox; `usage_count` read-then-increment is a lost-update race (`useWhatsAppTemplates.js:144`).

### L7 — Security, Privacy & Compliance — 3.0
- **`F-SEC-01` (CRITICAL, verified firsthand):** `pn-master-suite.pages.dev.har` (974 KB) is **git-tracked** (commit `9873836`) and contains a real `authenticated` session JWT (`sub fcca7a58…`, `email mail2vignessh@gmail.com`, exp `1778615120` = 2026-05-12, now past, no refresh token), plus guest PII (`guest_name`/`guest_phone` e.g. `7904811710`) and staff records (`staff?select=*` incl. role/phone). Reportable DPDP breach.
- **`F-SEC-02` (CRITICAL):** Aadhaar/passport stored **plaintext** in `room_bookings.guest_id_number` (`010:68`), captured at `BookingCreateForm.jsx:134`. ID **photos** uploaded to the (now-private, `023`) bucket but persisted as **1-year `createSignedUrl`** (`PhotoCapture.jsx:78`) — an unauthenticated year-long bearer link rendered in `BookingDetail.jsx:215`. DPDP: **no consent, retention, erasure, or PII-read audit** (`grep` = none).
- **`F-SEC-03` (HIGH):** over-broad **READ** RLS — `guests` (`016:177`), `room_bookings` (`010:131`), `room_enquiries` (`015:207`), `revenue/expense_entries` (`014:104`) are readable by *any* authenticated staff incl. housekeeping. UI role-gating (`BookingList.jsx:18`) is cosmetic; a devtools `supabase.from('staff').select('salary')` succeeds.
- **`F-SEC-04` (HIGH, verified):** `is_super_admin()` (`018:12`) checks `role='super_admin'` with **no property scope** → cross-tenant escalation the instant tenant #2 exists. Compounded by older `EXISTS(staff…)` read policies that don't scope by `property_id`.
- **`F-SEC-05` (HIGH):** `ShiftEnforcementGate.jsx` is a cosmetic React overlay — data layer live behind it; "Start without location" self-clears (`:277`); geofence is advisory by design (`025`).
- **MEDIUM:** `FOR ALL`=any-authenticated writes survived `021` on `tasks`/`incidents`/`guest_interactions`/`guest_special_dates`; CSV formula injection (`csv.js:5`, `BookingList.jsx:22` don't neutralize `= + - @`); no MFA (`aal1`); staff read colleague salary (`001:77`).
- **Compliance moat:** **Form C** export lacks nationality/passport-country (can't satisfy FRRO — it's a mislabeled guest register); **FSSAI / Fire NOC / music licence (PPL/IPRS)** entirely absent; **GST** report is a summary, not filing-format (no HSN/SAC, no GSTR export).
- **Credit:** `is_super_admin()` is otherwise textbook (SECURITY DEFINER + pinned `search_path` + REVOKE PUBLIC); no `service_role` key in client; `.env` gitignored; no `dangerouslySetInnerHTML`/raw SQL; migrations 021–023 closed real write holes.

### L8 — Infra / DevOps / Reliability / Cost — 4.0
- **No CI/CD** (no `.github/`, `wrangler.toml`, `vercel.json`); `lint` = `echo 'lint not configured'`; **no tests, no type-check gate**. Deploy = CF Pages git build.
- **Environments:** `.env` (2 vars) + `.env.example`; hard-fail on missing config (`supabase.js:9`). No staging/prod split beyond `import.meta.env.PROD`.
- **Observability:** Sentry only (errors + 10% traces). No uptime/synthetic, no DB metrics, no alerting.
- **DR:** Supabase managed defaults only; **forward-only migrations, no `down`/rollback** (`F-OPS-01`).
- **Rate limiting:** none app-side (only realtime `eventsPerSecond:5`).
- **Vendor lock-in:** *light* to Cloudflare (portable SPA + `_redirects`); *real* lock-in is **Supabase** (auth/RLS/realtime/storage).
- **Cost curve [INFERRED]:** at 1× tenant, Supabase free/Pro + CF Pages free ≈ near-zero. At 100× tenants on one Supabase project, RLS-subquery cost (un-indexed `staff` lookups, `F-DATA-04`) and realtime quota become the first walls. At 1000×, single-project Postgres is the ceiling — needs connection pooling + read replicas or per-region projects. *Confirm with load test.*

### L9 — Productization & Multi-tenancy — 2.5
- **Tenant boundary — accidental & partial:** `properties` table + `property_id` on every table + RLS write-scoping to caller's property = **schema ~70% tenant-ready**. But run single-tenant: `PropertyContext.jsx:7` ("single property for MVP"); one `property_id` per staff; **no org layer, no property switcher, no multi-tenant membership**.
- **`F-PROD-01`** (= `F-SEC-04`) unscoped privilege checks = the gating retrofit risk.
- **`F-PROD-02` White-label theming absent:** maroon `#6e1423`/gold `#BF9B30` compiled into Tailwind + static CSS vars (`global.css:17`) + `index.html` meta + static `pn-logo.png`. White-label = per-tenant rebuild today. App name hardcoded across `index.html`/`manifest.json`/`package.json`/`sw.js`.
- **`F-PROD-03` No billing/entitlements:** grep for subscription/plan/tier/stripe/feature-gate = nothing. ₹999/1,999/4,999 tiers have **no code substrate**; every module is unconditionally available.
- **`F-PROD-04` Provisioning = hand-edited seed migrations** (003/009/011/029/031/034 keyed `WHERE code='PN'`). No signup/wizard.
- **`F-PROD-05` Hall package rates hardcoded in JS** (`constants.js:368`) and consumed by the live conversion flow (`EnquiryToEventModal.jsx:133`).

---

## 4. BUSINESS-FLOW STRESS-TEST (S1–S11)

| # | Scenario | Status | Operator effort | Break-point (evidence) |
|---|---|---|---|---|
| S1 | Enquiry capture (omni-source) | **Partial** | 12 fields, manual | Source attribution works; **no dedup at capture** (`useEnquiries.js:156`); no inbound channel ingestion |
| S2 | Qualification & follow-up **enforcement** | **Partial→Manual** | low | Outcome-derived next-date works (`useFollowUps.js:14`); **overdue fires nothing** (`useNotifications.js:311`) |
| S3 | Quotation & negotiation | **Manual / Absent** | single amount field | No configurator/PDF/validity/revision/auto-send — "quote" is one rupee number (`EnquiryDetail.jsx:455`) |
| S4 | Booking + advance + double-book guard | **Hall: Works · Rooms: Absent** | 1–3 taps | Hall = DB unique + pre-flight (`019`, `useEnquiries.js:335`); **rooms unguarded** (`useRoomBookings.js:156`); hall guard is **date-only, not slot-aware** |
| S5 | Event planning (BEO / function sheet) | **Partial / Absent** | medium | **No BEO/function sheet**; per-plate math works but **no guest-guarantee model** (`useEventCatering.js:47`); vendor commission + room block work |
| S6 | Pre-event ops | **Partial** | medium | Daily checklists auto-gen client-side on app open (`useChecklists.js:363`); **pre-event checklist manual**; **no inventory draw-down vs event** |
| S7 | Event-day execution | **Partial** | low | GPS flag-not-block (`gps.js:53`) + photo-gated checklist (`ChecklistItemRow.jsx:8`) work; **no offline write path** (`sw.js:80`) |
| S8 | Settlement | **Partial** | medium | Room deposit reconciliation works (`GuestCheckOut.jsx:25`); **event balance hard-set to 0** (`EventDetail.jsx:258`, kills partial pay); **no GST invoice**; event deposit/forfeiture never reconciled |
| S9 | Post-event lifecycle | **Works (mostly)** | low | Review-task + anniversary + LTV auto (`useEvents.js:237,262,280`); sending is manual; **no referral reward loop** |
| S10 | Owner's daily command | **Partial (browse, not decide)** | scroll | Exceptions float to top (good) but **17-card wall, no "money to collect today," no decision queue** (`MDDashboard.jsx:47`) |
| S11 | Failure & edge | **mostly Absent** | — | See below |

**S11 detail:** Hall double-book recovery **Works**; room double-book **Absent**; postponement/reschedule **Absent** (no event-date edit UI); cancellation **Partial** (status flip only, no refund/forfeiture math); no-show **Manual** (status value only); offline **Absent**; partial-payment dispute **events Absent / rooms Partial**; concurrent edits **last-write-wins**; deposit forfeiture **rooms Partial / events Absent**; non-technical-staff-under-pressure **Mixed** (good: outcome-derived dates, blacklist gate, photo gating; bad: no availability warning, silent offline failure).

---

## 5. CROSS-CUTTING SYNTHESIS

### Coupling map (single defects spanning multiple layers = highest leverage)
- **C1 — No server compute** spans L4+L6+L8+L1+S2+S9: every missing automation, every non-atomic write, every "nothing fires" trace traces back to this one absence. *Highest-leverage single addition in the codebase.*
- **C2 — Room double-booking** spans L5+S4+S11+revenue+reputation: one missing DB constraint = direct revenue/reputation risk.
- **C3 — Over-broad RLS reads + no theming/org** spans L7+L9+L0: the same single-tenant assumption is both a security hole and the productization blocker.
- **C4 — No server-state cache** spans L3+L2+L8: drives the 17-fetch dashboard (perf), the remount-on-nav (UX), and avoidable Supabase egress (cost).
- **C5 — Correct GST rates but no invoice** spans finance+L7+GTM: the hard part (right per-stream rates) is done; the sellable part (the invoice document) is missing.

### Docs-vs-reality drift
| Doc claim | Reality | Evidence |
|---|---|---|
| "WhatsApp via MCube Engage" | `wa.me` deep-link; MCube absent from code | `useWhatsAppTemplates.js:25` |
| Tailwind "Playfair" font | App uses **DM Serif Display** | `tailwind.config.js`, `index.html` |
| "RLS on all tables" (true) but implies tenant isolation | Several read policies don't scope by `property_id` | `010:131`, `016:177` |
| `021:65` comment "cascade … via foreign keys" | No `ON DELETE CASCADE` exists | migration `021` |
| CLAUDE.md "GST 18% hall, 12% rooms" | Correct, **and** 5% F&B is also implemented (better than documented) | `028`, `useBreakfastOrders.js:72` |
| "10 hotel rooms" | 12 rooms seeded (10 sellable + 2 bride/groom) | `011/012` |

### Risk register
| ID | Risk | Sev × Likelihood | Blast radius | Mitigation |
|---|---|---|---|---|
| R1 | Committed HAR + plaintext Aadhaar (F-SEC-01/02) | High × **Certain (live)** | All guests/staff; legal | Purge history, rotate, mask Aadhaar, on-demand short-TTL URLs, DPDP workflow |
| R2 | Room double-booking (F-DATA-01) | High × High | Revenue, reputation | GiST `EXCLUDE` constraint + pre-flight check |
| R3 | Non-atomic writes (F-BE-01) | Med × High | Data integrity | Move to Postgres RPC/transaction |
| R4 | Global SERIAL one-way door (F-DATA-03) | High × Med (on tenant #2) | All future tenants | Per-property counters **before** tenant #2 |
| R5 | No offline writes (S7/S11) | Med × Med | Event-day ops | Offline queue + background sync |
| R6 | Cross-tenant escalation (F-SEC-04) | High × Med (on tenant #2) | Cross-customer breach | Property-scope `is_super_admin()` + rewrite reads |

---

## 6. MODULE INVENTORY + PORT/REBUILD LEDGER

Default posture: **port hard-won domain logic, replace scaffolding.** Verdicts assume the Next.js/Supabase multi-tenant target (Section 11).

| Module / area | Key files | Status | Domain value | Re-platform verdict |
|---|---|---|---|---|
| Enquiries + follow-ups + pipeline | `useEnquiries.js`, `useFollowUps.js`, `EnquiryPipeline` | Built | **High** (outcome-derived SLA, stages) | **Port logic**, add server SLA firing + dedup |
| Events + catering + vendors | `useEvents.js`, `useEventCatering.js` | Built | **High** (per-plate, commission, conversion) | **Port logic**, move multi-step write to RPC |
| Rooms + bookings | `useRoomBookings.js`, `BookingCreateForm` | Built | **High** (caution deposit, checkout math) | **Port + fix** (add overlap constraint) |
| Room enquiries / holds | `useRoomEnquiries.js`, `useDateHolds.js` | Built | Med | **Port**, add expiry sweeper + DB uniqueness |
| Calendar / availability | `useCalendar.js`, `useDateAvailability.js` | Built | Med | Port; make slot-aware |
| Guest CRM | `useGuests.js`, `useGuestSpecialDates.js`, `useCrossSelling.js` | Built | **High** (LTV, anniversary, dedup) | **Port logic**, add PII column-masking |
| Checklists / tasks | `useChecklists.js`, `useTasks.js` | Built | **High** (photo-gated, auto-gen) | **Port**, move auto-gen to cron |
| HR / attendance / leave / roster | `useAttendance.js`, `useShifts.js`, `useRoster.js` | Built | Med | Port |
| Revenue / expenses / GST report | `useRevenue.js`, `useReports.js` | Built | **High** (correct per-stream GST) | **Port the GST model**, build invoice on top |
| Dynamic pricing | `useDynamicPricing.js` (`030`) | Built | **High** (sellable premium feature) | **Port** |
| Kitchen & vendor ops | `useMenuItems.js`, `useVendors.js`, `useKitchenPrep.js` | Built | Med-High | Port |
| Inventory | `useInventory.js` | Built | Med | Port; wire draw-down |
| Expense approvals | `useExpenseApprovals.js` (`032`) | Built | Med (clean RLS) | Port |
| WhatsApp templates | `useWhatsAppTemplates.js` | Stub (deep-link) | Med (templates) | **Port templates, rebuild send** (API + idempotency) |
| Realtime manager | `utils/realtimeManager.js` | Built | **High** (best module) | **Port wholesale** |
| Auth / shell / notifications | `AuthContext`, `AppShell`, `useNotifications.js` | Built | High | **Rebuild on App Router**, keep notification logic |
| Shift enforcement gate | `ShiftEnforcementGate.jsx` | Built | Low (cosmetic) | **Rebuild** (enforce server-side or drop) |
| Theming / brand | `tailwind.config.js`, `global.css` | Single-tenant | — | **Rebuild** (runtime CSS-var theming) |
| Billing / org / provisioning | — | **Absent** | — | **Build new** |
| `pn_audit_dashboard.jsx` (root) | — | **Dead** (unimported) | — | **Drop** |

---

## 7. SCHEMA DUMP + MULTI-TENANT RETROFIT MAP

**41 tables, all UUID PK, RLS enabled on all.** Money = `DECIMAL/NUMERIC(10,2)`; dates `DATE`; times `TIMESTAMPTZ`. Full per-table inventory (columns, FKs, constraints, indexes, audit cols) is captured in the L5 working notes; the retrofit-critical view:

**Tenant-readiness:** every business table already carries `property_id REFERENCES properties(id)`. Tables from migration **028 onward have `property_id NOT NULL` (correct)**; the **18 older tables have nullable `property_id`** and must be backfilled + `SET NOT NULL` *while only PN data exists*.

| Retrofit action | Tables affected | One-way door? |
|---|---|---|
| `property_id` → NOT NULL + index | staff, shifts, activity_log, checklist_*, tasks, daily_reports, incidents, venues, campaigns, enquiries, follow_ups, events, rooms, room_bookings, revenue/expense_entries, led_advertisers, shift_roster, leave_requests, attendance_records, room_enquiries, date_holds, guests, guest_interactions, whatsapp_templates, guest_special_dates | No (safe now) |
| Replace global `SERIAL` with per-property counters | enquiry_number, event_number, booking_number, room_enquiries.enquiry_number | **YES — must precede tenant #2** |
| Rewrite `EXISTS(staff…)` reads → `property_id IN (…)` | events, room_bookings, room_enquiries, guests, revenue/expense_entries | **YES (post-onboarding = live breach)** |
| Property-scope `is_super_admin()` + introduce org entity | all `is_super_admin()` / `FOR ALL` policies | **YES** |
| Add `UNIQUE(property_id, room_number)` / `(property_id, code)`; promote 028+ `TEXT`→enum/CHECK; define `ON DELETE` | rooms, venues, kitchen/pricing/inventory tables | No |
| Add GiST `EXCLUDE` on `room_bookings(room_id, daterange)` | room_bookings | No |

**Data-migration verdict:** existing PN data moves to a multi-tenant schema **without loss** if done before tenant #2 — backfill is trivial at one-tenant scale. The **only true one-way doors are the global SERIALs** (already-issued booking/invoice numbers in customers' hands can't be renumbered) and any printed artifacts.

---

## 8. SINGLE-PROPERTY COUPLING LIST (`file:line`)

| Value | Location | Type | Fix |
|---|---|---|---|
| Name/code 'PN'/GSTIN `33AHMPV8764D1ZU`/PAN/address/phones/owner | `003_seed_pn_property.sql:10-15` | seeded (1 row) | → onboarding wizard |
| `city 'Chennai'`, `state 'Tamil Nadu'`, `gst_rate 18.00`, `timezone`, `currency 'INR'` | `001_core_tables.sql:14-27` | hardcoded defaults | OK (per-tenant columns exist) |
| Venues "Main Hall/Lake View Dining/Mini" | `009_seed_venues.sql:4-20` | seeded `WHERE code='PN'` | per-tenant config |
| 12 rooms, numbers, rates 2500-4000, "Lake View" | `011_seed_rooms.sql:5-18` | seeded | per-tenant |
| **Hall PACKAGES silver/gold/platinum ₹65k/120k/160k** | **`constants.js:368-378`** | **hardcoded in JS** | **per-tenant DB table** |
| `CAUTION_DEPOSIT 2000`, `MONTHLY_REVENUE_TARGET 1000000` | `constants.js:169,499` | hardcoded | → `properties.settings` |
| Festival rate rules (Pongal/Diwali 2026, +20% weekend) | `031_seed_pricing_rules.sql:8-30` | seeded | per-tenant |
| WhatsApp template copy + phones 9444094450/9150965556 + pnhall.com | `017_seed_whatsapp_templates.sql:10-52` | seeded | tenant template lib + var substitution |
| "Pooranam Nachiyar · Red Hills" login branding | `LoginPage.jsx:82` | hardcoded UI | tenant theming |
| "Contact Vicky" support text | `LoginPage.jsx:243`, `Home.jsx:63` | hardcoded staff name | tenantize |
| App name "PN Master Suite" | `index.html:10,14,24`, `manifest.json:2,4`, `package.json:6`, `sw.js:1` | hardcoded | neutral product name |
| **Maroon `#6e1423` + gold `#BF9B30`** | **`tailwind.config.js:23-48`, `global.css:17-27`, `index.html:9`** | **compiled brand** | **runtime theming (white-label blocker)** |
| Google Maps / review URL | `016_guest_crm.sql:157` | seeded | per-tenant |
| Geofence coords | `025_property_geofence.sql` | seeded (columns — good) | per-tenant |

Genuine constants (status enums, role labels, GST *math*) are clean. The dangerous three: **(1) brand compiled into the bundle, (2) hall rates in JS, (3) per-tenant content delivered via seed migrations instead of provisioning.**

---

## 9. WORLD-CLASS BENCHMARK — gap per layer

| Layer | What a category leader (Mews / Cloudbeds / Toast + a real banquet BEO) does | PN gap | Band |
|---|---|---|---|
| L0 | One event-spine object, state-machine-driven | Two silos joined by FKs | Capable Tool |
| L1 | Omni-channel auto-ingest, SLA bots, win-back automation | Manual intake, pull-only follow-up | Capable Tool |
| L2 | A11y-certified, command-first dashboards | Strong UX, modal a11y fails, browse-first MD view | Product |
| L3 | Query cache, optimistic UI, offline-first | Hand-rolled fetches, no cache, online-only | Product |
| L4 | Server APIs, transactions, idempotency | No server; client multi-step writes | Prototype |
| L5 | Exclusion constraints, tenant counters, triggers | No room guard, global SERIALs, TEXT enums | Capable Tool |
| L6 | Channel manager, payment links, WhatsApp API, schedulers | Deep-links + manual ledger, no compute | Prototype |
| L7 | SOC2-grade RBAC, PII vault, consent/retention | Plaintext Aadhaar, broad reads, committed secret | Prototype |
| L8 | CI/CD, IaC, SLOs, DR drills | No CI/tests, forward-only migrations | Capable Tool |
| L9 | Self-serve onboarding, white-label, metered billing | None of it; brand compiled in | Prototype |

---

## 10. THE PROGRESSIVE PERFORMANCE PATH

### 10.1 If we do only 5 things (highest leverage, with evidence → outcome)
1. **Purge the HAR from git history + rotate + mask Aadhaar + DPDP basics.** *Evidence:* `F-SEC-01/02` (verified). *Outcome:* removes a live, reportable breach — non-negotiable before any tenant or investor sees the repo.
2. **Add a GiST `EXCLUDE` constraint on `room_bookings` + pre-flight availability check.** *Evidence:* `F-DATA-01`, S4. *Outcome:* makes room double-booking structurally impossible — one migration closes the top revenue/reputation risk.
3. **Stand up server-side compute (Supabase Edge Functions + cron) and move the multi-step writes into Postgres RPCs.** *Evidence:* `C1`, `F-AUTO-01/02/03`, `F-BE-01`. *Outcome:* the entire automation thesis becomes possible; hold-expiry sweeper, SLA firing, atomic settlement all unlock from this one foundation.
4. **WhatsApp API send (real, idempotent) on event/checkout completion + follow-up SLA.** *Evidence:* `F-AUTO-01`, S2/S9. *Outcome:* converts the manual one-tap-per-guest motion into the labor-saving automation that is the product's reason to exist.
5. **GST tax-invoice generator on the existing correct rate model (CGST/SGST split, HSN/SAC, invoice number).** *Evidence:* `F-FIN-03`, `C5`. *Outcome:* turns a compliance gap into a sellable feature; the hard part (rates) is already done.

### 10.2 Effort × Impact matrix
```
            LOW EFFORT                          HIGH EFFORT
HIGH   ┌───────────────────────────┬────────────────────────────┐
IMPACT │ • Purge HAR + rotate (F-SEC-01)   │ • Edge Functions + cron + RPCs (C1)│
       │ • Room EXCLUDE constraint (F-DATA-01)│ • WhatsApp API send (F-AUTO-01)  │
       │ • Release expired holds sweeper*  │ • GST invoice generator (F-FIN-03) │
       │ • Mask Aadhaar / short-TTL URLs   │ • Multi-tenant security retrofit   │
       │ • Lazy Sentry + vendor chunk      │   (F-SEC-04 / F-PROD-01)           │
       │   (F-FE bundle)                   │ • Runtime theming engine (F-PROD-02)│
       ├───────────────────────────┼────────────────────────────┤
LOW    │ • Delete dead files (pn_audit*,   │ • TanStack Query migration (F-FE-01)│
IMPACT │   .har, .env.save)                │ • Offline write queue (S7/S11)     │
       │ • Fix UTC→IST today() (F-DATA-02) │ • Billing/entitlements (F-PROD-03) │
       │ • Tighten over-broad RLS reads    │ • BEO/function-sheet generator (S5)│
       │   (F-SEC-03)                      │ • Accessible <Modal> refactor (F-UX-01)│
       └───────────────────────────┴────────────────────────────┘
   *sweeper needs the Edge/cron foundation but is trivial once it exists.
```
**Quick wins (do first):** HAR purge, room constraint, expired-hold sweeper, Aadhaar masking, UTC→IST fix, RLS read tightening, bundle (lazy Sentry + vendor chunk), delete dead files.

### 10.3 Sequenced path — 4 waves
- **Wave A — Stop the bleeding (days, on current stack).** Entry: as-is. Exit: no live breach, no room double-booking, no silent hold leak, IST-correct dates, tightened reads, lighter bundle. *Why first:* these are safety/correctness defects that cost little and must not be carried into any rebuild. Covers F-SEC-01/02/03, F-DATA-01/02, F-AUTO-03, F-FE bundle.
- **Wave B — Foundation (the platform skeleton).** Entry: Wave A done. Exit: an org/tenant entity above property; `is_super_admin()` property-scoped; all reads `property_id`-scoped; per-property counters; runtime theming engine; an OP-MODEL doc and event-spine data model; server-compute substrate (Edge Functions + cron) live. *Why before C:* you cannot safely run the real spine on real data — or onboard a second tenant — until the tenant-isolation and server foundation exist. Covers F-SEC-04, F-PROD-01/02, F-DATA-03 (counters), C1.
- **Wave C — The spine (on PN's real data).** Entry: Wave B. Exit: Enquiry→Booking→Event→Settlement as one atomic, RPC-backed spine with slot-aware availability, GST invoice, WhatsApp-API automation, BEO output, offline writes. *Why before D:* the spine must be proven on one real venue before it's sold to others. Covers F-BE-01, F-AUTO-01/02, F-FIN-03, S4/S5/S8/S11.
- **Wave D — Productization & GTM.** Entry: Wave C proven on PN. Exit: self-serve onboarding wizard, metered billing + entitlements/feature-gates (₹999/1,999/4,999), white-label per-tenant brand, 3–5 design-partner halls live. Covers F-PROD-03/04/05.

### 10.4 Port-vs-rebuild ledger
See Section 6. Summary: **port** all domain hooks (enquiries, events, catering, rooms, CRM, checklists, dynamic pricing, GST model) and the realtime manager; **fix-on-port** rooms (constraint) and multi-step writes (RPC); **rebuild** the app shell on App Router, the theming/brand, and the shift gate; **build new** org/billing/provisioning; **drop** `pn_audit_dashboard.jsx`. The default ("port logic, replace scaffolding") holds for ~80% of the code — the domain logic is the asset.

### 10.5 The efficiency thesis (hours saved / month, ranked) — the product's reason to exist
Automations that let PN's 3 people do a 6-person property's work. Estimates are `[INFERRED]` from the flows traced; *confirm against PN's actual volumes.*

| Automation | Replaces | Est. hrs saved/mo | Status today |
|---|---|---|---|
| WhatsApp-API send (confirmations, balance reminders, review, anniversary) on triggers | manual per-guest wa.me taps + remembering | **25–40** | Stub |
| Follow-up SLA firing + escalation (server) | manually scanning the pipeline for aging leads | **15–25** (and recovered revenue) | Absent |
| GST invoice + receipt auto-generation | manual invoice typing per event/booking | **8–15** | Absent |
| Expired-hold sweeper + slot-aware availability | manual calendar reconciliation, lost slots | **5–10** (+ revenue) | Absent |
| BEO/function-sheet auto-generation | re-keying event specs for kitchen/captain/décor | **8–12** | Absent |
| Payment links + auto-reconciliation | manual ledger entry + chasing | **6–10** | Absent |
| Inventory draw-down vs event | manual stock counts | **4–8** | Absent |

**Total `[INFERRED]` ≈ 70–120 hrs/month** — roughly one full-time-equivalent. *This table is the business case; every row is currently unbuilt, which is precisely why L6 scores 2/10.*

---

## 11. RE-PLATFORM FEASIBILITY CALL *(feasibility judgment — distinct from as-is findings)*

### 11.1 Three options, costed
| | **A — Retrofit in place** (React/Vite/CF) | **B — Re-platform to Next.js 15/Vercel, port modules** | **C — Clean rebuild on new stack** |
|---|---|---|---|
| Effort `[INFERRED]` | **S–M** (4–7 wk) | **M–L** (8–14 wk) | **XL** (20–30+ wk) |
| Risk | Low | Medium | High |
| Preserved | Everything | Domain logic, schema, Supabase, realtime mgr | Schema + Supabase only |
| Lost | Nothing | App Router migration cost; SW/realtime rework | 36k LOC of hard-won banquet logic |
| Time-to-PN-running | Fastest | Medium | Slowest |
| Gains the *server* you need? | Only via CF Pages Functions (bolted on) | **Yes, first-class** (route handlers, server actions, Vercel cron) | Yes |
| Gives clean white-label/billing home? | Awkward | **Yes** | Yes |

**Key insight:** the current stack is **not entangled with Vite/Cloudflare** — it's a portable SPA; `_redirects` is the only CF-specific artifact. So the framework move is **not forced by entanglement.** The real driver is that the product needs (a) server-side compute, (b) a home for billing webhooks + onboarding/marketing SSR, and (c) runtime theming — all of which Next.js/Vercel provides natively, and all of which are needed under A or B regardless.

### 11.2 What ports cleanly vs what fights the move
- **Ports cleanly (low friction):** all domain hooks (pure Supabase query/business logic — framework-agnostic), the entire SQL schema + migrations, the GST model, dynamic pricing, the realtime manager, lucide/Tailwind component styling. *~80% of `src/`.*
- **Fights the move (entangled):** `react-router` → App Router routing (47 routes, mechanical but real); `AuthContext`/`PropertyContext` boot logic → Next middleware + server session; the service worker + PWA install (Next has its own conventions); the synchronous Sentry init; the `ink-*` inversion debt (59 files) is a good moment to retire. *Entanglement is moderate, mostly routing + auth-boot, not deep.*
- **Must change regardless of A/B/C:** the multi-step client writes → RPCs; the multi-tenant security retrofit; the global SERIALs; the compiled theming.

### 11.3 Data-migration assessment
Existing Supabase data → multi-tenant schema **with no loss**, *if done before tenant #2*: backfill `property_id` NOT NULL (trivial at one tenant), rewrite RLS reads, property-scope privilege functions. **`org_id` backfill strategy:** introduce `organizations`, link PN's single `properties` row to one org, set every staff membership to that org — a one-row-fan-out, safe. **One-way doors:** global SERIAL human-readable numbers (already-issued booking/invoice numbers) — convert to per-property counters **before** onboarding anyone else.

### 11.4 Reuse leverage from RHS CRM NXT `[INFERRED — not in this repo's scope]`
The referenced sibling project is not present in this working directory, so this is inference from the brief, not verified. *If* RHS CRM NXT provides, as described, a hardened auth + RLS pattern library, a service-role+audit posture, a design-token system, an app shell, a `/today` command surface, and an established CC working posture, then **Wave B's skeleton (org layer, theming engine, app shell, /today, audit) could be lifted rather than built** — plausibly saving **3–6 weeks** of foundation work and giving the multi-tenant security pattern off the shelf (directly de-risking R6/F-SEC-04). *Confirm by diffing RHS CRM NXT's auth/RLS/audit modules against PN's before committing.*

### 11.5 The honest recommendation
**Choose B — re-platform to Next.js 15 + Supabase + Vercel, porting the domain logic and rebuilding the scaffolding.** Confidence: **Medium-High.**

- **Why not A:** A is cheaper short-term but you'd bolt server compute onto CF Pages Functions and hand-roll theming/billing into a single-tenant SPA — carrying the architectural debt into the multi-tenant era. The retrofit work (security, RPCs, counters) is identical under A, so A saves only the framework move while forgoing its benefits.
- **Why not C:** C throws away the one thing that's genuinely hard and valuable — the India-specific banquet+rooms+ops domain logic. The schema and hooks are assets, not liabilities. A clean rebuild re-litigates 53 already-fixed production bugs.
- **Why B:** Next.js gives a first-class home for the server compute the product is missing (cron, route handlers, server actions), billing webhooks, onboarding/marketing SSR, and runtime CSS-var theming — and a fresh App Router is a clean place to graft the ported hooks as server actions/RPCs. You keep ~80% of the value and rebuild exactly the scaffolding that *should* be rebuilt.

- **Single biggest risk to B:** porting the client-side multi-step "transactions" *verbatim* into Next.js server actions without converting them to **atomic Postgres RPCs** — you'd carry `F-BE-01`'s data-integrity bug across the move and call it done.
- **Cheapest de-risking experiment (do before full commitment):** build **one vertical slice — Enquiry → Event → Settlement — on Next.js 15** with (a) writes as a single transactional Postgres RPC, (b) a real `org_id` multi-tenant boundary, (c) runtime theming for PN as tenant #1, and (d) the room `EXCLUDE` constraint. If that slice proves the RPC-atomicity pattern, the theming pattern, and the porting velocity on real PN data, the remaining modules are repetition, not risk. If it doesn't, you've spent ~1–2 weeks instead of committing the whole rebuild.

---

## 12. APPENDIX — read-only commands & queries run (reproducibility)

**Shell (chair, firsthand):**
- `ls -la` (root); `find . -type d -not -path '*/node_modules/*' -maxdepth 3` (tree)
- `git status --short`; `git log --oneline -20`
- `find src -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.css' \) -exec wc -l {} +` (LOC inventory)
- `ls -la supabase/migrations/`; `wc -l supabase/migrations/*.sql`
- `cat .env.example .gitignore vite.config.js`; `sed 's/=.*/=<redacted>/' .env`
- `ls src/pages src/lib src/contexts src/hooks src/utils`; per-dir component counts
- `git log --all --oneline -- .env .env.save`; `git grep -lI -E "service_role|sk_live|eyJ…" HEAD`
- `grep -oE "(service_role|apikey|authorization|bearer)" pn-master-suite.pages.dev.har | sort | uniq -c`
- `git ls-files --error-unmatch pn-master-suite.pages.dev.har`
- `grep -oE 'Bearer eyJ…' …har | … | base64 -d` (JWT payload classification — confirmed `role:authenticated`, exp past)
- `sed -n '1,40p' supabase/migrations/018_security_functions.sql`
- `npm run build` (verification only, exit 0)

**Read tool (chair, firsthand):** `package.json`, `CLAUDE.md`, `src/App.jsx`, `src/utils/secondaryClient.js`, `src/utils/permissions.js`, `src/utils/constants.js`, build output.

**Six specialist agents (read-only, each logged file:line evidence):**
1. L5 Data/Schema — all 36 migrations + `useRoomBookings/useEvents/useDateHolds`.
2. L7 Security/Privacy/Compliance — security migrations + auth/RLS code + HAR + storage + PII.
3. L2/L3 Frontend/UX — contexts, shell, hook/component sample, bundle, tokens, a11y, SW.
4. L6/L8 Integrations/Infra — whole-repo grep for MCube/payments/OTA/email/cron/edge + Sentry/SW/CI.
5. S1–S11 Business flows — enquiry→booking→event→settlement traces + edge cases.
6. L9/Finance/GTM — single-property coupling grep + multi-tenancy + GST/revenue + TAM/SAM/SOM.

*No write/migration/network-mutating command was run. No application file was modified, created, or deleted. The only file created is this one.*

---

PN GRAND AUDIT v2 COMPLETE — AUDIT-2.0.md written · 10 layers scored · 11 scenarios traced · composite 45/100 · maturity band Capable Tool · build clean · zero files changed.
