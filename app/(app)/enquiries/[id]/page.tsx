import { notFound } from 'next/navigation';
import { getRoleContext } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { CAP } from '@/lib/auth/capabilities';
import { SliceActions } from '@/components/slice-actions';
import { DetailHeader } from '@/components/ui/detail-header';
import { Steps, type Step } from '@/components/ui/steps';
import { Card } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';

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
    ? (await supabase.from('deposit_ledger').select('amount, entry_type, status, is_liability').eq('booking_id', booking.id).order('created_at')).data ?? []
    : [];

  const canSettle = (ctx?.role && ['owner', 'property_manager'].includes(ctx.role)) || (ctx?.capabilities?.includes?.(CAP.SETTLEMENT_PROCESS) ?? false);

  // Spine stage — derived from the data already fetched (no extra query).
  const hasQuote = !!booking || ['quoted', 'won'].includes(lead.status);
  const hasBooking = !!booking;
  const isSettled = booking?.status === 'settled' || !!invoice;
  const flags = [true, hasQuote, hasBooking, isSettled];
  let current = false;
  const steps: Step[] = ['Enquiry', 'Quote', 'Booking', 'Settled'].map((label, i) => {
    if (flags[i]) return { label, state: 'done' };
    if (!current) { current = true; return { label, state: 'current' }; }
    return { label, state: 'todo' };
  });
  const created = new Date(lead.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <DetailHeader
        backHref="/enquiries"
        backLabel="Enquiries"
        eyebrow={lead.function_area === 'stays' ? 'Stays enquiry' : 'Hall / Catering enquiry'}
        title={lead.name ?? lead.phone}
        meta={<span style={{ fontFamily: 'var(--font-mono)' }}>{lead.phone} · {created}</span>}
        status={
          <span className="inline-flex items-center" style={{ gap: 'var(--space-2)' }}>
            {lead.escalated_at && <Badge tone="danger">SLA breach</Badge>}
            <StatusBadge status={lead.status} />
          </span>
        }
      />

      {/* Spine status — dominant */}
      <Card elevated accent eyebrow="Pipeline status" title="Enquiry → Quote → Booking → Settlement">
        <Steps steps={steps} />
      </Card>

      <div className="grid pn-today-main" style={{ gap: 'var(--space-6)' }}>
        {/* Primary action region */}
        <Card title="Next actions" subtitle="Drive the thread forward">
          <SliceActions leadId={lead.id} hallId={hall?.id ?? null} bookingId={booking?.id ?? null} settled={booking?.status === 'settled'} canSettle={!!canSettle} />
        </Card>

        {/* Supporting info */}
        <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
          <Card title="Booking" actions={booking ? <StatusBadge status={booking.status} /> : undefined}>
            {booking ? (
              <dl className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
                <Row k="Event date" v={booking.event_date} mono />
                <Row k="Slot" v={booking.slot.replace(/_/g, ' ')} />
                <Row k="Hall rent" v={formatINR(booking.hall_rent)} mono />
                {deposit.map((d, i) => (
                  <Row key={i} k={d.entry_type.replace(/_/g, ' ')} v={`${formatINR(d.amount)} · ${d.is_liability ? 'liability' : 'discharged'}`} mono muted />
                ))}
              </dl>
            ) : (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Not booked yet — confirm a booking from <b style={{ color: 'var(--color-text-secondary)' }}>Next actions</b> to hold the date and escrow the 50% deposit.</p>
            )}
          </Card>

          <Card title="Tax invoice" subtitle="Composite GST — SAC 9963">
            {invoice ? (
              <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>{invoice.invoice_number} · {invoice.gst_rate}%</div>
                <dl className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
                  <Row k="Taxable" v={formatINR(invoice.subtotal)} mono />
                  <Row k="CGST" v={formatINR(invoice.cgst)} mono muted />
                  <Row k="SGST" v={formatINR(invoice.sgst)} mono muted />
                  <Row k="Total" v={formatINR(invoice.total)} mono strong />
                </dl>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-1)' }}>The deposit is a separate refundable liability — never part of this invoice.</p>
              </div>
            ) : (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Not settled yet. Settling generates the composite-5% GST invoice and resolves the deposit.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, mono, muted, strong }: { k: string; v: string; mono?: boolean; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-4)' }}>
      <dt style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>{k}</dt>
      <dd style={{ fontSize: 'var(--text-sm)', fontWeight: strong ? 700 : 500, fontFamily: mono ? 'var(--font-mono)' : undefined, color: muted ? 'var(--color-text-tertiary)' : 'var(--color-text)' }}>{v}</dd>
    </div>
  );
}
