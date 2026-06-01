'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { defineAction } from './wrapper';
import { ActionError, type ActionResult, err, ok } from './types';

/**
 * M4 — dynamic pricing (SELLING PRICE ONLY). Rule WRITES go through the wrapper →
 * a single atomic RPC (rpcOwnsCompletion); the RPC self-authorizes on auth.uid()
 * (+ pricing.manage). `resolve_price` is a pure READ (selling price), member-open.
 *
 * THE GST FIREWALL: nothing here touches/calls resolve_gst. resolve_price returns
 * a pre-tax figure; GST is applied downstream by the unchanged invoice engine.
 */
async function rpcWrite<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501' || /forbidden/.test(error.message)) throw new ActionError('forbidden', 'Not permitted.');
    if (error.code === 'P0002') throw new ActionError('not_found', error.message);
    if (error.code === '22023' || error.code === '23514') throw new ActionError('conflict', error.message);
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}
const auth = (ctx: { orgId?: string | null }) => !!ctx.orgId;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const upsertRateRule = defineAction({
  name: 'pricing.rule_upsert',
  input: z.object({
    name: z.string().min(1).max(120),
    subjectType: z.enum(['room_type', 'hall']),
    subjectId: z.string().uuid().optional(),
    conditionType: z.enum(['always', 'date_range', 'day_of_week', 'occupancy']),
    adjustmentKind: z.enum(['percent', 'absolute']),
    adjustmentValue: z.number(),
    priority: z.number().int().default(100),
    dateFrom: DATE.optional(), dateTo: DATE.optional(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    occupancyMin: z.number().min(0).max(100).optional(),
    active: z.boolean().default(true),
    ruleId: z.string().uuid().optional(),
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('upsert_rate_rule', {
    p_org: ctx.orgId, p_name: i.name, p_subject_type: i.subjectType, p_condition_type: i.conditionType,
    p_adjustment_kind: i.adjustmentKind, p_adjustment_value: i.adjustmentValue, p_subject_id: i.subjectId ?? null,
    p_priority: i.priority, p_date_from: i.dateFrom ?? null, p_date_to: i.dateTo ?? null,
    p_days_of_week: i.daysOfWeek ?? null, p_occupancy_min: i.occupancyMin ?? null, p_active: i.active,
    p_rule_id: i.ruleId ?? null, p_actor_id: ctx.userId,
  }),
});

export const setRateRuleActive = defineAction({
  name: 'pricing.rule_active',
  input: z.object({ ruleId: z.string().uuid(), active: z.boolean() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_rate_rule_active', { p_org: ctx.orgId, p_rule_id: i.ruleId, p_active: i.active, p_actor_id: ctx.userId }),
});

/** Pure read: effective PRE-TAX selling price + which rules fired. No GST here. */
export async function resolvePrice(args: {
  subjectType: 'room_type' | 'hall'; subjectId?: string; base: number; date?: string; occupancyPct?: number;
}): Promise<ActionResult<unknown>> {
  const ctx = await getRoleContext();
  if (!ctx?.orgId) return err('unauthenticated', 'Sign in with an org.');
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc('resolve_price', {
    p_org: ctx.orgId, p_subject_type: args.subjectType, p_subject_id: args.subjectId ?? null,
    p_base: args.base, p_date: args.date ?? null, p_occupancy_pct: args.occupancyPct ?? null,
  });
  if (error) return err('rpc_error', error.message);
  return ok(data);
}
