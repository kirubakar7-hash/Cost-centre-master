/**
 * Phase 2: Budget & Actuals.
 *  - validate-financials (pure rules for the financials upload)
 *  - fiscal helpers (April–March FY, variance)
 *  - the "My Cost Centres" read model (src/lib/financials.ts) against the seeded
 *    PGlite database, through RLS — including URL-tampering cases.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserOn } from '../src/lib/db/core';
import { GL_GROUPS, SEED_BUDGET_ONLY_PERIODS, SEED_PERIODS } from '../src/lib/db/seed';
import {
  availablePeriods,
  canView,
  consolidate,
  getDetail,
  getGlBreakdown,
  getMonthlyTrend,
  getTotals,
  latestPeriod,
  listMyCostCentres,
  type CcSummary,
  type Totals,
} from '../src/lib/financials';
import { addMonths, fiscalYear, fyPeriods, isPeriod, periodLabel, variance, VARIANCE_THRESHOLD } from '../src/lib/fiscal';
import type { ParsedFile } from '../src/lib/upload/parse';
import { TEMPLATES } from '../src/lib/upload/templates';
import type { Issue } from '../src/lib/upload/validate';
import {
  normalizePeriod,
  parseAmount,
  roundMoney,
  summarizePeriods,
  validateFinancials,
  type FinancialRecord,
  type FinancialsContext,
} from '../src/lib/upload/validate-financials';
import { ARUN, KAVYA, MEENA, RAJESH, VIKRAM, asSuper, freshDb, type Driver, type Tx } from './helpers';

const FIN_HEADERS = TEMPLATES.financials.columns.map((c) => c.key);
type Values = Record<string, string>;

function file(headers: string[], rows: Values[]): ParsedFile {
  return {
    headers,
    rows: rows.map((v, i) => ({ row: i + 2, values: Object.fromEntries(headers.map((h) => [h, v[h] ?? ''])) })),
  };
}

const line = (over: Values = {}): Values => ({
  CC_Code: 'IN-ENG-101', Period: '2026-10', GL_Group: 'Employee Costs', Budget: '1800000', Actual: '1765000', ...over,
});

const CTX: FinancialsContext = {
  costCentres: [
    { cc_code: 'IN-ENG-101', status: 'Active', start_date: '2019-04-01', close_date: null },
    { cc_code: 'IN-ENG-102', status: 'Active', start_date: '2020-04-01', close_date: null },
    { cc_code: 'IN-ENG-150', status: 'Active', start_date: '2026-08-15', close_date: null },
    { cc_code: 'IN-ENG-199', status: 'Inactive', start_date: '2018-04-01', close_date: '2025-03-31' },
  ],
  knownGlGroups: [...GL_GROUPS],
  publishedPeriods: [...SEED_PERIODS],
  currentPeriod: '2026-10',
};

const fin = (...rows: Values[]) => validateFinancials(file(FIN_HEADERS, rows), CTX);
const pick = (issues: Issue[]) => issues.map(({ row, column, code }) => ({ row, column, code }));
const codesOf = (...rows: Values[]) => pick(fin(...rows).errors).map((e) => e.code);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
describe('normalizePeriod', () => {
  it('accepts YYYY-MM, an Excel date, and month names', () => {
    expect(normalizePeriod('2026-10')).toBe('2026-10');
    expect(normalizePeriod(' 2026-10 ')).toBe('2026-10');
    expect(normalizePeriod('2026-1')).toBe('2026-01');
    expect(normalizePeriod('2026-10-01')).toBe('2026-10'); // date cell from Excel
    expect(normalizePeriod('Oct-2026')).toBe('2026-10');
    expect(normalizePeriod('oct 2026')).toBe('2026-10');
    expect(normalizePeriod('October 2026')).toBe('2026-10');
    expect(normalizePeriod('SEPT-2026')).toBe('2026-09');
    expect(normalizePeriod('Jan/2027')).toBe('2027-01');
    expect(normalizePeriod('Dec 2026')).toBe('2026-12');
  });
  it('rejects invalid months and unknown formats', () => {
    for (const bad of ['', '2026-13', '2026-00', '2026-13-01', 'Foo-2026', 'Oct-26', '10/2026', '2026/10', 'Q3 2026', '202610', 'October']) {
      expect(normalizePeriod(bad), bad).toBeNull();
    }
  });
});

describe('parseAmount', () => {
  it('parses Indian and western grouping, currency symbols and accounting negatives', () => {
    expect(parseAmount('1,23,456.78')).toBe(123456.78);
    expect(parseAmount('123,456.78')).toBe(123456.78);
    expect(parseAmount('1234')).toBe(1234);
    expect(parseAmount('-1234.5')).toBe(-1234.5);
    expect(parseAmount('(1,234)')).toBe(-1234);
    expect(parseAmount('(₹ 1,234.50)')).toBe(-1234.5);
    expect(parseAmount('₹ 1,000')).toBe(1000);
    expect(parseAmount('₹1,000')).toBe(1000);
    expect(parseAmount('INR 2,500')).toBe(2500);
    expect(parseAmount('$ 99.90')).toBe(99.9);
    expect(parseAmount(' 0 ')).toBe(0);
  });
  it('blank -> null (no actual yet), junk -> NaN', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount(undefined as unknown as string)).toBeNull();
    for (const bad of ['abc', '12x', '1.2.3', '--5', '1e5', '-', '()', '12 34 abc', 'N/A']) {
      expect(parseAmount(bad), bad).toBeNaN();
    }
  });
  it('rounds to 2 dp, half away from zero (like Postgres numeric), without float artefacts', () => {
    expect(parseAmount('1.234')).toBe(1.23);
    expect(parseAmount('10.006')).toBe(10.01);
    expect(parseAmount('1.005')).toBe(1.01); // 1.005 * 100 = 100.49999999999999 in floating point
    expect(parseAmount('1.015')).toBe(1.02);
    expect(parseAmount('-1.005')).toBe(-1.01);
    expect(parseAmount('(1.005)')).toBe(-1.01);
    expect(parseAmount('12,34,567.895')).toBe(1234567.9);
  });
  it('roundMoney matches the same rule for numbers', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(-2.675)).toBe(-2.68);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(1e-7)).toBe(0);
    expect(roundMoney(-1e-7)).toBe(0);
    expect(roundMoney(123456789.125)).toBe(123456789.13);
  });
});

// ---------------------------------------------------------------------------
// validateFinancials
// ---------------------------------------------------------------------------
describe('validateFinancials', () => {
  it('a clean file has no errors and records are normalised', () => {
    const r = fin(
      line({ CC_Code: ' in-eng-101 ', Period: 'Oct-2026', GL_Group: '  Employee   Costs ', Budget: '18,00,000', Actual: '17,65,000.50' }),
      line({ GL_Group: 'Travel & Conveyance', Budget: '₹ 1,20,000', Actual: '(1,500)' }), // a credit
      line({ GL_Group: 'Software & Licences', Budget: '260000', Actual: '0' }), // zero, not blank
      line({ Period: '2026-11', Actual: '' }), // budget-only future month
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.records).toEqual<FinancialRecord[]>([
      { cc_code: 'IN-ENG-101', period: '2026-10', gl_group: 'Employee Costs', budget: 1800000, actual: 1765000.5 },
      { cc_code: 'IN-ENG-101', period: '2026-10', gl_group: 'Travel & Conveyance', budget: 120000, actual: -1500 },
      { cc_code: 'IN-ENG-101', period: '2026-10', gl_group: 'Software & Licences', budget: 260000, actual: 0 },
      { cc_code: 'IN-ENG-101', period: '2026-11', gl_group: 'Employee Costs', budget: 1800000, actual: null },
    ]);
  });

  it('GL groups are matched case-insensitively and stored with one spelling', () => {
    const r = fin(
      line({ GL_Group: 'employee costs' }), // existing group -> existing spelling
      line({ CC_Code: 'IN-ENG-102', GL_Group: 'Recruitment' }), // new group: first spelling wins
      line({ CC_Code: 'IN-ENG-101', GL_Group: 'RECRUITMENT' }),
    );
    expect(r.errors).toEqual([]);
    expect(r.records.map((x) => x.gl_group)).toEqual(['Employee Costs', 'Recruitment', 'Recruitment']);
  });

  it('missing required column -> file-level error, no records', () => {
    for (const col of FIN_HEADERS) {
      const r = validateFinancials(file(FIN_HEADERS.filter((h) => h !== col), [line()]), CTX);
      expect(pick(r.errors), col).toEqual([{ row: null, column: col, code: 'MISSING_COLUMN' }]);
      expect(r.records).toEqual([]);
    }
  });

  it('empty file -> file-level error', () => {
    expect(pick(validateFinancials(file(FIN_HEADERS, []), CTX).errors)).toEqual([{ row: null, column: null, code: 'EMPTY_FILE' }]);
  });

  it('unknown or missing cost centre', () => {
    expect(pick(fin(line({ CC_Code: 'IN-ENG-777' })).errors)).toEqual([{ row: 2, column: 'CC_Code', code: 'UNKNOWN_CC' }]);
    expect(pick(fin(line({ CC_Code: '' })).errors)).toEqual([{ row: 2, column: 'CC_Code', code: 'REQUIRED' }]);
  });

  it('invalid period', () => {
    expect(pick(fin(line({ Period: '2026-13' })).errors)).toEqual([{ row: 2, column: 'Period', code: 'INVALID_PERIOD' }]);
    expect(codesOf(line({ Period: '' }))).toEqual(['INVALID_PERIOD']);
    expect(codesOf(line({ Period: 'Q3 2026' }))).toEqual(['INVALID_PERIOD']);
  });

  it('invalid amounts', () => {
    expect(pick(fin(line({ Budget: 'abc' })).errors)).toEqual([{ row: 2, column: 'Budget', code: 'INVALID_AMOUNT' }]);
    expect(pick(fin(line({ Actual: '12x' })).errors)).toEqual([{ row: 2, column: 'Actual', code: 'INVALID_AMOUNT' }]);
    expect(fin(line({ Actual: 'abc' })).errors[0].message).toMatch(/"abc" is not a number/);
  });

  it('missing / overlong GL group', () => {
    expect(pick(fin(line({ GL_Group: ' ' })).errors)).toEqual([{ row: 2, column: 'GL_Group', code: 'REQUIRED' }]);
    expect(pick(fin(line({ GL_Group: 'x'.repeat(61) })).errors)).toEqual([{ row: 2, column: 'GL_Group', code: 'INVALID_GL' }]);
  });

  it('duplicate line (same CC / period / GL, case- and format-insensitive)', () => {
    const r = fin(line(), line({ GL_Group: 'Travel & Conveyance' }), line({ CC_Code: 'in-eng-101', Period: 'Oct-2026', GL_Group: 'employee  COSTS' }));
    expect(pick(r.errors)).toEqual([{ row: 4, column: null, code: 'DUPLICATE_LINE' }]);
    expect(r.errors[0].message).toMatch(/also row 2/);
    // Same GL in another period or for another CC is not a duplicate
    expect(fin(line(), line({ Period: '2026-09' }), line({ CC_Code: 'IN-ENG-102' })).errors.map((e) => e.code)).not.toContain('DUPLICATE_LINE');
  });

  it('MISSING_ACTUAL: a period with actuals must have an Actual on every row (0, not blank)', () => {
    const r = fin(
      line(), // 2026-10 with actual
      line({ GL_Group: 'Travel & Conveyance', Actual: '' }), // blank in a month with actuals
      line({ GL_Group: 'Software & Licences', Actual: '0' }), // zero is fine
      line({ Period: '2026-11', Actual: '' }), // budget-only month is fine
    );
    expect(pick(r.errors)).toEqual([{ row: 3, column: 'Actual', code: 'MISSING_ACTUAL' }]);
    expect(r.errors[0].message).toMatch(/2026-10/);
  });

  it('WOULD_REMOVE_ACTUALS: a budget-only file for a period with published actuals', () => {
    const r = fin(line({ Period: '2026-09', Actual: '' }), line({ Period: '2026-09', GL_Group: 'Travel & Conveyance', Actual: '' }));
    expect(pick(r.errors)).toEqual([{ row: null, column: 'Actual', code: 'WOULD_REMOVE_ACTUALS' }]);
    expect(r.errors[0].message).toMatch(/2026-09/);
    // Re-uploading that period WITH actuals is allowed (it replaces it)
    expect(fin(line({ Period: '2026-09' })).errors).toEqual([]);
    // A budget-only file for an unpublished period is allowed
    expect(fin(line({ Period: '2026-12', Actual: '' })).errors).toEqual([]);
  });

  it('FUTURE_ACTUAL: actuals cannot be posted after the current month', () => {
    expect(pick(fin(line({ Period: '2026-11' })).errors)).toEqual([{ row: 2, column: 'Actual', code: 'FUTURE_ACTUAL' }]);
    expect(codesOf(line({ Period: '2027-04', Actual: '0' }))).toEqual(['FUTURE_ACTUAL']);
    expect(fin(line({ Period: '2026-10' })).errors).toEqual([]); // the current month is allowed
    expect(fin(line({ Period: '2027-03', Actual: '' })).errors).toEqual([]); // future budget is fine
    expect(validateFinancials(file(FIN_HEADERS, [line({ Period: '2026-11' })]), { ...CTX, currentPeriod: '2026-11' }).errors).toEqual([]);
  });

  it('CC_CLOSED: no actuals after an inactive cost centre was closed', () => {
    const closed = (over: Values) => line({ CC_Code: 'IN-ENG-199', Period: '2025-04', ...over });
    expect(pick(fin(closed({ Actual: '5000' })).errors)).toEqual([{ row: 2, column: 'Period', code: 'CC_CLOSED' }]);
    expect(fin(closed({ Actual: '5000' })).errors[0].message).toMatch(/2025-03-31/);
    expect(fin(closed({ Actual: '0' })).errors).toEqual([]);
    expect(fin(closed({ Actual: '' })).errors).toEqual([]);
    expect(fin(closed({ Period: '2025-03', Actual: '5000' })).errors).toEqual([]); // closing month is fine
  });

  it('BEFORE_START is a warning, not an error', () => {
    const r = fin(line({ CC_Code: 'IN-ENG-150', Period: '2026-07' }), line({ CC_Code: 'IN-ENG-150', Period: '2026-08' }));
    expect(r.errors).toEqual([]);
    expect(pick(r.warnings)).toEqual([{ row: 2, column: 'Period', code: 'BEFORE_START' }]);
  });

  it('NEW_GL_GROUP warns once per new GL group (case-insensitive), never for known groups', () => {
    const r = fin(
      line({ GL_Group: 'Recruitment' }),
      line({ CC_Code: 'IN-ENG-102', GL_Group: 'recruitment' }),
      line({ GL_Group: 'employee costs', CC_Code: 'IN-ENG-102' }),
      line({ GL_Group: 'Marketing' }),
      line({ CC_Code: 'IN-ENG-102', GL_Group: 'Marketing' }),
    );
    expect(r.errors).toEqual([]);
    expect(pick(r.warnings)).toEqual([
      { row: 2, column: 'GL_Group', code: 'NEW_GL_GROUP' },
      { row: 5, column: 'GL_Group', code: 'NEW_GL_GROUP' },
    ]);
    expect(r.warnings[0].message).toMatch(/Recruitment/);
  });

  it('reports every problem in one pass', () => {
    const r = fin(line({ CC_Code: 'XX-YYY-000', Period: 'never', Budget: 'lots' }), line(), line());
    expect(pick(r.errors)).toEqual([
      { row: 2, column: 'CC_Code', code: 'UNKNOWN_CC' },
      { row: 2, column: 'Period', code: 'INVALID_PERIOD' },
      { row: 2, column: 'Budget', code: 'INVALID_AMOUNT' },
      { row: 4, column: null, code: 'DUPLICATE_LINE' },
    ]);
  });
});

describe('summarizePeriods', () => {
  const rec = (cc_code: string, period: string, gl_group: string, budget: number, actual: number | null): FinancialRecord => ({
    cc_code, period, gl_group, budget, actual,
  });
  it('totals per period, sorted, with actualTotal null for budget-only periods', () => {
    const s = summarizePeriods([
      rec('IN-ENG-102', '2026-11', 'Employee Costs', 100, null),
      rec('IN-ENG-101', '2026-10', 'Employee Costs', 100.1, 90.05),
      rec('IN-ENG-101', '2026-10', 'Travel & Conveyance', 0.2, 0.1),
      rec('IN-ENG-102', '2026-10', 'Employee Costs', 50, 0),
      rec('IN-ENG-101', '2026-11', 'Employee Costs', 100, null),
      rec('IN-ENG-101', '2026-09', 'Employee Costs', 10, 0),
    ]);
    expect(s).toEqual([
      { period: '2026-09', rows: 1, costCentres: 1, budgetTotal: 10, actualTotal: 0 }, // all-zero actuals are still actuals
      { period: '2026-10', rows: 3, costCentres: 2, budgetTotal: 150.3, actualTotal: 90.15 },
      { period: '2026-11', rows: 2, costCentres: 2, budgetTotal: 200, actualTotal: null },
    ]);
  });
  it('empty input -> no periods', () => {
    expect(summarizePeriods([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fiscal helpers
// ---------------------------------------------------------------------------
describe('fiscal helpers (April–March)', () => {
  it('fiscalYear', () => {
    expect(fiscalYear('2026-02')).toEqual({ start: '2025-04', end: '2026-03', label: 'FY 2025-26' });
    expect(fiscalYear('2026-03')).toEqual({ start: '2025-04', end: '2026-03', label: 'FY 2025-26' });
    expect(fiscalYear('2026-04')).toEqual({ start: '2026-04', end: '2027-03', label: 'FY 2026-27' });
    expect(fiscalYear('2026-09')).toEqual({ start: '2026-04', end: '2027-03', label: 'FY 2026-27' });
    expect(fiscalYear('2099-12').label).toBe('FY 2099-00');
  });
  it('fyPeriods / addMonths / periodLabel / isPeriod', () => {
    expect(fyPeriods('2026-09')).toEqual([...SEED_PERIODS, ...SEED_BUDGET_ONLY_PERIODS]);
    expect(fyPeriods('2027-03')).toEqual(fyPeriods('2026-04'));
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-04', 11)).toBe('2027-03');
    expect(addMonths('2026-04', 0)).toBe('2026-04');
    expect(periodLabel('2026-09')).toBe('Sep 2026');
    expect(fyPeriods('2026-09').map(periodLabel)).toEqual([
      'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026',
      'Oct 2026', 'Nov 2026', 'Dec 2026', 'Jan 2027', 'Feb 2027', 'Mar 2027',
    ]);
    expect(isPeriod('2026-09')).toBe(true);
    for (const bad of ['2026-13', '2026-9', '2026-09-01', '']) expect(isPeriod(bad), bad).toBe(false);
  });
  it('variance: positive = overspend; pct is null when budget is 0', () => {
    expect(variance(100, 120)).toEqual({ amount: 20, pct: 0.2, flagged: true });
    expect(variance(100, 85)).toEqual({ amount: -15, pct: -0.15, flagged: true });
    expect(variance(100, 110)).toEqual({ amount: 10, pct: 0.1, flagged: false }); // exactly 10% is not "over" 10%
    expect(variance(100, 105).flagged).toBe(false);
    expect(variance(0, 0)).toEqual({ amount: 0, pct: null, flagged: false });
    expect(variance(0, 500)).toEqual({ amount: 500, pct: null, flagged: true }); // unbudgeted spend is flagged
    expect(variance(-100, -150).pct).toBe(-0.5);
    expect(VARIANCE_THRESHOLD).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// Read model (seeded data, through RLS)
// ---------------------------------------------------------------------------
describe('financial read model (src/lib/financials.ts)', () => {
  let db: Driver;
  const AS_OF = '2026-09';
  const ALL_CODES: string[] = [];

  beforeAll(async () => {
    db = await freshDb();
    ALL_CODES.push(...(await asSuper<{ cc_code: string }>(db, 'select cc_code from ccp.cost_centres order by cc_code')).map((r) => r.cc_code));
  });
  afterAll(() => db.close());

  const asUser = <T>(email: string, fn: (tx: Tx) => Promise<T>) => withUserOn(db, email, fn);
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

  /** Independent SQL totals for one cost centre (privileged connection, not the read model). */
  async function sqlTotals(code: string) {
    const [r] = await asSuper<Record<string, string | null>>(
      db,
      `select sum(budget) filter (where period = '2026-09')                       as month_budget,
              sum(actual) filter (where period = '2026-09')                       as month_actual,
              sum(budget) filter (where period between '2026-04' and '2026-09')   as ytd_budget,
              sum(actual) filter (where period between '2026-04' and '2026-09')   as ytd_actual,
              sum(budget) filter (where period between '2026-04' and '2027-03')   as fy_budget,
              sum(budget) filter (where period between '2026-10' and '2027-03')   as rest_budget,
              count(distinct period)                                              as periods
         from ccp.financials where cc_code = $1`,
      [code],
    );
    return {
      monthBudget: n(r.month_budget), monthActual: n(r.month_actual), ytdBudget: n(r.ytd_budget), ytdActual: n(r.ytd_actual),
      fyBudget: n(r.fy_budget), restBudget: n(r.rest_budget), periods: n(r.periods),
    };
  }

  const expectTotalsClose = (got: Totals, want: Partial<Totals>) => {
    for (const [k, v] of Object.entries(want)) expect(got[k as keyof Totals] as number, k).toBeCloseTo(v as number, 2);
  };

  it('latestPeriod / availablePeriods for an owner', async () => {
    expect(await asUser(MEENA, latestPeriod)).toBe('2026-09');
    expect(await asUser(MEENA, availablePeriods)).toEqual([...SEED_PERIODS].reverse());
  });

  it('owner: listMyCostCentres returns exactly her two cost centres with correct totals', async () => {
    const rows = await asUser(MEENA, (tx) => listMyCostCentres(tx, AS_OF));
    expect(rows.map((r) => r.cc_code)).toEqual(['IN-ENG-101', 'IN-ENG-102']);
    expect(rows[0]).toMatchObject({ cc_alias: 'Design Chennai', bu: 'Engineering', entity: 'IN', status: 'Active', owner_name: 'Meena Raj' });

    for (const row of rows) {
      const want = await sqlTotals(row.cc_code);
      expect(want.periods).toBe(12); // 6 months of actuals + 6 budget-only months
      expect(want.ytdBudget).toBeGreaterThan(0);
      expectTotalsClose(row, {
        monthBudget: want.monthBudget,
        monthActual: want.monthActual,
        ytdBudget: want.ytdBudget,
        ytdActual: want.ytdActual,
        fyBudget: want.fyBudget, // all 12 months of budget
        outturn: want.ytdActual + want.restBudget, // YTD actual + budget for 2026-10..2027-03
        ytdVariance: want.ytdActual - want.ytdBudget,
      });
      expect(row.ytdVariancePct).toBeCloseTo((want.ytdActual - want.ytdBudget) / want.ytdBudget, 6);
      expect(row.fyBudget).toBeGreaterThan(row.ytdBudget);
      // getTotals (detail page) agrees with the list
      const { cc_code: _c, cc_alias: _a, bu: _b, department: _d, entity: _e, status: _s, owner_name: _o, ...rowTotals } = row;
      expect(await asUser(MEENA, (tx) => getTotals(tx, row.cc_code, AS_OF))).toEqual(rowTotals);
    }
  });

  it('as of an earlier month, YTD stops at that month and later actuals count as outturn budget', async () => {
    const t = await asUser(MEENA, (tx) => getTotals(tx, 'IN-ENG-101', '2026-06'));
    const [r] = await asSuper<Record<string, string>>(
      db,
      `select sum(budget) filter (where period between '2026-04' and '2026-06') as ytd_budget,
              sum(actual) filter (where period between '2026-04' and '2026-06') as ytd_actual,
              sum(budget) filter (where period between '2026-07' and '2027-03') as rest_budget
         from ccp.financials where cc_code = 'IN-ENG-101'`,
    );
    expectTotalsClose(t, { ytdBudget: n(r.ytd_budget), ytdActual: n(r.ytd_actual), outturn: n(r.ytd_actual) + n(r.rest_budget) });
  });

  it('GL breakdown flags exactly the seeded hotspots for IN-ENG-101', async () => {
    const lines = await asUser(MEENA, (tx) => getGlBreakdown(tx, 'IN-ENG-101', AS_OF));
    expect(lines.map((l) => l.gl_group)).toEqual([...GL_GROUPS].sort());
    expect(lines.filter((l) => l.flagged).map((l) => l.gl_group)).toEqual(['Software & Licences', 'Travel & Conveyance']);
    const travel = lines.find((l) => l.gl_group === 'Travel & Conveyance')!;
    expect(travel.ytdVariancePct).toBeGreaterThan(VARIANCE_THRESHOLD); // overspend
    for (const l of lines.filter((x) => !x.flagged)) expect(Math.abs(l.ytdVariancePct!), l.gl_group).toBeLessThanOrEqual(VARIANCE_THRESHOLD);

    // The GL lines add up to the cost-centre totals
    const total = await asUser(MEENA, (tx) => getTotals(tx, 'IN-ENG-101', AS_OF));
    for (const k of ['monthBudget', 'monthActual', 'ytdBudget', 'ytdActual', 'fyBudget', 'outturn'] as const) {
      expect(lines.reduce((s, l) => s + l[k], 0), k).toBeCloseTo(total[k], 2);
    }
  });

  it('IN-ENG-102 flags its under-spend hotspot (Professional Fees)', async () => {
    const lines = await asUser(MEENA, (tx) => getGlBreakdown(tx, 'IN-ENG-102', AS_OF));
    const flagged = lines.filter((l) => l.flagged);
    expect(flagged.map((l) => l.gl_group)).toEqual(['Professional Fees']);
    expect(flagged[0].ytdVariance).toBeLessThan(0);
  });

  it('monthly trend: 12 FY points, actual null after the as-of month', async () => {
    const trend = await asUser(MEENA, (tx) => getMonthlyTrend(tx, 'IN-ENG-101', AS_OF));
    expect(trend.map((p) => p.period)).toEqual(fyPeriods(AS_OF));
    expect(trend).toHaveLength(12);
    const byPeriod = await asSuper<{ period: string; budget: string; actual: string | null }>(
      db, `select period, sum(budget) as budget, sum(actual) as actual from ccp.financials where cc_code = 'IN-ENG-101' group by period`,
    );
    const want = new Map(byPeriod.map((r) => [r.period, r]));
    for (const p of trend) {
      expect(p.budget, p.period).toBeCloseTo(Number(want.get(p.period)!.budget), 2);
      if (p.period <= AS_OF) expect(p.actual, p.period).toBeCloseTo(Number(want.get(p.period)!.actual), 2);
      else expect(p.actual, p.period).toBeNull();
    }
    // As of June: July..Sept actuals exist in the data but are hidden from the trend
    const june = await asUser(MEENA, (tx) => getMonthlyTrend(tx, 'IN-ENG-101', '2026-06'));
    expect(june.filter((p) => p.actual !== null).map((p) => p.period)).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('getDetail returns master + owner details for her own cost centre', async () => {
    const d = await asUser(MEENA, (tx) => getDetail(tx, 'IN-ENG-101'));
    expect(d).toMatchObject({
      cc_code: 'IN-ENG-101', cc_alias: 'Design Chennai', start_date: '2019-04-01', close_date: null,
      owner_name: 'Meena Raj', owner_email: MEENA, bu_head_email: VIKRAM,
    });
    expect(await asUser(MEENA, (tx) => canView(tx, 'IN-ENG-101'))).toBe(true);
  });

  it('URL tampering: an owner gets nothing for a cost centre she does not own', async () => {
    for (const code of ['IN-SAL-501', 'IN-ENG-103', 'IN-SSV-301', 'NOT-A-CODE', "IN-ENG-101' or '1'='1"]) {
      expect(await asUser(MEENA, (tx) => canView(tx, code)), code).toBe(false);
      expect(await asUser(MEENA, (tx) => getDetail(tx, code)), code).toBeNull();
      expect(await asUser(MEENA, (tx) => getGlBreakdown(tx, code, AS_OF)), code).toEqual([]);
      const t = await asUser(MEENA, (tx) => getTotals(tx, code, AS_OF));
      expect([t.monthBudget, t.monthActual, t.ytdBudget, t.ytdActual, t.fyBudget, t.outturn], code).toEqual([0, 0, 0, 0, 0, 0]);
      const trend = await asUser(MEENA, (tx) => getMonthlyTrend(tx, code, AS_OF));
      expect(trend.every((p) => p.budget === 0 && p.actual === null), code).toBe(true);
    }
  });

  it('employee: no cost centres, no periods, nothing by direct code', async () => {
    expect(await asUser(ARUN, (tx) => listMyCostCentres(tx, AS_OF))).toEqual([]);
    expect(await asUser(ARUN, latestPeriod)).toBeNull();
    expect(await asUser(ARUN, availablePeriods)).toEqual([]);
    expect(ALL_CODES).toHaveLength(11);
    for (const code of ALL_CODES) {
      expect(await asUser(ARUN, (tx) => getDetail(tx, code)), code).toBeNull();
      expect(await asUser(ARUN, (tx) => canView(tx, code)), code).toBe(false);
      expect(await asUser(ARUN, (tx) => getGlBreakdown(tx, code, AS_OF)), code).toEqual([]);
    }
  });

  it('BU head sees only Engineering cost centres', async () => {
    const rows = await asUser(VIKRAM, (tx) => listMyCostCentres(tx, AS_OF));
    const codes = rows.map((r) => r.cc_code);
    expect(codes).toEqual(expect.arrayContaining(['IN-ENG-101', 'IN-ENG-102', 'IN-ENG-103', 'US-ENG-201']));
    expect(rows.every((r) => r.bu === 'Engineering')).toBe(true);
    expect(await asUser(VIKRAM, (tx) => getDetail(tx, 'IN-SAL-501'))).toBeNull();
  });

  it('management: consolidate() by BU adds up to the rows and to an independent SQL total', async () => {
    const rows = await asUser(RAJESH, (tx) => listMyCostCentres(tx, AS_OF));
    expect(rows.map((r) => r.cc_code).sort()).toEqual(ALL_CODES);
    const c = consolidate(rows);
    expect(c.byBu.map((b) => b.bu).sort()).toEqual(['Engineering', 'Sales', 'Shared Services']);
    expect(c.byBu).toHaveLength(3);
    expect(c.byBu.reduce((s, b) => s + b.count, 0)).toBe(rows.length);

    const keys = ['monthBudget', 'monthActual', 'ytdBudget', 'ytdActual', 'fyBudget', 'outturn'] as const;
    const sum = (rs: CcSummary[], k: (typeof keys)[number]) => rs.reduce((s, r) => s + r[k], 0);
    for (const k of keys) {
      expect(c.total[k], k).toBeCloseTo(sum(rows, k), 2);
      expect(c.byBu.reduce((s, b) => s + b[k], 0), k).toBeCloseTo(c.total[k], 2);
    }
    for (const b of c.byBu) {
      const mine = rows.filter((r) => r.bu === b.bu);
      expect(b.count, b.bu).toBe(mine.length);
      expect(b.flaggedCount, b.bu).toBe(mine.filter((r) => r.flagged).length);
      for (const k of keys) expect(b[k], `${b.bu} ${k}`).toBeCloseTo(sum(mine, k), 2);
      expect(b.ytdVariance).toBeCloseTo(b.ytdActual - b.ytdBudget, 2);
      expect(b.ytdVariancePct).toBeCloseTo((b.ytdActual - b.ytdBudget) / b.ytdBudget, 6);
    }
    expect(c.total.ytdVariance).toBeCloseTo(c.total.ytdActual - c.total.ytdBudget, 2);

    const [all] = await asSuper<{ ytd_actual: string; fy_budget: string }>(
      db,
      `select sum(actual) filter (where period between '2026-04' and '2026-09') as ytd_actual,
              sum(budget) filter (where period between '2026-04' and '2027-03') as fy_budget from ccp.financials`,
    );
    expect(c.total.ytdActual).toBeCloseTo(Number(all.ytd_actual), 2);
    expect(c.total.fyBudget).toBeCloseTo(Number(all.fy_budget), 2);
  });

  it('consolidate() of nothing is all zeros', () => {
    const c = consolidate([]);
    expect(c.byBu).toEqual([]);
    expect(c.total).toMatchObject({ ytdBudget: 0, ytdActual: 0, ytdVariancePct: null, flagged: false });
  });

  it('Finance sees every cost centre', async () => {
    const rows = await asUser(KAVYA, (tx) => listMyCostCentres(tx, AS_OF));
    expect(rows.map((r) => r.cc_code).sort()).toEqual(ALL_CODES);
  });
});
