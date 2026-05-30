import 'server-only';
import { z } from 'zod';
import { emitAudit, type AuditEvent } from '@/lib/audit/emit';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { ActionError, type ActionResult, err, ok } from './types';

/**
 * THE WRAPPER — the mandatory template for every PN write (OP MODEL inv. #1).
 *
 * Sequence: authenticate → validate (zod) → authorize → audit:attempted → run
 * (a single ATOMIC Postgres RPC) → audit:completed | audit:failed.
 *
 * Audit split (B1, improves on RHS): the 'attempted' and 'failed' rows are
 * written by the wrapper OUTSIDE the RPC's transaction, so a failed attempt is
 * durably recorded even though the mutation rolled back. The 'completed' row is
 * written INSIDE the RPC's transaction (atomic with the data) when the action
 * sets `rpcOwnsCompletion` — so a 'completed' audit can never outlive a failed
 * write. The wrapper passes the attempted-audit id to `run` via
 * `ctx.auditAttemptedId` so the RPC can parent-link its completed row.
 */

export interface ActionContext {
  /** authenticated auth user id. */
  userId: string;
  /** tenant scope resolved from the caller's SESSION membership (never client input). */
  orgId: string | null;
  /** capabilities the caller holds in that org (OP MODEL §3). */
  capabilities: string[];
  /** id of the 'attempted' audit row — pass into the RPC as p_parent_audit_id. */
  auditAttemptedId: string | null;
}

interface DefineActionConfig<TInput, TOutput> {
  /** stable action name, e.g. 'booking.confirm' — used as the audit action. */
  name: string;
  /** zod schema validating the raw input (fixes RHS's hand-rolled validation). */
  input: z.ZodType<TInput>;
  /** authorization gate. Return true to allow. (B2 wires real capabilities.) */
  authorize?: (ctx: ActionContext, input: TInput) => boolean | Promise<boolean>;
  /** the atomic mutation. MUST be a single transaction (a Postgres RPC). */
  run: (ctx: ActionContext, input: TInput) => Promise<TOutput>;
  /** optional: describe the entity for the audit trail. */
  entity?: (input: TInput, output: TOutput | null) => { type?: string; id?: string };
  /**
   * Set true when the RPC writes its own atomic 'completed' audit row inside its
   * transaction (the B1 pattern). The wrapper then skips its own 'completed'
   * write to avoid double-auditing.
   */
  rpcOwnsCompletion?: boolean;
}

async function resolveContext(): Promise<ActionContext | null> {
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // unauthenticated

  // B2: org + capabilities resolved from the caller's SESSION membership via the
  // RLS-enforced user client — never from client input (the F-SEC-04 fix). A
  // user with no membership gets orgId=null/[] and is rejected by any action
  // whose authorize() requires an org capability.
  const { data } = await supabase
    .from('org_members')
    .select('org_id, capabilities')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  return {
    userId: user.id,
    orgId: (data?.org_id as string | undefined) ?? null,
    capabilities: (data?.capabilities as string[] | undefined) ?? [],
    auditAttemptedId: null,
  };
}

export function defineAction<TInput, TOutput>(config: DefineActionConfig<TInput, TOutput>) {
  return async function action(rawInput: unknown): Promise<ActionResult<TOutput>> {
    // 1. Authenticate.
    const ctx = await resolveContext();
    if (!ctx) return err('unauthenticated', 'You must be signed in.');

    // 2. Validate.
    const parsed = config.input.safeParse(rawInput);
    if (!parsed.success) {
      return err('validation_error', 'Please check the highlighted fields.', flattenZod(parsed.error));
    }
    const input = parsed.data;

    // 3. Authorize.
    if (config.authorize) {
      const allowed = await config.authorize(ctx, input);
      if (!allowed) return err('forbidden', 'You do not have permission to do that.');
    }

    // 4. Audit: attempted (BEFORE the mutation, durable across a rollback).
    const base: Omit<AuditEvent, 'subEvent'> = {
      orgId: ctx.orgId,
      action: config.name,
      actorId: ctx.userId,
      ...config.entity?.(input, null),
    };
    const attemptedId = await emitAudit({ ...base, subEvent: 'attempted' });
    ctx.auditAttemptedId = attemptedId;

    // 5. Run the ATOMIC mutation, then audit the outcome.
    try {
      const output = await config.run(ctx, input);
      if (config.rpcOwnsCompletion) {
        // The RPC already wrote the atomic 'completed' row inside its tx.
        return ok(output, attemptedId ?? undefined);
      }
      const completedId = await emitAudit({
        ...base,
        ...config.entity?.(input, output),
        subEvent: 'completed',
        parentAuditId: attemptedId ?? undefined,
      });
      return ok(output, completedId ?? undefined);
    } catch (e) {
      const isTyped = e instanceof ActionError;
      const message = e instanceof Error ? e.message : 'Action failed.';
      const code = isTyped ? e.code : 'rpc_error';
      await emitAudit({
        ...base,
        subEvent: 'failed',
        parentAuditId: attemptedId ?? undefined,
        errorCode: code,
        errorMessage: message,
      });
      return err(code, message, isTyped ? e.details : undefined);
    }
  };
}

function flattenZod(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_root';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
