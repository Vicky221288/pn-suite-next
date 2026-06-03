import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FileText } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { QuoteBuilder } from '@/components/quote-builder';
import { DetailHeader } from '@/components/ui/detail-header';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoRow } from '@/components/ui/info-row';

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
  const qs = quotes ?? [];

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <DetailHeader
        backHref="/catering/enquiries"
        backLabel="Catering enquiries"
        eyebrow="Catering enquiry"
        title={<span>{enq.contact_name} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>· {enq.event_type ?? '—'}</span></span>}
        status={<StatusBadge status={enq.status} />}
        meta={<span style={{ fontFamily: 'var(--font-mono)' }}>{enq.event_date ?? 'no date'} · {enq.guest_count ?? '—'} pax</span>}
      />

      <div className="grid pn-today-main" style={{ gap: 'var(--space-6)' }}>
        {/* Quote builder — the primary action region */}
        <Card title="Build a quote" subtitle="Pick a package to pre-fill, or check menu items with per-plate prices">
          <QuoteBuilder enquiryId={id} guestCount={enq.guest_count ?? 100} menuItems={menuItems ?? []} packages={packages ?? []} />
        </Card>

        {/* Supporting info */}
        <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
          <Card title="Enquiry">
            <dl className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
              <InfoRow label="Event date" value={enq.event_date ?? '—'} mono />
              <InfoRow label="Guests" value={`${enq.guest_count ?? '—'} pax`} mono />
              <InfoRow label="Status" value={<StatusBadge status={enq.status} />} />
              {guest && <InfoRow label="Guest" value={<Link href={`/guests/${guest.id}`} style={{ color: 'var(--color-brand)', fontWeight: 500 }}>{guest.name}</Link>} />}
              {guest && <InfoRow label="Phone" value={guest.phone} mono tone="muted" />}
            </dl>
          </Card>

          <Card padded={false} title="Quotes" subtitle={`${qs.length} on this enquiry`}>
            {qs.length === 0 ? (
              <EmptyState icon={FileText} title="No quotes yet" message="Build a quote from the menu or a package — it opens for review and can be accepted to generate a BEO." />
            ) : (
              <ul className="flex flex-col">
                {qs.map((q) => (
                  <li key={q.id} className="pn-tr" style={{ position: 'relative', borderBottom: '1px solid var(--color-divider)' }}>
                    <Link href={`/catering/quotes/${q.id}`} className="flex items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) var(--card-pad)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>{q.guest_count} pax</span>
                      <StatusBadge status={q.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
