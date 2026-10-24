import Link from 'next/link';
import { notFound } from 'next/navigation';
import { withUser } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { availablePeriods, getDetail, getGlBreakdown, getMonthlyTrend, getTotals, latestPeriod } from '@/lib/financials';
import { canComment, commentableGlGroups, listComments } from '@/lib/comments';
import { allocationsReceived, allocationTotals } from '@/lib/allocations';
import { currencyOf } from '@/lib/currency';
import { fiscalYear, periodLabel, variance } from '@/lib/fiscal';
import { resolveAsOf } from '@/components/cc/period';
import { PeriodSelector } from '@/components/cc/PeriodSelector';
import { FlagBadge, VarianceAmount, VariancePct } from '@/components/cc/Variance';
import { FLAG_TEXT, fmtAmount, fmtPct, fmtSigned } from '@/components/cc/format';
import { CommentForm, type GlOption } from '@/components/cc/CommentForm';
import { CommentCount, ExplanationNeeded } from '@/components/cc/CommentMarkers';
import { LocalTime } from '@/components/cc/LocalTime';
import { GlBarChart, type GlBarDatum } from '@/components/charts/GlBarChart';
import { TrendChart, type TrendDatum } from '@/components/charts/TrendChart';

export const dynamic = 'force-dynamic';

const CODE_RE = /^[A-Z]{2}-[A-Z0-9]{2,6}-[0-9]{3,4}$/;

