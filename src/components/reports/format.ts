/** Display formatting for the report pages (pure). */

const cache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, digits: number) {
  const key = `${locale}|${digits}`;
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }));
  return cache.get(key)!;
}

/** Amount in an entity's own currency: Indian grouping for INR (or unknown), western otherwise. */
export function fmtMoney(n: number | null | undefined, currency?: string | null, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return nf(!currency || currency === 'INR' ? 'en-IN' : 'en-US', digits).format(n);
}

const PCT = new Intl.NumberFormat('en-IN', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const PLAIN_PCT = new Intl.NumberFormat('en-IN', { style: 'percent', maximumFractionDigits: 0 });

/** Signed variance percentage, "—" when there is no budget. */
export const fmtPct = (p: number | null) => (p === null || !Number.isFinite(p) ? '—' : PCT.format(p));
/** Coverage percentage (unsigned, whole number). */
export const fmtShare = (p: number | null) => (p === null ? '—' : PLAIN_PCT.format(p));
export const fmtCount = (n: number) => nf('en-IN', 0).format(n);

/** "2026-10-24 07:40:12" -> "2026-10-24 07:40" */
export const shortTs = (ts: string | null | undefined) => (ts ? ts.slice(0, 16) : '—');
