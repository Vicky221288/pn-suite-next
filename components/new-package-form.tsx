'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { upsertPackage } from '@/lib/actions/catering-quote';

interface MenuItem { id: string; name: string; default_selling_price: number }

/** Create a reusable package = named menu+price template. */
export function NewPackageForm({ menuItems }: { menuItems: MenuItem[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [sel, setSel] = useState<Record<string, { on: boolean; price: number }>>(
    Object.fromEntries(menuItems.map((m) => [m.id, { on: false, price: m.default_selling_price }])),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = (id: string) => setSel((p) => ({ ...p, [id]: { on: !(p[id]?.on ?? false), price: p[id]?.price ?? 0 } }));
  const setPrice = (id: string, price: number) => setSel((p) => ({ ...p, [id]: { on: p[id]?.on ?? false, price } }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const items = Object.entries(sel).filter(([, v]) => v.on).map(([menuItemId, v]) => ({ menuItemId, unitSellingPrice: v.price }));
    const res = await upsertPackage({ name, items });
    setBusy(false);
    if (res.ok) { setName(''); setSel(Object.fromEntries(menuItems.map((m) => [m.id, { on: false, price: m.default_selling_price }]))); router.refresh(); }
    else setMsg(`${res.error}: ${res.message}`);
  }
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Package name" required style={i} aria-label="Package name" />
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
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save package'}</Button>
        {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
      </div>
    </form>
  );
}
