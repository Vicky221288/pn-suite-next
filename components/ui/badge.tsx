type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';

const TONES: Record<Tone, { bg: string; text: string; border: string }> = {
  success: { bg: 'var(--badge-success-bg)', text: 'var(--badge-success-text)', border: 'transparent' },
  warning: { bg: 'var(--badge-warning-bg)', text: 'var(--badge-warning-text)', border: 'transparent' },
  danger: { bg: 'var(--badge-danger-bg)', text: 'var(--badge-danger-text)', border: 'transparent' },
  info: { bg: 'var(--badge-info-bg)', text: 'var(--badge-info-text)', border: 'transparent' },
  brand: { bg: 'var(--color-brand-subtle)', text: 'var(--color-brand)', border: 'var(--color-brand-border)' },
  neutral: { bg: 'var(--color-surface-sunken)', text: 'var(--color-text-secondary)', border: 'var(--color-border)' },
};

/** Map a domain status string → a badge tone (shared across screens). */
export function toneForStatus(status: string): Tone {
  const s = status.toLowerCase();
  if (/(paid|approved|confirmed|completed|won|resolved|settled|sent|active|checked_in|inspected|clean|published|converted)/.test(s)) return 'success';
  if (/(pending|draft|due|reserved|in_progress|scheduled|acknowledged|qualifying|new|dirty|deferred|hold)/.test(s)) return 'warning';
  if (/(cancelled|rejected|overdue|no_show|failed|void|out_of_order|lost|expired)/.test(s)) return 'danger';
  return 'neutral';
}

/** Status pill — small-caps, tinted, AA-checked token pairs. */
export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: Tone }) {
  const t = TONES[tone];
  return (
    <span
      className="inline-flex items-center"
      style={{ fontSize: 'var(--text-xs)', fontWeight: 600, lineHeight: 1.4, color: t.text, background: t.bg, border: `1px solid ${t.border}`, borderRadius: 'var(--radius-full)', padding: '1px 9px', whiteSpace: 'nowrap', letterSpacing: '0.01em' }}
    >
      {children}
    </span>
  );
}

/** Status pill that auto-tones from the status string. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={toneForStatus(status)}>{status.replace(/_/g, ' ')}</Badge>;
}
