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
