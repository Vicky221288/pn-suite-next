import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { CAP } from '@/lib/auth/capabilities';
import { getGuestLtv } from '@/lib/actions/crm';
import { MergeGuestButton } from '@/components/merge-guest-button';
import { GuestCrm } from '@/components/guest-crm';

/** Guest detail + CRM enrichment (timeline, special dates, live LTV, B3 send). */
export default async function GuestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getRoleContext();
  const supabase = await createClient();
  const { data: g } = await supabase.from('guests').select('*').eq('id', id).maybeSingle();
  if (!g) notFound();

  // family/duplicate candidates: other active guests on the same phone
  const { data: sharers } = await supabase
    .from('guests').select('id, name').eq('phone', g.phone).eq('status', 'active').neq('id', id);

  const [{ data: interactions }, { data: specialDates }, { data: templates }, { data: reviews }, ltv] = await Promise.all([
    supabase.from('guest_interactions').select('id, interaction_type, channel, note, occurred_at').eq('guest_id', id).order('occurred_at', { ascending: false }).limit(50),
    supabase.from('guest_special_dates').select('id, date_type, the_date, label').eq('guest_id', id).order('the_date'),
    supabase.from('message_templates').select('id, name, function_area, channel, body').eq('active', true).order('name'),
    supabase.from('review_requests').select('id, event_id, status, requested_at').eq('guest_id', id).order('created_at', { ascending: false }),
    getGuestLtv(id),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/guests" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Guests</Link>
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>{g.name}</h1>

      <section style={card}>
        <dl className="grid gap-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <Row k="Phone" v={g.phone} mono />
          <Row k="Email" v={g.email ?? '—'} />
          <Row k="Address" v={g.address ?? '—'} />
          <Row k="Dietary" v={(g.dietary_flags ?? []).join(', ') || '—'} />
          <Row k="Status" v={g.status + (g.merged_into_id ? ` → ${g.merged_into_id}` : '')} />
        </dl>
      </section>

      <section style={card}>
        <h2 style={h2}>Same-phone guests (possible duplicates)</h2>
        {(sharers ?? []).length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>None — this phone has only this active guest.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(sharers ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                <span><Link href={`/guests/${s.id}`} style={{ color: 'var(--color-text)' }}>{s.name}</Link></span>
                {/* keep THIS guest, merge the other into it */}
                <MergeGuestButton keepId={id} mergeId={s.id} label={s.name} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          Merge only when they&apos;re truly the same person — family members on one phone should stay distinct.
        </p>
      </section>

      <GuestCrm
        guestId={id}
        interactions={(interactions ?? []) as never}
        specialDates={(specialDates ?? []) as never}
        templates={(templates ?? []) as never}
        reviews={(reviews ?? []) as never}
        ltv={(ltv.ok ? ltv.data : { can_see: false, ltv: null }) as never}
        canManage={(ctx?.capabilities ?? []).includes(CAP.CRM_MANAGE)}
      />
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt style={{ color: 'var(--color-text-tertiary)', width: 90 }}>{k}</dt>
      <dd style={mono ? { fontFamily: 'var(--font-mono)' } : undefined}>{v}</dd>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
