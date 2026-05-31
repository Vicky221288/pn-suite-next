# PN Suite NXT — Integrated Operating Model (OP MODEL v2)
### The governing design for a single hospitality operating system: PN Hall + PN Stays + Catering on one shared spine
*v2.0-draft · 31 May 2026 · evolves OP MODEL v1.2 from "banquet-hall-with-rooms" → full three-domain hospitality OS · benchmarked against leading 2026 PMS/channel-manager/catering systems*

> **How to read this.** v1.2 defined a banquet hall with rooms. This v2 absorbs the real, stated vision: **one integrated hospitality OS** where Hall, Stays, and Catering share data, workflows, resources, inventory, staff, finance, CRM, reporting, and admin — optimized for Indian banquet-halls / wedding venues / resorts / SMB hospitality, run by minimal staff with enterprise controls. Everything in v1.2 (the spine, atomicity, multi-tenancy, messaging, automation, GST) remains true and becomes the **shared core**. This document adds the two new domains (full Stays incl. Yanolja exit; full Catering) and the integration layer that makes them one system, not three apps.
>
> **Audit + benchmarking basis.** Current-state audited from the legacy inventory + Vicky's operational brief. International benchmarking grounded in 2026 research on Mews, Cloudbeds, Oracle OPERA/OHIP, Apaleo, SiteMinder/Little Hotelier (PMS + channel management) and Caterease, Total Party Planner, Planning Pod, CaterZen, Tripleseat/Event Temple (catering). Citations live in the companion research log; claims here are paraphrased and PN-specific.
>
> **Status of the foundation.** B0–B5 COMPLETE, live, walked. The shared spine already exists and is proven: atomic writes, multi-tenancy + F-SEC-04, messaging (multi-sender), automation engine, the event-spine (Enquiry→Quote→Booking→Event→Settlement), composite-5% GST invoicing, role-aware /today. v2 builds the three domains ONTO this — integration is not a rebuild.

---

## PART 1 — OPERATIONAL AUDIT + INTERNATIONAL BENCHMARKING

### 1.1 The vision, restated as the design target

PN Suite NXT is **one hospitality operating system** for an Indian banquet-hall-with-rooms-and-catering business, where three operational domains share a single core:

```
                    ┌──────────────────────────────────────────┐
                    │            SHARED CORE (the spine)         │
                    │  Guest · Finance/Ledger · Inventory ·      │
                    │  Staff · CRM · Reporting · Admin ·         │
                    │  Messaging · Automation · GST/Billing ·    │
                    │  Multi-tenant · Atomic writes · Audit      │
                    └───────────────┬───────────┬───────────────┘
                          ┌─────────┘     │     └─────────┐
                    ┌─────▼─────┐   ┌──────▼──────┐  ┌─────▼─────┐
                    │  PN HALL  │   │  PN STAYS   │  │ CATERING  │
                    │ (banquet) │   │  (hotel)    │  │  (F&B)    │
                    └───────────┘   └─────────────┘  └───────────┘
```

The north-star test from v1.2 still governs every decision: **does this let minimal staff run the whole operation, with the software doing the work (system of action, not record)?** v2 widens it to three domains but does not soften it.

### 1.2 Current state — honest audit per domain

| Domain | Current tooling | Maturity | The gap |
|---|---|---|---|
| **PN Stays** | Yanolja PMS (OTA + room inventory) + **manual registers** (walk-ins) + **Yale smart locks** (separate) + manual housekeeping checklists | **Live but fragmented** — PMS, locks, registers, housekeeping are 4 disconnected systems | No single source of truth; Yale not linked to bookings; walk-ins off-system; housekeeping not digitized; **dependent on Yanolja** for the OTA lifeline |
| **PN Hall** | Almost entirely **manual** (Hemanth): enquiry, follow-up, booking, scheduling, advances, billing, vendors, settlement | **Manual** — but the spine (B0–B5) already digitizes the core lifecycle | The manual workflow needs to fully move onto the proven spine; Hemanth leaving makes this urgent |
| **Catering** | None (per the brief) — though legacy has a **Kitchen & Vendor Ops donor** (per-plate, packages, breakfast, vendor commission) | **Greenfield-with-donor** | A full industry-grade catering platform is needed; the new manager (≤2 weeks) is the trigger and the domain owner |

