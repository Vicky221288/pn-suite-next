import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatINR } from '@/lib/utils';
import { RoomAdmin } from '@/components/room-admin';

interface RoomType { id: string; name: string; base_rate: number }
interface Room { id: string; number: string; name: string | null; status: string; room_types: { name: string } | null }

/** Stays — room inventory (types + rooms + placeholder status). */
export default async function StaysPage() {
  const supabase = await createClient();
  const { data: types } = await supabase.from('room_types').select('id, name, base_rate').order('name');
  const { data: rooms } = await supabase.from('rooms').select('id, number, name, status, room_types(name)').order('number');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl" style={{ color: 'var(--color-text)' }}>Stays — Rooms</h1>
        <span className="flex gap-3">
          <Link href="/stays/frontdesk" className="text-sm" style={{ color: 'var(--color-brand)' }}>Front desk →</Link>
          <Link href="/stays/housekeeping" className="text-sm" style={{ color: 'var(--color-brand)' }}>Housekeeping →</Link>
          <Link href="/stays/folio" className="text-sm" style={{ color: 'var(--color-brand)' }}>Folios →</Link>
          <Link href="/stays/reporting" className="text-sm" style={{ color: 'var(--color-brand)' }}>Reporting →</Link>
          <Link href="/stays/reservations" className="text-sm" style={{ color: 'var(--color-brand)' }}>Reservations →</Link>
        </span>
      </div>

      <section style={card}>
        <h2 style={h2}>Room types &amp; rooms</h2>
        <RoomAdmin types={(types ?? []) as RoomType[]} />
      </section>

      <section style={card}>
        <h2 style={h2}>Rooms</h2>
        {(rooms ?? []).length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No rooms yet.</p> : (
          <ul className="flex flex-col">
            {((rooms ?? []) as unknown as Room[]).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ borderBottom: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span>#{r.number} {r.name ? <span style={{ color: 'var(--color-text-tertiary)' }}>· {r.name}</span> : null} <span style={{ color: 'var(--color-text-tertiary)' }}>· {r.room_types?.name ?? '—'}</span></span>
                <span style={{ color: r.status === 'available' ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={card}>
        <h2 style={h2}>Type rates (config-driven; GST applied at folio — S4)</h2>
        <ul className="flex flex-col text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {(types ?? []).map((t) => <li key={t.id} className="flex justify-between py-1" style={{ borderBottom: '1px solid var(--color-divider)' }}><span>{t.name}</span><span style={{ fontFamily: 'var(--font-mono)' }}>{formatINR(t.base_rate)}/night</span></li>)}
        </ul>
      </section>
    </div>
  );
}
const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
