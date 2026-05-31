import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifySignature } from './webhook';
import type { InboundMessage, MessagingProvider, SendArgs, SendResult, SendStatus } from './provider';

/**
 * MockProvider — implements the full interface but sends NOTHING externally.
 * Outbound "send" = recording an outbound_messages row via the atomic
 * enqueue_outbound RPC (idempotent + multi-sender + quiet-hours). This is what
 * proves the B3 logic before any live BSP exists.
 */
async function enqueue(args: SendArgs, kind: 'template' | 'session'): Promise<SendResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('enqueue_outbound', {
    p_org_id: args.orgId,
    p_function_area: args.functionArea,
    p_recipient: args.recipient,
    p_template: args.template ?? null,
    p_payload: args.payload ?? {},
    p_idempotency_key: args.idempotencyKey,
    p_kind: kind,
    p_now: (args.now ?? new Date()).toISOString(),
  });
  if (error) throw new Error(`enqueue_outbound: ${error.message}`);
  const r = data as Record<string, unknown>;
  return {
    id: r.id as string,
    status: r.status as SendStatus,
    senderId: r.sender_id as string,
    functionArea: r.function_area as string,
    providerMessageId: (r.provider_message_id as string) ?? null,
    scheduledFor: (r.scheduled_for as string) ?? null,
    idempotent: Boolean(r.idempotent),
  };
}

export const MockProvider: MessagingProvider = {
  name: 'mock',
  sendTemplate: (args) => enqueue(args, 'template'),
  sendSession: (args) => enqueue(args, 'session'),
  receiveWebhook(rawBody, signature): InboundMessage {
    if (!verifySignature(rawBody, signature)) {
      throw new Error('invalid_webhook_signature');
    }
    // Mock payload shape: { id, from, to, text }
    const p = JSON.parse(rawBody) as { id: string; from: string; to: string; text?: string };
    return {
      provider: 'mock',
      providerMessageId: p.id,
      toPhone: p.to,
      fromPhone: p.from,
      body: p.text ?? '',
      raw: p as unknown as Record<string, unknown>,
    };
  },
  async getStatus(providerMessageId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from('outbound_messages')
      .select('status')
      .eq('provider_message_id', providerMessageId)
      .maybeSingle();
    return ((data?.status as SendStatus) ?? 'unknown') as SendStatus | 'unknown';
  },
};
