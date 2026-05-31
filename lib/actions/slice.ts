'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { defineAction } from './wrapper';
import { ActionError } from './types';
import { CAP } from '@/lib/auth/capabilities';

/**
 * B5 spine actions (Enquiry → Quote → Event → Settlement). Each composes the
 * wrapper (auth/validate/authorize + attempted/failed audit) around an atomic
 * RPC called via the USER-session client (so the RPC self-authorizes on
 * auth.uid()). org_id is always ctx.orgId — never client input (F-SEC-04).
 * The RPCs write their own atomic 'completed' audit (rpcOwnsCompletion).
 */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501' || /forbidden/.test(error.message)) {
      throw new ActionError('forbidden', 'You do not have permission to do that.');
    }
    if (error.code === 'P0002' || /not_found/.test(error.message)) {
      throw new ActionError('not_found', error.message);
    }
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}

export const createEnquiry = defineAction({
  name: 'enquiry.create',
  input: z.object({
    functionArea: z.enum(['stays', 'hall_catering']),
    phone: z.string().min(6).max(20),
    name: z.string().min(1).max(200),
  }),
  rpcOwnsCompletion: true,
  run: (ctx, input) =>
    rpc('create_enquiry', { p_org: ctx.orgId, p_function_area: input.functionArea, p_phone: input.phone, p_name: input.name, p_actor_id: ctx.userId }),
});

export const recordFollowup = defineAction({
  name: 'enquiry.followup',
  input: z.object({ leadId: z.string().uuid() }),
  rpcOwnsCompletion: true,
  run: (ctx, input) => rpc('record_followup', { p_org: ctx.orgId, p_lead_id: input.leadId, p_actor_id: ctx.userId }),
});

export const createQuote = defineAction({
  name: 'quote.create',
  input: z.object({
    leadId: z.string().uuid(),
    hallRent: z.number().nonnegative(),
    guestCount: z.number().int().positive().optional(),
    validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  rpcOwnsCompletion: true,
  run: (ctx, input) =>
    rpc('create_quote', { p_org: ctx.orgId, p_lead_id: input.leadId, p_hall_rent: input.hallRent, p_guest_count: input.guestCount ?? null, p_valid_until: input.validUntil ?? null, p_actor_id: ctx.userId }),
});

export const createEvent = defineAction({
  name: 'event.create',
  input: z.object({ bookingId: z.string().uuid(), guestCount: z.number().int().positive().optional() }),
  rpcOwnsCompletion: true,
  run: (ctx, input) => rpc('create_event', { p_org: ctx.orgId, p_booking_id: input.bookingId, p_guest_count: input.guestCount ?? null, p_actor_id: ctx.userId }),
});

export const settleBooking = defineAction({
  name: 'settlement.process',
  input: z.object({
    bookingId: z.string().uuid(),
    depositResolution: z.enum(['refund', 'forfeit', 'adjust']),
    damageAmount: z.number().nonnegative().optional(),
  }),
  rpcOwnsCompletion: true,
  // Owner/PM only (OP MODEL §12) — DB also self-authorizes on the capability.
  authorize: (ctx) => ctx.capabilities.includes(CAP.SETTLEMENT_PROCESS),
  run: (ctx, input) =>
    rpc('settle_booking', { p_org: ctx.orgId, p_booking_id: input.bookingId, p_deposit_resolution: input.depositResolution, p_damage_amount: input.damageAmount ?? 0, p_actor_id: ctx.userId }),
});
