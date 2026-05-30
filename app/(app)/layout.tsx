import { redirect } from 'next/navigation';
import { getRoleContext } from '@/lib/auth/context';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Protected app shell. Server-resolves the user (defence in depth alongside
 * middleware) and renders the topbar. The full role-aware sidebar/nav lands in
 * the spine wave; B0 keeps the shell minimal but real.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRoleContext();
  if (!ctx) redirect('/login');

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className="flex items-center justify-between px-5"
        style={{
          height: 'var(--topbar-h)',
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <span className="font-display text-lg" style={{ color: 'var(--color-brand)' }}>
          PN Master Suite
        </span>
        <div className="flex items-center gap-4">
          <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            {ctx.email}
          </span>
          <ThemeToggle />
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-sm"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full flex-1 px-5 py-6" style={{ maxWidth: 'var(--content-max)' }}>
        {children}
      </main>
    </div>
  );
}
