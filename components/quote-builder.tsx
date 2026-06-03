'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/utils';
import { createQuote } from '@/lib/actions/catering-quote';

interface MenuItem { id: string; name: string; default_selling_price: number }
interface Pkg { id: string; name: string }

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };

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

  // Live per-plate from the current selection (selling only — no cost surfaced).
  const perPlate = pkgId ? null : Object.values(sel).filter((v) => v.on).reduce((s, v) => s + Number(v.price), 0);

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
      <div className="flex flex-wrap items-end" style={{ gap: 'var(--space-3)' }}>
        <label className="flex flex-col" style={{ gap: 2, fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Guests
          <input type="number" min={0} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ ...field, width: 110 }} aria-label="Guest count" />
        </label>
        <label className="flex flex-col" style={{ gap: 2, fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>From package
          <select value={pkgId} onChange={(e) => setPkgId(e.target.value)} style={field} aria-label="Package">
            <option value="">— pick items below —</option>
            {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>

      {!pkgId && (
        <ul className="flex flex-col" style={{ border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {menuItems.map((m) => {
            const on = sel[m.id]?.on ?? false;
            return (
              <li key={m.id} className="flex items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--color-divider)', background: on ? 'var(--color-brand-subtle)' : undefined }}>
                <label className="flex items-center" style={{ gap: 'var(--space-2)', color: 'var(--color-text)', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(m.id)} /> {m.name}
                </label>
                <input type="number" min={0} value={sel[m.id]?.price ?? 0} onChange={(e) => setPrice(m.id, Number(e.target.value))} disabled={!on} style={{ ...field, width: 110 }} aria-label={`${m.name} price`} />
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)' }}>
        <Button onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create quote'}</Button>
        {perPlate != null && perPlate > 0 && (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Per plate <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>{formatINR(perPlate)}</b></span>
        )}
      </div>
      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}
    </div>
  );
}
