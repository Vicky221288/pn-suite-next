import { getRoleContext } from '@/lib/auth/context';
import { asOfIST } from '@/lib/today/date-utils';
import { PingButton } from '@/components/ping-button';

/**
 * Today — the role-aware command surface (OP MODEL §8). B0 ships a real but
 * minimal version: the freshness stamp convention, a token showcase proving the
 * Maroon Meridian theme renders (light + dark), and the audit-probe button that
 * exercises the wrapper + loud audit util end-to-end (B0 exit criterion).
 * The role-routed composition bodies are built in the spine wave.
 */
export default async function TodayPage() {
  const ctx = await getRoleContext();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>
          Today
        </h1>
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {asOfIST()}
        </span>
      </div>

      <Card title="Foundation status">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Phase B0 scaffold is live. Signed in as{' '}
          <span style={{ fontFamily: 'var(--font-mono)' }}>{ctx?.email ?? 'unknown'}</span>. The
          spine (Enquiry → Booking → Event → Settlement) arrives after B1–B4.
        </p>
      </Card>

      <Card title="Audit probe (B0 exit criterion)">
        <p className="mb-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Fires <code style={{ fontFamily: 'var(--font-mono)' }}>system.ping</code> through the
          action wrapper, writing two audit rows (attempted → completed). Requires the{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>audit_log</code> table (schema phase).
        </p>
        <PingButton />
      </Card>

      <Card title="Token showcase">
        <div className="flex flex-wrap items-center gap-2">
          <Badge bg="--color-success-bg" fg="--color-success">Confirmed</Badge>
          <Badge bg="--color-warning-bg" fg="--color-warning">Due</Badge>
          <Badge bg="--color-danger-bg" fg="--color-danger">Overdue</Badge>
          <Badge bg="--color-info-bg" fg="--color-info">Info</Badge>
        </div>
        <p className="mt-3 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          Toggle the theme (top-right) — every surface re-values from the same semantic tokens.
        </p>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 'var(--card-radius)',
        boxShadow: 'var(--card-shadow)',
        padding: 'var(--card-pad)',
      }}
    >
      <h2 className="mb-2 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Badge({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span
      className="text-xs"
      style={{
        background: `var(${bg})`,
        color: `var(${fg})`,
        borderRadius: 'var(--radius-full)',
        padding: '2px 10px',
        fontWeight: 'var(--weight-medium)' as unknown as number,
      }}
    >
      {children}
    </span>
  );
}
