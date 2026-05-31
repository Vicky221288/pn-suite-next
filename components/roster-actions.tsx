'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { assignEventStaff, setEventStaffStatus } from '@/lib/actions/hall';

interface RosterRow { id: string; role_on_event: string | null; status: string; staff: { name: string } | null }
interface Staff { id: string; name: string }
const NEXT: Record<string, 'assigned' | 'confirmed' | 'checked_in' | 'no_show'> = { assigned: 'confirmed', confirmed: 'checked_in', checked_in: 'checked_in' };

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
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {roster.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-1 text-sm" style={{ borderBottom: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
            <span>{r.staff?.name ?? '—'} <span style={{ color: 'var(--color-text-tertiary)' }}>· {r.role_on_event ?? '—'}</span></span>
            <span className="flex items-center gap-2"><b style={{ color: r.status === 'checked_in' ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>{r.status}</b>
              {r.status !== 'checked_in' && <Button onClick={() => run(() => setEventStaffStatus({ eventStaffId: r.id, status: NEXT[r.status] ?? 'confirmed' }))} disabled={busy}>→ {NEXT[r.status]}</Button>}
            </span>
          </li>
        ))}
      </ul>
      {staff.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={i} aria-label="Staff">{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="role" style={{ ...i, width: 120 }} aria-label="Role" />
          <Button onClick={() => run(() => assignEventStaff({ eventId, staffId, role: role || undefined }))} disabled={busy || !staffId}>Assign</Button>
        </div>
      )}
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </div>
  );
}
