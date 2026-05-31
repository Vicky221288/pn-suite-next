/**
 * Capabilities — the atomic unit of authorization (OP MODEL §3: roles are
 * composable capabilities). Stored per membership in org_members.capabilities;
 * enforced both in the DB (RPC self-check + RLS) and in the app gate.
 *
 * Locked decision rights (OP MODEL §12):
 *   - booking.confirm / date hard-block → Owner + Property Manager only
 *   - record.delete                     → Owner only
 *   - pnl.view_margin                   → Owner / PM only (managers operational-only)
 *   - discount.approve (> 10%)          → Owner / PM only
 *   - settlement.process / refund / deposit forfeiture → Owner / PM only (B5)
 */
export const CAP = {
  BOOKING_CONFIRM: 'booking.confirm',
  RECORD_DELETE: 'record.delete',
  PNL_VIEW_MARGIN: 'pnl.view_margin',
  DISCOUNT_APPROVE: 'discount.approve',
  SETTLEMENT_PROCESS: 'settlement.process',
} as const;

export type Capability = (typeof CAP)[keyof typeof CAP];

/** Display roles → their capability sets. Capabilities are what's enforced. */
export const ROLE_CAPABILITIES: Record<string, Capability[]> = {
  owner: [CAP.BOOKING_CONFIRM, CAP.RECORD_DELETE, CAP.PNL_VIEW_MARGIN, CAP.DISCOUNT_APPROVE, CAP.SETTLEMENT_PROCESS],
  property_manager: [CAP.BOOKING_CONFIRM, CAP.PNL_VIEW_MARGIN, CAP.DISCOUNT_APPROVE, CAP.SETTLEMENT_PROCESS],
  hall_manager: [], // operational-only; hold-creation etc. arrive in later waves
  stays_manager: [],
  operative: [],
};
