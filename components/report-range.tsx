'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

/** Date-range picker → navigates with ?from&to (server page refetches the report). */
export function ReportRange({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>From</label>
      <input type="date" value={f} onChange={(e) => setF(e.target.value)} style={i} aria-label="From" />
      <label className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>To</label>
      <input type="date" value={t} onChange={(e) => setT(e.target.value)} style={i} aria-label="To" />
      <Button onClick={() => router.push(`/stays/reporting?from=${f}&to=${t}`)}>Apply</Button>
    </div>
  );
}
