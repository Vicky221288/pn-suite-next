import Link from 'next/link';
import { IndianRupee, TrendingUp, CalendarRange, CalendarCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getHallAnalytics } from '@/lib/actions/hall';
import { formatINR } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { InfoRow } from '@/components/ui/info-row';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';

interface Analytics { can_see_revenue: boolean; bookings_by_status: Record<string, number>; occupancy_by_slot: Record<string, number>; realized_hall_revenue: number | null; pipeline_value: number | null }

/** Hall hub — revenue analytics + recent bookings/events (the W2 surface). */
export default async function HallPage() {
  const supabase = await createClient();
  const res = await getHallAnalytics();
  const a = res.ok ? (res.data as Analytics) : null;
  const { data: bookings } = await supabase.from('bookings').select('id, customer_name, event_date, slot, status, hall_rent').order('event_date', { ascending: false }).limit(20);
  const { data: events } = await supabase.from('events').select('id, event_date, slot, status').order('event_date', { ascending: false }).limit(20);

  const bookingsTotal = a ? Object.values(a.bookings_by_status).reduce((x, y) => x + y, 0) : 0;
  const byStatus = a ? Object.entries(a.bookings_by_status) : [];
  const bySlot = a ? Object.entries(a.occupancy_by_slot) : [];

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Hall"
        title="Hall"
        subtitle="Revenue, pipeline, and the booking-to-event floor at a glance — open any booking for its contract and payments, or any event for day-of ops."
        meta={a ? `${bookingsTotal} booking${bookingsTotal === 1 ? '' : 's'}` : undefined}
      />

      {a && (
        <div className="grid" style={{ gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', marginBottom: 'var(--space-6)' }}>
          <StatCard label="Realized hall revenue" value={a.can_see_revenue ? formatINR(a.realized_hall_revenue ?? 0) : '—'} icon={IndianRupee} tone={a.can_see_revenue ? 'brand' : 'default'} mono delay={0} hint={a.can_see_revenue ? 'settled hall rent' : 'restricted for your role'} />
          <StatCard label="Pipeline" value={a.can_see_revenue ? formatINR(a.pipeline_value ?? 0) : '—'} icon={TrendingUp} mono delay={70} hint={a.can_see_revenue ? 'confirmed, not settled' : 'restricted for your role'} />
          <StatCard label="Bookings" value={String(bookingsTotal)} icon={CalendarRange} delay={140} hint="across all statuses" />
          <StatCard label="Events" value={String((events ?? []).length)} icon={CalendarCheck} delay={210} hint="recent · day ops" />
        </div>
      )}

      {a && (byStatus.length > 0 || bySlot.length > 0) && (
        <div className="grid" style={{ gap: 'var(--space-6)', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginBottom: 'var(--space-6)' }}>
          <Card title="Bookings by status">
            <dl className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
              {byStatus.length === 0 ? <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>No bookings yet.</p>
                : byStatus.map(([k, v]) => <InfoRow key={k} label={<StatusBadge status={k} />} value={String(v)} mono />)}
            </dl>
          </Card>
          <Card title="Occupancy by slot">
            <dl className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
              {bySlot.length === 0 ? <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>No occupancy yet.</p>
                : bySlot.map(([k, v]) => <InfoRow key={k} label={k.replace(/_/g, ' ')} value={String(v)} mono />)}
            </dl>
          </Card>
        </div>
      )}

      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        <Card padded={false} title="Bookings" subtitle={`${(bookings ?? []).length} recent`}>
          {(bookings ?? []).length === 0 ? (
            <EmptyState icon={CalendarRange} title="No bookings" message="Confirmed enquiries become bookings here — each carries a contract and a payment schedule." />
          ) : (
            <Table>
              <THead>
                <TR><TH>Guest</TH><TH align="right">Date</TH><TH>Slot</TH><TH align="right">Hall rent</TH><TH align="right">Status</TH></TR>
              </THead>
              <tbody>
                {(bookings ?? []).map((b) => (
                  <tr key={b.id} className="pn-tr" style={{ position: 'relative' }}>
                    <TD>
                      <Link href={`/hall/bookings/${b.id}`} aria-label={`Open booking for ${b.customer_name}`} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
                      <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{b.customer_name}</span>
                    </TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{b.event_date}</span></TD>
                    <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{(b.slot ?? '—').replace(/_/g, ' ')}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(b.hall_rent)}</span></TD>
                    <TD align="right"><span style={{ position: 'relative', zIndex: 2 }}><StatusBadge status={b.status} /></span></TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card padded={false} title="Events" subtitle={`${(events ?? []).length} recent · day ops`}>
          {(events ?? []).length === 0 ? (
            <EmptyState icon={CalendarCheck} title="No events" message="A confirmed booking spins up an event for day-of execution — roster, checklists, and vendor coordination." />
          ) : (
            <Table>
              <THead>
                <TR><TH align="right">Date</TH><TH>Slot</TH><TH align="right">Status</TH></TR>
              </THead>
              <tbody>
                {(events ?? []).map((e) => (
                  <tr key={e.id} className="pn-tr" style={{ position: 'relative' }}>
                    <TD align="right" mono>
                      <Link href={`/hall/events/${e.id}`} aria-label={`Open event ${e.event_date}`} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
                      <span style={{ color: 'var(--color-text)' }}>{e.event_date}</span>
                    </TD>
                    <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{(e.slot ?? '—').replace(/_/g, ' ')}</span></TD>
                    <TD align="right"><span style={{ position: 'relative', zIndex: 2 }}><StatusBadge status={e.status} /></span></TD>
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
