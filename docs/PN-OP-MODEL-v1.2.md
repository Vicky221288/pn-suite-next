# PN OP MODEL v1.2 — Operating Model (decisions locked)
### The governing document the PN Master Suite rebuild marches against
*v1.2 · 31 May 2026 · single source of truth · audit-informed (AUDIT-2.0.md, composite 45/100) · all §12 decisions LOCKED · messaging architecture set

> **How to read this.** This defines *how a banquet-hall-with-rooms business should run and how the software runs/automates it* — not the code. It is the contract every build wave answers to (mirrors RHS CRM NXT's OP MODEL v1.9). Items only you can confirm are tagged **⚠️[CONFIRM]** inline and collected in §12. Everything else is my draft for you to correct, not author from scratch.
>
> **Audit mandates baked in:** F-AUTO-01 (no automation exists → the engine in §6 is *foundational*, not a feature). F-SEC-04 (unscoped super-admin → tenant-scoped roles in §10). F-FIN-03 (rates right, no invoice → invoice generation in §7). Biggest re-platform risk (non-atomic client writes → the atomic-RPC invariant in §11).

---

## 1. Operating thesis (the north star)

1. **System of action, not system of record.** The product does the work — chases, sends, reminds, collects, flags — and surfaces only the few things needing a human. Tracking is the floor; *doing* is the point. (The audit proved this layer is currently absent; it is now job #1.)
2. **The event is the spine.** Rooms, catering, kitchen, vendors, staff, and money all hang off an **Event**. This is what makes the product un-clonable by room-only hotel PMSes.
3. **3 people run a property; automation is the headcount we don't hire.** Every screen, default, and rule answers one question: *does this let one person do what used to take three?*
4. **Multi-tenant and automation-safe from day one.** No hardcoded property; every write atomic and audited; every automated action idempotent (the RHS WhatsApp-spam lesson is law here).

---

## 2. Business model — the revenue streams (grounded in PN)

| Stream | What it is | Spine link |
|---|---|---|
| **Hall / events** | Weddings, receptions, functions; slot-based | Event (primary) |
| **Rooms (PN Stays, 10)** | Overnight stays; standalone or as an event's guest block | Room Stay (links to Event optionally) |
| **Catering / kitchen** | In-house catering for events; breakfast for room guests | Event + Room Stay |
| **Vendor commissions** | Caterers/decorators/DJs/photographers using the venue pay PN a cut | Event (vendor lines) |
| **Add-ons** | Decor, AV, extra services | Event/Stay line items |

Peak month to date ₹7.14L. Kitchen Phase 1 imminent — note its economics are **gross of input GST** (PN is non-specified premises, 5% no-ITC; see §7 and the GST resolution doc).

---

## 3. Actors, roles & decision rights

**Roles are capabilities, assigned to people in any combination.** In a 3-person property one person holds several; the model never assumes a large team.

| Role | Holds (PN today) | Core capabilities |
|---|---|---|
| **Owner / Admin** | Vicky | Everything: full P&L, config, pricing, refunds, deletes, multi-property |
| **Property Manager** | Braga | Ops oversight, approvals (discounts/refunds within limit), all operational data, no global config |
| **Hall / Events Manager** | Hemanth (→ Catering Lead candidate) | Enquiry→Event for hall; quotes; BEO; event-day execution |
| **Stays Manager** | Gunal | Room reservations, check-in/out, Form C, housekeeping |
| **Catering / Kitchen Lead** | future hire | Kitchen ops, in-house catering packages, F&B vendor commissions, kitchen P&L |
| **Operative / Event Staff** | temp/event | Assigned checklists, GPS check-in, photo proof only |
| **System / Automation** | the engine | Acts on behalf of the property per §6 rules |

**Decision-rights guardrails (draft):**
- **Confirm a booking / block a date:** Hall or Stays Manager + Owner/PM. ⚠️[CONFIRM]
- **Approve a discount beyond ₹___ or ___%:** Owner/PM only. ⚠️[CONFIRM threshold]
- **Refunds / deposit forfeiture:** Owner/PM only.
- **Delete any record:** Owner only (mirror RHS — only owner-level DELETE).
- **See full P&L / margins:** Owner/PM only; managers see their stream's operational numbers, not blended margin. ⚠️[CONFIRM]

---

## 4. Canonical entities (the spine in business terms)

`Guest` · `Enquiry` · `Quote` · `Booking` · `Event` · `RoomStay` · `Vendor` · `LineItem` · `Invoice` · `Payment` · `Deposit` · `Checklist` · `StaffShift` · `Licence` · and the multi-tenant root `Property (org)`.

Spine: **Enquiry → Quote → Booking → Event → Settlement**, with `RoomStay` attachable to an Event or standalone, and `Guest` as the durable identity threading lifetime value (wedding → naming → birthday → referral).

---

## 5. Lifecycle state machines (the operational core)

### 5.1 Enquiry
`NEW → QUALIFYING → QUOTED → NEGOTIATING → WON | LOST | DORMANT`
- **WON** spawns a Booking. **Guard:** every state has a follow-up SLA; breach escalates (see §6). No enquiry sits silent — the F-AUTO failure mode dies here.
- Omni-source capture: phone (MCube), WhatsApp, walk-in, web, Meta/Google ad — all dedupe to one Guest.

### 5.2 Booking (hall ± room block)
`TENTATIVE_HOLD → CONFIRMED → COMPLETED → SETTLED → CLOSED`  ·  branches: `CANCELLED`, `POSTPONED`
- **TENTATIVE_HOLD:** (hall, date, slot) reserved, **auto-expires after 24h** if the deposit isn't paid. Managers may place holds; only Owner/PM hard-blocks.
- **CONFIRMED:** deposit (50% of hall rent) received → date hard-blocked, BEO unlocks.
- **Double-booking guard (critical, atomic):** a CONFIRMED or live HOLD on (hall, date, slot) blocks any other. Enforced server-side in one transaction — never two client writes (audit's biggest risk).
- **Slot model:** Morning / Evening / Full-day + **3-hour turnaround buffer** between morning and evening.

### 5.3 Event (post-confirmation operations)
`PLANNING (BEO build: menu, guest count, vendors, room block) → READY (BEO locked at T-__) → IN_PROGRESS (event day) → CONCLUDED`
- BEO = the function sheet: menu/per-plate + guest guarantee, vendor assignments + commissions, room block, timeline, staff roster.

### 5.4 Room Stay
`RESERVED → CHECKED_IN → CHECKED_OUT → SETTLED` · branches: `WALK_IN`, `NO_SHOW`, `CANCELLED`
- Foreign guest → **Form C** capture gate at check-in (legal duty).

### 5.5 Settlement
`PENDING → INVOICED → COLLECTED → DEPOSIT_RESOLVED → CLOSED`
- **INVOICED** generates the **GST tax invoice** (fixes F-FIN-03) with correct supply-type rate + SAC.
- **DEPOSIT_RESOLVED:** the 50%-of-hall-rent deposit is returned / damage-adjusted / forfeited **case-by-case, routed to Owner/PM**; held as an escrowed liability until resolved, never as revenue.

---

## 6. The automation engine (the F-AUTO-01 answer — foundational)

Rules are **server-side, event-driven, idempotent, audited.** Format: *trigger → condition → action*. Each rule is per-tenant toggleable, respects quiet hours, and **never double-fires** (idempotency keys — the RHS realtime-INSERT spam lesson is binding).

| # | Trigger | Action | Notes |
|---|---|---|---|
| A1 | Enquiry created | WhatsApp ack + assign to role + start follow-up SLA | Omni-source |
| A2 | Follow-up SLA breached (**2h** on new enquiry) | Escalate to manager + flag in Today | **This is the enforcement that was missing** |
| A3 | Quote sent, no response | Auto nudge at T+1, T+3 | Stops at WON/LOST |
| A4 | Booking CONFIRMED (deposit paid) | Confirmation + deposit receipt + calendar block + schedule rent reminders | |
| A5 | Hall rent reminders at **T-50, T-47, T-45**; overdue → escalate | WhatsApp reminder + collection nudge | The collections engine |
| A6 | Event T-2 days | Generate BEO checklist + roster + notify staff + confirm vendors | |
| A7 | Event CONCLUDED | Google-review request + schedule anniversary nudge (≈T+11mo) + close-out checklist | Lifetime value loop |
| A8 | Room RESERVED | Pre-arrival WhatsApp; foreign guest → Form C prompt | |
| A9 | Licence/renewal T-30 days | Alert owner | Compliance tracker (§9) |
| A10 | Daily 07:00 | Build each role's "Today" + exceptions roll-up | §8 |

All time-based rules respect **quiet hours 21:00–07:00** (no automated WhatsApp). The *rules* are the spec; timers are now locked per §12.

**Messaging architecture (locked):** PN has **no MCube Engage** and starts from zero. WhatsApp connects via the **Business API through a BSP** (the free Business App cannot send programmatically and is ruled out). Build a **`MessagingProvider` abstraction** (`sendTemplate` / `sendSession` / `receiveWebhook` / `getStatus`); the automation engine talks only to that interface, never the vendor API — so the BSP is swappable via one adapter (the anti-lock-in lesson from MCude/RHS hardcoding). **Default BSP: AiSensy** (no Meta-rate markup, INR/IST billing, click-to-WhatsApp-ads strength matching the Meta/Google ad-lead-capture plan); Interakt is the low-per-message alternative behind the same adapter. **Two non-negotiables:** (1) inbound webhook is authenticated, idempotent, replay-safe (fixes the old ~10–15% MCube webhook loss; this is where unknown-number auto-lead-capture lives); (2) outbound is idempotent + quiet-hours-aware (no repeat of the RHS realtime-INSERT spam). **This messaging path is FOUNDATIONAL — nothing in §6 works without it.**

---

## 7. Money model

- **Pricing:** hall packages, room tariffs, catering per-plate, vendor-commission %, add-ons. **High-demand dates** (muhurtham/festival/weekend) are **calendar-flagged; pricing stays manual in v1** (premium automation deferred).
- **Collection rhythm:** **deposit = 50% of hall rent at booking** (refundable, escrowed) → **full hall rent due T-45 days**. Catering/rooms/add-ons billed separately.
- **Discount control:** above **10% off package** → Owner/PM approval.
- **GST/billing (from the GST resolution doc):** every line item carries a **supply-type tag**; a property-level **"specified premises" flag** drives 5%/18% + ITC behaviour; quote-time choice of **bundled (composite) vs itemised**; correct **SAC** (9963/9964); **tax invoice generated at INVOICED**; cancellation GST at the original booking's rate. PN today = non-specified → rooms & F&B 5% no-ITC; standalone hall 18% w/ITC; bundled package = CA-gated (§12).
- **Commissions:** vendor commission tracked as a receivable per Event.
- **Refund / cancellation / postponement:** **case-by-case, routed to Owner/PM** for decision; outcome logged. No auto-forfeit.
- **Invariant:** every money event writes a ledger entry + audit log.

---

## 8. Daily operating rhythm — the "Today" surface

Each role opens on *what to do*, never *what to browse*.
- **Owner / PM:** today's events, room status, money to collect (ageing), decisions waiting (approvals), exceptions (SLA breaches, conflicts, lapsing licences).
- **Hall / Stays Manager:** their queue — follow-ups due, today's check-ins/events, BEOs needing input.
- **Operative:** today's assigned checklists only.
This is the home screen, mirroring RHS CRM NXT's `/today`.

---

## 9. Accountability layer (the moat — keep & extend)

- **Checklists** with **photo proof** (the 84-item heritage) — port the domain logic.
- **GPS check-in** for event-day staff.
- **Compliance / renewals tracker** (new, from the GST doc): FSSAI, fire NOC, Form C events, PPL/IPRS, insurance, GST filings — auto-alert before lapse. No competitor does this.

---

## 10. Multi-tenancy & security model

- **`org_id` (Property) on every table; tenant-scoped RLS** on every read/write.
- **Fix F-SEC-04:** super-admin / any elevated role is **scoped to a property**; no cross-tenant visibility. Validated by a two-tenant isolation test before any second tenant onboards.
- **Roles = capabilities**, composable per user (the 3-person collapse).
- **Only Owner-level DELETE.** All writes pass through the service-role admin client with **loud audit logging** and the 5-step pre-flight discipline (carried from RHS CRM NXT).

---

## 11. Invariants (non-negotiable — every wave obeys)

1. **Every write is atomic and server-side.** The implementation pattern is fixed: **RHS's server-action + audit + approval contract as the wrapper, with an atomic Postgres RPC inside it.** This marries RHS CRM NXT's best convention to the exact thing it got wrong (RHS itself has zero RPCs and a documented orphan-data bug). Never a multi-step client write. *(Directly retires the audit's #1 re-platform risk.)*
2. **Every automated action is idempotent and audited.**
3. **No hardcoded single-property values** — everything tenant-config.
4. **Foundation before services:** identity/multi-tenancy/automation engine/billing spine first; rooms/kitchen/vendor modules hang off it after.
5. **Money operations always produce a ledger entry + audit trail.**
6. **Port domain logic, not architecture** — re-express PN's hard-won rules on the new atomic, multi-tenant, server-side foundation; never copy the old client-side patterns verbatim.

---

## 12. Decisions — LOCKED (v1.1, confirmed 31 May 2026)

| # | Decision | Locked value |
|---|---|---|
| 1 | **Booking confirm / date hard-block** | Owner + Property Manager only. Managers build quotes & place 24h holds, but cannot hard-block. |
| 2 | **Discount approval** | Above **10% off package** → Owner/PM sign-off required. |
| 3 | **Manager money visibility** | Hall/Stays managers see **operational numbers only, no margin**. Full P&L = Owner/PM. |
| 4 | **TENTATIVE_HOLD expiry** | **24 hours**, then auto-release. |
| 5 | **Slot model** | **Morning / Evening / Full-day**, with a **3-hour turnaround buffer** between morning and evening events. |
| 6 | **Deposit** | **Security deposit = 50% of HALL RENT**, taken at booking. **Separate refundable liability — NOT part of the bill, NOT revenue.** Applies to hall only (not catering/rooms/add-ons). Returned/adjusted/forfeited **case-by-case** after damage assessment. |
| 7 | **Automation timers** | Enquiry follow-up SLA **2 hours** → escalate. Hall-rent reminders at **T-50, T-47, T-45**. Quiet hours **21:00–07:00** (no automated WhatsApp). |
| 8 | **Dynamic pricing** | System **flags** high-demand dates (muhurtham/festival/weekend) on a calendar; **pricing stays manual** in v1. Premium automation deferred. |
| 9 | **Collection rhythm** | **Full hall rent due T-45 days** before event (no split balance; deposit secures the date, rent collected pre-event). |
| 10 | **Cancellation / refund** | **Case-by-case**, routed to Owner/PM for decision; outcome logged. No auto-forfeit. |
| 11 | **GST status & package billing** | ✅ **PN = non-specified premises** (no room > ₹7,500; automatic, no declaration). **Staying non-specified** (5% no-ITC, customer-price edge over kitchen ITC recovery). Standard wedding package billed **composite 5%, catering-led**. Billing engine is config-driven — treatment changeable per-deal/globally without code change. *Revisit non-specified choice if Kitchen Phase 2/3 becomes heavy capex (ITC math can flip).* |

**Net money model (important — drives the schema):** Three independent money objects keyed off **hall rent**:
1. **Deposit** = 50% of hall rent → held as **escrowed liability**, never touches the revenue ledger (and not a taxable supply unless forfeited).
2. **Hall rent** = 100% due at **T-45**.
3. **Catering / rooms / add-ons** = billed on their own terms, separate from the deposit mechanic.

---

## 13. Foundation wave — effort (from REUSE-ANALYSIS.md)

**RHS CRM NXT is a convention donor and a cautionary tale, not a foundation.** Verified reuse compresses the foundation wave **~13.5 wk → ~8.2 wk (≈35%, 4–5 weeks saved)** — and it accelerates *scaffolding only*, not risk.

**Lifts directly (the plumbing & conventions):**
- `@supabase/ssr` auth spine + dual-client trust model + middleware — **LIFT**
- server-action `ActionResult<T>` + two-write audit pattern + multi-tier approval flow — **LIFT as the wrapper** (with an atomic RPC inside, per invariant #1)
- `lib/today/date-utils.ts` — **LIFT verbatim** (also fixes audit F-DATA-02 UTC→IST bug)
- severity engine, command palette + keyboard nav — **LIFT**
- semantic CSS-var token architecture — **LIFT, re-value to maroon Meridian**

**Zero head start — the risk-bearing 65%, all greenfield (this is the real work):**
1. **Atomicity** — RHS has 0 RPCs and the same anti-pattern; build atomic RPCs from scratch.
2. **Multi-tenant isolation** — RHS is single-org/multi-project, not multi-tenant; no `org_id` entity exists. PN's tenancy + F-SEC-04 fix is net-new.
3. **Real integrations** — MCube/WhatsApp Engage is **stubbed** in RHS (`ENGAGE_AVAILABLE=false`). The §6 automation engine's outbound path is net-new and **critical-path**. ⚠️ **Verify whether PN's own send path is real or stubbed before scoping.**
4. **Cron / scheduled automation** — no head start; the time-based rules (A3, A5, A6, A7, A9, A10) need a real scheduler.

**Don't be misled by RHS's installed deps:** TanStack Query/Table/Virtual + zod are installed but never imported; "Side Effect Tags" are emitted but consumed by nothing; no error-state primitive; no CI/deploy config. Treat these as absent.

**Single highest-value move:** the wrapper-with-RPC pattern in invariant #1 — adopt the convention, fix the flaw, in one stroke.

---

*Status: v1.1 — **all 11 §12 decisions locked, including GST.** This is now the rebuild's source of truth; the foundation wave can begin. Nothing committed to backlog yet.*
