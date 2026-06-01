import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { CAP } from '@/lib/auth/capabilities';
import { TemplateManager } from '@/components/template-manager';

export const dynamic = 'force-dynamic';

/** M3 — CRM message templates (org config; route the B3 sender via function_area). */
export default async function CrmPage() {
  const ctx = await getRoleContext();
  const supabase = await createClient();
  const [{ data: templates }, { data: senders }] = await Promise.all([
    supabase.from('message_templates').select('id, name, function_area, channel, body, active, purpose').order('name'),
    supabase.from('message_senders').select('function_area').eq('active', true),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>CRM — message templates</h1>
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Templates carry {'{{placeholders}}'}. function_area routes the configured messaging sender. All sends go through the messaging provider (idempotent, quiet-hours aware).
      </p>
      <TemplateManager
        templates={(templates ?? []) as never}
        functionAreas={[...new Set((senders ?? []).map((s: { function_area: string }) => s.function_area))]}
        canManage={(ctx?.capabilities ?? []).includes(CAP.CRM_MANAGE)}
      />
    </div>
  );
}
