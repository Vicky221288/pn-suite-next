'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { defineAction } from './wrapper';
import { ActionError } from './types';

/**
 * M2 — ops execution: tasks, incidents, and the checklist-TEMPLATE engine. Every
 * write: wrapper → single atomic RPC (rpcOwnsCompletion); the RPC self-authorizes
 * on auth.uid() (membership + capability). org_id from the session, never input.
 * The template engine generates INTO the existing W2 execution tables; completion
 * + photo-proof stay on the unchanged W2 complete_checklist_item (KL-3).
 */
async function rpcWrite<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501' || /forbidden/.test(error.message)) throw new ActionError('forbidden', 'Not permitted.');
    if (error.code === 'P0002') throw new ActionError('not_found', error.message);
    if (error.code === '22023') throw new ActionError('conflict', error.message);
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}
const auth = (ctx: { orgId?: string | null }) => !!ctx.orgId;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ENTITY = z.enum(['event', 'room', 'room_stay', 'booking']);

// ── A) tasks ─────────────────────────────────────────────────────────────────
export const createTask = defineAction({
  name: 'ops.task_create',
  input: z.object({
    title: z.string().min(1).max(200), description: z.string().max(2000).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
    dueDate: DATE.optional(), assignedStaffId: z.string().uuid().optional(),
    entityType: ENTITY.optional(), entityId: z.string().uuid().optional(),
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('create_task', {
    p_org: ctx.orgId, p_title: i.title, p_description: i.description ?? null, p_priority: i.priority, p_due_date: i.dueDate ?? null,
    p_assigned_staff_id: i.assignedStaffId ?? null, p_entity_type: i.entityType ?? null, p_entity_id: i.entityId ?? null, p_actor_id: ctx.userId,
  }),
});

export const assignTask = defineAction({
  name: 'ops.task_assign',
  input: z.object({ taskId: z.string().uuid(), staffId: z.string().uuid() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('assign_task', { p_org: ctx.orgId, p_task_id: i.taskId, p_staff_id: i.staffId, p_actor_id: ctx.userId }),
});

export const setTaskStatus = defineAction({
  name: 'ops.task_status',
  input: z.object({ taskId: z.string().uuid(), status: z.enum(['open', 'in_progress', 'done', 'cancelled']) }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_task_status', { p_org: ctx.orgId, p_task_id: i.taskId, p_status: i.status, p_actor_id: ctx.userId }),
});

// ── B) incidents ───────────────────────────────────────────────────────────--
export const reportIncident = defineAction({
  name: 'ops.incident_report',
  input: z.object({
    title: z.string().min(1).max(200), description: z.string().max(2000).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    entityType: ENTITY.optional(), entityId: z.string().uuid().optional(),
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('report_incident', {
    p_org: ctx.orgId, p_title: i.title, p_description: i.description ?? null, p_severity: i.severity,
    p_entity_type: i.entityType ?? null, p_entity_id: i.entityId ?? null, p_actor_id: ctx.userId,
  }),
});

export const setIncidentStatus = defineAction({
  name: 'ops.incident_status',
  input: z.object({
    incidentId: z.string().uuid(), status: z.enum(['reported', 'in_progress', 'resolved', 'cancelled']),
    assignedStaffId: z.string().uuid().optional(), resolution: z.string().max(2000).optional(),
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_incident_status', {
    p_org: ctx.orgId, p_incident_id: i.incidentId, p_status: i.status, p_assigned_staff_id: i.assignedStaffId ?? null, p_resolution: i.resolution ?? null, p_actor_id: ctx.userId,
  }),
});

// ── C) checklist-template engine (generates INTO the W2 execution tables) ────--
export const upsertChecklistTemplate = defineAction({
  name: 'ops.checklist_template_upsert',
  input: z.object({
    name: z.string().min(1).max(120), kind: z.enum(['event', 'daily', 'room']).default('event'),
    items: z.array(z.object({ label: z.string().min(1).max(200), requires_photo: z.boolean().default(false) })).default([]),
    templateId: z.string().uuid().optional(),
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('upsert_checklist_template', { p_org: ctx.orgId, p_name: i.name, p_kind: i.kind, p_items: i.items, p_template_id: i.templateId ?? null, p_actor_id: ctx.userId }),
});

export const generateChecklistFromTemplate = defineAction({
  name: 'ops.checklist_generate',
  input: z.object({ templateId: z.string().uuid(), eventId: z.string().uuid(), title: z.string().max(200).optional(), assignedStaffId: z.string().uuid().optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('generate_checklist_from_template', { p_org: ctx.orgId, p_template_id: i.templateId, p_event_id: i.eventId, p_title: i.title ?? null, p_assigned_staff_id: i.assignedStaffId ?? null, p_actor_id: ctx.userId }),
});
