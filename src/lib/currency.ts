/**
 * Entity -> reporting currency. Amounts are stored in each entity's own
 * currency (as booked in its Tally company); totals in different currencies
 * are never added together. FX-converted consolidation is a pending decision.
 */
export const ENTITY_CURRENCY: Record<string, string> = { IN: 'INR', US: 'USD', UK: 'GBP' };

export const currencyOf = (entity: string) => ENTITY_CURRENCY[entity] ?? entity;

/** Number format per currency: Indian grouping for INR, western grouping otherwise. */
export function formatAmount(n: number, currency: string): string {
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { maximumFractionDigits: 0 }).format(n);
}

/** Like formatAmount but keeps paise/cents (reconciliation figures must show exact differences). */
export function formatMoney(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat(currency === 'INR' || !currency ? 'en-IN' : 'en-US', { maximumFractionDigits: 2 }).format(n);
}
