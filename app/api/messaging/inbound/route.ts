import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getProvider } from '@/lib/messaging';

/**
 * Inbound WhatsApp webhook (OP MODEL §6; kills the old MCube ~10–15% loss).
 *
 * - Authenticated: the provider verifies the HMAC signature; a bad/absent
 *   signature → 401, nothing written.
 * - Idempotent / replay-safe + atomic: ingest_inbound dedups by provider message
 *   id and, on an unknown number, creates exactly one tenant-scoped lead in the
 *   correct function area — resolved from the RECEIVING number, never the payload.
 *
 * Runs as the system path (service_role admin client; webhooks have no user
 * session). The provider/signature scheme swaps with the BSP; this handler and
 * the RPC do not.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature =
    request.headers.get('x-pn-signature') ?? request.headers.get('x-hub-signature-256');

  let inbound;
  try {
    inbound = getProvider().receiveWebhook(rawBody, signature);
  } catch {
    // signature failure or unparseable payload — reject, write nothing
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('ingest_inbound', {
    p_provider: inbound.provider,
    p_provider_message_id: inbound.providerMessageId,
    p_to_phone: inbound.toPhone,
    p_from_phone: inbound.fromPhone,
    p_body: inbound.body,
    p_raw: inbound.raw,
  });

  if (error) {
    // Unknown receiving number → we don't know the tenant. 422, not a 5xx.
    if (error.code === 'P0002' || /unknown_sender_number/.test(error.message)) {
      return NextResponse.json({ ok: false, error: 'unknown_sender_number' }, { status: 422 });
    }
    return NextResponse.json({ ok: false, error: 'ingest_failed' }, { status: 500 });
  }

  const r = data as { lead_id: string; deduped: boolean; created_lead: boolean };
  return NextResponse.json({ ok: true, ...r }, { status: 200 });
}
