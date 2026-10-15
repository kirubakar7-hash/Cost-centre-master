import { isPeriod } from '@/lib/fiscal';

/**
 * Resolve the "As of" period from the query string. Only a well-formed period
 * that the caller actually has actuals for is honoured; otherwise the latest
 * available period (periods are newest first). With no actuals published at
 * all, falls back to the current calendar month so budgets still show.
 */
export function resolveAsOf(requested: unknown, periods: string[]): string {
  if (typeof requested === 'string' && isPeriod(requested) && periods.includes(requested)) return requested;
  if (periods.length > 0) return periods[0];
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
