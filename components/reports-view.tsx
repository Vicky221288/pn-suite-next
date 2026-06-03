'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IndianRupee, Landmark, Megaphone, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
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

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };
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
  const leadsTotal = leadReport?.by_source.reduce((s, r) => s + r.leads, 0) ?? 0;

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          {msg}
        </div>
      )}

      {/* KPI strip */}
      <div className="grid" style={{ gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <StatCard label="Net P&L" value={pnl?.can_see ? money(pnl.total.net) : '—'} icon={IndianRupee} tone={pnl?.can_see ? 'brand' : 'default'} mono delay={0} hint={pnl?.can_see ? `${pnl.range.from} → ${pnl.range.to}` : 'restricted for your role'} />
        <StatCard label="Output tax" value={money(gst?.output_total_tax ?? null)} icon={Landmark} mono delay={70} hint="from invoice snapshot" />
        <StatCard label="Net GST" value={money(gst?.net_tax ?? null)} icon={Landmark} mono delay={140} hint="output − input (data)" />
        <StatCard label="Leads" value={String(leadsTotal)} icon={Users} delay={210} hint="in range" />
      </div>

      {/* P&L */}
      <Card padded={false} title="Consolidated P&amp;L" subtitle={pnl ? `${pnl.range.from} → ${pnl.range.to} · live query over the one ledger` : undefined}>
        {!pnl ? <EmptyState title="No data" message="P&L will appear once there is ledger activity in range." />
          : !pnl.can_see ? <EmptyState title="Restricted" message="Consolidated P&L requires margin/revenue visibility for your role." />
            : (
              <Table>
                <THead>
                  <TR><TH>Stream</TH><TH align="right">Revenue</TH><TH align="right">Expenses</TH><TH align="right">Net</TH></TR>
                </THead>
                <tbody>
                  {STREAMS.map((s) => pnl.streams[s] && (
                    <TR key={s}>
                      <TD><span style={{ color: 'var(--color-text)', textTransform: 'capitalize' }}>{s}</span></TD>
                      <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{money(pnl.streams[s]!.revenue)}</span></TD>
                      <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{money(pnl.streams[s]!.expenses)}</span></TD>
                      <TD align="right" mono><span style={{ color: 'var(--color-text)' }}>{money(pnl.streams[s]!.net)}</span></TD>
                    </TR>
                  ))}
                  <tr style={{ background: 'var(--color-surface-sunken)' }}>
                    <TD><span style={{ fontWeight: 700, color: 'var(--color-text)' }}>Total</span></TD>
                    <TD align="right" mono><span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{money(pnl.total.revenue)}</span></TD>
                    <TD align="right" mono><span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{money(pnl.total.expenses)}</span></TD>
                    <TD align="right" mono><span style={{ fontWeight: 700, color: 'var(--color-brand)' }}>{money(pnl.total.net)}</span></TD>
                  </tr>
                </tbody>
              </Table>
            )}
      </Card>

      {/* GST return */}
      <Card padded={false} title="GST-return summary" subtitle="Reporting only — reads the resolved invoice snapshot; filing is external">
        {!gst ? <EmptyState title="No data" message="GST output appears once invoices are issued in range." /> : (
          <>
            <Table>
              <THead>
                <TR><TH>Rate</TH><TH align="right">Taxable</TH><TH align="right">CGST</TH><TH align="right">SGST</TH><TH align="right">Tax</TH></TR>
              </THead>
              <tbody>
                {gst.output_by_rate.map((r, i) => (
                  <TR key={i}>
                    <TD><span style={{ color: 'var(--color-text)' }}>{r.gst_rate}%</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{money(r.taxable_value)}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{money(r.cgst)}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{money(r.sgst)}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text)' }}>{money(r.tax)}</span></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <p style={{ padding: 'var(--space-3) var(--card-pad)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
              Output tax {money(gst.output_total_tax)} · input GST (data) {money(gst.input_gst_total)} · net {money(gst.net_tax)}. Reads resolved invoice values — nothing is recomputed; filing is external.
            </p>
          </>
        )}
      </Card>

      {/* Per-customer ageing */}
      <Card padded={false} title="AR ageing by customer" subtitle={ageing ? `as of ${ageing.as_of}${ageing.can_see_amounts ? '' : ' · amounts hidden for your role'}` : undefined}>
        {!ageing || ageing.customers.length === 0 ? (
          <EmptyState title="No outstanding invoices" message="Customers with unpaid invoices appear here, bucketed by age." />
        ) : (
          <Table>
            <THead>
              <TR><TH>Customer</TH>{BK.map(([, l]) => <TH key={l} align="right">{l}</TH>)}<TH align="right">Total</TH></TR>
            </THead>
            <tbody>
              {ageing.customers.map((c) => (
                <TR key={c.guest_id ?? 'un'}>
                  <TD><span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{c.guest_name}</span></TD>
                  {BK.map(([k]) => <TD key={k} align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{money(c.buckets[k] ?? null)}</span></TD>)}
                  <TD align="right" mono><span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{money(c.total)}</span></TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Marketing */}
      <div className="grid" style={{ gap: 'var(--space-6)', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <Card padded={false} title="Leads by source">
          {!leadReport || leadReport.by_source.length === 0 ? (
            <EmptyState icon={Megaphone} title="No lead data" message="Lead sources appear here as enquiries are tagged." />
          ) : (
            <Table>
              <THead><TR><TH>Source</TH><TH align="right">Leads</TH><TH align="right">Won</TH></TR></THead>
              <tbody>
                {leadReport.by_source.map((s) => (
                  <TR key={s.source}>
                    <TD><span style={{ color: 'var(--color-text)' }}>{s.source.replace(/_/g, ' ')}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{s.leads}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-success)' }}>{s.conversions}</span></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card padded={false} title="By campaign">
          {!leadReport || leadReport.by_campaign.length === 0 ? (
            <EmptyState icon={Megaphone} title="No campaigns" message="Attribute leads to a campaign to see performance here." />
          ) : (
            <Table>
              <THead><TR><TH>Campaign</TH><TH align="right">Leads</TH><TH align="right">Won</TH><TH align="right">Spend</TH></TR></THead>
              <tbody>
                {leadReport.by_campaign.map((c) => (
                  <TR key={c.campaign_id}>
                    <TD><span style={{ color: 'var(--color-text)' }}>{c.name}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{c.leads}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-success)' }}>{c.conversions}</span></TD>
                    <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{money(c.spend)}</span></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {/* Marketing actions */}
      {canMarket && (
        <CreatePanel label="Marketing" title="Campaigns &amp; LED revenue">
          <div className="flex flex-col" style={{ gap: 'var(--space-3)' }}>
            <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
              <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Campaign name" style={field} aria-label="Campaign name" />
              <input value={cSpend} onChange={(e) => setCSpend(e.target.value)} placeholder="Spend" style={{ ...field, width: 120 }} aria-label="Spend" />
              <Button onClick={() => run(() => upsertCampaign({ name: cName, spend: cSpend ? Number(cSpend) : 0 }), () => { setCName(''); setCSpend(''); })} disabled={busy || !cName}>Add campaign</Button>
            </div>
            <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
              <input value={adName} onChange={(e) => setAdName(e.target.value)} placeholder="LED advertiser" style={field} aria-label="LED advertiser" />
              <input value={adAmt} onChange={(e) => setAdAmt(e.target.value)} placeholder="Amount" style={{ ...field, width: 120 }} aria-label="LED amount" />
              <Button variant="secondary" onClick={() => run(() => recordAdRevenue({ advertiser: adName, amount: Number(adAmt) }), () => { setAdName(''); setAdAmt(''); })} disabled={busy || !adName || !adAmt}>Record LED revenue</Button>
            </div>
          </div>
        </CreatePanel>
      )}

      {canMarket && leads.length > 0 && (
        <Card padded={false} title="Recent leads" subtitle="Tag a source or attribute a campaign">
          <ul className="flex flex-col">
            {leads.slice(0, 12).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-2) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
                <span className="flex items-center" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
                  <span style={{ color: 'var(--color-text)' }}>{l.name ?? l.phone}</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{l.source}</span>
                  <StatusBadge status={l.status} />
                </span>
                <span className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
                  <select defaultValue="" onChange={(e) => e.target.value && run(() => setLeadSource({ leadId: l.id, source: e.target.value }))} style={field} aria-label="Set source">
                    <option value="">set source…</option>{['referral', 'walk_in', 'instagram', 'google', 'led_hoarding', 'whatsapp_inbound'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {campaigns.length > 0 && <select defaultValue="" onChange={(e) => e.target.value && run(() => setLeadSource({ leadId: l.id, source: l.source, campaignId: e.target.value }))} style={field} aria-label="Attribute campaign"><option value="">campaign…</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {led.length > 0 && (
        <Card padded={false} title="LED revenue" subtitle="Posted to the shared ledger">
          <ul className="flex flex-col">
            {led.map((b) => (
              <li key={b.id} className="flex items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-2) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>{b.advertiser_name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{formatINR(b.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
