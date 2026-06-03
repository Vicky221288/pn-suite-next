type Tone = 'default' | 'muted' | 'brand' | 'success';

const COLOR: Record<Tone, string> = {
  default: 'var(--color-text)',
  muted: 'var(--color-text-tertiary)',
  brand: 'var(--color-brand)',
  success: 'var(--color-success)',
};

/**
 * InfoRow — a label↔value definition row (dt/dd): quiet tertiary label on the
 * left, value on the right with optional `mono` (money/qty/dates), `strong`
 * weight, and a `tone` (brand for totals, success for margin, muted for asides).
 * The shared building block for every detail/summary/money card — reused by the
 * catering menu detail and quote summary, and the pattern future detail screens
 * (and a later refactor of the Enquiries/folio inline rows) inherit.
 */
export function InfoRow({
  label, value, mono = false, strong = false, tone = 'default',
}: {
  label: React.ReactNode; value: React.ReactNode; mono?: boolean; strong?: boolean; tone?: Tone;
}) {
  return (
    <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-4)' }}>
      <dt style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>{label}</dt>
      <dd style={{ fontSize: 'var(--text-sm)', fontWeight: strong ? 700 : 500, fontFamily: mono ? 'var(--font-mono)' : undefined, color: COLOR[tone], textAlign: 'right' }}>{value}</dd>
    </div>
  );
}
