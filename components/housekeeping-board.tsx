'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  setHousekeepingStatus, assignHousekeepingTask, completeHousekeepingTask,
  createMaintenanceRequest, setMaintenanceStatus, setRoomOutOfOrder, restoreRoom,
} from '@/lib/actions/stays';

interface BoardRoom { room_id: string; number: string; service_status: string; housekeeping_status: string; occupied: boolean; sellable: boolean }
interface Task { id: string; kind: string; status: string; requires_photo: boolean; room_id: string; rooms: { number: string } | null; staff: { name: string } | null }
interface Maint { id: string; description: string; priority: string; status: string; room_id: string; rooms: { number: string } | null }
interface Staff { id: string; name: string }

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
const hkColour = (s: string) => ({ clean: 'var(--color-success)', inspected: 'var(--color-success)', dirty: 'var(--color-danger)', out_of_order: 'var(--color-text-tertiary)' }[s] ?? 'var(--color-text)');

export function HousekeepingBoard({ board, tasks, maint, staff }: { board: BoardRoom[]; tasks: Task[]; maint: Maint[]; staff: Staff[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});
  const [mDesc, setMDesc] = useState('');
  const [mRoom, setMRoom] = useState(board[0]?.room_id ?? '');
  const [mPri, setMPri] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, reset?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) { reset?.(); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }
  async function completeTurn(t: Task) {
    let ref: string | undefined;
    if (t.requires_photo) { ref = typeof window !== 'undefined' ? (window.prompt('Photo reference — required for this turn:') ?? undefined) : undefined; if (!ref) { setMsg('Photo-proof required.'); return; } }
    run(() => completeHousekeepingTask({ taskId: t.id, photoRef: ref, result: 'inspected' }));
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Room status board */}
      <section style={card}>
        <h2 style={h2}>Room status board</h2>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
          {board.map((r) => (
            <div key={r.room_id} style={{ border: '1px solid var(--color-divider)', borderRadius: 8, padding: '8px 10px' }}>
              <div className="flex items-center justify-between">
                <span className="font-semibold" style={{ color: 'var(--color-text)' }}>#{r.number}</span>
                {r.sellable ? <span title="sellable" style={{ color: 'var(--color-success)' }}>● ready</span> : <span style={{ color: 'var(--color-text-tertiary)' }}>○</span>}
              </div>
              <div className="text-xs" style={{ color: r.occupied ? 'var(--color-brand)' : 'var(--color-text-tertiary)' }}>{r.occupied ? 'occupied' : 'vacant'}</div>
              <div className="text-xs" style={{ color: hkColour(r.housekeeping_status) }}>{r.housekeeping_status}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {['clean', 'dirty', 'inspected'].map((s) => <button key={s} onClick={() => run(() => setHousekeepingStatus({ roomId: r.room_id, status: s as 'clean' | 'dirty' | 'inspected' }))} className="text-xs" style={{ color: 'var(--color-brand)' }} disabled={busy}>{s}</button>)}
                {r.housekeeping_status === 'out_of_order'
                  ? <button onClick={() => run(() => restoreRoom({ roomId: r.room_id }))} className="text-xs" style={{ color: 'var(--color-brand)' }} disabled={busy}>restore</button>
                  : <button onClick={() => run(() => setRoomOutOfOrder({ roomId: r.room_id }))} className="text-xs" style={{ color: 'var(--color-danger)' }} disabled={busy}>OOO</button>}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Turn queue */}
      <section style={card}>
        <h2 style={h2}>Housekeeping turns</h2>
        {tasks.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No open turns.</p> : (
          <ul className="flex flex-col">
            {tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm" style={{ borderBottom: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span>#{t.rooms?.number ?? '—'} · {t.kind} {t.requires_photo && <span title="photo required">📷</span>} <span style={{ color: 'var(--color-text-tertiary)' }}>· {t.status}{t.staff ? ` · ${t.staff.name}` : ''}</span></span>
                <span className="flex items-center gap-2">
                  <select value={assignTo[t.id] ?? ''} onChange={(e) => setAssignTo((p) => ({ ...p, [t.id]: e.target.value }))} style={i} aria-label="Assign staff">
                    <option value="">assign…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {assignTo[t.id] && <Button onClick={() => run(() => assignHousekeepingTask({ taskId: t.id, staffId: assignTo[t.id]! }))} disabled={busy}>Assign</Button>}
                  <Button onClick={() => completeTurn(t)} disabled={busy}>Complete</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Maintenance log */}
      <section style={card}>
        <h2 style={h2}>Maintenance</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select value={mRoom} onChange={(e) => setMRoom(e.target.value)} style={i} aria-label="Room">{board.map((r) => <option key={r.room_id} value={r.room_id}>#{r.number}</option>)}</select>
          <input value={mDesc} onChange={(e) => setMDesc(e.target.value)} placeholder="Issue description" style={{ ...i, width: 200 }} aria-label="Description" />
          <select value={mPri} onChange={(e) => setMPri(e.target.value as 'low' | 'medium' | 'high' | 'critical')} style={i} aria-label="Priority">
            {['low', 'medium', 'high', 'critical'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <Button onClick={() => run(() => createMaintenanceRequest({ roomId: mRoom, description: mDesc, priority: mPri }), () => setMDesc(''))} disabled={busy || !mRoom || !mDesc}>Log issue</Button>
        </div>
        {maint.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No open issues.</p> : (
          <ul className="flex flex-col">
            {maint.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm" style={{ borderBottom: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span>#{m.rooms?.number ?? '—'} · {m.description} <span style={{ color: m.priority === 'critical' ? 'var(--color-danger)' : 'var(--color-text-tertiary)' }}>· {m.priority}</span> <span style={{ color: 'var(--color-text-tertiary)' }}>· {m.status}</span></span>
                <span className="flex items-center gap-2">
                  {m.status === 'open' && <Button onClick={() => run(() => setMaintenanceStatus({ requestId: m.id, status: 'in_progress' }))} disabled={busy}>Start</Button>}
                  {m.status !== 'resolved' && <Button onClick={() => run(() => setMaintenanceStatus({ requestId: m.id, status: 'resolved' }))} disabled={busy}>Resolve</Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
      </section>
    </div>
  );
}
