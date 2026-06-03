import { redirect } from 'next/navigation';
import { getRoleContext } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/shell/app-shell';

/**
 * Protected app shell. Server-resolves the user (defence in depth alongside
 * middleware) + the org/property name, then renders the persistent maroon-Meridian
 * navigation shell. Visual chrome only — no data/logic here.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRoleContext();
  if (!ctx) redirect('/login');

  let orgName = 'PN Master Suite';
  if (ctx.orgId) {
    const supabase = await createClient();
    const { data: org } = await supabase.from('orgs').select('name').eq('id', ctx.orgId).maybeSingle();
    if (org?.name) orgName = org.name;
  }

  return (
    <AppShell orgName={orgName} email={ctx.email ?? ''} role={ctx.role}>
      {children}
    </AppShell>
  );
}
