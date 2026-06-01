'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { defineAction } from './wrapper';
import { ActionError, type ActionResult, err, ok } from './types';

/**
 * M1a — staff scheduling actions. Every write goes through the wrapper → a single
 * atomic RPC (rpcOwnsCompletion); the RPC self-authorizes on auth.uid()
 * (membership + roster.manage). org_id is resolved from the session, never input.
 */
async function rpcWrite<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501' || /forbidden/.test(error.message)) throw new ActionError('forbidden', 'Not permitted.');
    if (error.code === 'P0002') throw new ActionError('not_found', error.message);
    if (error.code === '23P01' || /double_booked/.test(error.message)) throw new ActionError('conflict', 'Staff already has an overlapping shift.');
    if (error.code === '23505' || /already_assigned/.test(error.message)) throw new ActionError('conflict', 'Staff already assigned to this shift.');
    if (error.code === '22023') throw new ActionError('conflict', error.message);
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}
const auth = (ctx: { orgId?: string | null }) => !!ctx.orgId;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const TIME = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

export const upsertShiftTemplate = defineAction({
  name: 'workforce.shift_template_upsert',
  input: z.object({
    name: z.string().min(1).max(120), role: z.string().max(80).optional(),
    startTime: TIME, endTime: TIME, location: z.string().max(160).optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
    active: z.boolean().default(true), templateId: z.string().uuid().optional(),
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('upsert_shift_template', {
    p_org: ctx.orgId, p_name: i.name, p_role: i.role ?? null, p_start_time: i.startTime, p_end_time: i.endTime,
    p_location: i.location ?? null, p_days_of_week: i.daysOfWeek, p_active: i.active, p_template_id: i.templateId ?? null, p_actor_id: ctx.userId,
  }),
});

export const createRoster = defineAction({
  name: 'workforce.roster_upsert',
  input: z.object({ name: z.string().min(1).max(120), periodStart: DATE, periodEnd: DATE, rosterId: z.string().uuid().optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('create_roster', { p_org: ctx.orgId, p_name: i.name, p_period_start: i.periodStart, p_period_end: i.periodEnd, p_roster_id: i.rosterId ?? null, p_actor_id: ctx.userId }),
});

export const generateShiftsFromTemplate = defineAction({
  name: 'workforce.shifts_generate',
  input: z.object({ rosterId: z.string().uuid(), templateId: z.string().uuid() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('generate_shifts_from_template', { p_org: ctx.orgId, p_roster_id: i.rosterId, p_template_id: i.templateId, p_actor_id: ctx.userId }),
});

export const upsertShift = defineAction({
  name: 'workforce.shift_upsert',
  input: z.object({
    rosterId: z.string().uuid(), shiftDate: DATE, startTime: TIME, endTime: TIME,
    role: z.string().max(80).optional(), location: z.string().max(160).optional(), shiftId: z.string().uuid().optional(),
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('upsert_shift', {
    p_org: ctx.orgId, p_roster_id: i.rosterId, p_shift_date: i.shiftDate, p_start_time: i.startTime, p_end_time: i.endTime,
    p_role: i.role ?? null, p_location: i.location ?? null, p_shift_id: i.shiftId ?? null, p_actor_id: ctx.userId,
  }),
});

export const publishRoster = defineAction({
  name: 'workforce.roster_publish',
  input: z.object({ rosterId: z.string().uuid() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('publish_roster', { p_org: ctx.orgId, p_roster_id: i.rosterId, p_actor_id: ctx.userId }),
});

export const assignShift = defineAction({
  name: 'workforce.shift_assign',
  input: z.object({ shiftId: z.string().uuid(), staffId: z.string().uuid() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('assign_shift', { p_org: ctx.orgId, p_shift_id: i.shiftId, p_staff_id: i.staffId, p_actor_id: ctx.userId }),
});

export const setShiftAssignmentStatus = defineAction({
  name: 'workforce.shift_status',
  input: z.object({ assignmentId: z.string().uuid(), status: z.enum(['scheduled', 'acknowledged', 'completed', 'cancelled', 'no_show']) }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_shift_assignment_status', { p_org: ctx.orgId, p_assignment_id: i.assignmentId, p_status: i.status, p_actor_id: ctx.userId }),
});

/** Read the roster board for a date range. RPC gates draft visibility by capability. */
export async function getRosterBoard(from: string, to: string): Promise<ActionResult<unknown>> {
  const ctx = await getRoleContext();
  if (!ctx?.orgId) return err('unauthenticated', 'Sign in with an org.');
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc('roster_board', { p_org: ctx.orgId, p_from: from, p_to: to });
  if (error) return err('rpc_error', error.message);
  return ok(data);
}