**The integration gap (the real finding):** even where tools exist, they don't share data. A wedding that books the hall, blocks 15 rooms for the guest's family, and orders catering for 500 is, today, **three separate manual processes in three systems** with no shared guest, no shared inventory draw, no consolidated bill, no unified P&L. *That* is what PN Suite NXT exists to collapse — and it's precisely what the event-spine + shared core was designed to enable.

### 1.3 International benchmarking — what world-class systems do (and what PN should adopt)

**Hotel / Stays domain (benchmarked: Mews, Cloudbeds, Oracle OPERA/OHIP, Apaleo, SiteMinder):**
- The industry has converged on the **"hospitality operating system"** framing — Mews explicitly positions as one, raised $300M in Jan 2026 at a $2.5B valuation on that thesis. PN's vision is directionally aligned with where the category leaders are going. The differentiator PN has: **the event/banquet spine**, which room-only PMSes lack.
- **Channel manager = real-time two-way sync.** The non-negotiable pattern: a booking on any channel instantly decrements availability on all others; rate/availability changes push to all OTAs in seconds. This eliminates overbooking and rate disparity. Webhook-based sync is the gold standard; XML-polling (every 15 min) is the failure mode that causes overbookings.
- **API-first architecture** is the modern standard (Mews 800+, OPERA/OHIP 1,200+, Apaleo API-first from day one). PN's spine is already API-first (Next.js + Supabase + RPCs) — aligned.
- **Five data types** move across hotel integrations: reservations, rates, availability, folios, guest profiles. PN's shared core must model all five.
- **Field-mapping loss is a real risk:** dietary requirements, accessibility flags, late-arrival notes get stripped between OTA and PMS. PN should capture these explicitly (and they matter doubly because the same guest may also be a catering customer).
- **Mobile locks** (Yale et al.) are a standard integration in the 2026 stack — guest check-in triggers key activation. PN already has Yale hardware; the gap is linking it to the booking lifecycle.

**Catering domain (benchmarked: Caterease, Total Party Planner, Planning Pod, CaterZen, Tripleseat/Event Temple):**
The industry-standard catering module structure, consistent across all leading tools:
- **Recipe management with auto-scaling by guest count** — the defining feature: ingredient quantities adjust automatically to headcount. (TPP, Planning Pod, Caterease all center on this.)
- **Ingredient/costing engine** — track ingredient prices → compute per-plate cost → margin. The profitability core.
- **BEO (Banquet Event Order) as the central document** — the function sheet that drives kitchen + front-of-house; often **multiple BEOs per event** (one for kitchen, one for FOH); e-signed by the client. This is the catering equivalent of the spine's Event entity, enriched.
- **Kitchen production planning + reports** — what to prep, how much, when.
- **Supplier/purchase ordering** — auto-generate purchase needs from booked events' recipes; track supplier costs as COGS.
- **Packing lists / equipment allocation** — auto-generated from menu items.
- **Menu builder + packages + proposals** — customizable menus, package templates, client-facing proposals.
- **Staff scheduling** for events.
- **Profitability analysis** per event.

**The key benchmarking insight for PN:** leading catering tools are *standalone* and then bolt on weak CRM/venue features. PN inverts this — catering hangs off an event-spine that *already* has the venue, the booking, the guest, the GST engine, and the finance ledger. So PN's catering can be **deeply integrated where the standalone tools are bolted-on**: the same guest, the same event, the same inventory, one consolidated bill across hall+rooms+catering. That's the structural advantage, and the design must exploit it.

### 1.4 The Yanolja-exit reality (highest-risk piece — researched)

You're migrating a **live** hotel operation off Yanolja. The research on PMS/channel-manager migration yields hard rules PN must follow — this is the riskiest single operation in the whole program because **a dropped reservation is a real guest at a real door:**

