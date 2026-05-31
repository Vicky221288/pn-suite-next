'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/utils';
import { assignEventVendor, setEventVendorStatus } from '@/lib/actions/hall';

interface Linked { id: string; service_type: string; amount: number; commission_amount: number; status: string; vendors: { name: string } | null }
interface Vendor { id: string; name: string }
const NEXT: Record<string, 'confirmed' | 'paid'> = { proposed: 'confirmed', confirmed: 'paid' };

/** Link W1d vendors to the event (service, amount, commission) + advance status. */
export function VendorPanel({ eventId, linked, vendors }: { eventId: string; linked: Linked[]; vendors: Vendor[] }) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? '');
  const [service, setService] = useState('decor');
  const [amount, setAmount] = useState(0);
  const [commission, setCommission] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {linked.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 py-1 text-sm" style={{ borderBottom: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
            <span>{l.vendors?.name ?? '—'} <span style={{ color: 'var(--color-text-tertiary)' }}>· {l.service_type} · {formatINR(l.amount)} (comm. {formatINR(l.commission_amount)})</span></span>
            <span className="flex items-center gap-2"><b style={{ color: l.status === 'paid' ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>{l.status}</b>
              {l.status !== 'paid' && <Button onClick={() => run(() => setEventVendorStatus({ eventVendorId: l.id, status: NEXT[l.status] ?? 'confirmed' }))} disabled={busy}>→ {NEXT[l.status]}</Button>}
            </span>
          </li>
        ))}
      </ul>
      {vendors.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={i} aria-label="Vendor">{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          <input value={service} onChange={(e) => setService(e.target.value)} placeholder="service" style={{ ...i, width: 110 }} aria-label="Service type" />
          <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} placeholder="₹" style={{ ...i, width: 100 }} aria-label="Amount" />
          <input type="number" value={commission} onChange={(e) => setCommission(Number(e.target.value))} placeholder="commission ₹" style={{ ...i, width: 120 }} aria-label="Commission" />
          <Button onClick={() => run(() => assignEventVendor({ eventId, vendorId, serviceType: service, amount, commission }))} disabled={busy || !vendorId}>Link vendor</Button>
        </div>
      ) : <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No vendors yet — add one in catering vendors.</p>}
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </div>
  );
}
