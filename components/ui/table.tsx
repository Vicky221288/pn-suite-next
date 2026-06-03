import { cn } from '@/lib/utils';

/**
 * Data-grid primitives — the CRM workhorse. Token-driven (reads --table-*), sticky
 * tinted header, hover-tinted rows, comfortable row height. Wrap in <Card padded={false}>.
 */
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="pn-scroll w-full overflow-x-auto">
      <table className={cn('w-full border-collapse', className)} style={{ fontSize: 'var(--text-sm)' }}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead style={{ background: 'var(--table-header-bg)' }}>{children}</thead>;
}

export function TH({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th style={{ textAlign: align, padding: 'var(--space-2) var(--space-4)', color: 'var(--table-header-text)', fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase', borderBottom: '1px solid var(--table-border)', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );
}

export function TR({ children }: { children: React.ReactNode }) {
  return <tr className="pn-tr">{children}</tr>;
}

export function TD({ children, align = 'left', mono = false }: { children?: React.ReactNode; align?: 'left' | 'right' | 'center'; mono?: boolean }) {
  return (
    <td style={{ textAlign: align, padding: 'var(--space-3) var(--space-4)', color: 'var(--color-text)', borderBottom: '1px solid var(--table-border)', fontFamily: mono ? 'var(--font-mono)' : undefined, verticalAlign: 'middle' }}>
      {children}
    </td>
  );
}
