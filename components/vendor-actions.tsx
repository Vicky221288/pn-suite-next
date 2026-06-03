'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert, Handshake } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatINR } from '@/lib/utils';
import { assignEventVendor, setEventVendorStatus } from '@/lib/actions/hall';

interface Linked { id: string; service_type: string; amount: number; commission_amount: number; status: string; vendors: { name: string } | null }
interface Vendor { id: string; name: string }
const NEXT: Record<string, 'confirmed' | 'paid'> = { proposed: 'confirmed', confirmed: 'paid' };
const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };

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

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
      {linked.length === 0 ? (
        <EmptyState icon={Handshake} title="No vendors linked" message="Link a vendor with its service, fee, and commission below, then advance proposed → confirmed → paid." />
      ) : (
        <ul className="flex flex-col" style={{ borderTop: '1px solid var(--color-divider)' }}>
          {linked.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--color-divider)' }}>
              <div className="min-w-0">
                <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                  <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{l.vendors?.name ?? '—'}</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{l.service_type}</span>
                </div>
                <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{formatINR(l.amount)} · comm. {formatINR(l.commission_amount)}</div>
              </div>
              <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                <StatusBadge status={l.status} />
                {l.status !== 'paid' && <Button variant="secondary" onClick={() => run(() => setEventVendorStatus({ eventVendorId: l.id, status: NEXT[l.status] ?? 'confirmed' }))} disabled={busy}>→ {NEXT[l.status] ?? 'confirmed'}</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {vendors.length > 0 ? (
        <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={field} aria-label="Vendor">{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          <input value={service} onChange={(e) => setService(e.target.value)} placeholder="service" style={{ ...field, width: 120 }} aria-label="Service type" />
          <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} placeholder="₹ amount" style={{ ...field, width: 110 }} aria-label="Amount" />
          <input type="number" value={commission} onChange={(e) => setCommission(Number(e.target.value))} placeholder="₹ commission" style={{ ...field, width: 130 }} aria-label="Commission" />
          <Button onClick={() => run(() => assignEventVendor({ eventId, vendorId, serviceType: service, amount, commission }))} disabled={busy || !vendorId}><Handshake size={15} /> Link vendor</Button>
        </div>
      ) : <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>No vendors yet — add one in catering vendors.</p>}

      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}
    </div>
  );
}
