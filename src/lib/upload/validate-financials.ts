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
import { currencyOf } from '../currency';

export interface FinancialRecord {
  cc_code: string;
  period: string;
  gl_group: string;
  budget: number;
  actual: number | null;
}

export interface FinancialsContext {
  costCentres: { cc_code: string; status: string; start_date: string; close_date: string | null; entity?: string }[];
  knownGlGroups: string[];
  /** Periods that already have published actuals */
  publishedPeriods: string[];
  /** "YYYY-MM|ENTITY" pairs with published actuals ("|ALL" = legacy combined row); finer than publishedPeriods */
  publishedKeys?: string[];
  /** Current calendar month (YYYY-MM); actuals cannot be posted after it */
  currentPeriod: string;
  /**
   * Cost centres that already have lines in each period. Because an upload replaces
   * whole periods, a file must cover all of them or it would silently delete their figures.
   */
  existingCcsByPeriod?: Record<string, string[]>;
}

/**
 * Totals for one period and one legal entity. Entities keep separate books in
 * their own currency, so they are summarised and reconciled separately.
 */
export interface PeriodSummary {
  period: string;
  /** IN / US / UK, or 'ALL' when no entity map was supplied */
  entity: string;
  currency: string;
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

/**
 * Whole paise as BigInt. Lines are below MAX_AMOUNT (1e15 paise, exact in a double), and
 * summing them as BigInt keeps period totals exact however many rows a file has; the
 * period total itself is then held below MAX_AMOUNT by validateFinancials.
 */
const toCents = (n: number) => BigInt(Math.round(n * 100));
const MAX_CENTS = BigInt(MAX_AMOUNT) * 100n;

type EntityOf = (cc: string) => string;

/** Totals keyed by "period|entity". */
function periodTotals(records: FinancialRecord[], entityOf: EntityOf = () => 'ALL') {
  const by = new Map<string, { period: string; entity: string; rows: number; ccs: Set<string>; budget: bigint; actual: bigint; hasActual: boolean }>();
  for (const r of records) {
    const entity = entityOf(r.cc_code);
    const key = `${r.period}|${entity}`;
    const p = by.get(key) ?? { period: r.period, entity, rows: 0, ccs: new Set<string>(), budget: 0n, actual: 0n, hasActual: false };
    p.rows++;
    p.ccs.add(r.cc_code);
    p.budget += toCents(r.budget);
    if (r.actual !== null) {
      p.actual += toCents(r.actual);
      p.hasActual = true;
    }
    by.set(key, p);
  }
  return by;
}

const absBig = (n: bigint) => (n < 0n ? -n : n);

/** One summary per period and entity (sorted). Pass entityOf to split by legal entity. */
export function summarizePeriods(records: FinancialRecord[], entityOf?: EntityOf): PeriodSummary[] {
  const by = periodTotals(records, entityOf);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, p]) => ({
      period: p.period,
      entity: p.entity,
      currency: p.entity === 'ALL' ? '' : currencyOf(p.entity),
      rows: p.rows,
      costCentres: p.ccs.size,
      budgetTotal: Number(p.budget) / 100,
      actualTotal: p.hasActual ? Number(p.actual) / 100 : null,
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
    if (budget === null) err('Budget', 'REQUIRED', 'Budget is required — enter 0 if there is no budget (a blank would wipe it).');
    else if (Number.isNaN(budget)) err('Budget', 'INVALID_AMOUNT', `Budget "${v.Budget}" is not a number.`);
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
      // An amount already rejected on its own row is left out of the period totals
      budget: budget === null || Number.isNaN(budget) || Math.abs(budget) >= MAX_AMOUNT ? 0 : budget,
      actual: actual === null || Number.isNaN(actual) ? null : Math.abs(actual) >= MAX_AMOUNT ? 0 : actual,
    });
  }

  // Completeness rules apply per period AND legal entity: each entity closes its own books,
  // so a file replaces only the entities it contains for each period (a late US file does
  // not need to repeat India's lines).
  const entityOf: EntityOf = (cc) => ccs.get(cc)?.entity ?? 'ALL';
  const scopeLabel = (period: string, entity: string) => (entity === 'ALL' ? period : `${period} (${entity})`);
  const scopes = new Map<string, { period: string; entity: string; withActual: number; blankRows: number[] }>();
  for (const r of records) {
    if (!r.period) continue;
    const entity = entityOf(r.cc_code);
    const key = `${r.period}|${entity}`;
    const p = scopes.get(key) ?? { period: r.period, entity, withActual: 0, blankRows: [] };
    if (r.actual === null) p.blankRows.push(r.row);
    else p.withActual++;
    scopes.set(key, p);
  }
  const publishedKeys = ctx.publishedKeys ? new Set(ctx.publishedKeys) : null;
  const publishedPeriods = new Set(ctx.publishedPeriods);
  const isPublished = (period: string, entity: string) =>
    publishedKeys
      ? publishedKeys.has(`${period}|${entity}`) || publishedKeys.has(`${period}|ALL`) || (entity === 'ALL' && publishedPeriods.has(period))
      : publishedPeriods.has(period);
  for (const p of scopes.values()) {
    const label = scopeLabel(p.period, p.entity);
    if (p.withActual > 0 && p.blankRows.length > 0) {
      for (const row of p.blankRows.slice(0, 20))
        errors.push({ row, column: 'Actual', code: 'MISSING_ACTUAL', message: `${label} has actuals on other rows — enter 0 instead of leaving Actual blank.` });
    }
    if (p.withActual === 0 && isPublished(p.period, p.entity))
      errors.push({ row: null, column: 'Actual', code: 'WOULD_REMOVE_ACTUALS', message: `${label} already has published actuals; this budget-only file would remove them. Include the actuals for ${label}.` });
  }

  // Period totals (per entity) must fit the same limit as a trial-balance total, or the
  // batch could never be reconciled and published.
  const withPeriod = records.filter((r) => r.period);
  const totals = periodTotals(withPeriod, entityOf);
  for (const t of totals.values()) {
    if (absBig(t.budget) >= MAX_CENTS || absBig(t.actual) >= MAX_CENTS) {
      errors.push({ row: null, column: null, code: 'PERIOD_TOTAL_TOO_LARGE', message: `The total for ${scopeLabel(t.period, t.entity)} is too large to reconcile. Check for a pasted account number or a missing decimal point.` });
    }
  }

  // Each upload replaces the period for every entity it contains: refuse a file that would
  // silently delete figures of that entity's other cost centres.
  for (const t of totals.values()) {
    const missing = (ctx.existingCcsByPeriod?.[t.period] ?? [])
      .filter((cc) => (t.entity === 'ALL' || entityOf(cc) === t.entity) && !t.ccs.has(cc))
      .sort();
    if (missing.length) {
      const label = scopeLabel(t.period, t.entity);
      const list = missing.slice(0, 10).join(', ') + (missing.length > 10 ? ` and ${missing.length - 10} more` : '');
      errors.push({
        row: null,
        column: 'CC_Code',
        code: 'INCOMPLETE_PERIOD',
        message: `${label} already has figures for ${missing.length} cost centre(s) not in this file (${list}). An upload replaces the whole month for each entity it contains, so include every cost centre of that entity for ${t.period} (use 0 where there is nothing to report).`,
      });
    }
  }

  return { records: records.map(({ row: _row, ...r }) => r), errors, warnings };
}
