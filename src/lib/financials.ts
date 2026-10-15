/**
 * Financial read model for "My Cost Centres". Every query runs inside
 * withUser(), so Postgres RLS limits rows to the caller's cost centres —
 * these functions never filter by user themselves and cannot leak data.
 */
import type { Tx } from './db/core';
import { fiscalYear, fyPeriods, variance } from './fiscal';

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export interface Totals {
  monthBudget: number;
  monthActual: number;
  ytdBudget: number;
  ytdActual: number;
  fyBudget: number;
  /** Full-year outturn = YTD actual + budget for the remaining months of the FY */
  outturn: number;
  ytdVariance: number;
  ytdVariancePct: number | null;
  flagged: boolean;
}

export interface CcSummary extends Totals {
  cc_code: string;
  cc_alias: string;
  bu: string;
  department: string;
  entity: string;
  status: string;
  owner_name: string | null;
}

export interface CcDetail {
  cc_code: string; cc_alias: string; entity: string; bu: string; department: string; type: string;
  status: string; start_date: string; close_date: string | null; keywords: string;
  owner_name: string | null; owner_email: string | null; backup_owner_email: string | null; bu_head_email: string | null;
}

export interface GlLine extends Totals {
  gl_group: string;
}

export interface TrendPoint {
  period: string;
  budget: number;
  actual: number | null;
}

/** Latest period with actuals the caller can see (null if none). */
export async function latestPeriod(tx: Tx): Promise<string | null> {
  const [r] = await tx.query<{ p: string | null }>('select max(period) as p from ccp.financials where actual is not null');
  return r?.p ?? null;
}

/** Periods with actuals the caller can see, newest first. */
export async function availablePeriods(tx: Tx): Promise<string[]> {
  const rows = await tx.query<{ period: string }>(
    'select distinct period from ccp.financials where actual is not null order by period desc',
  );
  return rows.map((r) => r.period);
}

/** True if the caller may open this cost centre's details and financials. */
export async function canView(tx: Tx, code: string): Promise<boolean> {
  const [r] = await tx.query<{ ok: boolean }>('select $1 = any (ccp.visible_cc_codes()) as ok', [code]);
  return Boolean(r?.ok);
}

const TOTALS_SQL = (asOf: number, fyStart: number, fyEnd: number) => `
  sum(f.budget) filter (where f.period = $${asOf})                       as month_budget,
  sum(f.actual) filter (where f.period = $${asOf})                       as month_actual,
  sum(f.budget) filter (where f.period between $${fyStart} and $${asOf}) as ytd_budget,
  sum(f.actual) filter (where f.period between $${fyStart} and $${asOf}) as ytd_actual,
  sum(f.budget) filter (where f.period between $${fyStart} and $${fyEnd}) as fy_budget,
  sum(f.budget) filter (where f.period > $${asOf} and f.period <= $${fyEnd}) as remaining_budget`;

function toTotals(r: Record<string, unknown>): Totals {
  const ytdBudget = num(r.ytd_budget);
  const ytdActual = num(r.ytd_actual);
  const v = variance(ytdBudget, ytdActual);
  return {
    monthBudget: num(r.month_budget),
    monthActual: num(r.month_actual),
    ytdBudget,
    ytdActual,
    fyBudget: num(r.fy_budget),
    outturn: ytdActual + num(r.remaining_budget),
    ytdVariance: v.amount,
    ytdVariancePct: v.pct,
    flagged: v.flagged,
  };
}

/** One row per visible cost centre, as of `asOf` (YYYY-MM). */
export async function listMyCostCentres(tx: Tx, asOf: string): Promise<CcSummary[]> {
  const fy = fiscalYear(asOf);
  const rows = await tx.query<Record<string, unknown>>(
    `select c.cc_code, c.cc_alias, c.bu, c.department, c.entity, c.status, o.owner_name, ${TOTALS_SQL(1, 2, 3)}
       from ccp.cost_centres c
       left join ccp.cc_owners o on o.cc_code = c.cc_code
       left join ccp.financials f on f.cc_code = c.cc_code
      where c.cc_code = any (ccp.visible_cc_codes())
      group by c.cc_code, c.cc_alias, c.bu, c.department, c.entity, c.status, o.owner_name
      order by c.bu, c.cc_code`,
    [asOf, fy.start, fy.end],
  );
  return rows.map((r) => ({
    cc_code: String(r.cc_code), cc_alias: String(r.cc_alias), bu: String(r.bu), department: String(r.department),
    entity: String(r.entity), status: String(r.status), owner_name: (r.owner_name as string) ?? null,
    ...toTotals(r),
  }));
}

