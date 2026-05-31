# Messaging (B3) — the only sanctioned WhatsApp path

OP MODEL §6. Messaging is **foundational** (audit F-AUTO-01): the automation
engine (B4) does nothing without it. PN has no MCube; the path is the WhatsApp
Business API via a BSP (AiSensy), behind a provider-agnostic interface.

## The rule
All messaging goes through the **`MessagingProvider` interface**
(`lib/messaging/provider.ts`) — `sendTemplate` / `sendSession` / `receiveWebhook`
/ `getStatus`. Code (actions, the B4 engine) calls **`lib/messaging/outbound.ts`**
or the interface — **never a vendor SDK directly**. Swapping BSPs is a one-file
adapter change.

## Multi-sender (two numbers, by design)
PN runs two WhatsApp numbers: **`stays`** (Gunal) and **`hall_catering`**. The
`message_senders` table is the registry, keyed `(org_id, function_area)`. A send
resolves its sender from `(org, function_area)` **server-side**; inbound resolves
its org+area from the **number it arrived on** — never from client/payload input.
Adding a third number is a config row, not code (the set of valid areas *is* the
registry; a send to an area with no sender → `no_sender`).

## Outbound guarantees (enqueue_outbound RPC, atomic)
- **Idempotent:** `unique (org_id, idempotency_key)`; a duplicate key returns the
  prior result, never a second send. Derive keys from the triggering event
  (e.g. `confirm-receipt:<booking_id>`).
- **Quiet hours 21:00–07:00 IST:** a send in the window is recorded `deferred`
  with `scheduled_for` = next 07:00 IST (the B4 scheduler drains it); outside the
  window it is `sent`. No automated WhatsApp at night (the RHS spam lesson).
- **Audited.** Every send writes an `audit_log` row.

## Inbound guarantees (ingest_inbound RPC + /api/messaging/inbound)
- **Authenticated:** the route verifies an HMAC-SHA256 signature
  (`MESSAGING_WEBHOOK_SECRET`, timing-safe). Bad/absent signature → 401, nothing
  written. (Live AiSensy swaps the signature scheme; the RPC is unchanged.)
- **Replay-safe + atomic:** dedup by `(provider, provider_message_id)`; an unknown
  number creates exactly **one** tenant-scoped lead in the correct area; a known
  number matches the existing lead (no dupes). This kills the old MCube
  ~10–15% webhook-loss / missing-lead class.

## Providers
- **`MockProvider`** (`lib/messaging/mock.ts`) — DEFAULT now. Implements the full
  interface; "sends" by recording via `enqueue_outbound`. Proves the logic.
- **`AiSensyProvider`** (`lib/messaging/aisensy.ts`) — **LIVE WIRING DEFERRED**
  (the WhatsApp/Meta setup session, Vicky's). Shell implements the interface and
  throws loudly so an accidental switch fails rather than silently no-op's.
  Select via `MESSAGING_PROVIDER=aisensy` once configured.

## Env
- `MESSAGING_PROVIDER` — `mock` (default) | `aisensy`.
- `MESSAGING_WEBHOOK_SECRET` — HMAC key for inbound signature verification.

## Proof
`scripts/b3-verify.mjs` (self-cleaning): multi-sender routing, quiet-hours
deferral, idempotent single-send, inbound dedup/replay, unknown-number →
one lead, and (with the dev server + secret) the HTTP signature auth.

## Deferred gate (the WhatsApp session, not this phase)
Live AiSensy/Meta: BSP account, number registration per area, Meta template
approval, the `AiSensyProvider` body (HTTP send + status update + signature
scheme). Until then everything runs on the mock; the interface does not change.
