'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/utils';
import { createRoomStay, setRoomStayStatus } from '@/lib/actions/stays';

interface Room { id: string; number: string; room_types: { name: string } | null }
interface Stay { id: string; check_in: string; check_out: string; status: string; rate_quoted: number; guests: { name: string; phone: string } | null; rooms: { number: string } | null }

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const colour = (s: string) => (s === 'cancelled' || s === 'no_show' ? 'var(--color-danger)' : s === 'checked_in' || s === 'checked_out' || s === 'settled' ? 'var(--color-success)' : 'var(--color-text-secondary)');

/** Create reservations + advance/cancel from the list. */
export function ReservationManager({ rooms, stays }: { rooms: Room[]; stays: Stay[] }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '');
  const [ci, setCi] = useState('');
  const [co, setCo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, reset?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) { reset?.(); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  const next = (s: string): 'checked_in' | 'checked_out' | 'settled' | null => (s === 'reserved' ? 'checked_in' : s === 'checked_in' ? 'checked_out' : s === 'checked_out' ? 'settled' : null);

  return (
    <div className="flex flex-col gap-5">
      <section style={card}>
        <h2 style={h2}>New reservation</h2>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Guest phone" style={i} aria-label="Guest phone" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest name" style={i} aria-label="Guest name" />
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={i} aria-label="Room">
              {rooms.map((r) => <option key={r.id} value={r.id}>#{r.number} · {r.room_types?.name ?? '—'}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Check-in</label>
            <input type="date" value={ci} onChange={(e) => setCi(e.target.value)} style={i} aria-label="Check-in" />
            <label className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Check-out</label>
            <input type="date" value={co} onChange={(e) => setCo(e.target.value)} style={i} aria-label="Check-out" />
            <Button onClick={() => run(() => createRoomStay({ phone, name, roomId, checkIn: ci, checkOut: co }), () => { setPhone(''); setName(''); setCi(''); setCo(''); })} disabled={busy || !phone || !name || !roomId || !ci || !co}>Reserve</Button>
          </div>
          {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
        </div>
      </section>

      <section style={card}>
        <h2 style={h2}>Reservations</h2>
        {stays.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No reservations.</p> : (
          <ul className="flex flex-col">
            {stays.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" style={{ borderBottom: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span>{s.guests?.name ?? '—'} <span style={{ color: 'var(--color-text-tertiary)' }}>· #{s.rooms?.number ?? '—'} · {s.check_in} → {s.check_out} · {formatINR(s.rate_quoted)}/n</span></span>
                <span className="flex items-center gap-2"><b style={{ color: colour(s.status) }}>{s.status}</b>
                  {next(s.status) && <Button onClick={() => run(() => setRoomStayStatus({ stayId: s.id, status: next(s.status)! }))} disabled={busy}>→ {next(s.status)}</Button>}
                  {s.status === 'reserved' && <button onClick={() => run(() => setRoomStayStatus({ stayId: s.id, status: 'cancelled' }))} className="text-xs" style={{ color: 'var(--color-danger)' }} disabled={busy}>cancel</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
