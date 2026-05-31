import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { InvoiceGenerator } from '@/components/invoice-generator';

interface Inv { id: string; invoice_number: string; total: number; amount_due: number | null; status: string; event_id: string | null; issued_at: string }

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

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Catering — Consolidated Invoice</h1>

      <section style={card}>
        <h2 style={h2}>Generate a consolidated invoice for an Event</h2>
        <InvoiceGenerator />
      </section>

      <section style={card}>
        <h2 style={h2}>Invoices</h2>
        {invoices.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No consolidated invoices yet.</p> : (
          <ul className="flex flex-col">
            {invoices.map((iv) => (
              <li key={iv.id} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <Link href={`/catering/invoice/${iv.id}`} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span>{iv.invoice_number} <span style={{ color: 'var(--color-text-tertiary)' }}>· due {formatINR(iv.amount_due ?? iv.total)}</span></span>
                  <span style={{ color: iv.status === 'paid' ? 'var(--color-success)' : 'var(--color-brand)', fontWeight: 600 }}>{iv.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
