import { createClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { CAP } from '@/lib/auth/capabilities';
import { InventoryReorder } from '@/components/inventory-reorder';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/** M7 — inventory reorder: per-item reorder config + the reorder dashboard (below-threshold + draft reorder POs). */
export default async function InventoryPage() {
  const ctx = await getRoleContext();
  const supabase = await createClient();
  // NB: do NOT select inventory_items.cost / purchase_order_lines.unit_cost — KL-1 revoked those from authenticated.
  const [{ data: items }, { data: pos }] = await Promise.all([
    supabase.from('inventory_items').select('id, name, unit, quantity_on_hand, reorder_point, reorder_qty, supplier_id').order('name'),
    supabase.from('purchase_orders').select('id, supplier_id, status, source, created_at, purchase_order_lines(item_id, name, quantity, unit)').eq('source', 'reorder').eq('status', 'draft').order('created_at', { ascending: false }),
  ]);

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Operations"
        title="Inventory · reorder"
        subtitle="Set a reorder point + qty per item to opt it into monitoring. The reorder rule auto-drafts purchase orders (draft only — you order &amp; receive in purchasing)."
      />
      <InventoryReorder
        items={(items ?? []) as never}
        draftPos={(pos ?? []) as never}
        canManage={(ctx?.capabilities ?? []).includes(CAP.INVENTORY_MANAGE)}
      />
    </div>
  );
}
