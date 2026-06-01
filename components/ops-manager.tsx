'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createTask, assignTask, setTaskStatus, reportIncident, setIncidentStatus, upsertChecklistTemplate, generateChecklistFromTemplate } from '@/lib/actions/ops';

interface Task { id: string; title: string; priority: string; due_date: string | null; status: string; assigned_staff_id: string | null; entity_type: string | null; entity_id: string | null }
interface Incident { id: string; title: string; severity: string; status: string; assigned_staff_id: string | null; resolution: string | null }
interface Template { id: string; name: string; kind: string; active: boolean }
interface Staff { id: string; name: string }
interface Event { id: string; event_date: string; event_type: string | null }

const card: React.CSSProperties = { background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 'var(--card-radius)', boxShadow: 'var(--card-shadow)', padding: 'var(--card-pad)' };
const h2 = { color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: '0.75rem' } as React.CSSProperties;
const inp: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '6px 10px', fontSize: 'var(--text-sm)' };
const term = (s: string) => s === 'done' || s === 'resolved' || s === 'cancelled';
const colour = (s: string) => (s === 'cancelled' ? 'var(--color-danger)' : s === 'done' || s === 'resolved' ? 'var(--color-success)' : 'var(--color-text-secondary)');
const nextTask = (s: string): 'in_progress' | 'done' | null => (s === 'open' ? 'in_progress' : s === 'in_progress' ? 'done' : null);
const nextInc = (s: string): 'in_progress' | 'resolved' | null => (s === 'reported' ? 'in_progress' : s === 'in_progress' ? 'resolved' : null);