1. **Clean before you export** (1–2 weeks): dedupe guest profiles (esp. top guests), clean room types/rate plans, audit OTA mappings. Duplicates imported are harder to clean post-go-live.
2. **Channel connections are rebuilt, not migrated** — OTA mappings, rate plans, restrictions get reconfigured from scratch in the new system and tested before go-live. Missing this causes first-day double-bookings.
3. **Switch one OTA at a time**, lowest-volume first, in low-demand windows. "Most booking disruptions come from switching too much, too fast."
4. **Run both systems in parallel before cutover** — validate the new system against Yanolja's reports (occupancy, revenue, balances) in a test environment first.
5. **Test real bookings + cancellations** end-to-end before trusting the new channel sync.
6. **Export for archive, recreate config** — historical reports export to a static archive; staff accounts, templates, integrations are *recreated* (faster than migrating).
7. **What to extract from Yanolja:** active/future reservations, guest profiles, room types, rate plans, OTA channel mappings, folios. Confirm Yanolja's export capability (CSV/API) early — this is a gating dependency.

**This means the Yanolja exit is its own carefully-sequenced sub-project, NOT a "build the rooms module and flip a switch."** It's the last major piece, done slowly, after the in-suite channel manager is built and proven in parallel. (Sequenced in Part 4.)

---

*[Part 1 of 5 — audit + benchmarking. Parts 2–5 follow: the integrated architecture (shared core + how each domain draws from it), the three domain designs, the migration strategy, and the cross-cutting layers.]*

---

## PART 2 — THE INTEGRATED ARCHITECTURE (the shared core)

The whole point of v2: Hall, Stays, and Catering are **three faces of one system**, not three apps. They integrate by sharing a core. Here is that core and how each domain draws from it.

### 2.1 The shared-core entities (the single source of truth)

Every domain reads and writes these. Defined once, used everywhere.

| Core entity | What it holds | Hall uses it for | Stays uses it for | Catering uses it for |
|---|---|---|---|---|
| **Guest** | Durable customer identity; dedup across phone/WhatsApp/walk-in/OTA; contact, preferences, dietary flags, LTV | Event client | Hotel guest | Catering client (often the SAME person as the event client) |
| **Event** (the spine) | The master booking object an everything attaches to | The banquet itself | Room block linked to an event | The catering order for that event |
| **RoomStay** | A room reservation (event-linked or standalone) | Guest-family room block | Core object | F&B/breakfast attaches here |
| **Inventory** | Stock: catering ingredients, room amenities, hall consumables | Hall consumables | Amenities/linen | Ingredients (the big draw) |
| **Finance/Ledger** | Every money movement: advances, balances, deposits, refunds, COGS, commissions | Hall rent + deposit | Room revenue | Catering revenue + food COGS |
| **Staff** | People + roles/capabilities + scheduling + attendance | Event-day roster | Housekeeping/front desk | Kitchen + service staff |
| **Vendor** | Suppliers + commission tracking | Decor/DJ/photo | Maintenance contractors | Food suppliers (purchase orders) |
| **Invoice** | GST tax invoice; multi-line, multi-supply-type | Hall+package | Room (5% no-ITC) | Catering (composite-led) |
| **CRM** | Lead/enquiry pipeline, follow-ups, lifetime loop | Event enquiries | Direct/repeat guest | Catering enquiries |
| **Compliance** | Licences/renewals (FSSAI, Fire, Form C, PPL/IPRS) | Fire/music | Form C (foreign guests) | FSSAI (kitchen) |

**The integration payoff, concretely:** a wedding becomes ONE Event with a Guest, a hall booking, a 15-room block, a 500-plate catering order, a vendor list, and **one consolidated GST invoice** that correctly applies 18%/5%/composite per line — drawing ingredients from one Inventory, staff from one roster, money into one Ledger, and showing on one P&L. No standalone tool does this; PN's spine makes it native.

### 2.2 How this maps onto the proven foundation

The shared core is **not new architecture** — it's the B0–B5 spine, extended:
- **Guest, Inventory, Staff, Vendor, Compliance** become new shared-core entities, each on the wrapper+RPC atomic pattern (B1), org-scoped (B2).
- **Event, RoomStay, Invoice, Finance, CRM** already exist or are partially built from the foundation wave.
- **Messaging (B3), Automation (B4), GST engine (B5)** are already shared services every domain calls.
- Every new entity follows the standing invariants: atomic+audited+tenant-scoped writes, config-driven GST, idempotent automation.

### 2.3 The integration principles (new invariants for v2)

