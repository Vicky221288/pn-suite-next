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
