'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createQuote } from '@/lib/actions/catering-quote';

interface MenuItem { id: string; name: string; default_selling_price: number }
interface Pkg { id: string; name: string }

/** Build a quote: pick a package (pre-fill) OR check menu items with prices. */
export function QuoteBuilder({ enquiryId, guestCount, menuItems, packages }: { enquiryId: string; guestCount: number; menuItems: MenuItem[]; packages: Pkg[] }) {
  const router = useRouter();
  const [count, setCount] = useState(guestCount || 100);
  const [pkgId, setPkgId] = useState('');
  const [sel, setSel] = useState<Record<string, { on: boolean; price: number }>>(
    Object.fromEntries(menuItems.map((m) => [m.id, { on: false, price: m.default_selling_price }])),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = (id: string) => setSel((p) => ({ ...p, [id]: { on: !(p[id]?.on ?? false), price: p[id]?.price ?? 0 } }));
  const setPrice = (id: string, price: number) => setSel((p) => ({ ...p, [id]: { on: p[id]?.on ?? false, price } }));

  async function submit() {
    setBusy(true); setMsg(null);
    const lines = pkgId ? [] : Object.entries(sel).filter(([, v]) => v.on).map(([menuItemId, v]) => ({ menuItemId, unitSellingPrice: v.price }));
    const res = await createQuote({ enquiryId, guestCount: count, lines, packageId: pkgId || undefined });
    setBusy(false);
    if (res.ok) router.push(`/catering/quotes/${(res.data as { quote_id: string }).quote_id}`);
    else setMsg(`${res.error}: ${res.message}`);
  }
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Guests</label>
        <input type="number" min={0} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ ...i, width: 100 }} aria-label="Guest count" />
        <label className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>From package</label>
        <select value={pkgId} onChange={(e) => setPkgId(e.target.value)} style={i} aria-label="Package">
          <option value="">— pick items below —</option>
          {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {!pkgId && (
        <ul className="flex flex-col">
          {menuItems.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-1 text-sm" style={{ borderBottom: '1px solid var(--color-divider)' }}>
              <label className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={sel[m.id]?.on ?? false} onChange={() => toggle(m.id)} /> {m.name}
              </label>
              <input type="number" min={0} value={sel[m.id]?.price ?? 0} onChange={(e) => setPrice(m.id, Number(e.target.value))} disabled={!sel[m.id]?.on} style={{ ...i, width: 110 }} aria-label={`${m.name} price`} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create quote'}</Button>
        {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
      </div>
    </div>
  );
}
