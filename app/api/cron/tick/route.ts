import { NextResponse, type NextRequest } from 'next/server';
import { runTick } from '@/lib/automation/registry';

/**
 * Scheduler entry point (OP MODEL §6). Vercel Cron hits this on a fixed cadence
 * (see vercel.json). Chosen over pg_cron because rules send via the B3
 * MessagingProvider (a TS interface; the live AiSensy adapter makes HTTP calls)
 * — the engine must run in the app runtime, versioned with the code.
 *
 * AUTHENTICATED by a shared secret (Vercel sends `Authorization: Bearer
 * $CRON_SECRET`). Not public; `/api/cron` is also excluded from the session
 * redirect in middleware (B3 lesson — a cron/webhook route must not be bounced
 * to /login). No secret configured → locked (500), never open.
 */
export const dynamic = 'force-dynamic';

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

async function handle(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'cron_not_configured' }, { status: 500 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const result = await runTick(new Date());
  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}

export const GET = handle; // Vercel Cron uses GET
export const POST = handle; // allow manual/secured POST triggering too
