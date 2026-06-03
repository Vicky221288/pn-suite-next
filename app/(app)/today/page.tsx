import Link from 'next/link';
import {
  CalendarClock, IndianRupee, TriangleAlert, CalendarRange, CheckCircle2, ChevronRight,
  Workflow, DoorOpen, CookingPot, CalendarDays, Users, BarChart3, Eye,
} from 'lucide-react';
import { getRoleContext } from '@/lib/auth/context';
import { createClient } from '@/lib/supabase/server';
import { asOfIST, hourIST, todayIST } from '@/lib/today/date-utils';
import { formatINR } from '@/lib/utils';
import { StatCard } from '@/components/ui/stat-card';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * Today — the role-aware command surface (OP MODEL §8). Reads the SAME B4 builder
 * output (today_snapshots) + getRoleContext as before; this pass is a VISUAL craft
 * re-lay-out into a layered, world-class operational dashboard. RLS-scoped via the
 * user-session client. Forward-compatible: renders an events/exception list if the
 * builder payload ever carries one, else a structured per-region empty state.
 */
interface TodayPayload {
  events_today?: number; money_to_collect?: number; exceptions?: number;
  events?: { time?: string; title?: string; status?: string; detail?: string }[];
  exception_items?: { title?: string; detail?: string }[];
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getRoleContext();
  const supabase = await createClient();

  const { data: snap } = await supabase
    .from('today_snapshots')
    .select('payload, snapshot_date, built_at')
    .eq('role', ctx?.role ?? '')
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  // PREVIEW ONLY (?demo=1): inject realistic sample data into the SAME components
  // so the populated dashboard can be reviewed before the 07:00 builder has run.
  // No DB write, no engine/schema change, no real data touched — drop the param
  // (or delete this branch + DEMO_PAYLOAD) to revert. The real read path is below.
  const sp = await searchParams;
  const demo = sp?.demo === '1' || sp?.demo === 'true';

  const payload = (demo ? DEMO_PAYLOAD : (snap?.payload ?? {})) as TodayPayload;
  const hasData = demo || !!snap;
  const isFresh = demo || snap?.snapshot_date === todayIST();
  const showMoney = demo || (hasData && 'money_to_collect' in payload);
  const exceptions = payload.exceptions ?? 0;
  const events = payload.events ?? [];
  const exceptionItems = payload.exception_items ?? [];

