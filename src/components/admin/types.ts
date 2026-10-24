export interface Issue { row: number | null; column: string | null; code: string; message: string }
/** One row per period and legal entity (each entity reconciles to its own trial balance). */
export interface PeriodSummary { period: string; entity: string; currency: string; rows: number; costCentres: number; budgetTotal: number; actualTotal: number | null }
export interface ReconLine { period: string; entity: string; currency: string; actualTotal: number; tbTotal: number | null; difference: number | null; matched: boolean }
export interface AllocationRun { period: string; source_cc: string; targets: number; total: number }
export type Kind = 'master' | 'owners' | 'financials' | 'allocations';

/** Key used for trial-balance entry: "YYYY-MM|ENTITY". */
export const tbKey = (p: { period: string; entity: string }) => `${p.period}|${p.entity}`;

export const KIND_LABEL: Record<Kind, string> = {
  master: 'Cost Centre Master',
  owners: 'Owner Mapping',
  financials: 'Budget & Actuals',
  allocations: 'Allocations',
};

export const fmtAmount = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);
