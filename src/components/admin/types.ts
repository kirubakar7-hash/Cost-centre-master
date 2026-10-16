export interface Issue { row: number | null; column: string | null; code: string; message: string }
export interface PeriodSummary { period: string; rows: number; costCentres: number; budgetTotal: number; actualTotal: number | null }
export interface ReconLine { period: string; actualTotal: number; tbTotal: number | null; difference: number | null; matched: boolean }
export type Kind = 'master' | 'owners' | 'financials';

export const KIND_LABEL: Record<Kind, string> = {
  master: 'Cost Centre Master',
  owners: 'Owner Mapping',
  financials: 'Budget & Actuals',
};

export const fmtAmount = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);
