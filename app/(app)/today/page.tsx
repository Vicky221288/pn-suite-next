import Link from 'next/link';
import { getRoleContext } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { asOfIST, todayIST } from '@/lib/today/date-utils';
import { formatINR } from '@/lib/utils';

/**
 * Today — the role-aware command surface (OP MODEL §8). B5 wires the real B4
 * Today builder output (today_snapshots) into the home screen: today's events,
 * money to collect (Owner/PM only — §12 #3), and exceptions/SLA breaches.
 * RLS-scoped via the user-session client, so a member only ever sees their org.
 */
export default async function TodayPage() {
  const ctx = await getRoleContext();
  const supabase = await createClient();

  // latest snapshot for this user's role (the B4 builder writes one per day)
  const { data: snap } = await supabase
    .from('today_snapshots')
    .select('payload, snapshot_date, built_at')
    .eq('role', ctx?.role ?? '')
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = (snap?.payload ?? {}) as { events_today?: number; exceptions?: number; money_to_collect?: number };
  const isFresh = snap?.snapshot_date === todayIST();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Today</h1>
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{asOfIST()}</span>
      </div>

      {!snap ? (
        <Card title="No briefing yet">
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            The 07:00 IST builder hasn&apos;t run for your role/org yet. It assembles today&apos;s
            events, money to collect, and exceptions automatically each morning.
          </p>
        </Card>
      ) : (
        <>
          {!isFresh && (
            <p className="text-xs" style={{ color: 'var(--color-warning)' }}>
              Showing the briefing from {snap.snapshot_date} (today&apos;s 07:00 build pending).
            </p>
          )}
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Stat label="Events today" value={String(payload.events_today ?? 0)} />
            {'money_to_collect' in payload && (
              <Stat label="Money to collect" value={formatINR(payload.money_to_collect ?? 0)} />
            )}
            <Stat label="Exceptions / SLA breaches" value={String(payload.exceptions ?? 0)} tone={payload.exceptions ? 'danger' : 'default'} />
          </div>
        </>
      )}

      <Card title="Spine">
        <Link href="/enquiries" className="text-sm" style={{ color: 'var(--color-brand)' }}>
          Enquiries → quote → booking → event → settlement →
        </Link>
        <p className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          Signed in as <span style={{ fontFamily: 'var(--font-mono)' }}>{ctx?.email}</span>
          {ctx?.role ? ` · ${ctx.role}` : ''}
        </p>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' }}>
      <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div className="mt-1 font-display text-2xl" style={{ color: tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text)' }}>{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' }}>
      <h2 className="mb-2 text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{title}</h2>
      {children}
    </section>
  );
}
