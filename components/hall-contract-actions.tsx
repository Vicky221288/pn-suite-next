'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/utils';
import { generateContract, sendContract, signContract } from '@/lib/actions/hall';

interface Contract { id: string; version: number; status: string; contract_value: number; terms: string | null; signed_by_name: string | null; signed_at: string | null }

/** Contract e-sign lifecycle (draft → sent → signed; signed immutable, new version supersedes). */
export function ContractActions({ bookingId, bookingStatus, contracts }: { bookingId: string; bookingStatus: string; contracts: Contract[] }) {
  const router = useRouter();
  const [terms, setTerms] = useState('');
  const [signer, setSigner] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const current = contracts[0];
  const confirmable = ['confirmed', 'completed', 'settled'].includes(bookingStatus);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };

  return (
    <div className="flex flex-col gap-3">
      {contracts.length === 0 ? (
        !confirmable ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Confirm the booking before generating a contract.</p> : (
          <div className="flex flex-col gap-2">
            <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} placeholder="Contract terms…" style={i} aria-label="Terms" />
            <div><Button onClick={() => run(() => generateContract({ bookingId, terms: terms || undefined }))} disabled={busy}>Generate contract</Button></div>
          </div>
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {contracts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm" style={{ borderBottom: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
              <span>v{c.version} · {formatINR(c.contract_value)} · <b style={{ color: c.status === 'signed' ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>{c.status}</b>{c.signed_by_name ? ` · signed ${c.signed_by_name}` : ''}</span>
              {c === current && c.status === 'draft' && <Button onClick={() => run(() => sendContract({ contractId: c.id }))} disabled={busy}>Mark sent</Button>}
              {c === current && c.status === 'sent' && (
                <span className="flex items-center gap-2">
                  <input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="signatory" style={{ ...i, width: 140 }} aria-label="Signatory" />
                  <Button onClick={() => run(() => signContract({ contractId: c.id, signedByName: signer }))} disabled={busy || !signer}>Sign</Button>
                </span>
              )}
            </li>
          ))}
          {current?.status === 'signed' && <li><Button onClick={() => run(() => generateContract({ bookingId }))} disabled={busy}>New version (supersede)</Button></li>}
        </ul>
      )}
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </div>
  );
}
