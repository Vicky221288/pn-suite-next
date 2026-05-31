'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/utils';
import { addFolioCharge, postRoomNights, settleFolio } from '@/lib/actions/stays';

interface Charge { id: string; charge_type: string; description: string | null; amount: number }
interface Stay { id: string; check_in: string; check_out: string; status: string; rate_quoted: number; guests: { name: string } | null; rooms: { number: string } | null; folio_charges: Charge[] }

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };

export function FolioManager({ stays }: { stays: Stay[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [amt, setAmt] = useState<Record<string, number>>({});
  const [desc, setDesc] = useState<Record<string, string>>({});
  const [dep, setDep] = useState<Record<string, number>>({});

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }
  const total = (s: Stay) => s.folio_charges.reduce((x, c) => x + Number(c.amount), 0);

  return (
    <div className="flex flex-col gap-4">
      {stays.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No active folios.</p> : stays.map((s) => (
        <section key={s.id} style={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{s.guests?.name ?? '—'} · #{s.rooms?.number ?? '—'} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>· {s.check_in} → {s.check_out} · {s.status}</span></span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>{formatINR(total(s))}</span>
          </div>
          <ul className="my-2 flex flex-col text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {s.folio_charges.map((c) => <li key={c.id} className="flex justify-between py-0.5"><span>{c.charge_type} {c.description ? `· ${c.description}` : ''}</span><span style={{ fontFamily: 'var(--font-mono)' }}>{formatINR(c.amount)}</span></li>)}
            {s.folio_charges.length === 0 && <li style={{ color: 'var(--color-text-tertiary)' }}>No charges yet.</li>}
          </ul>
          {s.status !== 'settled' ? (
            <div className="flex flex-wrap items-center gap-2">
              {!s.folio_charges.some((c) => c.charge_type === 'room_night') && <Button onClick={() => run(() => postRoomNights({ stayId: s.id }))} disabled={busy}>Post room nights</Button>}
              <input type="number" value={amt[s.id] ?? ''} onChange={(e) => setAmt((p) => ({ ...p, [s.id]: Number(e.target.value) }))} placeholder="₹ charge" style={{ ...i, width: 100 }} aria-label="Charge amount" />
              <input value={desc[s.id] ?? ''} onChange={(e) => setDesc((p) => ({ ...p, [s.id]: e.target.value }))} placeholder="description" style={{ ...i, width: 130 }} aria-label="Charge description" />
              <Button onClick={() => run(() => addFolioCharge({ stayId: s.id, chargeType: 'other', amount: amt[s.id] ?? 0, description: desc[s.id] || undefined }))} disabled={busy || !amt[s.id]}>Add charge</Button>
              {s.status === 'checked_out' && (
                <span className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
                  <input type="number" value={dep[s.id] ?? ''} onChange={(e) => setDep((p) => ({ ...p, [s.id]: Number(e.target.value) }))} placeholder="deposit" style={{ ...i, width: 90 }} aria-label="Deposit applied" />
                  <Button onClick={() => run(() => settleFolio({ stayId: s.id, depositApplied: dep[s.id] ?? 0 }))} disabled={busy}>Settle → invoice</Button>
                </span>
              )}
            </div>
          ) : <span className="text-sm" style={{ color: 'var(--color-success)' }}>✓ Settled</span>}
        </section>
      ))}
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </div>
  );
}
