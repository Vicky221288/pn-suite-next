'use client';
import { useState } from 'react';
import { getProofPhotoUrl } from '@/lib/actions/storage';

/** Open a proof photo via a short-lived signed URL (private bucket). */
export function ViewPhotoLink({ path }: { path: string }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    const res = await getProofPhotoUrl(path);
    setBusy(false);
    if (res.ok && typeof window !== 'undefined') window.open(res.data as string, '_blank', 'noopener');
  }
  return <button onClick={open} disabled={busy} className="text-xs" style={{ color: 'var(--color-brand)' }}>{busy ? '…' : 'view photo'}</button>;
}
