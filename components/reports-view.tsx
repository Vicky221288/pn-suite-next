'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/utils';
import { upsertCampaign, setLeadSource, recordAdRevenue } from '@/lib/actions/reporting';

interface Stream { revenue: number | null; expenses: number | null; net: number | null }
interface Pnl { range: { from: string; to: string }; can_see: boolean; streams: Record<string, Stream>; total: Stream }
interface GstRate { gst_rate: number; taxable_value: number | null; cgst: number | null; sgst: number | null; tax: number | null }
interface Gst { can_see: boolean; output_by_rate: GstRate[]; output_total_tax: number | null; input_gst_total: number | null; net_tax: number | null }
interface Cust { guest_id: string | null; guest_name: string; count: number; buckets: Record<string, number | null>; total: number | null }
interface Ageing { as_of: string; can_see_amounts: boolean; customers: Cust[] }
interface SourceRow { source: string; leads: number; conversions: number }
interface CampRow { campaign_id: string; name: string; leads: number; conversions: number; spend: number | null }
interface LeadReport { by_source: SourceRow[]; by_campaign: CampRow[]; can_see_spend: boolean }
interface Campaign { id: string; name: string; channel: string | null; spend: number }
interface Lead { id: string; name: string | null; phone: string; source: string; status: string; campaign_id: string | null }
interface Led { id: string; advertiser_name: string; amount: number; period_start: string | null; period_end: string | null }

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const inp: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
const money = (v: number | null) => (v === null ? '₹—' : formatINR(v));
const STREAMS = ['hall', 'stays', 'catering', 'core'];
const BK: [string, string][] = [['0_30', '0–30'], ['31_60', '31–60'], ['61_90', '61–90'], ['90_plus', '90+']];

