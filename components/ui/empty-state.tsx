import type { LucideIcon } from 'lucide-react';

/**
 * EmptyState — a genuinely useful "nothing here yet" surface (not a sad sentence):
 * a tinted icon, a clear title, a one-line why, and optional actions/children.
 */
export function EmptyState({
  icon: Icon, title, message, children,
}: {
  icon?: LucideIcon; title: string; message?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center" style={{ padding: 'var(--space-7) var(--space-5)' }}>
      {Icon && (
        <span aria-hidden style={{ width: 52, height: 52, borderRadius: 'var(--radius-full)', background: 'var(--color-brand-subtle)', color: 'var(--color-brand)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-4)' }}>
          <Icon size={24} />
        </span>
      )}
      <h3 className="font-display" style={{ fontSize: 'var(--text-xl)', color: 'var(--color-text)' }}>{title}</h3>
      {message && <p style={{ marginTop: 'var(--space-2)', maxWidth: '38ch', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{message}</p>}
      {children && <div style={{ marginTop: 'var(--space-5)' }}>{children}</div>}
    </div>
  );
}
