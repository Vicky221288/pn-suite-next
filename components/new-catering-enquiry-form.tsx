'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createCateringEnquiry } from '@/lib/actions/catering-quote';

/** Capture a catering lead → create-or-link a shared Guest (W0). */
export function NewCateringEnquiryForm() {
  const router = useRouter();
  const [f, setF] = useState({ contactName: '', contactPhone: '', eventType: '', eventDate: '', guestCount: 100 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: string, v: string | number) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const res = await createCateringEnquiry({
      contactName: f.contactName, contactPhone: f.contactPhone,
      eventType: f.eventType || undefined, eventDate: f.eventDate || undefined, guestCount: Number(f.guestCount),
    });
    setBusy(false);
    if (res.ok) { const r = res.data as { guest_created: boolean }; setMsg(r.guest_created ? 'Created (new guest).' : 'Created (linked existing guest).'); setF({ contactName: '', contactPhone: '', eventType: '', eventDate: '', guestCount: 100 }); router.refresh(); }
    else setMsg(`${res.error}: ${res.message}`);
  }
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <input value={f.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="Contact name" required style={i} aria-label="Contact name" />
      <input value={f.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="Phone" required style={i} aria-label="Phone" />
      <input value={f.eventType} onChange={(e) => set('eventType', e.target.value)} placeholder="Event type" style={i} aria-label="Event type" />
      <input type="date" value={f.eventDate} onChange={(e) => set('eventDate', e.target.value)} style={i} aria-label="Event date" />
      <input type="number" min={0} value={f.guestCount} onChange={(e) => set('guestCount', Number(e.target.value))} placeholder="Guests" style={{ ...i, width: 100 }} aria-label="Guest count" />
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'New enquiry'}</Button>
      {msg && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{msg}</span>}
    </form>
  );
}
