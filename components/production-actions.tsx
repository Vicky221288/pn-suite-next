'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { generateProduction, planPurchase, closeProduction } from '@/lib/actions/catering-production';

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string; message?: string; data?: unknown }>, after?: (d: unknown) => void) => {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) { if (after) after(res.data); else router.refresh(); }
    else setMsg(`${res.error}: ${res.message}`);
  };
  return { busy, msg, run, router };
}

export function GenerateProductionButton({ beoId }: { beoId: string }) {
  const { busy, msg, run, router } = useAction();
  return (
    <span className="flex items-center gap-2">
      <Button onClick={() => run(() => generateProduction({ beoId }), (d) => router.push(`/catering/production/${(d as { ticket_id: string }).ticket_id}`))} disabled={busy}>
        {busy ? '…' : 'Generate KOT'}
      </Button>
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </span>
  );
}

export function PlanPurchaseButton({ ticketId }: { ticketId: string }) {
  const { busy, msg, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      <Button onClick={() => run(() => planPurchase({ ticketId }))} disabled={busy}>{busy ? '…' : 'Plan purchase (draft POs)'}</Button>
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </span>
  );
}

export function CloseProductionButton({ ticketId }: { ticketId: string }) {
  const { busy, msg, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      <Button onClick={() => run(() => closeProduction({ ticketId }))} disabled={busy}>{busy ? '…' : 'Close & consume'}</Button>
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </span>
  );
}
