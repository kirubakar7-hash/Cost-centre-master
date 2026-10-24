/**
 * "Allocations received": recharges from shared-service cost centres to the
 * cost centre being viewed. Read through withUser(), so the alloc_read policy
 * limits rows to the caller's visible cost centres.
 *
 * Allocations are informational: they are not part of the CC's actuals
 * (ccp.financials) and are never added to them.
 */
import type { Tx } from './db/core';
import { fiscalYear } from './fiscal';

export interface AllocationReceived {
  source_cc: string;
  source_alias: string;
  /** Basis for the As-of month (or the latest month of the year to date that has one). */
  basis: string;
  month: number;
  ytd: number;
}

/** One row per source cost centre: month and fiscal-year-to-date amounts as of `asOf` (YYYY-MM). */
export async function allocationsReceived(tx: Tx, code: string, asOf: string): Promise<AllocationReceived[]> {
  const fy = fiscalYear(asOf);
  const rows = await tx.query<{ source_cc: string; source_alias: string | null; basis: string; month: string | null; ytd: string | null }>(
    `select a.source_cc,
            c.cc_alias as source_alias,
            (array_agg(a.basis order by a.period desc))[1] as basis,
            sum(a.amount) filter (where a.period = $2) as month,
            sum(a.amount) as ytd
       from ccp.allocations a
       left join ccp.cost_centres c on c.cc_code = a.source_cc
      where a.cc_code = $1 and a.period between $3 and $2
      group by a.source_cc, c.cc_alias
      order by a.source_cc`,
    [code, asOf, fy.start],
  );
  return rows.map((r) => ({
    source_cc: r.source_cc,
    source_alias: r.source_alias ?? '',
    basis: r.basis,
    month: r.month === null ? 0 : Number(r.month),
    ytd: r.ytd === null ? 0 : Number(r.ytd),
  }));
}

export function allocationTotals(rows: AllocationReceived[]) {
  return rows.reduce((t, r) => ({ month: t.month + r.month, ytd: t.ytd + r.ytd }), { month: 0, ytd: 0 });
}
