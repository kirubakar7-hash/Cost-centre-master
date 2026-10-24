import Link from 'next/link';
import { withUser } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { availablePeriods, consolidate, listMyCostCentres, type CcSummary } from '@/lib/financials';
import { currencyOf, ENTITY_CURRENCY } from '@/lib/currency';
import { fiscalYear, periodLabel, variance } from '@/lib/fiscal';
import { resolveAsOf } from '@/components/cc/period';
import { PeriodSelector } from '@/components/cc/PeriodSelector';
import { StatTile } from '@/components/cc/StatTile';
import { FlagMarker, VarianceAmount, VariancePct } from '@/components/cc/Variance';
import { FLAG_TEXT, fmtAmount, fmtPct, fmtSigned } from '@/components/cc/format';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ENTITY_NAME: Record<string, string> = { IN: 'India', US: 'US', UK: 'UK' };
const CURRENCY_ORDER = [...new Set(Object.values(ENTITY_CURRENCY))];

/**
 * Amounts in different currencies are never added together: rows are grouped
 * by their entity's currency and each group is consolidated on its own.
 */
function groupByCurrency(rows: CcSummary[]) {
  const by = new Map<string, CcSummary[]>();
  for (const r of rows) {
    const c = currencyOf(r.entity);
    by.set(c, [...(by.get(c) ?? []), r]);
  }
  const rank = (c: string) => {
    const i = CURRENCY_ORDER.indexOf(c);
    return i === -1 ? CURRENCY_ORDER.length : i;
  };
  return [...by.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([currency, list]) => {
      const entities = [...new Set(list.map((r) => r.entity))].sort();
      const names = entities.map((e) => ENTITY_NAME[e] ?? e).join(', ');
      return {
        currency,
        label: `${currency} — ${names} ${entities.length === 1 ? 'entity' : 'entities'}`,
        rows: list,
        ...consolidate(list),
      };
    });
}

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
  const groups = groupByCurrency(rows);
  const multiCurrency = groups.length > 1;
  const fy = fiscalYear(asOf);
  const ytdRange = `${periodLabel(fy.start)} – ${periodLabel(asOf)}`;
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
        {multiCurrency && (
          <p className="mt-1 text-xs text-muted">
            Amounts are in each entity&apos;s own currency. Totals in different currencies are never added together.
          </p>
        )}
        {groups.map((g) => {
          const t = g.total;
          const outturnVsBudget = variance(t.fyBudget, t.outturn);
          const headingId = `kpi-${g.currency}`;
          return (
            <div key={g.currency} role="group" aria-labelledby={headingId} className="mt-3">
              <h3 id={headingId} className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
                {g.label}
                <span className="text-xs font-normal text-muted">
                  {multiCurrency
                    ? `${g.rows.length} cost centre${g.rows.length === 1 ? '' : 's'} · amounts in ${g.currency}`
                    : `All amounts in ${g.currency}`}
                </span>
              </h3>
              <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-5">
                <StatTile label="YTD budget" value={fmtAmount(t.ytdBudget, g.currency)} sub={ytdRange} />
                <StatTile label="YTD actual" value={fmtAmount(t.ytdActual, g.currency)} sub={ytdRange} />
                <StatTile
                  label="YTD variance"
                  flagged={t.flagged}
                  value={
                    <>
                      {t.flagged && <FlagMarker amount={t.ytdVariance} />}
                      {fmtSigned(t.ytdVariance, g.currency)}
                    </>
                  }
                  sub={<span className={t.flagged ? `${FLAG_TEXT} font-semibold` : ''}>{fmtPct(t.ytdVariancePct)} vs budget</span>}
                />
                <StatTile label="Full-year budget" value={fmtAmount(t.fyBudget, g.currency)} sub={fy.label} />
                <StatTile
                  className="col-span-2 lg:col-span-1"
                  label="Full-year outturn"
                  value={fmtAmount(t.outturn, g.currency)}
                  sub={`${fmtSigned(outturnVsBudget.amount, g.currency)} (${fmtPct(outturnVsBudget.pct)}) vs FY budget`}
                />
              </div>
            </div>
          );
        })}
        <p className="mt-2 text-xs text-muted">Outturn = YTD actual + budget for the remaining months of {fy.label}.</p>
      </section>

      {showByBu && (
        <section aria-labelledby="bu-h" className="surface rounded-lg p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="bu-h" className="heading text-lg">By business unit</h2>
            <p className="text-xs text-muted">{multiCurrency ? 'One total per currency' : `All amounts in ${groups[0].currency}`}</p>
          </div>
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">
                Consolidated budget versus actual by business unit and currency, as of {periodLabel(asOf)}
              </caption>
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
              {groups.map((g) => (
                <tbody key={g.currency} className="tabular-nums">
                  {multiCurrency && (
                    <tr>
                      <th scope="colgroup" colSpan={8} className="pb-1 pt-4 text-left text-xs font-semibold text-brand dark:text-brand-light">
                        {g.label}
                      </th>
                    </tr>
                  )}
                  {g.byBu.map((b) => (
                    <tr key={b.bu} className="border-theme border-t text-right">
                      <th scope="row" className="py-2 pr-3 text-left font-semibold">
                        {b.bu}
                        {b.flaggedCount > 0 && (
                          <span className={`${FLAG_TEXT} ml-2 text-xs font-medium`}>{b.flaggedCount} flagged</span>
                        )}
                      </th>
                      <td className="pr-3">{b.count}</td>
                      <td className="pr-3">{fmtAmount(b.ytdBudget, g.currency)}</td>
                      <td className="pr-3">{fmtAmount(b.ytdActual, g.currency)}</td>
                      <td className="pr-3"><VarianceAmount amount={b.ytdVariance} flagged={b.flagged} currency={g.currency} /></td>
                      <td className="pr-3"><VariancePct pct={b.ytdVariancePct} flagged={b.flagged} /></td>
                      <td className="pr-3">{fmtAmount(b.fyBudget, g.currency)}</td>
                      <td>{fmtAmount(b.outturn, g.currency)}</td>
                    </tr>
                  ))}
                  <tr className="border-theme border-t-2 text-right font-semibold">
                    <th scope="row" className="py-2 pr-3 text-left">Total {g.currency}</th>
                    <td className="pr-3">{g.rows.length}</td>
                    <td className="pr-3">{fmtAmount(g.total.ytdBudget, g.currency)}</td>
                    <td className="pr-3">{fmtAmount(g.total.ytdActual, g.currency)}</td>
                    <td className="pr-3"><VarianceAmount amount={g.total.ytdVariance} flagged={g.total.flagged} currency={g.currency} /></td>
                    <td className="pr-3"><VariancePct pct={g.total.ytdVariancePct} flagged={g.total.flagged} /></td>
                    <td className="pr-3">{fmtAmount(g.total.fyBudget, g.currency)}</td>
                    <td>{fmtAmount(g.total.outturn, g.currency)}</td>
                  </tr>
                </tbody>
              ))}
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="cc-h" className="surface rounded-lg p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="cc-h" className="heading text-lg">Cost centres</h2>
          <p className="text-xs text-muted">
            <span className={FLAG_TEXT} aria-hidden="true">▲▼</span> variance over ±10% of YTD budget. Amounts in each cost centre&apos;s own
            currency. Select a code for details.
          </p>
        </div>
        <div className="relative mt-3 overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <caption className="sr-only">Your cost centres, budget versus actual year to date as of {periodLabel(asOf)}</caption>
            <thead className="text-xs text-muted">
              <tr className="text-right">
                <th scope="col" className="py-1.5 pr-3 text-left font-medium">Code</th>
                <th scope="col" className="pr-3 text-left font-medium">Alias</th>
                <th scope="col" className="pr-3 text-left font-medium">BU</th>
                <th scope="col" className="pr-3 text-left font-medium">Owner</th>
                <th scope="col" className="pr-3 text-left font-medium">Currency</th>
                <th scope="col" className="pr-3 font-medium">YTD budget</th>
                <th scope="col" className="pr-3 font-medium">YTD actual</th>
                <th scope="col" className="pr-3 font-medium">Variance</th>
                <th scope="col" className="pr-3 font-medium">Var %</th>
                <th scope="col" className="font-medium">Outturn</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r) => {
                const cur = currencyOf(r.entity);
                return (
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
                    <td className="pr-3 text-left text-xs font-medium text-muted">{cur}</td>
                    <td className="pr-3">{fmtAmount(r.ytdBudget, cur)}</td>
                    <td className="pr-3">{fmtAmount(r.ytdActual, cur)}</td>
                    <td className="pr-3"><VarianceAmount amount={r.ytdVariance} flagged={r.flagged} currency={cur} /></td>
                    <td className="pr-3"><VariancePct pct={r.ytdVariancePct} flagged={r.flagged} /></td>
                    <td>{fmtAmount(r.outturn, cur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
