/**
 * Centralised, validated environment access.
 *
 * Why: the legacy build read env ad hoc and only warned on missing config
 * (AUDIT-2.0 L8). Here, access is validated — but LAZILY (via getters), so that
 * importing this module never throws. Validation fires on first *use*, which
 * means the account-independent build/typecheck/lint pass without keys (B0),
 * while any real request without keys fails loudly (gate-1).
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env.local and fill PN's Supabase values (gate-1).`,
    );
  }
  return value;
}

/** Browser-safe public config. Safe to import anywhere; validates on access. */
export const publicEnv = {
  get supabaseUrl(): string {
    return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey(): string {
    return required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
} as const;

/**
 * Server-only secret accessor. Call ONLY from server code (the admin client).
 * Importing into a client component is blocked by the 'server-only' guard in the
 * caller (lib/supabase/admin.ts).
 */
export function getServiceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
}
