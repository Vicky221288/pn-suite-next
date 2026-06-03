import { notFound } from 'next/navigation';
import { getQuoteSummary } from '@/lib/actions/catering-quote';
import { formatINR } from '@/lib/utils';
import { AcceptQuoteButton } from '@/components/accept-quote-button';
import { DetailHeader } from '@/components/ui/detail-header';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { InfoRow } from '@/components/ui/info-row';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';

interface QLine { menu_item_id: string; name: string; unit_selling_price: number; line_selling: number; line_food_cost: number | null; line_margin: number | null }
interface QSummary { quote_id: string; guest_count: number; status: string; can_see_cost: boolean; total_selling: number; total_food_cost: number | null; total_margin: number | null; lines: QLine[] }

/** Quote summary — selling always; food cost + margin only if permitted (server-gated). */
export default async function QuoteSummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getQuoteSummary(id);
  if (!res.ok) notFound();
  const q = res.data as QSummary;

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <DetailHeader
        backHref="/catering/enquiries"
        backLabel="Catering enquiries"
        eyebrow="Catering quote"
        title={`Quote · ${q.guest_count} pax`}
        status={<StatusBadge status={q.status} />}
        meta={<span style={{ fontFamily: 'var(--font-mono)' }}>{formatINR(q.total_selling)}</span>}
      />

      <div className="grid pn-today-main" style={{ gap: 'var(--space-6)' }}>
        {/* Lines — the dominant left column */}
        <Card padded={false} title="Lines" subtitle={`per-plate × ${q.guest_count}`}>
          <Table>
            <THead>
              <TR><TH>Item</TH><TH align="right">Per plate</TH><TH align="right">Line selling</TH>{q.can_see_cost && <TH align="right">Margin</TH>}</TR>
            </THead>
            <tbody>
              {q.lines.map((l) => (
                <TR key={l.menu_item_id}>
                  <TD><span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{l.name}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-tertiary)' }}>{formatINR(l.unit_selling_price)}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(l.line_selling)}</span></TD>
                  {q.can_see_cost && <TD align="right" mono><span style={{ color: 'var(--color-success)' }}>{l.line_margin != null ? formatINR(l.line_margin) : '—'}</span></TD>}
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>

        {/* Totals + accept */}
        <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
          <Card elevated accent eyebrow="Quote total" title={<span style={{ fontFamily: 'var(--font-mono)' }}>{formatINR(q.total_selling)}</span>}>
            <dl className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
              <InfoRow label="Status" value={<StatusBadge status={q.status} />} />
              <InfoRow label="Selling total" value={formatINR(q.total_selling)} mono strong tone="brand" />
              {q.can_see_cost ? (
                <>
                  <InfoRow label="Food cost" value={formatINR(q.total_food_cost ?? 0)} mono />
                  <InfoRow label="Margin" value={formatINR(q.total_margin ?? 0)} mono strong tone="success" />
                </>
              ) : (
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-1)' }}>Cost &amp; margin are hidden for your role.</p>
              )}
            </dl>
            <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-divider)' }}>
              <AcceptQuoteButton quoteId={q.quote_id} status={q.status} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
