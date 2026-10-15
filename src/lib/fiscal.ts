/** Fiscal-year helpers. SolidPro FY runs April–March (FY_START_MONTH=4). */
export const FY_START_MONTH = Number(process.env.FY_START_MONTH ?? 4);
export const VARIANCE_THRESHOLD = 0.1; // flag lines over ±10% of budget

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isPeriod = (p: string) => PERIOD_RE.test(p);

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** First and last period of the fiscal year containing `period`. */
export function fiscalYear(period: string): { start: string; end: string; label: string } {
  const [y, m] = period.split('-').map(Number);
  const startYear = m >= FY_START_MONTH ? y : y - 1;
  const start = `${startYear}-${String(FY_START_MONTH).padStart(2, '0')}`;
  const end = addMonths(start, 11);
  const label = FY_START_MONTH === 1 ? `FY ${startYear}` : `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  return { start, end, label };
}

export function fyPeriods(period: string): string[] {
  const { start } = fiscalYear(period);
  return Array.from({ length: 12 }, (_, i) => addMonths(start, i));
}

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Variance = Actual − Budget (positive = overspend). Pct is null when budget is 0. */
export function variance(budget: number, actual: number) {
  const amount = actual - budget;
  const pct = budget === 0 ? null : amount / Math.abs(budget);
  const flagged = pct === null ? actual !== 0 : Math.abs(pct) > VARIANCE_THRESHOLD;
  return { amount, pct, flagged };
}
