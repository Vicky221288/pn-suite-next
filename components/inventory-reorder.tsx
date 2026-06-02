'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { setReorderPoint } from '@/lib/actions/inventory';

interface Item { id: string; name: string; unit: string; quantity_on_hand: number; reorder_point: number | null; reorder_qty: number | null; supplier_id: string | null }
interface PoLine { item_id: string; name: string; quantity: number; unit: string | null }
interface Po { id: string; supplier_id: string | null; status: string; source: string; created_at: string; purchase_order_lines: PoLine[] }

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const inp: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)', width: 90 };
const isShort = (it: Item) => it.reorder_point !== null && Number(it.quantity_on_hand) <= Number(it.reorder_point);

export function InventoryReorder({ items, draftPos, canManage }: { items: Item[]; draftPos: Po[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pt, setPt] = useState<Record<string, string>>({});
  const [qty, setQty] = useState<Record<string, string>>({});

  async function save(itemId: string) {
    setBusy(true); setMsg(null);
    const rp = pt[itemId] === '' || pt[itemId] === undefined ? null : Number(pt[itemId]);
    const res = await setReorderPoint({ itemId, reorderPoint: rp, reorderQty: rp === null ? undefined : Number(qty[itemId] || 0) });
    setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }

  return (
    <div className="flex flex-col gap-5">
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}

      {/* Reorder dashboard: draft reorder POs */}
      <section style={card}>
        <h2 style={h2}>Auto-drafted reorder POs (below threshold)</h2>
        {draftPos.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No reorder drafts.</p> : (
          <ul className="flex flex-col">
            {draftPos.map((po) => (
              <li key={po.id} className="py-2 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span><b>Draft PO</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· {po.purchase_order_lines.length} line(s) · raised {new Date(po.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</span></span>
                <ul className="pl-3 mt-1">
                  {po.purchase_order_lines.map((l, i) => <li key={i} className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{l.name} · {l.quantity} {l.unit ?? ''}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Drafts only — order &amp; receive them in purchasing.</p>
      </section>

      {/* Per-item reorder config */}
      <section style={card}>
        <h2 style={h2}>Items &amp; reorder config</h2>
        <ul className="flex flex-col">
          {items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
              <span>
                <b>{it.name}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· on-hand {Number(it.quantity_on_hand)} {it.unit}</span>
                {it.reorder_point !== null && <span style={{ color: isShort(it) ? 'var(--color-danger)' : 'var(--color-text-tertiary)' }}> · reorder@{Number(it.reorder_point)} (qty {it.reorder_qty ?? '—'}){isShort(it) ? ' · SHORT' : ''}</span>}
                {it.reorder_point === null && <span style={{ color: 'var(--color-text-tertiary)' }}> · not monitored</span>}
              </span>
              {canManage && (
                <span className="flex items-center gap-2">
                  <input value={pt[it.id] ?? (it.reorder_point ?? '')} onChange={(e) => setPt((p) => ({ ...p, [it.id]: e.target.value }))} placeholder="point" style={inp} aria-label="Reorder point" />
                  <input value={qty[it.id] ?? (it.reorder_qty ?? '')} onChange={(e) => setQty((p) => ({ ...p, [it.id]: e.target.value }))} placeholder="qty" style={inp} aria-label="Reorder qty" />
                  <Button onClick={() => save(it.id)} disabled={busy}>Save</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
