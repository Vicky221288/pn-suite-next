'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { generateConsolidatedInvoice } from '@/lib/actions/catering-invoice';

type Stream = 'hall' | 'rooms_fnb' | 'catering';
interface Line { stream: Stream; description: string; taxableValue: string; unitPrice: string; actualCount: string; beoId: string }
const blank: Line = { stream: 'hall', description: '', taxableValue: '', unitPrice: '', actualCount: '', beoId: '' };

/** Compose the billable lines for an Event; the engine resolves each rate. */
export function InvoiceGenerator() {
  const router = useRouter();
  const [eventId, setEventId] = useState('');
  const [lines, setLines] = useState<Line[]>([{ ...blank }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const add = () => setLines((ls) => [...ls, { ...blank }]);
  const remove = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  async function submit() {
    setBusy(true); setMsg(null);
    const payload = lines.map((l) => l.stream === 'catering'
      ? { stream: l.stream, description: l.description || undefined, unitPrice: Number(l.unitPrice) || 0, actualCount: Number(l.actualCount) || 0, beoId: l.beoId || undefined }
      : { stream: l.stream, description: l.description || undefined, taxableValue: Number(l.taxableValue) || 0 });
    const res = await generateConsolidatedInvoice({ eventId, lines: payload });
    setBusy(false);
    if (res.ok) router.push(`/catering/invoice/${(res.data as { invoice_id: string }).invoice_id}`);
    else setMsg(`${res.error}: ${res.message}`);
  }
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Event ID</label>
        <input value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="event uuid" style={i} aria-label="Event ID" />
      </div>
      {lines.map((l, idx) => (
        <div key={idx} className="flex flex-wrap items-end gap-2" style={{ borderTop: idx ? '1px solid var(--color-divider)' : 'none', paddingTop: idx ? 8 : 0 }}>
          <select value={l.stream} onChange={(e) => set(idx, { stream: e.target.value as Stream })} style={i} aria-label="Stream">
            <option value="hall">Hall (18%)</option>
            <option value="rooms_fnb">Rooms / F&B (5%)</option>
            <option value="catering">Catering (5% composite)</option>
          </select>
          <input value={l.description} onChange={(e) => set(idx, { description: e.target.value })} placeholder="description" style={{ ...i, width: 150 }} aria-label="Description" />
          {l.stream === 'catering' ? (
            <>
              <input type="number" value={l.unitPrice} onChange={(e) => set(idx, { unitPrice: e.target.value })} placeholder="₹/plate" style={{ ...i, width: 90 }} aria-label="Unit price" />
              <input type="number" value={l.actualCount} onChange={(e) => set(idx, { actualCount: e.target.value })} placeholder="actual #" style={{ ...i, width: 90 }} aria-label="Actual count" />
              <input value={l.beoId} onChange={(e) => set(idx, { beoId: e.target.value })} placeholder="BEO id (for guarantee)" style={{ ...i, width: 160 }} aria-label="BEO id" />
            </>
          ) : (
            <input type="number" value={l.taxableValue} onChange={(e) => set(idx, { taxableValue: e.target.value })} placeholder="taxable ₹" style={{ ...i, width: 120 }} aria-label="Taxable value" />
          )}
          {lines.length > 1 && <button onClick={() => remove(idx)} className="text-xs" style={{ color: 'var(--color-danger)' }}>remove</button>}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button onClick={add} className="text-sm" style={{ color: 'var(--color-brand)' }}>+ add line</button>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={busy || !eventId}>{busy ? 'Generating…' : 'Generate invoice'}</Button>
        {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
      </div>
    </div>
  );
}
