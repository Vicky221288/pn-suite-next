import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';

/**
 * Session refresh + route guard for Next.js middleware.
 *
 * Lifted from rhs-crm-next's @supabase/ssr pattern (REUSE-ANALYSIS #1) and kept
 * deliberately minimal: refresh the session cookie on every request, and bounce
 * unauthenticated users to /login (except public paths). Role-based page gating
 * is intentionally NOT done here yet — it lands with the roles-as-capabilities
 * model in B2. Keeping it out avoids baking single-tenant assumptions in now.
 */
const PUBLIC_PATHS = ['/login', '/auth'];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: getUser() (not getSession()) — it revalidates the token with the
  // auth server. Do not run code between createServerClient and getUser.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/today';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
