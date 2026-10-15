'use client';
import { fmtAmount } from '@/components/cc/format';
import type { ChartTheme } from './theme';

/** Legend keys mirror the mark: a rect for bars, a short line (+dot) for lines. */
export function LegendKey({ kind, color, label }: { kind: 'bar' | 'line'; color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {kind === 'bar' ? (
        <span aria-hidden="true" className="inline-block h-2.5 w-3 rounded-[2px]" style={{ background: color }} />
      ) : (
        <svg aria-hidden="true" width="18" height="10" viewBox="0 0 18 10">
          <line x1="1" y1="5" x2="17" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <circle cx="9" cy="5" r="3" fill={color} />
        </svg>
      )}
      {label}
    </span>
  );
}

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
  emphasis?: 'flag';
}

/** Tooltip body: values lead (strong), series names follow; rows keyed by a short line. */
export function TooltipCard({ title, rows, theme }: { title: string; rows: TooltipRow[]; theme: ChartTheme }) {
  return (
    <div
      className="rounded-md border px-3 py-2 text-xs shadow-lg"
      style={{ background: theme.surface, borderColor: theme.grid, color: theme.text }}
    >
      <div className="mb-1 font-semibold">{title}</div>
      <table className="border-separate border-spacing-y-0.5">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="pr-1.5 align-middle">
                {r.color ? (
                  <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded" style={{ background: r.color }} />
                ) : (
                  <span className="inline-block w-3" />
                )}
              </td>
              <td
                className="pr-2 text-right font-semibold tabular-nums"
                style={r.emphasis === 'flag' ? { color: theme.flag } : undefined}
              >
                {r.value}
              </td>
              <td style={{ color: theme.axis }}>{r.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const amountOrDash = (v: number | null | undefined) => (v === null || v === undefined ? '—' : fmtAmount(v));
