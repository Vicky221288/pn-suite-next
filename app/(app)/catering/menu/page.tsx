import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { NewMenuItemForm } from '@/components/new-menu-item-form';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';

/** Catering menu — RLS-scoped list of menu items (recipes viewed per item). */
export default async function CateringMenuPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('catering_menu_items')
    .select('id, name, category, default_selling_price, supply_type, active')
    .eq('active', true)
    .order('category', { ascending: true })
    .order('name', { ascending: true })
    .limit(200);
  const items = data ?? [];

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Catering"
        title="Menu & recipes"
        subtitle="Every dish, its category and per-plate selling price, and the recipe behind it. Open an item to see its ingredients and scale them to any guest count."
        meta={`${items.length} item${items.length === 1 ? '' : 's'}`}
      />

      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        <CreatePanel label="New item" title="Add a menu item">
          <NewMenuItemForm />
        </CreatePanel>

        <Card padded={false} title="Menu" subtitle={`${items.length} active item${items.length === 1 ? '' : 's'}`}>
          {items.length === 0 ? (
            <EmptyState icon={UtensilsCrossed} title="No menu items yet" message="Add a dish with its category and per-plate price. Each item can carry a recipe of inventory ingredients that scales to the guest count.">
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Use <b style={{ color: 'var(--color-text-secondary)' }}>New item</b> above.</span>
            </EmptyState>
          ) : (
            <Table>
              <THead>
                <TR><TH>Item</TH><TH>Supply type</TH><TH>Category</TH><TH align="right">Per plate</TH></TR>
              </THead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="pn-tr" style={{ position: 'relative' }}>
                    <TD>
                      <Link href={`/catering/menu/${it.id}`} aria-label={`Open ${it.name}`} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
                      <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{it.name}</span>
                    </TD>
                    <TD>
                      <span style={{ position: 'relative', zIndex: 2 }}><Badge tone="neutral">{(it.supply_type ?? 'untagged').replace(/_/g, ' ')}</Badge></span>
                    </TD>
                    <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{it.category ?? '—'}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(it.default_selling_price)}</span></TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
