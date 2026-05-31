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
    if (error.code === '22023') throw new ActionError('conflict', error.message);
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}

/** Mark a quote accepted — the trigger that lets a BEO be generated. */
export const acceptQuote = defineAction({
  name: 'catering.quote_accept',
  input: z.object({ quoteId: z.string().uuid() }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('accept_quote', { p_org: ctx.orgId, p_quote_id: input.quoteId, p_actor_id: ctx.userId }),
});

/** Generate a BEO from an accepted quote onto the SHARED Event (kitchen or FOH). */
export const generateBeo = defineAction({
  name: 'catering.beo_generate',
  input: z.object({
    quoteId: z.string().uuid(),
    beoType: z.enum(['kitchen', 'foh']),
    guestGuarantee: z.number().int().nonnegative(),
    serviceTime: z.string().max(40).optional(),
    venue: z.string().max(200).optional(),
    timeline: z.string().max(4000).optional(),
    special: z.string().max(4000).optional(),
  }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('generate_beo', {
    p_org: ctx.orgId, p_quote_id: input.quoteId, p_beo_type: input.beoType, p_guest_guarantee: input.guestGuarantee,
    p_service_time: input.serviceTime ?? null, p_venue: input.venue ?? null, p_timeline: input.timeline ?? null,
    p_special: input.special ?? null, p_actor_id: ctx.userId,
  }),
});

/** Edit mutable BEO fields — rejected once signed (immutable). */
export const updateBeo = defineAction({
  name: 'catering.beo_update',
  input: z.object({
    beoId: z.string().uuid(),
    guestGuarantee: z.number().int().nonnegative().optional(),
    serviceTime: z.string().max(40).optional(),
    venue: z.string().max(200).optional(),
    timeline: z.string().max(4000).optional(),
    special: z.string().max(4000).optional(),
  }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('update_beo', {
    p_org: ctx.orgId, p_beo_id: input.beoId, p_guest_guarantee: input.guestGuarantee ?? null,
    p_service_time: input.serviceTime ?? null, p_venue: input.venue ?? null, p_timeline: input.timeline ?? null,
    p_special: input.special ?? null, p_actor_id: ctx.userId,
  }),
});

export const sendBeo = defineAction({
  name: 'catering.beo_send',
  input: z.object({ beoId: z.string().uuid() }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('send_beo', { p_org: ctx.orgId, p_beo_id: input.beoId, p_actor_id: ctx.userId }),
});

/** Capture the e-signature — terminal; BEO is immutable thereafter. */
export const signBeo = defineAction({
  name: 'catering.beo_sign',
  input: z.object({ beoId: z.string().uuid(), signedByName: z.string().min(1).max(200), signedMethod: z.string().max(40).default('click') }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('sign_beo', {
    p_org: ctx.orgId, p_beo_id: input.beoId, p_signed_by_name: input.signedByName, p_signed_method: input.signedMethod, p_actor_id: ctx.userId,
  }),
});
