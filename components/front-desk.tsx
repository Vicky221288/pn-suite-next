'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createWalkIn, checkInStay, checkOutStay } from '@/lib/actions/stays';

interface Room { id: string; number: string; room_types: { name: string } | null }
interface Stay { id: string; check_in: string; check_out: string; status: string; is_foreign: boolean; guests: { name: string; phone: string } | null; rooms: { number: string } | null }
interface FormC { passportNumber: string; nationality: string; dateOfBirth: string; visaType: string; visaNumber: string; arrivedFrom: string; intendedStay: string; nextDestination: string }
const emptyFormC: FormC = { passportNumber: '', nationality: '', dateOfBirth: '', visaType: '', visaNumber: '', arrivedFrom: '', intendedStay: '', nextDestination: '' };

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };

/** Reusable Form C panel (foreign nationals). Required: passport, nationality, DOB, visa #, arrived-from. */
function FormCPanel({ value, onChange }: { value: FormC; onChange: (f: FormC) => void }) {
  const set = (k: keyof FormC, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-2" style={{ borderLeft: '2px solid var(--color-brand)', paddingLeft: 10 }}>
      <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Form C (FRRO) — required for foreign nationals</span>
      <div className="flex flex-wrap gap-2">
        <input value={value.passportNumber} onChange={(e) => set('passportNumber', e.target.value)} placeholder="Passport # *" style={i} aria-label="Passport number" />
        <input value={value.nationality} onChange={(e) => set('nationality', e.target.value)} placeholder="Nationality *" style={i} aria-label="Nationality" />
        <input type="date" value={value.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} style={i} aria-label="Date of birth" />
        <input value={value.visaType} onChange={(e) => set('visaType', e.target.value)} placeholder="Visa type" style={i} aria-label="Visa type" />
        <input value={value.visaNumber} onChange={(e) => set('visaNumber', e.target.value)} placeholder="Visa # *" style={i} aria-label="Visa number" />
        <input value={value.arrivedFrom} onChange={(e) => set('arrivedFrom', e.target.value)} placeholder="Arrived from *" style={i} aria-label="Arrived from" />
        <input value={value.intendedStay} onChange={(e) => set('intendedStay', e.target.value)} placeholder="Intended stay" style={i} aria-label="Intended stay" />
        <input value={value.nextDestination} onChange={(e) => set('nextDestination', e.target.value)} placeholder="Next destination" style={i} aria-label="Next destination" />
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
    <div className="flex flex-col gap-5">
      <section style={card}>
        <h2 style={h2}>Walk-in (creates a checked-in stay)</h2>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Guest phone" style={i} aria-label="Phone" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest name" style={i} aria-label="Name" />
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={i} aria-label="Room">{rooms.map((r) => <option key={r.id} value={r.id}>#{r.number} · {r.room_types?.name ?? '—'}</option>)}</select>
            <input type="date" value={ci} onChange={(e) => setCi(e.target.value)} style={i} aria-label="Check-in" />
            <input type="date" value={co} onChange={(e) => setCo(e.target.value)} style={i} aria-label="Check-out" />
          </div>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={wForeign} onChange={(e) => setWForeign(e.target.checked)} /> Foreign national (Form C required)
          </label>
          {wForeign && <FormCPanel value={wForm} onChange={setWForm} />}
          <div><Button onClick={() => run(() => createWalkIn({ phone, name, roomId, checkIn: ci, checkOut: co, isForeign: wForeign, formC: wForeign ? fc(wForm) : undefined }), () => { setPhone(''); setName(''); setCi(''); setCo(''); setWForeign(false); setWForm(emptyFormC); })} disabled={busy || !phone || !name || !roomId || !ci || !co}>Walk in &amp; check in</Button></div>
        </div>
      </section>

      <section style={card}>
        <h2 style={h2}>In-house &amp; arriving</h2>
        {stays.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Nothing to action.</p> : (
          <ul className="flex flex-col gap-2">
            {stays.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 py-2" style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span>{s.guests?.name ?? '—'} <span style={{ color: 'var(--color-text-tertiary)' }}>· #{s.rooms?.number ?? 'unassigned'} · {s.check_in} → {s.check_out} · {s.status}</span></span>
                  {s.status === 'checked_in' && <Button onClick={() => run(() => checkOutStay({ stayId: s.id }))} disabled={busy}>Check out</Button>}
                </div>
                {s.status === 'reserved' && (
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      <input type="checkbox" checked={ciFor[s.id] ?? false} onChange={(e) => setCiFor((p) => ({ ...p, [s.id]: e.target.checked }))} /> Foreign national
                    </label>
                    {ciFor[s.id] && <FormCPanel value={ciForm[s.id] ?? emptyFormC} onChange={(f) => setCiForm((p) => ({ ...p, [s.id]: f }))} />}
                    <div><Button onClick={() => run(() => checkInStay({ stayId: s.id, isForeign: ciFor[s.id] ?? false, formC: ciFor[s.id] ? fc(ciForm[s.id] ?? emptyFormC) : undefined }))} disabled={busy}>Check in</Button></div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
      </section>
    </div>
  );
}
