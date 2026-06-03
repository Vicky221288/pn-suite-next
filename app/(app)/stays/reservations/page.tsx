import { CalendarArrowDown, BedDouble, CalendarClock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { ReservationManager } from '@/components/reservation-manager';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';

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
  const list = (stays ?? []) as unknown as Stay[];

  // Derived from the SAME fetched rows (no extra query). IST "today" as YYYY-MM-DD.
  const istToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const arriving = list.filter((s) => s.status === 'reserved' && s.check_in === istToday).length;
  const inHouse = list.filter((s) => s.status === 'checked_in').length;
  const upcoming = list.filter((s) => s.status === 'reserved' && s.check_in > istToday).length;

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Stays"
        title="Reservations"
        subtitle="Every room stay from reservation through check-in, check-out, and settlement — newest first."
        meta={`${list.length} shown`}
      />

      {list.length > 0 && (
        <div className="grid" style={{ gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 'var(--space-6)' }}>
          <StatCard label="Arriving today" value={String(arriving)} icon={CalendarArrowDown} delay={0} hint="reserved · check-in today" />
          <StatCard label="In-house" value={String(inHouse)} icon={BedDouble} tone={inHouse ? 'success' : 'default'} delay={70} hint="currently checked in" />
          <StatCard label="Upcoming" value={String(upcoming)} icon={CalendarClock} delay={140} hint="future reservations" />
        </div>
      )}

      <ReservationManager rooms={(rooms ?? []) as unknown as Room[]} stays={list} />
    </div>
  );
}
