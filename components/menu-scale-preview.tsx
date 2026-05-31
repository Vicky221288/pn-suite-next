'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { previewScale } from '@/lib/actions/catering';
import { formatINR } from '@/lib/utils';

interface ScaleLine { inventory_item_id: string; name: string; unit: string; scaled_quantity: number; line_cost: number | null }
interface ScaleResult { has_recipe: boolean; batches: number | null; can_see_cost: boolean; per_plate_cost: number | null; total_food_cost: number | null; lines: ScaleLine[] }

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
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input type="number" min={0} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Guest count"
          style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)', width: 120 }} />
        <Button onClick={run} disabled={busy}>{busy ? 'Scaling…' : 'Scale preview'}</Button>
      </div>
      {msg && <p className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</p>}
      {res && !res.has_recipe && <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No recipe — bought-in item (nothing to scale).</p>}
      {res && res.has_recipe && (
        <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <div className="mb-2 flex flex-wrap gap-4">
            {res.can_see_cost ? (
              <>
                <span>Per-plate food cost: <b>{formatINR(res.per_plate_cost ?? 0)}</b></span>
                <span>Total at {count}: <b>{formatINR(res.total_food_cost ?? 0)}</b></span>
              </>
            ) : <span style={{ color: 'var(--color-text-tertiary)' }}>Food cost hidden for your role</span>}
            {res.batches != null && <span>Batches: <b>{res.batches}</b></span>}
          </div>
          <ul className="flex flex-col">
            {res.lines.map((l) => (
              <li key={l.inventory_item_id} className="flex justify-between py-1" style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <span>{l.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{l.scaled_quantity} {l.unit}{l.line_cost != null ? ` · ${formatINR(l.line_cost)}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
