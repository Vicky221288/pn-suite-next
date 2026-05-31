# KNOWN LIMITATIONS

Carried-forward items that are deliberate, scoped-out, or deferred to a later pass.
Each entry: what it is, why it's acceptable now, and when it gets addressed.

---

## KL-1 — Inventory cost column is member-readable (cost-visibility hardening deferred)

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

---

## KL-2 — Room-dining (Stays F&B) path is intentionally minimal

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

---

## KL-3 — Execution-checklist photo-proof stores a reference, not the binary

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
