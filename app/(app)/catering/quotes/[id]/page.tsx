import { notFound } from 'next/navigation';
import { getQuoteSummary } from '@/lib/actions/catering-quote';
import { formatINR } from '@/lib/utils';

interface QLine { menu_item_id: string; name: string; unit_selling_price: number; line_selling: number; line_food_cost: number | null; line_margin: number | null }
interface QSummary { quote_id: string; guest_count: number; status: string; can_see_cost: boolean; total_selling: number; total_food_cost: number | null; total_margin: number | null; lines: QLine[] }

/** Quote summary — selling always; food cost + margin only if permitted (server-gated). */
export default async function QuoteSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getQuoteSummary(id);
  if (!res.ok) notFound();
  const q = res.data as QSummary;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Quote · {q.guest_count} pax</h1>
      <section style={card}>
        <div className="flex flex-wrap gap-5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <span>Status: <b>{q.status}</b></span>
          <span>Selling total: <b>{formatINR(q.total_selling)}</b></span>
          {q.can_see_cost ? (
            <>
              <span>Food cost: <b>{formatINR(q.total_food_cost ?? 0)}</b></span>
              <span>Margin: <b style={{ color: 'var(--color-success)' }}>{formatINR(q.total_margin ?? 0)}</b></span>
            </>
          ) : (
            <span style={{ color: 'var(--color-text-tertiary)' }}>Cost &amp; margin hidden for your role</span>
          )}
        </div>
      </section>
      <section style={card}>
        <h2 style={h2}>Lines (per-plate × {q.guest_count})</h2>
        <ul className="flex flex-col text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {q.lines.map((l) => (
            <li key={l.menu_item_id} className="flex justify-between py-1" style={{ borderBottom: '1px solid var(--color-divider)' }}>
              <span>{l.name} <span style={{ color: 'var(--color-text-tertiary)' }}>@ {formatINR(l.unit_selling_price)}/plate</span></span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {formatINR(l.line_selling)}{q.can_see_cost && l.line_margin != null ? ` · margin ${formatINR(l.line_margin)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
