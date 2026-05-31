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
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}

export const createCateringEnquiry = defineAction({
  name: 'catering.enquiry_create',
  input: z.object({
    eventType: z.string().max(80).optional(),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    guestCount: z.number().int().nonnegative().optional(),
    contactName: z.string().min(1).max(200),
    contactPhone: z.string().min(6).max(20),
    notes: z.string().max(2000).optional(),
  }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('create_catering_enquiry', {
    p_org: ctx.orgId, p_event_type: input.eventType ?? null, p_event_date: input.eventDate ?? null,
    p_guest_count: input.guestCount ?? null, p_contact_name: input.contactName, p_contact_phone: input.contactPhone,
    p_notes: input.notes ?? null, p_actor_id: ctx.userId,
  }),
});

const LineSchema = z.object({ menuItemId: z.string().uuid(), unitSellingPrice: z.number().nonnegative().optional() });
export const createQuote = defineAction({
  name: 'catering.quote_create',
  input: z.object({
    enquiryId: z.string().uuid(),
    guestCount: z.number().int().nonnegative(),
    lines: z.array(LineSchema).default([]),
    packageId: z.string().uuid().optional(),
  }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('create_quote', {
    p_org: ctx.orgId, p_enquiry_id: input.enquiryId, p_guest_count: input.guestCount,
    p_lines: input.lines.map((l) => ({ menu_item_id: l.menuItemId, unit_selling_price: l.unitSellingPrice ?? null })),
    p_package_id: input.packageId ?? null, p_actor_id: ctx.userId,
  }),
});

export const upsertPackage = defineAction({
  name: 'catering.package_upsert',
  input: z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    items: z.array(z.object({ menuItemId: z.string().uuid(), unitSellingPrice: z.number().nonnegative() })).default([]),
    packageId: z.string().uuid().optional(),
  }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('upsert_package', {
    p_org: ctx.orgId, p_name: input.name, p_description: input.description ?? null,
    p_items: input.items.map((i) => ({ menu_item_id: i.menuItemId, unit_selling_price: i.unitSellingPrice })),
    p_package_id: input.packageId ?? null, p_actor_id: ctx.userId,
  }),
});

/** Read-only quote summary — the RPC gates cost/margin server-side by capability. */
export async function getQuoteSummary(quoteId: string): Promise<ActionResult<unknown>> {
  const ctx = await getRoleContext();
  if (!ctx?.orgId) return err('unauthenticated', 'Sign in with an org.');
  if (!z.string().uuid().safeParse(quoteId).success) return err('validation_error', 'Bad quote id.');
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc('quote_summary', { p_org: ctx.orgId, p_quote_id: quoteId });
  if (error) return err('rpc_error', error.message);
  return ok(data);
}
