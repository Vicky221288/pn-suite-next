import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRoleContext } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { CAP } from '@/lib/auth/capabilities';
import { SliceActions } from '@/components/slice-actions';

/** Lead detail — the thread (quote → booking → event → invoice) + transitions. */
export default async function EnquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getRoleContext();
  const supabase = await createClient();

  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).maybeSingle();
  if (!lead) notFound();

  const { data: booking } = await supabase
    .from('bookings').select('id, event_date, slot, status, hall_rent').eq('lead_id', id).maybeSingle();
  const { data: hall } = await supabase.from('halls').select('id').limit(1).maybeSingle();
  const invoice = booking
    ? (await supabase.from('invoices').select('invoice_number, subtotal, cgst, sgst, total, gst_rate, sac_code').eq('booking_id', booking.id).maybeSingle()).data
    : null;
  const deposit = booking
    ? (await supabase.from('deposit_ledger').select('amount, entry_type, status, is_liability').eq('booking_id', booking.id).order('created_at')).data
    : [];

  const canSettle = (ctx?.role && ['owner', 'property_manager'].includes(ctx.role)) || (ctx?.capabilities?.includes?.(CAP.SETTLEMENT_PROCESS) ?? false);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/enquiries" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Enquiries</Link>
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>{lead.name ?? lead.phone}</h1>
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{lead.status}{lead.escalated_at ? ' · SLA-escalated' : ''}</span>
      </div>

      <section style={card}>
        <h2 style={h2}>Drive the thread</h2>
        <SliceActions leadId={lead.id} hallId={hall?.id ?? null} bookingId={booking?.id ?? null} settled={booking?.status === 'settled'} canSettle={!!canSettle} />
      </section>

      <section style={card}>
        <h2 style={h2}>Booking</h2>
        {booking ? (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {booking.event_date} · {booking.slot} · {formatINR(booking.hall_rent)} · <b>{booking.status}</b>
          </p>
        ) : <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Not booked yet.</p>}
        {(deposit ?? []).length > 0 && (
          <ul className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {(deposit ?? []).map((d, i) => (
              <li key={i}>{d.entry_type}: {formatINR(d.amount)} · {d.status} · {d.is_liability ? 'liability' : 'discharged'}</li>
            ))}
          </ul>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Tax invoice</h2>
        {invoice ? (
          <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <div style={{ fontFamily: 'var(--font-mono)' }}>{invoice.invoice_number} · SAC {invoice.sac_code} · {invoice.gst_rate}% composite</div>
            <div className="mt-1">Taxable {formatINR(invoice.subtotal)} + CGST {formatINR(invoice.cgst)} + SGST {formatINR(invoice.sgst)} = <b>{formatINR(invoice.total)}</b></div>
            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Deposit is a separate refundable liability — not in this invoice.</div>
          </div>
        ) : <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Not settled yet.</p>}
      </section>
    </div>
  );
}

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.5rem' } as React.CSSProperties;
