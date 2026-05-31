'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { defineAction } from './wrapper';
import { ActionError, type ActionResult, err, ok } from './types';

async function rpcWrite<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501' || /forbidden/.test(error.message)) throw new ActionError('forbidden', 'Not permitted.');
    if (error.code === 'P0002') throw new ActionError('not_found', error.message);
    if (error.code === '23514' || error.code === '22023') throw new ActionError('conflict', error.message); // over-draw / bad-state
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}

/** Generate the KOT + consolidated ingredient requirement from a signed BEO. */
export const generateProduction = defineAction({
  name: 'catering.production_generate',
  input: z.object({ beoId: z.string().uuid() }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('generate_production', { p_org: ctx.orgId, p_beo_id: input.beoId, p_actor_id: ctx.userId }),
});

/** Lightweight Stays room-dining ticket (no BEO). lines = [{menuItemId, portionCount}]. */
export const createRoomDining = defineAction({
  name: 'catering.room_dining_create',
  input: z.object({
    label: z.string().max(120).optional(),
    lines: z.array(z.object({ menuItemId: z.string().uuid(), portionCount: z.number().nonnegative() })).min(1),
  }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('create_room_dining', {
    p_org: ctx.orgId, p_label: input.label ?? null, p_actor_id: ctx.userId,
    p_lines: input.lines.map((l) => ({ menu_item_id: l.menuItemId, portion_count: l.portionCount })),
  }),
});

/** Compare requirement vs on-hand → draft POs grouped by supplier. */
export const planPurchase = defineAction({
  name: 'catering.purchase_plan',
  input: z.object({ ticketId: z.string().uuid() }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('plan_purchase', { p_org: ctx.orgId, p_ticket_id: input.ticketId, p_actor_id: ctx.userId }),
});

export const orderPurchaseOrder = defineAction({
  name: 'catering.po_order',
  input: z.object({ poId: z.string().uuid() }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('order_purchase_order', { p_org: ctx.orgId, p_po_id: input.poId, p_actor_id: ctx.userId }),
});

/** Receive a PO — stock IN via W0 record_stock_movement (atomic, audited). */
export const receivePurchaseOrder = defineAction({
  name: 'catering.po_receive',
  input: z.object({ poId: z.string().uuid() }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('receive_purchase_order', { p_org: ctx.orgId, p_po_id: input.poId, p_actor_id: ctx.userId }),
});

/** Close/execute a ticket — consumption OUT (idempotent; over-draw rejected). */
export const closeProduction = defineAction({
  name: 'catering.production_close',
  input: z.object({
    ticketId: z.string().uuid(),
    actuals: z.array(z.object({ itemId: z.string().uuid(), actualQuantity: z.number().nonnegative() })).optional(),
  }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('close_production', {
    p_org: ctx.orgId, p_ticket_id: input.ticketId, p_actor_id: ctx.userId,
    p_actuals: input.actuals ? input.actuals.map((a) => ({ item_id: a.itemId, actual_quantity: a.actualQuantity })) : null,
  }),
});

export const upsertVendor = defineAction({
  name: 'catering.vendor_upsert',
  input: z.object({
    name: z.string().min(1).max(200), phone: z.string().max(20).optional(), email: z.string().max(200).optional(),
    notes: z.string().max(1000).optional(), vendorId: z.string().uuid().optional(),
  }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('upsert_vendor', {
    p_org: ctx.orgId, p_name: input.name, p_phone: input.phone ?? null, p_email: input.email ?? null,
    p_notes: input.notes ?? null, p_vendor_id: input.vendorId ?? null, p_actor_id: ctx.userId,
  }),
});

/** Read-only variance — RPC gates cost/variance server-side by capability. */
export async function getProductionVariance(ticketId: string): Promise<ActionResult<unknown>> {
  const ctx = await getRoleContext();
  if (!ctx?.orgId) return err('unauthenticated', 'Sign in with an org.');
  if (!z.string().uuid().safeParse(ticketId).success) return err('validation_error', 'Bad ticket id.');
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc('production_variance', { p_org: ctx.orgId, p_ticket_id: ticketId });
  if (error) return err('rpc_error', error.message);
  return ok(data);
}
