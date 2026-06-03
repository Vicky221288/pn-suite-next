'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, LogOut } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { NAV, activeHref } from './nav-config';

/**
 * The persistent app shell — a maroon-Meridian operational rail + header. Visual
 * only: pure navigation chrome over the existing routes. Persistent on desktop,
 * off-canvas drawer on mobile (staff use phones on the floor).
 */
export function AppShell({ orgName, email, role, children }: { orgName: string; email: string; role: string | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = activeHref(pathname);
  const roleLabel = role ? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Member';

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)' }}>
      {open && <div className="pn-scrim" onClick={() => setOpen(false)} aria-hidden />}

      <aside className="pn-sidebar" data-open={open}>
        <Brand orgName={orgName} onClose={() => setOpen(false)} />
        <nav className="pn-scroll flex-1 overflow-y-auto px-3 pb-6" aria-label="Primary">
          {NAV.map((group) => (
            <div key={group.label} className="mb-1">
              <div className="pn-nav-group-label">{group.label}</div>
              {group.items.map((it) => {
                const Icon = it.icon;
                const isActive = active === it.href;
                return (
                  <Link key={it.href} href={it.href} className="pn-nav-item" data-active={isActive} onClick={() => setOpen(false)}>
                    <Icon size={16} strokeWidth={2} aria-hidden style={{ flexShrink: 0, opacity: isActive ? 1 : 0.75 }} />
                    <span className="truncate">{it.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="px-3 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            Maroon Meridian · v1
          </p>
        </div>
      </aside>

      <div className="pn-app-main flex min-h-dvh flex-col">
        <header
          className="sticky top-0 flex items-center gap-3 px-4 sm:px-6"
          style={{ height: 'var(--topbar-h)', background: 'color-mix(in srgb, var(--color-surface) 88%, transparent)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--color-border)', zIndex: 'var(--z-sticky)' }}
        >
          <button type="button" className="pn-menu-btn inline-flex items-center justify-center" onClick={() => setOpen(true)} aria-label="Open navigation" style={{ width: 36, height: 36, color: 'var(--color-text-secondary)' }}>
            <Menu size={20} />
          </button>
          <div className="lg:hidden font-display text-base" style={{ color: 'var(--color-brand)' }}>{orgName}</div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{email}</span>
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{orgName}</span>
            </div>
            <span
              className="hidden sm:inline-flex items-center"
              style={{ fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase', color: 'var(--color-brand)', background: 'var(--color-brand-subtle)', border: '1px solid var(--color-brand-border)', borderRadius: 'var(--radius-full)', padding: '2px 10px' }}
            >
              {roleLabel}
            </span>
            <ThemeToggle />
            <form action="/auth/signout" method="post">
              <button type="submit" aria-label="Sign out" className="inline-flex items-center justify-center" style={{ width: 36, height: 36, color: 'var(--color-text-secondary)' }}>
                <LogOut size={18} />
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto w-full flex-1 px-4 py-6 sm:px-6 sm:py-8" style={{ maxWidth: 'var(--content-max)' }}>
          {children}
        </main>
      </div>
    </div>
  );
}

function Brand({ orgName, onClose }: { orgName: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4" style={{ height: 'var(--topbar-h)', borderBottom: '1px solid var(--color-border)' }}>
      <span aria-hidden style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 'var(--radius-md)', background: 'var(--color-brand)', color: 'var(--color-text-on-brand)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: '1rem', boxShadow: 'var(--shadow-sm)' }}>
        PN
      </span>
      <div className="min-w-0 leading-tight">
        <div className="font-display truncate" style={{ fontSize: 'var(--text-lg)', color: 'var(--color-text)' }}>{orgName}</div>
        <div className="text-xs truncate" style={{ color: 'var(--color-accent-ceremonial)', letterSpacing: 'var(--tracking-wide)' }}>HOSPITALITY OS</div>
      </div>
      <button type="button" className="lg:hidden ml-auto" onClick={onClose} aria-label="Close navigation" style={{ color: 'var(--color-text-secondary)' }}>
        <X size={20} />
      </button>
    </div>
  );
}
