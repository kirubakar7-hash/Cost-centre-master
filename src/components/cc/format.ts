/**
 * Display helpers shared by the "My Cost Centres" pages and charts.
 * Pure functions only (safe in server and client components).
 * Amounts have no currency symbol because entities report in different currencies.
 */

const AMOUNT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const SIGNED = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0, signDisplay: 'exceptZero' });
const PCT = new Intl.NumberFormat('en-IN', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});
const COMPACT = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

/** Whole-number amount, Indian digit grouping: 12,34,567 */
export const fmtAmount = (n: number) => AMOUNT.format(Math.round(n));
/** Signed whole-number amount: +12,345 / −12,345 */
export const fmtSigned = (n: number) => SIGNED.format(Math.round(n));
/** Signed percentage to 1 decimal: +12.3% (null → em dash, e.g. zero budget) */
export const fmtPct = (p: number | null) => (p === null || !Number.isFinite(p) ? '—' : PCT.format(p));
/** Axis ticks: 1.8L / 1.1Cr */
export const fmtCompact = (n: number) => COMPACT.format(n);

/** Red flag text — brand red in light mode, a lighter red in dark mode for contrast. */
export const FLAG_TEXT = 'text-accent dark:text-[#ff6b70]';

/** Over/under direction of a flagged variance (positive = overspend). */
export function flagDirection(amount: number): 'over' | 'under' {
  return amount > 0 ? 'over' : 'under';
}
