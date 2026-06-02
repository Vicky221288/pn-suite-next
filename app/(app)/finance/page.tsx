import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { CAP } from '@/lib/auth/capabilities';
import { getCollectionsAgeing } from '@/lib/actions/finance';
import { FinanceManager } from '@/components/finance-manager';

export const dynamic = 'force-dynamic';

/** M6 — finance back-office: expenses (post to shared ledger) + tiered approval + AR ageing. */
export default async function FinancePage() {
  const ctx = await getRoleContext();
  const supabase = await createClient();
  const [{ data: expenses }, { data: categories }, { data: vendors }, ageing] = await Promise.all([
    supabase.from('expenses').select('id, amount, expense_date, status, source_domain, payee_name, category_id, vendor_id').order('created_at', { ascending: false }).limit(50),
    supabase.from('expense_categories').select('id, name').eq('active', true).order('name'),
    supabase.from('vendors').select('id, name').order('name'),
    getCollectionsAgeing(),
  ]);

  const caps = ctx?.capabilities ?? [];
  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Finance back-office</h1>
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Expenses post to the one shared ledger on approval (P&L is a query). Approval reuses the generic primitive. Ageing reads invoices.
      </p>
      <FinanceManager
        expenses={(expenses ?? []) as never}
        categories={(categories ?? []) as never}
        vendors={(vendors ?? []) as never}
        ageing={(ageing.ok ? ageing.data : null) as never}
        canManage={caps.includes(CAP.EXPENSE_MANAGE)}
        canDecide={caps.includes(CAP.APPROVAL_DECIDE)}
      />
    </div>
  );
}
