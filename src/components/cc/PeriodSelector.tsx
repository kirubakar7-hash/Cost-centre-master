import { periodLabel } from '@/lib/fiscal';

/** "As of" selector — a plain GET form, so it works without client JavaScript. */
export function PeriodSelector({ action, periods, value }: { action: string; periods: string[]; value: string }) {
  if (periods.length === 0) return null;
  return (
    <form method="get" action={action} className="flex items-end gap-2">
      <div>
        <label htmlFor="period" className="block text-xs font-medium text-muted">
          As of
        </label>
        <select
          id="period"
          name="period"
          defaultValue={value}
          className="surface mt-0.5 rounded-md px-2.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        >
          {periods.map((p) => (
            <option key={p} value={p}>
              {periodLabel(p)}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn-secondary !px-3">
        Show
      </button>
    </form>
  );
}
