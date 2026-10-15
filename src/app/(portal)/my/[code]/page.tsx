import Link from 'next/link';
import { notFound } from 'next/navigation';
import { withUser } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { availablePeriods, getDetail, getGlBreakdown, getMonthlyTrend, getTotals } from '@/lib/financials';
import { fiscalYear, periodLabel, variance } from '@/lib/fiscal';
import { resolveAsOf } from '@/components/cc/period';
import { PeriodSelector } from '@/components/cc/PeriodSelector';
import { FlagBadge, VarianceAmount, VariancePct } from '@/components/cc/Variance';
import { FLAG_TEXT, fmtAmount, fmtPct, fmtSigned } from '@/components/cc/format';
import { GlBarChart, type GlBarDatum } from '@/components/charts/GlBarChart';
import { TrendChart, type TrendDatum } from '@/components/charts/TrendChart';

export const dynamic = 'force-dynamic';

const CODE_RE = /^[A-Z]{2}-[A-Z0-9]{2,6}-[0-9]{3,4}$/;

type Params = Promise<{ code: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CostCentreDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const user = await requireUser();
  const { code } = await params;
  const { period } = await searchParams;
  if (!CODE_RE.test(code)) notFound();

  const data = await withUser(user.email, async (tx) => {
    const detail = await getDetail(tx, code);
    if (!detail) {
      // Same 404 for "does not exist" and "not yours" — an owner must not learn
      // whether another cost centre exists. The attempt is still audited.
      await tx.query(`select ccp.log_event('ACCESS_DENIED', 'cost_centre', $1)`, [code]);
      return null;
    }
    const periods = await availablePeriods(tx);
    const asOf = resolveAsOf(period, periods);
    const totals = await getTotals(tx, code, asOf);
    const gl = await getGlBreakdown(tx, code, asOf);
    const trend = await getMonthlyTrend(tx, code, asOf);
    return { detail, periods, asOf, totals, gl, trend };
  });
  // notFound() throws, so call it after the transaction has committed the audit row.
  if (!data) notFound();

  const { detail, periods, asOf, totals, gl, trend } = data;
  const fy = fiscalYear(asOf);
  const monthLabel = periodLabel(asOf);
  const ytdRange = `${periodLabel(fy.start)} – ${monthLabel}`;
  const monthVar = variance(totals.monthBudget, totals.monthActual);
  const outturnVar = variance(totals.fyBudget, totals.outturn);
  const q = `?period=${encodeURIComponent(asOf)}`;

  const glChart: GlBarDatum[] = gl.map((g) => ({
    name: g.gl_group,
    budget: g.ytdBudget,
    actual: g.ytdActual,
    variance: g.ytdVariance,
    variancePct: g.ytdVariancePct,
    flagged: g.flagged,
  }));
  const trendChart: TrendDatum[] = trend.map((t) => {
    const v = t.actual === null ? null : variance(t.budget, t.actual);
    const label = periodLabel(t.period);
    return {
      label: label.split(' ')[0],
      title: label,
      budget: t.budget,
      actual: t.actual,
      variance: v?.amount ?? null,
      variancePct: v?.pct ?? null,
      flagged: v?.flagged ?? false,
    };
  });
  const hasTrend = trend.some((t) => t.budget !== 0 || t.actual !== null);
  const flaggedGl = gl.filter((g) => g.flagged).length;

  const master: { label: string; value: React.ReactNode; wide?: boolean }[] = [
    { label: 'Business unit', value: detail.bu },
    { label: 'Department', value: detail.department },
    { label: 'Entity', value: detail.entity },
    { label: 'Type', value: detail.type },
    {
      label: 'Owner',
      wide: true,
      value: detail.owner_name ? (
        <>
          {detail.owner_name}
          {detail.owner_email && <span className="block text-xs text-muted [overflow-wrap:anywhere]">{detail.owner_email}</span>}
        </>
      ) : (
        '—'
      ),
    },
    { label: 'Backup owner', wide: true, value: <span className="[overflow-wrap:anywhere]">{detail.backup_owner_email ?? '—'}</span> },
    { label: 'BU head', wide: true, value: <span className="[overflow-wrap:anywhere]">{detail.bu_head_email ?? '—'}</span> },
    {
      label: 'Status',
      value: (
        <>
          {detail.status}
          {detail.close_date && <span className="block text-xs text-muted">Closed {detail.close_date}</span>}
        </>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <Link href={`/my${q}`} className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline dark:text-brand-light">
        <span aria-hidden="true">←</span> My Cost Centres
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="min-w-0">
          <span className="block break-all font-mono text-3xl font-bold tracking-wide text-brand dark:text-brand-light sm:text-4xl">
            {detail.cc_code}
          </span>
          <span className="mt-1 block text-lg font-semibold sm:text-xl">{detail.cc_alias}</span>
        </h1>
        <div className="flex flex-wrap items-end gap-3">
          <PeriodSelector action={`/my/${encodeURIComponent(detail.cc_code)}`} periods={periods} value={asOf} />
          <a href={`/api/cc/${encodeURIComponent(detail.cc_code)}/export${q}`} className="btn-primary">
            <span aria-hidden="true">⭳</span> Export to Excel
          </a>
        </div>
      </header>

      <section aria-label="Cost centre details" className="surface rounded-lg p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-4">
          {master.map((m) => (
            <div key={m.label} className={`min-w-0 ${m.wide ? 'col-span-2 md:col-span-1' : ''}`}>
              <dt className="text-xs font-medium text-muted">{m.label}</dt>
              <dd className="mt-0.5 font-medium">{m.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="fig-h">
        <h2 id="fig-h" className="heading text-lg">
          Budget vs actual
        </h2>
        <p className="text-xs text-muted">Variance = Actual − Budget; positive means overspend. Flagged when more than ±10% of budget.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <FigureCard
            title={`Month · ${monthLabel}`}
            flagged={monthVar.flagged}
            rows={[
              { label: 'Budget', value: fmtAmount(totals.monthBudget) },
              { label: 'Actual', value: fmtAmount(totals.monthActual) },
              {
                label: 'Variance',
                value: (
                  <>
                    <VarianceAmount amount={monthVar.amount} flagged={monthVar.flagged} />{' '}
                    <span className="text-xs">(<VariancePct pct={monthVar.pct} flagged={monthVar.flagged} />)</span>
                  </>
                ),
              },
            ]}
          />
          <FigureCard
            title={`Year to date · ${ytdRange}`}
            flagged={totals.flagged}
            rows={[
              { label: 'Budget', value: fmtAmount(totals.ytdBudget) },
              { label: 'Actual', value: fmtAmount(totals.ytdActual) },
              {
                label: 'Variance',
                value: (
                  <>
                    <VarianceAmount amount={totals.ytdVariance} flagged={totals.flagged} />{' '}
                    <span className="text-xs">(<VariancePct pct={totals.ytdVariancePct} flagged={totals.flagged} />)</span>
                  </>
                ),
              },
            ]}
          />
          <FigureCard
            title={`Full year · ${fy.label}`}
            rows={[
              { label: 'Full-year budget', value: fmtAmount(totals.fyBudget) },
              { label: 'Full-year outturn', value: fmtAmount(totals.outturn) },
              {
                label: 'Outturn vs budget',
                value: (
                  <>
                    {fmtSigned(outturnVar.amount)} <span className="text-xs">({fmtPct(outturnVar.pct)})</span>
                  </>
                ),
              },
            ]}
            note="Outturn = YTD actual + budget for the remaining months."
          />
        </div>
      </section>

      <section aria-labelledby="gl-h" className="surface rounded-lg p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="gl-h" className="heading text-lg">Expense breakdown by GL group</h2>
          <p className="text-xs text-muted">
            Year to date, {ytdRange}
            {flaggedGl > 0 && (
              <>
                {' · '}
                <span className={`${FLAG_TEXT} font-semibold`}>
                  {flaggedGl} GL group{flaggedGl === 1 ? '' : 's'} over ±10%
                </span>
              </>
            )}
          </p>
        </div>
        {gl.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No budget or actuals recorded for this cost centre in {fy.label}.</p>
        ) : (
          <>
            <div className="mt-4">
              <GlBarChart
                data={glChart}
                ariaLabel={`Bar chart: year-to-date budget versus actual by GL group for ${detail.cc_code}, ${ytdRange}. The same figures are in the table below.`}
              />
            </div>
            <div className="relative mt-6 overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <caption className="sr-only">
                  Expense breakdown by GL group for {detail.cc_code}: {monthLabel} and year to date
                </caption>
                <thead className="text-xs text-muted">
                  <tr>
                    <th scope="col" rowSpan={2} className="py-1.5 pl-2 pr-3 text-left align-bottom font-medium">GL group</th>
                    <th scope="colgroup" colSpan={2} className="border-theme border-b px-3 text-center font-medium">{monthLabel}</th>
                    <th scope="colgroup" colSpan={4} className="border-theme border-b px-3 text-center font-medium">Year to date</th>
                    <th scope="colgroup" className="border-theme border-b pl-3 text-right font-medium">Full year</th>
                  </tr>
                  <tr className="text-right">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Budget</th>
                    <th scope="col" className="pr-3 font-medium">Actual</th>
                    <th scope="col" className="pr-3 font-medium">Budget</th>
                    <th scope="col" className="pr-3 font-medium">Actual</th>
                    <th scope="col" className="pr-3 font-medium">Variance</th>
                    <th scope="col" className="pr-3 font-medium">Var %</th>
                    <th scope="col" className="pl-3 font-medium">Outturn</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {gl.map((g) => (
                    <tr key={g.gl_group} className={`border-theme border-t text-right ${g.flagged ? 'bg-accent/[0.04] dark:bg-accent/10' : ''}`}>
                      <th
                        scope="row"
                        className={`py-2 pl-2 pr-3 text-left font-medium ${
                          g.flagged ? 'shadow-[inset_3px_0_0_0_var(--color-accent)]' : ''
                        }`}
                      >
                        <span className={g.flagged ? FLAG_TEXT : ''}>{g.gl_group}</span>
                        {g.flagged && (
                          <span className="ml-2 inline-block align-middle">
                            <FlagBadge amount={g.ytdVariance} />
                          </span>
                        )}
                      </th>
                      <td className="pr-3">{fmtAmount(g.monthBudget)}</td>
                      <td className="pr-3">{fmtAmount(g.monthActual)}</td>
                      <td className="pr-3">{fmtAmount(g.ytdBudget)}</td>
                      <td className="pr-3">{fmtAmount(g.ytdActual)}</td>
                      <td className="pr-3"><VarianceAmount amount={g.ytdVariance} flagged={g.flagged} /></td>
                      <td className="pr-3"><VariancePct pct={g.ytdVariancePct} flagged={g.flagged} /></td>
                      <td className="pl-3">{fmtAmount(g.outturn)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="tabular-nums">
                  <tr className="border-theme border-t-2 text-right font-semibold">
                    <th scope="row" className="py-2 pl-2 pr-3 text-left">Total</th>
                    <td className="pr-3">{fmtAmount(totals.monthBudget)}</td>
                    <td className="pr-3">{fmtAmount(totals.monthActual)}</td>
                    <td className="pr-3">{fmtAmount(totals.ytdBudget)}</td>
                    <td className="pr-3">{fmtAmount(totals.ytdActual)}</td>
                    <td className="pr-3"><VarianceAmount amount={totals.ytdVariance} flagged={totals.flagged} /></td>
                    <td className="pr-3"><VariancePct pct={totals.ytdVariancePct} flagged={totals.flagged} /></td>
                    <td className="pl-3">{fmtAmount(totals.outturn)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="trend-h" className="surface rounded-lg p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="trend-h" className="heading text-lg">Monthly trend · {fy.label}</h2>
          <p className="text-xs text-muted">Actuals to {monthLabel}; budget for all 12 months</p>
        </div>
        {!hasTrend ? (
          <p className="mt-3 text-sm text-muted">No budget or actuals recorded for this cost centre in {fy.label}.</p>
        ) : (
          <>
            <div className="mt-4">
              <TrendChart
                data={trendChart}
                ariaLabel={`Chart: monthly budget versus actual for ${detail.cc_code}, ${fy.label}. Actuals shown up to ${monthLabel}. The same figures are in the monthly figures table.`}
              />
            </div>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-semibold text-brand dark:text-brand-light">Monthly figures (table)</summary>
              <div className="relative mt-2 overflow-x-auto">
                <table className="w-full min-w-[520px]">
                  <caption className="sr-only">Monthly budget versus actual, {fy.label}</caption>
                  <thead className="text-xs text-muted">
                    <tr className="text-right">
                      <th scope="col" className="py-1.5 pr-3 text-left font-medium">Month</th>
                      <th scope="col" className="pr-3 font-medium">Budget</th>
                      <th scope="col" className="pr-3 font-medium">Actual</th>
                      <th scope="col" className="pr-3 font-medium">Variance</th>
                      <th scope="col" className="font-medium">Var %</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {trendChart.map((t) => (
                      <tr key={t.title} className="border-theme border-t text-right">
                        <th scope="row" className="py-1.5 pr-3 text-left font-medium">{t.title}</th>
                        <td className="pr-3">{fmtAmount(t.budget)}</td>
                        <td className="pr-3">{t.actual === null ? <span className="text-muted">—</span> : fmtAmount(t.actual)}</td>
                        <td className="pr-3">
                          {t.variance === null ? <span className="text-muted">—</span> : <VarianceAmount amount={t.variance} flagged={t.flagged} />}
                        </td>
                        <td>{t.variance === null ? <span className="text-muted">—</span> : <VariancePct pct={t.variancePct} flagged={t.flagged} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>

      <p className="text-sm text-muted">Comments on variances arrive in Phase 3.</p>
    </div>
  );
}

function FigureCard({
  title,
  rows,
  flagged = false,
  note,
}: {
  title: string;
  rows: { label: string; value: React.ReactNode }[];
  flagged?: boolean;
  note?: string;
}) {
  return (
    <div className={`surface min-w-0 rounded-lg p-4 ${flagged ? 'border-l-4 !border-l-accent' : ''}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="mt-2 space-y-1.5 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">{r.label}</dt>
            <dd className="text-right font-semibold tabular-nums">{r.value}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </div>
  );
}
