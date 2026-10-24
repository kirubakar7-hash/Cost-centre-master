/**
 * Display helpers shared by the "My Cost Centres" pages and charts.
 * Pure functions only (safe in server and client components).
 *
 * Amounts carry no currency symbol: the page says which currency a block is
 * in ("All amounts in INR"), and amounts in different currencies are never
 * added together. Pass the currency to get its digit grouping — Indian
 * grouping (12,34,567 · 1.8L · 1.1Cr) for INR, western grouping (1,234,567 ·
 * 180K · 1.1M) otherwise. Without a currency, Indian grouping is used.
 */

const localeOf = (currency?: string) => (!currency || currency === 'INR' ? 'en-IN' : 'en-US');

const formatters = new Map<string, { amount: Intl.NumberFormat; signed: Intl.NumberFormat; compact: Intl.NumberFormat }>();
function fmt(currency?: string) {
  const locale = localeOf(currency);
  let f = formatters.get(locale);
  if (!f) {
    f = {
      amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
      signed: new Intl.NumberFormat(locale, { maximumFractionDigits: 0, signDisplay: 'exceptZero' }),
      compact: new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    };
    formatters.set(locale, f);
  }
  return f;
}

const PCT = new Intl.NumberFormat('en-IN', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

/** Whole-number amount: 12,34,567 (INR) / 1,234,567 (others) */
export const fmtAmount = (n: number, currency?: string) => fmt(currency).amount.format(Math.round(n));
/** Signed whole-number amount: +12,345 / −12,345 */
export const fmtSigned = (n: number, currency?: string) => fmt(currency).signed.format(Math.round(n));
/** Signed percentage to 1 decimal: +12.3% (null → em dash, e.g. zero budget) */
export const fmtPct = (p: number | null) => (p === null || !Number.isFinite(p) ? '—' : PCT.format(p));
/** Axis ticks: 1.8L / 1.1Cr (INR) or 180K / 1.1M (others) */
export const fmtCompact = (n: number, currency?: string) => fmt(currency).compact.format(n);

/** Red flag text — brand red in light mode, a lighter red in dark mode for contrast. */
export const FLAG_TEXT = 'text-accent dark:text-[#ff6b70]';

/** Over/under direction of a flagged variance (positive = overspend). */
export function flagDirection(amount: number): 'over' | 'under' {
  return amount > 0 ? 'over' : 'under';
}

/** "24 Oct 2026, 14:05 UTC" — fixed, locale-independent rendering of an ISO timestamp. */
export function fmtTimestampUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
