'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { defineAction } from './wrapper';
import { ActionError, type ActionResult, err, ok } from './types';

/**
 * M3 — Guest CRM enrichment. Every write: wrapper → single atomic RPC
 * (rpcOwnsCompletion); the RPC self-authorizes on auth.uid() (+ crm.manage).
 * ALL sends route through the B3 enqueue_outbound ONLY (idempotent + quiet-hours);
 * there is no other send path. LTV is computed live (no stored column).
 */
async function rpcWrite<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501' || /forbidden/.test(error.message)) throw new ActionError('forbidden', 'Not permitted.');
    if (error.code === 'P0002' || /no_sender/.test(error.message)) throw new ActionError('not_found', error.message);
    if (error.code === '22023') throw new ActionError('conflict', error.message);
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}
const auth = (ctx: { orgId?: string | null }) => !!ctx.orgId;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const logInteraction = defineAction({
  name: 'crm.interaction_log',
  input: z.object({
    guestId: z.string().uuid(), type: z.enum(['call', 'visit', 'message', 'note', 'email', 'other']),
    channel: z.string().max(40).optional(), note: z.string().max(2000).optional(),
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('log_interaction', { p_org: ctx.orgId, p_guest: i.guestId, p_type: i.type, p_channel: i.channel ?? null, p_note: i.note ?? null, p_actor_id: ctx.userId }),
});

export const setSpecialDate = defineAction({
  name: 'crm.special_date_set',
  input: z.object({ guestId: z.string().uuid(), dateType: z.enum(['anniversary', 'birthday', 'other']), theDate: DATE, label: z.string().max(120).optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_special_date', { p_org: ctx.orgId, p_guest: i.guestId, p_date_type: i.dateType, p_the_date: i.theDate, p_label: i.label ?? null, p_actor_id: ctx.userId }),
});

export const upsertMessageTemplate = defineAction({
  name: 'crm.template_upsert',
  input: z.object({
    name: z.string().min(1).max(120), functionArea: z.string().min(1).max(60), body: z.string().min(1).max(4000),
    channel: z.string().max(40).default('whatsapp'), templateId: z.string().uuid().optional(),
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('upsert_message_template', { p_org: ctx.orgId, p_name: i.name, p_function_area: i.functionArea, p_body: i.body, p_channel: i.channel, p_template_id: i.templateId ?? null, p_actor_id: ctx.userId }),
});

/** Manual send NOW — the ONLY path is the B3 enqueue_outbound (idempotent + quiet-hours). */
export const sendTemplateToGuest = defineAction({
  name: 'crm.template_send',
  input: z.object({ guestId: z.string().uuid(), templateId: z.string().uuid(), payload: z.record(z.string(), z.string()).default({}), idempotencyKey: z.string().max(200).optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('send_template_to_guest', { p_org: ctx.orgId, p_guest: i.guestId, p_template_id: i.templateId, p_payload: i.payload, p_idempotency_key: i.idempotencyKey ?? null, p_actor_id: ctx.userId }),
});

export const createReviewRequest = defineAction({
  name: 'crm.review_request',
  input: z.object({ guestId: z.string().uuid(), templateId: z.string().uuid(), eventId: z.string().uuid().optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('create_review_request', { p_org: ctx.orgId, p_guest: i.guestId, p_template_id: i.templateId, p_event: i.eventId ?? null, p_actor_id: ctx.userId }),
});

/** Designate which template a recurring rule uses (M3-auto): review_request / anniversary / birthday / other. */
export const setTemplatePurpose = defineAction({
  name: 'crm.template_purpose_set',
  input: z.object({ templateId: z.string().uuid(), purpose: z.enum(['review_request', 'anniversary', 'birthday', 'other']).nullable() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_template_purpose', { p_org: ctx.orgId, p_template_id: i.templateId, p_purpose: i.purpose, p_actor_id: ctx.userId }),
});

/** Live LTV — a query over finance_ledger; RPC gates the figure by pnl.view_margin. */
export async function getGuestLtv(guestId: string): Promise<ActionResult<unknown>> {
  const ctx = await getRoleContext();
  if (!ctx?.orgId) return err('unauthenticated', 'Sign in with an org.');
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc('guest_ltv', { p_org: ctx.orgId, p_guest: guestId });
  if (error) return err('rpc_error', error.message);
  return ok(data);
}
