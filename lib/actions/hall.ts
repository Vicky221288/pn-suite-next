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
    if (error.code === '22023') throw new ActionError('conflict', error.message);
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}
const auth = (ctx: { orgId?: string | null }) => !!ctx.orgId;

// ── (1) contracts ────────────────────────────────────────────────────────────
export const generateContract = defineAction({
  name: 'hall.contract_generate',
  input: z.object({ bookingId: z.string().uuid(), terms: z.string().max(8000).optional(), clauses: z.array(z.string()).optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('generate_contract', { p_org: ctx.orgId, p_booking_id: i.bookingId, p_terms: i.terms ?? null, p_clauses: i.clauses ? JSON.stringify(i.clauses) : '[]', p_actor_id: ctx.userId }),
});
export const sendContract = defineAction({
  name: 'hall.contract_send', input: z.object({ contractId: z.string().uuid() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('send_contract', { p_org: ctx.orgId, p_contract_id: i.contractId, p_actor_id: ctx.userId }),
});
export const signContract = defineAction({
  name: 'hall.contract_sign', input: z.object({ contractId: z.string().uuid(), signedByName: z.string().min(1).max(200), signedMethod: z.string().max(40).default('click') }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('sign_contract', { p_org: ctx.orgId, p_contract_id: i.contractId, p_signed_by_name: i.signedByName, p_signed_method: i.signedMethod, p_actor_id: ctx.userId }),
});

// ── (2) payment milestones ─────────────────────────────────────────────────────
export const setPaymentSchedule = defineAction({
  name: 'hall.payment_schedule', input: z.object({ bookingId: z.string().uuid(), advanceAmount: z.number().nonnegative() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_payment_schedule', { p_org: ctx.orgId, p_booking_id: i.bookingId, p_advance_amount: i.advanceAmount, p_actor_id: ctx.userId }),
});
export const markMilestonePaid = defineAction({
  name: 'hall.milestone_paid', input: z.object({ milestoneId: z.string().uuid(), amount: z.number().nonnegative().optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('mark_milestone_paid', { p_org: ctx.orgId, p_milestone_id: i.milestoneId, p_amount: i.amount ?? null, p_actor_id: ctx.userId }),
});

// ── (3) staff roster ───────────────────────────────────────────────────────────
export const assignEventStaff = defineAction({
  name: 'hall.staff_assign', input: z.object({ eventId: z.string().uuid(), staffId: z.string().uuid(), role: z.string().max(80).optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('assign_event_staff', { p_org: ctx.orgId, p_event_id: i.eventId, p_staff_id: i.staffId, p_role: i.role ?? null, p_actor_id: ctx.userId }),
});
export const setEventStaffStatus = defineAction({
  name: 'hall.staff_status', input: z.object({ eventStaffId: z.string().uuid(), status: z.enum(['assigned', 'confirmed', 'checked_in', 'no_show']) }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_event_staff_status', { p_org: ctx.orgId, p_event_staff_id: i.eventStaffId, p_status: i.status, p_actor_id: ctx.userId }),
});

// ── (4) checklists ─────────────────────────────────────────────────────────────
export const createEventChecklist = defineAction({
  name: 'hall.checklist_create',
  input: z.object({ eventId: z.string().uuid(), title: z.string().min(1).max(200), assignedStaffId: z.string().uuid().optional(), items: z.array(z.object({ label: z.string().min(1).max(200), requiresPhoto: z.boolean().default(false) })).default([]) }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('create_event_checklist', { p_org: ctx.orgId, p_event_id: i.eventId, p_title: i.title, p_assigned_staff_id: i.assignedStaffId ?? null, p_items: i.items.map((x) => ({ label: x.label, requires_photo: x.requiresPhoto })), p_actor_id: ctx.userId }),
});
export const completeChecklistItem = defineAction({
  name: 'hall.checklist_complete', input: z.object({ itemId: z.string().uuid(), photoRef: z.string().max(500).optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('complete_checklist_item', { p_org: ctx.orgId, p_item_id: i.itemId, p_photo_ref: i.photoRef ?? null, p_actor_id: ctx.userId }),
});

// ── (5) vendor coordination ────────────────────────────────────────────────────
export const assignEventVendor = defineAction({
  name: 'hall.vendor_assign',
  input: z.object({ eventId: z.string().uuid(), vendorId: z.string().uuid(), serviceType: z.string().min(1).max(80), amount: z.number().nonnegative().default(0), commission: z.number().nonnegative().default(0), notes: z.string().max(1000).optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('assign_event_vendor', { p_org: ctx.orgId, p_event_id: i.eventId, p_vendor_id: i.vendorId, p_service_type: i.serviceType, p_amount: i.amount, p_commission: i.commission, p_notes: i.notes ?? null, p_actor_id: ctx.userId }),
});
export const setEventVendorStatus = defineAction({
  name: 'hall.vendor_status', input: z.object({ eventVendorId: z.string().uuid(), status: z.enum(['proposed', 'confirmed', 'paid']) }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('set_event_vendor_status', { p_org: ctx.orgId, p_event_vendor_id: i.eventVendorId, p_status: i.status, p_actor_id: ctx.userId }),
});

// ── (6) revenue analytics (read; RPC gates revenue by capability) ──────────────
export async function getHallAnalytics(): Promise<ActionResult<unknown>> {
  const ctx = await getRoleContext();
  if (!ctx?.orgId) return err('unauthenticated', 'Sign in with an org.');
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc('hall_analytics', { p_org: ctx.orgId });
  if (error) return err('rpc_error', error.message);
  return ok(data);
}
