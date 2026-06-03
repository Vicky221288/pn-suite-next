import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { HousekeepingBoard } from '@/components/housekeeping-board';
import { PageHeader } from '@/components/ui/page-header';

interface BoardRoom { room_id: string; number: string; service_status: string; housekeeping_status: string; occupied: boolean; sellable: boolean }

/** Stays — housekeeping: room status board + turn queue + maintenance log. */
export default async function HousekeepingPage() {
  const supabase = await createClient();
  const ctx = await getRoleContext();
  const { data: boardData } = await supabase.rpc('room_board', { p_org: ctx?.orgId });
  const board = ((boardData?.rooms ?? []) as BoardRoom[]);
  const { data: tasks } = await supabase.from('housekeeping_tasks').select('id, kind, status, requires_photo, room_id, rooms(number), staff(name)').neq('status', 'done').order('created_at');
  const { data: maint } = await supabase.from('maintenance_requests').select('id, description, priority, status, room_id, rooms(number)').neq('status', 'resolved').order('created_at');
  const { data: staff } = await supabase.from('staff').select('id, name').eq('active', true).order('name');

  const sellable = board.filter((r) => r.sellable).length;

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Stays"
        title="Housekeeping"
        subtitle="The live room board with turn queue and maintenance. Occupancy and housekeeping are tracked independently; a room is sellable only when both line up."
        meta={`${sellable}/${board.length} sellable`}
      />
      <HousekeepingBoard
        board={board}
        tasks={(tasks ?? []) as never}
        maint={(maint ?? []) as never}
        staff={staff ?? []}
        orgId={ctx?.orgId ?? ''}
      />
    </div>
  );
}
