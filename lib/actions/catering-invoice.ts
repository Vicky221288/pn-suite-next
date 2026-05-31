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

const LineSchema = z.object({
  stream: z.enum(['hall', 'rooms_fnb', 'catering']),
  description: z.string().max(200).optional(),
  taxableValue: z.number().nonnegative().optional(),
  unitPrice: z.number().nonnegative().optional(),
  actualCount: z.number().nonnegative().optional(),
  beoId: z.string().uuid().optional(),
  sourceRef: z.string().max(120).optional(),
});

/** One consolidated multi-rate invoice over the shared Event. */
export const generateConsolidatedInvoice = defineAction({
  name: 'invoice.generate',
  input: z.object({ eventId: z.string().uuid(), lines: z.array(LineSchema).min(1) }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('generate_consolidated_invoice', {
    p_org: ctx.orgId, p_event_id: input.eventId, p_actor_id: ctx.userId,
    p_lines: input.lines.map((l) => ({
      stream: l.stream, description: l.description ?? null, taxable_value: l.taxableValue ?? null,
      unit_price: l.unitPrice ?? null, actual_count: l.actualCount ?? null, beo_id: l.beoId ?? null, source_ref: l.sourceRef ?? null,
    })),
  }),
});

/** Settle — post revenue per stream + discharge/forfeit the deposit. Owner/PM only. */
export const settleInvoice = defineAction({
  name: 'invoice.settle',
  input: z.object({ invoiceId: z.string().uuid(), depositResolution: z.enum(['discharge', 'forfeit']).default('discharge') }),
  rpcOwnsCompletion: true,
  authorize: (ctx) => !!ctx.orgId,
  run: (ctx, input) => rpcWrite('settle_invoice', { p_org: ctx.orgId, p_invoice_id: input.invoiceId, p_deposit_resolution: input.depositResolution, p_actor_id: ctx.userId }),
});

/** Read an invoice + its lines (RLS-scoped). */
export async function getInvoice(invoiceId: string): Promise<ActionResult<unknown>> {
  const ctx = await getRoleContext();
  if (!ctx?.orgId) return err('unauthenticated', 'Sign in with an org.');
  if (!z.string().uuid().safeParse(invoiceId).success) return err('validation_error', 'Bad invoice id.');
  const supabase = await createUserClient();
  const { data: invoice, error: e1 } = await supabase.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (e1) return err('rpc_error', e1.message);
  if (!invoice) return err('not_found', 'Invoice not found.');
  const { data: lines } = await supabase.from('invoice_lines').select('*').eq('invoice_id', invoiceId).order('stream');
  return ok({ invoice, lines: lines ?? [] });
}
