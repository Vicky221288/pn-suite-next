import 'server-only';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { publicEnv, getServiceRoleKey } from '@/lib/env';

/**
 * Service-role admin client — bypasses ALL RLS.
 *
 * ┌─ READ THIS BEFORE USING ─────────────────────────────────────────────────┐
 * │ The 'server-only' import at the top makes any client-side import a build   │
 * │ error (REUSE-ANALYSIS #2 / OP MODEL §10). The service-role key is the      │
 * │ master key to the database.                                               │
 * │                                                                           │
 * │ RULES (non-negotiable, carried from rhs-crm-next + hardened for tenancy): │
 * │  1. NEVER import this into a client component or a non-server module.      │
 * │  2. NEVER use it for READS — reads use the RLS-enforced user client.       │
 * │  3. Use it ONLY inside the action wrapper (lib/actions/wrapper.ts), AFTER  │
 * │     authorization, and ALWAYS scope every query by org_id. Because RLS is  │
 * │     bypassed, a missing org_id filter is a cross-tenant data leak          │
 * │     (AUDIT-2.0 F-SEC-04). Prefer calling an atomic, org-checked Postgres   │
 * │     RPC (OP MODEL inv. #1) over raw table writes from here.                │
 * └───────────────────────────────────────────────────────────────────────────┘
 */
export function createAdminClient() {
  return createServiceClient(publicEnv.supabaseUrl, getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
