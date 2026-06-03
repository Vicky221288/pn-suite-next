import { createClient } from '@/lib/supabase/server';
import { getRosterBoard } from '@/lib/actions/scheduling';
import { SchedulingManager } from '@/components/scheduling-manager';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/** M1a — staff scheduling: templates, publishable rosters, shift assignment + status. */
export default async function SchedulingPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(); to.setUTCDate(to.getUTCDate() + 28);
  const toIso = to.toISOString().slice(0, 10);

  const [{ data: templates }, { data: rosters }, { data: staff }, board] = await Promise.all([
    supabase.from('shift_templates').select('id, name, role, start_time, end_time, location, days_of_week, active').order('name'),
    supabase.from('staff_rosters').select('id, name, period_start, period_end, status').order('period_start', { ascending: false }).limit(50),
    supabase.from('staff').select('id, name, role').eq('active', true).order('name'),
    getRosterBoard(today, toIso),
  ]);

  const boardData = (board.ok ? board.data : { can_manage: false, shifts: [] }) as { can_manage: boolean; shifts: unknown[] };

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Workforce"
        title="Scheduling"
        subtitle="Shift templates → roster → assign staff. Published rosters are what staff see; the overlap guard prevents double-booking a staff member."
      />
      <SchedulingManager
        templates={(templates ?? []) as never}
        rosters={(rosters ?? []) as never}
        staff={(staff ?? []) as never}
        board={boardData as never}
        range={{ from: today, to: toIso }}
      />
    </div>
  );
}
