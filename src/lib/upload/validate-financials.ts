/**
 * Budget & Actuals upload rules (pure — unit tested).
 *
 * File shape: CC_Code, Period, GL_Group, Budget, Actual. One file may hold
 * several periods (e.g. a month of actuals, or a full-year budget). Each
 * upload REPLACES every financial line for every period it contains, so a
 * corrected file can simply be re-uploaded.
 *   - Actual blank  = budget-only line (future month)
 *   - A period with any actuals must have an Actual on every row (use 0)
 */
import { checkHeaders, type Issue, type ValidationResult } from './validate';
import type { ParsedFile } from './parse';

export interface FinancialRecord {
  cc_code: string;
  period: string;
  gl_group: string;
  budget: number;
  actual: number | null;
}

export interface FinancialsContext {
  costCentres: { cc_code: string; status: string; start_date: string; close_date: string | null }[];
  knownGlGroups: string[];
  /** Periods that already have published actuals */
  publishedPeriods: string[];
  /** Current calendar month (YYYY-MM); actuals cannot be posted after it */
  currentPeriod: string;
}

export interface PeriodSummary {
  period: string;
  rows: number;
  costCentres: number;
  budgetTotal: number;
  actualTotal: number | null; // null = budget-only period
}

/**
 * Largest accepted amount (exclusive), per line and per trial-balance total. Keeps values
 * exact to the paisa in JS and well inside numeric(18,2) — beyond it Postgres raised a raw
 * "numeric field overflow" (500) when the trial balance was entered, leaving a stuck batch.
 */
export const MAX_AMOUNT = 1e13;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Accepts 2026-10, 2026-10-01 (Excel date), Oct-2026, Oct 2026. */
export function normalizePeriod(input: string): string | null {
  const s = input.trim().toLowerCase();
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (m) {
    const month = Number(m[2]);
    return month >= 1 && month <= 12 ? `${m[1]}-${String(month).padStart(2, '0')}` : null;
  }
  m = s.match(/^([a-z]{3})[a-z]*[\s\-/]+(\d{4})$/);
  if (m && MONTHS.includes(m[1])) return `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`;
  return null;
}

/** Parses 1,23,456.78 / (1,234) / -1234 / ₹ 1,234. Blank -> null; bad -> NaN. Rounded to 2 dp. */
export function parseAmount(input: string): number | null {
  let s = (input ?? '').trim();
  if (!s) return null;
  let neg = false;
  s = s.replace(/[,\s₹$£€]/g, '').replace(/^(INR|USD|GBP)/i, '');
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return Number.NaN;
  const n = roundMoney(Number(s));
  return neg ? -n : n;
}

/**
 * Round to 2 dp, half away from zero (as Postgres numeric does). Shifting the
 * decimal point via the exponent avoids float artefacts: 1.005 * 100 is
 * 100.49999999999999, which Math.round would take down to 1.00.
 */
export function roundMoney(n: number): number {
  const abs = Math.abs(n);
  const str = String(abs);
  const r = Math.round(str.includes('e') ? abs * 100 : Number(`${str}e2`)) / 100;
  return n < 0 && r !== 0 ? -r : r;
}

/** Whole paise. Totals are summed as integers so the trial-balance comparison is exact at any file size. */
const toCents = (n: number) => Math.round(n * 100);

export function summarizePeriods(records: FinancialRecord[]): PeriodSummary[] {
  const by = new Map<string, { rows: number; ccs: Set<string>; budget: number; actual: number; hasActual: boolean }>();
  for (const r of records) {
    const p = by.get(r.period) ?? { rows: 0, ccs: new Set<string>(), budget: 0, actual: 0, hasActual: false };
    p.rows++;
    p.ccs.add(r.cc_code);
    p.budget += toCents(r.budget);
    if (r.actual !== null) {
      p.actual += toCents(r.actual);
      p.hasActual = true;
    }
    by.set(r.period, p);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, p]) => ({
      period,
      rows: p.rows,
      costCentres: p.ccs.size,
      budgetTotal: p.budget / 100,
      actualTotal: p.hasActual ? p.actual / 100 : null,
    }));
}

