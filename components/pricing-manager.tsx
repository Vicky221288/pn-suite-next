'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/utils';
import { upsertRateRule, setRateRuleActive, resolvePrice } from '@/lib/actions/pricing';

interface Rule { id: string; name: string; subject_type: string; subject_id: string | null; condition_type: string; date_from: string | null; date_to: string | null; days_of_week: number[] | null; occupancy_min: number | null; adjustment_kind: string; adjustment_value: number; priority: number; active: boolean }
interface RoomType { id: string; name: string; base_rate: number }
interface Step { rule_id: string; name: string; priority: number; condition: string; kind: string; value: number; fired: boolean; running_after: number }
interface Preview { base: number; effective_price: number; overridden: boolean; steps: Step[] }

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const inp: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
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

  // rule form
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

  // preview
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
    <div className="flex flex-col gap-5">
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}

      {/* Price preview */}
      <section style={card}>
        <h2 style={h2}>Price preview (on demand — selling price, pre-tax)</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select value={pvRt} onChange={(e) => setPvRt(e.target.value)} style={inp} aria-label="Room type">
            {roomTypes.map((r) => <option key={r.id} value={r.id}>{r.name} · base {formatINR(r.base_rate)}</option>)}
          </select>
          <input type="date" value={pvDate} onChange={(e) => setPvDate(e.target.value)} style={inp} aria-label="Date" />
          <input value={pvOcc} onChange={(e) => setPvOcc(e.target.value)} placeholder="Occupancy %" style={{ ...inp, width: 110 }} aria-label="Occupancy percent" />
          <Button onClick={doPreview} disabled={busy || !pvRt}>Preview</Button>
        </div>
        {preview && (
          <div className="mt-3 text-sm" style={{ color: 'var(--color-text)' }}>
            <p>Base {formatINR(preview.base)} → <b>{formatINR(preview.effective_price)}</b>{preview.overridden ? ' (override)' : ''}</p>
            <ul className="flex flex-col mt-1">
              {preview.steps.map((s, idx) => (
                <li key={idx} className="text-xs" style={{ color: s.fired ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)' }}>
                  #{s.priority} {s.name} · {s.condition} · {s.kind} {s.value} · {s.fired ? `fired → ${formatINR(s.running_after)}` : 'did not fire'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Rule manager */}
      {canManage && (
        <section style={card}>
          <h2 style={h2}>New rate rule (room type)</h2>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rule name" style={inp} aria-label="Rule name" />
              <select value={subjId} onChange={(e) => setSubjId(e.target.value)} style={inp} aria-label="Applies to">
                <option value="">all room types</option>
                {roomTypes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select value={cond} onChange={(e) => setCond(e.target.value as typeof cond)} style={inp} aria-label="Condition">
                <option value="always">always</option><option value="date_range">date range</option><option value="day_of_week">day of week</option><option value="occupancy">occupancy ≥</option>
              </select>
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} style={inp} aria-label="Adjustment kind">
                <option value="percent">percent %</option><option value="absolute">absolute ₹</option>
              </select>
              <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'percent' ? '+20 / -10' : 'price'} style={{ ...inp, width: 110 }} aria-label="Adjustment value" />
              <input value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="priority" style={{ ...inp, width: 90 }} aria-label="Priority" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {cond === 'date_range' && <><input type="date" value={dFrom} onChange={(e) => setDFrom(e.target.value)} style={inp} aria-label="From" /><input type="date" value={dTo} onChange={(e) => setDTo(e.target.value)} style={inp} aria-label="To" /></>}
              {cond === 'day_of_week' && DAYS.map((d, i) => <label key={d} className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}><input type="checkbox" checked={dows.includes(i)} onChange={() => toggleDow(i)} aria-label={d} />{d}</label>)}
              {cond === 'occupancy' && <input value={occ} onChange={(e) => setOcc(e.target.value)} placeholder="min %" style={{ ...inp, width: 110 }} aria-label="Occupancy min" />}
              <Button onClick={saveRule} disabled={busy || !name || !value}>Save rule</Button>
            </div>
          </div>
        </section>
      )}

      {/* Rules list */}
      <section style={card}>
        <h2 style={h2}>Rules (priority order)</h2>
        {rules.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No rules yet.</p> : (
          <ul className="flex flex-col">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span>#{r.priority} <b>{r.name}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· {r.condition_type} · {r.adjustment_kind} {r.adjustment_value}{r.subject_id ? ' · specific' : ' · all'}</span> · <b style={{ color: r.active ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>{r.active ? 'active' : 'inactive'}</b></span>
                {canManage && <button onClick={() => run(() => setRateRuleActive({ ruleId: r.id, active: !r.active }))} className="text-xs" style={{ color: 'var(--color-brand)' }} disabled={busy}>{r.active ? 'deactivate' : 'activate'}</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
