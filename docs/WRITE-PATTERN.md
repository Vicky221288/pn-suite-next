# The Write Pattern — wrapper + atomic RPC (MANDATORY)

**OP MODEL invariant #1. This is the ONLY sanctioned way to mutate data in PN.
Code review REJECTS any multi-step / sequential client or server write.**

Why: the legacy PN build and RHS CRM NXT both shipped non-atomic sequential
writes that orphan data on partial failure (RHS's documented `cost_sheet.ts:360`
bug). PN makes that class of bug *structurally impossible* by doing every related
mutation inside ONE Postgres transaction (a `SECURITY DEFINER` RPC), wrapped by
the `ActionResult<T>` server-action convention lifted from RHS.

```
 server action (lib/actions/*)                 Postgres RPC (one transaction)
 ┌─────────────────────────────┐               ┌──────────────────────────────┐
 │ defineAction({              │  admin.rpc()  │ confirm_booking(...)          │
 │   authenticate              │ ────────────▶ │  • idempotency check          │
 │   validate (zod)            │               │  • INSERT booking (CONFIRMED) │
 │   authorize                 │               │  • INSERT hard-block (EXCLUDE)│
 │   audit: ATTEMPTED  ────────┼── durable ──▶ │  • INSERT deposit (liability) │
 │   run() → the RPC           │               │  • INSERT audit COMPLETED     │
 │   audit: COMPLETED (in RPC) │               │  ── all-or-nothing ──         │
 │   audit: FAILED  ───────────┼── durable ──▶ │  raise → whole tx rolls back  │
 │ })                          │               └──────────────────────────────┘
 └─────────────────────────────┘
```

## The rules
1. **One transaction does everything.** All writes for one user intent live in a
   single `SECURITY DEFINER` Postgres function. Never two awaited writes from app
   code.
2. **The wrapper owns auth/validate/authorize + the durable audit edges**
   (`attempted` before, `failed` after) — these are written OUTSIDE the RPC tx so
   a failed attempt is still recorded after the mutation rolls back.
3. **The RPC owns the atomic `completed` audit** (written inside the tx, set
   `rpcOwnsCompletion: true`) so a `completed` row can never outlive a rolled-back
   write. The wrapper passes the attempted id via `ctx.auditAttemptedId` →
   `p_parent_audit_id` for parent-linking.
4. **Idempotency (inv. #2):** every write carries an idempotency key with a
   `UNIQUE (org_id, idempotency_key)` constraint; the RPC returns the existing row
   on a repeat instead of writing twice. Pre-empts the RHS realtime-INSERT spam.
5. **Race safety at the DB, not in app code.** Conflicts (e.g. double-booking)
   are enforced by a constraint (GiST `EXCLUDE`), checked at COMMIT, so concurrent
   writers serialize and exactly one wins. Never a check-then-insert race.
6. **org_id everywhere (inv. #3)** — column + RPC param from day one, so B2 is a
   pure RLS-policy layer.
7. **Money ops write a ledger row + audit (inv. #5).** Deposits are escrowed
   liabilities, never revenue.
8. **Authorization before widening execution.** A `SECURITY DEFINER` RPC is only
   granted to `service_role` (the admin-client path) until B2 adds the org-scoped
   capability gate — otherwise any authenticated user could pass an arbitrary
   `org_id` (the F-SEC-04 hole).

## Reference implementation (copy this shape)
- RPC: `supabase/migrations/20260531090000_b1_atomic_booking.sql` →
  `confirm_booking(...)`.
- Action: `lib/actions/booking.ts` → `confirmBooking`.
- Wrapper: `lib/actions/wrapper.ts` → `defineAction` (+ `ActionError` in
  `lib/actions/types.ts` for typed, UI-mappable failures like `slot_taken`).
- Proof: `scripts/b1-verify.mjs` (concurrency / idempotency / rollback / slot
  semantics; self-cleaning).

## Checklist before merging any new write
- [ ] All mutations in ONE RPC transaction (no multi-step app writes).
- [ ] Ran the 5-step pre-flight (`docs/PRE-FLIGHT-5-STEP.md`).
- [ ] Idempotency key + unique constraint.
- [ ] Conflicts enforced by a DB constraint, not app code.
- [ ] `org_id` on every table + RPC param.
- [ ] Money op → ledger + audit; deposits are liabilities.
- [ ] RPC granted only as widely as authorization allows.
