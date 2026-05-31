'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { sendBeo, signBeo } from '@/lib/actions/catering-beo';

/** Draft → Send → Sign. Signing captures name + timestamp and locks the BEO. */
export function BeoLifecycle({ beoId, status }: { beoId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState('');

  async function send() {
    setBusy(true); setMsg(null);
    const res = await sendBeo({ beoId });
    setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }
  async function sign() {
    if (!name.trim()) { setMsg('Signatory name required.'); return; }
    setBusy(true); setMsg(null);
    const res = await signBeo({ beoId, signedByName: name.trim(), signedMethod: 'click' });
    setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  return (
    <div className="flex flex-col gap-3">
      {status === 'draft' && (
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Draft — send to the client for signature.</span>
          <Button onClick={send} disabled={busy}>{busy ? '…' : 'Mark sent'}</Button>
        </div>
      )}
      {status === 'sent' && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Signatory name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...i, width: 220 }} aria-label="Signatory name" />
          </div>
          <Button onClick={sign} disabled={busy}>{busy ? '…' : 'Capture signature'}</Button>
        </div>
      )}
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </div>
  );
}