7. **One Guest, many roles** — a person is ONE Guest whether they book a wedding, a room, or catering. Dedup is mandatory at every capture point (OTA, WhatsApp, walk-in, phone).
8. **One Event, many services** — hall + rooms + catering + vendors attach to a single Event; the consolidated bill and P&L derive from it.
9. **One Inventory, many consumers** — catering ingredients, room amenities, hall consumables draw from one stock ledger; no per-domain silos.
10. **One Ledger, many streams** — every money movement (any domain) writes to one finance ledger with a supply-type tag; P&L is a query, not a reconciliation.
11. **Domains are views + rules over the shared core, not separate databases** — a "module" is a bounded set of screens, workflows, and domain rules over shared entities, never a data silo.

---

## PART 3 — THE THREE DOMAIN DESIGNS

### 3.1 PN HALL (banquet) — mostly built, complete the lifecycle

The spine already delivers Enquiry→Quote→Booking→Event→Settlement, atomic date-blocking, deposit-as-liability, composite-5% GST. What the full Hall domain still needs (from the brief):
- **Lead management + follow-up automation** — A1/A2/A3 rules (built in B4; wire to real WhatsApp in the AiSensy session).
- **Contract management** — generate/e-sign the hall contract (benchmark: e-signature is standard in catering/event tools).
- **Payment milestones** — advance at confirm, full rent at T-45 (locked v1.2 #9); milestone reminders (A5).
- **Resource scheduling** — hall allocation across slots (morning/evening/full-day + 3h turnaround, locked #5); staff roster for events.
- **Event execution workflows** — BEO/function sheet (shared with catering), event-day checklists (the photo-proof moat), vendor coordination.
- **Post-event closure + revenue analytics** — settlement → review request (A7) → P&L.

**Status:** ~60% delivered by the foundation. Remaining is completion, not greenfield.

### 3.2 CATERING — the new industry-grade module (port-and-extend + benchmark)

Built on the legacy Kitchen donor (per-plate, packages, breakfast, vendor commission) + the benchmarked industry structure. Designed to hang off the Event spine — its structural advantage over standalone tools.

**Catering domain entities & workflows:**
- **Menu builder** — items, categories, customizable menus; per-item recipe + portion + cost.
- **Recipe management with auto-scaling** — the defining feature: ingredient quantities auto-adjust to guest count. (Industry standard across TPP/Planning Pod/Caterease.)
- **Ingredient + costing engine** — ingredient prices → per-plate cost → margin; the profitability core. (PN-specific: cost **gross of input GST** — non-specified premises, 5% no-ITC, so input GST is a real cost.)
- **Package management** — wedding/event package templates with menus + pricing.
- **Cost estimation + profitability analysis** — per-event projected vs. actual margin.
- **BEO (Banquet Event Order)** — the central catering document; menu + guest count + guest-guarantee + timeline + kitchen/FOH splits; e-signed; shared with the Hall event. (Benchmark: multiple BEOs per event — kitchen vs FOH.)
- **Kitchen production planning** — prep lists, production schedule, KOT (kitchen order tickets).
- **Purchase planning + vendor management** — auto-generate purchase orders from booked events' recipes; track supplier costs as COGS; vendor commission tracking.
- **Inventory + stock + consumption tracking** — draws from shared Inventory; track planned vs. actual consumption (waste/variance).
- **Staff + equipment allocation** — kitchen + service staff scheduling; equipment packing lists auto-generated from menu.
- **Event execution monitoring** — live event-day tracking.
- **Billing** — catering line(s) on the consolidated invoice (composite-5% catering-led per locked GST).

**The two service models under one kitchen** (your locked scope — banquet + Stays room-dining/F&B):
- **Banquet catering** — scheduled, mass, event-driven (500-plate wedding). Recipe-scaled, BEO-driven.
- **Stays room-dining / F&B** — on-demand, à la carte, room-service. Different rhythm; shares the kitchen, recipes, and inventory but has its own order flow (room → KOT → charge to RoomStay folio).
Both draw from one kitchen, one recipe book, one inventory — the integration advantage made real.

### 3.3 PN STAYS — full hotel ops + the Yanolja replacement (the heaviest)

The full PMS the brief calls for, replacing Yanolja + manual registers + disconnected Yale, benchmarked against Mews/Cloudbeds/OPERA:
- **Reservation management** — the RoomStay lifecycle (RESERVED→CHECKED_IN→CHECKED_OUT→SETTLED; walk-in, no-show, cancel branches); **apply the B1 GiST-EXCLUDE guard** to `room_bookings(room_id, daterange)` (fixes the live legacy F-DATA-01 unguarded double-booking).
- **OTA integration + channel management** — the real-time two-way sync engine (the benchmark non-negotiable): a booking on any channel instantly decrements all others; rate/availability push to all OTAs. Webhook-based. Connect Booking.com, MMT, Goibibo, Agoda, Airbnb. **This is the Yanolja replacement core** and the single largest build.
- **Booking engine** — commission-free direct bookings from PN's own site (benchmark: the "holy grail" — every leading PMS pushes direct booking to cut OTA commission).
- **Walk-in management** — bring the manual register on-system.
- **Check-in / check-out workflows** — incl. **Form C** capture gate for foreign guests (legal duty, locked).
- **Yale smart-lock integration** — check-in → key activation; the gap is linking Yale's API to the booking lifecycle (benchmark: mobile locks are standard 2026 stack).
- **Housekeeping operations** — room status (dirty/clean/inspected/ready), housekeeping task assignment, turn workflows (digitize the manual checklists).
- **Maintenance requests** — log/assign/track room maintenance.
- **Room status management** — the live availability board.
- **Guest communication** — pre-arrival, in-stay, post-stay via the shared messaging (A8).
- **Billing + settlement** — room folio; **5% no-ITC** room GST (≤₹7,500/night, on invoiced amount); F&B charged to folio.
- **Occupancy + revenue reporting** — ADR, RevPAR, occupancy %, channel mix.
- **Staff task assignment + monitoring** — housekeeping/front-desk tasks on the shared Staff core.

**GST note (carry from locked resolution):** rooms ≤₹7,500/night = 5% no-ITC on the invoiced amount; the system tags every room line with supply-type and lets the engine pick the rate; the specified-premises flag is a property-level config (PN = non-specified).


---

## PART 4 — MIGRATION & BUILD STRATEGY (sequencing the whole program)

The governing principle: **build on the proven spine, deadline-first where there's a human clock, highest-risk-external last.** Three clocks drive the order: the catering manager (~2 weeks), the Hall urgency (Hemanth leaving), and the Yanolja exit (slow, must not drop a live reservation).

### 4.1 The sequence

```
NOW ──────────────────────────────────────────────────────────────────►

  W0  SHARED CORE: Guest entity + Inventory + Staff + Finance-ledger
        (the dependencies catering needs; small, on the proven spine)
        ── start in parallel: Yale API access + Yanolja export scoping ──

  W1-2 CATERING  (THE 2-WEEK CLOCK — the new manager's domain)
        port legacy Kitchen donor + benchmark structure:
        menu builder, recipe auto-scale, ingredient costing, packages,
        BEO, kitchen production/KOT, purchase planning, consumption,
        staff/equipment, banquet + Stays-F&B service models, billing line
        → manager arrives to a working catering tool

  W2-4 HALL COMPLETION
        contracts/e-sign, payment milestones, resource scheduling,
        execution checklists (photo-proof moat), vendor coordination,
        revenue analytics → Hall fully off manual before/around Hemanth exit

  W4-6 STAYS CORE (in-suite, NOT yet touching Yanolja)
        RoomStay lifecycle + B1 double-booking guard, walk-ins,
        check-in/out + Form C, housekeeping, room status, maintenance,
        folio billing (5% no-ITC), Yale lock integration, guest comms
        → builds the destination system while Yanolja still runs live

  W6-8 STAYS CHANNEL MANAGER (the Yanolja-replacement core)
        real-time two-way OTA sync engine + booking engine;
        rebuild OTA channel mappings/rate plans in-suite;
        run IN PARALLEL with Yanolja (both live), validate against
        Yanolja reports in a test environment

  W8+  YANOLJA CUTOVER (the careful exit — its own sub-project)
        per migration research: clean+dedupe → export reservations/
        guests/rates → rebuild channels → switch ONE OTA at a time,
        low-volume first, low-demand windows → test real bookings+
        cancellations → monitor → only then decommission Yanolja

  LATER  CRM enrichment (LTV/anniversary/reviews) · Reports/analytics
         depth · Compliance & renewals tracker (its own build)
```

### 4.2 Why this order
- **Catering first after a minimal shared core** — honors the human deadline; the manager arrives to a real tool. The shared core (Guest/Inventory/Staff/Finance) is small and is exactly what catering needs underneath it, so it's not wasted work — it's the foundation all three domains share.
- **Hall completion next** — Hemanth leaving makes it urgent; it's mostly done (spine), so it's fast.
- **Stays core before Stays channel manager** — build the in-suite destination (rooms, check-in, housekeeping, Yale, folio) while Yanolja still safely runs the OTA lifeline. Don't touch the live booking flow until the new home is ready.
- **Channel manager in parallel with Yanolja** — the research is unambiguous: run both, validate, switch gradually. Never a hard flip.
- **Yanolja cutover last and slow** — highest risk (live guests); done only when the in-suite channel manager is proven in parallel.
- **Compliance/CRM-frills later** — real but not blocking; their own builds.

### 4.3 Yanolja-exit sub-project (expanded — the riskiest operation)
A dropped reservation = a real guest at the door. The exit follows the researched playbook exactly:
1. **Scope Yanolja's export** (do now, parallel): confirm CSV/API access to reservations, guests, room types, rate plans, OTA mappings, folios.
2. **Clean + dedupe in Yanolja first** (1–2 wks before export): merge duplicate guests (top guests especially), clean room types/rate plans, audit OTA mappings.
3. **Build + prove the in-suite channel manager** (W6-8) before any switch.
4. **Rebuild channel config from scratch** in-suite (mappings/rate plans/restrictions) — not migrated.
5. **Parallel run**: both systems live; validate new against Yanolja reports (occupancy/revenue/balances).
6. **Switch one OTA at a time**, lowest-volume first, low-demand windows; test real booking + cancellation per channel.
7. **Monitor**, then decommission Yanolja only after all channels proven.

---

## PART 5 — CROSS-CUTTING LAYERS (permissions, automations, dashboards, integrations)

### 5.1 Permissions (roles = capabilities, composable; the minimal-staff model)

Roles span all three domains on the shared Staff core. One person holds many (the 3-person collapse).

| Role | Holds (PN today) | Cross-domain capabilities |
|---|---|---|
| **Owner/Admin** | Vicky | Everything across Hall/Stays/Catering: full P&L, config, pricing, refunds, deletes, multi-property |
| **Property Manager** | Braga | Ops oversight all domains; approvals within limit; no global config |
| **Hall/Events Manager** | (Hemanth → successor) | Hall lifecycle; shares BEO with catering |
| **Stays Manager** | Gunal | Rooms, check-in/out, Form C, housekeeping, channel manager ops |
| **Catering/Kitchen Lead** | new hire (≤2 wks) | Catering domain owner: menus, recipes, kitchen, purchase, F&B; kitchen P&L |
| **Operative/Event Staff** | temp/event | Assigned tasks/checklists, GPS check-in, photo proof |
| **System/Automation** | the engine | Acts per the rules below |

Guardrails (locked v1.2, extended cross-domain): booking/date-block = Owner+PM; discount >10% = Owner/PM; refunds/deposit-forfeit = Owner/PM; only Owner DELETE; managers see operational numbers, **not margin** (Catering Lead sees kitchen P&L for their domain only); F-SEC-04 — every role property-scoped.

### 5.2 Automations (the engine, extended to three domains)

Building on B4's registry (server-side, idempotent, audited, quiet-hours-aware 21:00–07:00). v1.2 rules A1–A10 stand; v2 adds domain rules:

| # | Trigger | Action | Domain |
|---|---|---|---|
| A1–A3 | Enquiry lifecycle (ack/SLA/quote-nudge) | WhatsApp + escalate | All (CRM) |
| A4–A5 | Booking confirm / balance due | Receipt + milestone reminders | Hall |
| A6 | Event T-2 | BEO + roster + vendor confirm | Hall+Catering |
| A7 | Event concluded | Review request + anniversary loop | All (CRM) |
| A8 | Room reserved | Pre-arrival + Form C prompt | Stays |
| A9 | Licence T-30 | Renewal alert | Compliance |
| A10 | Daily 07:00 | Role "Today" + exceptions | All |
| **A11** | **Booked event recipes** | **Auto-generate purchase orders from ingredient needs** | **Catering** |
| **A12** | **Stock below reorder point** | **Alert + draft PO** | **Catering/Inventory** |
| **A13** | **OTA booking received** | **Decrement availability all channels (real-time sync)** | **Stays (channel mgr)** |
| **A14** | **Guest checked in** | **Activate Yale key + send access details** | **Stays** |
| **A15** | **Room status → checkout** | **Create housekeeping task** | **Stays** |

### 5.3 Dashboards (role + domain aware, "system of action" surfaces)

- **Owner/PM — the integrated command center:** today's events + room occupancy + catering production load + money to collect (all domains) + decisions waiting + exceptions (SLA breaches, low stock, lapsing licences, channel-sync errors) + cross-domain P&L.
- **Stays Manager:** arrivals/departures board, room status grid, channel-sync health, housekeeping queue.
- **Catering Lead:** today's production/KOT, purchase needs, kitchen P&L, upcoming BEOs.
- **Hall Manager:** enquiry pipeline, follow-ups due, upcoming events, BEOs needing input.
- **Operative:** assigned tasks/checklists only.
Each opens on *what to do*, never *what to browse* (the /today thesis, extended per domain).

### 5.4 Integrations (external surfaces)

| Integration | Domain | Pattern | Status/lead-time |
|---|---|---|---|
| **WhatsApp (AiSensy)** | All | MessagingProvider abstraction + adapter (B3) | Built; needs live AiSensy account + Meta templates |
| **OTA channel manager** (Booking.com/MMT/Agoda/Airbnb) | Stays | Real-time two-way webhook sync | Build W6-8; the Yanolja-replacement core |
| **Yale smart locks** | Stays | API: check-in → key activation | Scope API access NOW (lead-time) |
| **Yanolja (exit)** | Stays | Export → migrate off | Scope export NOW; cutover W8+ |
| **Payment gateway** | All | Online payments/links (benchmark: standard) | Net-new; scope (legacy gap) |
| **Booking engine** (direct) | Stays | Commission-free direct bookings | Build with channel manager |
| **Accounting export** | Finance | GST returns / bookkeeping | Later |
| **Telephony (MCube)** | CRM | Call → lead capture | Per RHS pattern, later |

---

## PART 6 — WHAT'S LOCKED, WHAT'S OPEN

**Locked (carry from v1.2, still true):** the system-of-action thesis; event-spine; atomic+audited+tenant-scoped writes; messaging abstraction; automation engine; GST model (PN non-specified, rooms/F&B 5% no-ITC, hall 18% w/ITC, package composite-5% catering-led, config-driven); deposit = 50% hall rent escrowed; T-45 rent; slots morning/evening/full-day + 3h; discount >10% → Owner/PM; quiet hours 21:00–07:00; SLA 2h; reminders T-50/47/45.

**New in v2 (this document):** the three-domain integrated architecture; shared-core entities; integration invariants 7–11; the full Catering, Stays, and Hall domain designs; the build sequence (catering-first after minimal shared core); the Yanolja-exit sub-project; cross-domain permissions/automations/dashboards/integrations.

**Open — needs Vicky / external:**
1. **Yale API access** — scope developer access + credentials (lead-time; start now).
2. **Yanolja export capability** — confirm CSV/API export of reservations/guests/rates/mappings (gating dependency; start now).
3. **AiSensy live account + Meta-approved templates** — for real WhatsApp (per build plan §10).
4. **Payment gateway choice** — which provider (legacy gap; needed for online payments).
5. **OTA credentials** — which OTAs PN uses today on Yanolja + access to reconnect them in-suite.
6. **Catering scope confirm** — banquet + Stays-F&B locked; confirm no off-site/outdoor catering in v1 (affects 18% outdoor-catering line).
7. **Compliance tracker** — confirmed deferred to its own later build.

---

*Status: OP MODEL v2.0-draft — the integrated three-domain governing design, benchmarked and grounded. On Vicky's review, this becomes v2.0-locked and supersedes v1.2 as the single source of truth. Next build action after lock: the minimal shared core (W0), then Catering (W1-2, the deadline). Nothing committed to repo yet — hand to CC to commit into docs/ + update CLAUDE.md once approved.*
