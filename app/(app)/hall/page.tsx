import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getHallAnalytics } from '@/lib/actions/hall';
import { formatINR } from '@/lib/utils';

interface Analytics { can_see_revenue: boolean; bookings_by_status: Record<string, number>; occupancy_by_slot: Record<string, number>; realized_hall_revenue: number | null; pipeline_value: number | null }

/** Hall hub — revenue analytics + recent bookings/events (the W2 surface). */
export default async function HallPage() {
  const supabase = await createClient();
  const res = await getHallAnalytics();
  const a = res.ok ? (res.data as Analytics) : null;
  const { data: bookings } = await supabase.from('bookings').select('id, customer_name, event_date, slot, status, hall_rent').order('event_date', { ascending: false }).limit(20);
  const { data: events } = await supabase.from('events').select('id, event_date, slot, status').order('event_date', { ascending: false }).limit(20);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Hall</h1>

      <section style={card}>
        <h2 style={h2}>Revenue analytics</h2>
        {!a ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Unavailable.</p> : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
            <Stat label="Realized hall revenue" value={a.can_see_revenue ? formatINR(a.realized_hall_revenue ?? 0) : '— (gated)'} />
            <Stat label="Pipeline" value={a.can_see_revenue ? formatINR(a.pipeline_value ?? 0) : '— (gated)'} />
            <Stat label="Bookings" value={String(Object.values(a.bookings_by_status).reduce((x, y) => x + y, 0))} />
            <Stat label="By slot" value={Object.entries(a.occupancy_by_slot).map(([k, v]) => `${k}:${v}`).join('  ') || '—'} />
          </div>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Bookings</h2>
        {(bookings ?? []).length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No bookings.</p> : (
          <ul className="flex flex-col">
            {(bookings ?? []).map((b) => (
              <li key={b.id} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <Link href={`/hall/bookings/${b.id}`} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span>{b.customer_name} <span style={{ color: 'var(--color-text-tertiary)' }}>· {b.event_date} · {b.slot}</span></span>
                  <span style={{ color: 'var(--color-text-tertiary)' }}>{b.status} · {formatINR(b.hall_rent)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Events (day ops)</h2>
        {(events ?? []).length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No events.</p> : (
          <ul className="flex flex-col">
            {(events ?? []).map((e) => (
              <li key={e.id} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <Link href={`/hall/events/${e.id}`} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span>{e.event_date} · {e.slot ?? '—'}</span><span style={{ color: 'var(--color-text-tertiary)' }}>{e.status} · ops →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--color-divider)', borderRadius: 8, padding: '10px 12px' }}>
      <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div className="text-lg" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>{value}</div>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
