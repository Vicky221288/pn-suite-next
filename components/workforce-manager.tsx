'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { withinGeofence } from '@/lib/geo';
import { setHrFields, setGeofence, recordAttendance, requestLeave, decideLeave } from '@/lib/actions/workforce';

interface Staff { id: string; name: string; role: string; employee_code: string | null; date_of_joining: string | null; designation: string | null; employment_type: string | null; email: string | null }
interface Fence { center_lat: number; center_lng: number; radius_m: number }
interface Leave { id: string; leave_type: string; start_date: string; end_date: string; reason: string | null; status: string; staff_id: string }
interface Attendance { id: string; staff_id: string; kind: string; on_premise: boolean; recorded_at: string }

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const inp: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
const statusColour = (s: string) => (s === 'rejected' || s === 'cancelled' ? 'var(--color-danger)' : s === 'approved' ? 'var(--color-success)' : 'var(--color-text-secondary)');

export function WorkforceManager({ staff, fence, leave, attendance, canManageStaff, canDecide }: {
  staff: Staff[]; fence: Fence | null; leave: Leave[]; attendance: Attendance[]; canManageStaff: boolean; canDecide: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? '—';

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, reset?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) { reset?.(); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }

  // HR editor
  const [hrStaff, setHrStaff] = useState(staff[0]?.id ?? '');
  const [empCode, setEmpCode] = useState(''); const [doj, setDoj] = useState(''); const [desig, setDesig] = useState('');
  const [empType, setEmpType] = useState<'full_time' | 'part_time' | 'contract' | 'temporary'>('full_time'); const [email, setEmail] = useState('');

  // geofence config
  const [gLat, setGLat] = useState(fence?.center_lat?.toString() ?? ''); const [gLng, setGLng] = useState(fence?.center_lng?.toString() ?? ''); const [gRad, setGRad] = useState(fence?.radius_m?.toString() ?? '200');

  // attendance
  const [attStaff, setAttStaff] = useState(staff[0]?.id ?? '');

  // leave
  const [lvStaff, setLvStaff] = useState(staff[0]?.id ?? ''); const [lvType, setLvType] = useState('casual');
  const [lvStart, setLvStart] = useState(''); const [lvEnd, setLvEnd] = useState(''); const [lvReason, setLvReason] = useState('');

  /** Device-side geofence eval: get position → compute boolean → send boolean only. */
  async function clock(kind: 'check_in' | 'check_out') {
    if (!attStaff) return;
    let onPremise = false;
    if (fence && 'geolocation' in navigator) {
      try {
        const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
        onPremise = withinGeofence(fence.center_lat, fence.center_lng, fence.radius_m, pos.coords.latitude, pos.coords.longitude);
      } catch { onPremise = false; }
    }
    // NOTE: only the boolean `onPremise` is sent — coordinates never leave the device.
    await run(() => recordAttendance({ staffId: attStaff, kind, onPremise }));
  }

  return (
    <div className="flex flex-col gap-5">
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}

      {/* HR fields */}
      {canManageStaff && (
        <section style={card}>
          <h2 style={h2}>HR profile</h2>
          <div className="flex flex-wrap gap-2">
            <select value={hrStaff} onChange={(e) => setHrStaff(e.target.value)} style={inp} aria-label="Staff">
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={empCode} onChange={(e) => setEmpCode(e.target.value)} placeholder="Employee code" style={inp} aria-label="Employee code" />
            <input type="date" value={doj} onChange={(e) => setDoj(e.target.value)} style={inp} aria-label="Date of joining" />
            <input value={desig} onChange={(e) => setDesig(e.target.value)} placeholder="Designation" style={inp} aria-label="Designation" />
            <select value={empType} onChange={(e) => setEmpType(e.target.value as typeof empType)} style={inp} aria-label="Employment type">
              <option value="full_time">full_time</option><option value="part_time">part_time</option><option value="contract">contract</option><option value="temporary">temporary</option>
            </select>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={inp} aria-label="Email" />
            <Button onClick={() => run(() => setHrFields({ staffId: hrStaff, employeeCode: empCode || undefined, dateOfJoining: doj || undefined, designation: desig || undefined, employmentType: empType, email: email || undefined }), () => { setEmpCode(''); setDoj(''); setDesig(''); setEmail(''); })} disabled={busy || !hrStaff}>Save HR</Button>
          </div>
          <ul className="flex flex-col mt-3">
            {staff.map((s) => (
              <li key={s.id} className="py-1.5 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <b>{s.name}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· {s.designation ?? '—'} · {s.employee_code ?? 'no code'} · {s.employment_type ?? '—'}{s.date_of_joining ? ` · DOJ ${s.date_of_joining}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Geofence config */}
      {canManageStaff && (
        <section style={card}>
          <h2 style={h2}>Attendance geofence (property) — config only, never staff location</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input value={gLat} onChange={(e) => setGLat(e.target.value)} placeholder="Centre latitude" style={inp} aria-label="Centre latitude" />
            <input value={gLng} onChange={(e) => setGLng(e.target.value)} placeholder="Centre longitude" style={inp} aria-label="Centre longitude" />
            <input value={gRad} onChange={(e) => setGRad(e.target.value)} placeholder="Radius (m)" style={inp} aria-label="Radius metres" />
            <Button onClick={() => run(() => setGeofence({ centerLat: Number(gLat), centerLng: Number(gLng), radiusM: Number(gRad) }))} disabled={busy || !gLat || !gLng || !gRad}>Save fence</Button>
          </div>
        </section>
      )}

      {/* Attendance clock */}
      <section style={card}>
        <h2 style={h2}>Attendance — on-premise check-in/out</h2>
        {!fence && <p className="text-xs mb-2" style={{ color: 'var(--color-amber, var(--color-text-tertiary))' }}>No geofence set — clock-ins will record off-premise.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <select value={attStaff} onChange={(e) => setAttStaff(e.target.value)} style={inp} aria-label="Staff to clock">
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button onClick={() => clock('check_in')} disabled={busy || !attStaff}>Check in</Button>
          <Button variant="secondary" onClick={() => clock('check_out')} disabled={busy || !attStaff}>Check out</Button>
        </div>
        {attendance.length > 0 && (
          <ul className="flex flex-col mt-3">
            {attendance.map((a) => (
              <li key={a.id} className="py-1 text-xs" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text-secondary)' }}>
                {nameOf(a.staff_id)} · {a.kind} · <b style={{ color: a.on_premise ? 'var(--color-success)' : 'var(--color-danger)' }}>{a.on_premise ? 'on-premise' : 'off-premise'}</b> · {new Date(a.recorded_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Leave */}
      <section style={card}>
        <h2 style={h2}>Leave</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select value={lvStaff} onChange={(e) => setLvStaff(e.target.value)} style={inp} aria-label="Staff">
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input value={lvType} onChange={(e) => setLvType(e.target.value)} placeholder="Type" style={inp} aria-label="Leave type" />
          <input type="date" value={lvStart} onChange={(e) => setLvStart(e.target.value)} style={inp} aria-label="Start" />
          <input type="date" value={lvEnd} onChange={(e) => setLvEnd(e.target.value)} style={inp} aria-label="End" />
          <input value={lvReason} onChange={(e) => setLvReason(e.target.value)} placeholder="Reason" style={inp} aria-label="Reason" />
          <Button onClick={() => run(() => requestLeave({ staffId: lvStaff, leaveType: lvType, start: lvStart, end: lvEnd, reason: lvReason || undefined }), () => { setLvStart(''); setLvEnd(''); setLvReason(''); })} disabled={busy || !lvStaff || !lvStart || !lvEnd}>Request leave</Button>
        </div>
        {leave.length > 0 && (
          <ul className="flex flex-col mt-3">
            {leave.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span>{nameOf(l.staff_id)} · {l.leave_type} <span style={{ color: 'var(--color-text-tertiary)' }}>· {l.start_date} → {l.end_date}{l.reason ? ` · ${l.reason}` : ''}</span> · <b style={{ color: statusColour(l.status) }}>{l.status}</b></span>
                {canDecide && l.status === 'pending' && (
                  <span className="flex items-center gap-2">
                    <Button onClick={() => run(() => decideLeave({ leaveId: l.id, decision: 'approve' }))} disabled={busy}>Approve</Button>
                    <button onClick={() => run(() => decideLeave({ leaveId: l.id, decision: 'reject' }))} className="text-xs" style={{ color: 'var(--color-danger)' }} disabled={busy}>reject</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
