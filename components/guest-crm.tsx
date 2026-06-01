'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/utils';
import { logInteraction, setSpecialDate, sendTemplateToGuest, createReviewRequest } from '@/lib/actions/crm';

interface Interaction { id: string; interaction_type: string; channel: string | null; note: string | null; occurred_at: string }
interface SpecialDate { id: string; date_type: string; the_date: string; label: string | null }
interface Template { id: string; name: string; function_area: string; channel: string; body: string }
interface Review { id: string; event_id: string | null; status: string; requested_at: string | null }
interface Ltv { can_see: boolean; ltv: number | null }

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const inp: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };

export function GuestCrm({ guestId, interactions, specialDates, templates, reviews, ltv, canManage }: {
  guestId: string; interactions: Interaction[]; specialDates: SpecialDate[]; templates: Template[]; reviews: Review[]; ltv: Ltv; canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, reset?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) { reset?.(); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }

  const [iType, setIType] = useState<'call' | 'visit' | 'message' | 'note' | 'email' | 'other'>('note');
  const [iNote, setINote] = useState('');
  const [sdType, setSdType] = useState<'anniversary' | 'birthday' | 'other'>('anniversary');
  const [sdDate, setSdDate] = useState(''); const [sdLabel, setSdLabel] = useState('');
  const [sendTpl, setSendTpl] = useState(templates[0]?.id ?? '');
  const [revTpl, setRevTpl] = useState(templates[0]?.id ?? '');

  return (
    <div className="flex flex-col gap-5">
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}

      {/* LTV — live */}
      <section style={card}>
        <h2 style={h2}>Lifetime value (computed live)</h2>
        {ltv.can_see
          ? <p className="text-lg" style={{ color: 'var(--color-text)' }}>{formatINR(ltv.ltv ?? 0)}</p>
          : <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Hidden — requires margin/revenue visibility.</p>}
      </section>

      {/* Interactions timeline */}
      <section style={card}>
        <h2 style={h2}>Interactions</h2>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={iType} onChange={(e) => setIType(e.target.value as typeof iType)} style={inp} aria-label="Interaction type">
              <option value="note">note</option><option value="call">call</option><option value="visit">visit</option><option value="message">message</option><option value="email">email</option><option value="other">other</option>
            </select>
            <input value={iNote} onChange={(e) => setINote(e.target.value)} placeholder="Note" style={{ ...inp, minWidth: 240 }} aria-label="Note" />
            <Button onClick={() => run(() => logInteraction({ guestId, type: iType, note: iNote || undefined }), () => setINote(''))} disabled={busy}>Log</Button>
          </div>
        )}
        <ul className="flex flex-col mt-3">
          {interactions.length === 0 ? <li className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No interactions yet.</li> :
            interactions.map((it) => (
              <li key={it.id} className="py-1.5 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <b>{it.interaction_type}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· {new Date(it.occurred_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}{it.note ? ` · ${it.note}` : ''}</span>
              </li>
            ))}
        </ul>
      </section>

      {/* Special dates */}
      <section style={card}>
        <h2 style={h2}>Special dates</h2>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={sdType} onChange={(e) => setSdType(e.target.value as typeof sdType)} style={inp} aria-label="Date type">
              <option value="anniversary">anniversary</option><option value="birthday">birthday</option><option value="other">other</option>
            </select>
            <input type="date" value={sdDate} onChange={(e) => setSdDate(e.target.value)} style={inp} aria-label="Date" />
            <input value={sdLabel} onChange={(e) => setSdLabel(e.target.value)} placeholder="Label (optional)" style={inp} aria-label="Label" />
            <Button onClick={() => run(() => setSpecialDate({ guestId, dateType: sdType, theDate: sdDate, label: sdLabel || undefined }), () => { setSdDate(''); setSdLabel(''); })} disabled={busy || !sdDate}>Add date</Button>
          </div>
        )}
        <ul className="flex flex-col mt-3">
          {specialDates.map((d) => (
            <li key={d.id} className="py-1 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>{d.date_type} · {d.the_date}{d.label ? ` · ${d.label}` : ''}</li>
          ))}
        </ul>
      </section>

      {/* Send + review (B3 only) */}
      {canManage && (
        <section style={card}>
          <h2 style={h2}>Outreach (via messaging provider — quiet-hours aware)</h2>
          {templates.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No templates yet — create one under <a href="/crm" style={{ color: 'var(--color-brand)' }}>CRM templates</a>.</p> : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <select value={sendTpl} onChange={(e) => setSendTpl(e.target.value)} style={inp} aria-label="Template to send">
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <Button onClick={() => run(() => sendTemplateToGuest({ guestId, templateId: sendTpl, payload: {} }))} disabled={busy || !sendTpl}>Send now</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={revTpl} onChange={(e) => setRevTpl(e.target.value)} style={inp} aria-label="Review template">
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <Button variant="secondary" onClick={() => run(() => createReviewRequest({ guestId, templateId: revTpl }))} disabled={busy || !revTpl}>Request review</Button>
              </div>
            </div>
          )}
          {reviews.length > 0 && (
            <ul className="flex flex-col mt-3">
              {reviews.map((r) => (
                <li key={r.id} className="py-1 text-xs" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text-secondary)' }}>
                  review request · <b style={{ color: r.status === 'sent' ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>{r.status}</b>{r.requested_at ? ` · ${new Date(r.requested_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
