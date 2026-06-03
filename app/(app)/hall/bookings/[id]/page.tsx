import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { ContractActions } from '@/components/hall-contract-actions';
import { PaymentActions } from '@/components/payment-actions';
import { DetailHeader } from '@/components/ui/detail-header';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';

/** Hall booking detail — contract (e-sign) + payment milestones. */
export default async function HallBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: booking } = await supabase.from('bookings').select('*').eq('id', id).maybeSingle();
  if (!booking) notFound();
  const { data: contracts } = await supabase.from('hall_contracts').select('id, version, status, contract_value, terms, signed_by_name, signed_at').eq('booking_id', id).order('version', { ascending: false });
  const { data: milestones } = await supabase.from('payment_milestones').select('id, kind, label, amount, due_date, status, paid_at').eq('booking_id', id).order('kind');

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <DetailHeader
        backHref="/hall"
        backLabel="Hall"
        eyebrow="Hall · Booking"
        title={booking.customer_name}
        status={<StatusBadge status={booking.status} />}
        meta={<span style={{ fontFamily: 'var(--font-mono)' }}>{booking.event_date} · {(booking.slot ?? '—').replace(/_/g, ' ')} · {formatINR(booking.hall_rent)}</span>}
      />

      <Card title="Contract" subtitle="Draft → Sent → Signed · signed is immutable (a new version supersedes)">
        <ContractActions bookingId={id} bookingStatus={booking.status} contracts={contracts ?? []} />
      </Card>

      <Card title="Payment milestones" subtitle="Advance @ confirm · balance due T-45">
        <PaymentActions bookingId={id} hallRent={Number(booking.hall_rent)} milestones={milestones ?? []} />
      </Card>
    </div>
  );
}
