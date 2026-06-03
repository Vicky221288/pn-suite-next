import Link from 'next/link';
import { ChefHat, Soup } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { GenerateProductionButton } from '@/components/production-actions';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';

interface SignedBeo { id: string; beo_type: string; version: number; guest_count: number; guest_guarantee: number; service_date: string | null; guests: { name: string } | null }
interface Ticket { id: string; source_type: string; label: string | null; billable_count: number; status: string; created_at: string }

const ticketTone = (s: string) => (s === 'closed' ? 'success' : 'info') as 'success' | 'info';

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
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Catering"
        title="Production"
        subtitle="Generate a kitchen ticket (KOT) from a signed BEO, plan purchases for any shortfall, then close to consume ingredients from inventory."
        meta={`${list.length} ticket${list.length === 1 ? '' : 's'}`}
      />

      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        <Card padded={false} title="Generate a KOT" subtitle="from a signed BEO">
          {beos.length === 0 ? (
            <EmptyState icon={ChefHat} title="No signed BEOs" message="Sign a BEO first — production runs from the signed function sheet, producing for the greater of expected or guaranteed pax." />
          ) : (
            <ul className="flex flex-col">
              {beos.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
                  <div className="min-w-0 flex items-center" style={{ gap: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{b.guests?.name ?? 'Guest'}</span>
                    <Badge tone="neutral">{b.beo_type}</Badge>
                    <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>v{b.version} · {b.service_date ?? 'no date'} · produce {Math.max(b.guest_count, b.guest_guarantee)}</span>
                  </div>
                  <GenerateProductionButton beoId={b.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padded={false} title="Kitchen tickets" subtitle={`${list.length} ticket${list.length === 1 ? '' : 's'}`}>
          {list.length === 0 ? (
            <EmptyState icon={Soup} title="No tickets yet" message="A kitchen ticket appears here once generated from a signed BEO — open one to see the ingredient requirement and close it." />
          ) : (
            <Table>
              <THead>
                <TR><TH>Ticket</TH><TH>Source</TH><TH align="right">Portions</TH><TH align="right">Created</TH><TH align="right">Status</TH></TR>
              </THead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id} className="pn-tr" style={{ position: 'relative' }}>
                    <TD>
                      <Link href={`/catering/production/${t.id}`} aria-label={`Open ${t.label ?? t.source_type}`} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
                      <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{t.label ?? t.source_type}</span>
                    </TD>
                    <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{t.source_type}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{t.billable_count}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-tertiary)' }}>{fmt(t.created_at)}</span></TD>
                    <TD align="right"><span style={{ position: 'relative', zIndex: 2 }}><Badge tone={ticketTone(t.status)}>{t.status}</Badge></span></TD>
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
