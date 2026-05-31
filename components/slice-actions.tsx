'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { recordFollowup, createQuote, createEvent, settleBooking } from '@/lib/actions/slice';
import { confirmBooking } from '@/lib/actions/booking';

/**
 * Drives the spine thread for one lead via the B5 server actions (each = the
 * wrapper around an atomic RPC). Minimal but real — enough to walk
 * Enquiry → Quote → Booking → Event → Settlement on the live UI.
 */
export function SliceActions(props: {
  leadId: string;
  hallId: string | null;
  bookingId: string | null;
  settled: boolean;
  canSettle: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rent, setRent] = useState(200000);
  const [eventDate, setEventDate] = useState('');
  const [slot, setSlot] = useState<'morning' | 'evening' | 'full_day'>('full_day');

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true);
    setMsg(null);
    const res = await fn();
    setBusy(false);
    setMsg(res.ok ? `${label}: OK` : `${label}: ${res.error ?? ''} ${res.message ?? ''}`);
    if (res.ok) router.refresh();
  }

  const input: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)', width: 140 };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => run('Follow-up', () => recordFollowup({ leadId: props.leadId }))}>Log follow-up</Button>
        <input type="number" value={rent} onChange={(e) => setRent(Number(e.target.value))} style={input} aria-label="Hall rent" />
        <Button variant="secondary" disabled={busy} onClick={() => run('Quote', () => createQuote({ leadId: props.leadId, hallRent: rent, guestCount: 300 }))}>Send quote</Button>
      </div>

      {!props.bookingId && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} style={input} aria-label="Event date" />
          <select value={slot} onChange={(e) => setSlot(e.target.value as typeof slot)} style={input} aria-label="Slot">
            <option value="morning">Morning</option>
            <option value="evening">Evening</option>
            <option value="full_day">Full day</option>
          </select>
          <Button disabled={busy || !props.hallId || !eventDate} onClick={() =>
            run('Confirm booking', () => confirmBooking({ hallId: props.hallId!, eventDate, slot, hallRent: rent, customerName: 'Walk-through', idempotencyKey: `ui-${props.leadId}-${eventDate}-${slot}`, leadId: props.leadId }))
          }>Confirm booking (+50% deposit)</Button>
        </div>
      )}

      {props.bookingId && !props.settled && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => run('Event', () => createEvent({ bookingId: props.bookingId!, guestCount: 300 }))}>Create event (BEO)</Button>
          <Button disabled={busy || !props.canSettle} onClick={() => run('Settle', () => settleBooking({ bookingId: props.bookingId!, depositResolution: 'refund' }))}>
            {props.canSettle ? 'Settle (GST invoice + refund deposit)' : 'Settle (Owner/PM only)'}
          </Button>
        </div>
      )}

      {msg && <p className="text-xs" style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{msg}</p>}
    </div>
  );
}
