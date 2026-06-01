import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { CAP } from '@/lib/auth/capabilities';
import { OpsManager } from '@/components/ops-manager';

export const dynamic = 'force-dynamic';

/** M2 — ops execution: tasks, incidents, checklist-template engine (→ W2 checklists). */
export default async function OpsPage() {
  const ctx = await getRoleContext();
  const supabase = await createClient();
  const [{ data: tasks }, { data: incidents }, { data: templates }, { data: staff }, { data: events }] = await Promise.all([
    supabase.from('tasks').select('id, title, priority, due_date, status, assigned_staff_id, entity_type, entity_id').order('created_at', { ascending: false }).limit(50),
    supabase.from('incidents').select('id, title, severity, status, assigned_staff_id, resolution').order('created_at', { ascending: false }).limit(50),
    supabase.from('checklist_templates').select('id, name, kind, active').order('name'),
    supabase.from('staff').select('id, name').eq('active', true).order('name'),
    supabase.from('events').select('id, event_date, event_type').order('event_date', { ascending: false }).limit(50),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Ops execution</h1>
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Tasks · incidents · checklist templates. Templates generate into the existing event checklists (photo-proof intact).
      </p>
      <OpsManager
        tasks={(tasks ?? []) as never}
        incidents={(incidents ?? []) as never}
        templates={(templates ?? []) as never}
        staff={(staff ?? []) as never}
        events={(events ?? []) as never}
        canManage={(ctx?.capabilities ?? []).includes(CAP.OPS_MANAGE)}
      />
    </div>
  );
}
