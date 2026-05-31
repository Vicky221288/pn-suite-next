import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { NewMenuItemForm } from '@/components/new-menu-item-form';

/** Catering menu — RLS-scoped list of menu items (recipes viewed per item). */
export default async function CateringMenuPage() {
  const supabase = await createClient();
  const { data: items } = await supabase
    .from('catering_menu_items')
    .select('id, name, category, default_selling_price, supply_type, active')
    .eq('active', true)
    .order('category', { ascending: true })
    .order('name', { ascending: true })
    .limit(200);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Catering — Menu</h1>

      <section style={card}>
        <h2 style={h2}>New menu item</h2>
        <NewMenuItemForm />
      </section>

      <section style={card}>
        <h2 style={h2}>Menu</h2>
        {(items ?? []).length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No menu items yet.</p>
        ) : (
          <ol className="flex flex-col">
            {(items ?? []).map((it) => (
              <li key={it.id} style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <Link href={`/catering/menu/${it.id}`} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span>{it.name} {it.category ? <span style={{ color: 'var(--color-text-tertiary)' }}>· {it.category}</span> : null}</span>
                  <span style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{formatINR(it.default_selling_price)}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
