'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { mergeGuests } from '@/lib/actions/guest';

/** Merge another guest INTO this keeper (fuses a wrongly-split same-person). */
export function MergeGuestButton({ keepId, mergeId, label }: { keepId: string; mergeId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true); setMsg(null);
    const res = await mergeGuests({ keepId, mergeId });
    setBusy(false);
    setMsg(res.ok ? 'Merged.' : `${res.error}: ${res.message}`);
    if (res.ok) router.refresh();
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="secondary" disabled={busy} onClick={run}>{busy ? 'Merging…' : `Merge "${label}" into this`}</Button>
      {msg && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{msg}</span>}
    </span>
  );
}
