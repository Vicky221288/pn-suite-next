import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { NewPackageForm } from '@/components/new-package-form';

/** Catering packages — reusable menu+price templates. */
export default async function CateringPackagesPage() {
  const supabase = await createClient();
  const { data: packages } = await supabase
    .from('catering_packages')
    .select('id, name, description, catering_package_items(unit_selling_price)')
    .eq('active', true)
    .order('name');
  const { data: menuItems } = await supabase.from('catering_menu_items').select('id, name, default_selling_price').eq('active', true).order('name');

  return (
    <div className="flex flex-col gap-5">
      <Link href="/catering/enquiries" className="text-sm" style={{ color: 'var(--color-brand)' }}>← Catering enquiries</Link>
      <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Catering — Packages</h1>
      <section style={card}>
        <h2 style={h2}>New package</h2>
        {(menuItems ?? []).length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Add menu items first (Catering → Menu).</p> : <NewPackageForm menuItems={menuItems ?? []} />}
      </section>
      <section style={card}>
        <h2 style={h2}>Packages</h2>
        {(packages ?? []).length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>None yet.</p> : (
          <ul className="flex flex-col">
            {(packages ?? []).map((p) => {
              const items = (p.catering_package_items as unknown as { unit_selling_price: number }[]) ?? [];
              const perPlate = items.reduce((s, it) => s + Number(it.unit_selling_price), 0);
              return (
                <li key={p.id} className="flex justify-between py-2 text-sm" style={{ borderBottom: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                  <span>{p.name} <span style={{ color: 'var(--color-text-tertiary)' }}>· {items.length} items</span></span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>≈ ₹{perPlate}/plate</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
