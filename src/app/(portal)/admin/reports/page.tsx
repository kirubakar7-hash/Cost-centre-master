import Link from 'next/link';
import { withUser } from '@/lib/db';
import {
  REPORTS,
  accessReview,
  auditLog,
  commentaryCoverage,
  failedSearchQuery,
  failedSearches,
  parseAccessFilters,
  parseAuditFilters,
  parseCoverageFilters,
  parseFailedSearchFilters,
  parseUploadFilters,
  uploadRegister,
  utcDate,
  type ReportSlug,
} from '@/lib/reports';
import { periodLabel } from '@/lib/fiscal';
import { requireFinancePage } from '@/components/reports/guard';
import { fmtCount, fmtShare } from '@/components/reports/format';
import { DownloadIcon, RED } from '@/components/reports/ui';

export const dynamic = 'force-dynamic';

type Headline = { text: string; alert?: boolean }[];

export default async function ReportsPage() {
  const user = await requireFinancePage();

  const headlines = await withUser(user.email, async (tx): Promise<Record<ReportSlug, Headline>> => {
    const since = utcDate(-30);
    const audit = await auditLog(tx, { ...parseAuditFilters({}), from: since }, { limit: 1 });
    const uploads = await uploadRegister(tx, parseUploadFilters({}), { limit: 1 });
    const access = await accessReview(tx, parseAccessFilters({}));
    const coverage = await commentaryCoverage(tx, parseCoverageFilters({}));
    const misses = await failedSearches(tx, parseFailedSearchFilters({}), { limit: 1 });
    return {
      'audit-log': [{ text: `${fmtCount(audit.total)} events in the last 30 days` }],
      uploads: [
        { text: `${fmtCount(uploads.total)} upload${uploads.total === 1 ? '' : 's'}` },
        uploads.violations > 0
          ? { text: `${uploads.violations} segregation-of-duties violation${uploads.violations === 1 ? '' : 's'}`, alert: true }
          : { text: 'No segregation-of-duties violations' },
      ],
      'access-review': [
        { text: `${access.users} users · ${access.totalRows} access rights` },
        access.exceptions.length > 0
          ? { text: `${access.exceptions.length} exception${access.exceptions.length === 1 ? '' : 's'}`, alert: true }
          : { text: 'No exceptions' },
      ],
      commentary: coverage.period
        ? [
            { text: `${periodLabel(coverage.period)}: ${fmtShare(coverage.kpi.pct)} of ${coverage.kpi.flagged} flagged lines explained` },
            ...(coverage.kpi.unexplained > 0 ? [{ text: `${coverage.kpi.unexplained} unexplained`, alert: true }] : []),
          ]
        : [{ text: 'No actuals published yet' }],
      'failed-searches': [{ text: `${fmtCount(misses.totalTerms)} terms · ${fmtCount(misses.searches)} searches in the last 90 days` }],
    };
  });

  const exportHref = (slug: ReportSlug) =>
    `/api/admin/reports/${slug}${slug === 'failed-searches' ? `?${failedSearchQuery(parseFailedSearchFilters({}))}` : ''}`;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-brand hover:underline dark:text-brand-light">
          ← Admin
        </Link>
        <h1 className="heading mt-1 text-2xl sm:text-3xl">Reports</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Audit and control evidence for Finance. Each report can be filtered and exported to Excel; every export is
          recorded in the audit log. Times are in UTC.
        </p>
      </div>

      <ul className="grid gap-4 md:grid-cols-2">
        {REPORTS.map((r) => (
          <li key={r.slug} className="surface flex min-w-0 flex-col rounded-lg p-5">
            <h2 className="heading text-lg">
              <Link href={`/admin/reports/${r.slug}`} className="hover:underline">
                {r.title}
              </Link>
            </h2>
            <p className="mt-1 text-sm">{r.description}</p>
            <p className="mt-2 text-xs text-muted">
              <span className="font-semibold">Control:</span> {r.control}
            </p>
            <ul className="mt-3 space-y-0.5 text-sm">
              {headlines[r.slug].map((h) => (
                <li key={h.text} className={h.alert ? `${RED} font-semibold` : 'text-brand dark:text-brand-light'}>
                  {h.alert ? '✗ ' : ''}
                  {h.text}
                </li>
              ))}
            </ul>
            <div className="mt-auto flex flex-wrap gap-2 pt-4">
              <Link href={`/admin/reports/${r.slug}`} className="btn-primary">
                Open report
              </Link>
              <a href={exportHref(r.slug)} className="btn-secondary" download>
                <DownloadIcon />
                Export
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
