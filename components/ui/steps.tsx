import { Check } from 'lucide-react';

type StepState = 'done' | 'current' | 'todo';
export interface Step { label: string; state: StepState }

/**
 * Steps — a horizontal progress stepper for the spine thread (Enquiry → Quote →
 * Booking → Settlement and any other staged flow). Done = filled maroon w/ check,
 * current = ringed brand, todo = muted. Reusable wherever a record moves through
 * named stages. Token-driven; wraps cleanly on phone.
 */
export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center" style={{ gap: 'var(--space-2)' }}>
          <span className="inline-flex items-center" style={{ gap: 'var(--space-2)' }}>
            <span
              aria-hidden
              style={{
                width: 22, height: 22, flexShrink: 0, borderRadius: 'var(--radius-full)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.6875rem', fontFamily: 'var(--font-mono)', fontWeight: 600,
                background: s.state === 'done' ? 'var(--color-brand)' : s.state === 'current' ? 'var(--color-brand-subtle)' : 'var(--color-surface-sunken)',
                color: s.state === 'done' ? 'var(--color-text-on-brand)' : s.state === 'current' ? 'var(--color-brand)' : 'var(--color-text-tertiary)',
                border: s.state === 'current' ? '1px solid var(--color-brand-border)' : '1px solid transparent',
                boxShadow: s.state === 'current' ? '0 0 0 3px var(--color-brand-subtle)' : 'none',
              }}
            >
              {s.state === 'done' ? <Check size={12} /> : i + 1}
            </span>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: s.state === 'todo' ? 400 : 600, color: s.state === 'todo' ? 'var(--color-text-tertiary)' : 'var(--color-text)' }}>{s.label}</span>
          </span>
          {i < steps.length - 1 && (
            <span aria-hidden style={{ width: 'clamp(16px, 4vw, 40px)', height: 1, background: 'var(--color-border-strong)' }} />
          )}
        </li>
      ))}
    </ol>
  );
}
