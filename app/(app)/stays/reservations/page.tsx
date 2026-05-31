import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { ReservationManager } from '@/components/reservation-manager';

interface Room { id: string; number: string; room_types: { name: string } | null }
interface Stay { id: string; check_in: string; check_out: string; status: string; rate_quoted: number; guests: { name: string; phone: string } | null; rooms: { number: string } | null }

/** Stays — reservations: create (guest by phone, room, dates), list, cancel. */
export default async function ReservationsPage() {
  const supabase = await createClient();
  const { data: rooms } = await supabase.from('rooms').select('id, number, room_types(name)').eq('status', 'available').order('number');
  const { data: stays } = await supabase
    .from('room_stays')
    .select('id, check_in, check_out, status, rate_quoted, guests(name, phone), rooms(number)')
    .order('check_in', { ascending: false })
    .limit(100);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/stays" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Rooms</Link>
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Stays — Reservations</h1>
      <ReservationManager rooms={(rooms ?? []) as unknown as Room[]} stays={(stays ?? []) as unknown as Stay[]} />
    </div>
  );
}
