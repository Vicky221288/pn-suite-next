import { PackageOpen, Boxes } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { NewPackageForm } from '@/components/new-package-form';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';

/** Catering packages — reusable menu+price templates. */
export default async function CateringPackagesPage() {
  const supabase = await createClient();
  const { data: packages } = await supabase
    .from('catering_packages')
    .select('id, name, description, catering_package_items(unit_selling_price)')
    .eq('active', true)
    .order('name');
  const { data: menuItems } = await supabase.from('catering_menu_items').select('id, name, default_selling_price').eq('active', true).order('name');
  const pkgs = packages ?? [];
  const items = menuItems ?? [];

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Catering"
        title="Packages"
        subtitle="Reusable menu + price templates. Pick a package when building a quote to pre-fill its dishes and per-plate prices."
        meta={`${pkgs.length} package${pkgs.length === 1 ? '' : 's'}`}
      />

      <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        {items.length === 0 ? (
          <Card>
            <EmptyState icon={Boxes} title="Add menu items first" message="A package is built from menu items. Add dishes in Catering → Menu, then come back to bundle them into a package." />
          </Card>
        ) : (
          <CreatePanel label="New package" title="Build a package">
            <NewPackageForm menuItems={items} />
          </CreatePanel>
        )}

        <Card padded={false} title="Packages" subtitle={`${pkgs.length} active`}>
          {pkgs.length === 0 ? (
            <EmptyState icon={PackageOpen} title="No packages yet" message="Bundle a set of dishes with per-plate prices into a named template you can reuse across quotes." />
          ) : (
            <Table>
              <THead>
                <TR><TH>Package</TH><TH align="right">Items</TH><TH align="right">Per plate</TH></TR>
              </THead>
              <tbody>
                {pkgs.map((p) => {
                  const pitems = (p.catering_package_items as unknown as { unit_selling_price: number }[]) ?? [];
                  const perPlate = pitems.reduce((s, it) => s + Number(it.unit_selling_price), 0);
                  return (
                    <TR key={p.id}>
                      <TD>
                        <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{p.name}</span>
                        {p.description && <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{p.description}</span>}
                      </TD>
                      <TD align="right"><span style={{ color: 'var(--color-text-secondary)' }}>{pitems.length}</span></TD>
                      <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>≈ {formatINR(perPlate)}</span></TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
