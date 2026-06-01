'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { defineAction } from './wrapper';
import { ActionError } from './types';

/**
 * M1b — attendance + leave + HR + the GENERIC tiered-approval primitive. Every
 * write: wrapper → single atomic RPC (rpcOwnsCompletion); the RPC self-authorizes
 * on auth.uid() (membership + capability). org_id from the session, never input.
 * record_attendance receives ONLY the device-evaluated boolean — never coordinates.
 */
async function rpcWrite<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501' || /forbidden/.test(error.message)) throw new ActionError('forbidden', 'Not permitted.');
    if (error.code === 'P0002') throw new ActionError('not_found', error.message);
    if (error.code === '23505' || /already_decided/.test(error.message)) throw new ActionError('conflict', 'Already decided by this approver.');
    if (error.code === '22023') throw new ActionError('conflict', error.message);
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}
const auth = (ctx: { orgId?: string | null }) => !!ctx.orgId;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const setHrFields = defineAction({
  name: 'workforce.hr_fields_set',
  input: z.object({
    staffId: z.string().uuid(),
    employeeCode: z.string().max(40).optional(),
    dateOfJoining: DATE.optional(),
    designation: z.string().max(120).optional(),
    employmentType: z.enum(['full_time', 'part_time', 'contract', 'temporary']).optional(),
    email: z.string().email().max(200).optional(),
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_hr_fields', {
    p_org: ctx.orgId, p_staff_id: i.staffId, p_employee_code: i.employeeCode ?? null, p_date_of_joining: i.dateOfJoining ?? null,
    p_designation: i.designation ?? null, p_employment_type: i.employmentType ?? null, p_email: i.email ?? null, p_actor_id: ctx.userId,
  }),
});

export const setGeofence = defineAction({
  name: 'workforce.geofence_set',
  input: z.object({ centerLat: z.number().min(-90).max(90), centerLng: z.number().min(-180).max(180), radiusM: z.number().positive() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_geofence', { p_org: ctx.orgId, p_center_lat: i.centerLat, p_center_lng: i.centerLng, p_radius_m: i.radiusM, p_actor_id: ctx.userId }),
});

/** The device pre-evaluates the geofence and sends ONLY the boolean — no coordinates. */
export const recordAttendance = defineAction({
  name: 'workforce.attendance_record',
  input: z.object({ staffId: z.string().uuid(), kind: z.enum(['check_in', 'check_out']), onPremise: z.boolean(), shiftId: z.string().uuid().optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('record_attendance', { p_org: ctx.orgId, p_staff_id: i.staffId, p_kind: i.kind, p_on_premise: i.onPremise, p_shift_id: i.shiftId ?? null, p_actor_id: ctx.userId }),
});

export const requestLeave = defineAction({
  name: 'workforce.leave_request',
  input: z.object({
    staffId: z.string().uuid(), leaveType: z.string().max(40).default('casual'),
    start: DATE, end: DATE, reason: z.string().max(1000).optional(),
    requiredApprovals: z.number().int().min(1).default(1),
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('request_leave', {
    p_org: ctx.orgId, p_staff_id: i.staffId, p_leave_type: i.leaveType, p_start: i.start, p_end: i.end, p_reason: i.reason ?? null,
    p_required_approvals: i.requiredApprovals, p_requested_by_user: ctx.userId, p_actor_id: ctx.userId,
  }),
});

export const decideLeave = defineAction({
  name: 'workforce.leave_decide',
  input: z.object({ leaveId: z.string().uuid(), decision: z.enum(['approve', 'reject']) }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('decide_leave', { p_org: ctx.orgId, p_leave_id: i.leaveId, p_decision: i.decision, p_actor_id: ctx.userId }),
});
