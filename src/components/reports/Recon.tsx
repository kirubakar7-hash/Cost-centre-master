import type { ReconLine, TrialBalanceEntry } from '@/lib/reports';
import { fmtMoney, shortTs } from './format';
import { RED, ROW, TABLE, THEAD } from './ui';

const label = (l: ReconLine) => (l.entity && l.entity !== 'ALL' ? `${l.period} ${l.entity}` : l.period);

/**
 * Compact reconciliation status for a table cell: a count of reconciled
 * period/entity lines and the period range, then only the lines that do not
 * reconcile (every line is listed on the batch page and in the export).
 */
export function ReconSummary({ lines }: { lines: ReconLine[] }) {
  if (lines.length === 0) return <span className="text-muted">—</span>;
  const bad = lines.filter((l) => !l.matched);
  const periods = [...new Set(lines.map((l) => l.period))].sort();
  const entities = [...new Set(lines.map((l) => l.entity).filter((e): e is string => Boolean(e) && e !== 'ALL'))].sort();
  const full = lines
    .map((l) => `${label(l)}: actuals ${fmtMoney(l.actualTotal, l.currency)} · TB ${fmtMoney(l.tbTotal, l.currency)} · diff ${fmtMoney(l.difference, l.currency)}`)
    .join('\n');
  return (
    <div className="text-xs tabular-nums" title={full}>
      {bad.length === 0 ? (
        <div className="whitespace-nowrap font-semibold text-brand dark:text-brand-light">
          ✓ {lines.length} of {lines.length} reconciled
        </div>
      ) : (
        <div className={`whitespace-nowrap font-semibold ${RED}`}>
          ✗ {bad.length} of {lines.length} not reconciled
        </div>
      )}
      <div className="text-muted">
        {periods.length > 1 ? `${periods[0]} – ${periods[periods.length - 1]}` : periods[0]}
        {entities.length ? ` · ${entities.join(', ')}` : ''}
      </div>
      {bad.map((l) => (
        <div key={label(l)} className={`whitespace-nowrap ${RED}`}>
          {label(l)}: {l.tbTotal === null ? 'no TB entered' : `diff ${fmtMoney(l.difference, l.currency)}`}
        </div>
      ))}
    </div>
  );
}

/** Full reconciliation table, with who entered each trial-balance total. */
export function ReconTableFull({ lines, entries = [] }: { lines: ReconLine[]; entries?: TrialBalanceEntry[] }) {
  const entered = new Map(entries.map((e) => [`${e.period}|${e.entity ?? ''}`, e]));
  const find = (l: ReconLine) => entered.get(`${l.period}|${l.entity ?? ''}`) ?? entered.get(`${l.period}|`) ?? entered.get(`${l.period}|ALL`);
  return (
    <div className="overflow-x-auto">
      <table className={`${TABLE} min-w-[760px]`}>
        <thead className={THEAD}>
          <tr>
            <th className="py-1 pr-3">Period</th>
            <th className="pr-3">Entity</th>
            <th className="pr-3 text-right">CC actuals</th>
            <th className="pr-3 text-right">Trial balance</th>
            <th className="pr-3 text-right">Difference</th>
            <th className="pr-3">Status</th>
            <th>TB entered by (UTC)</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {lines.map((l) => {
            const e = find(l);
            return (
              <tr key={label(l)} className={ROW}>
                <td className="py-1.5 pr-3 font-medium">{l.period}</td>
                <td className="pr-3">
                  {l.entity ?? '—'}
                  {l.currency ? <span className="text-muted"> · {l.currency}</span> : null}
                </td>
                <td className="pr-3 text-right">{fmtMoney(l.actualTotal, l.currency)}</td>
                <td className="pr-3 text-right">{fmtMoney(l.tbTotal, l.currency)}</td>
                <td className={`pr-3 text-right ${l.matched ? '' : `${RED} font-semibold`}`}>{fmtMoney(l.difference, l.currency)}</td>
                <td className="pr-3">
                  {l.tbTotal === null ? (
                    <span className="text-muted">TB not entered</span>
                  ) : l.matched ? (
                    <span className="font-semibold text-brand dark:text-brand-light">✓ Reconciled</span>
                  ) : (
                    <span className={`${RED} font-semibold`}>✗ Does not match</span>
                  )}
                </td>
                <td className="text-xs">{e ? `${e.entered_by} · ${shortTs(e.entered_at)}` : <span className="text-muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
