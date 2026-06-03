'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Board, BoardCell } from '@/components/ui/board';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import {
  upsertShiftTemplate, createRoster, generateShiftsFromTemplate,
  publishRoster, assignShift, setShiftAssignmentStatus,
} from '@/lib/actions/scheduling';

interface Template { id: string; name: string; role: string | null; start_time: string; end_time: string; location: string | null; days_of_week: number[]; active: boolean }
interface Roster { id: string; name: string; period_start: string; period_end: string; status: string }
interface Staff { id: string; name: string; role: string }
interface Assignment { assignment_id: string; staff_id: string; staff_name: string; status: string }
interface BoardShift { shift_id: string; roster_name: string; roster_status: string; shift_date: string; start_at: string; end_at: string; role: string | null; location: string | null; assignments: Assignment[] }
interface Board_ { can_manage: boolean; shifts: BoardShift[] }

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' });
const nextStatus = (s: string): 'acknowledged' | 'completed' | null => (s === 'scheduled' ? 'acknowledged' : s === 'acknowledged' ? 'completed' : null);

export function SchedulingManager({ templates, rosters, staff, board, range }: { templates: Template[]; rosters: Roster[]; staff: Staff[]; board: Board_; range: { from: string; to: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, reset?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) { reset?.(); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }

  // template form
  const [tName, setTName] = useState(''); const [tRole, setTRole] = useState('');
  const [tStart, setTStart] = useState('09:00'); const [tEnd, setTEnd] = useState('17:00');
  const [tLoc, setTLoc] = useState(''); const [tDays, setTDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const toggleDay = (d: number) => setTDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort()));

  // roster form
  const [rName, setRName] = useState(''); const [rStart, setRStart] = useState(range.from); const [rEnd, setREnd] = useState(range.to);
  const [genTpl, setGenTpl] = useState<Record<string, string>>({});
  const [asgStaff, setAsgStaff] = useState<Record<string, string>>({});

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}

      {/* Shift board — coverage at a glance */}
      <Card title="Shift board" subtitle={`${range.from} → ${range.to}${board.can_manage ? '' : ' · published only'}`}>
        {board.shifts.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No shifts in range" message="Create a roster and generate shifts from a template — they'll appear here for assignment." />
        ) : (
          <Board min="220px">
            {board.shifts.map((s) => (
              <BoardCell
                key={s.shift_id}
                title={`${time(s.start_at)}–${time(s.end_at)}`}
                accent={s.assignments.length > 0 ? 'success' : 'warning'}
                top={s.role ? <Badge tone="neutral">{s.role}</Badge> : undefined}
                actions={board.can_manage ? (
                  <>
                    <select value={asgStaff[s.shift_id] ?? ''} onChange={(e) => setAsgStaff((p) => ({ ...p, [s.shift_id]: e.target.value }))} style={{ ...field, flex: 1 }} aria-label="Staff to assign">
                      <option value="">assign staff…</option>
                      {staff.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                    </select>
                    <Button variant="secondary" onClick={() => run(() => assignShift({ shiftId: s.shift_id, staffId: asgStaff[s.shift_id]! }))} disabled={busy || !asgStaff[s.shift_id]}>Assign</Button>
                  </>
                ) : undefined}
              >
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)' }}>
                  {day(s.start_at)}{s.location ? ` · ${s.location}` : ''} · {s.roster_name}
                </div>
                {s.assignments.length === 0 ? (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)' }}>Uncovered</span>
                ) : (
                  <ul className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
                    {s.assignments.map((a) => (
                      <li key={a.assignment_id} className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>{a.staff_name}</span>
                        <StatusBadge status={a.status} />
                        {board.can_manage && nextStatus(a.status) && <Button variant="ghost" onClick={() => run(() => setShiftAssignmentStatus({ assignmentId: a.assignment_id, status: nextStatus(a.status)! }))} disabled={busy} style={{ minHeight: 28, padding: '2px 8px' }}>→ {nextStatus(a.status)}</Button>}
                        {board.can_manage && (a.status === 'scheduled' || a.status === 'acknowledged') && (
                          <Button variant="ghost" onClick={() => run(() => setShiftAssignmentStatus({ assignmentId: a.assignment_id, status: 'no_show' }))} disabled={busy} style={{ minHeight: 28, padding: '2px 8px', color: 'var(--color-danger)' }}>no-show</Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </BoardCell>
            ))}
          </Board>
        )}
      </Card>

      {/* Rosters */}
      <Card padded={false} title="Rosters" subtitle="Draft → published · published is what staff see">
        <div style={{ padding: 'var(--card-pad)', borderBottom: rosters.length ? '1px solid var(--color-divider)' : undefined }}>
          <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
            <input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="Roster name (e.g. Week 24)" style={field} aria-label="Roster name" />
            <input type="date" value={rStart} onChange={(e) => setRStart(e.target.value)} style={field} aria-label="Period start" />
            <input type="date" value={rEnd} onChange={(e) => setREnd(e.target.value)} style={field} aria-label="Period end" />
            <Button onClick={() => run(() => createRoster({ name: rName, periodStart: rStart, periodEnd: rEnd }), () => setRName(''))} disabled={busy || !rName}>Create draft</Button>
          </div>
        </div>
        {rosters.length > 0 && (
          <ul className="flex flex-col">
            {rosters.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
                <div className="min-w-0 flex items-center" style={{ gap: 'var(--space-2)' }}>
                  <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{r.name}</span>
                  <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{r.period_start} → {r.period_end}</span>
                  <StatusBadge status={r.status} />
                </div>
                {r.status === 'draft' && (
                  <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
                    <select value={genTpl[r.id] ?? ''} onChange={(e) => setGenTpl((p) => ({ ...p, [r.id]: e.target.value }))} style={field} aria-label="Template to generate">
                      <option value="">choose template…</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <Button variant="secondary" onClick={() => run(() => generateShiftsFromTemplate({ rosterId: r.id, templateId: genTpl[r.id]! }))} disabled={busy || !genTpl[r.id]}>Generate shifts</Button>
                    <Button onClick={() => run(() => publishRoster({ rosterId: r.id }))} disabled={busy}>Publish</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Shift templates */}
      <CreatePanel label="New template" title="Shift template (recurring)">
        <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
          <div className="grid" style={{ gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            <input value={tName} onChange={(e) => setTName(e.target.value)} placeholder="Template name" style={field} aria-label="Template name" />
            <input value={tRole} onChange={(e) => setTRole(e.target.value)} placeholder="Role (e.g. server)" style={field} aria-label="Role" />
            <label className="flex flex-col" style={{ gap: 2, fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Start<input type="time" value={tStart} onChange={(e) => setTStart(e.target.value)} style={field} aria-label="Start time" /></label>
            <label className="flex flex-col" style={{ gap: 2, fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>End<input type="time" value={tEnd} onChange={(e) => setTEnd(e.target.value)} style={field} aria-label="End time" /></label>
            <input value={tLoc} onChange={(e) => setTLoc(e.target.value)} placeholder="Location (optional)" style={field} aria-label="Location" />
          </div>
          <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-3)' }}>
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center" style={{ gap: 4, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                <input type="checkbox" checked={tDays.includes(i)} onChange={() => toggleDay(i)} aria-label={d} />{d}
              </label>
            ))}
            <Button onClick={() => run(() => upsertShiftTemplate({ name: tName, role: tRole || undefined, startTime: tStart, endTime: tEnd, location: tLoc || undefined, daysOfWeek: tDays }), () => { setTName(''); setTRole(''); setTLoc(''); })} disabled={busy || !tName}>Save template</Button>
          </div>
        </div>
      </CreatePanel>

      {templates.length > 0 && (
        <Card padded={false} title="Templates" subtitle={`${templates.length} recurring`}>
          <Table>
            <THead>
              <TR><TH>Name</TH><TH>Role</TH><TH align="right">Hours</TH><TH>Days</TH><TH>Location</TH></TR>
            </THead>
            <tbody>
              {templates.map((t) => (
                <TR key={t.id}>
                  <TD><span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{t.name}</span></TD>
                  <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{t.role ?? '—'}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)}</span></TD>
                  <TD><span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{(t.days_of_week ?? []).map((d) => DAYS[d]).join(' ') || '—'}</span></TD>
                  <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{t.location ?? '—'}</span></TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
