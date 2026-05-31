/**
 * MessagingProvider — the provider-agnostic contract (OP MODEL §6).
 *
 * The automation engine (B4) and actions call ONLY this interface, NEVER a
 * vendor SDK directly. Swapping BSPs (mock → AiSensy → Interakt) is a one-file
 * adapter change. Multi-sender is first-class: every send carries the
 * function_area, resolved server-side to a sender (number/credentials).
 */

export type FunctionArea = string; // config-driven (message_senders rows); e.g. 'stays' | 'hall_catering'

export interface SendArgs {
  orgId: string;
  functionArea: FunctionArea;
  recipient: string;
  template?: string;
  payload?: Record<string, unknown>;
  /** idempotency key — a duplicate is a safe no-op (OP MODEL inv. #2). */
  idempotencyKey: string;
  /** injectable clock for testing quiet hours; defaults to now server-side. */
  now?: Date;
}

export type SendStatus = 'sent' | 'deferred' | 'failed';

export interface SendResult {
  id: string;
  status: SendStatus;
  senderId: string;
  functionArea: FunctionArea;
  providerMessageId: string | null;
  /** set when deferred for quiet hours (next 07:00 IST). */
  scheduledFor?: string | null;
  idempotent: boolean;
}

/** Normalized inbound message after the adapter verifies + parses a webhook. */
export interface InboundMessage {
  provider: string;
  providerMessageId: string;
  toPhone: string; // the sender number it arrived on → routes to org/area
  fromPhone: string;
  body: string;
  raw: Record<string, unknown>;
}

export interface MessagingProvider {
  readonly name: string;
  /** Outbound template message (idempotent + quiet-hours-aware via the RPC). */
  sendTemplate(args: SendArgs): Promise<SendResult>;
  /** Outbound free-form session message (24h window). Same policy path. */
  sendSession(args: SendArgs): Promise<SendResult>;
  /** Verify + parse a raw webhook into a normalized InboundMessage, or throw on auth failure. */
  receiveWebhook(rawBody: string, signature: string | null): InboundMessage;
  /** Delivery status for a previously-sent message. */
  getStatus(providerMessageId: string): Promise<SendStatus | 'unknown'>;
}
