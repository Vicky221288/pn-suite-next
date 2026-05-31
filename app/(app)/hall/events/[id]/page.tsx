import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RosterPanel } from '@/components/roster-actions';
import { ChecklistPanel } from '@/components/checklist-actions';
import { VendorPanel } from '@/components/vendor-actions';

/** Hall event-day ops — staff roster, execution checklists (photo-proof), vendors. */
export default async function HallEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: event } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
  if (!event) notFound();
  const { data: roster } = await supabase.from('event_staff').select('id, role_on_event, status, staff(name)').eq('event_id', id);
  const { data: staff } = await supabase.from('staff').select('id, name').eq('active', true).order('name');
  const { data: checklists } = await supabase.from('event_checklists').select('id, title, event_checklist_items(id, label, requires_photo, done, photo_ref)').eq('event_id', id);
  const { data: vendorsLinked } = await supabase.from('event_vendors').select('id, service_type, amount, commission_amount, status, vendors(name)').eq('event_id', id);
  const { data: vendors } = await supabase.from('vendors').select('id, name').eq('active', true).order('name');

  return (
    <div className="flex flex-col gap-5">
      <Link href="/hall" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Hall</Link>
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Event ops · {event.event_date}</h1>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{event.slot ?? '—'} · {event.status}</p>

      <section style={card}><h2 style={h2}>Staff roster</h2><RosterPanel eventId={id} roster={(roster ?? []) as never} staff={staff ?? []} /></section>
      <section style={card}><h2 style={h2}>Execution checklists (photo-proof)</h2><ChecklistPanel eventId={id} checklists={(checklists ?? []) as never} /></section>
      <section style={card}><h2 style={h2}>Vendors</h2><VendorPanel eventId={id} linked={(vendorsLinked ?? []) as never} vendors={vendors ?? []} /></section>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
