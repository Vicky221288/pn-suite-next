'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createMenuItem } from '@/lib/actions/catering';

/** Minimal create — recipe lines are set via RPC/later sub-phases. */
export function NewMenuItemForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await createMenuItem({ name, category: category || undefined, sellingPrice: price, supplyType: 'catering_composite' });
    setBusy(false);
    if (res.ok) { setName(''); setCategory(''); setPrice(0); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }
  const input: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" required style={input} aria-label="Item name" />
      <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" style={input} aria-label="Category" />
      <input type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} placeholder="Selling price" style={{ ...input, width: 130 }} aria-label="Selling price" />
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add item'}</Button>
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </form>
  );
}
