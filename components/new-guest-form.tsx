'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createGuest } from '@/lib/actions/guest';

/** Create / find-or-create a guest (dedup by phone+name happens in the RPC). */
export function NewGuestForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await createGuest({ name, phone, email: email || undefined });
    setBusy(false);
    if (res.ok) {
      const r = res.data as { created: boolean };
      setMsg(r.created ? 'Created.' : 'Already existed (matched by phone + name).');
      setName(''); setPhone(''); setEmail('');
      router.refresh();
    } else setMsg(`${res.error}: ${res.message}`);
  }

  const input: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required style={input} aria-label="Name" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" required style={input} aria-label="Phone" />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" style={input} aria-label="Email" />
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add guest'}</Button>
      {msg && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{msg}</span>}
    </form>
  );
}
