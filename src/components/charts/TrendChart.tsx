'use client';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { fmtCompact, fmtPct, fmtSigned } from '@/components/cc/format';
import { LegendKey, TooltipCard, amountOrDash, type TooltipRow } from './parts';
import { useChartTheme } from './theme';

export interface TrendDatum {
  /** Short axis label, e.g. "Apr" */
  label: string;
  /** Full label for the tooltip, e.g. "Apr 2026" */
  title: string;
  budget: number;
  /** null = no actual yet (after the As-of month) — not plotted */
  actual: number | null;
  /** Actual − Budget; null when there is no actual */
  variance: number | null;
  variancePct: number | null;
  flagged: boolean;
}

/**
 * Monthly Budget vs Actual for the 12 months of the fiscal year.
 * Actual = blue columns (only up to the As-of month); Budget = grey line across
 * all 12 months, so the remaining-year budget is visible. One shared y-axis.
 */
export function TrendChart({ data, ariaLabel }: { data: TrendDatum[]; ariaLabel: string }) {
  const theme = useChartTheme();
  const height = 280;

  const tooltip = ({ active, payload }: TooltipContentProps) => {
    const d = payload?.[0]?.payload as TrendDatum | undefined;
    if (!active || !d) return null;
    const rows: TooltipRow[] = [
      { label: 'Actual', value: d.actual === null ? 'Not yet reported' : amountOrDash(d.actual), color: theme.actual },
      { label: 'Budget', value: amountOrDash(d.budget), color: theme.budget },
    ];
    if (d.variance !== null) {
      rows.push({
        label: 'Variance',
        value: `${fmtSigned(d.variance)} (${fmtPct(d.variancePct)})`,
        emphasis: d.flagged ? 'flag' : undefined,
      });
    }
    return <TooltipCard theme={theme} title={d.title} rows={rows} />;
  };

  return (
    <div role="figure" aria-label={ariaLabel}>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <LegendKey kind="bar" color={theme.actual} label="Actual" />
        <LegendKey kind="line" color={theme.budget} label="Budget" />
      </div>
      <div className="w-full overflow-hidden" style={{ height }}>
        <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 320, height }}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={theme.grid} strokeWidth={1} />
            <XAxis
              dataKey="label"
              tick={{ fill: theme.axis, fontSize: 11 }}
              axisLine={{ stroke: theme.grid }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={6}
            />
            <YAxis
              tickFormatter={(v: number) => fmtCompact(v)}
              tick={{ fill: theme.axis, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip content={tooltip} cursor={{ fill: theme.cursor }} isAnimationActive={false} />
            <Bar dataKey="actual" name="Actual" fill={theme.actual} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Line
              dataKey="budget"
              name="Budget"
              type="linear"
              stroke={theme.budget}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 4, fill: theme.budget, stroke: theme.surface, strokeWidth: 2 }}
              activeDot={{ r: 5, fill: theme.budget, stroke: theme.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
