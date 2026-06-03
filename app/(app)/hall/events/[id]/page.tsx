import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { RosterPanel } from '@/components/roster-actions';
import { ChecklistPanel } from '@/components/checklist-actions';
import { VendorPanel } from '@/components/vendor-actions';
import { DetailHeader } from '@/components/ui/detail-header';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';

/** Hall event-day ops — staff roster, execution checklists (photo-proof), vendors. */
export default async function HallEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getRoleContext();
  const { data: event } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
  if (!event) notFound();
  const { data: roster } = await supabase.from('event_staff').select('id, role_on_event, status, staff(name)').eq('event_id', id);
  const { data: staff } = await supabase.from('staff').select('id, name').eq('active', true).order('name');
  const { data: checklists } = await supabase.from('event_checklists').select('id, title, event_checklist_items(id, label, requires_photo, done, photo_ref)').eq('event_id', id);
  const { data: vendorsLinked } = await supabase.from('event_vendors').select('id, service_type, amount, commission_amount, status, vendors(name)').eq('event_id', id);
  const { data: vendors } = await supabase.from('vendors').select('id, name').eq('active', true).order('name');

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <DetailHeader
        backHref="/hall"
        backLabel="Hall"
        eyebrow="Hall · Event ops"
        title={<span style={{ fontFamily: 'var(--font-mono)' }}>{event.event_date}</span>}
        status={<StatusBadge status={event.status} />}
        meta={(event.slot ?? '—').replace(/_/g, ' ')}
      />

      <Card title="Staff roster" subtitle="Assigned staff + day-of status">
        <RosterPanel eventId={id} roster={(roster ?? []) as never} staff={staff ?? []} />
      </Card>

      <Card title="Execution checklists" subtitle="Photo-proof items require an uploaded photo before completion">
        <ChecklistPanel eventId={id} orgId={ctx?.orgId ?? ''} checklists={(checklists ?? []) as never} />
      </Card>

      <Card title="Vendor coordination" subtitle="Service, amount, and commission per vendor">
        <VendorPanel eventId={id} linked={(vendorsLinked ?? []) as never} vendors={vendors ?? []} />
      </Card>
    </div>
  );
}