  const firstName = ((ctx?.email ?? '').split('@')[0] ?? '').split(/[._]/)[0] ?? '';
  const longDate = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      {demo && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-accent-ceremonial)', background: 'var(--color-brand-subtle)', border: '1px dashed var(--color-brand-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)' }}>
          <Eye size={14} />
          Preview · sample data (not live) — append nothing to drop back to the real briefing.
        </div>
      )}
      {/* ── Header band ──────────────────────────────────────────────────── */}
      <header>
        <div className="flex flex-wrap items-end justify-between" style={{ gap: 'var(--space-4)' }}>
          <div className="min-w-0">
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase', color: 'var(--color-accent-ceremonial)' }}>
              {greet(hourIST())}{firstName ? `, ${cap(firstName)}` : ''}
            </div>
            <h1 className="font-display" style={{ fontSize: 'var(--text-3xl)', lineHeight: 1.05, color: 'var(--color-text)', marginTop: 2, letterSpacing: 'var(--tracking-tight)' }}>Today</h1>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)' }}>{longDate}</p>
          </div>
          <div className="flex flex-col items-end" style={{ gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{asOfIST()}</span>
            <span className="inline-flex items-center" style={{ gap: 6, fontSize: 'var(--text-xs)', fontWeight: 600, color: isFresh ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: isFresh ? 'var(--color-success)' : 'var(--color-text-tertiary)', boxShadow: isFresh ? '0 0 0 3px var(--color-success-bg)' : 'none' }} />
              {isFresh ? 'Briefing live' : 'Builds 07:00 IST'}
            </span>
          </div>
        </div>
        <div aria-hidden style={{ height: 2, marginTop: 'var(--space-4)', borderRadius: 'var(--radius-full)', background: 'linear-gradient(90deg, var(--color-accent-ceremonial), color-mix(in srgb, var(--color-accent-ceremonial) 15%, transparent) 60%, transparent)' }} />
      </header>

      {!hasData && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)' }}>
          <CalendarClock size={14} style={{ color: 'var(--color-accent-ceremonial)' }} />
          Your role&apos;s briefing assembles at 07:00 IST. Until then, the floor is one tap away below.
        </div>
      )}
      {hasData && !isFresh && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-warning)', background: 'var(--color-warning-bg)', border: '1px solid color-mix(in srgb, var(--color-warning) 28%, transparent)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)' }}>
          <TriangleAlert size={14} />
          Showing {snap?.snapshot_date} — today&apos;s 07:00 build is pending.
        </div>
      )}

      {/* ── KPI strip — the operational headline ─────────────────────────── */}
      <div className="grid" style={{ gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <StatCard label="Events today" value={hasData ? String(payload.events_today ?? 0) : '—'} icon={CalendarClock} hint={hasData ? 'on the schedule' : 'builds at 07:00'} delay={0} />
        {showMoney && <StatCard label="Money to collect" value={formatINR(payload.money_to_collect ?? 0)} icon={IndianRupee} tone="brand" mono hint="outstanding today" delay={70} />}
        <StatCard label="Exceptions / SLA" value={hasData ? String(exceptions) : '—'} icon={TriangleAlert} tone={exceptions ? 'danger' : 'success'} hint={!hasData ? 'builds at 07:00' : exceptions ? 'need attention' : 'all clear'} delay={140} />
      </div>

      {/* ── Main: dominant schedule (left) + attention & actions (right) ──── */}
      <div className="grid" style={{ gap: 'var(--space-6)', gridTemplateColumns: '1fr' }}>
        <div className="grid pn-today-main" style={{ gap: 'var(--space-6)' }}>
          {/* LEFT — primary surface */}
          <Card
            elevated accent padded={false}
            eyebrow="Operational status"
            title="Today's schedule"
            subtitle={hasData ? `${payload.events_today ?? 0} event${(payload.events_today ?? 0) === 1 ? '' : 's'} across the property` : 'awaiting the morning build'}
            actions={<Link href="/calendar" className="inline-flex items-center gap-1" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-brand)', fontWeight: 500 }}>Calendar<ChevronRight size={14} /></Link>}
          >
            {events.length > 0 ? (
              <ul>
                {events.map((e, i) => (
                  <li key={i} className="pn-tr flex items-center" style={{ gap: 'var(--space-4)', padding: 'var(--space-3) var(--card-pad)', borderBottom: i < events.length - 1 ? '1px solid var(--color-divider)' : 'none' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', width: 64, flexShrink: 0 }}>{e.time ?? '—'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="truncate block" style={{ fontWeight: 500, color: 'var(--color-text)' }}>{e.title ?? 'Event'}</span>
                      {e.detail && <span className="truncate block" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{e.detail}</span>}
                    </span>
                    {e.status && <Badge tone="neutral">{e.status}</Badge>}
                  </li>
                ))}
              </ul>
            ) : (
              <RegionEmpty icon={CalendarRange} title="No events on the books today" message="Confirmed bookings and room blocks for today will appear here as a timeline." href="/enquiries" cta="Open the pipeline" />
            )}
          </Card>

          {/* RIGHT — attention + quick actions */}
          <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
            <Card title="Needs attention" subtitle="SLA breaches & flags" padded={false}>
              {exceptionItems.length > 0 ? (
                <ul>
                  {exceptionItems.map((x, i) => (
                    <li key={i} className="flex items-start" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) var(--card-pad)', borderBottom: i < exceptionItems.length - 1 ? '1px solid var(--color-divider)' : 'none' }}>
                      <TriangleAlert size={15} style={{ color: 'var(--color-danger)', flexShrink: 0, marginTop: 2 }} />
                      <span className="min-w-0">
                        <span className="block" style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text)' }}>{x.title ?? 'Exception'}</span>
                        {x.detail && <span className="block" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{x.detail}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : exceptions > 0 ? (
                <div className="flex items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-4) var(--card-pad)' }}>
                  <span className="inline-flex items-center" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                    <TriangleAlert size={16} style={{ color: 'var(--color-danger)' }} />
                    <b className="font-display" style={{ fontSize: 'var(--text-lg)' }}>{exceptions}</b> item{exceptions === 1 ? '' : 's'} need attention
                  </span>
                  <Link href="/enquiries" className="inline-flex items-center gap-1" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-brand)', fontWeight: 500 }}>Review<ChevronRight size={14} /></Link>
                </div>
              ) : (
                <div className="flex items-center" style={{ gap: 'var(--space-3)', padding: 'var(--space-4) var(--card-pad)' }}>
                  <span aria-hidden style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 'var(--radius-full)', background: 'var(--color-success-bg)', color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><CheckCircle2 size={18} /></span>
                  <span>
                    <span className="block" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>{hasData ? 'All clear' : 'Nothing flagged yet'}</span>
                    <span className="block" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{hasData ? 'No exceptions or SLA breaches.' : 'Flags appear after the 07:00 build.'}</span>
                  </span>
                </div>
              )}
            </Card>

            <Card title="Quick actions" subtitle="Jump to the floor">
              <QuickActions />
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

/* PREVIEW ONLY — sample briefing for ?demo=1 (visual review). Not persisted, not
   the engine; mirrors the shape build_today could enrich the payload to. Remove
   with the demo branch once a live snapshot exists. PN-flavoured, no real PII. */
const DEMO_PAYLOAD: TodayPayload = {
  events_today: 4,
  money_to_collect: 285000,
  exceptions: 2,
  events: [
    { time: '10:00', title: 'Anand & Meera — Wedding · Grand Hall', status: 'confirmed', detail: '500 pax · full day · catering live' },
    { time: '12:30', title: 'Room block · Iyer family (8 rooms)', status: 'checked_in', detail: 'PN Stays · check-out 6 Jun' },
    { time: '18:00', title: 'Sundaram 60th · Banquet Lawn', status: 'confirmed', detail: '220 pax · evening slot' },
    { time: '19:30', title: 'Corporate offsite dinner · Catering', status: 'in_progress', detail: 'KOT running · 80 plates' },
  ],
  exception_items: [
    { title: 'Follow-up overdue · Rajan enquiry', detail: 'No follow-up in 2h — SLA breach (A2)' },
    { title: 'Balance due T-45 · Anand & Meera', detail: '₹1,20,000 balance reminder pending' },
  ],
};

const ACTIONS = [
  { label: 'New enquiry', href: '/enquiries', icon: Workflow },
  { label: 'Front desk', href: '/stays/frontdesk', icon: DoorOpen },
  { label: 'Production', href: '/catering/production', icon: CookingPot },
  { label: 'Calendar', href: '/calendar', icon: CalendarDays },
  { label: 'Guests', href: '/guests', icon: Users },
  { label: 'Reports', href: '/reports', icon: BarChart3 },
];

function QuickActions() {
  return (
    <div className="grid" style={{ gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))' }}>
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className="pn-hover-lift flex items-center"
            style={{ gap: 'var(--space-3)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', color: 'var(--color-text)' }}
          >
            <span aria-hidden style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 'var(--radius-md)', background: 'var(--color-brand-subtle)', color: 'var(--color-brand)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={15} />
            </span>
            <span className="truncate" style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{a.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

function RegionEmpty({ icon: Icon, title, message, href, cta }: { icon: typeof CalendarRange; title: string; message: string; href: string; cta: string }) {
  return (
    <div className="flex flex-col items-center text-center" style={{ padding: 'var(--space-7) var(--space-5)' }}>
      <span aria-hidden style={{ width: 44, height: 44, borderRadius: 'var(--radius-full)', background: 'var(--color-brand-subtle)', color: 'var(--color-brand)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-3)' }}>
        <Icon size={20} />
      </span>
      <h3 className="font-display" style={{ fontSize: 'var(--text-lg)', color: 'var(--color-text)' }}>{title}</h3>
      <p style={{ marginTop: 'var(--space-2)', maxWidth: '40ch', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{message}</p>
      <Link href={href} className="inline-flex items-center gap-1" style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-brand)' }}>{cta}<ChevronRight size={14} /></Link>
    </div>
  );
}

function greet(h: number): string {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
