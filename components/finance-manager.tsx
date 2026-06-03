'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import { formatINR } from '@/lib/utils';
import { recordExpense, submitExpense, decideExpense, markExpensePaid } from '@/lib/actions/finance';

interface Expense { id: string; amount: number; expense_date: string; status: string; source_domain: string; payee_name: string | null; category_id: string | null; vendor_id: string | null }
interface Category { id: string; name: string }
interface Vendor { id: string; name: string }
interface Bucket { count: number; amount: number | null }
interface Ageing { as_of: string; can_see_amounts: boolean; buckets: Record<string, Bucket>; total_count: number; total_outstanding: number | null }

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };
const BUCKETS: [string, string][] = [['0_30', '0–30'], ['31_60', '31–60'], ['61_90', '61–90'], ['90_plus', '90+']];

export function FinanceManager({ expenses, categories, vendors, ageing, canManage, canDecide }: {
  expenses: Expense[]; categories: Category[]; vendors: Vendor[]; ageing: Ageing | null; canManage: boolean; canDecide: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, reset?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) { reset?.(); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }

  const [amount, setAmount] = useState(''); const [date, setDate] = useState(''); const [domain, setDomain] = useState<'hall' | 'stays' | 'catering' | 'core'>('core');
  const [catId, setCatId] = useState(''); const [vendorId, setVendorId] = useState(''); const [payee, setPayee] = useState('');
  const amt = (v: number | null) => (ageing?.can_see_amounts && v != null ? formatINR(v) : '—');

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}

      {/* Ageing */}
      <Card padded={false} title="Collections / AR ageing" subtitle={ageing ? `as of ${ageing.as_of}${ageing.can_see_amounts ? '' : ' · amounts hidden for your role'}` : undefined}>
        {!ageing ? (
          <EmptyState title="No ageing data" message="Outstanding invoices, bucketed by age, will appear here." />
        ) : (
          <Table>
            <THead>
              <TR><TH>Bucket (days)</TH><TH align="right">Invoices</TH><TH align="right">Outstanding</TH></TR>
            </THead>
            <tbody>
              {BUCKETS.map(([k, label]) => (
                <TR key={k}>
                  <TD><span style={{ color: 'var(--color-text)' }}>{label}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{ageing.buckets[k]?.count ?? 0}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-secondary)' }}>{amt(ageing.buckets[k]?.amount ?? null)}</span></TD>
                </TR>
              ))}
              <tr style={{ background: 'var(--color-surface-sunken)' }}>
                <TD><span style={{ fontWeight: 700, color: 'var(--color-text)' }}>Total outstanding</span></TD>
                <TD align="right" mono><span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{ageing.total_count}</span></TD>
                <TD align="right" mono><span style={{ fontWeight: 700, color: 'var(--color-brand)' }}>{amt(ageing.total_outstanding)}</span></TD>
              </tr>
            </tbody>
          </Table>
        )}
      </Card>

      {/* New expense */}
      {canManage && (
        <CreatePanel label="New expense" title="Record an expense">
          <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" style={{ ...field, width: 120 }} aria-label="Amount" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} aria-label="Expense date" />
            <select value={domain} onChange={(e) => setDomain(e.target.value as typeof domain)} style={field} aria-label="Source domain">
              <option value="core">core</option><option value="hall">hall</option><option value="stays">stays</option><option value="catering">catering</option>
            </select>
            <select value={catId} onChange={(e) => setCatId(e.target.value)} style={field} aria-label="Category">
              <option value="">category…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={field} aria-label="Vendor">
              <option value="">vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Payee (if no vendor)" style={field} aria-label="Payee" />
            <Button onClick={() => run(() => recordExpense({ amount: Number(amount), expenseDate: date, sourceDomain: domain, categoryId: catId || undefined, vendorId: vendorId || undefined, payeeName: payee || undefined }), () => { setAmount(''); setDate(''); setPayee(''); })} disabled={busy || !amount || !date}>Record draft</Button>
          </div>
        </CreatePanel>
      )}

      {/* Expenses + approval queue */}
      <Card padded={false} title="Expenses" subtitle="Approved expenses post a debit to the shared ledger · approvers can't action their own (server-enforced)">
        {expenses.length === 0 ? (
          <EmptyState icon={Receipt} title="No expenses" message="Record an expense, submit it for tiered approval; on approval it posts a debit to the one shared ledger." />
        ) : (
          <Table>
            <THead>
              <TR><TH align="right">Amount</TH><TH align="right">Date</TH><TH>Stream</TH><TH>Payee</TH><TH align="right">Status</TH><TH align="right">Actions</TH></TR>
            </THead>
            <tbody>
              {expenses.map((e) => (
                <TR key={e.id}>
                  <TD align="right" mono><span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{formatINR(e.amount)}</span></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-tertiary)' }}>{e.expense_date}</span></TD>
                  <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{e.source_domain}</span></TD>
                  <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{e.payee_name ?? '—'}</span></TD>
                  <TD align="right"><StatusBadge status={e.status} /></TD>
                  <TD align="right">
                    <span className="inline-flex flex-wrap items-center justify-end" style={{ gap: 'var(--space-2)' }}>
                      {canManage && e.status === 'draft' && <Button variant="secondary" onClick={() => run(() => submitExpense({ expenseId: e.id }))} disabled={busy}>Submit</Button>}
                      {canDecide && e.status === 'pending' && (
                        <>
                          <Button onClick={() => run(() => decideExpense({ expenseId: e.id, decision: 'approve' }))} disabled={busy}>Approve</Button>
                          <Button variant="ghost" onClick={() => run(() => decideExpense({ expenseId: e.id, decision: 'reject' }))} disabled={busy} style={{ color: 'var(--color-danger)' }}>Reject</Button>
                        </>
                      )}
                      {canManage && e.status === 'approved' && <Button variant="secondary" onClick={() => run(() => markExpensePaid({ expenseId: e.id }))} disabled={busy}>Mark paid</Button>}
                    </span>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
