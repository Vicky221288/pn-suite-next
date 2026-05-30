# PN Master Suite — Foundation Wave Build Plan
### From OP MODEL v1.2 → executable, sequenced, finding-linked work
*v1.0 · 31 May 2026 · the plan CC marches against · derived from OP MODEL v1.2, AUDIT-2.0 (45/100), REUSE-ANALYSIS*

> **What this is.** The OP MODEL says *what PN should be*. This says *what gets built, in what order, and why that order*. Every item traces to an OP MODEL section or an audit finding ID. This is the rebuild's tactical contract — the equivalent of RHS CRM NXT's master-backlog, but for PN's foundation wave only (Waves C/D/E come later).
>
> **Scope of this document:** Wave A (stop-the-bleeding — N/A here, we're rebuilding) + **Wave B (Foundation)**. The spine (Wave C), services (D), and productization (E) get their own plans once the foundation stands.

---

## 0. The shape of the foundation wave

From the reuse analysis: ~8.2 weeks with RHS conventions lifted. The work splits cleanly into **what lifts** (scaffolding — fast) and **what's greenfield** (the risk-bearing 65% — slow and careful). This plan front-loads the greenfield risk so it surfaces early, not late.

**The four greenfield pillars (no head start, build first):**
1. **Atomicity** — the wrapper+RPC pattern (OP MODEL inv. #1)
2. **Multi-tenancy** — `org_id` + tenant RLS (OP MODEL §10, fixes F-SEC-04)
3. **Messaging** — `MessagingProvider` + AiSensy adapter (OP MODEL §6, foundational)
4. **Scheduler** — cron for time-based automation (OP MODEL §6 A3/A5/A6/A7/A9/A10)

**The proof:** one **Enquiry → Booking → Event → Settlement vertical slice** on the new stack, exercising all four pillars end-to-end, before any mass module migration. (This is the audit's recommended de-risk experiment.)

---

## 1. Phase B0 — Project genesis & guardrails *(lift-heavy, ~3–4 days)*

**Goal:** a clean, independent PN project on the new stack with the conventions that prevent the old failures.

| # | Item | Source | Lift/Greenfield |
|---|---|---|---|
| B0.1 | New Next.js 15 app, independent repo (PN's own GitHub, Supabase, Vercel, email — fully separate from RHS) | user: PN is independent entity | Greenfield setup |
| B0.2 | `@supabase/ssr` auth spine + dual-client trust model + middleware | REUSE: LIFT | Lift |
| B0.3 | Service-role admin client + loud audit logging + 5-step pre-flight discipline | OP MODEL §10, RHS pattern | Lift (pattern) |
| B0.4 | `ActionResult<T>` server-action contract — **the wrapper** | REUSE: LIFT | Lift |
| B0.5 | `lib/today/date-utils.ts` — **verbatim** (fixes F-DATA-02 UTC→IST) | REUSE: LIFT verbatim | Lift |
| B0.6 | Semantic CSS-var token architecture, **re-valued to maroon Meridian** | REUSE: LIFT + re-skin | Lift+adapt |
| B0.7 | `CLAUDE.md` + this build plan committed as the project's source of truth | working posture | Greenfield |
| B0.8 | CI/deploy config (RHS has none — build it) | REUSE: gap | Greenfield |

**Entry:** OP MODEL v1.2 locked (✅). **Exit:** app boots, auth works, audit logging fires, tokens render maroon, CI green.

---

## 2. Phase B1 — The atomic write foundation *(greenfield, ~1 week) — HIGHEST RISK FIRST*

**Goal:** prove the wrapper+RPC pattern before any feature depends on it. This is OP MODEL invariant #1 and the audit's #1 re-platform risk; it gets built and proven in isolation first.

| # | Item | Source |
|---|---|---|
| B1.1 | Define the wrapper+RPC pattern: server action (`ActionResult<T>` + audit) wrapping an **atomic Postgres RPC** | OP MODEL inv. #1 |
| B1.2 | Reference implementation: one non-trivial multi-table write as an atomic RPC (e.g. booking-confirm: write booking + block date + create deposit-liability in ONE transaction) | OP MODEL §5.2 |
| B1.3 | Concurrency test harness: two simultaneous writes to the same (hall,date,slot) — prove exactly one wins | OP MODEL §5.2 double-booking guard, scenario S4 |
| B1.4 | Idempotency-key primitive (every write + every automated action carries one) | OP MODEL inv. #2 |
| B1.5 | Document the pattern as the mandatory template for all future writes | working posture |

**Entry:** B0 complete. **Exit:** concurrency test passes deterministically; the orphan-data class of bug (RHS cost_sheet.ts:360, PN's old non-atomic writes) is structurally impossible.

---

## 3. Phase B2 — Multi-tenant skeleton *(greenfield, ~1–1.5 weeks)*

**Goal:** `org_id` everywhere, tenant-isolated, with the F-SEC-04 fix proven by test.

| # | Item | Source |
|---|---|---|
| B2.1 | `Property (org)` root entity; `org_id` on every table by design | OP MODEL §10, inv. #3 |
| B2.2 | Tenant-scoped RLS on every read/write | OP MODEL §10 |
| B2.3 | **Fix F-SEC-04:** every elevated role scoped to a property; no cross-tenant visibility | AUDIT F-SEC-04 |
| B2.4 | Roles-as-capabilities model, composable per user (the 3-person collapse) | OP MODEL §3 |
| B2.5 | **Two-tenant isolation test** — stand up tenant #2, prove zero leakage in both directions | OP MODEL §10 |
| B2.6 | Property-level config knobs incl. the "specified premises" GST flag | OP MODEL §7, GST doc |

**Entry:** B1 pattern exists (tenant writes use it). **Exit:** two-tenant isolation test passes; PN runs as tenant #1 with zero hardcoded single-property values (retires the F-* single-property coupling findings).

---

## 4. Phase B3 — Messaging foundation *(greenfield, ~1–1.5 weeks)*

**Goal:** real, swappable, abuse-proof WhatsApp. Foundational because nothing in §6 works without it.

| # | Item | Source |
|---|---|---|
| B3.1 | `MessagingProvider` interface (`sendTemplate`/`sendSession`/`receiveWebhook`/`getStatus`) | OP MODEL §6 |
| B3.2 | **AiSensy adapter** behind the interface | OP MODEL §6, WhatsApp rec |
| B3.3 | Outbound: idempotent + **quiet-hours-aware (21:00–07:00)** | OP MODEL §6, §12 #7 |
| B3.4 | Inbound webhook: **authenticated, idempotent, replay-safe** (kills old ~10–15% MCube loss) | OP MODEL §6, MCube history |
| B3.5 | Unknown-number → auto-lead-capture path (inbound webhook → atomic enquiry create) | pending CRM queue, OP MODEL §5.1 |
| B3.6 | Template registry (PN's own WhatsApp templates, Meta-approved) | OP MODEL §6 |

**Entry:** B1 (atomic writes for inbound capture) + B2 (tenant-scoped). **Exit:** a real WhatsApp sends from the suite respecting quiet hours; a real inbound message creates a deduped lead atomically; provider swap proven trivial (stub a second adapter).

---

## 5. Phase B4 — Scheduler / automation runtime *(greenfield, ~0.5–1 week)*

**Goal:** the time-based engine that makes "system of action" real.

| # | Item | Source |
|---|---|---|
| B4.1 | Cron/scheduled-job runtime (Vercel cron or Supabase scheduled functions) | OP MODEL §6 |
| B4.2 | Rule executor: trigger→condition→action, idempotent, audited, quiet-hours-aware | OP MODEL §6 |
| B4.3 | Daily 07:00 "Today" builder (A10) | OP MODEL §6, §8 |
| B4.4 | SLA-breach escalation engine (A2 — the enforcement that was missing) | OP MODEL §6, AUDIT F-AUTO-01 |

**Entry:** B3 (actions send messages). **Exit:** a scheduled rule fires on time, exactly once, within quiet hours, and is audit-logged. F-AUTO-01 (the 2/10 layer) is structurally addressed.

---

## 6. Phase B5 — The vertical slice (the proof) *(integrative, ~1.5–2 weeks)*

**Goal:** one full lifecycle thread end-to-end on the new foundation, exercising all four pillars. This is the go/no-go gate for the whole re-platform.

**The slice:** a single real PN enquiry walked from capture to settlement —
`Enquiry (B3 inbound capture) → Quote → Booking (B1 atomic confirm + B2 tenant + deposit-liability) → Event (BEO minimal) → Settlement (GST invoice F-FIN-03 + deposit resolution) → post-event (B4 review request)`

| # | Item | Source |
|---|---|---|
| B5.1 | Minimal but real screens for each spine state (maroon Meridian, keyboard-first) | OP MODEL §5, §2 design |
| B5.2 | The "Today" surface as the home screen | OP MODEL §8 |
| B5.3 | GST tax-invoice generation at INVOICED (composite-5%, config-driven) | OP MODEL §7, F-FIN-03 |
| B5.4 | Deposit-as-escrowed-liability flow (50% hall rent, separate from revenue) | OP MODEL §12 #6 |
| B5.5 | At least 3 automation rules live (A1 ack, A2 escalation, A5 rent reminder) | OP MODEL §6 |

**Entry:** B1–B4 complete. **Exit (= foundation wave done):** a real enquiry flows end-to-end, atomically, tenant-scoped, with real WhatsApp and a scheduled reminder, producing a correct GST invoice and a held deposit. **This is the moment PN moves from "Capable Tool (45)" toward "Product."**

---

## 7. Sequencing logic (why this order)

```
B0 genesis ─→ B1 atomicity ─→ B2 multi-tenant ─→ B3 messaging ─→ B4 scheduler ─→ B5 vertical slice
   (lift)       (risk #1)        (greenfield)      (foundational)   (the engine)    (the proof)
```

- **Risk-first:** B1 (atomicity) before anything depends on it — if the pattern doesn't hold, we learn it in week 2, not month 3.
- **Foundation-first** (OP MODEL inv. #4): no service module until the four pillars + slice stand.
- **Messaging is in the foundation, not deferred** — settled by PN having zero MCube and the system-of-action thesis depending on it.
- **The slice is the gate** — no mass migration of the 16 legacy modules until one thread proves the foundation. (This is the audit's cheapest de-risk experiment, made the plan's spine.)

---

## 8. CC working posture for this wave

- Every CC prompt: **CONTEXT block + STOP markers + RESUME block** (standing rule).
- All writes via the wrapper+RPC pattern (B1.5) — no exceptions, no client-side multi-step writes.
- Service-role admin client + loud audit + 5-step pre-flight before any schema change.
- CC never deploys; you review, run SQL, and deploy manually (standing rule).
- Phase-by-phase: CC completes a phase, prints its RESUME line, **stops and waits** for your review before the next.
- Each phase exits only when its **exit criterion is demonstrably met** (a passing test, not a claim).

---

## 9. What this wave deliberately does NOT do

- No migration of the 16 legacy modules (that's Wave C, after the slice proves the foundation).
- No productization — billing, onboarding, white-label theming (Wave E).
- No premium-pricing automation (OP MODEL §12 #8 — flagged, deferred).
- No OTA channel manager (strategy §8 — validate demand first).
- No Kitchen module build (lands in Wave C/D; its GST/ITC economics already noted).

---

## 10. Open inputs before B0 starts

1. **AiSensy account + Meta WhatsApp Business verification** for PN's number — your action (account creation is yours, not CC's; I can't create accounts and CC shouldn't either).
2. **PN's WhatsApp templates** drafted + submitted to Meta for approval (lead times apply — start early; B3.6 needs them).
3. **Confirm the independent infra is provisioned** — PN GitHub repo, Supabase project, Vercel project, domain/email — all separate from RHS (you confirmed the separation; this is the "are they created yet" check).
4. **Maroon Meridian token values** — exact maroon/cream hex + Playfair setup (can finalize in B0.6, or I can draft a token spec now).

---

*Status: foundation-wave plan v1.0. On your go + the §10 inputs, B0 begins. The spine/services/productization waves get their own plans once B5 (the slice) passes. Nothing committed to a repo backlog yet.*
