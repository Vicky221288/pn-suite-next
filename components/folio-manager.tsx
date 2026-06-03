'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Receipt, TriangleAlert, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import { formatINR } from '@/lib/utils';
import { addFolioCharge, postRoomNights, settleFolio } from '@/lib/actions/stays';

interface Charge { id: string; charge_type: string; description: string | null; amount: number }
interface Stay { id: string; check_in: string; check_out: string; status: string; rate_quoted: number; guests: { name: string } | null; rooms: { number: string } | null; folio_charges: Charge[] }

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };
const CHARGE_LABEL: Record<string, string> = { room_night: 'Room night', fnb: 'F&B', other: 'Other' };

export function FolioManager({ stays }: { stays: Stay[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [amt, setAmt] = useState<Record<string, number>>({});
  const [desc, setDesc] = useState<Record<string, string>>({});
  const [dep, setDep] = useState<Record<string, number>>({});

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }
  const total = (s: Stay) => s.folio_charges.reduce((x, c) => x + Number(c.amount), 0);

  if (stays.length === 0) {
    return (
      <Card padded={false}>
        <EmptyState icon={Receipt} title="No active folios" message="A folio opens when a guest checks in. Charges, F&B, and settlement appear here through to the GST invoice." />
      </Card>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}

      {stays.map((s) => {
        const hasRoomNights = s.folio_charges.some((c) => c.charge_type === 'room_night');
        return (
          <Card
            key={s.id}
            padded={false}
            title={<span>{s.guests?.name ?? '—'} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>· #{s.rooms?.number ?? '—'}</span></span>}
            subtitle={<span style={{ fontFamily: 'var(--font-mono)' }}>{s.check_in} → {s.check_out}</span>}
            actions={<StatusBadge status={s.status} />}
          >
            {/* Charges */}
            {s.folio_charges.length === 0 ? (
              <div style={{ padding: 'var(--space-5) var(--card-pad)', fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                No charges yet — post room nights or add a charge below.
              </div>
            ) : (
              <Table>
                <THead>
                  <TR><TH>Charge</TH><TH>Description</TH><TH align="right">Amount</TH></TR>
                </THead>
                <tbody>
                  {s.folio_charges.map((c) => (
                    <TR key={c.id}>
                      <TD><span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{CHARGE_LABEL[c.charge_type] ?? c.charge_type.replace(/_/g, ' ')}</span></TD>
                      <TD><span style={{ color: 'var(--color-text-tertiary)' }}>{c.description ?? '—'}</span></TD>
                      <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{formatINR(c.amount)}</span></TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}

            {/* Running total — prominent, brand, mono */}
            <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-4)', padding: 'var(--space-4) var(--card-pad)', borderTop: '1px solid var(--color-divider)', background: 'var(--color-surface-sunken)' }}>
              <span style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', fontWeight: 600, color: 'var(--color-text-tertiary)' }}>Folio total</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--color-brand)' }}>{formatINR(total(s))}</span>
            </div>

            {/* Controls / settlement */}
            <div style={{ padding: 'var(--space-4) var(--card-pad)' }}>
              {s.status !== 'settled' ? (
                <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
                  <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
                    {!hasRoomNights && <Button variant="secondary" onClick={() => run(() => postRoomNights({ stayId: s.id }))} disabled={busy}>Post room nights</Button>}
                    <input type="number" value={amt[s.id] ?? ''} onChange={(e) => setAmt((p) => ({ ...p, [s.id]: Number(e.target.value) }))} placeholder="₹ charge" style={{ ...field, width: 110 }} aria-label="Charge amount" />
                    <input value={desc[s.id] ?? ''} onChange={(e) => setDesc((p) => ({ ...p, [s.id]: e.target.value }))} placeholder="description" style={{ ...field, flex: '1 1 140px' }} aria-label="Charge description" />
                    <Button onClick={() => run(() => addFolioCharge({ stayId: s.id, chargeType: 'other', amount: amt[s.id] ?? 0, description: desc[s.id] || undefined }))} disabled={busy || !amt[s.id]}>Add charge</Button>
                  </div>
                  {s.status === 'checked_out' && (
                    <div className="flex flex-col" style={{ gap: 'var(--space-2)', borderTop: '1px solid var(--color-divider)', paddingTop: 'var(--space-3)' }}>
                      <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
                        <label className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Deposit applied</label>
                        <input type="number" value={dep[s.id] ?? ''} onChange={(e) => setDep((p) => ({ ...p, [s.id]: Number(e.target.value) }))} placeholder="₹ deposit" style={{ ...field, width: 110 }} aria-label="Deposit applied" />
                        <Button onClick={() => run(() => settleFolio({ stayId: s.id, depositApplied: dep[s.id] ?? 0 }))} disabled={busy}><Receipt size={15} /> Settle → invoice</Button>
                      </div>
                      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', maxWidth: '60ch' }}>
                        The deposit is a refundable liability discharged at settlement — never a charge line and never taxed. Settling generates the GST invoice and resolves the deposit.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <span className="inline-flex items-center" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-success)' }}>
                  <CheckCircle2 size={16} /> Settled — GST invoice issued, deposit resolved.
                </span>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
