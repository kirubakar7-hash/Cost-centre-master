'use client';
import { fmtAmount, tbKey, type PeriodSummary, type ReconLine } from './types';

/**
 * Totals per period and entity; where there are actuals, the entity's trial-balance
 * input and match status. Amounts are in each entity's own currency.
 */
export function ReconTable({
  periods,
  recon,
  tb,
  onTbChange,
}: {
  periods: PeriodSummary[];
  recon?: ReconLine[];
  tb?: Record<string, string>;
  /** Called with the "YYYY-MM|ENTITY" key */
  onTbChange?: (key: string, value: string) => void;
}) {
  const byKey = new Map((recon ?? []).map((r) => [tbKey(r), r]));
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-gray-50 text-xs text-muted dark:bg-gray-800">
          <tr>
            <th className="px-3 py-2">Period</th>
            <th className="px-3">Entity</th>
            <th className="px-3 text-right">Rows</th>
            <th className="px-3 text-right">CCs</th>
            <th className="px-3 text-right">Budget total</th>
            <th className="px-3 text-right">CC actuals total</th>
            <th className="px-3 text-right">Trial balance total</th>
            <th className="px-3 text-right">Difference</th>
            <th className="px-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => {
            const key = tbKey(p);
            const r = byKey.get(key);
            const budgetOnly = p.actualTotal === null;
            return (
              <tr key={key} className="border-t border-gray-100 dark:border-gray-700">
                <td className="px-3 py-1.5 font-medium">{p.period}</td>
                <td className="px-3 whitespace-nowrap">{p.entity}{p.currency ? <span className="text-xs text-muted"> · {p.currency}</span> : null}</td>
                <td className="px-3 text-right">{p.rows}</td>
                <td className="px-3 text-right">{p.costCentres}</td>
                <td className="px-3 text-right">{fmtAmount(p.budgetTotal)}</td>
                <td className="px-3 text-right">{budgetOnly ? 'Budget only' : fmtAmount(p.actualTotal)}</td>
                <td className="px-3 text-right">
                  {budgetOnly ? (
                    '—'
                  ) : onTbChange ? (
                    <input
                      inputMode="decimal"
                      aria-label={`Trial balance total for ${p.period} ${p.entity}`}
                      value={tb?.[key] ?? ''}
                      onChange={(e) => onTbChange(key, e.target.value)}
                      placeholder="Enter TB total"
                      className="surface w-36 rounded px-2 py-1 text-right"
                    />
                  ) : (
                    fmtAmount(r?.tbTotal)
                  )}
                </td>
                <td className={`px-3 text-right ${r && !r.matched ? 'font-semibold text-accent' : ''}`}>
                  {budgetOnly ? '—' : fmtAmount(r?.difference)}
                </td>
                <td className="px-3">
                  {budgetOnly ? (
                    <span className="text-muted">No TB needed</span>
                  ) : !r || r.tbTotal === null ? (
                    <span className="text-muted">TB not entered</span>
                  ) : r.matched ? (
                    <span className="font-semibold text-brand dark:text-brand-light">✓ Reconciled</span>
                  ) : (
                    <span className="font-semibold text-accent">✗ Does not match</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
