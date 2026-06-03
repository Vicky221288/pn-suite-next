import type { LucideIcon } from 'lucide-react';

type Tone = 'default' | 'danger' | 'success' | 'brand';

const VALUE_COLOR: Record<Tone, string> = {
  default: 'var(--color-text)',
  danger: 'var(--color-danger)',
  success: 'var(--color-success)',
  brand: 'var(--color-brand)',
};

/**
 * StatCard — a KPI tile. Editorial contrast: a quiet uppercase label, a large
 * figure (Playfair display by default; `mono` for precise money/figures), a
 * token-tinted icon chip, and a hairline-separated hint line. One orchestrated
 * staggered reveal via `delay`. Danger tone tints the chip + figure for alerts.
 */
export function StatCard({
  label, value, tone = 'default', icon: Icon, hint, mono = false, delay = 0,
}: {
  label: string; value: string; tone?: Tone; icon?: LucideIcon; hint?: string; mono?: boolean; delay?: number;
}) {
  const alert = tone === 'danger';
  return (
    <div
      className="pn-rise pn-hover-lift"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)', animationDelay: `${delay}ms`, display: 'flex', flexDirection: 'column' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', fontWeight: 600 }}>{label}</div>
        {Icon && (
          <span aria-hidden style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 'var(--radius-md)', background: alert ? 'var(--color-danger-bg)' : 'var(--color-brand-subtle)', color: alert ? 'var(--color-danger)' : 'var(--color-brand)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${alert ? 'color-mix(in srgb, var(--color-danger) 22%, transparent)' : 'var(--color-brand-border)'}` }}>
            <Icon size={16} />
          </span>
        )}
      </div>
      <div
        className={mono ? '' : 'font-display'}
        style={{ marginTop: 'var(--space-4)', fontSize: mono ? 'var(--text-2xl)' : 'var(--text-3xl)', fontFamily: mono ? 'var(--font-mono)' : undefined, fontWeight: mono ? 500 : undefined, lineHeight: 1.0, color: VALUE_COLOR[tone], letterSpacing: mono ? '-0.02em' : 'var(--tracking-tight)' }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-divider)', fontSize: 'var(--text-xs)', color: alert ? 'var(--color-danger)' : 'var(--color-text-tertiary)' }}>{hint}</div>
      )}
    </div>
  );
}
