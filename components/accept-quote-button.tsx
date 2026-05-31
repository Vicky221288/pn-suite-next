'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { acceptQuote } from '@/lib/actions/catering-beo';

/** Accept a quote — the trigger that lets a BEO be generated from it. */
export function AcceptQuoteButton({ quoteId, status }: { quoteId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (status === 'accepted') {
    return <Link className="text-sm" href="/catering/beo" style={{ color: 'var(--color-brand)' }}>Accepted → generate a BEO →</Link>;
  }
  if (status !== 'draft' && status !== 'sent') return null;

  async function accept() {
    setBusy(true); setMsg(null);
    const res = await acceptQuote({ quoteId });
    setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }
  return (
    <div className="flex items-center gap-2">
      <Button onClick={accept} disabled={busy}>{busy ? '…' : 'Accept quote'}</Button>
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </div>
  );
}
