import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { CAP } from '@/lib/auth/capabilities';
import { getConsolidatedPnl, getGstReturn, getArAgeingByCustomer, getLeadSourceReport } from '@/lib/actions/reporting';
import { ReportsView } from '@/components/reports-view';

export const dynamic = 'force-dynamic';

/** M8 — reporting + marketing leaf: P&L, GST-return, per-customer ageing, marketing. */
export default async function ReportsPage() {
  const ctx = await getRoleContext();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(); from.setUTCFullYear(from.getUTCFullYear() - 1);
  const fromIso = from.toISOString().slice(0, 10);

  const [pnl, gst, ageing, leadReport, { data: campaigns }, { data: leads }, { data: led }] = await Promise.all([
    getConsolidatedPnl(fromIso, today),
    getGstReturn(fromIso, today),
    getArAgeingByCustomer(),
    getLeadSourceReport(fromIso, today),
    supabase.from('campaigns').select('id, name, channel, spend').order('name'),
    supabase.from('leads').select('id, name, phone, source, status, campaign_id').order('created_at', { ascending: false }).limit(50),
    supabase.from('led_bookings').select('id, advertiser_name, amount, period_start, period_end').order('created_at', { ascending: false }).limit(30),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Reports &amp; marketing</h1>
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        P&amp;L, GST-return, and ageing are live queries over the one ledger / resolved invoices (nothing recomputed or stored). Marketing is minimal.
      </p>
      <ReportsView
        pnl={(pnl.ok ? pnl.data : null) as never}
        gst={(gst.ok ? gst.data : null) as never}
        ageing={(ageing.ok ? ageing.data : null) as never}
        leadReport={(leadReport.ok ? leadReport.data : null) as never}
        campaigns={(campaigns ?? []) as never}
        leads={(leads ?? []) as never}
        led={(led ?? []) as never}
        canMarket={(ctx?.capabilities ?? []).includes(CAP.MARKETING_MANAGE)}
      />
    </div>
  );
}
