import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { BeoGenerateForm } from '@/components/beo-generate-form';

interface AcceptedQuote { id: string; guest_count: number; catering_enquiries: { contact_name: string | null; event_date: string | null } | null }
interface BeoRow { id: string; beo_type: string; version: number; status: string; guest_count: number; guest_guarantee: number; service_date: string | null; guests: { name: string } | null }

/** Catering — BEO. Generate from accepted quotes; list BEOs across the shared Events. */
export default async function CateringBeoPage() {
  const supabase = await createClient();
  const { data: accepted } = await supabase
    .from('catering_quotes')
    .select('id, guest_count, catering_enquiries(contact_name, event_date)')
    .eq('status', 'accepted')
    .order('created_at', { ascending: false })
    .limit(50);
  const { data: beos } = await supabase
    .from('catering_beos')
    .select('id, beo_type, version, status, guest_count, guest_guarantee, service_date, guests(name)')
    .order('created_at', { ascending: false })
    .limit(100);

  const quotes = (accepted ?? []) as unknown as AcceptedQuote[];
  const list = (beos ?? []) as unknown as BeoRow[];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Catering — BEO</h1>

      <section style={card}>
        <h2 style={h2}>Generate a BEO from an accepted quote</h2>
        {quotes.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            No accepted quotes. Accept a quote on its quote page first.
          </p>
        ) : (
          <BeoGenerateForm quotes={quotes.map((q) => ({
            id: q.id,
            label: `${q.catering_enquiries?.contact_name ?? 'Guest'} · ${q.catering_enquiries?.event_date ?? 'no date'} · ${q.guest_count} pax`,
            guestCount: q.guest_count,
          }))} />
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Banquet Event Orders</h2>
        {list.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No BEOs yet.</p>
        ) : (
          <ul className="flex flex-col">
            {list.map((b) => (
              <li key={b.id} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <Link href={`/catering/beo/${b.id}`} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span>
                    {b.guests?.name ?? 'Guest'} · <b style={{ textTransform: 'uppercase' }}>{b.beo_type}</b> v{b.version}
                    <span style={{ color: 'var(--color-text-tertiary)' }}> · {b.service_date ?? 'no date'} · {b.guest_count} pax (guar. {b.guest_guarantee})</span>
                  </span>
                  <span style={{ color: statusColor(b.status), fontWeight: 600 }}>{b.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function statusColor(s: string): string {
  if (s === 'signed') return 'var(--color-success)';
  if (s === 'sent') return 'var(--color-brand)';
  return 'var(--color-text-tertiary)';
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
