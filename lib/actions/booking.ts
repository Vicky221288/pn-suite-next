'use server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { defineAction } from './wrapper';
import { ActionError } from './types';

/**
 * booking.confirm — the B1 reference action (OP MODEL §5.2 CONFIRMED transition).
 * The wrapper handles auth/validate/authorize + attempted/failed audit; the
 * single atomic RPC `confirm_booking` does ALL writes (booking + hard-block +
 * deposit liability + completed audit) in one transaction. This is the template
 * EVERY future write copies.
 */

const ConfirmBookingInput = z.object({
  // B1 accepts orgId explicitly; B2 will derive it from the caller's membership
  // (ctx.orgId) and REJECT any mismatch — closing the F-SEC-04 cross-tenant hole.
  orgId: z.string().uuid(),
  hallId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  slot: z.enum(['morning', 'evening', 'full_day']),
  hallRent: z.number().nonnegative(),
  customerName: z.string().min(1).max(200),
  idempotencyKey: z.string().min(8).max(200),
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
  rpcOwnsCompletion: true, // the RPC writes the atomic 'completed' audit row
  run: async (ctx, input) => {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('confirm_booking', {
      p_org_id: input.orgId,
      p_hall_id: input.hallId,
      p_event_date: input.eventDate,
      p_slot: input.slot,
      p_hall_rent: input.hallRent,
      p_customer_name: input.customerName,
      p_idempotency_key: input.idempotencyKey,
      p_actor_id: ctx.userId,
      p_parent_audit_id: ctx.auditAttemptedId,
    });
    if (error) {
      if (error.code === '23P01' || /slot_taken/.test(error.message)) {
        throw new ActionError('conflict', 'That hall, date and slot is already booked.');
      }
      throw new ActionError('rpc_error', error.message);
    }
    return data as ConfirmBookingResult;
  },
  entity: (_input, output) => ({ type: 'booking', id: output?.booking_id }),
});
