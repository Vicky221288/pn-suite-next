import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getInvoice } from '@/lib/actions/catering-invoice';
import { formatINR } from '@/lib/utils';
import { SettleInvoiceButton } from '@/components/settle-invoice-button';

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
    <div className="flex flex-col gap-5">
      <Link href="/catering/invoice" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Invoices</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>{invoice.invoice_number}</h1>
        <span style={{ color: paid ? 'var(--color-success)' : 'var(--color-brand)', fontWeight: 600 }}>{invoice.status}</span>
      </div>

      <section style={card}>
        <h2 style={h2}>Lines</h2>
        <table className="w-full text-sm">
          <thead><tr style={{ color: 'var(--color-text-tertiary)', textAlign: 'left' }}>
            <th>Supply</th><th>SAC</th><th>Taxable</th><th>Rate</th><th>CGST</th><th>SGST</th><th>Total</th>
          </tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <td className="py-1">{l.stream}{l.billed_count != null ? <span style={{ color: 'var(--color-text-tertiary)' }}> ·{l.billed_count} pax</span> : null}</td>
                <td style={mono}>{l.sac_code}</td>
                <td style={mono}>{formatINR(l.taxable_value)}</td>
                <td style={mono}>{l.gst_rate}%{l.itc ? ' w/ITC' : ''}</td>
                <td style={mono}>{formatINR(l.cgst)}</td>
                <td style={mono}>{formatINR(l.sgst)}</td>
                <td style={mono}>{formatINR(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h2 style={h2}>Tax summary (per rate)</h2>
        <table className="w-full text-sm">
          <thead><tr style={{ color: 'var(--color-text-tertiary)', textAlign: 'left' }}><th>Rate</th><th>Taxable</th><th>CGST</th><th>SGST</th></tr></thead>
          <tbody>
            {(invoice.tax_summary ?? []).map((t) => (
              <tr key={t.gst_rate} style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <td className="py-1">{t.gst_rate}%{t.itc ? ' w/ITC' : ' no-ITC'}</td>
                <td style={mono}>{formatINR(t.taxable)}</td>
                <td style={mono}>{formatINR(t.cgst)}</td>
                <td style={mono}>{formatINR(t.sgst)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <div className="flex flex-col gap-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <div className="flex justify-between"><span>Subtotal</span><span style={mono}>{formatINR(invoice.subtotal)}</span></div>
          <div className="flex justify-between"><span>CGST + SGST</span><span style={mono}>{formatINR(invoice.cgst + invoice.sgst)}</span></div>
          <div className="flex justify-between" style={{ color: 'var(--color-text)', fontWeight: 600 }}><span>Total</span><span style={mono}>{formatINR(invoice.total)}</span></div>
          <div className="flex justify-between"><span>Less: deposit applied (escrowed — not taxed)</span><span style={mono}>− {formatINR(invoice.deposit_applied)}</span></div>
          <div className="flex justify-between" style={{ color: 'var(--color-text)', fontWeight: 600 }}><span>Amount due</span><span style={mono}>{formatINR(invoice.amount_due ?? invoice.total)}</span></div>
        </div>
      </section>

      {!paid && (
        <section style={card}>
          <h2 style={h2}>Settle</h2>
          <SettleInvoiceButton invoiceId={invoice.id} />
          <p className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Posts revenue per stream to the ledger; deposit is discharged against balance (or forfeited → taxable income). Owner/PM only.</p>
        </section>
      )}
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
