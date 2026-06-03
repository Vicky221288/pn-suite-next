import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProductionVariance } from '@/lib/actions/catering-production';
import { formatINR } from '@/lib/utils';
import { PlanPurchaseButton, CloseProductionButton } from '@/components/production-actions';
import { DetailHeader } from '@/components/ui/detail-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';

interface VLine { item_id: string; name: string; unit: string; planned_quantity: number; actual_quantity: number | null; variance_quantity: number | null; unit_cost: number | null; planned_cost: number | null; actual_cost: number | null; variance_cost: number | null }
interface Variance { ticket_id: string; can_see_cost: boolean; lines: VLine[] }

/** Kitchen ticket detail — requirement, variance (gated), plan-PO + close. */
export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: ticket } = await supabase.from('kitchen_tickets').select('*').eq('id', id).maybeSingle();
  if (!ticket) notFound();
  const { data: tlines } = await supabase.from('kitchen_ticket_lines').select('id, name, portion_count').eq('ticket_id', id).order('name');
  const res = await getProductionVariance(id);
  const v = res.ok ? (res.data as Variance) : null;
  const closed = ticket.status === 'closed';

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <DetailHeader
        backHref="/catering/production"
        backLabel="Production"
        eyebrow="Catering · Kitchen ticket"
        title={ticket.label ?? ticket.source_type}
        status={<Badge tone={closed ? 'success' : 'info'}>{ticket.status}</Badge>}
        meta={<span style={{ fontFamily: 'var(--font-mono)' }}>{ticket.source_type} · {ticket.billable_count} portions</span>}
      />

      {!closed && (
        <Card elevated accent eyebrow="Actions" title="Plan & close">
          <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-3)' }}>
            <PlanPurchaseButton ticketId={id} />
            <CloseProductionButton ticketId={id} />
          </div>
          <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Closing consumes the planned quantities from inventory (over-draw is rejected).</p>
        </Card>
      )}

      <div className="grid pn-today-main" style={{ gap: 'var(--space-6)' }}>
        {/* Ingredient requirement — dominant */}
        <Card padded={false} title="Ingredient requirement" subtitle={v?.can_see_cost ? 'planned vs actual · cost variance' : 'planned quantities'}>
          <Table>
            <THead>
              <TR>
                <TH>Ingredient</TH><TH align="right">Planned</TH><TH align="right">Actual</TH>
                {v?.can_see_cost && <><TH align="right">Variance</TH><TH align="right">Var. cost</TH></>}
              </TR>
            </THead>
            <tbody>
              {(v?.lines ?? []).map((l) => (
                <TR key={l.item_id}>
                  <TD><span style={{ color: 'var(--color-text)' }}>{l.name}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{l.planned_quantity} {l.unit}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{l.actual_quantity ?? '—'}</span></TD>
                  {v?.can_see_cost && <>
                    <TD align="right" mono><span style={{ color: (l.variance_quantity ?? 0) > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>{l.variance_quantity ?? '—'}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{l.variance_cost != null ? formatINR(l.variance_cost) : '—'}</span></TD>
                  </>}
                </TR>
              ))}
            </tbody>
          </Table>
          {v && !v.can_see_cost && <p style={{ padding: 'var(--space-3) var(--card-pad)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Variance &amp; cost are hidden for your role.</p>}
        </Card>

        {/* Dishes */}
        <Card padded={false} title="Dishes">
          <ul className="flex flex-col">
            {(tlines ?? []).map((l) => (
              <li key={l.id} className="flex items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>{l.name}</span>
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{l.portion_count} portions</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
