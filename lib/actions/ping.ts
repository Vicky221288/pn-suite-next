'use server';
import { z } from 'zod';
import { defineAction } from './wrapper';

/**
 * The smallest possible action — the canonical example of the wrapper+RPC
 * contract, and the B0 exit-criterion probe ("audit util fires on a test
 * write"). Calling it produces two audit_log rows (attempted → completed)
 * linked by parent_audit_id, scoped to the caller's org.
 *
 * It performs no DB mutation itself (B1 supplies the first real atomic RPC);
 * the "write" being exercised here is the audit trail itself.
 */
export const pingAudit = defineAction({
  name: 'system.ping',
  input: z.object({ note: z.string().max(140).optional() }),
  // No authorize gate: any authenticated user may ping. (B2 adds capabilities.)
  run: async (ctx, input) => {
    return {
      pong: true,
      at: new Date().toISOString(),
      orgId: ctx.orgId,
      note: input.note ?? null,
    };
  },
  entity: () => ({ type: 'system' }),
});
