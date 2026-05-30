/**
 * The action-layer contract. Every mutation in PN returns an ActionResult<T>.
 * (Lifted in spirit from rhs-crm-next; cleaned up — validation is zod, not
 * hand-rolled, and there is no unused "side effect tags" array.)
 */

/** Stable, UI-mappable error codes. Extend as the domain grows. */
export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'validation_error'
  | 'not_found'
  | 'conflict' // e.g. double-booking guard rejected the write (B1)
  | 'rpc_error'
  | 'unknown';

export type ActionOk<T> = {
  ok: true;
  data: T;
  /** id of the terminal audit row (completed), for traceability. */
  auditId?: string;
};

export type ActionErr = {
  ok: false;
  error: ErrorCode;
  /** human-readable, safe to surface in a toast. */
  message: string;
  /** field-level details for validation errors. */
  details?: Record<string, string[]>;
};

export type ActionResult<T> = ActionOk<T> | ActionErr;

export const ok = <T>(data: T, auditId?: string): ActionOk<T> => ({ ok: true, data, auditId });

export const err = (
  error: ErrorCode,
  message: string,
  details?: Record<string, string[]>,
): ActionErr => ({ ok: false, error, message, details });

/**
 * Throw from an action's `run` to surface a typed, UI-mappable failure (e.g. an
 * RPC that rejected with 'slot_taken'). The wrapper turns it into the matching
 * ActionErr + a parent-linked 'failed' audit row. Anything else thrown becomes
 * a generic 'rpc_error'.
 */
export class ActionError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ActionError';
  }
}
