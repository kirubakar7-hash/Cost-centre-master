import Link from 'next/link';
import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { requireUser } from '@/lib/session';
import { UploadPanel } from '@/components/UploadPanel';
import { PendingApprovals, type Pending } from '@/components/admin/PendingApprovals';
import { makerCheckerEnabled, reconTolerance } from '@/lib/config';
import { pendingBatches } from '@/lib/upload/service';
import { currencyOf } from '@/lib/currency';
import { TEMPLATES } from '@/lib/upload/templates';

export const dynamic = 'force-dynamic';

interface Stats { active: number; inactive: number; no_owner: number; failed_30d: number }
interface Batch { id: string; kind: string; file_name: string; uploaded_by: string; uploaded_at: string; status: string; row_count: number; error_count: number; approved_by: string | null }
interface PeriodRow { period: string; entity: string; actual_total: string; tb_total: string; published_by: string; published_at: string }
interface Exception { cc_code: string; cc_alias: string; issue: string }

export default async function AdminPage() {
  const user = await requireUser();
  if (!user.isFinance) redirect('/');

  const makerChecker = makerCheckerEnabled();
  const { stats, batches, exceptions, pending, periods } = await withUser(user.email, async (tx) => {
    const [stats] = await tx.query<Stats>(`
      select count(*) filter (where c.status = 'Active')::int as active,
             count(*) filter (where c.status = 'Inactive')::int as inactive,
             count(*) filter (where c.status = 'Active' and o.cc_code is null)::int as no_owner,
             (select count(*)::int from ccp.failed_searches where ts > now() - interval '30 days') as failed_30d
        from ccp.cost_centres c left join ccp.cc_owners o using (cc_code)`);
    const batches = await tx.query<Batch>(`
      select id, kind, file_name, uploaded_by, to_char(uploaded_at, 'DD Mon YYYY HH24:MI') as uploaded_at,
             status, row_count, error_count, approved_by
        from ccp.upload_batches where file_sha256 <> 'seed' order by uploaded_at desc limit 10`);
    const periods = await tx.query<PeriodRow>(`
      select period, entity, actual_total::text, tb_total::text, published_by, to_char(published_at, 'DD Mon YYYY HH24:MI') as published_at
        from ccp.periods order by period desc, entity limit 24`);
    const pending = (await pendingBatches(tx)) as unknown as Pending[];
    const exceptions = await tx.query<Exception>(`
      select c.cc_code, c.cc_alias, 'Active cost centre has no owner' as issue
        from ccp.cost_centres c left join ccp.cc_owners o using (cc_code)
       where c.status = 'Active' and o.cc_code is null
      union all
      select c.cc_code, c.cc_alias, 'No keywords — harder to find in search'
        from ccp.cost_centres c where c.status = 'Active' and trim(c.keywords) = ''
      order by 1`);
    return { stats, batches, exceptions, pending, periods };
  });

  const tiles = [
    { label: 'Active cost centres', value: stats.active },
    { label: 'Inactive (retained)', value: stats.inactive },
    { label: 'Active without owner', value: stats.no_owner, alert: stats.no_owner > 0 },
    { label: 'Failed searches (30 days)', value: stats.failed_30d, alert: stats.failed_30d > 0 },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="heading text-2xl">Admin — Cost Centre Master</h1>
          <p className="text-sm text-muted">Single source of truth for cost centres and owner mapping. Finance only.</p>
        </div>
        <Link href="/admin/audit" className="btn-secondary">Audit log & failed searches</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className={`surface rounded-lg p-4 ${t.alert ? 'border-l-4 !border-l-accent' : ''}`}>
            <div className={`text-2xl font-bold ${t.alert ? 'text-accent' : 'text-brand dark:text-brand-light'}`}>{t.value}</div>
            <div className="text-xs text-muted">{t.label}</div>
          </div>
        ))}
      </div>

      <section className="surface rounded-lg p-5">
        <h2 className="heading text-lg">1. Download a template</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.values(TEMPLATES).map((t) => (
            <a key={t.kind} href={`/api/admin/templates/${t.kind}`} className="btn-secondary">
              ⭳ {t.title}
            </a>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Each template has an Instructions sheet with the column rules.</p>
      </section>

      <section className="surface rounded-lg p-5">
        <h2 className="heading text-lg">2. Upload &amp; validate (preparer)</h2>
        <p className="mt-1 text-sm text-muted">
          Any error rejects the whole file with a row-by-row report. Budget &amp; Actuals must reconcile to the trial balance.
          {makerChecker ? ' Maker-checker is on: a second Finance user approves and publishes.' : ''}
        </p>
        <UploadPanel makerChecker={makerChecker} />
      </section>

      <section className="surface rounded-lg p-5">
        <h2 className="heading text-lg">3. Awaiting approval (checker)</h2>
        <p className="mt-1 text-sm text-muted">Publishing re-validates against the current data in the same transaction.</p>
        <PendingApprovals items={pending} me={user.email} makerChecker={makerChecker} />
      </section>

      <section className="surface rounded-lg p-5">
        <h2 className="heading text-lg">Published periods</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr><th className="py-1 pr-3">Period</th><th className="pr-3">Entity</th><th className="pr-3 text-right">CC actuals</th><th className="pr-3 text-right">Trial balance</th><th className="pr-3">Status</th><th className="pr-3">Published by</th><th>When</th></tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={`${p.period}|${p.entity}`} className="border-theme border-t">
                  <td className="py-1.5 pr-3 font-medium">{p.period}</td>
                  <td className="pr-3 whitespace-nowrap">{p.entity === 'ALL' ? 'All (pre-Phase 3)' : <>{p.entity} <span className="text-xs text-muted">· {currencyOf(p.entity)}</span></>}</td>
                  <td className="pr-3 text-right">{Number(p.actual_total).toLocaleString('en-IN')}</td>
                  <td className="pr-3 text-right">{Number(p.tb_total).toLocaleString('en-IN')}</td>
                  {(() => {
                    const ok = Math.abs(Number(p.actual_total) - Number(p.tb_total)) <= reconTolerance();
                    return <td className={`pr-3 font-semibold ${ok ? 'text-brand dark:text-brand-light' : 'text-accent'}`}>{ok ? '✓ Reconciled' : '✗ Difference'}</td>;
                  })()}
                  <td className="pr-3">{p.published_by}</td>
                  <td className="whitespace-nowrap">{p.published_at}</td>
                </tr>
              ))}
              {periods.length === 0 && <tr><td colSpan={7} className="py-2 text-muted">No periods published yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface rounded-lg p-5">
        <h2 className="heading text-lg">Data quality exceptions</h2>
        {exceptions.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No exceptions. ✓</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted"><tr><th className="py-1 pr-4">Code</th><th className="pr-4">Alias</th><th>Issue</th></tr></thead>
              <tbody>
                {exceptions.map((e) => (
                  <tr key={e.cc_code + e.issue} className="border-theme border-t">
                    <td className="py-1.5 pr-4 font-mono font-semibold">{e.cc_code}</td>
                    <td className="pr-4">{e.cc_alias}</td>
                    <td className="text-accent">{e.issue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="surface rounded-lg p-5">
        <h2 className="heading text-lg">Recent uploads</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr><th className="py-1 pr-3">When</th><th className="pr-3">Type</th><th className="pr-3">File</th><th className="pr-3">By</th><th className="pr-3">Rows</th><th className="pr-3">Errors</th><th className="pr-3">Status</th><th>Approved by</th></tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-theme border-t">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{b.uploaded_at}</td>
                  <td className="pr-3">{b.kind === 'master' ? 'Master' : b.kind === 'owners' ? 'Owners' : b.kind === 'allocations' ? 'Allocations' : 'Financials'}</td>
                  <td className="pr-3 max-w-[200px] truncate" title={b.file_name}>{b.file_name}</td>
                  <td className="pr-3">{b.uploaded_by}</td>
                  <td className="pr-3">{b.row_count}</td>
                  <td className={`pr-3 ${b.error_count ? 'text-accent font-semibold' : ''}`}>{b.error_count}</td>
                  <td className="pr-3">{b.status === 'Validated' ? 'Awaiting approval' : b.status}</td>
                  <td>{b.approved_by ?? '—'}</td>
                </tr>
              ))}
              {batches.length === 0 && <tr><td colSpan={8} className="py-2 text-muted">No uploads yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
