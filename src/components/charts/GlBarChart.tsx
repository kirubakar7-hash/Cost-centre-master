'use client';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps, YAxisTickContentProps } from 'recharts';
import { fmtCompact, fmtPct, fmtSigned } from '@/components/cc/format';
import { LegendKey, TooltipCard, amountOrDash } from './parts';
import { useChartTheme } from './theme';

export interface GlBarDatum {
  name: string;
  budget: number;
  actual: number;
  variance: number;
  variancePct: number | null;
  flagged: boolean;
}

const MAX_LABEL = 22;
const truncate = (s: string) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);

/**
 * YTD Budget (grey) vs Actual (blue) per GL group, as horizontal grouped bars.
 * Flagged groups (|variance| > 10%) carry a red ▲/▼ beside their name.
 * The GL table next to it is the accessible data source.
 */
export function GlBarChart({ data, ariaLabel }: { data: GlBarDatum[]; ariaLabel: string }) {
  const theme = useChartTheme();
  const byName = new Map(data.map((d) => [d.name, d]));
  const height = Math.max(160, data.length * 46 + 36);

  const tick = ({ x, y, payload }: YAxisTickContentProps) => {
    const name = String(payload.value);
    const row = byName.get(name);
    return (
      <text x={Number(x) - 6} y={Number(y)} dy={4} textAnchor="end" fontSize={12} fill={theme.axis}>
        {name.length > MAX_LABEL && <title>{name}</title>}
        {row?.flagged && <tspan fill={theme.flag}>{row.variance > 0 ? '▲ ' : '▼ '}</tspan>}
        {truncate(name)}
      </text>
    );
  };

  const tooltip = ({ active, payload }: TooltipContentProps) => {
    const d = payload?.[0]?.payload as GlBarDatum | undefined;
    if (!active || !d) return null;
    return (
      <TooltipCard
        theme={theme}
        title={`${d.name} — YTD`}
        rows={[
          { label: 'Actual', value: amountOrDash(d.actual), color: theme.actual },
          { label: 'Budget', value: amountOrDash(d.budget), color: theme.budget },
          {
            label: 'Variance',
            value: `${fmtSigned(d.variance)} (${fmtPct(d.variancePct)})`,
            emphasis: d.flagged ? 'flag' : undefined,
          },
        ]}
      />
    );
  };

  return (
    <div role="figure" aria-label={ariaLabel}>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <LegendKey kind="bar" color={theme.actual} label="Actual (YTD)" />
        <LegendKey kind="bar" color={theme.budget} label="Budget (YTD)" />
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" style={{ color: theme.flag }}>▲▼</span> over / under budget by more than 10%
        </span>
      </div>
      <div className="w-full overflow-hidden" style={{ height }}>
        <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 320, height }}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 22, bottom: 4, left: 0 }}
            barGap={2}
            barCategoryGap="22%"
          >
            <CartesianGrid horizontal={false} stroke={theme.grid} strokeWidth={1} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => fmtCompact(v)}
              tick={{ fill: theme.axis, fontSize: 11 }}
              axisLine={{ stroke: theme.grid }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={142}
              tick={tick}
              axisLine={{ stroke: theme.grid }}
              tickLine={false}
              interval={0}
            />
            <Tooltip content={tooltip} cursor={{ fill: theme.cursor }} isAnimationActive={false} />
            <Bar dataKey="actual" name="Actual" fill={theme.actual} maxBarSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            <Bar dataKey="budget" name="Budget" fill={theme.budget} maxBarSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
