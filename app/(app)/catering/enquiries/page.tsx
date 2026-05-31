import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { NewCateringEnquiryForm } from '@/components/new-catering-enquiry-form';

/** Catering enquiries — RLS-scoped list + create (create-or-links a Guest). */
export default async function CateringEnquiriesPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('catering_enquiries')
    .select('id, event_type, event_date, guest_count, contact_name, contact_phone, status, guest_id')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Catering — Enquiries</h1>
      <section style={card}><h2 style={h2}>New enquiry</h2><NewCateringEnquiryForm /></section>
      <section style={card}>
        <h2 style={h2}>Enquiries</h2>
        {(rows ?? []).length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>None yet.</p> : (
          <ol className="flex flex-col">
            {(rows ?? []).map((e) => (
              <li key={e.id} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <Link href={`/catering/enquiries/${e.id}`} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span>{e.contact_name} · {e.event_type ?? '—'} {e.event_date ? `· ${e.event_date}` : ''}</span>
                  <span style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{e.guest_count ?? '—'} pax · {e.status}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
      <Link href="/catering/packages" className="text-sm" style={{ color: 'var(--color-brand)' }}>Manage packages →</Link>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
