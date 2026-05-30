/**
 * IST (Asia/Kolkata) date utilities — the single source of truth for "today",
 * date keys, and time formatting across PN.
 *
 * Why this exists (AUDIT-2.0 F-DATA-02): the legacy build computed "today" with
 * `new Date().toISOString().slice(0,10)`, which yields a UTC date — wrong for
 * 00:00–05:30 IST, corrupting occupancy, check-in matching, and hold windows.
 * Every date here is anchored to Asia/Kolkata.
 *
 * Reimplemented cleanly from the rhs-crm-next convention (REUSE-ANALYSIS #10 —
 * "LIFT verbatim"), including the manual time formatting that avoids the
 * Node-vs-V8 AM/PM SSR hydration mismatch.
 */

export const IST_TZ = 'Asia/Kolkata';

/** Parts of a wall-clock instant rendered in IST. */
function istParts(date: Date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '00' : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Today's calendar date in IST as 'YYYY-MM-DD'. The F-DATA-02 fix. */
export function todayIST(now: Date = new Date()): string {
  const p = istParts(now);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 'YYYY-MM-DD' for any instant, in IST. */
export function dateKeyIST(date: Date): string {
  const p = istParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * Time formatted as 'h:mm AM/PM' in IST — built manually (not via toLocaleString
 * with 'en-IN') to avoid the SSR/client hydration mismatch on the AM/PM marker.
 * Used for the "as of HH:MM IST" widget timestamp convention.
 */
export function formatISTTime(date: Date = new Date()): string {
  const p = istParts(date);
  const period = p.hour < 12 ? 'AM' : 'PM';
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${pad(p.minute)} ${period}`;
}

/** "as of 3:45 PM IST" — the standard widget freshness stamp (OP MODEL §8). */
export function asOfIST(date: Date = new Date()): string {
  return `as of ${formatISTTime(date)} IST`;
}

/** UTC instant range [start, endExclusive) covering an IST calendar day. */
export function istDayBoundsUtc(dateKey: string = todayIST()): { start: Date; end: Date } {
  // IST is UTC+05:30, fixed (no DST). Midnight IST = 18:30 UTC the previous day.
  const [y, m, d] = dateKey.split('-').map(Number);
  const startUtcMs = Date.UTC(y!, m! - 1, d!, 0, 0, 0) - IST_OFFSET_MS;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + DAY_MS) };
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
