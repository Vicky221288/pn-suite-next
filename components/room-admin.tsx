'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { upsertRoomType, createRoom } from '@/lib/actions/stays';

interface RoomType { id: string; name: string; base_rate: number }

/** Add room types (config-driven rate) + add rooms of a type. */
export function RoomAdmin({ types }: { types: RoomType[] }) {
  const router = useRouter();
  const [tName, setTName] = useState('');
  const [tRate, setTRate] = useState(0);
  const [rType, setRType] = useState(types[0]?.id ?? '');
  const [rNum, setRNum] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, reset?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) { reset?.(); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <input value={tName} onChange={(e) => setTName(e.target.value)} placeholder="Room type (e.g. Deluxe)" style={i} aria-label="Room type name" />
        <input type="number" min={0} value={tRate} onChange={(e) => setTRate(Number(e.target.value))} placeholder="₹/night" style={{ ...i, width: 110 }} aria-label="Base rate" />
        <Button onClick={() => run(() => upsertRoomType({ name: tName, baseRate: tRate }), () => { setTName(''); setTRate(0); })} disabled={busy || !tName}>Add type</Button>
      </div>
      {types.length > 0 && (
        <div className="flex flex-wrap items-end gap-2" style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 8 }}>
          <select value={rType} onChange={(e) => setRType(e.target.value)} style={i} aria-label="Type">{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <input value={rNum} onChange={(e) => setRNum(e.target.value)} placeholder="Room number" style={{ ...i, width: 130 }} aria-label="Room number" />
          <Button onClick={() => run(() => createRoom({ roomTypeId: rType, number: rNum }), () => setRNum(''))} disabled={busy || !rType || !rNum}>Add room</Button>
        </div>
      )}
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </div>
  );
}
