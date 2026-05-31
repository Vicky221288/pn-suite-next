# B5 manual walk-through — drive one enquiry end-to-end (live UI)

The go/no-go gate is proven deterministically by `scripts/b5-verify.mjs`. This is
the **human** confirmation: the same thread on the live UI. ~3 minutes.

## Prerequisites (Vicky)
1. B5 migration applied to `kvyhyeqwyafpizecfbnt`.
2. You're a member of an org with the **owner** role (capabilities incl.
   `booking.confirm` + `settlement.process`), and that org has **one hall** and a
   **`hall_catering` sender** row (the B3/B4 harnesses self-clean, so seed one
   org/hall/sender for the walk-through — or reuse your real PN org once seeded).
3. Signed in; the cron isn't required (the rules are also drivable here / by tick).

## The click path
1. **Today** (`/`). Note the command surface — events today, money to collect
   (you're owner, so it shows), exceptions. (Empty is fine before the thread.)
2. **Enquiries** (`/enquiries`) → **New enquiry**: area = Hall / Catering, a name
   + a phone → **New enquiry**. A row appears; an **acknowledgement** is queued
   (A1) — check `outbound_messages` (mock) for `enquiry-ack:<lead>`.
3. Open the lead. **Log follow-up** (this stops the 2h SLA clock — A2 won't
   escalate a followed-up lead).
4. **Send quote**: set hall rent (e.g. 200000) → **Send quote**. Status → quoted.
5. Pick an **event date** + **Full day** → **Confirm booking (+50% deposit)**.
   - Booking → confirmed; the **date/slot is hard-blocked** (try another booking
     on the same hall/date/slot — it's refused: the GiST guard).
   - A **₹100,000 deposit** appears under Booking as a **held liability**.
6. **Create event (BEO)**.
7. **Settle (GST invoice + refund deposit)** — *Owner/PM only* (a manager sees the
   button disabled / gets "forbidden"). You'll get:
   - **Tax invoice** `INV-00001`, **SAC 9963, 5% composite** — Taxable ₹200,000 +
     CGST ₹5,000 + SGST ₹5,000 = **₹210,000** (the **deposit is NOT in the bill**).
   - Deposit ledger shows **refunded / liability discharged** — never revenue.
8. Back to **Today** (after the next 07:00 build, or trigger `/api/cron/tick` with
   the secret): money-to-collect and exceptions reflect the thread.

## What this proves (live, by hand)
Enquiry→Quote→Booking→Event→Settlement composes the four pillars: atomic confirm +
deposit-liability (B1), tenant-scoped + Owner/PM settlement (B2), the A1 ack via
the multi-sender interface (B3), SLA/reminder/Today rules (B4), and the
composite-5% GST invoice with the deposit kept off revenue (§7/§12, F-FIN-03).
