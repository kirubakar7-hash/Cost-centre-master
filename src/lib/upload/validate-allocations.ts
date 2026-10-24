/**
 * Allocations upload rules (pure — unit tested).
 *
 * File shape: CC_Code (receiving), Period, Source_CC, Amount, Basis.
 * Each upload replaces the allocations for every (period, source cost centre)
 * pair it contains — i.e. one allocation run per shared-service source — so
 * IT and rent recharges can be loaded separately.
 */
import { checkHeaders, type Issue, type ValidationResult } from './validate';
import type { ParsedFile } from './parse';
import { MAX_AMOUNT, normalizePeriod, parseAmount } from './validate-financials';

export interface AllocationRecord {
  cc_code: string;
  period: string;
  source_cc: string;
  amount: number;
  basis: string;
}

export interface AllocationsContext {
  costCentres: { cc_code: string; status: string; entity: string; type: string; close_date: string | null }[];
  /** Current calendar month (YYYY-MM); allocations are actual recharges, so not in the future */
  currentPeriod: string;
  /** Source cost centres' own actual cost per period, for the over-allocation check */
  sourceActuals?: Record<string, number>; // key `${period}|${source_cc}`
}

export interface AllocationRunSummary {
  period: string;
  source_cc: string;
  targets: number;
  total: number;
}

export function validateAllocations(file: ParsedFile, ctx: AllocationsContext): ValidationResult<AllocationRecord> {
  const errors = checkHeaders(file, 'allocations');
  const warnings: Issue[] = [];
  if (errors.length) return { records: [], errors, warnings };

  const ccs = new Map(ctx.costCentres.map((c) => [c.cc_code, c]));
  const seen = new Map<string, number>();
  const warnedDirect = new Set<string>();
  const records: AllocationRecord[] = [];

  for (const { row, values: v } of file.rows) {
    const err = (column: string | null, code: string, message: string) => errors.push({ row, column, code, message });
    const target = (v.CC_Code ?? '').toUpperCase().replace(/\s+/g, '');
    const source = (v.Source_CC ?? '').toUpperCase().replace(/\s+/g, '');
    const period = normalizePeriod(v.Period ?? '');
    const amount = parseAmount(v.Amount ?? '');
    const basis = (v.Basis ?? '').replace(/\s+/g, ' ').trim();
    const t = ccs.get(target);
    const s = ccs.get(source);

    if (!target) err('CC_Code', 'REQUIRED', 'CC_Code (receiving cost centre) is required.');
    else if (!t) err('CC_Code', 'UNKNOWN_CC', `${target} is not in the cost centre master.`);
    if (!source) err('Source_CC', 'REQUIRED', 'Source_CC is required.');
    else if (!s) err('Source_CC', 'UNKNOWN_CC', `${source} is not in the cost centre master.`);
    if (target && source && target === source) err('Source_CC', 'SELF_ALLOCATION', 'A cost centre cannot allocate to itself.');
    if (t && s && t.entity !== s.entity)
      err('Source_CC', 'CROSS_ENTITY', `${source} (${s.entity}) and ${target} (${t.entity}) are in different entities — book this as an intercompany recharge, not an allocation.`);
    if (!period) err('Period', 'INVALID_PERIOD', `Period "${v.Period ?? ''}" is not valid (use YYYY-MM, e.g. 2026-10).`);
    else if (period > ctx.currentPeriod) err('Period', 'FUTURE_ACTUAL', `Allocations cannot be posted to a future period (${period}).`);
    if (amount === null) err('Amount', 'REQUIRED', 'Amount is required.');
    else if (Number.isNaN(amount)) err('Amount', 'INVALID_AMOUNT', `Amount "${v.Amount}" is not a number.`);
    else if (Math.abs(amount) >= MAX_AMOUNT) err('Amount', 'INVALID_AMOUNT', `Amount "${v.Amount}" is too large.`);
    else if (amount === 0) err('Amount', 'ZERO_AMOUNT', 'Amount is 0 — leave the line out instead.');
    if (!basis) err('Basis', 'REQUIRED', 'Basis is required (e.g. "Headcount 42 of 118").');
    else if (basis.length > 120) err('Basis', 'INVALID_BASIS', 'Basis must be 120 characters or fewer.');

    if (t && period) {
      const closeMonth = t.close_date?.slice(0, 7);
      if (closeMonth && period > closeMonth)
        err('CC_Code', 'CC_CLOSED', `${target} was closed on ${t.close_date}; it cannot receive allocations for ${period}.`);
    }
    if (s && s.type === 'Direct' && !warnedDirect.has(source)) {
      warnedDirect.add(source);
      warnings.push({ row, column: 'Source_CC', code: 'DIRECT_SOURCE', message: `${source} is a Direct cost centre — allocations normally come from Shared or Allocated ones.` });
    }
    if (target && source && period) {
      const key = `${target}|${period}|${source}`;
      if (seen.has(key)) err(null, 'DUPLICATE_LINE', `Duplicate allocation ${source} → ${target} for ${period} (also row ${seen.get(key)}).`);
      else seen.set(key, row);
    }

    records.push({
      cc_code: target,
      period: period ?? '',
      source_cc: source,
      amount: amount === null || Number.isNaN(amount) || Math.abs(amount) >= MAX_AMOUNT ? 0 : amount,
      basis,
    });
  }

  // Over-allocation (warning): a source should not recharge more than it cost.
  for (const run of summarizeAllocations(records.filter((r) => r.period && r.source_cc))) {
    const cost = ctx.sourceActuals?.[`${run.period}|${run.source_cc}`];
    if (cost !== undefined && run.total > cost + 0.005) {
      warnings.push({
        row: null,
        column: 'Amount',
        code: 'OVER_ALLOCATED',
        message: `${run.source_cc} allocates ${run.total.toFixed(2)} in ${run.period}, more than its recorded actual cost of ${cost.toFixed(2)}.`,
      });
    }
  }

  return { records, errors, warnings };
}

/** One summary line per allocation run (period × source cost centre). */
export function summarizeAllocations(records: AllocationRecord[]): AllocationRunSummary[] {
  const by = new Map<string, { period: string; source_cc: string; targets: Set<string>; cents: bigint }>();
  for (const r of records) {
    const key = `${r.period}|${r.source_cc}`;
    const run = by.get(key) ?? { period: r.period, source_cc: r.source_cc, targets: new Set<string>(), cents: 0n };
    run.targets.add(r.cc_code);
    run.cents += BigInt(Math.round(r.amount * 100));
    by.set(key, run);
  }
  return [...by.values()]
    .sort((a, b) => a.period.localeCompare(b.period) || a.source_cc.localeCompare(b.source_cc))
    .map((r) => ({ period: r.period, source_cc: r.source_cc, targets: r.targets.size, total: Number(r.cents) / 100 }));
}
