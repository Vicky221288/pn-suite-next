'use client';
import { useState } from 'react';
import { Users, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import { previewScale } from '@/lib/actions/catering';
import { formatINR } from '@/lib/utils';

interface ScaleLine { inventory_item_id: string; name: string; unit: string; scaled_quantity: number; line_cost: number | null }
interface ScaleResult { has_recipe: boolean; batches: number | null; can_see_cost: boolean; per_plate_cost: number | null; total_food_cost: number | null; lines: ScaleLine[] }

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)', width: 120 };

/** Enter a guest count → scaled ingredient list + total food cost (the defining feature). */
export function MenuScalePreview({ menuItemId }: { menuItemId: string }) {
  const [count, setCount] = useState(500);
  const [res, setRes] = useState<ScaleResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true); setMsg(null);
    const r = await previewScale({ menuItemId, guestCount: count });
    setBusy(false);
    if (r.ok) { setRes(r.data as ScaleResult); setMsg(null); } else { setRes(null); setMsg(`${r.error}: ${r.message}`); }
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
      <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
        <span className="inline-flex items-center" style={{ gap: 6, color: 'var(--color-text-tertiary)' }}><Users size={15} /></span>
        <input type="number" min={0} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Guest count" placeholder="Guests" style={field} />
        <Button onClick={run} disabled={busy}>{busy ? 'Scaling…' : 'Scale preview'}</Button>
      </div>

      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}

      {res && !res.has_recipe && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>No recipe — bought-in item (nothing to scale).</p>}

      {res && res.has_recipe && (
        <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
          <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
            {res.can_see_cost ? (
              <>
                <Badge tone="brand">Per plate {formatINR(res.per_plate_cost ?? 0)}</Badge>
                <Badge tone="brand">Total at {count} · {formatINR(res.total_food_cost ?? 0)}</Badge>
              </>
            ) : (
              <Badge tone="neutral">Food cost hidden for your role</Badge>
            )}
            {res.batches != null && <Badge tone="neutral">{res.batches} batch{res.batches === 1 ? '' : 'es'}</Badge>}
          </div>
          <Table>
            <THead>
              <TR><TH>Ingredient</TH><TH align="right">Scaled qty</TH>{res.can_see_cost && <TH align="right">Line cost</TH>}</TR>
            </THead>
            <tbody>
              {res.lines.map((l) => (
                <TR key={l.inventory_item_id}>
                  <TD><span style={{ color: 'var(--color-text)' }}>{l.name}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{l.scaled_quantity} {l.unit}</span></TD>
                  {res.can_see_cost && <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{l.line_cost != null ? formatINR(l.line_cost) : '—'}</span></TD>}
                </TR>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
