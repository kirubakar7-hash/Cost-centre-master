import Link from 'next/link';
import { withUser } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { availablePeriods, consolidate, listMyCostCentres } from '@/lib/financials';
import { fiscalYear, periodLabel, variance } from '@/lib/fiscal';
import { resolveAsOf } from '@/components/cc/period';
import { PeriodSelector } from '@/components/cc/PeriodSelector';
import { StatTile } from '@/components/cc/StatTile';
import { FlagMarker, VarianceAmount, VariancePct } from '@/components/cc/Variance';
import { FLAG_TEXT, fmtAmount, fmtPct, fmtSigned } from '@/components/cc/format';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MyCostCentresPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const { period } = await searchParams;

  const { periods, asOf, rows } = await withUser(user.email, async (tx) => {
    const periods = await availablePeriods(tx);
    const asOf = resolveAsOf(period, periods);
    const rows = await listMyCostCentres(tx, asOf);
    return { periods, asOf, rows };
  });

  if (rows.length === 0) {
    return (
      <section className="mx-auto max-w-2xl">
        <h1 className="heading text-2xl sm:text-3xl">My Cost Centres</h1>
        <div className="surface mt-6 rounded-lg p-6 text-sm">
          <p className="font-semibold">No cost centres to show.</p>
          <p className="mt-2 text-muted">
            You are not the owner, backup owner or BU head of any cost centre. Use the{' '}
            <Link href="/" className="font-semibold text-brand underline dark:text-brand-light">
              Cost Centre Finder
            </Link>{' '}
            to look up a code, or contact Finance if you believe you should own a cost centre.
          </p>
        </div>
      </section>
    );
  }

  const seesAll = user.roles.includes('Mgmt') || user.roles.includes('Finance');
  const buCount = new Set(rows.map((r) => r.bu)).size;
  const showByBu = seesAll || user.roles.includes('BU_Head') || buCount > 1;
  const { total, byBu } = consolidate(rows);
  const fy = fiscalYear(asOf);
  const ytdRange = `${periodLabel(fy.start)} – ${periodLabel(asOf)}`;
  const outturnVsBudget = variance(total.fyBudget, total.outturn);
  const flaggedCount = rows.filter((r) => r.flagged).length;
  const q = `?period=${encodeURIComponent(asOf)}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="heading text-2xl sm:text-3xl">My Cost Centres</h1>
          <p className="mt-1 text-sm text-muted">
            {periods.length === 0
              ? 'No actuals have been published yet — budgets only.'
              : `Budget vs actual, year to date ${ytdRange} (${fy.label}). Variance = Actual − Budget; positive means overspend.`}
          </p>
        </div>
        <PeriodSelector action="/my" periods={periods} value={asOf} />
      </div>

      <section aria-labelledby="summary-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="summary-h" className="heading text-lg">
            {seesAll ? 'Consolidated summary' : 'Summary'}
          </h2>
          <p className="text-xs text-muted">
            {rows.length} cost centre{rows.length === 1 ? '' : 's'}
            {seesAll ? ' · all business units' : ''}
            {flaggedCount > 0 && (
              <>
                {' · '}
                <span className={`${FLAG_TEXT} font-semibold`}>{flaggedCount} over ±10% variance</span>
              </>
            )}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile label="YTD budget" value={fmtAmount(total.ytdBudget)} sub={ytdRange} />
          <StatTile label="YTD actual" value={fmtAmount(total.ytdActual)} sub={ytdRange} />
          <StatTile
            label="YTD variance"
            flagged={total.flagged}
            value={
              <>
                {total.flagged && <FlagMarker amount={total.ytdVariance} />}
                {fmtSigned(total.ytdVariance)}
              </>
            }
            sub={<span className={total.flagged ? `${FLAG_TEXT} font-semibold` : ''}>{fmtPct(total.ytdVariancePct)} vs budget</span>}
          />
          <StatTile label="Full-year budget" value={fmtAmount(total.fyBudget)} sub={fy.label} />
          <StatTile
            className="col-span-2 lg:col-span-1"
            label="Full-year outturn"
            value={fmtAmount(total.outturn)}
            sub={`${fmtSigned(outturnVsBudget.amount)} (${fmtPct(outturnVsBudget.pct)}) vs FY budget`}
          />
        </div>
        <p className="mt-2 text-xs text-muted">Outturn = YTD actual + budget for the remaining months of {fy.label}.</p>
      </section>

      {showByBu && (
        <section aria-labelledby="bu-h" className="surface rounded-lg p-4 sm:p-5">
          <h2 id="bu-h" className="heading text-lg">By business unit</h2>
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">Consolidated budget versus actual by business unit, as of {periodLabel(asOf)}</caption>
              <thead className="text-xs text-muted">
                <tr className="text-right">
                  <th scope="col" className="py-1.5 pr-3 text-left font-medium">BU</th>
                  <th scope="col" className="pr-3 font-medium">CCs</th>
                  <th scope="col" className="pr-3 font-medium">YTD budget</th>
                  <th scope="col" className="pr-3 font-medium">YTD actual</th>
                  <th scope="col" className="pr-3 font-medium">Variance</th>
                  <th scope="col" className="pr-3 font-medium">Var %</th>
                  <th scope="col" className="pr-3 font-medium">FY budget</th>
                  <th scope="col" className="font-medium">Outturn</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {byBu.map((b) => (
                  <tr key={b.bu} className="border-theme border-t text-right">
                    <th scope="row" className="py-2 pr-3 text-left font-semibold">
                      {b.bu}
                      {b.flaggedCount > 0 && (
                        <span className={`${FLAG_TEXT} ml-2 text-xs font-medium`}>{b.flaggedCount} flagged</span>
                      )}
                    </th>
                    <td className="pr-3">{b.count}</td>
                    <td className="pr-3">{fmtAmount(b.ytdBudget)}</td>
                    <td className="pr-3">{fmtAmount(b.ytdActual)}</td>
                    <td className="pr-3"><VarianceAmount amount={b.ytdVariance} flagged={b.flagged} /></td>
                    <td className="pr-3"><VariancePct pct={b.ytdVariancePct} flagged={b.flagged} /></td>
                    <td className="pr-3">{fmtAmount(b.fyBudget)}</td>
                    <td>{fmtAmount(b.outturn)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="tabular-nums">
                <tr className="border-theme border-t-2 text-right font-semibold">
                  <th scope="row" className="py-2 pr-3 text-left">Total</th>
                  <td className="pr-3">{rows.length}</td>
                  <td className="pr-3">{fmtAmount(total.ytdBudget)}</td>
                  <td className="pr-3">{fmtAmount(total.ytdActual)}</td>
                  <td className="pr-3"><VarianceAmount amount={total.ytdVariance} flagged={total.flagged} /></td>
                  <td className="pr-3"><VariancePct pct={total.ytdVariancePct} flagged={total.flagged} /></td>
                  <td className="pr-3">{fmtAmount(total.fyBudget)}</td>
                  <td>{fmtAmount(total.outturn)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="cc-h" className="surface rounded-lg p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="cc-h" className="heading text-lg">Cost centres</h2>
          <p className="text-xs text-muted">
            <span className={FLAG_TEXT} aria-hidden="true">▲▼</span> variance over ±10% of YTD budget. Select a code for details.
          </p>
        </div>
        <div className="relative mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">Your cost centres, budget versus actual year to date as of {periodLabel(asOf)}</caption>
            <thead className="text-xs text-muted">
              <tr className="text-right">
                <th scope="col" className="py-1.5 pr-3 text-left font-medium">Code</th>
                <th scope="col" className="pr-3 text-left font-medium">Alias</th>
                <th scope="col" className="pr-3 text-left font-medium">BU</th>
                <th scope="col" className="pr-3 text-left font-medium">Owner</th>
                <th scope="col" className="pr-3 font-medium">YTD budget</th>
                <th scope="col" className="pr-3 font-medium">YTD actual</th>
                <th scope="col" className="pr-3 font-medium">Variance</th>
                <th scope="col" className="pr-3 font-medium">Var %</th>
                <th scope="col" className="font-medium">Outturn</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => (
                <tr
                  key={r.cc_code}
                  className="border-theme relative border-t text-right transition-colors hover:bg-brand/5 dark:hover:bg-brand-light/10"
                >
                  <th
                    scope="row"
                    className={`py-2 pl-2 pr-3 text-left ${r.flagged ? 'shadow-[inset_3px_0_0_0_var(--color-accent)]' : ''}`}
                  >
                    <Link
                      href={`/my/${encodeURIComponent(r.cc_code)}${q}`}
                      className="whitespace-nowrap font-mono font-bold text-brand after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-2 dark:text-brand-light"
                    >
                      {r.cc_code}
                    </Link>
                  </th>
                  <td className="pr-3 text-left">
                    {r.cc_alias}
                    {r.status !== 'Active' && (
                      <span className="ml-2 rounded bg-gray-500/15 px-1.5 py-0.5 text-[11px] font-medium text-muted">{r.status}</span>
                    )}
                  </td>
                  <td className="pr-3 text-left">{r.bu}</td>
                  <td className="pr-3 text-left">{r.owner_name ?? '—'}</td>
                  <td className="pr-3">{fmtAmount(r.ytdBudget)}</td>
                  <td className="pr-3">{fmtAmount(r.ytdActual)}</td>
                  <td className="pr-3"><VarianceAmount amount={r.ytdVariance} flagged={r.flagged} /></td>
                  <td className="pr-3"><VariancePct pct={r.ytdVariancePct} flagged={r.flagged} /></td>
                  <td>{fmtAmount(r.outturn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
