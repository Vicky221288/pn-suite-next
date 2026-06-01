'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { placeHold, releaseHold, convertHold } from '@/lib/actions/holds';

interface Hall { id: string; name: string }
interface RoomType { id: string; name: string; base_rate: number }
interface Hold { id: string; domain: string; hall_id: string | null; event_date: string | null; slot: string | null; room_type_id: string | null; check_in: string | null; check_out: string | null; guest_name: string | null; status: string; expires_at: string }
interface Cal { hall_confirmed: { block_date: string; slot: string }[]; hall_holds: { event_date: string; slot: string }[]; room_confirmed: { check_in: string; check_out: string }[]; room_holds: { check_in: string; check_out: string }[] }

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const inp: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
const statusColour = (s: string) => (s === 'released' || s === 'expired' ? 'var(--color-text-tertiary)' : s === 'converted' ? 'var(--color-success)' : 'var(--color-text-secondary)');
const plusHours = (h: number) => { const d = new Date(); d.setUTCHours(d.getUTCHours() + h); return d.toISOString(); };

export function HoldsCalendar({ halls, roomTypes, holds, calendar, range, canManage }: {
  halls: Hall[]; roomTypes: RoomType[]; holds: Hold[]; calendar: Cal | null; range: { from: string; to: string }; canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, reset?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) { reset?.(); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }

  const [domain, setDomain] = useState<'hall' | 'stays'>('hall');
  const [hallId, setHallId] = useState(halls[0]?.id ?? ''); const [evDate, setEvDate] = useState(''); const [slot, setSlot] = useState<'morning' | 'evening' | 'full_day'>('full_day');
  const [rtId, setRtId] = useState(roomTypes[0]?.id ?? ''); const [ci, setCi] = useState(''); const [co, setCo] = useState('');
  const [gName, setGName] = useState(''); const [gPhone, setGPhone] = useState('');

  function place() {
    const expiresAt = plusHours(48); // a 48h tentative hold
    run(() => placeHold(domain === 'hall'
      ? { domain: 'hall', expiresAt, hallId, eventDate: evDate, slot, guestName: gName }
      : { domain: 'stays', expiresAt, roomTypeId: rtId, checkIn: ci, checkOut: co, guestPhone: gPhone, guestName: gName || undefined }),
      () => { setEvDate(''); setCi(''); setCo(''); setGName(''); setGPhone(''); });
  }

  return (
    <div className="flex flex-col gap-5">
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}

      {/* Availability calendar (read-only) */}
      <section style={card}>
        <h2 style={h2}>Availability · {range.from} → {range.to}</h2>
        {!calendar ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No data.</p> : (
          <div className="grid gap-3 text-sm" style={{ gridTemplateColumns: '1fr 1fr', color: 'var(--color-text)' }}>
            <div>
              <h3 className="text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Hall — confirmed</h3>
              {calendar.hall_confirmed.length === 0 ? <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>none</p> : calendar.hall_confirmed.map((b, i) => <div key={i} className="text-xs"><b style={{ color: 'var(--color-danger)' }}>●</b> {b.block_date} · {b.slot}</div>)}
              <h3 className="text-xs mt-2 mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Hall — active holds</h3>
              {calendar.hall_holds.length === 0 ? <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>none</p> : calendar.hall_holds.map((b, i) => <div key={i} className="text-xs"><b style={{ color: 'var(--color-amber, var(--color-text-secondary))' }}>◐</b> {b.event_date} · {b.slot} <span style={{ color: 'var(--color-text-tertiary)' }}>(tentative)</span></div>)}
            </div>
            <div>
              <h3 className="text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Rooms — confirmed</h3>
              {calendar.room_confirmed.length === 0 ? <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>none</p> : calendar.room_confirmed.map((s, i) => <div key={i} className="text-xs"><b style={{ color: 'var(--color-danger)' }}>●</b> {s.check_in} → {s.check_out}</div>)}
              <h3 className="text-xs mt-2 mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Rooms — active holds</h3>
              {calendar.room_holds.length === 0 ? <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>none</p> : calendar.room_holds.map((s, i) => <div key={i} className="text-xs"><b style={{ color: 'var(--color-amber, var(--color-text-secondary))' }}>◐</b> {s.check_in} → {s.check_out} <span style={{ color: 'var(--color-text-tertiary)' }}>(tentative)</span></div>)}
            </div>
          </div>
        )}
      </section>

      {/* Place a hold */}
      {canManage && (
        <section style={card}>
          <h2 style={h2}>Place a tentative hold (48h)</h2>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <select value={domain} onChange={(e) => setDomain(e.target.value as typeof domain)} style={inp} aria-label="Domain">
                <option value="hall">hall</option><option value="stays">room</option>
              </select>
              {domain === 'hall' ? (
                <>
                  <select value={hallId} onChange={(e) => setHallId(e.target.value)} style={inp} aria-label="Hall">{halls.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
                  <input type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} style={inp} aria-label="Event date" />
                  <select value={slot} onChange={(e) => setSlot(e.target.value as typeof slot)} style={inp} aria-label="Slot"><option value="morning">morning</option><option value="evening">evening</option><option value="full_day">full day</option></select>
                  <input value={gName} onChange={(e) => setGName(e.target.value)} placeholder="Guest name" style={inp} aria-label="Guest name" />
                </>
              ) : (
                <>
                  <select value={rtId} onChange={(e) => setRtId(e.target.value)} style={inp} aria-label="Room type">{roomTypes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                  <input type="date" value={ci} onChange={(e) => setCi(e.target.value)} style={inp} aria-label="Check-in" />
                  <input type="date" value={co} onChange={(e) => setCo(e.target.value)} style={inp} aria-label="Check-out" />
                  <input value={gPhone} onChange={(e) => setGPhone(e.target.value)} placeholder="Guest phone" style={inp} aria-label="Guest phone" />
                </>
              )}
              <Button onClick={place} disabled={busy || (domain === 'hall' ? !hallId || !evDate || !gName : !rtId || !ci || !co || !gPhone)}>Hold</Button>
            </div>
          </div>
        </section>
      )}

      {/* Holds list */}
      <section style={card}>
        <h2 style={h2}>Holds</h2>
        {holds.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No holds.</p> : (
          <ul className="flex flex-col">
            {holds.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span>{h.domain} · {h.domain === 'hall' ? `${h.event_date} ${h.slot}` : `${h.check_in}→${h.check_out}`} <span style={{ color: 'var(--color-text-tertiary)' }}>· {h.guest_name ?? '—'} · expires {new Date(h.expires_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span> · <b style={{ color: statusColour(h.status) }}>{h.status}</b></span>
                {canManage && h.status === 'pending' && (
                  <span className="flex items-center gap-2">
                    <Button onClick={() => run(() => convertHold({ holdId: h.id }))} disabled={busy}>Convert</Button>
                    <button onClick={() => run(() => releaseHold({ holdId: h.id }))} className="text-xs" style={{ color: 'var(--color-danger)' }} disabled={busy}>release</button>
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
