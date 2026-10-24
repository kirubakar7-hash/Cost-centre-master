import { withUser } from '@/lib/db';
import { failedSearchQuery, failedSearches, parseFailedSearchFilters, reportBySlug, type SearchParams } from '@/lib/reports';
import { requireFinancePage } from '@/components/reports/guard';
import { fmtCount, shortTs } from '@/components/reports/format';
import { DateField, EmptyRow, FilterForm, ROW, ReportHeader, TABLE, THEAD, Tile } from '@/components/reports/ui';

export const dynamic = 'force-dynamic';

const PATH = '/admin/reports/failed-searches';
const SHOWN = 500;

export default async function FailedSearchesReport({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireFinancePage();
  const filters = parseFailedSearchFilters(await searchParams);
  const { terms, totalTerms, searches } = await withUser(user.email, (tx) => failedSearches(tx, filters, { limit: SHOWN }));
  const def = reportBySlug('failed-searches')!;

  return (
    <div className="space-y-6">
      <ReportHeader
        title={def.title}
        description="Terms employees searched for that returned nothing. Add them as keywords to the right cost centre in the next master upload."
        control={def.control}
        exportHref={`/api/admin/reports/failed-searches?${failedSearchQuery(filters)}`}
      />

      <FilterForm action={PATH}>
        <DateField name="from" label="From (UTC) — empty for all time" value={filters.from} />
        <DateField name="to" label="To (UTC, inclusive)" value={filters.to} />
      </FilterForm>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Distinct terms" value={fmtCount(totalTerms)} />
        <Tile label="Failed searches" value={fmtCount(searches)} />
      </div>

      <section className="surface min-w-0 rounded-lg p-4 sm:p-5" aria-label="Failed search terms">
        <p className="text-sm text-muted">
          Most searched first{totalTerms > terms.length ? ` · showing the top ${SHOWN} — export for every term` : ''} · times in UTC
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className={`${TABLE} min-w-[560px]`}>
            <thead className={THEAD}>
              <tr>
                <th className="py-1 pr-3">Search term</th>
                <th className="pr-3 text-right">Searches</th>
                <th className="pr-3 text-right">Users</th>
                <th className="pr-3">First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {terms.map((t) => (
                <tr key={t.term} className={ROW}>
                  <td className="py-1.5 pr-3 font-medium [overflow-wrap:anywhere]">{t.term}</td>
                  <td className="pr-3 text-right">{t.searches}</td>
                  <td className="pr-3 text-right">{t.users}</td>
                  <td className="whitespace-nowrap pr-3">{shortTs(t.first_seen)}</td>
                  <td className="whitespace-nowrap">{shortTs(t.last_seen)}</td>
                </tr>
              ))}
              {terms.length === 0 && <EmptyRow colSpan={5}>No failed searches in this period.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
