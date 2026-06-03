import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { MenuScalePreview } from '@/components/menu-scale-preview';
import { DetailHeader } from '@/components/ui/detail-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoRow } from '@/components/ui/info-row';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import { ChefHat } from 'lucide-react';

/** Menu item detail — its recipe lines + the scale/cost preview. */
export default async function MenuItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: item } = await supabase.from('catering_menu_items').select('*').eq('id', id).maybeSingle();
  if (!item) notFound();

  const { data: recipe } = await supabase.from('catering_recipes').select('id, base_yield, scale_mode, notes').eq('menu_item_id', id).maybeSingle();
  // cost is NOT read here (KL-1: locked column) — the gated scale preview below shows cost to privileged roles
  const { data: lines } = recipe
    ? await supabase
        .from('catering_recipe_lines')
        .select('quantity, unit, inventory_item_id, inventory_items(name)')
        .eq('recipe_id', recipe.id)
    : { data: [] as never[] };

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      <DetailHeader
        backHref="/catering/menu"
        backLabel="Menu & recipes"
        eyebrow="Catering · Menu item"
        title={item.name}
        status={<Badge tone="neutral">{(item.supply_type ?? 'untagged').replace(/_/g, ' ')}</Badge>}
        meta={<span style={{ fontFamily: 'var(--font-mono)' }}>{formatINR(item.default_selling_price)} / plate</span>}
      />

      <div className="grid pn-today-main" style={{ gap: 'var(--space-6)' }}>
        {/* Recipe — the dominant left column */}
        <Card title="Recipe" subtitle={recipe ? `base yield ${recipe.base_yield} · ${recipe.scale_mode}` : 'bought-in item'} padded={false}>
          {!recipe ? (
            <EmptyState icon={ChefHat} title="No recipe" message="This is a bought-in item — nothing to scale. (Recipe editing arrives in a later sub-phase.)" />
          ) : (
            <Table>
              <THead>
                <TR><TH>Ingredient</TH><TH align="right">Quantity</TH></TR>
              </THead>
              <tbody>
                {(lines ?? []).map((l, i) => {
                  const inv = l.inventory_items as unknown as { name: string } | null;
                  return (
                    <TR key={i}>
                      <TD><span style={{ color: 'var(--color-text)' }}>{inv?.name ?? l.inventory_item_id}</span></TD>
                      <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{l.quantity} {l.unit}</span></TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        {/* Facts + scale preview */}
        <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
          <Card title="Item">
            <dl className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
              <InfoRow label="Category" value={item.category ?? '—'} />
              <InfoRow label="Selling price" value={`${formatINR(item.default_selling_price)} / plate`} mono />
              <InfoRow label="Supply type" value={<Badge tone="neutral">{(item.supply_type ?? 'untagged').replace(/_/g, ' ')}</Badge>} />
              {recipe && <InfoRow label="Base yield" value={recipe.base_yield} mono />}
              {recipe && <InfoRow label="Scale mode" value={recipe.scale_mode} />}
            </dl>
          </Card>

          <Card title="Scale preview" subtitle="Enter a guest count → scaled ingredients (food cost shown only where your role permits)">
            <MenuScalePreview menuItemId={id} />
          </Card>
        </div>
      </div>
    </div>
  );
}
