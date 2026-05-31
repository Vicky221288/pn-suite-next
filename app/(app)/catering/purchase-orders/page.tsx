import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { PoActions } from '@/components/po-actions';

interface PoLine { id: string; name: string; quantity: number; unit: string | null; unit_cost: number }
interface Po { id: string; status: string; created_at: string; vendors: { name: string } | null; purchase_order_lines: PoLine[] }

/** Catering — Purchase Orders. draft → ordered → received (receive = stock IN). */
export default async function PurchaseOrdersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('purchase_orders')
    .select('id, status, created_at, vendors(name), purchase_order_lines(id, name, quantity, unit, unit_cost)')
    .order('created_at', { ascending: false })
    .limit(100);
  const pos = (data ?? []) as unknown as Po[];

  return (
    <div className="flex flex-col gap-5">
      <Link href="/catering/production" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Production</Link>
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Catering — Purchase Orders</h1>

      {pos.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No purchase orders. Plan a purchase from a kitchen ticket.</p> : (
        <ul className="flex flex-col gap-3">
          {pos.map((po) => (
            <li key={po.id} style={card}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{po.vendors?.name ?? 'Unassigned supplier'}</h2>
                <span style={{ color: po.status === 'received' ? 'var(--color-success)' : po.status === 'ordered' ? 'var(--color-brand)' : 'var(--color-text-tertiary)', fontWeight: 600 }}>{po.status}</span>
              </div>
              <ul className="my-2 flex flex-col text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {po.purchase_order_lines.map((l) => (
                  <li key={l.id} className="flex justify-between py-0.5">
                    <span>{l.name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{l.quantity} {l.unit} · {formatINR(l.unit_cost)}/{l.unit}</span>
                  </li>
                ))}
              </ul>
              <PoActions poId={po.id} status={po.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