/** Master + owner details. Returns null when the caller may not view it (treat as 404). */
export async function getDetail(tx: Tx, code: string): Promise<CcDetail | null> {
  if (!(await canView(tx, code))) return null;
  const [r] = await tx.query<CcDetail>(
    `select c.cc_code, c.cc_alias, c.entity, c.bu, c.department, c.type, c.status,
            c.start_date::text as start_date, c.close_date::text as close_date, c.keywords,
            o.owner_name, o.owner_email, o.backup_owner_email, o.bu_head_email
       from ccp.cost_centres c left join ccp.cc_owners o on o.cc_code = c.cc_code
      where c.cc_code = $1`,
    [code],
  );
  return r ?? null;
}

/** Totals for one cost centre as of `asOf`. */
export async function getTotals(tx: Tx, code: string, asOf: string): Promise<Totals> {
  const fy = fiscalYear(asOf);
  const [r] = await tx.query<Record<string, unknown>>(
    `select ${TOTALS_SQL(2, 3, 4)} from ccp.financials f where f.cc_code = $1`,
    [code, asOf, fy.start, fy.end],
  );
  return toTotals(r ?? {});
}

/** Expense breakdown by GL group (month + YTD + outturn), flagged at ±10% YTD. */
export async function getGlBreakdown(tx: Tx, code: string, asOf: string): Promise<GlLine[]> {
  const fy = fiscalYear(asOf);
  const rows = await tx.query<Record<string, unknown>>(
    `select f.gl_group, ${TOTALS_SQL(2, 3, 4)}
       from ccp.financials f where f.cc_code = $1
      group by f.gl_group order by f.gl_group`,
    [code, asOf, fy.start, fy.end],
  );
  return rows.map((r) => ({ gl_group: String(r.gl_group), ...toTotals(r) }));
}

/** Monthly Budget vs Actual for every month of the fiscal year containing `asOf`. */
export async function getMonthlyTrend(tx: Tx, code: string, asOf: string): Promise<TrendPoint[]> {
  const periods = fyPeriods(asOf);
  const rows = await tx.query<{ period: string; budget: unknown; actual: unknown }>(
    `select period, sum(budget) as budget, sum(actual) as actual
       from ccp.financials where cc_code = $1 and period = any ($2)
      group by period`,
    [code, periods],
  );
  const by = new Map(rows.map((r) => [r.period, r]));
  return periods.map((p) => ({
    period: p,
    budget: num(by.get(p)?.budget),
    actual: p <= asOf ? numOrNull(by.get(p)?.actual) : null,
  }));
}

/** Consolidated totals by BU across everything the caller can see (Mgmt / BU head view). */
export function consolidate(rows: CcSummary[]) {
  const byBu = new Map<string, Totals & { bu: string; count: number; flaggedCount: number }>();
  const add = (acc: Totals, r: Totals) => {
    acc.monthBudget += r.monthBudget; acc.monthActual += r.monthActual;
    acc.ytdBudget += r.ytdBudget; acc.ytdActual += r.ytdActual;
    acc.fyBudget += r.fyBudget; acc.outturn += r.outturn;
  };
  const zero = (): Totals => ({ monthBudget: 0, monthActual: 0, ytdBudget: 0, ytdActual: 0, fyBudget: 0, outturn: 0, ytdVariance: 0, ytdVariancePct: null, flagged: false });
  const total = zero();
  for (const r of rows) {
    const b = byBu.get(r.bu) ?? { ...zero(), bu: r.bu, count: 0, flaggedCount: 0 };
    add(b, r); b.count++; if (r.flagged) b.flaggedCount++;
    byBu.set(r.bu, b);
    add(total, r);
  }
  const finish = <T extends Totals>(t: T): T => {
    const v = variance(t.ytdBudget, t.ytdActual);
    return { ...t, ytdVariance: v.amount, ytdVariancePct: v.pct, flagged: v.flagged };
  };
  return { total: finish(total), byBu: [...byBu.values()].map(finish) };
}
