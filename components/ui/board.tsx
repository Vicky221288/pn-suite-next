type Accent = 'neutral' | 'success' | 'danger' | 'brand' | 'warning';

const BAR: Record<Accent, string> = {
  neutral: 'transparent',
  success: 'var(--color-success)',
  danger: 'var(--color-danger)',
  brand: 'var(--color-brand)',
  warning: 'var(--color-warning)',
};

/**
 * Board / BoardCell — a responsive status-grid primitive (room board, and any
 * tile-grid of statused entities). Auto-fill cells that read at a glance and
 * reflow cleanly on a phone. A BoardCell has a title, an optional top-right badge,
 * a body, an optional footer action row, and an optional left accent bar keyed to
 * status. Reused by Housekeeping (room board) and Rooms (inventory grid); future
 * boards (channel-manager availability, etc.) inherit it.
 */
export function Board({ children, min = '152px' }: { children: React.ReactNode; min?: string }) {
  return (
    <div className="grid" style={{ gap: 'var(--space-3)', gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))` }}>
      {children}
    </div>
  );
}

export function BoardCell({
  title, top, accent = 'neutral', children, actions,
}: {
  title: React.ReactNode; top?: React.ReactNode; accent?: Accent; children?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div
      className="pn-hover-lift"
      style={{ position: 'relative', background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--card-shadow)', padding: 'var(--space-3)', overflow: 'hidden' }}
    >
      {accent !== 'neutral' && <span aria-hidden style={{ position: 'absolute', insetBlock: 0, left: 0, width: 3, background: BAR[accent] }} />}
      <div className="flex items-center justify-between" style={{ gap: 'var(--space-2)' }}>
        <span className="font-display" style={{ fontSize: 'var(--text-lg)', lineHeight: 1.1, color: 'var(--color-text)' }}>{title}</span>
        {top}
      </div>
      {children && <div style={{ marginTop: 'var(--space-2)' }}>{children}</div>}
      {actions && <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-divider)' }}>{actions}</div>}
    </div>
  );
}
