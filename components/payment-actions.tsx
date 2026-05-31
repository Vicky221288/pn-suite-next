'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/utils';
import { setPaymentSchedule, markMilestonePaid } from '@/lib/actions/hall';

interface Milestone { id: string; kind: string; label: string | null; amount: number; due_date: string | null; status: string; paid_at: string | null }

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
  const colour = (s: string) => (s === 'paid' ? 'var(--color-success)' : s === 'overdue' ? 'var(--color-danger)' : 'var(--color-text-secondary)');
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)', width: 130 };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Advance / deposit (₹)</label>
          <input type="number" min={0} max={hallRent} value={advance} onChange={(e) => setAdvance(Number(e.target.value))} style={i} aria-label="Advance amount" />
        </div>
        <Button onClick={() => run(() => setPaymentSchedule({ bookingId, advanceAmount: advance }))} disabled={busy}>{milestones.length ? 'Update schedule' : 'Set schedule'}</Button>
      </div>
      {milestones.length > 0 && (
        <ul className="flex flex-col">
          {milestones.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-1 text-sm" style={{ borderBottom: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
              <span>{m.label ?? m.kind} <span style={{ color: 'var(--color-text-tertiary)' }}>· due {m.due_date ?? '—'}</span></span>
              <span className="flex items-center gap-2" style={{ fontFamily: 'var(--font-mono)' }}>
                {formatINR(m.amount)} · <b style={{ color: colour(m.status) }}>{m.status}</b>
                {m.status !== 'paid' && <Button onClick={() => run(() => markMilestonePaid({ milestoneId: m.id }))} disabled={busy}>Mark paid</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </div>
  );
}
