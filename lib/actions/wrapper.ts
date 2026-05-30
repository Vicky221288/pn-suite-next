import 'server-only';
import { z } from 'zod';
import { emitAudit, type AuditEvent } from '@/lib/audit/emit';
import { createClient as createUserClient } from '@/lib/supabase/server';
import { type ActionResult, err, ok } from './types';

/**
 * THE WRAPPER — the mandatory template for every PN write (OP MODEL inv. #1).
 *
 * It marries rhs-crm-next's best convention (server-action contract + two-write
 * audit) to the exact thing RHS got wrong (RHS has zero RPCs and a documented
 * orphan-data bug). The wrapper enforces the sequence:
 *
 *   authenticate → validate (zod) → authorize → audit:attempted →
 *   run (an ATOMIC Postgres RPC) → audit:completed | audit:failed
 *
 * The `run` callback MUST perform its writes in a SINGLE atomic unit — i.e. call
 * a Postgres function via `admin.rpc('fn', args)` (built in B1). Multi-step
 * client/server writes are forbidden (the legacy build's #1 failure, AUDIT-2.0).
 *
 * In B0 this is the contract only; B1 supplies the first real RPC and the
 * concurrency proof. The shape below is what every action will fill in.
 */

export interface ActionContext {
  /** authenticated auth user id. */
  userId: string;
  /** tenant scope resolved for this user (B2 fills org resolution; B0 stub). */
  orgId: string | null;
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
}

/**
 * Resolve the current action context (auth user + tenant scope).
 * B0: orgId is resolved by the auth-context stub (single tenant for now).
 * B2: replaces the stub with real org membership resolution.
 */
async function resolveContext(): Promise<ActionContext | null> {
  const supabase = await createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  // B2: resolve org_id from membership. For now, carry it on user metadata if
  // present, else null (system/pre-tenant). Never hardcode a property (inv. #3).
  const orgId = (user.app_metadata?.org_id as string | undefined) ?? null;
  return { userId: user.id, orgId };
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

    // 4. Audit: attempted (BEFORE the mutation).
    const base: Omit<AuditEvent, 'subEvent'> = {
      orgId: ctx.orgId,
      action: config.name,
      actorId: ctx.userId,
      ...config.entity?.(input, null),
    };
    const attemptedId = await emitAudit({ ...base, subEvent: 'attempted' });

    // 5. Run the ATOMIC mutation, then audit the outcome.
    try {
      const output = await config.run(ctx, input);
      const completedId = await emitAudit({
        ...base,
        ...config.entity?.(input, output),
        subEvent: 'completed',
        parentAuditId: attemptedId ?? undefined,
      });
      return ok(output, completedId ?? undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Action failed.';
      await emitAudit({
        ...base,
        subEvent: 'failed',
        parentAuditId: attemptedId ?? undefined,
        errorCode: 'rpc_error',
        errorMessage: message,
      });
      return err('rpc_error', message);
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
