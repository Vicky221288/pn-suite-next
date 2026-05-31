'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PhotoUpload } from '@/components/photo-upload';
import { ViewPhotoLink } from '@/components/view-photo-link';
import { createEventChecklist, completeChecklistItem } from '@/lib/actions/hall';

interface Item { id: string; label: string; requires_photo: boolean; done: boolean; photo_ref: string | null }
interface Checklist { id: string; title: string; event_checklist_items: Item[] }

/** Create checklists + complete items (photo-required items demand a real uploaded photo_ref). */
export function ChecklistPanel({ eventId, orgId, checklists }: { eventId: string; orgId: string; checklists: Checklist[] }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [itemsText, setItemsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }
  // "Stage decor*" → requires photo (trailing *); one item per line
  function create() {
    const items = itemsText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.endsWith('*') ? { label: l.slice(0, -1).trim(), requiresPhoto: true } : { label: l, requiresPhoto: false });
    if (!title || items.length === 0) { setMsg('Title + at least one item required.'); return; }
    run(() => createEventChecklist({ eventId, title, items })).then(() => { setTitle(''); setItemsText(''); });
  }
  const i: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
  return (
    <div className="flex flex-col gap-3">
      {checklists.map((c) => (
        <div key={c.id}>
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{c.title}</div>
          <ul className="flex flex-col">
            {c.event_checklist_items.sort((a, b) => a.label.localeCompare(b.label)).map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-3 py-1 text-sm" style={{ color: 'var(--color-text)' }}>
                <span>{it.done ? '✓' : '○'} {it.label} {it.requires_photo && <span title="photo required" style={{ color: 'var(--color-brand)' }}>📷</span>}{it.done && it.photo_ref ? <> · <ViewPhotoLink path={it.photo_ref} /></> : null}</span>
                {!it.done && (it.requires_photo
                  ? <PhotoUpload orgId={orgId} prefix={`checklist/${it.id}`} onUploaded={(path) => run(() => completeChecklistItem({ itemId: it.id, photoRef: path }))} disabled={busy} />
                  : <Button onClick={() => run(() => completeChecklistItem({ itemId: it.id }))} disabled={busy}>Complete</Button>)}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="flex flex-col gap-2" style={{ borderTop: '1px solid var(--color-divider)', paddingTop: 8 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New checklist title" style={i} aria-label="Checklist title" />
        <textarea value={itemsText} onChange={(e) => setItemsText(e.target.value)} rows={3} placeholder={'One item per line. Add * for photo-required:\nStage decor*\nMic check'} style={i} aria-label="Checklist items" />
        <div><Button onClick={create} disabled={busy}>Create checklist</Button></div>
      </div>
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
    </div>
  );
}
