import Link from 'next/link';
import { ReceiptText } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { InvoiceGenerator } from '@/components/invoice-generator';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';

interface Inv { id: string; invoice_number: string; total: number; amount_due: number | null; status: string; event_id: string | null; issued_at: string }

const invTone = (s: string) => (s === 'paid' ? 'success' : 'info') as 'success' | 'info';

/** Catering — Invoice. Generate a consolidated invoice for an Event; list invoices. */
export default async function InvoicePage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('invoices')
    .select('id, invoice_number, total, amount_due, status, event_id, issued_at')
    .eq('supply_type', 'consolidated')
    .order('issued_at', { ascending: false })
    .limit(100);
  const invoices = (data ?? []) as Inv[];
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Catering"
        title="Consolidated invoice"
        subtitle="One GST invoice spanning hall, rooms/F&B, and catering — the engine resolves each line's rate. The deposit is a separate refundable liability, never taxed."
        meta={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`}
      />

      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        <CreatePanel label="Generate invoice" title="Generate a consolidated invoice for an Event">
          <InvoiceGenerator />
        </CreatePanel>

        <Card padded={false} title="Invoices" subtitle={`${invoices.length} consolidated`}>
          {invoices.length === 0 ? (
            <EmptyState icon={ReceiptText} title="No consolidated invoices yet" message="Compose the billable lines for an Event and generate — the engine resolves each stream's GST rate into one consolidated invoice." />
          ) : (
            <Table>
              <THead>
                <TR><TH>Invoice</TH><TH align="right">Issued</TH><TH align="right">Amount due</TH><TH align="right">Status</TH></TR>
              </THead>
              <tbody>
                {invoices.map((iv) => (
                  <tr key={iv.id} className="pn-tr" style={{ position: 'relative' }}>
                    <TD>
                      <Link href={`/catering/invoice/${iv.id}`} aria-label={`Open ${iv.invoice_number}`} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
                      <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--color-text)' }}>{iv.invoice_number}</span>
                    </TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-tertiary)' }}>{fmt(iv.issued_at)}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(iv.amount_due ?? iv.total)}</span></TD>
                    <TD align="right"><span style={{ position: 'relative', zIndex: 2 }}><Badge tone={invTone(iv.status)}>{iv.status}</Badge></span></TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
