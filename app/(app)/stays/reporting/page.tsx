import Link from 'next/link';
import { getStaysReport } from '@/lib/actions/stays';
import { formatINR } from '@/lib/utils';
import { ReportRange } from '@/components/report-range';

interface Report { can_see_revenue: boolean; nights: number; total_rooms: number; available_room_nights: number; sold_room_nights: number; occupancy_pct: number; room_revenue: number | null; adr: number | null; revpar: number | null; revenue_by_stream: Record<string, number> | null }

/** Stays — reporting: occupancy / ADR / RevPAR over a date range. */
export default async function ReportingPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const to = sp.to ?? '2099-12-31';
  const from = sp.from ?? '2099-01-01';
  const res = await getStaysReport(from, to);
  const r = res.ok ? (res.data as Report) : null;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/stays" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Rooms</Link>
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Stays — Reporting</h1>
      <ReportRange from={from} to={to} />
      {!r ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No data.</p> : (
        <section style={card}>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            <Stat label="Occupancy" value={`${r.occupancy_pct}%`} />
            <Stat label="Sold / available nights" value={`${r.sold_room_nights} / ${r.available_room_nights}`} />
            <Stat label="ADR" value={r.can_see_revenue ? formatINR(r.adr ?? 0) : '— (gated)'} />
            <Stat label="RevPAR" value={r.can_see_revenue ? formatINR(r.revpar ?? 0) : '— (gated)'} />
            <Stat label="Room revenue" value={r.can_see_revenue ? formatINR(r.room_revenue ?? 0) : '— (gated)'} />
          </div>
          {r.can_see_revenue && r.revenue_by_stream && (
            <p className="mt-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Revenue by stream: {Object.entries(r.revenue_by_stream).map(([k, v]) => `${k} ${formatINR(v)}`).join(' · ') || '—'}
            </p>
          )}
        </section>
      )}
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
