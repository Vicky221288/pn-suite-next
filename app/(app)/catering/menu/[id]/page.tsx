import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { MenuScalePreview } from '@/components/menu-scale-preview';

/** Menu item detail — its recipe lines + the scale/cost preview. */
export default async function MenuItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: item } = await supabase.from('catering_menu_items').select('*').eq('id', id).maybeSingle();
  if (!item) notFound();

  const { data: recipe } = await supabase.from('catering_recipes').select('id, base_yield, scale_mode, notes').eq('menu_item_id', id).maybeSingle();
  const { data: lines } = recipe
    ? await supabase
        .from('catering_recipe_lines')
        .select('quantity, unit, inventory_item_id, inventory_items(name, cost)')
        .eq('recipe_id', recipe.id)
    : { data: [] as never[] };

  return (
    <div className="flex flex-col gap-5">
      <Link href="/catering/menu" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Menu</Link>
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>{item.name}</h1>
        <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>{item.category ?? '—'} · {formatINR(item.default_selling_price)} · {item.supply_type ?? 'untagged'}</span>
      </div>

      <section style={card}>
        <h2 style={h2}>Recipe {recipe ? `· base yield ${recipe.base_yield} · ${recipe.scale_mode}` : ''}</h2>
        {!recipe ? (
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No recipe — bought-in item. (Recipe editing arrives in a later sub-phase.)</p>
        ) : (
          <ul className="flex flex-col text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {(lines ?? []).map((l, i) => {
              const inv = l.inventory_items as unknown as { name: string; cost: number } | null;
              return (
                <li key={i} className="flex justify-between py-1" style={{ borderBottom: '1px solid var(--color-divider)' }}>
                  <span>{inv?.name ?? l.inventory_item_id}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{l.quantity} {l.unit} · {formatINR(inv?.cost ?? 0)}/unit</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Scale preview</h2>
        <MenuScalePreview menuItemId={id} />
      </section>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
