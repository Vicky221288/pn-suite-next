import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Inbound webhook authentication. Verifies an HMAC-SHA256 signature of the raw
 * body against the shared secret (MESSAGING_WEBHOOK_SECRET). Replaces the old
 * MCube unauthenticated/loss-prone webhook. timing-safe compare.
 *
 * Live AiSensy will use its own signature scheme; the adapter swaps the verify
 * function — the inbound RPC + dedup/route logic stay identical.
 */
export function webhookSecret(): string {
  const s = process.env.MESSAGING_WEBHOOK_SECRET;
  if (!s) throw new Error('MESSAGING_WEBHOOK_SECRET is not set');
  return s;
}

export function sign(rawBody: string, secret: string = webhookSecret()): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  let expected: string;
  try {
    expected = sign(rawBody);
  } catch {
    return false;
  }
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
