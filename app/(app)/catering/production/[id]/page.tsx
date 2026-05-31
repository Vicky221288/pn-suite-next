import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProductionVariance } from '@/lib/actions/catering-production';
import { formatINR } from '@/lib/utils';
import { PlanPurchaseButton, CloseProductionButton } from '@/components/production-actions';

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
    <div className="flex flex-col gap-5">
      <Link href="/catering/production" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Production</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>{ticket.label ?? ticket.source_type}</h1>
        <span style={{ color: closed ? 'var(--color-success)' : 'var(--color-brand)', fontWeight: 600 }}>{ticket.status}</span>
      </div>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{ticket.source_type} · {ticket.billable_count} portions</p>

      <section style={card}>
        <h2 style={h2}>Dishes</h2>
        <ul className="flex flex-col text-sm" style={{ color: 'var(--color-text)' }}>
          {(tlines ?? []).map((l) => <li key={l.id} className="flex justify-between py-1" style={{ borderBottom: '1px solid var(--color-divider)' }}><span>{l.name}</span><span style={{ color: 'var(--color-text-tertiary)' }}>{l.portion_count} portions</span></li>)}
        </ul>
      </section>

      <section style={card}>
        <h2 style={h2}>Ingredient requirement {v?.can_see_cost ? '(planned vs actual)' : ''}</h2>
        <table className="w-full text-sm">
          <thead><tr style={{ color: 'var(--color-text-tertiary)', textAlign: 'left' }}>
            <th>Ingredient</th><th>Planned</th><th>Actual</th>{v?.can_see_cost && <><th>Variance</th><th>Var. cost</th></>}
          </tr></thead>
          <tbody>
            {(v?.lines ?? []).map((l) => (
              <tr key={l.item_id} style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <td className="py-1">{l.name}</td>
                <td style={mono}>{l.planned_quantity} {l.unit}</td>
                <td style={mono}>{l.actual_quantity ?? '—'}</td>
                {v?.can_see_cost && <>
                  <td style={{ ...mono, color: (l.variance_quantity ?? 0) > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>{l.variance_quantity ?? '—'}</td>
                  <td style={mono}>{l.variance_cost != null ? formatINR(l.variance_cost) : '—'}</td>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
        {v && !v.can_see_cost && <p className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Variance &amp; cost hidden for your role.</p>}
      </section>

      {!closed && (
        <section style={card}>
          <h2 style={h2}>Actions</h2>
          <div className="flex flex-wrap items-center gap-3">
            <PlanPurchaseButton ticketId={id} />
            <CloseProductionButton ticketId={id} />
          </div>
          <p className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Closing consumes the planned quantities from inventory (over-draw is rejected).</p>
        </section>
      )}
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
