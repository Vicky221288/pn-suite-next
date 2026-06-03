import { notFound } from 'next/navigation';
import { Lock, UtensilsCrossed } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { BeoLifecycle } from '@/components/beo-lifecycle';
import { DetailHeader } from '@/components/ui/detail-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoRow } from '@/components/ui/info-row';
import { Steps, type Step } from '@/components/ui/steps';

const beoTone = (s: string) => (s === 'signed' ? 'success' : s === 'sent' ? 'info' : 'neutral') as 'success' | 'info' | 'neutral';

/** BEO detail — the function sheet + e-sign lifecycle (send → sign; signed = locked). */
export default async function BeoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: beo } = await supabase.from('catering_beos').select('*').eq('id', id).maybeSingle();
  if (!beo) notFound();
  const { data: guest } = await supabase.from('guests').select('id, name, phone').eq('id', beo.guest_id).maybeSingle();
  const { data: lines } = await supabase.from('catering_beo_lines').select('id, name').eq('beo_id', id).order('name');

  const locked = beo.status === 'signed';
  const flags = { draft: 0, sent: 1, signed: 2 }[beo.status as 'draft' | 'sent' | 'signed'] ?? 0;
  const steps: Step[] = ['Draft', 'Sent', 'Signed'].map((label, i): Step => ({
    label, state: i < flags ? 'done' : i === flags ? (locked ? 'done' : 'current') : 'todo',
  }));
  const dietary = (beo.dietary_flags ?? []) as string[];

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <DetailHeader
        backHref="/catering/beo"
        backLabel="Banquet Event Orders"
        eyebrow="Catering · BEO"
        title={<span style={{ textTransform: 'capitalize' }}>{beo.beo_type} BEO <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>v{beo.version}</span></span>}
        status={<Badge tone={beoTone(beo.status)}>{beo.status}</Badge>}
        meta={<span style={{ fontFamily: 'var(--font-mono)' }}>{beo.service_date ?? 'no date'}{beo.service_time ? ` · ${beo.service_time}` : ''}</span>}
      />

      {/* Lifecycle — dominant */}
      <Card elevated accent eyebrow="Lifecycle" title="Draft → Sent → Signed">
        <Steps steps={steps} />
        <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-divider)' }}>
          {locked ? (
            <p className="inline-flex items-center" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-success)' }}>
              <Lock size={15} aria-hidden /> Signed by <b>{beo.signed_by_name}</b> ({beo.signed_method}) at {beo.signed_at ? new Date(beo.signed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'} — locked. Changes require a new version.
            </p>
          ) : (
            <BeoLifecycle beoId={beo.id} status={beo.status} />
          )}
        </div>
      </Card>

      <div className="grid pn-today-main" style={{ gap: 'var(--space-6)' }}>
        {/* Menu snapshot — the document body */}
        <Card padded={false} title="Menu" subtitle="snapshot — frozen at generation">
          {(lines ?? []).length === 0 ? (
            <EmptyState icon={UtensilsCrossed} title="No lines" message="This BEO has no menu lines." />
          ) : (
            <ul className="flex flex-col">
              {(lines ?? []).map((l) => (
                <li key={l.id} style={{ padding: 'var(--space-3) var(--card-pad)', borderBottom: '1px solid var(--color-divider)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>{l.name}</li>
              ))}
            </ul>
          )}
        </Card>

        {/* Function-sheet facts */}
        <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
          <Card title="Function sheet">
            <dl className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
              <InfoRow label="Guest" value={guest?.name ?? '—'} />
              {guest?.phone && <InfoRow label="Phone" value={guest.phone} mono tone="muted" />}
              <InfoRow label="Venue" value={beo.venue ?? '—'} />
              <InfoRow label="Expected" value={`${beo.guest_count} pax`} mono />
              <InfoRow label="Guarantee (billable min)" value={`${beo.guest_guarantee} pax`} mono />
            </dl>
            {dietary.length > 0 && (
              <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-divider)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)' }}>Dietary flags</div>
                <div className="flex flex-wrap" style={{ gap: 'var(--space-2)' }}>{dietary.map((d) => <Badge key={d} tone="warning">{d}</Badge>)}</div>
              </div>
            )}
            {beo.special_instructions && (
              <p style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-divider)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                <span style={{ color: 'var(--color-text-tertiary)' }}>Notes: </span>{beo.special_instructions}
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
