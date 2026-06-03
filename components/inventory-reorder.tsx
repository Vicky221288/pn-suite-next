'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert, PackageCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import { setReorderPoint } from '@/lib/actions/inventory';

interface Item { id: string; name: string; unit: string; quantity_on_hand: number; reorder_point: number | null; reorder_qty: number | null; supplier_id: string | null }
interface PoLine { item_id: string; name: string; quantity: number; unit: string | null }
interface Po { id: string; supplier_id: string | null; status: string; source: string; created_at: string; purchase_order_lines: PoLine[] }

const cfg: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 10px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)', width: 90 };
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

  const shortCount = items.filter(isShort).length;

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}

      {/* Auto-drafted reorder POs */}
      <Card padded={false} title="Auto-drafted reorder POs" subtitle="Raised by the reorder rule when on-hand falls to the point · drafts only — order &amp; receive in purchasing">
        {draftPos.length === 0 ? (
          <EmptyState icon={PackageCheck} title="No reorder drafts" message="When a monitored item drops to its reorder point, the rule drafts a supplier PO here automatically." />
        ) : (
          <ul className="flex flex-col">
            {draftPos.map((po) => (
              <li key={po.id} style={{ padding: 'var(--space-3) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
                <div className="flex items-center justify-between" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                  <span className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>Draft PO</span>
                    <Badge tone="warning">draft</Badge>
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{po.purchase_order_lines.length} line{po.purchase_order_lines.length === 1 ? '' : 's'} · {new Date(po.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })}</span>
                </div>
                <ul className="flex flex-col" style={{ gap: 2, paddingLeft: 'var(--space-3)' }}>
                  {po.purchase_order_lines.map((l, i) => (
                    <li key={i} className="flex items-center justify-between" style={{ fontSize: 'var(--text-xs)' }}>
                      <span style={{ color: 'var(--color-text-secondary)' }}>{l.name}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{l.quantity} {l.unit ?? ''}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Items + reorder config */}
      <Card padded={false} title="Items &amp; reorder config" subtitle={`${items.length} items · ${shortCount} short · no reorder point = not monitored`}>
        {items.length === 0 ? (
          <EmptyState icon={PackageCheck} title="No inventory items" message="Items appear here from the shared inventory. Set a reorder point + qty to opt one into monitoring." />
        ) : (
          <Table>
            <THead>
              <TR><TH>Item</TH><TH align="right">On-hand</TH><TH align="right">Point</TH><TH align="right">Reorder qty</TH><TH align="right">Status</TH>{canManage && <TH align="right">Configure</TH>}</TR>
            </THead>
            <tbody>
              {items.map((it) => {
                const monitored = it.reorder_point !== null;
                const short = isShort(it);
                return (
                  <TR key={it.id}>
                    <TD><span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{it.name}</span></TD>
                    <TD align="right" mono><span style={{ color: short ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>{Number(it.quantity_on_hand)} {it.unit}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-tertiary)' }}>{monitored ? Number(it.reorder_point) : '—'}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-tertiary)' }}>{it.reorder_qty ?? '—'}</span></TD>
                    <TD align="right"><Badge tone={!monitored ? 'neutral' : short ? 'danger' : 'success'}>{!monitored ? 'not monitored' : short ? 'short' : 'ok'}</Badge></TD>
                    {canManage && (
                      <TD align="right">
                        <span className="inline-flex items-center justify-end" style={{ gap: 'var(--space-2)' }}>
                          <input value={pt[it.id] ?? (it.reorder_point ?? '')} onChange={(e) => setPt((p) => ({ ...p, [it.id]: e.target.value }))} placeholder="point" style={cfg} aria-label={`${it.name} reorder point`} />
                          <input value={qty[it.id] ?? (it.reorder_qty ?? '')} onChange={(e) => setQty((p) => ({ ...p, [it.id]: e.target.value }))} placeholder="qty" style={cfg} aria-label={`${it.name} reorder qty`} />
                          <Button variant="secondary" onClick={() => save(it.id)} disabled={busy}>Save</Button>
                        </span>
                      </TD>
                    )}
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
