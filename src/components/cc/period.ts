import { isPeriod } from '@/lib/fiscal';

/**
 * Resolve the "As of" period from the query string. Only a well-formed period
 * that the caller actually has actuals for is honoured; otherwise `fallback`
 * (the latest month every visible entity has closed — see latestPeriod), else the
 * newest available period. With no actuals published at all, falls back to the
 * current calendar month so budgets still show.
 */
export function resolveAsOf(requested: unknown, periods: string[], fallback?: string | null): string {
  if (typeof requested === 'string' && isPeriod(requested) && periods.includes(requested)) return requested;
  if (fallback && periods.includes(fallback)) return fallback;
  if (periods.length > 0) return periods[0];
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
