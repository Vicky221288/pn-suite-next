import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { ContractActions } from '@/components/hall-contract-actions';
import { PaymentActions } from '@/components/payment-actions';

/** Hall booking detail — contract (e-sign) + payment milestones. */
export default async function HallBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: booking } = await supabase.from('bookings').select('*').eq('id', id).maybeSingle();
  if (!booking) notFound();
  const { data: contracts } = await supabase.from('hall_contracts').select('id, version, status, contract_value, terms, signed_by_name, signed_at').eq('booking_id', id).order('version', { ascending: false });
  const { data: milestones } = await supabase.from('payment_milestones').select('id, kind, label, amount, due_date, status, paid_at').eq('booking_id', id).order('kind');

  return (
    <div className="flex flex-col gap-5">
      <Link href="/hall" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Hall</Link>
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>{booking.customer_name}</h1>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{booking.event_date} · {booking.slot} · {booking.status} · {formatINR(booking.hall_rent)}</p>

      <section style={card}>
        <h2 style={h2}>Contract</h2>
        <ContractActions bookingId={id} bookingStatus={booking.status} contracts={contracts ?? []} />
      </section>

      <section style={card}>
        <h2 style={h2}>Payment milestones (advance @ confirm · balance T-45)</h2>
        <PaymentActions bookingId={id} hallRent={Number(booking.hall_rent)} milestones={milestones ?? []} />
      </section>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
