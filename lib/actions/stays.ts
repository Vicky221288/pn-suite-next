'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { defineAction } from './wrapper';
import { ActionError } from './types';

async function rpcWrite<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501' || /forbidden/.test(error.message)) throw new ActionError('forbidden', 'Not permitted.');
    if (error.code === 'P0002') throw new ActionError('not_found', error.message);
    if (error.code === '23P01' || /double_booked/.test(error.message)) throw new ActionError('conflict', 'Room already booked for those dates.');
    if (error.code === '22023') throw new ActionError('conflict', error.message);
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}
const auth = (ctx: { orgId?: string | null }) => !!ctx.orgId;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const upsertRoomType = defineAction({
  name: 'stays.room_type_upsert',
  input: z.object({ name: z.string().min(1).max(120), baseRate: z.number().nonnegative(), roomTypeId: z.string().uuid().optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('upsert_room_type', { p_org: ctx.orgId, p_name: i.name, p_base_rate: i.baseRate, p_room_type_id: i.roomTypeId ?? null, p_actor_id: ctx.userId }),
});

export const createRoom = defineAction({
  name: 'stays.room_create',
  input: z.object({ roomTypeId: z.string().uuid(), number: z.string().min(1).max(40), name: z.string().max(120).optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('create_room', { p_org: ctx.orgId, p_room_type_id: i.roomTypeId, p_number: i.number, p_name: i.name ?? null, p_actor_id: ctx.userId }),
});

export const setRoomStatus = defineAction({
  name: 'stays.room_status',
  input: z.object({ roomId: z.string().uuid(), status: z.enum(['available', 'out_of_service']) }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_room_status', { p_org: ctx.orgId, p_room_id: i.roomId, p_status: i.status, p_actor_id: ctx.userId }),
});

/** Reserve a stay — reuses the shared Guest; the GiST guard rejects overlaps. */
export const createRoomStay = defineAction({
  name: 'stays.stay_create',
  input: z.object({
    phone: z.string().min(6).max(20), name: z.string().min(1).max(200),
    roomId: z.string().uuid().optional(), roomTypeId: z.string().uuid().optional(),
    checkIn: DATE, checkOut: DATE,   // room or room_type required — enforced in the RPC (room_or_type_required)
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('create_room_stay', {
    p_org: ctx.orgId, p_phone: i.phone, p_name: i.name, p_room_id: i.roomId ?? null, p_room_type_id: i.roomTypeId ?? null,
    p_check_in: i.checkIn, p_check_out: i.checkOut, p_actor_id: ctx.userId,
  }),
});

export const assignRoom = defineAction({
  name: 'stays.assign_room',
  input: z.object({ stayId: z.string().uuid(), roomId: z.string().uuid() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('assign_room', { p_org: ctx.orgId, p_stay_id: i.stayId, p_room_id: i.roomId, p_actor_id: ctx.userId }),
});

export const setRoomStayStatus = defineAction({
  name: 'stays.stay_status',
  input: z.object({ stayId: z.string().uuid(), status: z.enum(['reserved', 'checked_in', 'checked_out', 'settled', 'cancelled', 'no_show']) }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_room_stay_status', { p_org: ctx.orgId, p_stay_id: i.stayId, p_status: i.status, p_actor_id: ctx.userId }),
});

// ── S2: front desk — walk-in, check-in (Form C gate), check-out ──────────────
const FormCSchema = z.object({
  passportNumber: z.string().min(1), nationality: z.string().min(1), dateOfBirth: DATE,
  visaType: z.string().optional(), visaNumber: z.string().min(1), arrivedFrom: z.string().min(1),
  intendedStay: z.string().optional(), nextDestination: z.string().optional(),
});
// map camelCase Form C → the snake_case jsonb the RPC's pn_form_c_complete expects
function formCJson(f: z.infer<typeof FormCSchema>) {
  return { passport_number: f.passportNumber, nationality: f.nationality, date_of_birth: f.dateOfBirth, visa_type: f.visaType ?? null, visa_number: f.visaNumber, arrived_from: f.arrivedFrom, intended_stay: f.intendedStay ?? null, next_destination: f.nextDestination ?? null };
}

export const checkInStay = defineAction({
  name: 'stays.check_in',
  input: z.object({ stayId: z.string().uuid(), roomId: z.string().uuid().optional(), isForeign: z.boolean().default(false), formC: FormCSchema.optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('check_in_stay', { p_org: ctx.orgId, p_stay_id: i.stayId, p_room_id: i.roomId ?? null, p_is_foreign: i.isForeign, p_form_c: i.formC ? formCJson(i.formC) : null, p_actor_id: ctx.userId }),
});

export const checkOutStay = defineAction({
  name: 'stays.check_out',
  input: z.object({ stayId: z.string().uuid() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('check_out_stay', { p_org: ctx.orgId, p_stay_id: i.stayId, p_actor_id: ctx.userId }),
});

export const createWalkIn = defineAction({
  name: 'stays.walk_in',
  input: z.object({ phone: z.string().min(6).max(20), name: z.string().min(1).max(200), roomId: z.string().uuid(), checkIn: DATE, checkOut: DATE, isForeign: z.boolean().default(false), formC: FormCSchema.optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('create_walk_in', { p_org: ctx.orgId, p_phone: i.phone, p_name: i.name, p_room_id: i.roomId, p_check_in: i.checkIn, p_check_out: i.checkOut, p_is_foreign: i.isForeign, p_form_c: i.formC ? formCJson(i.formC) : null, p_actor_id: ctx.userId }),
});

// ── S3: housekeeping + maintenance ──────────────────────────────────────────
export const setHousekeepingStatus = defineAction({
  name: 'stays.hk_status',
  input: z.object({ roomId: z.string().uuid(), status: z.enum(['clean', 'dirty', 'inspected', 'out_of_order']) }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_housekeeping_status', { p_org: ctx.orgId, p_room_id: i.roomId, p_status: i.status, p_actor_id: ctx.userId }),
});

export const createHousekeepingTask = defineAction({
  name: 'stays.hk_task_create',
  input: z.object({ roomId: z.string().uuid(), kind: z.string().max(40).default('turnover'), requiresPhoto: z.boolean().default(false) }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('create_housekeeping_task', { p_org: ctx.orgId, p_room_id: i.roomId, p_kind: i.kind, p_requires_photo: i.requiresPhoto, p_stay_id: null, p_actor_id: ctx.userId }),
});

export const assignHousekeepingTask = defineAction({
  name: 'stays.hk_task_assign',
  input: z.object({ taskId: z.string().uuid(), staffId: z.string().uuid() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('assign_housekeeping_task', { p_org: ctx.orgId, p_task_id: i.taskId, p_staff_id: i.staffId, p_actor_id: ctx.userId }),
});

export const completeHousekeepingTask = defineAction({
  name: 'stays.hk_task_complete',
  input: z.object({ taskId: z.string().uuid(), photoRef: z.string().max(500).optional(), result: z.enum(['clean', 'inspected']).default('inspected') }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('complete_housekeeping_task', { p_org: ctx.orgId, p_task_id: i.taskId, p_photo_ref: i.photoRef ?? null, p_result: i.result, p_actor_id: ctx.userId }),
});

export const createMaintenanceRequest = defineAction({
  name: 'stays.maint_create',
  input: z.object({ roomId: z.string().uuid(), description: z.string().min(1).max(1000), priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium') }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('create_maintenance_request', { p_org: ctx.orgId, p_room_id: i.roomId, p_description: i.description, p_priority: i.priority, p_actor_id: ctx.userId }),
});

export const setMaintenanceStatus = defineAction({
  name: 'stays.maint_status',
  input: z.object({ requestId: z.string().uuid(), status: z.enum(['open', 'in_progress', 'resolved']), staffId: z.string().uuid().optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_maintenance_status', { p_org: ctx.orgId, p_request_id: i.requestId, p_status: i.status, p_staff_id: i.staffId ?? null, p_actor_id: ctx.userId }),
});

export const setRoomOutOfOrder = defineAction({
  name: 'stays.room_ooo', input: z.object({ roomId: z.string().uuid() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_room_out_of_order', { p_org: ctx.orgId, p_room_id: i.roomId, p_actor_id: ctx.userId }),
});

export const restoreRoom = defineAction({
  name: 'stays.room_restore', input: z.object({ roomId: z.string().uuid() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('restore_room', { p_org: ctx.orgId, p_room_id: i.roomId, p_actor_id: ctx.userId }),
});
