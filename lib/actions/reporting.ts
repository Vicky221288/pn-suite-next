'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { defineAction } from './wrapper';
import { ActionError, type ActionResult, err, ok } from './types';

/**
 * M8 — reporting + marketing leaf. Reports are pure READS over the one ledger /
 * invoice_lines (resolve_gst OUTPUT, never recomputed) / leads. Marketing WRITES
 * go through the wrapper → atomic RPC (cap marketing.manage); LED revenue posts to
 * the EXISTING finance_ledger via write_ledger (no parallel ledger). Money figures
 * are gated by pnl.view_margin inside the RPCs.
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
async function rpcRead(fn: string, args: Record<string, unknown>): Promise<ActionResult<unknown>> {
  const ctx = await getRoleContext();
  if (!ctx?.orgId) return err('unauthenticated', 'Sign in with an org.');
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc(fn, { p_org: ctx.orgId, ...args });
  if (error) return err('rpc_error', error.message);
  return ok(data);
}
const auth = (ctx: { orgId?: string | null }) => !!ctx.orgId;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ── reads ── ('use server' requires every export to be an async function)
export async function getConsolidatedPnl(from: string, to: string) { return rpcRead('consolidated_pnl', { p_from: from, p_to: to }); }
export async function getGstReturn(from: string, to: string) { return rpcRead('gst_return_report', { p_from: from, p_to: to }); }
export async function getArAgeingByCustomer(asOf?: string) { return rpcRead('ar_ageing_by_customer', asOf ? { p_as_of: asOf } : {}); }
export async function getLeadSourceReport(from: string, to: string) { return rpcRead('lead_source_report', { p_from: from, p_to: to }); }

// ── marketing writes ──
export const upsertCampaign = defineAction({
  name: 'marketing.campaign_upsert',
  input: z.object({ name: z.string().min(1).max(120), channel: z.string().max(60).optional(), periodStart: DATE.optional(), periodEnd: DATE.optional(), spend: z.number().nonnegative().default(0), campaignId: z.string().uuid().optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('upsert_campaign', { p_org: ctx.orgId, p_name: i.name, p_channel: i.channel ?? null, p_period_start: i.periodStart ?? null, p_period_end: i.periodEnd ?? null, p_spend: i.spend, p_campaign_id: i.campaignId ?? null, p_actor_id: ctx.userId }),
});

export const setLeadSource = defineAction({
  name: 'marketing.lead_source_set',
  input: z.object({ leadId: z.string().uuid(), source: z.string().min(1).max(60), campaignId: z.string().uuid().optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_lead_source', { p_org: ctx.orgId, p_lead_id: i.leadId, p_source: i.source, p_campaign_id: i.campaignId ?? null, p_actor_id: ctx.userId }),
});

export const recordAdRevenue = defineAction({
  name: 'marketing.ad_revenue',
  input: z.object({ advertiser: z.string().min(1).max(160), amount: z.number().nonnegative(), slot: z.string().max(200).optional(), periodStart: DATE.optional(), periodEnd: DATE.optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('record_ad_revenue', { p_org: ctx.orgId, p_advertiser: i.advertiser, p_amount: i.amount, p_slot: i.slot ?? null, p_period_start: i.periodStart ?? null, p_period_end: i.periodEnd ?? null, p_actor_id: ctx.userId }),
});