type Params = Promise<{ code: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CostCentreDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const user = await requireUser();
  const { code } = await params;
  const { period, gl: requestedGl } = await searchParams;
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
    const asOf = resolveAsOf(period, periods, await latestPeriod(tx));
    const totals = await getTotals(tx, code, asOf);
    const gl = await getGlBreakdown(tx, code, asOf);
    const trend = await getMonthlyTrend(tx, code, asOf);
    const comments = await listComments(tx, code, asOf);
    const mayComment = await canComment(tx, code);
    const commentable = mayComment ? await commentableGlGroups(tx, code, asOf) : [];
    const allocations = await allocationsReceived(tx, code, asOf);
    return { detail, periods, asOf, totals, gl, trend, comments, mayComment, commentable, allocations };
  });
  // notFound() throws, so call it after the transaction has committed the audit row.
  if (!data) notFound();

  const { detail, periods, asOf, totals, gl, trend, comments, mayComment, commentable, allocations } = data;
  const cur = currencyOf(detail.entity);
  const amt = (n: number) => fmtAmount(n, cur);
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

  // Variance explanations for the As-of month
  const commentCount = new Map<string, number>();
  for (const c of comments) commentCount.set(c.gl_group, (commentCount.get(c.gl_group) ?? 0) + 1);
  const glByName = new Map(gl.map((g) => [g.gl_group, g]));
  const commentableSet = new Set(commentable);
  const needsExplanation = (g: { gl_group: string; flagged: boolean }) =>
    mayComment && g.flagged && !commentCount.has(g.gl_group) && commentableSet.has(g.gl_group);
  const needCount = gl.filter(needsExplanation).length;
  const options: GlOption[] = commentable.map((name) => ({
    gl: name,
    flagged: glByName.get(name)?.flagged ?? false,
    comments: commentCount.get(name) ?? 0,
  }));
  const defaultGl =
    options.find((o) => o.gl === requestedGl)?.gl ??
    options.find((o) => o.flagged && o.comments === 0)?.gl ??
    options.find((o) => o.flagged)?.gl ??
    options[0]?.gl ??
    '';
  const explainHref = (glGroup: string) =>
    `/my/${encodeURIComponent(detail.cc_code)}?period=${encodeURIComponent(asOf)}&gl=${encodeURIComponent(glGroup)}#explain`;
  const alloc = allocationTotals(allocations);

  const master: { label: string; value: React.ReactNode; wide?: boolean }[] = [
    { label: 'Business unit', value: detail.bu },
    { label: 'Department', value: detail.department },
    { label: 'Entity', value: `${detail.entity} · ${cur}` },
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
        <p className="text-xs text-muted">
          <span className="font-semibold">All amounts in {cur}.</span> Variance = Actual − Budget; positive means overspend. Flagged when
          more than ±10% of budget.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <FigureCard
            title={`Month · ${monthLabel}`}
            flagged={monthVar.flagged}
            rows={[
              { label: 'Budget', value: amt(totals.monthBudget) },
              { label: 'Actual', value: amt(totals.monthActual) },
              {
                label: 'Variance',
                value: (
                  <>
                    <VarianceAmount amount={monthVar.amount} flagged={monthVar.flagged} currency={cur} />{' '}
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
              { label: 'Budget', value: amt(totals.ytdBudget) },
              { label: 'Actual', value: amt(totals.ytdActual) },
              {
                label: 'Variance',
                value: (
                  <>
                    <VarianceAmount amount={totals.ytdVariance} flagged={totals.flagged} currency={cur} />{' '}
                    <span className="text-xs">(<VariancePct pct={totals.ytdVariancePct} flagged={totals.flagged} />)</span>
                  </>
                ),
              },
            ]}
          />
          <FigureCard
            title={`Full year · ${fy.label}`}
            rows={[
              { label: 'Full-year budget', value: amt(totals.fyBudget) },
              { label: 'Full-year outturn', value: amt(totals.outturn) },
              {
                label: 'Outturn vs budget',
                value: (
                  <>
                    {fmtSigned(outturnVar.amount, cur)} <span className="text-xs">({fmtPct(outturnVar.pct)})</span>
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
            Year to date, {ytdRange} · {cur}
            {flaggedGl > 0 && (
              <>
                {' · '}
                <span className={`${FLAG_TEXT} font-semibold`}>
                  {flaggedGl} GL group{flaggedGl === 1 ? '' : 's'} over ±10%
                </span>
              </>
            )}
            {needCount > 0 && (
              <>
                {' · '}
                <a href="#explain" className={`${FLAG_TEXT} font-semibold underline`}>
                  {needCount} need{needCount === 1 ? 's' : ''} an explanation
                </a>
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
                currency={cur}
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
                        {commentCount.has(g.gl_group) && (
                          <span className="ml-2 inline-block align-middle">
                            <CommentCount count={commentCount.get(g.gl_group) ?? 0} href="#explain" periodLabel={monthLabel} />
                          </span>
                        )}
                        {needsExplanation(g) && (
                          <span className="mt-1 block">
                            <ExplanationNeeded href={explainHref(g.gl_group)} glGroup={g.gl_group} />
                          </span>
                        )}
                      </th>
                      <td className="pr-3">{amt(g.monthBudget)}</td>
                      <td className="pr-3">{amt(g.monthActual)}</td>
                      <td className="pr-3">{amt(g.ytdBudget)}</td>
                      <td className="pr-3">{amt(g.ytdActual)}</td>
                      <td className="pr-3"><VarianceAmount amount={g.ytdVariance} flagged={g.flagged} currency={cur} /></td>
                      <td className="pr-3"><VariancePct pct={g.ytdVariancePct} flagged={g.flagged} /></td>
                      <td className="pl-3">{amt(g.outturn)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="tabular-nums">
                  <tr className="border-theme border-t-2 text-right font-semibold">
                    <th scope="row" className="py-2 pl-2 pr-3 text-left">Total</th>
                    <td className="pr-3">{amt(totals.monthBudget)}</td>
                    <td className="pr-3">{amt(totals.monthActual)}</td>
                    <td className="pr-3">{amt(totals.ytdBudget)}</td>
                    <td className="pr-3">{amt(totals.ytdActual)}</td>
                    <td className="pr-3"><VarianceAmount amount={totals.ytdVariance} flagged={totals.flagged} currency={cur} /></td>
                    <td className="pr-3"><VariancePct pct={totals.ytdVariancePct} flagged={totals.flagged} /></td>
                    <td className="pl-3">{amt(totals.outturn)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>

      <section id="explain" aria-labelledby="explain-h" className="surface scroll-mt-28 rounded-lg p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="explain-h" className="heading text-lg">Variance explanations · {monthLabel}</h2>
          <p className="text-xs text-muted">
            {comments.length === 0 ? 'None yet' : `${comments.length} explanation${comments.length === 1 ? '' : 's'}`}
            {needCount > 0 && (
              <>
                {' · '}
                <span className={`${FLAG_TEXT} font-semibold`}>
                  {needCount} flagged line{needCount === 1 ? '' : 's'} without an explanation
                </span>
              </>
            )}
          </p>
        </div>
        <p className="mt-1 text-xs text-muted">
          Lines over ±10% of budget should be explained by the cost centre owner. Explanations are visible to everyone with access to
          this cost centre and cannot be edited or deleted.
        </p>
        <div className={`mt-4 grid gap-6 ${mayComment && options.length > 0 ? 'lg:grid-cols-[minmax(0,1fr)_22rem]' : ''}`}>
          <div className="min-w-0">
            {comments.length === 0 ? (
              <p className="text-sm text-muted">No explanations recorded for {monthLabel}.</p>
            ) : (
              <ol className="space-y-3" aria-label={`Explanations for ${monthLabel}, newest first`}>
                {comments.map((c) => {
                  const line = glByName.get(c.gl_group);
                  return (
                    <li key={c.id} className="border-theme rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="font-semibold">{c.gl_group}</span>
                        {line?.flagged && <FlagBadge amount={line.ytdVariance} />}
                      </div>
                      <p className="mt-1 whitespace-pre-line text-sm [overflow-wrap:anywhere]">{c.comment}</p>
                      <p className="mt-2 text-xs text-muted">
                        <span className="[overflow-wrap:anywhere]">{c.user_email}</span> · <LocalTime iso={c.created_at} />
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          {mayComment && options.length > 0 && (
            <div className="border-theme min-w-0 border-t pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <CommentForm code={detail.cc_code} period={asOf} periodLabel={monthLabel} options={options} defaultGl={defaultGl} />
            </div>
          )}
        </div>
        {mayComment && options.length === 0 && (
          <p className="mt-4 text-xs text-muted">Explanations can be added once actuals for {monthLabel} are published.</p>
        )}
        {!mayComment && (
          <p className="mt-4 text-xs text-muted">
            Read only. Explanations are added by the cost centre&apos;s owner, backup owner, BU head or Finance.
          </p>
        )}
      </section>

      <section aria-labelledby="alloc-h" className="surface rounded-lg p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="alloc-h" className="heading text-lg">Allocations received</h2>
          <p className="text-xs text-muted">
            {monthLabel} and year to date, {ytdRange} · {cur}
          </p>
        </div>
        <p className="mt-1 text-xs text-muted">
          Shown for information. Allocations are recharges from shared-service cost centres and are not added to the actuals above.
        </p>
        {allocations.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No allocations received in this period.</p>
        ) : (
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Allocations received by {detail.cc_code}: {monthLabel} and year to date, in {cur}
              </caption>
              <thead className="text-xs text-muted">
                <tr className="text-right">
                  <th scope="col" className="py-1.5 pl-2 pr-3 text-left font-medium">Source cost centre</th>
                  <th scope="col" className="hidden pr-3 text-left font-medium sm:table-cell">Basis</th>
                  <th scope="col" className="pr-3 font-medium">{monthLabel}</th>
                  <th scope="col" className="font-medium">YTD</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {allocations.map((a) => (
                  <tr key={a.source_cc} className="border-theme border-t text-right align-top">
                    <th scope="row" className="py-2 pl-2 pr-3 text-left font-normal">
                      <span className="block font-mono font-semibold">{a.source_cc}</span>
                      {a.source_alias && <span className="block text-xs text-muted">{a.source_alias}</span>}
                      <span className="mt-0.5 block text-xs sm:hidden">
                        <span className="text-muted">Basis: </span>
                        {a.basis}
                      </span>
                    </th>
                    <td className="hidden py-2 pr-3 text-left sm:table-cell">{a.basis}</td>
                    <td className="py-2 pr-3">{amt(a.month)}</td>
                    <td className="py-2">{amt(a.ytd)}</td>
                  </tr>
                ))}
              </tbody>
              {allocations.length > 1 && (
                <tfoot className="tabular-nums">
                  <tr className="border-theme border-t-2 text-right font-semibold">
                    <th scope="row" className="py-2 pl-2 pr-3 text-left">Total</th>
                    <td className="hidden pr-3 sm:table-cell" />
                    <td className="pr-3">{amt(alloc.month)}</td>
                    <td>{amt(alloc.ytd)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
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
                currency={cur}
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
                        <td className="pr-3">{amt(t.budget)}</td>
                        <td className="pr-3">{t.actual === null ? <span className="text-muted">—</span> : amt(t.actual)}</td>
                        <td className="pr-3">
                          {t.variance === null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <VarianceAmount amount={t.variance} flagged={t.flagged} currency={cur} />
                          )}
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
