'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Circle, Camera, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PhotoUpload } from '@/components/photo-upload';
import { ViewPhotoLink } from '@/components/view-photo-link';
import { createEventChecklist, completeChecklistItem } from '@/lib/actions/hall';

interface Item { id: string; label: string; requires_photo: boolean; done: boolean; photo_ref: string | null }
interface Checklist { id: string; title: string; event_checklist_items: Item[] }

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };

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

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
      {checklists.length === 0 ? (
        <EmptyState icon={Check} title="No checklists yet" message="Create an execution checklist below — append * to an item to require a photo before it can be completed." />
      ) : (
        checklists.map((c) => {
          const done = c.event_checklist_items.filter((it) => it.done).length;
          return (
            <div key={c.id} style={{ border: '1px solid var(--color-divider)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              <div className="flex items-center justify-between" style={{ gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-surface-sunken)', borderBottom: '1px solid var(--color-divider)' }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>{c.title}</span>
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{done}/{c.event_checklist_items.length}</span>
              </div>
              <ul className="flex flex-col">
                {c.event_checklist_items.slice().sort((a, b) => a.label.localeCompare(b.label)).map((it) => (
                  <li key={it.id} className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--color-divider)' }}>
                    <span className="min-w-0 flex items-center" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                      {it.done ? <Check size={15} style={{ color: 'var(--color-success)' }} aria-label="done" /> : <Circle size={15} style={{ color: 'var(--color-text-tertiary)' }} aria-label="pending" />}
                      {it.label}
                      {it.requires_photo && <Badge tone="warning"><Camera size={11} /> photo</Badge>}
                      {it.done && it.photo_ref && <ViewPhotoLink path={it.photo_ref} />}
                    </span>
                    {!it.done && (it.requires_photo
                      ? <PhotoUpload orgId={orgId} prefix={`checklist/${it.id}`} onUploaded={(path) => run(() => completeChecklistItem({ itemId: it.id, photoRef: path }))} disabled={busy} />
                      : <Button variant="secondary" onClick={() => run(() => completeChecklistItem({ itemId: it.id }))} disabled={busy}>Complete</Button>)}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}

      <div className="flex flex-col" style={{ gap: 'var(--space-2)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-divider)' }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New checklist title" style={field} aria-label="Checklist title" />
        <textarea value={itemsText} onChange={(e) => setItemsText(e.target.value)} rows={3} placeholder={'One item per line. Add * for photo-required:\nStage decor*\nMic check'} style={field} aria-label="Checklist items" />
        <div><Button onClick={create} disabled={busy}>Create checklist</Button></div>
      </div>

      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}
    </div>
  );
}
