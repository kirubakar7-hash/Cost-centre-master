import { fmtAmount, type AllocationRun } from './types';

/** One row per allocation run (period × source cost centre) in an allocations upload. */
export function AllocationRunsTable({ runs }: { runs: AllocationRun[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-gray-50 text-xs text-muted dark:bg-gray-800">
          <tr>
            <th className="px-3 py-2">Period</th>
            <th className="px-3">Source cost centre</th>
            <th className="px-3 text-right">Receiving CCs</th>
            <th className="px-3 text-right">Total allocated</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={`${r.period}|${r.source_cc}`} className="border-t border-gray-100 dark:border-gray-700">
              <td className="px-3 py-1.5 font-medium">{r.period}</td>
              <td className="px-3 font-mono">{r.source_cc}</td>
              <td className="px-3 text-right">{r.targets}</td>
              <td className="px-3 text-right">{fmtAmount(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-muted">
        Publishing replaces the allocations of each source cost centre for these periods. Amounts are in the entity&apos;s own currency.
      </p>
    </div>
  );
}
