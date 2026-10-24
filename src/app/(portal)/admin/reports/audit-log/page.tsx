import { withUser } from '@/lib/db';
import {
  PAGE_SIZE,
  auditLog,
  auditQuery,
  isAlertAction,
  isUuid,
  parseAuditFilters,
  reportBySlug,
  type SearchParams,
} from '@/lib/reports';
import { requireFinancePage } from '@/components/reports/guard';
import { fmtCount } from '@/components/reports/format';
import {
  BatchLink,
  Changes,
  DateField,
  EmptyRow,
  FilterForm,
  MultiCheckField,
  Pagination,
  RED,
  ROW,
  ReportHeader,
  SelectField,
  TABLE,
  THEAD,
  TextField,
} from '@/components/reports/ui';

export const dynamic = 'force-dynamic';

const PATH = '/admin/reports/audit-log';

export default async function AuditLogReport({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireFinancePage();
  const requested = parseAuditFilters(await searchParams);
  const { rows, total, filters, options } = await withUser(user.email, (tx) => auditLog(tx, requested));
  const def = reportBySlug('audit-log')!;
  const query = auditQuery(filters);
  const first = (filters.page - 1) * PAGE_SIZE;

  return (
    <div className="space-y-6">
      <ReportHeader title={def.title} description={def.description} control={def.control} exportHref={`/api/admin/reports/audit-log?${query}`} />

      <FilterForm action={PATH}>
        <DateField name="from" label="From (UTC)" value={filters.from} />
        <DateField name="to" label="To (UTC, inclusive)" value={filters.to} />
        <TextField name="user" label="User email contains" value={filters.user} placeholder="e.g. kavya" />
        <MultiCheckField name="action" label="Action" options={options.actions} selected={filters.actions} />
        <SelectField name="entity" label="Entity" value={filters.entity} options={options.entities.map((e) => ({ value: e, label: e }))} />
        <TextField name="entityId" label="Entity id contains" value={filters.entityId} placeholder="e.g. IN-ENG-101" />
      </FilterForm>

      <section className="surface min-w-0 rounded-lg p-4 sm:p-5" aria-label="Audit events">
        <p className="text-sm text-muted">
          {total === 0
            ? 'No events match these filters.'
            : `${fmtCount(first + 1)}–${fmtCount(Math.min(first + rows.length, total))} of ${fmtCount(total)} events · newest first · times in UTC`}
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className={`${TABLE} min-w-[900px]`}>
            <thead className={THEAD}>
              <tr>
                <th className="w-36 py-1 pr-3">When (UTC)</th>
                <th className="pr-3">User</th>
                <th className="pr-3">Action</th>
                <th className="pr-3">Entity</th>
                <th>Changes / detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const batch = a.batch_id ?? (a.entity === 'upload_batch' && a.entity_id && isUuid(a.entity_id) ? a.entity_id : null);
                return (
                  <tr key={a.id} className={ROW}>
                    <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{a.ts}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{a.user_email}</td>
                    <td className={`whitespace-nowrap py-2 pr-3 font-semibold ${isAlertAction(a.action) ? RED : ''}`}>{a.action}</td>
                    <td className="py-2 pr-3">
                      <div className="whitespace-nowrap">{a.entity}</div>
                      {a.entity_id && a.entity_id !== batch && <div className="break-all font-mono text-xs">{a.entity_id}</div>}
                      {batch && (
                        <div className="text-xs text-muted">
                          batch <BatchLink id={batch} />
                        </div>
                      )}
                    </td>
                    <td className="py-2 text-xs">
                      <Changes oldValue={a.old_value} newValue={a.new_value} />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <EmptyRow colSpan={5} />}
            </tbody>
          </table>
        </div>
        <Pagination path={PATH} query={query} page={filters.page} pageSize={PAGE_SIZE} total={total} />
      </section>
    </div>
  );
}
