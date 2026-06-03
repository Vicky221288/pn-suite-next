'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { InfoRow } from '@/components/ui/info-row';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import { formatINR } from '@/lib/utils';
import { upsertRateRule, setRateRuleActive, resolvePrice } from '@/lib/actions/pricing';

interface Rule { id: string; name: string; subject_type: string; subject_id: string | null; condition_type: string; date_from: string | null; date_to: string | null; days_of_week: number[] | null; occupancy_min: number | null; adjustment_kind: string; adjustment_value: number; priority: number; active: boolean }
interface RoomType { id: string; name: string; base_rate: number }
interface Step { rule_id: string; name: string; priority: number; condition: string; kind: string; value: number; fired: boolean; running_after: number }
interface Preview { base: number; effective_price: number; overridden: boolean; steps: Step[] }

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function PricingManager({ rules, roomTypes, canManage }: { rules: Rule[]; roomTypes: RoomType[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, reset?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) { reset?.(); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }

  const [name, setName] = useState(''); const [subjId, setSubjId] = useState('');
  const [cond, setCond] = useState<'always' | 'date_range' | 'day_of_week' | 'occupancy'>('always');
  const [kind, setKind] = useState<'percent' | 'absolute'>('percent');
  const [value, setValue] = useState('10'); const [priority, setPriority] = useState('100');
  const [dFrom, setDFrom] = useState(''); const [dTo, setDTo] = useState('');
  const [dows, setDows] = useState<number[]>([0, 6]); const [occ, setOcc] = useState('80');
  const toggleDow = (d: number) => setDows((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort()));

  function saveRule() {
    run(() => upsertRateRule({
      name, subjectType: 'room_type', subjectId: subjId || undefined, conditionType: cond,
      adjustmentKind: kind, adjustmentValue: Number(value), priority: Number(priority),
      dateFrom: cond === 'date_range' ? (dFrom || undefined) : undefined,
      dateTo: cond === 'date_range' ? (dTo || undefined) : undefined,
      daysOfWeek: cond === 'day_of_week' ? dows : undefined,
      occupancyMin: cond === 'occupancy' ? Number(occ) : undefined,
    }), () => setName(''));
  }

  const [pvRt, setPvRt] = useState(roomTypes[0]?.id ?? ''); const [pvDate, setPvDate] = useState(''); const [pvOcc, setPvOcc] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  async function doPreview() {
    const rt = roomTypes.find((r) => r.id === pvRt); if (!rt) return;
    setBusy(true); setMsg(null);
    const res = await resolvePrice({ subjectType: 'room_type', subjectId: pvRt, base: rt.base_rate, date: pvDate || undefined, occupancyPct: pvOcc ? Number(pvOcc) : undefined });
    setBusy(false);
    if (res.ok) setPreview(res.data as Preview); else setMsg(`${res.error}: ${res.message}`);
  }

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}

      {/* Price preview — selling, pre-tax */}
      <Card title="Price preview" subtitle="On-demand · selling price, pre-tax (GST is resolved separately and never shown here)">
        <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
          <select value={pvRt} onChange={(e) => setPvRt(e.target.value)} style={field} aria-label="Room type">
            {roomTypes.map((r) => <option key={r.id} value={r.id}>{r.name} · base {formatINR(r.base_rate)}</option>)}
          </select>
          <input type="date" value={pvDate} onChange={(e) => setPvDate(e.target.value)} style={field} aria-label="Date" />
          <input value={pvOcc} onChange={(e) => setPvOcc(e.target.value)} placeholder="Occupancy %" style={{ ...field, width: 130 }} aria-label="Occupancy percent" />
          <Button onClick={doPreview} disabled={busy || !pvRt}>Preview</Button>
        </div>
        {preview && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <dl className="flex flex-col" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <InfoRow label="Base" value={formatINR(preview.base)} mono />
              <InfoRow label={<span className="inline-flex items-center" style={{ gap: 'var(--space-2)' }}>Effective price {preview.overridden && <Badge tone="warning">override</Badge>}</span>} value={formatINR(preview.effective_price)} mono strong tone="brand" />
            </dl>
            <Table>
              <THead>
                <TR><TH align="right">#</TH><TH>Rule</TH><TH>Condition</TH><TH align="right">Adjust</TH><TH align="right">Result</TH></TR>
              </THead>
              <tbody>
                {preview.steps.map((s, idx) => (
                  <TR key={idx}>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-tertiary)' }}>{s.priority}</span></TD>
                    <TD>
                      <span style={{ color: s.fired ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>{s.name}</span>
                      <span style={{ marginLeft: 'var(--space-2)' }}><Badge tone={s.fired ? 'success' : 'neutral'}>{s.fired ? 'fired' : 'skipped'}</Badge></span>
                    </TD>
                    <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{s.condition}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{s.kind === 'percent' ? `${s.value}%` : formatINR(s.value)}</span></TD>
                    <TD align="right" mono><span style={{ color: s.fired ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>{s.fired ? formatINR(s.running_after) : '—'}</span></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      {/* New rule */}
      {canManage && (
        <CreatePanel label="New rule" title="New rate rule (room type)">
          <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
            <div className="grid" style={{ gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rule name" style={field} aria-label="Rule name" />
              <select value={subjId} onChange={(e) => setSubjId(e.target.value)} style={field} aria-label="Applies to">
                <option value="">all room types</option>
                {roomTypes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select value={cond} onChange={(e) => setCond(e.target.value as typeof cond)} style={field} aria-label="Condition">
                <option value="always">always</option><option value="date_range">date range</option><option value="day_of_week">day of week</option><option value="occupancy">occupancy ≥</option>
              </select>
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} style={field} aria-label="Adjustment kind">
                <option value="percent">percent %</option><option value="absolute">absolute ₹</option>
              </select>
              <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'percent' ? '+20 / -10' : 'price'} style={field} aria-label="Adjustment value" />
              <input value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="priority" style={field} aria-label="Priority" />
            </div>
            <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-3)' }}>
              {cond === 'date_range' && <><input type="date" value={dFrom} onChange={(e) => setDFrom(e.target.value)} style={field} aria-label="From" /><input type="date" value={dTo} onChange={(e) => setDTo(e.target.value)} style={field} aria-label="To" /></>}
              {cond === 'day_of_week' && DAYS.map((d, i) => <label key={d} className="flex items-center" style={{ gap: 4, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}><input type="checkbox" checked={dows.includes(i)} onChange={() => toggleDow(i)} aria-label={d} />{d}</label>)}
              {cond === 'occupancy' && <input value={occ} onChange={(e) => setOcc(e.target.value)} placeholder="min %" style={{ ...field, width: 130 }} aria-label="Occupancy min" />}
              <Button onClick={saveRule} disabled={busy || !name || !value}>Save rule</Button>
            </div>
          </div>
        </CreatePanel>
      )}

      {/* Rules */}
      <Card padded={false} title="Rules" subtitle="Applied in priority order">
        {rules.length === 0 ? (
          <EmptyState icon={Tag} title="No rate rules yet" message="Add a rule to flex the selling price by date, day of week, or occupancy. Rules stack by priority; an absolute rule is a terminal override." />
        ) : (
          <Table>
            <THead>
              <TR><TH align="right">#</TH><TH>Rule</TH><TH>Condition</TH><TH align="right">Adjust</TH><TH>Scope</TH><TH align="right">Status</TH>{canManage && <TH align="right">Actions</TH>}</TR>
            </THead>
            <tbody>
              {rules.map((r) => (
                <TR key={r.id}>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-tertiary)' }}>{r.priority}</span></TD>
                  <TD><span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{r.name}</span></TD>
                  <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{r.condition_type.replace(/_/g, ' ')}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{r.adjustment_kind === 'percent' ? `${r.adjustment_value}%` : formatINR(r.adjustment_value)}</span></TD>
                  <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>{r.subject_id ? 'specific' : 'all'}</span></TD>
                  <TD align="right"><Badge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'active' : 'inactive'}</Badge></TD>
                  {canManage && <TD align="right"><Button variant="ghost" onClick={() => run(() => setRateRuleActive({ ruleId: r.id, active: !r.active }))} disabled={busy}>{r.active ? 'Deactivate' : 'Activate'}</Button></TD>}
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
