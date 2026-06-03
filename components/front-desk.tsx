'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DoorOpen, Plane, LogIn, LogOut, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { createWalkIn, checkInStay, checkOutStay } from '@/lib/actions/stays';

interface Room { id: string; number: string; room_types: { name: string } | null }
interface Stay { id: string; check_in: string; check_out: string; status: string; is_foreign: boolean; guests: { name: string; phone: string } | null; rooms: { number: string } | null }
interface FormC { passportNumber: string; nationality: string; dateOfBirth: string; visaType: string; visaNumber: string; arrivedFrom: string; intendedStay: string; nextDestination: string }
const emptyFormC: FormC = { passportNumber: '', nationality: '', dateOfBirth: '', visaType: '', visaNumber: '', arrivedFrom: '', intendedStay: '', nextDestination: '' };

// Touch-friendly token-driven control (floor staff are on phones — minHeight = tap target).
const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };
const toggle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', minHeight: 'var(--tap-min)' };

/** Reusable Form C panel (foreign nationals). Required: passport, nationality, DOB, visa #, arrived-from. */
function FormCPanel({ value, onChange }: { value: FormC; onChange: (f: FormC) => void }) {
  const set = (k: keyof FormC, v: string) => onChange({ ...value, [k]: v });
  return (
    <div style={{ position: 'relative', background: 'var(--color-surface-sunken)', border: '1px solid var(--color-divider)', borderLeft: '3px solid var(--color-brand)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', overflow: 'hidden' }}>
      <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <Plane size={15} style={{ color: 'var(--color-brand)' }} aria-hidden />
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>Form C · FRRO</span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>required for foreign nationals · <b style={{ color: 'var(--color-text-secondary)' }}>*</b> mandatory</span>
      </div>
      <div className="grid" style={{ gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <input value={value.passportNumber} onChange={(e) => set('passportNumber', e.target.value)} placeholder="Passport # *" style={field} aria-label="Passport number" />
        <input value={value.nationality} onChange={(e) => set('nationality', e.target.value)} placeholder="Nationality *" style={field} aria-label="Nationality" />
        <input type="date" value={value.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} style={field} aria-label="Date of birth" />
        <input value={value.visaType} onChange={(e) => set('visaType', e.target.value)} placeholder="Visa type" style={field} aria-label="Visa type" />
        <input value={value.visaNumber} onChange={(e) => set('visaNumber', e.target.value)} placeholder="Visa # *" style={field} aria-label="Visa number" />
        <input value={value.arrivedFrom} onChange={(e) => set('arrivedFrom', e.target.value)} placeholder="Arrived from *" style={field} aria-label="Arrived from" />
        <input value={value.intendedStay} onChange={(e) => set('intendedStay', e.target.value)} placeholder="Intended stay" style={field} aria-label="Intended stay" />
        <input value={value.nextDestination} onChange={(e) => set('nextDestination', e.target.value)} placeholder="Next destination" style={field} aria-label="Next destination" />
      </div>
    </div>
  );
}

export function FrontDesk({ rooms, stays }: { rooms: Room[]; stays: Stay[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // walk-in
  const [phone, setPhone] = useState(''); const [name, setName] = useState('');
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? ''); const [ci, setCi] = useState(''); const [co, setCo] = useState('');
  const [wForeign, setWForeign] = useState(false); const [wForm, setWForm] = useState<FormC>(emptyFormC);
  // check-in
  const [ciFor, setCiFor] = useState<Record<string, boolean>>({});
  const [ciForm, setCiForm] = useState<Record<string, FormC>>({});

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, reset?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) { reset?.(); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }
  const fc = (f: FormC) => ({ passportNumber: f.passportNumber, nationality: f.nationality, dateOfBirth: f.dateOfBirth, visaType: f.visaType || undefined, visaNumber: f.visaNumber, arrivedFrom: f.arrivedFrom, intendedStay: f.intendedStay || undefined, nextDestination: f.nextDestination || undefined });

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}

      {/* Walk-in — the primary fast action; open by default for the front desk. */}
      <CreatePanel label="Walk-in" title="Walk in a guest" defaultOpen>
        <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
          <div className="grid" style={{ gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Guest phone" style={field} aria-label="Phone" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest name" style={field} aria-label="Name" />
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={field} aria-label="Room">{rooms.map((r) => <option key={r.id} value={r.id}>#{r.number} · {r.room_types?.name ?? '—'}</option>)}</select>
            <input type="date" value={ci} onChange={(e) => setCi(e.target.value)} style={field} aria-label="Check-in" />
            <input type="date" value={co} onChange={(e) => setCo(e.target.value)} style={field} aria-label="Check-out" />
          </div>
          <label style={toggle}>
            <input type="checkbox" checked={wForeign} onChange={(e) => setWForeign(e.target.checked)} /> Foreign national (Form C required)
          </label>
          {wForeign && <FormCPanel value={wForm} onChange={setWForm} />}
          <div>
            <Button onClick={() => run(() => createWalkIn({ phone, name, roomId, checkIn: ci, checkOut: co, isForeign: wForeign, formC: wForeign ? fc(wForm) : undefined }), () => { setPhone(''); setName(''); setCi(''); setCo(''); setWForeign(false); setWForm(emptyFormC); })} disabled={busy || !phone || !name || !roomId || !ci || !co}>
              <DoorOpen size={15} /> Walk in &amp; check in
            </Button>
          </div>
        </div>
      </CreatePanel>

      {/* In-house & arriving */}
      <Card padded={false} title="In-house &amp; arriving" subtitle={`${stays.length} stay${stays.length === 1 ? '' : 's'}`}>
        {stays.length === 0 ? (
          <EmptyState icon={DoorOpen} title="Nothing to action" message="Arrivals and in-house guests will appear here. Walk in a guest above, or confirm a reservation to see it on the board." />
        ) : (
          <ul className="flex flex-col">
            {stays.map((s) => (
              <li key={s.id} className="flex flex-col" style={{ gap: 'var(--space-3)', padding: 'var(--space-4) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
                <div className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)' }}>
                  <div className="min-w-0">
                    <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                      <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{s.guests?.name ?? '—'}</span>
                      <StatusBadge status={s.status} />
                      {s.is_foreign && <span title="foreign national" className="inline-flex items-center" style={{ color: 'var(--color-text-tertiary)' }}><Plane size={13} /></span>}
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                      #{s.rooms?.number ?? 'unassigned'} · {s.check_in} → {s.check_out}
                    </div>
                  </div>
                  {s.status === 'checked_in' && (
                    <Button variant="secondary" onClick={() => run(() => checkOutStay({ stayId: s.id }))} disabled={busy}><LogOut size={15} /> Check out</Button>
                  )}
                </div>
                {s.status === 'reserved' && (
                  <div className="flex flex-col" style={{ gap: 'var(--space-2)', borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-3)' }}>
                    <label style={toggle}>
                      <input type="checkbox" checked={ciFor[s.id] ?? false} onChange={(e) => setCiFor((p) => ({ ...p, [s.id]: e.target.checked }))} /> Foreign national
                    </label>
                    {ciFor[s.id] && <FormCPanel value={ciForm[s.id] ?? emptyFormC} onChange={(f) => setCiForm((p) => ({ ...p, [s.id]: f }))} />}
                    <div>
                      <Button onClick={() => run(() => checkInStay({ stayId: s.id, isForeign: ciFor[s.id] ?? false, formC: ciFor[s.id] ? fc(ciForm[s.id] ?? emptyFormC) : undefined }))} disabled={busy}>
                        <LogIn size={15} /> Check in
                      </Button>
                    </div>
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
