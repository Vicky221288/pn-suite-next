'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { settleInvoice } from '@/lib/actions/catering-invoice';

/** Settle the invoice — post revenue + discharge (or forfeit) the deposit. */
export function SettleInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [resolution, setResolution] = useState<'discharge' | 'forfeit'>('discharge');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function settle() {
    setBusy(true); setMsg(null);
    const res = await settleInvoice({ invoiceId, depositResolution: resolution });
    setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Deposit</label>
      <select value={resolution} onChange={(e) => setResolution(e.target.value as 'discharge' | 'forfeit')} style={i} aria-label="Deposit resolution">
        <option value="discharge">Discharge against balance</option>
        <option value="forfeit">Forfeit (taxable income)</option>
      </select>
      <Button onClick={settle} disabled={busy}>{busy ? 'Settling…' : 'Mark settled'}</Button>
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </div>
  );
}
