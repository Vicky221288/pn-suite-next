'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { defineAction } from './wrapper';
import { ActionError } from './types';

/**
 * Guest shared-core actions (W0). Wrapper around the atomic RPCs via the user
 * client (RPC self-authorizes on auth.uid()). org_id = ctx.orgId, never input.
 */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501' || /forbidden/.test(error.message)) throw new ActionError('forbidden', 'You do not have permission to do that.');
    if (error.code === 'P0002' || /not_found/.test(error.message)) throw new ActionError('not_found', error.message);
    if (error.code === '22023') throw new ActionError('validation_error', error.message);
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}

export const createGuest = defineAction({
  name: 'guest.find_or_create',
  input: z.object({
    name: z.string().min(1).max(200),
    phone: z.string().min(6).max(20),
    email: z.string().email().optional().or(z.literal('')),
    address: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
    dietary: z.array(z.string()).optional(),
  }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) =>
    rpc('find_or_create_guest', {
      p_org: ctx.orgId, p_phone: input.phone, p_name: input.name,
      p_email: input.email || null, p_address: input.address ?? null, p_notes: input.notes ?? null,
      p_dietary: input.dietary ?? [], p_actor_id: ctx.userId,
    }),
});

export const mergeGuests = defineAction({
  name: 'guest.merge',
  input: z.object({ keepId: z.string().uuid(), mergeId: z.string().uuid() }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpc('merge_guests', { p_org: ctx.orgId, p_keep_id: input.keepId, p_merge_id: input.mergeId, p_actor_id: ctx.userId }),
});
