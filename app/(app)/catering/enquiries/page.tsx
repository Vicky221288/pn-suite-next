import Link from 'next/link';
import { ChefHat, CalendarClock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { NewCateringEnquiryForm } from '@/components/new-catering-enquiry-form';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';

/** Catering enquiries — RLS-scoped list + create (create-or-links a Guest). */
export default async function CateringEnquiriesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('catering_enquiries')
    .select('id, event_type, event_date, guest_count, contact_name, contact_phone, status, guest_id')
    .order('created_at', { ascending: false })
    .limit(100);
  const rows = data ?? [];

  // Derived from the SAME fetched rows (no extra query).
  const istToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const upcoming = rows.filter((e) => e.event_date && e.event_date >= istToday).length;
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '—');

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Catering"
        title="Enquiries"
        subtitle="Every catering lead from first contact through quote and acceptance — newest first. Each enquiry links a shared guest record."
        meta={`${rows.length} shown`}
      />

      {rows.length > 0 && (
        <div className="grid" style={{ gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 'var(--space-6)' }}>
          <StatCard label="Enquiries" value={String(rows.length)} icon={ChefHat} delay={0} hint="shown · newest first" />
          <StatCard label="Upcoming events" value={String(upcoming)} icon={CalendarClock} tone={upcoming ? 'brand' : 'default'} delay={70} hint="event date today or later" />
        </div>
      )}

      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        <CreatePanel label="New enquiry" title="Capture a catering enquiry">
          <NewCateringEnquiryForm />
        </CreatePanel>

        <Card padded={false} title="Enquiries" subtitle={`${rows.length} record${rows.length === 1 ? '' : 's'}`}>
          {rows.length === 0 ? (
            <EmptyState icon={ChefHat} title="No enquiries yet" message="Capture a catering lead — contact, event type, date, and headcount — to start the quote pipeline. A shared guest record is created or linked automatically.">
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Use <b style={{ color: 'var(--color-text-secondary)' }}>New enquiry</b> above.</span>
            </EmptyState>
          ) : (
            <Table>
              <THead>
                <TR><TH>Contact</TH><TH>Event</TH><TH align="right">Date</TH><TH align="right">Guests</TH><TH align="right">Status</TH></TR>
              </THead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="pn-tr" style={{ position: 'relative' }}>
                    <TD>
                      <Link href={`/catering/enquiries/${e.id}`} aria-label={`Open ${e.contact_name}`} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
                      <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{e.contact_name}</span>
                      <span style={{ display: 'block', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{e.contact_phone}</span>
                    </TD>
                    <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{e.event_type ?? '—'}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(e.event_date)}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{e.guest_count ?? '—'}</span></TD>
                    <TD align="right">
                      <span style={{ position: 'relative', zIndex: 2 }}><StatusBadge status={e.status} /></span>
                    </TD>
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
