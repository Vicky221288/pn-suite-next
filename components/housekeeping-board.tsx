'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert, ClipboardList, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge, StatusBadge, toneForStatus } from '@/components/ui/badge';
import { Board, BoardCell } from '@/components/ui/board';
import { PhotoUpload } from '@/components/photo-upload';
import {
  setHousekeepingStatus, assignHousekeepingTask, completeHousekeepingTask,
  createMaintenanceRequest, setMaintenanceStatus, setRoomOutOfOrder, restoreRoom,
} from '@/lib/actions/stays';

interface BoardRoom { room_id: string; number: string; service_status: string; housekeeping_status: string; occupied: boolean; sellable: boolean }
interface Task { id: string; kind: string; status: string; requires_photo: boolean; room_id: string; rooms: { number: string } | null; staff: { name: string } | null }
interface Maint { id: string; description: string; priority: string; status: string; room_id: string; rooms: { number: string } | null }
interface Staff { id: string; name: string }

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };
const chip: React.CSSProperties = { fontSize: 'var(--text-xs)', fontWeight: 600, padding: '4px 9px', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', minHeight: 30, cursor: 'pointer' };

export function HousekeepingBoard({ board, tasks, maint, staff, orgId }: { board: BoardRoom[]; tasks: Task[]; maint: Maint[]; staff: Staff[]; orgId: string }) {
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

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}

      {/* Room status board — the centrepiece */}
      <Card title="Room status board" subtitle="occupancy ⟂ housekeeping · sellable = in-service + vacant + clean/inspected">
        <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
          <span className="inline-flex items-center" style={{ gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 9, background: 'var(--color-success)' }} /> Sellable</span>
          <span className="inline-flex items-center" style={{ gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 9, background: 'var(--color-brand)' }} /> Occupied</span>
          <span className="inline-flex items-center" style={{ gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 9, background: 'var(--color-danger)' }} /> Out of order</span>
        </div>
        {board.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No rooms on the board" message="Add rooms in the Rooms screen and they'll appear here with live occupancy and housekeeping status." />
        ) : (
          <Board>
            {board.map((r) => {
              const accent = r.housekeeping_status === 'out_of_order' ? 'danger' : r.sellable ? 'success' : r.occupied ? 'brand' : 'neutral';
              return (
                <BoardCell
                  key={r.room_id}
                  title={`#${r.number}`}
                  accent={accent}
                  top={r.sellable ? <Badge tone="success">Ready</Badge> : undefined}
                  actions={
                    <>
                      {(['clean', 'dirty', 'inspected'] as const).map((s) => {
                        const active = r.housekeeping_status === s;
                        return (
                          <button key={s} onClick={() => run(() => setHousekeepingStatus({ roomId: r.room_id, status: s }))} disabled={busy} style={{ ...chip, ...(active ? { color: 'var(--color-brand)', borderColor: 'var(--color-brand-border)', background: 'var(--color-brand-subtle)' } : {}) }}>{s}</button>
                        );
                      })}
                      {r.housekeeping_status === 'out_of_order'
                        ? <button onClick={() => run(() => restoreRoom({ roomId: r.room_id }))} disabled={busy} style={{ ...chip, color: 'var(--color-brand)' }}>restore</button>
                        : <button onClick={() => run(() => setRoomOutOfOrder({ roomId: r.room_id }))} disabled={busy} style={{ ...chip, color: 'var(--color-danger)' }}>OOO</button>}
                    </>
                  }
                >
                  <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
                    <Badge tone={r.occupied ? 'brand' : 'neutral'}>{r.occupied ? 'occupied' : 'vacant'}</Badge>
                    <Badge tone={toneForStatus(r.housekeeping_status)}>{r.housekeeping_status.replace(/_/g, ' ')}</Badge>
                  </div>
                </BoardCell>
              );
            })}
          </Board>
        )}
      </Card>

      {/* Turn queue */}
      <Card padded={false} title="Housekeeping turns" subtitle={`${tasks.length} open`}>
        {tasks.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No open turns" message="When a guest checks out, the room is flagged dirty and a turn appears here to assign and complete." />
        ) : (
          <ul className="flex flex-col">
            {tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
                <div className="min-w-0 flex items-center" style={{ gap: 'var(--space-2)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-text)' }}>#{t.rooms?.number ?? '—'}</span>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{t.kind.replace(/_/g, ' ')}</span>
                  {t.requires_photo && <Badge tone="warning">photo</Badge>}
                  <StatusBadge status={t.status} />
                  {t.staff && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>· {t.staff.name}</span>}
                </div>
                <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
                  <select value={assignTo[t.id] ?? ''} onChange={(e) => setAssignTo((p) => ({ ...p, [t.id]: e.target.value }))} style={field} aria-label="Assign staff">
                    <option value="">assign…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {assignTo[t.id] && <Button variant="secondary" onClick={() => run(() => assignHousekeepingTask({ taskId: t.id, staffId: assignTo[t.id]! }))} disabled={busy}>Assign</Button>}
                  {t.requires_photo
                    ? <PhotoUpload orgId={orgId} prefix={`housekeeping/${t.id}`} label="Photo & complete" onUploaded={(path) => run(() => completeHousekeepingTask({ taskId: t.id, photoRef: path, result: 'inspected' }))} disabled={busy} />
                    : <Button onClick={() => run(() => completeHousekeepingTask({ taskId: t.id, result: 'inspected' }))} disabled={busy}>Complete</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Maintenance log */}
      <Card padded={false} title="Maintenance" subtitle={`${maint.length} open`}>
        <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)', padding: 'var(--space-4) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
          <select value={mRoom} onChange={(e) => setMRoom(e.target.value)} style={field} aria-label="Room">{board.map((r) => <option key={r.room_id} value={r.room_id}>#{r.number}</option>)}</select>
          <input value={mDesc} onChange={(e) => setMDesc(e.target.value)} placeholder="Issue description" style={{ ...field, flex: '1 1 200px' }} aria-label="Description" />
          <select value={mPri} onChange={(e) => setMPri(e.target.value as 'low' | 'medium' | 'high' | 'critical')} style={field} aria-label="Priority">
            {['low', 'medium', 'high', 'critical'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <Button onClick={() => run(() => createMaintenanceRequest({ roomId: mRoom, description: mDesc, priority: mPri }), () => setMDesc(''))} disabled={busy || !mRoom || !mDesc}><Wrench size={15} /> Log issue</Button>
        </div>
        {maint.length === 0 ? (
          <EmptyState icon={Wrench} title="No open issues" message="Log a maintenance issue above to track it from open through resolved." />
        ) : (
          <ul className="flex flex-col">
            {maint.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
                <div className="min-w-0 flex items-center" style={{ gap: 'var(--space-2)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-text)' }}>#{m.rooms?.number ?? '—'}</span>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{m.description}</span>
                  <Badge tone={m.priority === 'critical' || m.priority === 'high' ? 'danger' : 'neutral'}>{m.priority}</Badge>
                  <StatusBadge status={m.status} />
                </div>
                <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
                  {m.status === 'open' && <Button variant="secondary" onClick={() => run(() => setMaintenanceStatus({ requestId: m.id, status: 'in_progress' }))} disabled={busy}>Start</Button>}
                  {m.status !== 'resolved' && <Button onClick={() => run(() => setMaintenanceStatus({ requestId: m.id, status: 'resolved' }))} disabled={busy}>Resolve</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
