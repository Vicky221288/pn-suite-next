'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { formatINR } from '@/lib/utils';
import { setPaymentSchedule, markMilestonePaid } from '@/lib/actions/hall';

interface Milestone { id: string; kind: string; label: string | null; amount: number; due_date: string | null; status: string; paid_at: string | null }

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)', width: 150 };

/** Payment schedule: set advance (balance auto = rent − advance, due T-45) + mark paid. */
export function PaymentActions({ bookingId, hallRent, milestones }: { bookingId: string; hallRent: number; milestones: Milestone[] }) {
  const router = useRouter();
  const [advance, setAdvance] = useState(Math.round(hallRent / 2));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
      <div className="flex flex-wrap items-end" style={{ gap: 'var(--space-2)' }}>
        <label className="flex flex-col" style={{ gap: 2, fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Advance / deposit (₹)
          <input type="number" min={0} max={hallRent} value={advance} onChange={(e) => setAdvance(Number(e.target.value))} style={field} aria-label="Advance amount" />
        </label>
        <Button onClick={() => run(() => setPaymentSchedule({ bookingId, advanceAmount: advance }))} disabled={busy}>{milestones.length ? 'Update schedule' : 'Set schedule'}</Button>
      </div>

      {milestones.length > 0 && (
        <ul className="flex flex-col" style={{ borderTop: '1px solid var(--color-divider)' }}>
          {milestones.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--color-divider)' }}>
              <div className="min-w-0">
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text)', textTransform: 'capitalize' }}>{m.label ?? m.kind.replace(/_/g, ' ')}</div>
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>due {m.due_date ?? '—'}</div>
              </div>
              <div className="flex items-center" style={{ gap: 'var(--space-3)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>{formatINR(m.amount)}</span>
                <StatusBadge status={m.status} />
                {m.status !== 'paid' && <Button variant="secondary" onClick={() => run(() => markMilestonePaid({ milestoneId: m.id }))} disabled={busy}>Mark paid</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}
    </div>
  );
}
