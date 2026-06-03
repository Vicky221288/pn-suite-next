'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert, MapPin, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import { withinGeofence } from '@/lib/geo';
import { setHrFields, setGeofence, recordAttendance, requestLeave, decideLeave } from '@/lib/actions/workforce';

interface Staff { id: string; name: string; role: string; employee_code: string | null; date_of_joining: string | null; designation: string | null; employment_type: string | null; email: string | null }
interface Fence { center_lat: number; center_lng: number; radius_m: number }
interface Leave { id: string; leave_type: string; start_date: string; end_date: string; reason: string | null; status: string; staff_id: string }
interface Attendance { id: string; staff_id: string; kind: string; on_premise: boolean; recorded_at: string }

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };
const ts = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

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

  const [hrStaff, setHrStaff] = useState(staff[0]?.id ?? '');
  const [empCode, setEmpCode] = useState(''); const [doj, setDoj] = useState(''); const [desig, setDesig] = useState('');
  const [empType, setEmpType] = useState<'full_time' | 'part_time' | 'contract' | 'temporary'>('full_time'); const [email, setEmail] = useState('');
  const [gLat, setGLat] = useState(fence?.center_lat?.toString() ?? ''); const [gLng, setGLng] = useState(fence?.center_lng?.toString() ?? ''); const [gRad, setGRad] = useState(fence?.radius_m?.toString() ?? '200');
  const [attStaff, setAttStaff] = useState(staff[0]?.id ?? '');
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

  const pendingLeave = leave.filter((l) => l.status === 'pending');
  const decidedLeave = leave.filter((l) => l.status !== 'pending');

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}

      {/* HR profile */}
      {canManageStaff && (
        <Card padded={false} title="HR profile" subtitle="Employment record — no pay data stored here">
          <div style={{ padding: 'var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
            <div className="grid" style={{ gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              <select value={hrStaff} onChange={(e) => setHrStaff(e.target.value)} style={field} aria-label="Staff">{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <input value={empCode} onChange={(e) => setEmpCode(e.target.value)} placeholder="Employee code" style={field} aria-label="Employee code" />
              <input type="date" value={doj} onChange={(e) => setDoj(e.target.value)} style={field} aria-label="Date of joining" />
              <input value={desig} onChange={(e) => setDesig(e.target.value)} placeholder="Designation" style={field} aria-label="Designation" />
              <select value={empType} onChange={(e) => setEmpType(e.target.value as typeof empType)} style={field} aria-label="Employment type">
                <option value="full_time">full_time</option><option value="part_time">part_time</option><option value="contract">contract</option><option value="temporary">temporary</option>
              </select>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={field} aria-label="Email" />
            </div>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Button onClick={() => run(() => setHrFields({ staffId: hrStaff, employeeCode: empCode || undefined, dateOfJoining: doj || undefined, designation: desig || undefined, employmentType: empType, email: email || undefined }), () => { setEmpCode(''); setDoj(''); setDesig(''); setEmail(''); })} disabled={busy || !hrStaff}>Save HR</Button>
            </div>
          </div>
          <Table>
            <THead>
              <TR><TH>Name</TH><TH>Designation</TH><TH>Code</TH><TH>Type</TH><TH align="right">DOJ</TH></TR>
            </THead>
            <tbody>
              {staff.map((s) => (
                <TR key={s.id}>
                  <TD><span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{s.name}</span></TD>
                  <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{s.designation ?? '—'}</span></TD>
                  <TD mono><span style={{ color: 'var(--color-text-tertiary)' }}>{s.employee_code ?? '—'}</span></TD>
                  <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{(s.employment_type ?? '—').replace(/_/g, ' ')}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-tertiary)' }}>{s.date_of_joining ?? '—'}</span></TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Geofence config */}
      {canManageStaff && (
        <Card title="Attendance geofence" subtitle="Property fence — config only; staff location is never stored">
          <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
            <MapPin size={16} style={{ color: 'var(--color-text-tertiary)' }} aria-hidden />
            <input value={gLat} onChange={(e) => setGLat(e.target.value)} placeholder="Centre latitude" style={field} aria-label="Centre latitude" />
            <input value={gLng} onChange={(e) => setGLng(e.target.value)} placeholder="Centre longitude" style={field} aria-label="Centre longitude" />
            <input value={gRad} onChange={(e) => setGRad(e.target.value)} placeholder="Radius (m)" style={{ ...field, width: 120 }} aria-label="Radius metres" />
            <Button onClick={() => run(() => setGeofence({ centerLat: Number(gLat), centerLng: Number(gLng), radiusM: Number(gRad) }))} disabled={busy || !gLat || !gLng || !gRad}>Save fence</Button>
          </div>
        </Card>
      )}

      {/* Attendance — on-premise boolean only */}
      <Card padded={false} title="Attendance" subtitle="On-premise check-in / check-out · on-premise is a yes/no flag, no location is recorded">
        <div style={{ padding: 'var(--card-pad)', borderBottom: attendance.length ? '1px solid var(--color-divider)' : undefined }}>
          {!fence && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)' }}>No geofence set — clock-ins will record off-premise.</p>}
          <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
            <select value={attStaff} onChange={(e) => setAttStaff(e.target.value)} style={field} aria-label="Staff to clock">{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <Button onClick={() => clock('check_in')} disabled={busy || !attStaff}><Clock size={15} /> Check in</Button>
            <Button variant="secondary" onClick={() => clock('check_out')} disabled={busy || !attStaff}>Check out</Button>
          </div>
        </div>
        {attendance.length > 0 && (
          <ul className="flex flex-col">
            {attendance.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-2) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
                <span className="flex items-center" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
                  <span style={{ color: 'var(--color-text)' }}>{nameOf(a.staff_id)}</span>
                  <span style={{ color: 'var(--color-text-tertiary)' }}>{a.kind.replace(/_/g, ' ')}</span>
                  <Badge tone={a.on_premise ? 'success' : 'danger'}>{a.on_premise ? 'on-premise' : 'off-premise'}</Badge>
                </span>
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{ts(a.recorded_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Leave + approval queue */}
      <Card padded={false} title="Leave &amp; approvals" subtitle={`${pendingLeave.length} pending`}>
        <div style={{ padding: 'var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
          <div className="grid" style={{ gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            <select value={lvStaff} onChange={(e) => setLvStaff(e.target.value)} style={field} aria-label="Staff">{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <input value={lvType} onChange={(e) => setLvType(e.target.value)} placeholder="Type" style={field} aria-label="Leave type" />
            <input type="date" value={lvStart} onChange={(e) => setLvStart(e.target.value)} style={field} aria-label="Start" />
            <input type="date" value={lvEnd} onChange={(e) => setLvEnd(e.target.value)} style={field} aria-label="End" />
            <input value={lvReason} onChange={(e) => setLvReason(e.target.value)} placeholder="Reason" style={field} aria-label="Reason" />
          </div>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button onClick={() => run(() => requestLeave({ staffId: lvStaff, leaveType: lvType, start: lvStart, end: lvEnd, reason: lvReason || undefined }), () => { setLvStart(''); setLvEnd(''); setLvReason(''); })} disabled={busy || !lvStaff || !lvStart || !lvEnd}>Request leave</Button>
          </div>
        </div>
        {leave.length === 0 ? (
          <EmptyState title="No leave requests" message="Requests appear here for tiered approval. Approvers can't action their own request — that's enforced server-side." />
        ) : (
          <ul className="flex flex-col">
            {[...pendingLeave, ...decidedLeave].map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
                <div className="min-w-0">
                  <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{nameOf(l.staff_id)}</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{l.leave_type}</span>
                    <StatusBadge status={l.status} />
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{l.start_date} → {l.end_date}{l.reason ? ` · ${l.reason}` : ''}</div>
                </div>
                {canDecide && l.status === 'pending' && (
                  <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                    <Button onClick={() => run(() => decideLeave({ leaveId: l.id, decision: 'approve' }))} disabled={busy}>Approve</Button>
                    <Button variant="ghost" onClick={() => run(() => decideLeave({ leaveId: l.id, decision: 'reject' }))} disabled={busy} style={{ color: 'var(--color-danger)' }}>Reject</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
