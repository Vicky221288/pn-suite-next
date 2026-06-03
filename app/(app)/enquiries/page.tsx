import Link from 'next/link';
import { Inbox, TriangleAlert, Trophy, Workflow } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { NewEnquiryForm } from '@/components/new-enquiry-form';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import { Badge, StatusBadge } from '@/components/ui/badge';

/** Enquiries list — RLS-scoped reads (a member sees only their org's leads). */
export default async function EnquiriesPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('leads')
    .select('id, name, phone, function_area, status, escalated_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  const leads = data ?? [];

  // Derived from the SAME fetched rows (no extra query).
  const openCount = leads.filter((l) => ['new', 'qualifying', 'quoted'].includes(l.status)).length;
  const slaCount = leads.filter((l) => l.escalated_at).length;
  const wonCount = leads.filter((l) => l.status === 'won').length;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <PageHeader
        eyebrow="Pipeline"
        title="Enquiries"
        subtitle="Every enquiry from first contact through quote, booking, and settlement — newest first."
        meta={`${leads.length} shown`}
      />

      {leads.length > 0 && (
        <div className="grid" style={{ gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <StatCard label="Open enquiries" value={String(openCount)} icon={Inbox} delay={0} hint="new · qualifying · quoted" />
          <StatCard label="Awaiting follow-up" value={String(slaCount)} icon={TriangleAlert} tone={slaCount ? 'danger' : 'success'} delay={70} hint={slaCount ? 'SLA-flagged' : 'all on track'} />
          <StatCard label="Won" value={String(wonCount)} icon={Trophy} tone="success" delay={140} hint="converted to booking" />
        </div>
      )}

      <CreatePanel label="New enquiry" title="Capture a new enquiry">
        <NewEnquiryForm />
      </CreatePanel>

      <Card padded={false} title="All enquiries" subtitle={`${leads.length} record${leads.length === 1 ? '' : 's'}`}>
        {leads.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title="No enquiries yet"
            message="When a guest reaches out — by phone, WhatsApp, or walk-in — capture it here to start the pipeline. The first acknowledgement is sent automatically."
          >
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Use <b style={{ color: 'var(--color-text-secondary)' }}>New enquiry</b> above to add the first one.</span>
          </EmptyState>
        ) : (
          <Table>
            <THead>
              <TR><TH>Guest</TH><TH>Domain</TH><TH align="right">Created</TH><TH align="right">Status</TH></TR>
            </THead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="pn-tr" style={{ position: 'relative' }}>
                  <TD>
                    <Link href={`/enquiries/${l.id}`} aria-label={`Open ${l.name ?? l.phone}`} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
                    <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{l.name ?? '—'}</span>
                    <span style={{ display: 'block', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{l.phone}</span>
                  </TD>
                  <TD>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{l.function_area === 'stays' ? 'Stays' : 'Hall / Catering'}</span>
                  </TD>
                  <TD align="right" mono>
                    <span style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(l.created_at)}</span>
                  </TD>
                  <TD align="right">
                    <span className="inline-flex items-center" style={{ gap: 'var(--space-2)', position: 'relative', zIndex: 2 }}>
                      {l.escalated_at && <Badge tone="danger">SLA</Badge>}
                      <StatusBadge status={l.status} />
                    </span>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
