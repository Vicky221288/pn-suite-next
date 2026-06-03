import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

/**
 * DetailHeader — the locked header treatment for every DETAIL screen: a back
 * link, a gold eyebrow, a Playfair title, an optional status node (a StatusBadge)
 * + meta on the right, over a champagne-gold hairline. The detail-screen sibling
 * of PageHeader; every list→detail surface inherits this.
 */
export function DetailHeader({
  backHref, backLabel = 'Back', eyebrow, title, status, meta,
}: {
  backHref: string; backLabel?: string; eyebrow?: React.ReactNode; title: React.ReactNode; status?: React.ReactNode; meta?: React.ReactNode;
}) {
  return (
    <header style={{ marginBottom: 'var(--space-2)' }}>
      <Link href={backHref} className="inline-flex items-center" style={{ gap: 4, fontSize: 'var(--text-sm)', color: 'var(--color-brand)', fontWeight: 500, marginBottom: 'var(--space-3)' }}>
        <ChevronLeft size={15} /> {backLabel}
      </Link>
      <div className="flex flex-wrap items-start justify-between" style={{ gap: 'var(--space-3)' }}>
        <div className="min-w-0">
          {eyebrow && <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase', color: 'var(--color-accent-ceremonial)' }}>{eyebrow}</div>}
          <h1 className="font-display" style={{ fontSize: 'var(--text-2xl)', lineHeight: 1.1, color: 'var(--color-text)', marginTop: 2, letterSpacing: 'var(--tracking-tight)' }}>{title}</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end" style={{ gap: 'var(--space-3)' }}>
          {meta && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{meta}</span>}
          {status}
        </div>
      </div>
      <div aria-hidden style={{ height: 2, marginTop: 'var(--space-4)', borderRadius: 'var(--radius-full)', background: 'linear-gradient(90deg, var(--color-accent-ceremonial), color-mix(in srgb, var(--color-accent-ceremonial) 15%, transparent) 60%, transparent)' }} />
    </header>
  );
}