export function OpsManager({ tasks, incidents, templates, staff, events, canManage }: {
  tasks: Task[]; incidents: Incident[]; templates: Template[]; staff: Staff[]; events: Event[]; canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.name ?? '—';

  async function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, reset?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn(); setBusy(false);
    if (res.ok) { reset?.(); router.refresh(); } else setMsg(`${res.error}: ${res.message}`);
  }

  const [tTitle, setTTitle] = useState(''); const [tPri, setTPri] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium'); const [tDue, setTDue] = useState(''); const [tStaff, setTStaff] = useState('');
  const [iTitle, setITitle] = useState(''); const [iSev, setISev] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [tplName, setTplName] = useState(''); const [tplItems, setTplItems] = useState('Setup decor:photo\nMic check');
  const [genTpl, setGenTpl] = useState<Record<string, string>>({});

  function parseItems(text: string) {
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const parts = l.split(':'); return { label: (parts[0] ?? '').trim(), requires_photo: (parts[1] ?? '').trim().toLowerCase() === 'photo' };
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {msg && <span className="text-xs" style={{ color: 'var(--color-danger)' }}>{msg}</span>}

      {/* Tasks */}
      <section style={card}>
        <h2 style={h2}>Tasks</h2>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <input value={tTitle} onChange={(e) => setTTitle(e.target.value)} placeholder="Task title" style={inp} aria-label="Task title" />
            <select value={tPri} onChange={(e) => setTPri(e.target.value as typeof tPri)} style={inp} aria-label="Priority">
              <option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="urgent">urgent</option>
            </select>
            <input type="date" value={tDue} onChange={(e) => setTDue(e.target.value)} style={inp} aria-label="Due date" />
            <select value={tStaff} onChange={(e) => setTStaff(e.target.value)} style={inp} aria-label="Assignee">
              <option value="">unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Button onClick={() => run(() => createTask({ title: tTitle, priority: tPri, dueDate: tDue || undefined, assignedStaffId: tStaff || undefined }), () => { setTTitle(''); setTDue(''); setTStaff(''); })} disabled={busy || !tTitle}>Add task</Button>
          </div>
        )}
        <ul className="flex flex-col mt-3">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
              <span><b>{t.title}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· {t.priority}{t.due_date ? ` · due ${t.due_date}` : ''} · {nameOf(t.assigned_staff_id)}{t.entity_type ? ` · ${t.entity_type}` : ''}</span> · <b style={{ color: colour(t.status) }}>{t.status}</b></span>
              {canManage && !term(t.status) && (
                <span className="flex items-center gap-2">
                  {nextTask(t.status) && <Button onClick={() => run(() => setTaskStatus({ taskId: t.id, status: nextTask(t.status)! }))} disabled={busy}>→ {nextTask(t.status)}</Button>}
                  <button onClick={() => run(() => setTaskStatus({ taskId: t.id, status: 'cancelled' }))} className="text-xs" style={{ color: 'var(--color-danger)' }} disabled={busy}>cancel</button>
                  <select onChange={(e) => e.target.value && run(() => assignTask({ taskId: t.id, staffId: e.target.value }))} style={inp} aria-label="Reassign" defaultValue="">
                    <option value="">assign…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Incidents */}
      <section style={card}>
        <h2 style={h2}>Incidents</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input value={iTitle} onChange={(e) => setITitle(e.target.value)} placeholder="Incident title" style={inp} aria-label="Incident title" />
          <select value={iSev} onChange={(e) => setISev(e.target.value as typeof iSev)} style={inp} aria-label="Severity">
            <option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="critical">critical</option>
          </select>
          <Button onClick={() => run(() => reportIncident({ title: iTitle, severity: iSev }), () => setITitle(''))} disabled={busy || !iTitle}>Report</Button>
        </div>
        <ul className="flex flex-col mt-3">
          {incidents.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
              <span><b>{it.title}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· {it.severity} · {nameOf(it.assigned_staff_id)}</span> · <b style={{ color: colour(it.status) }}>{it.status}</b></span>
              {canManage && !term(it.status) && (
                <span className="flex items-center gap-2">
                  {nextInc(it.status) && <Button onClick={() => run(() => setIncidentStatus({ incidentId: it.id, status: nextInc(it.status)!, resolution: nextInc(it.status) === 'resolved' ? 'Resolved' : undefined }))} disabled={busy}>→ {nextInc(it.status)}</Button>}
                  <button onClick={() => run(() => setIncidentStatus({ incidentId: it.id, status: 'cancelled' }))} className="text-xs" style={{ color: 'var(--color-danger)' }} disabled={busy}>cancel</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Checklist templates */}
      {canManage && (
        <section style={card}>
          <h2 style={h2}>Checklist templates → generate execution checklist</h2>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-start gap-2">
              <input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Template name" style={inp} aria-label="Template name" />
              <textarea value={tplItems} onChange={(e) => setTplItems(e.target.value)} placeholder="One item per line; suffix :photo to require a photo" style={{ ...inp, minWidth: 280, minHeight: 64 }} aria-label="Template items" />
              <Button onClick={() => run(() => upsertChecklistTemplate({ name: tplName, items: parseItems(tplItems) }), () => setTplName(''))} disabled={busy || !tplName}>Save template</Button>
            </div>
          </div>
          <ul className="flex flex-col mt-3">
            {templates.map((tp) => (
              <li key={tp.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" style={{ borderTop: '1px solid var(--color-divider)', color: 'var(--color-text)' }}>
                <span><b>{tp.name}</b> <span style={{ color: 'var(--color-text-tertiary)' }}>· {tp.kind}</span></span>
                <span className="flex items-center gap-2">
                  <select value={genTpl[tp.id] ?? ''} onChange={(e) => setGenTpl((p) => ({ ...p, [tp.id]: e.target.value }))} style={inp} aria-label="Target event">
                    <option value="">target event…</option>{events.map((ev) => <option key={ev.id} value={ev.id}>{ev.event_date} {ev.event_type ?? ''}</option>)}
                  </select>
                  <Button variant="secondary" onClick={() => run(() => generateChecklistFromTemplate({ templateId: tp.id, eventId: genTpl[tp.id] }))} disabled={busy || !genTpl[tp.id]}>Generate</Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
