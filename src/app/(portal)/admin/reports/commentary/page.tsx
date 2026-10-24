import Link from 'next/link';
import { withUser } from '@/lib/db';
import { commentaryCoverage, coverageQuery, parseCoverageFilters, reportBySlug, type SearchParams } from '@/lib/reports';
import { periodLabel } from '@/lib/fiscal';
import { requireFinancePage } from '@/components/reports/guard';
import { fmtMoney, fmtPct, fmtShare, shortTs } from '@/components/reports/format';
import { CheckboxField, EmptyRow, FilterForm, Pill, RED, ROW, ReportHeader, SelectField, TABLE, THEAD, Tile } from '@/components/reports/ui';

export const dynamic = 'force-dynamic';

const PATH = '/admin/reports/commentary';

export default async function CommentaryCoverageReport({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireFinancePage();
  const requested = parseCoverageFilters(await searchParams);
  const r = await withUser(user.email, (tx) => commentaryCoverage(tx, requested));
  const def = reportBySlug('commentary')!;
  const query = coverageQuery(r.filters);
  const ytd = r.period && r.ytdFrom ? `${periodLabel(r.ytdFrom)} – ${periodLabel(r.period)}, ${r.fyLabel}` : null;

  return (
    <div className="space-y-6">
      <ReportHeader
        title={def.title}
        description={
          ytd
            ? `Cost-centre GL lines whose year-to-date variance (${ytd}) is over ±10% of budget, and whether the owner has explained them for ${periodLabel(r.period!)}.`
            : def.description
        }
        control={def.control}
        exportHref={`/api/admin/reports/commentary?${query}`}
      />

      <FilterForm action={PATH}>
        <SelectField
          name="period"
          label="Period"
          value={r.period}
          anyLabel={r.periods.length ? null : 'No actuals published'}
          options={r.periods.map((p) => ({ value: p, label: periodLabel(p) }))}
        />
        <SelectField name="bu" label="Business unit" value={r.filters.bu} anyLabel="All" options={r.bus.map((b) => ({ value: b, label: b }))} />
        <CheckboxField name="unexplained" label="Unexplained only" checked={r.filters.unexplainedOnly} />
      </FilterForm>

      {!r.period ? (
        <p className="surface rounded-lg p-5 text-sm text-muted">No actuals have been published yet, so there are no variances to explain.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Flagged lines (|YTD var| > 10%)" value={r.kpi.flagged} sub={periodLabel(r.period)} />
            <Tile label="Explained" value={r.kpi.explained} sub="At least one comment for the month" />
            <Tile label="Unexplained" value={r.kpi.unexplained} alert={r.kpi.unexplained > 0} sub={r.kpi.unexplained ? 'Follow up with the owners' : 'All explained ✓'} />
            <Tile label="Coverage" value={fmtShare(r.kpi.pct)} sub="Flagged lines explained" />
          </div>

          {r.byBu.length > 1 && (
            <section className="surface min-w-0 rounded-lg p-4 sm:p-5" aria-labelledby="bu-h">
              <h2 id="bu-h" className="heading text-lg">
                By business unit
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className={`${TABLE} min-w-[480px]`}>
                  <thead className={THEAD}>
                    <tr>
                      <th className="py-1 pr-3">BU</th>
                      <th className="pr-3 text-right">Flagged</th>
                      <th className="pr-3 text-right">Explained</th>
                      <th className="pr-3 text-right">Unexplained</th>
                      <th className="text-right">Coverage</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {r.byBu.map((b) => (
                      <tr key={b.bu} className={ROW}>
                        <td className="py-1.5 pr-3 font-medium">{b.bu}</td>
                        <td className="pr-3 text-right">{b.flagged}</td>
                        <td className="pr-3 text-right">{b.explained}</td>
                        <td className={`pr-3 text-right ${b.unexplained ? `${RED} font-semibold` : ''}`}>{b.unexplained}</td>
                        <td className="text-right">{fmtShare(b.pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="surface min-w-0 rounded-lg p-4 sm:p-5" aria-labelledby="lines-h">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="lines-h" className="heading text-lg">
                {r.filters.unexplainedOnly ? 'Unexplained lines' : 'Flagged lines'} ({r.lines.length})
              </h2>
              <p className="text-xs text-muted">Amounts in each entity’s own currency · variance = actual − budget (positive = overspend)</p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className={`${TABLE} min-w-[1000px]`}>
                <thead className={THEAD}>
                  <tr>
                    <th className="py-1 pr-3">Cost centre</th>
                    <th className="pr-3">Owner</th>
                    <th className="pr-3">GL group</th>
                    <th className="pr-3 text-right">YTD budget</th>
                    <th className="pr-3 text-right">YTD actual</th>
                    <th className="pr-3 text-right">Variance</th>
                    <th className="pr-3 text-right">Var %</th>
                    <th className="w-[32%]">Commentary for {periodLabel(r.period)}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={`${l.cc_code}|${l.gl_group}`} className={ROW}>
                      <td className="py-2 pr-3">
                        <Link
                          href={`/my/${l.cc_code}?period=${r.period}`}
                          className="font-mono text-xs font-semibold text-brand hover:underline dark:text-brand-light"
                        >
                          {l.cc_code}
                        </Link>
                        <div className="text-xs text-muted">
                          {l.cc_alias} · {l.bu} · {l.currency}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        {l.owner_email ? (
                          <a href={`mailto:${l.owner_email}`} title={l.owner_email} className="whitespace-nowrap text-brand hover:underline dark:text-brand-light">
                            {l.owner_name ?? l.owner_email}
                          </a>
                        ) : (
                          <span className={RED}>No owner</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{l.gl_group}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtMoney(l.ytdBudget, l.currency, 0)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtMoney(l.ytdActual, l.currency, 0)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                        {l.variance > 0 ? '+' : ''}
                        {fmtMoney(l.variance, l.currency, 0)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold tabular-nums">
                        <span aria-hidden="true">{l.variance > 0 ? '▲ ' : '▼ '}</span>
                        {fmtPct(l.variancePct)}
                      </td>
                      <td className="py-2 text-xs">
                        {l.explained ? (
                          <>
                            <Pill>
                              ✓ {l.commentCount} comment{l.commentCount === 1 ? '' : 's'}
                            </Pill>
                            <p className="mt-1 [overflow-wrap:anywhere]">“{l.latestComment}”</p>
                            <p className="text-muted">
                              {l.latestCommentBy} · {shortTs(l.latestCommentAt)}
                            </p>
                          </>
                        ) : (
                          <Pill alert>✗ Unexplained</Pill>
                        )}
                      </td>
                    </tr>
                  ))}
                  {r.lines.length === 0 && (
                    <EmptyRow colSpan={8}>{r.kpi.flagged ? 'Every flagged line has a comment. ✓' : 'No line is over ±10% year to date.'}</EmptyRow>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
