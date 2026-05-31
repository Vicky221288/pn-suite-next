import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { GenerateProductionButton } from '@/components/production-actions';

interface SignedBeo { id: string; beo_type: string; version: number; guest_count: number; guest_guarantee: number; service_date: string | null; guests: { name: string } | null }
interface Ticket { id: string; source_type: string; label: string | null; billable_count: number; status: string; created_at: string }

/** Catering — Production. Generate KOT from signed BEOs; list kitchen tickets. */
export default async function ProductionPage() {
  const supabase = await createClient();
  const { data: signed } = await supabase
    .from('catering_beos')
    .select('id, beo_type, version, guest_count, guest_guarantee, service_date, guests(name)')
    .eq('status', 'signed')
    .order('created_at', { ascending: false })
    .limit(50);
  const { data: tickets } = await supabase
    .from('kitchen_tickets')
    .select('id, source_type, label, billable_count, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const beos = (signed ?? []) as unknown as SignedBeo[];
  const list = (tickets ?? []) as unknown as Ticket[];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Catering — Production</h1>

      <section style={card}>
        <h2 style={h2}>Generate a KOT from a signed BEO</h2>
        {beos.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No signed BEOs. Sign a BEO first.</p>
        ) : (
          <ul className="flex flex-col">
            {beos.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ borderBottom: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span>
                  {b.guests?.name ?? 'Guest'} · <b style={{ textTransform: 'uppercase' }}>{b.beo_type}</b> v{b.version}
                  <span style={{ color: 'var(--color-text-tertiary)' }}> · {b.service_date ?? 'no date'} · produce for {Math.max(b.guest_count, b.guest_guarantee)} (max of {b.guest_count}/{b.guest_guarantee})</span>
                </span>
                <GenerateProductionButton beoId={b.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Kitchen tickets</h2>
        {list.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No tickets yet.</p> : (
          <ul className="flex flex-col">
            {list.map((t) => (
              <li key={t.id} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <Link href={`/catering/production/${t.id}`} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span>{t.label ?? t.source_type} <span style={{ color: 'var(--color-text-tertiary)' }}>· {t.source_type} · {t.billable_count} portions</span></span>
                  <span style={{ color: t.status === 'closed' ? 'var(--color-success)' : 'var(--color-brand)', fontWeight: 600 }}>{t.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/catering/purchase-orders" className="text-sm" style={{ color: 'var(--color-brand)' }}>Purchase orders →</Link>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
