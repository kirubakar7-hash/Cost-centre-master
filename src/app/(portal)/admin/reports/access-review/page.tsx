import { withUser } from '@/lib/db';
import {
  ACCESS_ROLES,
  EXCEPTION_LABELS,
  EXCEPTION_SHORT,
  ROLE_LABELS,
  accessQuery,
  accessReview,
  parseAccessFilters,
  reportBySlug,
  scopeText,
  type AccessException,
  type AccessExceptionKind,
  type SearchParams,
} from '@/lib/reports';
import { requireFinancePage } from '@/components/reports/guard';
import { shortTs } from '@/components/reports/format';
import {
  CheckboxField,
  EmptyRow,
  FilterForm,
  Pill,
  RED,
  ROW,
  ReportHeader,
  SelectField,
  TABLE,
  THEAD,
  TextField,
  Tile,
} from '@/components/reports/ui';

export const dynamic = 'force-dynamic';

const PATH = '/admin/reports/access-review';

export default async function AccessReviewReport({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireFinancePage();
  const requested = parseAccessFilters(await searchParams);
  const review = await withUser(user.email, (tx) => accessReview(tx, requested));
  const { rows, filters, exceptions, usersByRole } = review;
  const def = reportBySlug('access-review')!;
  const query = accessQuery(filters);

  const grouped = new Map<AccessExceptionKind, AccessException[]>();
  for (const e of exceptions) grouped.set(e.kind, [...(grouped.get(e.kind) ?? []), e]);

  return (
    <div className="space-y-6">
      <ReportHeader
        title={def.title}
        description="Every access right to cost-centre data — from the owner mapping (owner, backup owner, BU head per cost centre) and from explicit grants (Finance, Management, BU-wide and per-cost-centre grants). Certify each row, or remove the access."
        control={def.control}
        exportHref={`/api/admin/reports/access-review?${query}`}
      />

      <FilterForm action={PATH}>
        <TextField name="user" label="User email contains" value={filters.user} placeholder="e.g. meena" />
        <SelectField name="role" label="Role" value={filters.role} options={ACCESS_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        <SelectField name="bu" label="Business unit" value={filters.bu} options={review.bus.map((b) => ({ value: b, label: b }))} />
        <CheckboxField name="exceptions" label="Exceptions only" checked={filters.exceptionsOnly} />
      </FilterForm>

      <section aria-labelledby="summary-h">
        <h2 id="summary-h" className="heading text-lg">
          Users by role
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="Users" value={review.users} sub={`${rows.length} access rights`} />
          {ACCESS_ROLES.map((r) => (
            <Tile key={r} label={ROLE_LABELS[r]} value={usersByRole[r]} />
          ))}
        </div>
        {filters.bu && <p className="mt-2 text-xs text-muted">Finance and Management grants cover every business unit, so they are included under a BU filter.</p>}
      </section>

      <section
        className={`surface min-w-0 rounded-lg p-4 sm:p-5 ${exceptions.length ? 'border-l-4 !border-l-accent' : ''}`}
        aria-labelledby="exceptions-h"
      >
        <h2 id="exceptions-h" className={`text-lg font-semibold ${exceptions.length ? RED : 'heading'}`}>
          {exceptions.length ? `${exceptions.length} exception${exceptions.length === 1 ? '' : 's'} to resolve` : 'No exceptions ✓'}
        </h2>
        <p className="mt-1 text-xs text-muted">Checked across all access, whatever the filters.</p>
        {exceptions.length > 0 && (
          <div className="mt-3 space-y-4">
            {[...grouped].map(([kind, list]) => (
              <div key={kind}>
                <h3 className={`text-sm font-semibold ${RED}`}>
                  ✗ {EXCEPTION_LABELS[kind]} ({list.length})
                </h3>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm [overflow-wrap:anywhere]">
                  {list.map((e) => (
                    <li key={`${e.user_email}|${e.cc_code}|${e.detail}`}>{e.detail}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="surface min-w-0 rounded-lg p-4 sm:p-5" aria-labelledby="rights-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="rights-h" className="heading text-lg">
            Access rights ({rows.length})
          </h2>
          <p className="text-xs text-muted">For owner-mapping rows, “granted” is the last change to that cost centre’s mapping. Times in UTC.</p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className={`${TABLE} min-w-[1080px]`}>
            <thead className={THEAD}>
              <tr>
                <th className="py-1 pr-3">User</th>
                <th className="pr-3">Role</th>
                <th className="pr-3">Scope</th>
                <th className="pr-3">BU</th>
                <th className="pr-3">CC status</th>
                <th className="pr-3">Source</th>
                <th className="pr-3">Granted by / at</th>
                <th>Exceptions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.user_email}|${r.role}|${r.scope}|${r.cc_code ?? r.bu ?? ''}|${r.source}`} className={ROW}>
                  <td className="whitespace-nowrap py-2 pr-3">{r.user_email}</td>
                  <td className="whitespace-nowrap py-2 pr-3 font-medium">{ROLE_LABELS[r.role]}</td>
                  <td className="py-2 pr-3">
                    {r.scope === 'cc' ? (
                      <>
                        <span className="font-mono text-xs font-semibold">{r.cc_code}</span>
                        {r.cc_alias && <span className="text-muted"> {r.cc_alias}</span>}
                      </>
                    ) : (
                      scopeText(r)
                    )}
                  </td>
                  <td className="py-2 pr-3">{r.bu ?? 'All'}</td>
                  <td className={`py-2 pr-3 ${r.cc_status === 'Inactive' ? `${RED} font-semibold` : ''}`}>{r.cc_status ?? '—'}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{r.source}</td>
                  <td className="py-2 pr-3 text-xs">
                    <div className="whitespace-nowrap">{r.granted_by ?? '—'}</div>
                    <div className="text-muted">{shortTs(r.granted_at)}</div>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.exceptions.map((k) => (
                        <Pill key={k} alert>
                          {EXCEPTION_SHORT[k]}
                        </Pill>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <EmptyRow colSpan={8} />}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
