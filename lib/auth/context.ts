import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Role/tenant context resolution.
 *
 * B0 scope: resolve the authenticated user and (if present) their org_id from
 * auth metadata. The full roles-as-capabilities model (OP MODEL §3) and real
 * org-membership resolution land in B2 — this stub deliberately does NOT
 * hardcode any property (inv. #3); orgId is null until membership exists.
 */
export interface RoleContext {
  userId: string;
  email: string | null;
  orgId: string | null;
}

export async function getRoleContext(): Promise<RoleContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    orgId: (user.app_metadata?.org_id as string | undefined) ?? null,
  };
}
