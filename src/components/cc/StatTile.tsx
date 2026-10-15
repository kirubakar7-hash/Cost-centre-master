import { FLAG_TEXT } from './format';

/**
 * KPI tile: label · value · optional sub-line. A flagged tile gets a red left
 * rule and red value (brand red is reserved for variance alerts).
 */
export function StatTile({
  label,
  value,
  sub,
  flagged = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  flagged?: boolean;
}) {
  return (
    <div className={`surface min-w-0 rounded-lg p-4 ${flagged ? 'border-l-4 !border-l-accent' : ''}`}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div
        className={`mt-1 break-words text-xl font-semibold leading-tight sm:text-2xl ${
          flagged ? FLAG_TEXT : 'text-brand dark:text-brand-light'
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
