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
 *   - catering.view_cost (food cost + margin)          → Owner / PM (via pnl.view_margin)
 *                                                         + Catering Lead, their domain (W1b)
 */
export const CAP = {
  BOOKING_CONFIRM: 'booking.confirm',
  RECORD_DELETE: 'record.delete',
  PNL_VIEW_MARGIN: 'pnl.view_margin',
  DISCOUNT_APPROVE: 'discount.approve',
  SETTLEMENT_PROCESS: 'settlement.process',
  CATERING_VIEW_COST: 'catering.view_cost',
  ROSTER_MANAGE: 'roster.manage', // M1a — build/publish rosters, assign staff to shifts
  STAFF_MANAGE: 'staff.manage', // M1b — edit HR fields + set the org geofence
  APPROVAL_DECIDE: 'approval.decide', // M1b — approve/reject approval requests (leave; M6 expense)
  OPS_MANAGE: 'ops.manage', // M2 — create/assign tasks, resolve incidents, manage + generate checklist templates
  CRM_MANAGE: 'crm.manage', // M3 — guest interactions/special-dates/templates + manual B3 sends + review requests
} as const;

export type Capability = (typeof CAP)[keyof typeof CAP];

/**
 * Catering food-cost + margin visibility (W1b): Owner/PM hold pnl.view_margin;
 * the Catering Lead holds catering.view_cost for THEIR domain's kitchen P&L.
 * Enforced server-side in the quote_summary RPC (either capability suffices).
 */
export function canSeeCateringCost(caps: readonly string[]): boolean {
  return caps.includes(CAP.PNL_VIEW_MARGIN) || caps.includes(CAP.CATERING_VIEW_COST);
}

/** Display roles → their capability sets. Capabilities are what's enforced. */
export const ROLE_CAPABILITIES: Record<string, Capability[]> = {
  owner: [CAP.BOOKING_CONFIRM, CAP.RECORD_DELETE, CAP.PNL_VIEW_MARGIN, CAP.DISCOUNT_APPROVE, CAP.SETTLEMENT_PROCESS, CAP.ROSTER_MANAGE, CAP.STAFF_MANAGE, CAP.APPROVAL_DECIDE, CAP.OPS_MANAGE, CAP.CRM_MANAGE],
  property_manager: [CAP.BOOKING_CONFIRM, CAP.PNL_VIEW_MARGIN, CAP.DISCOUNT_APPROVE, CAP.SETTLEMENT_PROCESS, CAP.ROSTER_MANAGE, CAP.STAFF_MANAGE, CAP.APPROVAL_DECIDE, CAP.OPS_MANAGE, CAP.CRM_MANAGE],
  catering_lead: [CAP.CATERING_VIEW_COST, CAP.ROSTER_MANAGE, CAP.OPS_MANAGE, CAP.CRM_MANAGE], // their domain's kitchen P&L + scheduling + ops + CRM
  hall_manager: [CAP.ROSTER_MANAGE, CAP.OPS_MANAGE, CAP.CRM_MANAGE], // event-day + hall staffing + ops + CRM
  stays_manager: [CAP.ROSTER_MANAGE, CAP.OPS_MANAGE, CAP.CRM_MANAGE], // front-desk / housekeeping + ops + CRM
  operative: [],
};
