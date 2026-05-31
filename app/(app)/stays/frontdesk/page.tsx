import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { FrontDesk } from '@/components/front-desk';

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
    <div className="flex flex-col gap-5">
      <Link href="/stays" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Rooms</Link>
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Stays — Front Desk</h1>
      <FrontDesk rooms={(rooms ?? []) as unknown as Room[]} stays={(stays ?? []) as unknown as Stay[]} />
    </div>
  );
}
