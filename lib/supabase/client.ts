import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/**
 * Browser Supabase client (user session, RLS-enforced).
 *
 * Trust model (REUSE-ANALYSIS #2, lifted from rhs-crm-next, hardened):
 *   - READS go through the user-session client (this one + the server one) so
 *     RLS is always in force — defence in depth.
 *   - WRITES go through the action layer (lib/actions) which uses the
 *     'server-only' admin client AFTER authorization. Never write from here.
 */
export function createClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
