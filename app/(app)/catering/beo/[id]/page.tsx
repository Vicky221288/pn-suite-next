import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BeoLifecycle } from '@/components/beo-lifecycle';

/** BEO detail — the function sheet + e-sign lifecycle (send → sign; signed = locked). */
export default async function BeoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: beo } = await supabase.from('catering_beos').select('*').eq('id', id).maybeSingle();
  if (!beo) notFound();
  const { data: guest } = await supabase.from('guests').select('id, name, phone').eq('id', beo.guest_id).maybeSingle();
  const { data: lines } = await supabase.from('catering_beo_lines').select('id, name').eq('beo_id', id).order('name');

  const locked = beo.status === 'signed';
  return (
    <div className="flex flex-col gap-5">
      <Link href="/catering/beo" className="text-sm" style={{ color: 'var(--color-brand)' }}>← BEOs</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>
          BEO · <span style={{ textTransform: 'uppercase' }}>{beo.beo_type}</span> v{beo.version}
        </h1>
        <span style={{ color: locked ? 'var(--color-success)' : beo.status === 'sent' ? 'var(--color-brand)' : 'var(--color-text-tertiary)', fontWeight: 600 }}>{beo.status}</span>
      </div>

      <section style={card}>
        <div className="grid gap-2 text-sm" style={{ color: 'var(--color-text-secondary)', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          <span>Guest: <b>{guest?.name ?? '—'}</b>{guest?.phone ? ` (${guest.phone})` : ''}</span>
          <span>Service date: <b>{beo.service_date ?? '—'}</b>{beo.service_time ? ` · ${beo.service_time}` : ''}</span>
          <span>Venue: <b>{beo.venue ?? '—'}</b></span>
          <span>Expected: <b>{beo.guest_count}</b> pax</span>
          <span>Guarantee (billable min): <b>{beo.guest_guarantee}</b> pax</span>
          <span>Event: <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8em' }}>{beo.event_id}</code></span>
        </div>
        {(beo.dietary_flags ?? []).length > 0 && (
          <p className="mt-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Dietary: {(beo.dietary_flags as string[]).map((d) => <span key={d} style={chip}>{d}</span>)}
          </p>
        )}
        {beo.special_instructions && <p className="mt-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>Notes: {beo.special_instructions}</p>}
      </section>

      <section style={card}>
        <h2 style={h2}>Menu (snapshot)</h2>
        {(lines ?? []).length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No lines.</p> : (
          <ul className="flex flex-col text-sm" style={{ color: 'var(--color-text)' }}>
            {(lines ?? []).map((l) => <li key={l.id} className="py-1" style={{ borderBottom: '1px solid var(--color-divider)' }}>{l.name}</li>)}
          </ul>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Lifecycle</h2>
        {locked ? (
          <p className="text-sm" style={{ color: 'var(--color-success)' }}>
            ✓ Signed by <b>{beo.signed_by_name}</b> ({beo.signed_method}) at {beo.signed_at ? new Date(beo.signed_at).toLocaleString('en-IN') : '—'}. This BEO is locked — changes require a new version.
          </p>
        ) : (
          <BeoLifecycle beoId={beo.id} status={beo.status} />
        )}
      </section>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const chip: React.CSSProperties = { display: 'inline-block', marginLeft: 6, padding: '1px 8px', borderRadius: 999, background: 'var(--color-surface-2,#f3e9ea)', fontSize: '0.85em' };
