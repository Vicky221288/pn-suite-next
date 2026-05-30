import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Capability } from './capabilities';

/**
 * The authenticated authorization gate (OP MODEL §10; F-SEC-04 fix).
 *
 * Resolves the caller's org + capabilities FROM THEIR SESSION (org_members via
 * the RLS-enforced user client) — NEVER from client-supplied input. This is the
 * server-resolved org_id every authenticated write is scoped to.
 *
 * Defense in depth: the confirm_booking RPC ALSO self-authorizes on auth.uid(),
 * so even a bypass of this gate cannot cross tenants. This gate gives ergonomic,
 * early, typed rejection + the server-resolved org_id.
 */
export interface OrgContext {
  userId: string;
  orgId: string;
  role: string;
  capabilities: Capability[];
}

/**
 * Resolve the caller's single active org membership. (Multi-org switching is a
 * later wave; the 3-person property is single-org. If a user belongs to >1 org,
 * this returns the first — an explicit active-org selector lands with that wave.)
 */
export async function resolveOrgContext(): Promise<OrgContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('org_members')
    .select('org_id, role, capabilities')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  return {
    userId: user.id,
    orgId: data.org_id as string,
    role: data.role as string,
    capabilities: (data.capabilities ?? []) as Capability[],
  };
}

export function hasCapability(ctx: OrgContext, cap: Capability): boolean {
  return ctx.capabilities.includes(cap);
}