export function validateFinancials(file: ParsedFile, ctx: FinancialsContext): ValidationResult<FinancialRecord> {
  const errors = checkHeaders(file, 'financials');
  const warnings: Issue[] = [];
  if (errors.length) return { records: [], errors, warnings };

  const ccs = new Map(ctx.costCentres.map((c) => [c.cc_code, c]));
  const knownGl = new Set(ctx.knownGlGroups.map((g) => g.toLowerCase()));
  const warnedGl = new Set<string>();
  // GL groups match case-insensitively; store one spelling per group (the existing one, else
  // the first in the file) so "employee costs" does not become a separate line in reports.
  const glSpelling = new Map(ctx.knownGlGroups.map((g) => [g.toLowerCase(), g]));
  const seen = new Map<string, number>();
  const records: (FinancialRecord & { row: number })[] = [];

  for (const { row, values: v } of file.rows) {
    const err = (column: string | null, code: string, message: string) => errors.push({ row, column, code, message });
    const code = (v.CC_Code ?? '').toUpperCase().replace(/\s+/g, '');
    const period = normalizePeriod(v.Period ?? '');
    const glRaw = (v.GL_Group ?? '').replace(/\s+/g, ' ').trim();
    if (glRaw && !glSpelling.has(glRaw.toLowerCase())) glSpelling.set(glRaw.toLowerCase(), glRaw);
    const gl = glSpelling.get(glRaw.toLowerCase()) ?? glRaw;
    const budget = parseAmount(v.Budget ?? '');
    const actual = parseAmount(v.Actual ?? '');
    const cc = ccs.get(code);

    if (!code) err('CC_Code', 'REQUIRED', 'CC_Code is required.');
    else if (!cc) err('CC_Code', 'UNKNOWN_CC', `${code} is not in the cost centre master.`);
    if (!period) err('Period', 'INVALID_PERIOD', `Period "${v.Period ?? ''}" is not valid (use YYYY-MM, e.g. 2026-10).`);
    if (!gl) err('GL_Group', 'REQUIRED', 'GL_Group is required.');
    else if (gl.length > 60) err('GL_Group', 'INVALID_GL', 'GL_Group must be 60 characters or fewer.');
    if (Number.isNaN(budget)) err('Budget', 'INVALID_AMOUNT', `Budget "${v.Budget}" is not a number.`);
    else if (budget !== null && Math.abs(budget) >= MAX_AMOUNT) err('Budget', 'INVALID_AMOUNT', `Budget "${v.Budget}" is too large.`);
    if (Number.isNaN(actual)) err('Actual', 'INVALID_AMOUNT', `Actual "${v.Actual}" is not a number.`);
    else if (actual !== null && Math.abs(actual) >= MAX_AMOUNT) err('Actual', 'INVALID_AMOUNT', `Actual "${v.Actual}" is too large.`);

    if (cc && period) {
      const closeMonth = cc.close_date?.slice(0, 7);
      if (closeMonth && period > closeMonth && (actual ?? 0) !== 0)
        err('Period', 'CC_CLOSED', `${code} was closed on ${cc.close_date}; it cannot have actuals for ${period}.`);
      if (period < cc.start_date.slice(0, 7))
        warnings.push({ row, column: 'Period', code: 'BEFORE_START', message: `${period} is before ${code} started (${cc.start_date}).` });
    }
    if (period && actual !== null && !Number.isNaN(actual) && period > ctx.currentPeriod)
      err('Actual', 'FUTURE_ACTUAL', `Actuals cannot be posted to a future period (${period}).`);

    if (code && period && gl) {
      const key = `${code}|${period}|${gl.toLowerCase()}`;
      if (seen.has(key)) err(null, 'DUPLICATE_LINE', `Duplicate line ${code} / ${period} / ${gl} (also row ${seen.get(key)}).`);
      else seen.set(key, row);
    }
    if (gl && !knownGl.has(gl.toLowerCase()) && !warnedGl.has(gl.toLowerCase())) {
      warnedGl.add(gl.toLowerCase());
      warnings.push({ row, column: 'GL_Group', code: 'NEW_GL_GROUP', message: `"${gl}" is a new GL group — check the Tally mapping.` });
    }

    records.push({
      row,
      cc_code: code,
      period: period ?? '',
      gl_group: gl,
      budget: budget === null || Number.isNaN(budget) ? 0 : budget,
      actual: actual === null || Number.isNaN(actual) ? null : actual,
    });
  }

  // Period-level completeness rules
  const periods = new Map<string, { withActual: number; blankRows: number[] }>();
  for (const r of records) {
    if (!r.period) continue;
    const p = periods.get(r.period) ?? { withActual: 0, blankRows: [] };
    if (r.actual === null) p.blankRows.push(r.row);
    else p.withActual++;
    periods.set(r.period, p);
  }
  const published = new Set(ctx.publishedPeriods);
  for (const [period, p] of periods) {
    if (p.withActual > 0 && p.blankRows.length > 0) {
      for (const row of p.blankRows.slice(0, 20))
        errors.push({ row, column: 'Actual', code: 'MISSING_ACTUAL', message: `Period ${period} has actuals on other rows — enter 0 instead of leaving Actual blank.` });
    }
    if (p.withActual === 0 && published.has(period))
      errors.push({ row: null, column: 'Actual', code: 'WOULD_REMOVE_ACTUALS', message: `Period ${period} already has published actuals; this budget-only file would remove them. Include the actuals for ${period}.` });
  }

  return { records: records.map(({ row: _row, ...r }) => r), errors, warnings };
}
