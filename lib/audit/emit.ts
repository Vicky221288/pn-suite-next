import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Loud audit logging (OP MODEL §10, inv. #2 + #5).
 *
 * The two-write pattern: an action writes `attempted` BEFORE the mutation, then
 * `completed` or `failed` AFTER, linked by `parent_audit_id`. The wrapper
 * (lib/actions/wrapper.ts) orchestrates this so individual actions don't have to.
 *
 * Improvements over the rhs-crm-next original (REUSE-ANALYSIS #3 caveats):
 *   - A purpose-built wide schema (below) instead of jamming fields into a
 *     legacy 10-column table / jsonb.
 *   - "Loud": a failed audit write is NEVER silently swallowed — it is
 *     console.error'd with a [AUDIT-FAILURE] marker so a missing audit trail is
 *     visible in logs/Sentry. The audit write still never throws (it must not
 *     break the mutation it records).
 *   - org_id is first-class (multi-tenant from day one, inv. #3).
 *
 * NOTE (gate-1 / B1): the `audit_log` table is created in the schema phase. Its
 * expected shape is documented in docs/PRE-FLIGHT-5-STEP.md. Until it exists,
 * emit() degrades loudly (logs the event, marks the failure) rather than
 * crashing — so the convention is wired and testable the moment the table lands.
 */

export type AuditSubEvent = 'attempted' | 'completed' | 'failed';

export interface AuditEvent {
  /** tenant scope — required (inv. #3). Null only for pre-tenant system events. */
  orgId: string | null;
  /** the action name, e.g. 'booking.confirm'. */
  action: string;
  subEvent: AuditSubEvent;
  /** auth user id performing the action, if any. */
  actorId: string | null;
  /** entity touched, e.g. { type: 'booking', id } */
  entityType?: string;
  entityId?: string;
  /** links completed/failed back to the attempted row. */
  parentAuditId?: string;
  /** structured, non-PII context. Never log secrets or raw PII here. */
  meta?: Record<string, unknown>;
  /** error code/message when subEvent === 'failed'. */
  errorCode?: string;
  errorMessage?: string;
}

const AUDIT_TABLE = 'audit_log';

/**
 * Write one audit row. Returns the new row id, or null if the write could not
 * be persisted (in which case it is logged LOUDLY). Never throws.
 */
export async function emitAudit(event: AuditEvent): Promise<string | null> {
  const row = {
    org_id: event.orgId,
    action: event.action,
    sub_event: event.subEvent,
    actor_id: event.actorId,
    entity_type: event.entityType ?? null,
    entity_id: event.entityId ?? null,
    parent_audit_id: event.parentAuditId ?? null,
    meta: event.meta ?? null,
    error_code: event.errorCode ?? null,
    error_message: event.errorMessage ?? null,
  };

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from(AUDIT_TABLE)
      .insert(row)
      .select('id')
      .single();

    if (error) {
      // LOUD: a missing audit trail is itself an incident.
      console.error('[AUDIT-FAILURE] could not persist audit row', {
        action: event.action,
        subEvent: event.subEvent,
        supabaseError: error.message,
      });
      return null;
    }
    return (data?.id as string) ?? null;
  } catch (e) {
    console.error('[AUDIT-FAILURE] audit emit threw (env/table not ready?)', {
      action: event.action,
      subEvent: event.subEvent,
      cause: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
