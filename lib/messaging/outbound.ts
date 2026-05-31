import 'server-only';
import { getProvider } from './index';
import type { SendArgs, SendResult } from './provider';

/**
 * The outbound pipeline — the single entry point the automation engine (B4) and
 * actions use to send WhatsApp. It delegates to the configured provider, whose
 * send path (via the enqueue_outbound RPC) atomically: resolves the sender for
 * (org, function_area) → enforces quiet hours (defer 21:00–07:00 IST) →
 * enforces idempotency (duplicate key = no-op) → records + audits.
 *
 * Callers never touch a vendor SDK or pick a number — function_area + org are
 * resolved server-side to the right sender. Idempotency keys must be stable and
 * derived from the triggering event (e.g. `confirm-receipt:<booking_id>`), so a
 * retry or a re-fired automation never double-sends.
 */
export function sendWhatsAppTemplate(args: SendArgs): Promise<SendResult> {
  return getProvider().sendTemplate(args);
}

export function sendWhatsAppSession(args: SendArgs): Promise<SendResult> {
  return getProvider().sendSession(args);
}
