'use server';
import { z } from 'zod';
import { defineAction } from './wrapper';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { ActionError } from './types';

/**
 * M7 — inventory reorder config. set_reorder_point is the only write (cap
 * inventory.manage); detection + drafting is the B4 registry rule run_reorder_check
 * (A_reorder), which reads on-hand from the EXISTING W0 field and drafts via the
 * EXISTING W1d PO path. NULL reorder_point = not monitored (opt-in).
 */
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
const auth = (ctx: { orgId?: string | null }) => !!ctx.orgId;

export const setReorderPoint = defineAction({
  name: 'inventory.reorder_config',
  input: z.object({
    itemId: z.string().uuid(),
    reorderPoint: z.number().nonnegative().nullable(),   // null = stop monitoring this item
    reorderQty: z.number().positive().optional(),        // required (in the RPC) when a reorderPoint is set
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_reorder_point', { p_org: ctx.orgId, p_item_id: i.itemId, p_reorder_point: i.reorderPoint, p_reorder_qty: i.reorderQty ?? null, p_actor_id: ctx.userId }),
});
