'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarX, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import { formatINR } from '@/lib/utils';
import { createRoomStay, setRoomStayStatus } from '@/lib/actions/stays';

interface Room { id: string; number: string; room_types: { name: string } | null }
interface Stay { id: string; check_in: string; check_out: string; status: string; rate_quoted: number; guests: { name: string; phone: string } | null; rooms: { number: string } | null }

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };

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
  const next = (s: string): 'checked_in' | 'checked_out' | 'settled' | null => (s === 'reserved' ? 'checked_in' : s === 'checked_in' ? 'checked_out' : s === 'checked_out' ? 'settled' : null);

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}

      <CreatePanel label="New reservation" title="Reserve a room">
        <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
          <div className="grid" style={{ gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Guest phone" style={field} aria-label="Guest phone" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest name" style={field} aria-label="Guest name" />
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={field} aria-label="Room">
              {rooms.map((r) => <option key={r.id} value={r.id}>#{r.number} · {r.room_types?.name ?? '—'}</option>)}
            </select>
            <label className="flex flex-col" style={{ gap: 2, fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Check-in
              <input type="date" value={ci} onChange={(e) => setCi(e.target.value)} style={field} aria-label="Check-in" />
            </label>
            <label className="flex flex-col" style={{ gap: 2, fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Check-out
              <input type="date" value={co} onChange={(e) => setCo(e.target.value)} style={field} aria-label="Check-out" />
            </label>
          </div>
          <div>
            <Button onClick={() => run(() => createRoomStay({ phone, name, roomId, checkIn: ci, checkOut: co }), () => { setPhone(''); setName(''); setCi(''); setCo(''); })} disabled={busy || !phone || !name || !roomId || !ci || !co}>Reserve</Button>
          </div>
        </div>
      </CreatePanel>

      <Card padded={false} title="Reservations" subtitle={`${stays.length} record${stays.length === 1 ? '' : 's'}`}>
        {stays.length === 0 ? (
          <EmptyState icon={CalendarX} title="No reservations yet" message="Reserve a room above — by phone and dates — to hold it. Walk-ins and check-ins flow in from the front desk." />
        ) : (
          <Table>
            <THead>
              <TR><TH>Guest</TH><TH>Room</TH><TH>Stay</TH><TH align="right">Rate</TH><TH align="right">Status</TH></TR>
            </THead>
            <tbody>
              {stays.map((s) => (
                <TR key={s.id}>
                  <TD>
                    <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{s.guests?.name ?? '—'}</span>
                    <span style={{ display: 'block', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{s.guests?.phone ?? ''}</span>
                  </TD>
                  <TD><span style={{ color: 'var(--color-text-secondary)' }}>#{s.rooms?.number ?? '—'}</span></TD>
                  <TD mono><span style={{ color: 'var(--color-text-secondary)' }}>{s.check_in} → {s.check_out}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(s.rate_quoted)}</span></TD>
                  <TD align="right">
                    <span className="inline-flex flex-wrap items-center justify-end" style={{ gap: 'var(--space-2)' }}>
                      <StatusBadge status={s.status} />
                      {next(s.status) && <Button variant="secondary" onClick={() => run(() => setRoomStayStatus({ stayId: s.id, status: next(s.status)! }))} disabled={busy}>→ {next(s.status)!.replace(/_/g, ' ')}</Button>}
                      {s.status === 'reserved' && <Button variant="ghost" onClick={() => run(() => setRoomStayStatus({ stayId: s.id, status: 'cancelled' }))} disabled={busy} style={{ color: 'var(--color-danger)' }}>Cancel</Button>}
                    </span>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
