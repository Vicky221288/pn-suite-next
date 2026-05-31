'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { generateBeo } from '@/lib/actions/catering-beo';

interface QuoteOpt { id: string; label: string; guestCount: number }

/** Generate a BEO (kitchen or FOH) from an accepted quote onto the shared Event. */
export function BeoGenerateForm({ quotes }: { quotes: QuoteOpt[] }) {
  const router = useRouter();
  const first = quotes[0];
  const [quoteId, setQuoteId] = useState(first?.id ?? '');
  const [beoType, setBeoType] = useState<'kitchen' | 'foh'>('kitchen');
  const [guarantee, setGuarantee] = useState(first?.guestCount ?? 0);
  const [serviceTime, setServiceTime] = useState('');
  const [venue, setVenue] = useState('');
  const [special, setSpecial] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setMsg(null);
    const res = await generateBeo({
      quoteId, beoType, guestGuarantee: guarantee,
      serviceTime: serviceTime || undefined, venue: venue || undefined, special: special || undefined,
    });
    setBusy(false);
    if (res.ok) router.push(`/catering/beo/${(res.data as { beo_id: string }).beo_id}`);
    else setMsg(`${res.error}: ${res.message}`);
  }
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  const lbl = { color: 'var(--color-text-secondary)' };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-sm" style={lbl}>Accepted quote</label>
        <select value={quoteId} onChange={(e) => { setQuoteId(e.target.value); const q = quotes.find((x) => x.id === e.target.value); if (q) setGuarantee(q.guestCount); }} style={i} aria-label="Accepted quote">
          {quotes.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm" style={lbl}>BEO type</label>
          <select value={beoType} onChange={(e) => setBeoType(e.target.value as 'kitchen' | 'foh')} style={i} aria-label="BEO type">
            <option value="kitchen">Kitchen</option>
            <option value="foh">FOH / service</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm" style={lbl}>Guest guarantee</label>
          <input type="number" min={0} value={guarantee} onChange={(e) => setGuarantee(Number(e.target.value))} style={{ ...i, width: 130 }} aria-label="Guest guarantee" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm" style={lbl}>Service time</label>
          <input value={serviceTime} onChange={(e) => setServiceTime(e.target.value)} placeholder="19:00" style={{ ...i, width: 110 }} aria-label="Service time" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm" style={lbl}>Venue</label>
          <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Main hall" style={{ ...i, width: 160 }} aria-label="Venue" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm" style={lbl}>Special instructions</label>
        <textarea value={special} onChange={(e) => setSpecial(e.target.value)} rows={2} style={i} aria-label="Special instructions" />
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={busy || !quoteId}>{busy ? 'Generating…' : 'Generate BEO'}</Button>
        {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
      </div>
    </div>
  );
}
