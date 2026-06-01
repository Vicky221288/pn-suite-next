'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  upsertShiftTemplate, createRoster, generateShiftsFromTemplate,
  publishRoster, assignShift, setShiftAssignmentStatus,
} from '@/lib/actions/scheduling';

interface Template { id: string; name: string; role: string | null; start_time: string; end_time: string; location: string | null; days_of_week: number[]; active: boolean }
interface Roster { id: string; name: string; period_start: string; period_end: string; status: string }
interface Staff { id: string; name: string; role: string }
interface Assignment { assignment_id: string; staff_id: string; staff_name: string; status: string }
interface BoardShift { shift_id: string; roster_name: string; roster_status: string; shift_date: string; start_at: string; end_at: string; role: string | null; location: string | null; assignments: Assignment[] }
interface Board { can_manage: boolean; shifts: BoardShift[] }

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const inp: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const statusColour = (s: string) => (s === 'cancelled' || s === 'no_show' ? 'var(--color-danger)' : s === 'completed' ? 'var(--color-success)' : 'var(--color-text-secondary)');
const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const nextStatus = (s: string): 'acknowledged' | 'completed' | null => (s === 'scheduled' ? 'acknowledged' : s === 'acknowledged' ? 'completed' : null);

export function SchedulingManager({ templates, rosters, staff, board, range }: { templates: Template[]; rosters: Roster[]; staff: Staff[]; board: Board; range: { from: string; to: string } }) {
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
  // per-roster template selection for generation
  const [genTpl, setGenTpl] = useState<Record<string, string>>({});
  // per-shift staff selection for assignment
  const [asgStaff, setAsgStaff] = useState<Record<string, string>>({});

  return (
    <div className="flex flex-col gap-5">
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}

      {/* Shift templates */}
      <section style={card}>
        <h2 style={h2}>Shift templates (recurring)</h2>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input value={tName} onChange={(e) => setTName(e.target.value)} placeholder="Template name" style={inp} aria-label="Template name" />
            <input value={tRole} onChange={(e) => setTRole(e.target.value)} placeholder="Role (e.g. server)" style={inp} aria-label="Role" />
            <label className="text-xs self-center" style={{ color: 'var(--color-text-tertiary)' }}>Start</label>
            <input type="time" value={tStart} onChange={(e) => setTStart(e.target.value)} style={inp} aria-label="Start time" />
            <label className="text-xs self-center" style={{ color: 'var(--color-text-tertiary)' }}>End</label>
            <input type="time" value={tEnd} onChange={(e) => setTEnd(e.target.value)} style={inp} aria-label="End time" />
            <input value={tLoc} onChange={(e) => setTLoc(e.target.value)} placeholder="Location (optional)" style={inp} aria-label="Location" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                <input type="checkbox" checked={tDays.includes(i)} onChange={() => toggleDay(i)} aria-label={d} />{d}
              </label>
            ))}
            <Button onClick={() => run(() => upsertShiftTemplate({ name: tName, role: tRole || undefined, startTime: tStart, endTime: tEnd, location: tLoc || undefined, daysOfWeek: tDays }), () => { setTName(''); setTRole(''); setTLoc(''); })} disabled={busy || !tName}>Save template</Button>
          </div>
        </div>
        {templates.length > 0 && (
          <ul className="flex flex-col mt-3">
            {templates.map((t) => (
              <li key={t.id} className="py-1.5 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <b>{t.name}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· {t.role ?? '—'} · {t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)} · {(t.days_of_week ?? []).map((d) => DAYS[d]).join(' ') || 'no days'}{t.location ? ` · ${t.location}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Rosters */}
      <section style={card}>
        <h2 style={h2}>Rosters</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="Roster name (e.g. Week 24)" style={inp} aria-label="Roster name" />
          <input type="date" value={rStart} onChange={(e) => setRStart(e.target.value)} style={inp} aria-label="Period start" />
          <input type="date" value={rEnd} onChange={(e) => setREnd(e.target.value)} style={inp} aria-label="Period end" />
          <Button onClick={() => run(() => createRoster({ name: rName, periodStart: rStart, periodEnd: rEnd }), () => setRName(''))} disabled={busy || !rName}>Create draft</Button>
        </div>
        {rosters.length > 0 && (
          <ul className="flex flex-col mt-3">
            {rosters.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span><b>{r.name}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· {r.period_start} → {r.period_end}</span> · <b style={{ color: r.status === 'published' ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>{r.status}</b></span>
                {r.status === 'draft' && (
                  <span className="flex items-center gap-2">
                    <select value={genTpl[r.id] ?? ''} onChange={(e) => setGenTpl((p) => ({ ...p, [r.id]: e.target.value }))} style={inp} aria-label="Template to generate">
                      <option value="">choose template…</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <Button variant="secondary" onClick={() => run(() => generateShiftsFromTemplate({ rosterId: r.id, templateId: genTpl[r.id] }))} disabled={busy || !genTpl[r.id]}>Generate shifts</Button>
                    <Button onClick={() => run(() => publishRoster({ rosterId: r.id }))} disabled={busy}>Publish</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Board */}
      <section style={card}>
        <h2 style={h2}>Shift board · {range.from} → {range.to}{board.can_manage ? '' : ' (published only)'}</h2>
        {board.shifts.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No shifts in range.</p> : (
          <ul className="flex flex-col">
            {board.shifts.map((s) => (
              <li key={s.shift_id} className="py-2 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><b>{fmt(s.start_at)}–{new Date(s.end_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· {s.role ?? '—'}{s.location ? ` · ${s.location}` : ''} · {s.roster_name} ({s.roster_status})</span></span>
                  {board.can_manage && (
                    <span className="flex items-center gap-2">
                      <select value={asgStaff[s.shift_id] ?? ''} onChange={(e) => setAsgStaff((p) => ({ ...p, [s.shift_id]: e.target.value }))} style={inp} aria-label="Staff to assign">
                        <option value="">assign staff…</option>
                        {staff.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                      </select>
                      <Button variant="secondary" onClick={() => run(() => assignShift({ shiftId: s.shift_id, staffId: asgStaff[s.shift_id] }))} disabled={busy || !asgStaff[s.shift_id]}>Assign</Button>
                    </span>
                  )}
                </div>
                {s.assignments.length > 0 && (
                  <ul className="flex flex-col mt-1 pl-3">
                    {s.assignments.map((a) => (
                      <li key={a.assignment_id} className="flex flex-wrap items-center gap-2 py-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        {a.staff_name} · <b style={{ color: statusColour(a.status) }}>{a.status}</b>
                        {board.can_manage && nextStatus(a.status) && <Button variant="ghost" onClick={() => run(() => setShiftAssignmentStatus({ assignmentId: a.assignment_id, status: nextStatus(a.status)! }))} disabled={busy}>→ {nextStatus(a.status)}</Button>}
                        {board.can_manage && (a.status === 'scheduled' || a.status === 'acknowledged') && (
                          <>
                            <button onClick={() => run(() => setShiftAssignmentStatus({ assignmentId: a.assignment_id, status: 'no_show' }))} className="text-xs" style={{ color: 'var(--color-danger)' }} disabled={busy}>no-show</button>
                            <button onClick={() => run(() => setShiftAssignmentStatus({ assignmentId: a.assignment_id, status: 'cancelled' }))} className="text-xs" style={{ color: 'var(--color-danger)' }} disabled={busy}>cancel</button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
