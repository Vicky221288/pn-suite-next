import { notFound } from 'next/navigation';
import { getInvoice } from '@/lib/actions/catering-invoice';
import { formatINR } from '@/lib/utils';
import { SettleInvoiceButton } from '@/components/settle-invoice-button';
import { DetailHeader } from '@/components/ui/detail-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { InfoRow } from '@/components/ui/info-row';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';

interface Line { id: string; stream: string; description: string | null; sac_code: string; taxable_value: number; billed_count: number | null; gst_rate: number; itc: boolean; cgst: number; sgst: number; line_total: number }
interface TaxRow { gst_rate: number; itc: boolean; taxable: number; cgst: number; sgst: number }
interface Invoice { id: string; invoice_number: string; subtotal: number; cgst: number; sgst: number; total: number; deposit_applied: number; amount_due: number | null; status: string; tax_summary: TaxRow[] | null }

/** Consolidated invoice detail — per-line + multi-rate tax summary + deposit + due. */
export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getInvoice(id);
  if (!res.ok) notFound();
  const { invoice, lines } = res.data as { invoice: Invoice; lines: Line[] };
  const paid = invoice.status === 'paid';

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <DetailHeader
        backHref="/catering/invoice"
        backLabel="Invoices"
        eyebrow="Catering · Consolidated GST invoice"
        title={<span style={{ fontFamily: 'var(--font-mono)' }}>{invoice.invoice_number}</span>}
        status={<Badge tone={paid ? 'success' : 'info'}>{invoice.status}</Badge>}
        meta={<span style={{ fontFamily: 'var(--font-mono)' }}>due {formatINR(invoice.amount_due ?? invoice.total)}</span>}
      />

      {/* Lines */}
      <Card padded={false} title="Lines" subtitle="per supply stream — rate resolved by the engine">
        <Table>
          <THead>
            <TR><TH>Supply</TH><TH>SAC</TH><TH align="right">Taxable</TH><TH align="right">Rate</TH><TH align="right">CGST</TH><TH align="right">SGST</TH><TH align="right">Total</TH></TR>
          </THead>
          <tbody>
            {lines.map((l) => (
              <TR key={l.id}>
                <TD>
                  <span style={{ fontWeight: 500, color: 'var(--color-text)', textTransform: 'capitalize' }}>{l.stream.replace(/_/g, ' ')}</span>
                  {l.billed_count != null && <span style={{ display: 'block', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{l.billed_count} pax</span>}
                </TD>
                <TD mono><span style={{ color: 'var(--color-text-tertiary)' }}>{l.sac_code}</span></TD>
                <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(l.taxable_value)}</span></TD>
                <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{l.gst_rate}%{l.itc ? ' w/ITC' : ''}</span></TD>
                <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(l.cgst)}</span></TD>
                <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(l.sgst)}</span></TD>
                <TD align="right" mono><span style={{ color: 'var(--color-text)' }}>{formatINR(l.line_total)}</span></TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="grid pn-today-main" style={{ gap: 'var(--space-6)' }}>
        {/* Tax summary per rate */}
        <Card padded={false} title="Tax summary" subtitle="grouped per rate">
          <Table>
            <THead>
              <TR><TH>Rate</TH><TH align="right">Taxable</TH><TH align="right">CGST</TH><TH align="right">SGST</TH></TR>
            </THead>
            <tbody>
              {(invoice.tax_summary ?? []).map((t) => (
                <TR key={t.gst_rate}>
                  <TD><span style={{ color: 'var(--color-text)' }}>{t.gst_rate}%<span style={{ color: 'var(--color-text-tertiary)' }}>{t.itc ? ' w/ITC' : ' no-ITC'}</span></span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(t.taxable)}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(t.cgst)}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(t.sgst)}</span></TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>

        {/* Totals + settle */}
        <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
          <Card elevated accent eyebrow="Amount due" title={<span style={{ fontFamily: 'var(--font-mono)' }}>{formatINR(invoice.amount_due ?? invoice.total)}</span>}>
            <dl className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
              <InfoRow label="Subtotal" value={formatINR(invoice.subtotal)} mono />
              <InfoRow label="CGST + SGST" value={formatINR(invoice.cgst + invoice.sgst)} mono tone="muted" />
              <InfoRow label="Total" value={formatINR(invoice.total)} mono strong />
              <InfoRow label="Less: deposit applied" value={`− ${formatINR(invoice.deposit_applied)}`} mono tone="muted" />
              <InfoRow label="Amount due" value={formatINR(invoice.amount_due ?? invoice.total)} mono strong tone="brand" />
            </dl>
            <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>The deposit is escrowed — not a revenue line and never taxed.</p>
          </Card>

          {!paid && (
            <Card title="Settle" subtitle="Owner / PM only">
              <SettleInvoiceButton invoiceId={invoice.id} />
              <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Posts revenue per stream to the ledger; the deposit is discharged against balance, or forfeited → taxable income.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
