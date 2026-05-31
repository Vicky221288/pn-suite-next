import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Capability } from './capabilities';

/**
 * Role/tenant context for Server Components — resolves the authenticated user
 * plus their org + role + capabilities from `org_members` via the RLS-enforced
 * user client (never client input; the F-SEC-04 fix). Single active org for now
 * (the 3-person property); multi-org switching is a later wave.
 */
export interface RoleContext {
  userId: string;
  email: string | null;
  orgId: string | null;
  role: string | null;
  capabilities: Capability[];
}

export async function getRoleContext(): Promise<RoleContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('org_members')
    .select('org_id, role, capabilities')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email ?? null,
    orgId: (data?.org_id as string | undefined) ?? null,
    role: (data?.role as string | undefined) ?? null,
    capabilities: (data?.capabilities as Capability[] | undefined) ?? [],
  };
}
