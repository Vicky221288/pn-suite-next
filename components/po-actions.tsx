'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { orderPurchaseOrder, receivePurchaseOrder } from '@/lib/actions/catering-production';

/** PO lifecycle buttons: draft → order, ordered → receive (stock IN). */
export function PoActions({ poId, status }: { poId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }
  if (status === 'received') return <span className="text-xs" style={{ color: 'var(--color-success)' }}>✓ Received — stock updated.</span>;
  return (
    <div className="flex items-center gap-2">
      {status === 'draft' && <Button onClick={() => act(() => orderPurchaseOrder({ poId }))} disabled={busy}>{busy ? '…' : 'Mark ordered'}</Button>}
      {status === 'ordered' && <Button onClick={() => act(() => receivePurchaseOrder({ poId }))} disabled={busy}>{busy ? '…' : 'Receive (stock in)'}</Button>}
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </div>
  );
}
