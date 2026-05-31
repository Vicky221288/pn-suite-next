'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Upload a proof photo to the private `proof-photos` bucket, then hand the object
 * path back via onUploaded — that path is the photo_ref passed to the complete RPC.
 * Path is org-keyed (`{orgId}/{prefix}/{file}`) so Storage RLS scopes it per tenant.
 * Browser→Storage upload is RLS-gated; the photo_ref DB write still goes via the action.
 */
export function PhotoUpload({ orgId, prefix, label = 'Upload photo & complete', onUploaded, disabled }: {
  orgId: string; prefix: string; label?: string; onUploaded: (path: string) => void; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr(null);
    const supabase = createClient();
    const safe = file.name.replace(/[^\w.\-]/g, '_');
    const path = `${orgId}/${prefix}/${Date.now()}-${safe}`;
    const { error } = await supabase.storage.from('proof-photos').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onUploaded(path);
  }
  return (
    <span className="inline-flex items-center gap-1">
      <label className="text-xs" style={{ color: 'var(--color-brand)', cursor: 'pointer' }}>
        {busy ? 'Uploading…' : `📷 ${label}`}
        <input type="file" accept="image/*" onChange={onFile} disabled={busy || disabled} style={{ display: 'none' }} />
      </label>
      {err && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{err}</span>}
    </span>
  );
}
