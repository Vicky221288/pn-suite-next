'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoRow } from '@/components/ui/info-row';
import { Steps, type Step } from '@/components/ui/steps';
import { formatINR } from '@/lib/utils';
import { generateContract, sendContract, signContract } from '@/lib/actions/hall';

interface Contract { id: string; version: number; status: string; contract_value: number; terms: string | null; signed_by_name: string | null; signed_at: string | null }

const cTone = (s: string) => (s === 'signed' ? 'success' : s === 'sent' ? 'info' : 'neutral') as 'success' | 'info' | 'neutral';
const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };

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

  const Err = msg ? (
    <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
      <TriangleAlert size={15} aria-hidden /> {msg}
    </div>
  ) : null;

  // No contract yet
  if (contracts.length === 0) {
    return (
      <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
        {!confirmable ? (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Confirm the booking before generating a contract.</p>
        ) : (
          <>
            <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} placeholder="Contract terms…" style={field} aria-label="Terms" />
            <div><Button onClick={() => run(() => generateContract({ bookingId, terms: terms || undefined }))} disabled={busy}>Generate contract</Button></div>
          </>
        )}
        {Err}
      </div>
    );
  }

  const flags = { draft: 0, sent: 1, signed: 2 }[current?.status as 'draft' | 'sent' | 'signed'] ?? 0;
  const locked = current?.status === 'signed';
  const steps: Step[] = ['Draft', 'Sent', 'Signed'].map((label, idx): Step => ({
    label, state: idx < flags ? 'done' : idx === flags ? (locked ? 'done' : 'current') : 'todo',
  }));

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
      {/* Current contract */}
      <Steps steps={steps} />
      <dl className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
        <InfoRow label="Version" value={`v${current!.version}`} mono />
        <InfoRow label="Contract value" value={formatINR(current!.contract_value)} mono strong />
        <InfoRow label="Status" value={<Badge tone={cTone(current!.status)}>{current!.status}</Badge>} />
        {current!.signed_by_name && <InfoRow label="Signed by" value={current!.signed_by_name} tone="muted" />}
      </dl>

      <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-divider)' }}>
        {locked ? (
          <span className="inline-flex items-center" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-success)' }}>
            <Lock size={15} aria-hidden /> Signed &amp; locked — changes require a new version.
          </span>
        ) : current!.status === 'draft' ? (
          <Button onClick={() => run(() => sendContract({ contractId: current!.id }))} disabled={busy}>Mark sent</Button>
        ) : current!.status === 'sent' ? (
          <>
            <input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="Signatory name" style={{ ...field, width: 200 }} aria-label="Signatory" />
            <Button onClick={() => run(() => signContract({ contractId: current!.id, signedByName: signer }))} disabled={busy || !signer}>Capture signature</Button>
          </>
        ) : null}
        {locked && <Button variant="secondary" onClick={() => run(() => generateContract({ bookingId }))} disabled={busy}>New version (supersede)</Button>}
      </div>

      {/* Superseded versions */}
      {contracts.length > 1 && (
        <div style={{ paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-divider)' }}>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)' }}>Earlier versions</div>
          <ul className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
            {contracts.slice(1).map((c) => (
              <li key={c.id} className="flex items-center justify-between" style={{ gap: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>v{c.version} · {formatINR(c.contract_value)}</span>
                <Badge tone={cTone(c.status)}>{c.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {Err}
    </div>
  );
}
