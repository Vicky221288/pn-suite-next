import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { CAP } from '@/lib/auth/capabilities';
import { WorkforceManager } from '@/components/workforce-manager';

export const dynamic = 'force-dynamic';

/** M1b — workforce: HR fields, geofenced attendance, leave + tiered approval. */
export default async function StaffPage() {
  const ctx = await getRoleContext();
  const supabase = await createClient();
  const [{ data: staff }, { data: fence }, { data: leave }, { data: attendance }] = await Promise.all([
    supabase.from('staff').select('id, name, role, employee_code, date_of_joining, designation, employment_type, email').eq('active', true).order('name'),
    supabase.from('attendance_geofences').select('center_lat, center_lng, radius_m').maybeSingle(),
    supabase.from('leave_requests').select('id, leave_type, start_date, end_date, reason, status, staff_id').order('created_at', { ascending: false }).limit(50),
    supabase.from('attendance_records').select('id, staff_id, kind, on_premise, recorded_at').order('recorded_at', { ascending: false }).limit(30),
  ]);

  const caps = ctx?.capabilities ?? [];
  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Workforce</h1>
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        HR profile · geofenced on-premise attendance (boolean only — no location is stored) · leave with tiered approval.
      </p>
      <WorkforceManager
        staff={(staff ?? []) as never}
        fence={(fence ?? null) as never}
        leave={(leave ?? []) as never}
        attendance={(attendance ?? []) as never}
        canManageStaff={caps.includes(CAP.STAFF_MANAGE)}
        canDecide={caps.includes(CAP.APPROVAL_DECIDE)}
      />
    </div>
  );
}
