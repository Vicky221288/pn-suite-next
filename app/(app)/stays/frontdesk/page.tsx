import { createClient } from '@/lib/supabase/server';
import { FrontDesk } from '@/components/front-desk';
import { PageHeader } from '@/components/ui/page-header';

interface Room { id: string; number: string; room_types: { name: string } | null }
interface Stay { id: string; check_in: string; check_out: string; status: string; is_foreign: boolean; guests: { name: string; phone: string } | null; rooms: { number: string } | null }

/** Stays — front desk: walk-in, check-in (Form C for foreign guests), check-out. */
export default async function FrontDeskPage() {
  const supabase = await createClient();
  const { data: rooms } = await supabase.from('rooms').select('id, number, room_types(name)').eq('status', 'available').order('number');
  const { data: stays } = await supabase
    .from('room_stays')
    .select('id, check_in, check_out, status, is_foreign, guests(name, phone), rooms(number)')
    .in('status', ['reserved', 'checked_in'])
    .order('check_in');

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Stays"
        title="Front desk"
        subtitle="Walk a guest in, check arrivals in, and check departures out. Foreign-national check-in captures Form C before the stay can begin."
        meta={`${(stays ?? []).length} active`}
      />
      <FrontDesk rooms={(rooms ?? []) as unknown as Room[]} stays={(stays ?? []) as unknown as Stay[]} />
    </div>
  );
}
