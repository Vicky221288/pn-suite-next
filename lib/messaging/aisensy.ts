import 'server-only';
import type { InboundMessage, MessagingProvider, SendArgs, SendResult } from './provider';

/**
 * AiSensyProvider — LIVE WIRING DEFERRED (Vicky's AiSensy/Meta session).
 *
 * This shell implements the same MessagingProvider interface so the live BSP is
 * a one-file swap (set MESSAGING_PROVIDER=aisensy once configured). When wired,
 * each method will:
 *   - sendTemplate/sendSession: call enqueue_outbound to reserve idempotently +
 *     decide quiet-hours deferral; if not deferred, POST to the AiSensy API for
 *     the resolved sender, then update the outbound row to sent/failed.
 *   - receiveWebhook: verify AiSensy's signature scheme, parse its payload into
 *     the normalized InboundMessage (the ingest_inbound RPC stays identical).
 *   - getStatus: read AiSensy delivery status.
 *
 * Until then every method throws, so an accidental switch fails loudly rather
 * than silently no-op'ing. DO NOT call live AiSensy/Meta endpoints here yet.
 */
const DEFERRED = 'AiSensy adapter not wired yet — deferred to the WhatsApp setup session (B3 gate).';

export const AiSensyProvider: MessagingProvider = {
  name: 'aisensy',
  sendTemplate: (_args: SendArgs): Promise<SendResult> => {
    throw new Error(DEFERRED);
  },
  sendSession: (_args: SendArgs): Promise<SendResult> => {
    throw new Error(DEFERRED);
  },
  receiveWebhook: (_rawBody: string, _signature: string | null): InboundMessage => {
    throw new Error(DEFERRED);
  },
  getStatus: () => {
    throw new Error(DEFERRED);
  },
};
