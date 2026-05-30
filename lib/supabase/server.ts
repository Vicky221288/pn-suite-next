import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';

/**
 * Server-side Supabase client bound to the request cookies (user session,
 * RLS-enforced). Use in Server Components, Route Handlers, and Server Actions
 * for READS and for resolving the current user.
 *
 * Note: in Server Components the cookie `set` may be a no-op — session refresh
 * is handled in middleware (lib/supabase/middleware.ts). We swallow the set
 * error there per the @supabase/ssr guidance.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component — safe to ignore; middleware refreshes.
        }
      },
    },
  });
}
