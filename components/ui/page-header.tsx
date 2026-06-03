/**
 * PageHeader — the consistent top of every surface: an optional eyebrow, a
 * Playfair title, a subtitle, optional right-aligned actions, and an optional
 * meta line (e.g. "as of 07:14 IST"). The page frame the whole app inherits.
 */
export function PageHeader({
  eyebrow, title, subtitle, meta, actions,
}: {
  eyebrow?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3" style={{ marginBottom: 'var(--space-5)' }}>
      <div className="min-w-0">
        {eyebrow && <div className="text-xs" style={{ color: 'var(--color-accent-ceremonial)', letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 'var(--space-1)' }}>{eyebrow}</div>}
        <h1 className="font-display" style={{ fontSize: 'var(--text-2xl)', lineHeight: 1.1, color: 'var(--color-text)' }}>{title}</h1>
        {subtitle && <p style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', maxWidth: '70ch' }}>{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {meta && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{meta}</span>}
        {actions}
      </div>
    </div>
  );
}
