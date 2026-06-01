import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { CAP } from '@/lib/auth/capabilities';
import { PricingManager } from '@/components/pricing-manager';

export const dynamic = 'force-dynamic';

/** M4 — dynamic pricing: rate-rule manager + on-demand price preview (selling price only). */
export default async function PricingPage() {
  const ctx = await getRoleContext();
  const supabase = await createClient();
  const [{ data: rules }, { data: roomTypes }] = await Promise.all([
    supabase.from('rate_rules').select('id, name, subject_type, subject_id, condition_type, date_from, date_to, days_of_week, occupancy_min, adjustment_kind, adjustment_value, priority, active').order('priority'),
    supabase.from('room_types').select('id, name, base_rate').order('name'),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Dynamic pricing</h1>
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Rules flex the <b>selling</b> price only. GST is decided separately by supply-type and is never touched here.
      </p>
      <PricingManager
        rules={(rules ?? []) as never}
        roomTypes={(roomTypes ?? []) as never}
        canManage={(ctx?.capabilities ?? []).includes(CAP.PRICING_MANAGE)}
      />
    </div>
  );
}
