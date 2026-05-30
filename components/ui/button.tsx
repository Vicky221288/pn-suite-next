import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const base =
  'inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none';

/**
 * Button — reads component tokens only (tokens.css §7), never raw hex. Variants
 * map to the brand/secondary/danger token sets so a white-label re-skin needs
 * no component change.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', className, style, ...props },
  ref,
) {
  const variantStyle = VARIANT_STYLES[variant];
  return (
    <button
      ref={ref}
      className={cn(base, className)}
      style={{
        borderRadius: 'var(--btn-radius)',
        padding: 'var(--btn-pad-y) var(--btn-pad-x)',
        minHeight: 'var(--tap-min)',
        fontSize: 'var(--text-sm)',
        ...variantStyle,
        ...style,
      }}
      {...props}
    />
  );
});

const VARIANT_STYLES: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' },
  secondary: {
    background: 'var(--btn-secondary-bg)',
    color: 'var(--btn-secondary-text)',
    border: '1px solid var(--btn-secondary-border)',
  },
  ghost: { background: 'transparent', color: 'var(--btn-ghost-text)' },
  danger: { background: 'var(--btn-danger-bg)', color: 'var(--color-text-on-brand)' },
};
