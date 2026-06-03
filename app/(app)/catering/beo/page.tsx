import Link from 'next/link';
import { FileSignature } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { BeoGenerateForm } from '@/components/beo-generate-form';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';

interface AcceptedQuote { id: string; guest_count: number; catering_enquiries: { contact_name: string | null; event_date: string | null } | null }
interface BeoRow { id: string; beo_type: string; version: number; status: string; guest_count: number; guest_guarantee: number; service_date: string | null; guests: { name: string } | null }

const beoTone = (s: string) => (s === 'signed' ? 'success' : s === 'sent' ? 'info' : 'neutral') as 'success' | 'info' | 'neutral';

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
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Catering"
        title="Banquet Event Orders"
        subtitle="The function sheet each event runs on — generated from an accepted quote, sent for signature, then locked. Kitchen and FOH each get their own BEO."
        meta={`${list.length} BEO${list.length === 1 ? '' : 's'}`}
      />

      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        <CreatePanel label="Generate BEO" title="Generate from an accepted quote">
          {quotes.length === 0 ? (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>No accepted quotes yet — accept a quote on its quote page first.</p>
          ) : (
            <BeoGenerateForm quotes={quotes.map((q) => ({
              id: q.id,
              label: `${q.catering_enquiries?.contact_name ?? 'Guest'} · ${q.catering_enquiries?.event_date ?? 'no date'} · ${q.guest_count} pax`,
              guestCount: q.guest_count,
            }))} />
          )}
        </CreatePanel>

        <Card padded={false} title="Banquet Event Orders" subtitle={`${list.length} document${list.length === 1 ? '' : 's'}`}>
          {list.length === 0 ? (
            <EmptyState icon={FileSignature} title="No BEOs yet" message="Generate a BEO from an accepted quote. It captures the menu snapshot, guest guarantee, and service details, then moves draft → sent → signed." />
          ) : (
            <Table>
              <THead>
                <TR><TH>Guest</TH><TH>Type</TH><TH align="right">Ver</TH><TH align="right">Guests</TH><TH align="right">Service date</TH><TH align="right">Status</TH></TR>
              </THead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id} className="pn-tr" style={{ position: 'relative' }}>
                    <TD>
                      <Link href={`/catering/beo/${b.id}`} aria-label={`Open BEO for ${b.guests?.name ?? 'Guest'}`} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
                      <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{b.guests?.name ?? 'Guest'}</span>
                    </TD>
                    <TD><span style={{ position: 'relative', zIndex: 2 }}><Badge tone="neutral">{b.beo_type}</Badge></span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-tertiary)' }}>v{b.version}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{b.guest_count}<span style={{ color: 'var(--color-text-tertiary)' }}> / {b.guest_guarantee}</span></span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{b.service_date ?? '—'}</span></TD>
                    <TD align="right"><span style={{ position: 'relative', zIndex: 2 }}><Badge tone={beoTone(b.status)}>{b.status}</Badge></span></TD>
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
