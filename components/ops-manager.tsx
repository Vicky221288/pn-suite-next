'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert, ClipboardList, Siren } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Table, THead, TH, TR, TD } from '@/components/ui/table';
import { createTask, assignTask, setTaskStatus, reportIncident, setIncidentStatus, upsertChecklistTemplate, generateChecklistFromTemplate } from '@/lib/actions/ops';

interface Task { id: string; title: string; priority: string; due_date: string | null; status: string; assigned_staff_id: string | null; entity_type: string | null; entity_id: string | null }
interface Incident { id: string; title: string; severity: string; status: string; assigned_staff_id: string | null; resolution: string | null }
interface Template { id: string; name: string; kind: string; active: boolean }
interface Staff { id: string; name: string }
interface Event { id: string; event_date: string; event_type: string | null }

const field: React.CSSProperties = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 'var(--input-radius)', color: 'var(--input-text)', padding: '8px 12px', fontSize: 'var(--text-sm)', minHeight: 'var(--tap-min)' };
const term = (s: string) => s === 'done' || s === 'resolved' || s === 'cancelled';
const rankTone = (s: string) => (s === 'urgent' || s === 'critical' ? 'danger' : s === 'high' ? 'warning' : 'neutral') as 'danger' | 'warning' | 'neutral';
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
    <div className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
      {msg && (
        <div className="flex items-center" style={{ gap: 'var(--space-2)', background: 'var(--badge-danger-bg)', color: 'var(--badge-danger-text)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <TriangleAlert size={15} aria-hidden /> {msg}
        </div>
      )}

      {/* Tasks */}
      {canManage && (
        <CreatePanel label="New task" title="Create a task">
          <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
            <input value={tTitle} onChange={(e) => setTTitle(e.target.value)} placeholder="Task title" style={{ ...field, flex: '1 1 200px' }} aria-label="Task title" />
            <select value={tPri} onChange={(e) => setTPri(e.target.value as typeof tPri)} style={field} aria-label="Priority">
              <option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="urgent">urgent</option>
            </select>
            <input type="date" value={tDue} onChange={(e) => setTDue(e.target.value)} style={field} aria-label="Due date" />
            <select value={tStaff} onChange={(e) => setTStaff(e.target.value)} style={field} aria-label="Assignee">
              <option value="">unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Button onClick={() => run(() => createTask({ title: tTitle, priority: tPri, dueDate: tDue || undefined, assignedStaffId: tStaff || undefined }), () => { setTTitle(''); setTDue(''); setTStaff(''); })} disabled={busy || !tTitle}>Add task</Button>
          </div>
        </CreatePanel>
      )}

      <Card padded={false} title="Tasks" subtitle={`${tasks.length} total`}>
        {tasks.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No tasks" message="Tasks created here move open → in progress → done, with priority, due date, assignee, and an optional link to an event or room." />
        ) : (
          <Table>
            <THead>
              <TR><TH>Task</TH><TH>Priority</TH><TH align="right">Due</TH><TH>Assignee</TH><TH align="right">Status</TH>{canManage && <TH align="right">Actions</TH>}</TR>
            </THead>
            <tbody>
              {tasks.map((t) => (
                <TR key={t.id}>
                  <TD>
                    <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{t.title}</span>
                    {t.entity_type && <span style={{ marginLeft: 'var(--space-2)' }}><Badge tone="neutral">{t.entity_type.replace(/_/g, ' ')}</Badge></span>}
                  </TD>
                  <TD><Badge tone={rankTone(t.priority)}>{t.priority}</Badge></TD>
                  <TD align="right" mono><span style={{ color: 'var(--color-text-tertiary)' }}>{t.due_date ?? '—'}</span></TD>
                  <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{nameOf(t.assigned_staff_id)}</span></TD>
                  <TD align="right"><StatusBadge status={t.status} /></TD>
                  {canManage && (
                    <TD align="right">
                      {!term(t.status) && (
                        <span className="inline-flex flex-wrap items-center justify-end" style={{ gap: 'var(--space-2)' }}>
                          {nextTask(t.status) && <Button variant="secondary" onClick={() => run(() => setTaskStatus({ taskId: t.id, status: nextTask(t.status)! }))} disabled={busy}>→ {nextTask(t.status)!.replace(/_/g, ' ')}</Button>}
                          <select onChange={(e) => e.target.value && run(() => assignTask({ taskId: t.id, staffId: e.target.value }))} style={field} aria-label="Reassign" defaultValue="">
                            <option value="">assign…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                          <Button variant="ghost" onClick={() => run(() => setTaskStatus({ taskId: t.id, status: 'cancelled' }))} disabled={busy} style={{ color: 'var(--color-danger)' }}>Cancel</Button>
                        </span>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Incidents — reporting open to members */}
      <CreatePanel label="Report incident" title="Report an incident">
        <div className="flex flex-wrap items-center" style={{ gap: 'var(--space-2)' }}>
          <input value={iTitle} onChange={(e) => setITitle(e.target.value)} placeholder="Incident title" style={{ ...field, flex: '1 1 200px' }} aria-label="Incident title" />
          <select value={iSev} onChange={(e) => setISev(e.target.value as typeof iSev)} style={field} aria-label="Severity">
            <option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="critical">critical</option>
          </select>
          <Button onClick={() => run(() => reportIncident({ title: iTitle, severity: iSev }), () => setITitle(''))} disabled={busy || !iTitle}>Report</Button>
        </div>
      </CreatePanel>

      <Card padded={false} title="Incidents" subtitle={`${incidents.length} total`}>
        {incidents.length === 0 ? (
          <EmptyState icon={Siren} title="No incidents" message="Anyone can report an incident; managers move it report → in progress → resolved. Severity flags how urgent it is." />
        ) : (
          <Table>
            <THead>
              <TR><TH>Incident</TH><TH>Severity</TH><TH>Assignee</TH><TH align="right">Status</TH>{canManage && <TH align="right">Actions</TH>}</TR>
            </THead>
            <tbody>
              {incidents.map((it) => (
                <TR key={it.id}>
                  <TD><span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{it.title}</span></TD>
                  <TD><Badge tone={rankTone(it.severity)}>{it.severity}</Badge></TD>
                  <TD><span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{nameOf(it.assigned_staff_id)}</span></TD>
                  <TD align="right"><StatusBadge status={it.status} /></TD>
                  {canManage && (
                    <TD align="right">
                      {!term(it.status) && (
                        <span className="inline-flex flex-wrap items-center justify-end" style={{ gap: 'var(--space-2)' }}>
                          {nextInc(it.status) && <Button variant="secondary" onClick={() => run(() => setIncidentStatus({ incidentId: it.id, status: nextInc(it.status)!, resolution: nextInc(it.status) === 'resolved' ? 'Resolved' : undefined }))} disabled={busy}>→ {nextInc(it.status)!.replace(/_/g, ' ')}</Button>}
                          <Button variant="ghost" onClick={() => run(() => setIncidentStatus({ incidentId: it.id, status: 'cancelled' }))} disabled={busy} style={{ color: 'var(--color-danger)' }}>Cancel</Button>
                        </span>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Checklist templates */}
      {canManage && (
        <>
          <CreatePanel label="New template" title="Checklist template → generate execution checklist">
            <div className="flex flex-wrap items-start" style={{ gap: 'var(--space-2)' }}>
              <input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Template name" style={field} aria-label="Template name" />
              <textarea value={tplItems} onChange={(e) => setTplItems(e.target.value)} placeholder="One item per line; suffix :photo to require a photo" style={{ ...field, flex: '1 1 280px', minHeight: 72 }} aria-label="Template items" />
              <Button onClick={() => run(() => upsertChecklistTemplate({ name: tplName, items: parseItems(tplItems) }), () => setTplName(''))} disabled={busy || !tplName}>Save template</Button>
            </div>
          </CreatePanel>

          {templates.length > 0 && (
            <Card padded={false} title="Templates" subtitle={`${templates.length} · generate into an event`}>
              <ul className="flex flex-col">
                {templates.map((tp) => (
                  <li key={tp.id} className="flex flex-wrap items-center justify-between" style={{ gap: 'var(--space-3)', padding: 'var(--space-3) var(--card-pad)', borderBottom: '1px solid var(--color-divider)' }}>
                    <div className="min-w-0 flex items-center" style={{ gap: 'var(--space-2)' }}>
                      <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{tp.name}</span>
                      <Badge tone="neutral">{tp.kind}</Badge>
                    </div>
                    <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                      <select value={genTpl[tp.id] ?? ''} onChange={(e) => setGenTpl((p) => ({ ...p, [tp.id]: e.target.value }))} style={field} aria-label="Target event">
                        <option value="">target event…</option>{events.map((ev) => <option key={ev.id} value={ev.id}>{ev.event_date} {ev.event_type ?? ''}</option>)}
                      </select>
                      <Button variant="secondary" onClick={() => run(() => generateChecklistFromTemplate({ templateId: tp.id, eventId: genTpl[tp.id]! }))} disabled={busy || !genTpl[tp.id]}>Generate</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
