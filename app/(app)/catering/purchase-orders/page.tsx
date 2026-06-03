import { PackageCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { formatINR } from '@/lib/utils';
import { PoActions } from '@/components/po-actions';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';

interface PoLine { id: string; name: string; quantity: number; unit: string | null }
interface Po { id: string; status: string; created_at: string; vendors: { name: string } | null; purchase_order_lines: PoLine[] }

const poTone = (s: string) => (s === 'received' ? 'success' : s === 'ordered' ? 'info' : 'neutral') as 'success' | 'info' | 'neutral';

/** Catering — Purchase Orders. draft → ordered → received (receive = stock IN). */
export default async function PurchaseOrdersPage() {
  const supabase = await createClient();
  const ctx = await getRoleContext();
  // unit_cost is NOT read directly (KL-1: locked column) — fetched via the capability-gated po_line_costs RPC
  const { data } = await supabase
    .from('purchase_orders')
    .select('id, status, created_at, vendors(name), purchase_order_lines(id, name, quantity, unit)')
    .order('created_at', { ascending: false })
    .limit(100);
  const pos = (data ?? []) as unknown as Po[];
  const { data: costData } = await supabase.rpc('po_line_costs', { p_org: ctx?.orgId });
  const costs = new Map<string, number>(((costData?.costs ?? []) as { line_id: string; unit_cost: number }[]).map((c) => [c.line_id, c.unit_cost]));

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Catering"
        title="Purchase orders"
        subtitle="Procurement grouped by supplier — planned from kitchen tickets. Mark ordered when placed, receive to bring stock in."
        meta={`${pos.length} order${pos.length === 1 ? '' : 's'}`}
      />

      {pos.length === 0 ? (
        <Card>
          <EmptyState icon={PackageCheck} title="No purchase orders" message="Plan a purchase from a kitchen ticket to draft supplier POs here, then move each draft → ordered → received." />
        </Card>
      ) : (
        <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
          {pos.map((po) => (
            <Card
              key={po.id}
              padded={false}
              title={po.vendors?.name ?? 'Unassigned supplier'}
              actions={<Badge tone={poTone(po.status)}>{po.status}</Badge>}
            >
              <Table>
                <THead>
                  <TR><TH>Item</TH><TH align="right">Quantity</TH>{costs.size > 0 && <TH align="right">Unit cost</TH>}</TR>
                </THead>
                <tbody>
                  {po.purchase_order_lines.map((l) => (
                    <TR key={l.id}>
                      <TD><span style={{ color: 'var(--color-text)' }}>{l.name}</span></TD>
                      <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{l.quantity} {l.unit}</span></TD>
                      {costs.size > 0 && <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{costs.has(l.id) ? `${formatINR(costs.get(l.id)!)}/${l.unit}` : '—'}</span></TD>}
                    </TR>
                  ))}
                </tbody>
              </Table>
              <div style={{ padding: 'var(--space-4) var(--card-pad)', borderTop: '1px solid var(--color-divider)' }}>
                <PoActions poId={po.id} status={po.status} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
