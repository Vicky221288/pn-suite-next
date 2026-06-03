import type { LucideIcon } from 'lucide-react';
import {
  Sunrise, Workflow, CalendarDays, Users, MessageSquareText, PartyPopper,
  BedDouble, CalendarCheck2, DoorOpen, Sparkles, ReceiptText, LineChart,
  BookOpenText, ClipboardList, Package, FileSignature, CookingPot, ShoppingCart, Receipt,
  CalendarClock, IdCard, ListChecks, BadgeIndianRupee, Wallet, Boxes, BarChart3,
} from 'lucide-react';

export interface NavItem { label: string; href: string; icon: LucideIcon }
export interface NavGroup { label: string; items: NavItem[] }

/**
 * Operational IA for PN Suite NXT — grouped by domain so nothing is buried; a
 * manager reaches any function in one or two clicks. Only top-level surfaces
 * appear here; detail routes (/enquiries/[id], /hall/bookings/[id], …) are reached
 * from their lists. Enumerated from the live app/(app) routes — no invented screens.
 */
export const NAV: NavGroup[] = [
  { label: 'Command', items: [
    { label: 'Today', href: '/today', icon: Sunrise },
  ] },
  { label: 'Pipeline', items: [
    { label: 'Enquiries', href: '/enquiries', icon: Workflow },
    { label: 'Calendar & holds', href: '/calendar', icon: CalendarDays },
  ] },
  { label: 'Guests', items: [
    { label: 'Guests', href: '/guests', icon: Users },
    { label: 'CRM templates', href: '/crm', icon: MessageSquareText },
  ] },
  { label: 'Hall', items: [
    { label: 'Hall', href: '/hall', icon: PartyPopper },
  ] },
  { label: 'Stays', items: [
    { label: 'Rooms', href: '/stays', icon: BedDouble },
    { label: 'Reservations', href: '/stays/reservations', icon: CalendarCheck2 },
    { label: 'Front desk', href: '/stays/frontdesk', icon: DoorOpen },
    { label: 'Housekeeping', href: '/stays/housekeeping', icon: Sparkles },
    { label: 'Folio', href: '/stays/folio', icon: ReceiptText },
    { label: 'Stays reporting', href: '/stays/reporting', icon: LineChart },
  ] },
  { label: 'Catering', items: [
    { label: 'Menu & recipes', href: '/catering/menu', icon: BookOpenText },
    { label: 'Enquiries & quotes', href: '/catering/enquiries', icon: ClipboardList },
    { label: 'Packages', href: '/catering/packages', icon: Package },
    { label: 'BEO', href: '/catering/beo', icon: FileSignature },
    { label: 'Production / KOT', href: '/catering/production', icon: CookingPot },
    { label: 'Purchase orders', href: '/catering/purchase-orders', icon: ShoppingCart },
    { label: 'Invoice', href: '/catering/invoice', icon: Receipt },
  ] },
  { label: 'Workforce & ops', items: [
    { label: 'Scheduling', href: '/scheduling', icon: CalendarClock },
    { label: 'Staff', href: '/staff', icon: IdCard },
    { label: 'Tasks & incidents', href: '/ops', icon: ListChecks },
  ] },
  { label: 'Revenue & admin', items: [
    { label: 'Pricing', href: '/pricing', icon: BadgeIndianRupee },
    { label: 'Finance', href: '/finance', icon: Wallet },
    { label: 'Inventory', href: '/inventory', icon: Boxes },
    { label: 'Reports', href: '/reports', icon: BarChart3 },
  ] },
];

/** The most-specific matching nav href for a pathname (so /stays ≠ /stays/reservations). */
export function activeHref(pathname: string): string | null {
  let best: string | null = null;
  for (const g of NAV) for (const it of g.items) {
    if (pathname === it.href || pathname.startsWith(it.href + '/')) {
      if (!best || it.href.length > best.length) best = it.href;
    }
  }
  return best;
}
