'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { upsertMessageTemplate, setTemplatePurpose } from '@/lib/actions/crm';

interface Template { id: string; name: string; function_area: string; channel: string; body: string; active: boolean; purpose: string | null }
const PURPOSES = ['', 'review_request', 'anniversary', 'birthday', 'other'] as const;

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const inp: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };

export function TemplateManager({ templates, functionAreas, canManage }: { templates: Template[]; functionAreas: string[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState(''); const [area, setArea] = useState(functionAreas[0] ?? ''); const [body, setBody] = useState('Hi {{guest}}, thank you!');

  async function save() {
    setBusy(true); setMsg(null);
    const res = await upsertMessageTemplate({ name, functionArea: area, body });
    setBusy(false);
    if (res.ok) { setName(''); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }

  async function changePurpose(templateId: string, value: string) {
    setBusy(true); setMsg(null);
    const res = await setTemplatePurpose({ templateId, purpose: (value || null) as 'review_request' | 'anniversary' | 'birthday' | 'other' | null });
    setBusy(false);
    if (res.ok) router.refresh(); else setMsg(`${res.error}: ${res.message}`);
  }

  return (
    <div className="flex flex-col gap-5">
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}
      {canManage && (
        <section style={card}>
          <h2 style={h2}>New template</h2>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" style={inp} aria-label="Template name" />
              {functionAreas.length > 0 ? (
                <select value={area} onChange={(e) => setArea(e.target.value)} style={inp} aria-label="Function area">
                  {functionAreas.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              ) : (
                <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="function_area (e.g. hall_catering)" style={inp} aria-label="Function area" />
              )}
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body with {{placeholders}}" style={{ ...inp, minHeight: 72 }} aria-label="Body" />
            <div><Button onClick={save} disabled={busy || !name || !area || !body}>Save template</Button></div>
          </div>
        </section>
      )}
      <section style={card}>
        <h2 style={h2}>Templates</h2>
        {templates.length === 0 ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No templates yet.</p> : (
          <ul className="flex flex-col">
            {templates.map((t) => (
              <li key={t.id} className="py-2 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><b>{t.name}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· {t.function_area} · {t.channel}</span></span>
                  {canManage && (
                    <label className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
                      rule purpose:
                      <select
                        defaultValue={t.purpose ?? ''}
                        onChange={(e) => changePurpose(t.id, e.target.value)}
                        style={inp} aria-label="Rule purpose" disabled={busy}
                      >
                        {PURPOSES.map((p) => <option key={p} value={p}>{p || '— none —'}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>{t.body}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
