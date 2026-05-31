'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { defineAction } from './wrapper';
import { ActionError } from './types';
import { CAP } from '@/lib/auth/capabilities';

/**
 * booking.confirm — the reference write (OP MODEL §5.2 CONFIRMED transition).
 *
 * B2 changes vs B1:
 *  - org_id is NO LONGER a client input. It is the caller's session-resolved org
 *    (ctx.orgId) — never trust a client-supplied org for an authenticated call
 *    (the F-SEC-04 fix).
 *  - authorize() requires the `booking.confirm` capability (Owner/PM only).
 *  - the RPC is called via the USER-session client so auth.uid() is set and the
 *    RPC's own membership+capability self-check runs (defense in depth).
 */

const ConfirmBookingInput = z.object({
  hallId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  slot: z.enum(['morning', 'evening', 'full_day']),
  hallRent: z.number().nonnegative(),
  customerName: z.string().min(1).max(200),
  idempotencyKey: z.string().min(8).max(200),
  // B5: optionally link the won lead (sets bookings.lead_id + lead.status='won'
  // inside the same atomic tx).
  leadId: z.string().uuid().optional(),
  // B5a: customer phone for A5 rent reminders; if omitted it is derived from the
  // linked lead's phone inside the RPC.
  customerPhone: z.string().min(6).max(20).optional(),
});
export type ConfirmBookingInput = z.infer<typeof ConfirmBookingInput>;

interface ConfirmBookingResult {
  booking_id: string;
  status: string;
  deposit?: number;
  idempotent: boolean;
}

export const confirmBooking = defineAction<ConfirmBookingInput, ConfirmBookingResult>({
  name: 'booking.confirm',
  input: ConfirmBookingInput,
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId && ctx.capabilities.includes(CAP.BOOKING_CONFIRM),
  run: async (ctx, input) => {
    // User-session client → the RPC sees auth.uid() and self-authorizes.
    const supabase = await createUserClient();
    const { data, error } = await supabase.rpc('confirm_booking', {
      p_org_id: ctx.orgId, // server-resolved, NOT from the client
      p_hall_id: input.hallId,
      p_event_date: input.eventDate,
      p_slot: input.slot,
      p_hall_rent: input.hallRent,
      p_customer_name: input.customerName,
      p_idempotency_key: input.idempotencyKey,
      p_actor_id: ctx.userId,
      p_parent_audit_id: ctx.auditAttemptedId,
      p_lead_id: input.leadId ?? null,
      p_customer_phone: input.customerPhone ?? null,
    });
    if (error) {
      if (error.code === '23P01' || /slot_taken/.test(error.message)) {
        throw new ActionError('conflict', 'That hall, date and slot is already booked.');
      }
      if (error.code === '42501' || /forbidden/.test(error.message)) {
        throw new ActionError('forbidden', 'You cannot confirm bookings for this property.');
      }
      throw new ActionError('rpc_error', error.message);
    }
    return data as ConfirmBookingResult;
  },
  entity: (_input, output) => ({ type: 'booking', id: output?.booking_id }),
});
