import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { CAP } from '@/lib/auth/capabilities';
import { getAvailabilityCalendar } from '@/lib/actions/holds';
import { HoldsCalendar } from '@/components/holds-calendar';

export const dynamic = 'force-dynamic';

/** M5 — unified availability calendar + tentative date-hold manager. */
export default async function CalendarPage() {
  const ctx = await getRoleContext();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const to = new Date(); to.setUTCDate(to.getUTCDate() + 30);
  const toIso = to.toISOString().slice(0, 10);

  const [{ data: halls }, { data: roomTypes }, { data: holds }, cal] = await Promise.all([
    supabase.from('halls').select('id, name').order('name'),
    supabase.from('room_types').select('id, name, base_rate').order('name'),
    supabase.from('date_holds').select('id, domain, hall_id, event_date, slot, room_type_id, check_in, check_out, guest_name, status, expires_at').order('created_at', { ascending: false }).limit(50),
    getAvailabilityCalendar(today, toIso),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Availability & holds</h1>
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Holds are tentative + expiring — advisory only. A confirmed booking is decided by the booking guard, never by a hold.
      </p>
      <HoldsCalendar
        halls={(halls ?? []) as never}
        roomTypes={(roomTypes ?? []) as never}
        holds={(holds ?? []) as never}
        calendar={(cal.ok ? cal.data : null) as never}
        range={{ from: today, to: toIso }}
        canManage={(ctx?.capabilities ?? []).includes(CAP.HOLD_MANAGE)}
      />
    </div>
  );
}
