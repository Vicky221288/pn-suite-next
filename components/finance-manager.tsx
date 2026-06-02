'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/utils';
import { recordExpense, submitExpense, decideExpense, markExpensePaid } from '@/lib/actions/finance';

interface Expense { id: string; amount: number; expense_date: string; status: string; source_domain: string; payee_name: string | null; category_id: string | null; vendor_id: string | null }
interface Category { id: string; name: string }
interface Vendor { id: string; name: string }
interface Bucket { count: number; amount: number | null }
interface Ageing { as_of: string; can_see_amounts: boolean; buckets: Record<string, Bucket>; total_count: number; total_outstanding: number | null }

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const inp: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
const colour = (s: string) => (s === 'rejected' ? 'var(--color-danger)' : s === 'approved' || s === 'paid' ? 'var(--color-success)' : 'var(--color-text-secondary)');
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

  return (
    <div className="flex flex-col gap-5">
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}

      {/* Ageing */}
      <section style={card}>
        <h2 style={h2}>Collections / AR ageing{ageing ? ` · as of ${ageing.as_of}` : ''}</h2>
        {!ageing ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No data.</p> : (
          <div className="flex flex-wrap gap-4 text-sm" style={{ color: 'var(--color-text)' }}>
            {BUCKETS.map(([k, label]) => (
              <div key={k}>
                <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{label} days</div>
                <div><b>{ageing.buckets[k]?.count ?? 0}</b> {ageing.can_see_amounts ? `· ${formatINR(ageing.buckets[k]?.amount ?? 0)}` : '· ₹—'}</div>
              </div>
            ))}
            <div style={{ marginLeft: 'auto' }}>
              <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>total outstanding</div>
              <div><b>{ageing.total_count}</b> {ageing.can_see_amounts ? `· ${formatINR(ageing.total_outstanding ?? 0)}` : '· ₹— (gated)'}</div>
            </div>
          </div>
        )}
      </section>

      {/* New expense */}
      {canManage && (
        <section style={card}>
          <h2 style={h2}>New expense</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" style={{ ...inp, width: 120 }} aria-label="Amount" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inp} aria-label="Expense date" />
            <select value={domain} onChange={(e) => setDomain(e.target.value as typeof domain)} style={inp} aria-label="Source domain">
              <option value="core">core</option><option value="hall">hall</option><option value="stays">stays</option><option value="catering">catering</option>
            </select>
            <select value={catId} onChange={(e) => setCatId(e.target.value)} style={inp} aria-label="Category">
              <option value="">category…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={inp} aria-label="Vendor">
              <option value="">vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Payee (if no vendor)" style={inp} aria-label="Payee" />
            <Button onClick={() => run(() => recordExpense({ amount: Number(amount), expenseDate: date, sourceDomain: domain, categoryId: catId || undefined, vendorId: vendorId || undefined, payeeName: payee || undefined }), () => { setAmount(''); setDate(''); setPayee(''); })} disabled={busy || !amount || !date}>Record draft</Button>
          </div>
        </section>
      )}

      {/* Expenses list */}
      <section style={card}>
        <h2 style={h2}>Expenses</h2>
        {expenses.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No expenses.</p> : (
          <ul className="flex flex-col">
            {expenses.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span><b>{formatINR(e.amount)}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· {e.expense_date} · {e.source_domain} · {e.payee_name ?? '—'}</span> · <b style={{ color: colour(e.status) }}>{e.status}</b></span>
                <span className="flex items-center gap-2">
                  {canManage && e.status === 'draft' && <Button onClick={() => run(() => submitExpense({ expenseId: e.id }))} disabled={busy}>Submit</Button>}
                  {canDecide && e.status === 'pending' && (
                    <>
                      <Button onClick={() => run(() => decideExpense({ expenseId: e.id, decision: 'approve' }))} disabled={busy}>Approve</Button>
                      <button onClick={() => run(() => decideExpense({ expenseId: e.id, decision: 'reject' }))} className="text-xs" style={{ color: 'var(--color-danger)' }} disabled={busy}>reject</button>
                    </>
                  )}
                  {canManage && e.status === 'approved' && <Button variant="secondary" onClick={() => run(() => markExpensePaid({ expenseId: e.id }))} disabled={busy}>Mark paid</Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