export function ReportsView({ pnl, gst, ageing, leadReport, campaigns, leads, led, canMarket }: {
  pnl: Pnl | null; gst: Gst | null; ageing: Ageing | null; leadReport: LeadReport | null; campaigns: Campaign[]; leads: Lead[]; led: Led[]; canMarket: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, reset?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) { reset?.(); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }
  const [cName, setCName] = useState(''); const [cSpend, setCSpend] = useState('');
  const [adName, setAdName] = useState(''); const [adAmt, setAdAmt] = useState('');

  return (
    <div className="flex flex-col gap-5">
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}

      {/* P&L */}
      <section style={card}>
        <h2 style={h2}>Consolidated P&amp;L {pnl ? `· ${pnl.range.from} → ${pnl.range.to}` : ''}</h2>
        {!pnl ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No data.</p> : !pnl.can_see ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Hidden — requires margin/revenue visibility.</p> : (
          <table className="text-sm" style={{ color: 'var(--color-text)' }}>
            <thead><tr style={{ color: 'var(--color-text-tertiary)' }}><th className="text-left pr-6">Stream</th><th className="text-right pr-6">Revenue</th><th className="text-right pr-6">Expenses</th><th className="text-right">Net</th></tr></thead>
            <tbody>
              {STREAMS.map((s) => pnl.streams[s] && (
                <tr key={s}><td className="pr-6">{s}</td><td className="text-right pr-6">{money(pnl.streams[s].revenue)}</td><td className="text-right pr-6">{money(pnl.streams[s].expenses)}</td><td className="text-right">{money(pnl.streams[s].net)}</td></tr>
              ))}
              <tr style={{ fontWeight: 700, borderTop: '1px solid var(--color-divider)' }}><td className="pr-6">Total</td><td className="text-right pr-6">{money(pnl.total.revenue)}</td><td className="text-right pr-6">{money(pnl.total.expenses)}</td><td className="text-right">{money(pnl.total.net)}</td></tr>
            </tbody>
          </table>
        )}
      </section>

      {/* GST return */}
      <section style={card}>
        <h2 style={h2}>GST-return summary (reporting only)</h2>
        {!gst ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No data.</p> : (
          <div className="text-sm" style={{ color: 'var(--color-text)' }}>
            <table><thead><tr style={{ color: 'var(--color-text-tertiary)' }}><th className="text-left pr-6">Rate</th><th className="text-right pr-6">Taxable</th><th className="text-right pr-6">CGST</th><th className="text-right pr-6">SGST</th><th className="text-right">Tax</th></tr></thead>
              <tbody>{gst.output_by_rate.map((r, i) => <tr key={i}><td className="pr-6">{r.gst_rate}%</td><td className="text-right pr-6">{money(r.taxable_value)}</td><td className="text-right pr-6">{money(r.cgst)}</td><td className="text-right pr-6">{money(r.sgst)}</td><td className="text-right">{money(r.tax)}</td></tr>)}</tbody>
            </table>
            <p className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Output tax {money(gst.output_total_tax)} · input GST (data) {money(gst.input_gst_total)} · net {money(gst.net_tax)}. Reads resolved invoice values; filing is external.</p>
          </div>
        )}
      </section>

      {/* Per-customer ageing */}
      <section style={card}>
        <h2 style={h2}>AR ageing by customer {ageing ? `· as of ${ageing.as_of}` : ''}</h2>
        {!ageing || ageing.customers.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No outstanding invoices.</p> : (
          <table className="text-sm" style={{ color: 'var(--color-text)' }}>
            <thead><tr style={{ color: 'var(--color-text-tertiary)' }}><th className="text-left pr-6">Customer</th>{BK.map(([, l]) => <th key={l} className="text-right pr-4">{l}</th>)}<th className="text-right">Total</th></tr></thead>
            <tbody>{ageing.customers.map((c) => <tr key={c.guest_id ?? 'un'}><td className="pr-6">{c.guest_name}</td>{BK.map(([k]) => <td key={k} className="text-right pr-4">{money(c.buckets[k] ?? null)}</td>)}<td className="text-right">{money(c.total)}</td></tr>)}</tbody>
          </table>
        )}
      </section>

      {/* Marketing */}
      <section style={card}>
        <h2 style={h2}>Marketing — lead source &amp; campaigns</h2>
        {leadReport && (
          <div className="flex flex-wrap gap-6 text-sm" style={{ color: 'var(--color-text)' }}>
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>By source (leads · conversions)</div>
              {leadReport.by_source.length === 0 ? <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>none</p> : leadReport.by_source.map((s) => <div key={s.source} className="text-xs">{s.source}: {s.leads} · {s.conversions} won</div>)}
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>By campaign</div>
              {leadReport.by_campaign.length === 0 ? <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>none</p> : leadReport.by_campaign.map((c) => <div key={c.campaign_id} className="text-xs">{c.name}: {c.leads} leads · {c.conversions} won · spend {money(c.spend)}</div>)}
            </div>
          </div>
        )}
        {canMarket && (
          <div className="flex flex-col gap-2 mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Campaign name" style={inp} aria-label="Campaign name" />
              <input value={cSpend} onChange={(e) => setCSpend(e.target.value)} placeholder="Spend" style={{ ...inp, width: 100 }} aria-label="Spend" />
              <Button onClick={() => run(() => upsertCampaign({ name: cName, spend: cSpend ? Number(cSpend) : 0 }), () => { setCName(''); setCSpend(''); })} disabled={busy || !cName}>Add campaign</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={adName} onChange={(e) => setAdName(e.target.value)} placeholder="LED advertiser" style={inp} aria-label="LED advertiser" />
              <input value={adAmt} onChange={(e) => setAdAmt(e.target.value)} placeholder="Amount" style={{ ...inp, width: 100 }} aria-label="LED amount" />
              <Button variant="secondary" onClick={() => run(() => recordAdRevenue({ advertiser: adName, amount: Number(adAmt) }), () => { setAdName(''); setAdAmt(''); })} disabled={busy || !adName || !adAmt}>Record LED revenue</Button>
            </div>
          </div>
        )}
        {canMarket && leads.length > 0 && (
          <ul className="flex flex-col mt-3">
            {leads.slice(0, 12).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span>{l.name ?? l.phone} · <span style={{ color: 'var(--color-text-tertiary)' }}>source {l.source} · {l.status}</span></span>
                <span className="flex items-center gap-1">
                  <select defaultValue="" onChange={(e) => e.target.value && run(() => setLeadSource({ leadId: l.id, source: e.target.value }))} style={inp} aria-label="Set source">
                    <option value="">set source…</option>{['referral', 'walk_in', 'instagram', 'google', 'led_hoarding', 'whatsapp_inbound'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {campaigns.length > 0 && <select defaultValue="" onChange={(e) => e.target.value && run(() => setLeadSource({ leadId: l.id, source: l.source, campaignId: e.target.value }))} style={inp} aria-label="Attribute campaign"><option value="">campaign…</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {led.length > 0 && (
          <ul className="flex flex-col mt-3">
            {led.map((b) => <li key={b.id} className="py-1 text-xs" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text-secondary)' }}>LED · {b.advertiser_name} · {formatINR(b.amount)} (posted to ledger)</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
