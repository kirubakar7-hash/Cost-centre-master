import Link from 'next/link';
import { withUser } from '@/lib/db';
import {
  PAGE_SIZE,
  UPLOAD_STATUSES,
  kindLabel,
  parseUploadFilters,
  reportBySlug,
  statusLabel,
  uploadQuery,
  uploadRegister,
  type SearchParams,
} from '@/lib/reports';
import { requireFinancePage } from '@/components/reports/guard';
import { fmtCount, shortTs } from '@/components/reports/format';
import { ReconSummary } from '@/components/reports/Recon';
import {
  DateField,
  EmptyRow,
  FilterForm,
  Pagination,
  RED,
  ROW,
  ReportHeader,
  SelectField,
  SodBadge,
  TABLE,
  THEAD,
  Tile,
} from '@/components/reports/ui';

export const dynamic = 'force-dynamic';

const PATH = '/admin/reports/uploads';

export default async function UploadRegisterReport({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireFinancePage();
  const requested = parseUploadFilters(await searchParams);
  const { rows, total, filters, kinds, violations } = await withUser(user.email, (tx) => uploadRegister(tx, requested));
  const def = reportBySlug('uploads')!;
  const query = uploadQuery(filters);

  return (
    <div className="space-y-6">
      <ReportHeader title={def.title} description={def.description} control={def.control} exportHref={`/api/admin/reports/uploads?${query}`} />

      <FilterForm action={PATH}>
        <DateField name="from" label="Uploaded from (UTC)" value={filters.from} />
        <DateField name="to" label="Uploaded to (UTC, inclusive)" value={filters.to} />
        <SelectField name="kind" label="Type" value={filters.kind} options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))} />
        <SelectField name="status" label="Status" value={filters.status} options={UPLOAD_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))} />
      </FilterForm>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Uploads matching" value={fmtCount(total)} />
        <Tile
          label="Segregation-of-duties violations"
          value={violations}
          alert={violations > 0}
          sub={violations > 0 ? 'Uploader approved their own file' : 'Every published upload had a second approver'}
        />
      </div>

      <section className="surface min-w-0 rounded-lg p-4 sm:p-5" aria-label="Upload batches">
        <p className="text-sm text-muted">
          Newest first · times in UTC · open a batch for its errors, the changes it made and its audit trail. The SHA-256
          fingerprint proves which file was loaded.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className={`${TABLE} min-w-[1040px]`}>
            <thead className={THEAD}>
              <tr>
                <th className="py-1 pr-3">Uploaded (UTC)</th>
                <th className="pr-3">Type / file</th>
                <th className="pr-3">Uploaded by</th>
                <th className="pr-3">Status</th>
                <th className="pr-3 text-right">Rows</th>
                <th className="pr-3 text-right">Errors</th>
                <th className="pr-3">Approved / published</th>
                <th className="pr-3">Segregation of duties</th>
                <th title="Cost-centre actuals vs trial balance">TB reconciliation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className={ROW}>
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{shortTs(b.uploaded_at)}</td>
                  <td className="max-w-[220px] py-2 pr-3">
                    <div className="text-xs text-muted">{kindLabel(b.kind)}</div>
                    <Link href={`${PATH}/${b.id}`} className="block truncate font-medium text-brand hover:underline dark:text-brand-light" title={b.file_name}>
                      {b.file_name}
                    </Link>
                    <div className="truncate font-mono text-[11px] text-muted" title={`SHA-256 ${b.file_sha256}`}>
                      {b.file_sha256.slice(0, 16)}
                      {b.file_sha256.length > 16 ? '…' : ''}
                    </div>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">{b.uploaded_by}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{statusLabel(b.status)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtCount(b.row_count)}</td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${b.error_count ? `${RED} font-semibold` : ''}`}>
                    {b.error_count}
                    {b.warning_count > 0 && <div className="text-xs font-normal text-muted">{b.warning_count} warn.</div>}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {b.approved_by || b.published_by ? (
                      <>
                        <div className="whitespace-nowrap">{b.approved_by ?? b.published_by}</div>
                        {b.published_by && b.published_by !== b.approved_by && <div className="whitespace-nowrap">published by {b.published_by}</div>}
                        <div className="text-muted">{shortTs(b.published_at)}</div>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <SodBadge status={b.sod} />
                  </td>
                  <td className="py-2">
                    <ReconSummary lines={b.reconciliation} />
                    {b.reconSource === 'period register' && <div className="text-[11px] text-muted">from the period register</div>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <EmptyRow colSpan={9} />}
            </tbody>
          </table>
        </div>
        <Pagination path={PATH} query={query} page={filters.page} pageSize={PAGE_SIZE} total={total} />
      </section>
    </div>
  );
}
