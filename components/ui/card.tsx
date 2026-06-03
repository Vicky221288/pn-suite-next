import { cn } from '@/lib/utils';

/**
 * Card — the surface primitive every screen reuses. Token-driven (reads
 * --card-*). Elevation tiers (`elevated` → shadow-md for a dominant/primary
 * surface), an optional 2px champagne-gold top accent (`accent`, the "this
 * matters" cue), a structured header (title/eyebrow/subtitle/actions) over a
 * hairline, and an optional hover lift. Body padding on by default.
 */
export function Card({
  title, eyebrow, subtitle, actions, padded = true, hover = false, elevated = false, accent = false, className, style, children,
}: {
  title?: React.ReactNode; eyebrow?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode;
  padded?: boolean; hover?: boolean; elevated?: boolean; accent?: boolean;
  className?: string; style?: React.CSSProperties; children?: React.ReactNode;
}) {
  return (
    <section
      className={cn(hover && 'pn-hover-lift', className)}
      style={{
        position: 'relative',
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 'var(--card-radius)',
        boxShadow: elevated ? 'var(--shadow-md)' : 'var(--card-shadow)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {accent && (
        <span aria-hidden style={{ position: 'absolute', insetInline: 0, top: 0, height: 2, background: 'linear-gradient(90deg, var(--color-accent-ceremonial), color-mix(in srgb, var(--color-accent-ceremonial) 35%, transparent))' }} />
      )}
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3" style={{ padding: 'var(--space-4) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
          <div className="min-w-0">
            {eyebrow && <div style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 2 }}>{eyebrow}</div>}
            {title && <h2 className="truncate" style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.25 }}>{title}</h2>}
            {subtitle && <p className="truncate" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 1 }}>{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div style={{ padding: padded ? 'var(--card-pad)' : 0 }}>{children}</div>
    </section>
  );
}
