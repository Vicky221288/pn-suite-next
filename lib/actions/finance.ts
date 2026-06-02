'use server';
import { z } from 'zod';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { getRoleContext } from '@/lib/auth/context';
import { defineAction } from './wrapper';
import { ActionError, type ActionResult, err, ok } from './types';

/**
 * M6 — finance back-office. Expense WRITES go through the wrapper → a single atomic
 * RPC (rpcOwnsCompletion); each RPC self-authorizes on auth.uid() (+ capability).
 * Expense approval REUSES the M1b primitive (request_type='expense'); on approval
 * the expense posts a DEBIT to the SHARED finance_ledger via write_ledger.
 * FINANCE FIREWALL: nothing here touches resolve_gst / invoices / the revenue path.
 * collections_ageing is a READ over existing invoices (money figures gated).
 */
async function rpcWrite<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501' || /forbidden/.test(error.message)) throw new ActionError('forbidden', 'Not permitted.');
    if (error.code === 'P0002') throw new ActionError('not_found', error.message);
    if (error.code === '23505' || /already_decided/.test(error.message)) throw new ActionError('conflict', 'Already decided by this approver.');
    if (error.code === '22023' || error.code === '23514') throw new ActionError('conflict', error.message);
    throw new ActionError('rpc_error', error.message);
  }
  return data as T;
}
const auth = (ctx: { orgId?: string | null }) => !!ctx.orgId;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DOMAIN = z.enum(['hall', 'stays', 'catering', 'core']);

export const upsertExpenseCategory = defineAction({
  name: 'finance.expense_category_upsert',
  input: z.object({ name: z.string().min(1).max(120), categoryId: z.string().uuid().optional() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('upsert_expense_category', { p_org: ctx.orgId, p_name: i.name, p_category_id: i.categoryId ?? null, p_actor_id: ctx.userId }),
});

export const recordExpense = defineAction({
  name: 'finance.expense_record',
  input: z.object({
    amount: z.number().positive(), expenseDate: DATE,
    categoryId: z.string().uuid().optional(), vendorId: z.string().uuid().optional(), payeeName: z.string().max(200).optional(),
    supplyType: z.string().max(40).optional(), inputGstAmount: z.number().nonnegative().optional(),
    sourceDomain: DOMAIN.default('core'), notes: z.string().max(1000).optional(), expenseId: z.string().uuid().optional(),
  }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('record_expense', {
    p_org: ctx.orgId, p_amount: i.amount, p_expense_date: i.expenseDate, p_category_id: i.categoryId ?? null, p_vendor_id: i.vendorId ?? null,
    p_payee_name: i.payeeName ?? null, p_supply_type: i.supplyType ?? null, p_input_gst_amount: i.inputGstAmount ?? null,
    p_source_domain: i.sourceDomain, p_notes: i.notes ?? null, p_expense_id: i.expenseId ?? null, p_actor_id: ctx.userId,
  }),
});

export const submitExpense = defineAction({
  name: 'finance.expense_submit',
  input: z.object({ expenseId: z.string().uuid(), requiredApprovals: z.number().int().min(1).default(1) }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('submit_expense', { p_org: ctx.orgId, p_expense_id: i.expenseId, p_required_approvals: i.requiredApprovals, p_requested_by_user: ctx.userId, p_actor_id: ctx.userId }),
});

export const decideExpense = defineAction({
  name: 'finance.expense_decide',
  input: z.object({ expenseId: z.string().uuid(), decision: z.enum(['approve', 'reject']) }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('decide_expense', { p_org: ctx.orgId, p_expense_id: i.expenseId, p_decision: i.decision, p_actor_id: ctx.userId }),
});

export const markExpensePaid = defineAction({
  name: 'finance.expense_paid',
  input: z.object({ expenseId: z.string().uuid() }),
  rpcOwnsCompletion: true, authorize: auth,
  run: (ctx, i) => rpcWrite('mark_expense_paid', { p_org: ctx.orgId, p_expense_id: i.expenseId, p_actor_id: ctx.userId }),
});

/** Collections ageing — read over invoices; RPC gates money figures by pnl.view_margin. */
export async function getCollectionsAgeing(asOf?: string): Promise<ActionResult<unknown>> {
  const ctx = await getRoleContext();
  if (!ctx?.orgId) return err('unauthenticated', 'Sign in with an org.');
  const supabase = await createUserClient();
  const args: Record<string, unknown> = { p_org: ctx.orgId };
  if (asOf) args.p_as_of = asOf;
  const { data, error } = await supabase.rpc('collections_ageing', args);
  if (error) return err('rpc_error', error.message);
  return ok(data);
}
