'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { defineAction } from './wrapper';
import { ActionError, type ActionResult, err, ok } from './types';

/**
 * M5 — tentative date holds + unified availability calendar. Hold WRITES go
 * through the wrapper → a single atomic RPC (rpcOwnsCompletion); each RPC
 * self-authorizes on auth.uid() (+ hold.manage). `availability_calendar` is a
 * member-open READ. convert_hold DELEGATES to confirm_booking / create_room_stay
 * — the GiST EXCLUDE is the sole confirmed-overlap authority.
 */
async function rpcWrite<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501' || /forbidden/.test(error.message)) throw new ActionError('forbidden', 'Not permitted.');
    if (error.code === 'P0002') throw new ActionError('not_found', error.message);
    if (error.code === '23P01' || /slot_taken|double_booked/.test(error.message)) throw new ActionError('conflict', 'That slot is already confirmed-booked.');
    if (error.code === '22023') throw new ActionError('conflict', error.message);
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}
const auth = (ctx: { orgId?: string | null }) => !!ctx.orgId;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Place a tentative hold (advisory; expires). Does not block confirms or other holds. */
export const placeHold = defineAction({
  name: 'hold.place',
  input: z.discriminatedUnion('domain', [
    z.object({
      domain: z.literal('hall'),
      expiresAt: z.string(), hallId: z.string().uuid(), eventDate: DATE,
      slot: z.enum(['morning', 'evening', 'full_day']), hallRent: z.number().nonnegative().optional(),
      guestName: z.string().min(1).max(200), guestPhone: z.string().max(20).optional(),
    }),
    z.object({
      domain: z.literal('stays'),
      expiresAt: z.string(), roomTypeId: z.string().uuid(), roomId: z.string().uuid().optional(),
      checkIn: DATE, checkOut: DATE,
      guestName: z.string().max(200).optional(), guestPhone: z.string().min(6).max(20),
    }),
  ]),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('place_hold', i.domain === 'hall'
    ? { p_org: ctx.orgId, p_domain: 'hall', p_expires_at: i.expiresAt, p_hall_id: i.hallId, p_event_date: i.eventDate, p_slot: i.slot, p_hall_rent: i.hallRent ?? null, p_guest_name: i.guestName, p_guest_phone: i.guestPhone ?? null, p_actor_id: ctx.userId }
    : { p_org: ctx.orgId, p_domain: 'stays', p_expires_at: i.expiresAt, p_room_type_id: i.roomTypeId, p_room_id: i.roomId ?? null, p_check_in: i.checkIn, p_check_out: i.checkOut, p_guest_name: i.guestName ?? null, p_guest_phone: i.guestPhone, p_actor_id: ctx.userId }),
});

export const releaseHold = defineAction({
  name: 'hold.release',
  input: z.object({ holdId: z.string().uuid() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('release_hold', { p_org: ctx.orgId, p_hold_id: i.holdId, p_actor_id: ctx.userId }),
});

/** Convert a hold → real booking/stay via the existing RPC (GiST decides). */
export const convertHold = defineAction({
  name: 'hold.convert',
  input: z.object({ holdId: z.string().uuid(), idempotencyKey: z.string().max(200).optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('convert_hold', { p_org: ctx.orgId, p_hold_id: i.holdId, p_idempotency_key: i.idempotencyKey ?? null, p_actor_id: ctx.userId }),
});

/** Read-only availability over a range: confirmed + active holds + (derived) free. */
export async function getAvailabilityCalendar(from: string, to: string): Promise<ActionResult<unknown>> {
  const ctx = await getRoleContext();
  if (!ctx?.orgId) return err('unauthenticated', 'Sign in with an org.');
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc('availability_calendar', { p_org: ctx.orgId, p_from: from, p_to: to });
  if (error) return err('rpc_error', error.message);
  return ok(data);
}
