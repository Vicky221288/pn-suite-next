import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { QuoteBuilder } from '@/components/quote-builder';

/** Enquiry detail + Guest + quote builder + this enquiry's quotes. */
export default async function CateringEnquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: enq } = await supabase.from('catering_enquiries').select('*').eq('id', id).maybeSingle();
  if (!enq) notFound();
  const { data: guest } = await supabase.from('guests').select('id, name, phone').eq('id', enq.guest_id).maybeSingle();
  const { data: menuItems } = await supabase.from('catering_menu_items').select('id, name, default_selling_price').eq('active', true).order('name');
  const { data: packages } = await supabase.from('catering_packages').select('id, name').eq('active', true).order('name');
  const { data: quotes } = await supabase.from('catering_quotes').select('id, guest_count, status, created_at').eq('enquiry_id', id).order('created_at', { ascending: false });

  return (
    <div className="flex flex-col gap-5">
      <Link href="/catering/enquiries" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Enquiries</Link>
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>{enq.contact_name} · {enq.event_type ?? '—'}</h1>
      <section style={card}>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {enq.event_date ?? 'no date'} · {enq.guest_count ?? '—'} pax · status {enq.status}
          {guest && <> · Guest: <Link href={`/guests/${guest.id}`} style={{ color: 'var(--color-brand)' }}>{guest.name} ({guest.phone})</Link></>}
        </p>
      </section>
      <section style={card}>
        <h2 style={h2}>Build a quote</h2>
        <QuoteBuilder enquiryId={id} guestCount={enq.guest_count ?? 100} menuItems={menuItems ?? []} packages={packages ?? []} />
      </section>
      <section style={card}>
        <h2 style={h2}>Quotes</h2>
        {(quotes ?? []).length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No quotes yet.</p> : (
          <ul className="flex flex-col">
            {(quotes ?? []).map((q) => (
              <li key={q.id} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <Link href={`/catering/quotes/${q.id}`} className="flex justify-between py-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span>{q.guest_count} pax · {q.status}</span><span style={{ color: 'var(--color-text-tertiary)' }}>view →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
