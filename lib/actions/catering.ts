'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { defineAction } from './wrapper';
import { ActionError, type ActionResult, err, ok } from './types';

/** Create/update a catering menu item (atomic + audited, wrapper+RPC). */
export const createMenuItem = defineAction({
  name: 'catering.menu_item_upsert',
  input: z.object({
    name: z.string().min(1).max(200),
    category: z.string().max(100).optional(),
    sellingPrice: z.number().nonnegative().optional(),
    supplyType: z.string().max(60).optional(),
  }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: async (ctx, input) => {
    const supabase = await createUserClient();
    const { data, error } = await supabase.rpc('upsert_menu_item', {
      p_org: ctx.orgId, p_name: input.name, p_category: input.category ?? null,
      p_selling_price: input.sellingPrice ?? 0, p_supply_type: input.supplyType ?? null, p_actor_id: ctx.userId,
    });
    if (error) {
      if (error.code === '42501' || /forbidden/.test(error.message)) throw new ActionError('forbidden', 'Not permitted.');
      throw new ActionError('rpc_error', error.message);
    }
    return data as { menu_item_id: string };
  },
});

/**
 * Scale preview (read-only) — auto-scale + cost for a menu item at a guest count.
 * Not a write, so no wrapper/audit; org resolved from session, RLS-enforced.
 */
const ScaleInput = z.object({ menuItemId: z.string().uuid(), guestCount: z.number().int().nonnegative().max(100000) });
export async function previewScale(raw: unknown): Promise<ActionResult<unknown>> {
  const ctx = await getRoleContext();
  if (!ctx?.orgId) return err('unauthenticated', 'Sign in with an org.');
  const parsed = ScaleInput.safeParse(raw);
  if (!parsed.success) return err('validation_error', 'Check the guest count.');
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc('scale_recipe', {
    p_org: ctx.orgId, p_menu_item_id: parsed.data.menuItemId, p_guest_count: parsed.data.guestCount,
  });
  if (error) return err('rpc_error', error.message);
  return ok(data);
}
