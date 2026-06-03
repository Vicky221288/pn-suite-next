'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { assignEventStaff, setEventStaffStatus } from '@/lib/actions/hall';

interface RosterRow { id: string; role_on_event: string | null; status: string; staff: { name: string } | null }
interface Staff { id: string; name: string }
const NEXT: Record<string, 'assigned' | 'confirmed' | 'checked_in' | 'no_show'> = { assigned: 'confirmed', confirmed: 'checked_in', checked_in: 'checked_in' };
const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };

/** Assign W0 staff to the event + advance roster status. */
export function RosterPanel({ eventId, roster, staff }: { eventId: string; roster: RosterRow[]; staff: Staff[] }) {
  const router = useRouter();
  const [staffId, setStaffId] = useState(staff[0]?.id ?? '');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
      {roster.length === 0 ? (
        <EmptyState icon={UserPlus} title="No staff assigned" message="Assign on-shift staff to this event below and advance each through confirmed → checked in." />
      ) : (
        <ul className="flex flex-col" style={{ borderTop: '1px solid var(--color-divider)' }}>
          {roster.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--color-divider)' }}>
              <div className="min-w-0 flex items-center" style={{ gap: 'var(--space-2)' }}>
                <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{r.staff?.name ?? '—'}</span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{r.role_on_event ?? '—'}</span>
              </div>
              <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                <StatusBadge status={r.status} />
                {r.status !== 'checked_in' && <Button variant="secondary" onClick={() => run(() => setEventStaffStatus({ eventStaffId: r.id, status: NEXT[r.status] ?? 'confirmed' }))} disabled={busy}>→ {(NEXT[r.status] ?? 'confirmed').replace(/_/g, ' ')}</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {staff.length > 0 && (
        <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={field} aria-label="Staff">{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="role" style={{ ...field, width: 130 }} aria-label="Role" />
          <Button onClick={() => run(() => assignEventStaff({ eventId, staffId, role: role || undefined }))} disabled={busy || !staffId}><UserPlus size={15} /> Assign</Button>
        </div>
      )}

      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}
    </div>
  );
}
