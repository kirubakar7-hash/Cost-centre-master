import type { Issue } from './types';

export function IssueTable({ errors, warnings }: { errors: Issue[]; warnings: Issue[] }) {
  const issues = [...errors.map((e) => ({ ...e, sev: 'Error' })), ...warnings.map((w) => ({ ...w, sev: 'Warning' }))];
  if (issues.length === 0) return null;
  return (
    <div className="max-h-96 overflow-auto rounded-md border border-gray-200 dark:border-gray-700">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="sticky top-0 bg-gray-50 text-xs text-muted dark:bg-gray-800">
          <tr><th className="px-3 py-2">Row</th><th className="px-3">Column</th><th className="px-3">Severity</th><th className="px-3">Issue</th></tr>
        </thead>
        <tbody>
          {issues.map((i, n) => (
            <tr key={n} className="border-t border-gray-100 dark:border-gray-700">
              <td className="px-3 py-1.5">{i.row ?? 'File'}</td>
              <td className="px-3">{i.column ?? '—'}</td>
              <td className={`px-3 font-semibold ${i.sev === 'Error' ? 'text-accent' : 'text-muted'}`}>{i.sev}</td>
              <td className="px-3">{i.message} <span className="text-xs text-muted">({i.code})</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
