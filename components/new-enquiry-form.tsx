'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createEnquiry } from '@/lib/actions/slice';

/** New-enquiry entry point — fires the wrapper+RPC + the A1 acknowledgement (B3). */
export function NewEnquiryForm() {
  const router = useRouter();
  const [area, setArea] = useState<'stays' | 'hall_catering'>('hall_catering');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await createEnquiry({ functionArea: area, phone, name });
    setBusy(false);
    setMsg(res.ok ? 'Created (+ acknowledgement queued)' : `${res.error}: ${res.message}`);
    if (res.ok) { setPhone(''); setName(''); router.refresh(); }
  }

  const input: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <select value={area} onChange={(e) => setArea(e.target.value as typeof area)} style={input} aria-label="Function area">
        <option value="hall_catering">Hall / Catering</option>
        <option value="stays">Stays</option>
      </select>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required style={input} aria-label="Name" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" required style={input} aria-label="Phone" />
      <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'New enquiry'}</Button>
      {msg && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{msg}</span>}
    </form>
  );
}
