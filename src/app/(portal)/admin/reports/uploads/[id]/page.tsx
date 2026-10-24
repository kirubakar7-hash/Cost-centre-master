import { notFound } from 'next/navigation';
import { withUser } from '@/lib/db';
import { isAlertAction, kindLabel, statusLabel, uploadBatchDetail, type Issue } from '@/lib/reports';
import { requireFinancePage } from '@/components/reports/guard';
import { fmtCount, fmtMoney, shortTs } from '@/components/reports/format';
import { ReconTableFull } from '@/components/reports/Recon';
import { Changes, EmptyRow, RED, ROW, ReportHeader, Section, SodBadge, TABLE, THEAD } from '@/components/reports/ui';

export const dynamic = 'force-dynamic';

const HISTORY_SHOWN = 500;

function IssueTable({ issues, alert }: { issues: Issue[]; alert: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className={`${TABLE} min-w-[620px]`}>
        <thead className={THEAD}>
          <tr>
            <th className="py-1 pr-3">Row</th>
            <th className="pr-3">Column</th>
            <th className="pr-3">Code</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((i, n) => (
            <tr key={n} className={ROW}>
              <td className="py-1.5 pr-3 tabular-nums">{i.row ?? 'File'}</td>
              <td className="pr-3">{i.column ?? '—'}</td>
              <td className={`pr-3 font-mono text-xs ${alert ? RED : ''}`}>{i.code}</td>
              <td>{i.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function UploadBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireFinancePage();
  const { id } = await params;
  const detail = await withUser(user.email, (tx) => uploadBatchDetail(tx, id, { historyLimit: HISTORY_SHOWN }));
  if (!detail) notFound();
  const { batch: b, errors, warnings, summary, trialBalances, events, history } = detail;

  const facts: [string, React.ReactNode][] = [
    ['Batch id', <span key="id" className="break-all font-mono text-xs">{b.id}</span>],
    ['Type', kindLabel(b.kind)],
    ['File name', <span key="f" className="break-all">{b.file_name}</span>],
    ['SHA-256', <span key="sha" className="break-all font-mono text-xs">{b.file_sha256}</span>],
    ['Uploaded by', b.uploaded_by],
    ['Uploaded at (UTC)', b.uploaded_at],
    ['Status', statusLabel(b.status)],
    ['Rows / errors / warnings', `${fmtCount(b.row_count)} / ${b.error_count} / ${b.warning_count}`],
    ['Approved by', b.approved_by ?? '—'],
    ['Published by', b.published_by ?? '—'],
    ['Published at (UTC)', b.published_at ?? '—'],
    ['Segregation of duties', <SodBadge key="sod" status={b.sod} />],
  ];
  if (summary.created !== null || summary.updated !== null) {
    facts.push([
      b.kind === 'financials' ? 'Lines in file' : 'Created / updated / unchanged',
      b.kind === 'financials' ? fmtCount(summary.created ?? 0) : `${summary.created ?? 0} / ${summary.updated ?? 0} / ${summary.unchanged ?? 0}`,
    ]);
  }

  return (
    <div className="space-y-6">
      <ReportHeader
        title={`Upload: ${b.file_name}`}
        description={`${kindLabel(b.kind)} uploaded ${shortTs(b.uploaded_at)} UTC by ${b.uploaded_by}.`}
        back={{ href: '/admin/reports/uploads', label: 'Upload evidence register' }}
        exportHref={`/api/admin/reports/uploads?batch=${b.id}`}
      />

      <Section title="Batch evidence" id="facts-h">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {(b.reconciliation.length > 0 || trialBalances.length > 0) && (
        <Section
          title="Trial-balance reconciliation"
          id="recon-h"
          aside={b.reconSource === 'period register' ? 'From the period register (no reconciliation stored on this batch)' : undefined}
        >
          <ReconTableFull lines={b.reconciliation} entries={trialBalances} />
        </Section>
      )}

      <Section title={<span className={errors.length ? RED : ''}>Errors ({errors.length})</span>} id="errors-h">
        {errors.length ? <IssueTable issues={errors} alert /> : <p className="text-sm text-muted">No errors stored for this batch.</p>}
      </Section>

      {warnings.length > 0 && (
        <Section title={`Warnings (${warnings.length})`} id="warnings-h">
          <IssueTable issues={warnings} alert={false} />
        </Section>
      )}

      <Section title={`Audit trail (${events.length})`} id="events-h" aside="Upload steps and every master-data change made by this batch">
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[820px]`}>
            <thead className={THEAD}>
              <tr>
                <th className="py-1 pr-3">When (UTC)</th>
                <th className="pr-3">User</th>
                <th className="pr-3">Action</th>
                <th className="pr-3">Entity</th>
                <th>Changes / detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className={ROW}>
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{e.ts}</td>
                  <td className="whitespace-nowrap py-2 pr-3">{e.user_email}</td>
                  <td className={`whitespace-nowrap py-2 pr-3 font-semibold ${isAlertAction(e.action) ? RED : ''}`}>{e.action}</td>
                  <td className="py-2 pr-3">
                    <div>{e.entity}</div>
                    {e.entity_id && e.entity_id !== b.id && <div className="font-mono text-xs">{e.entity_id}</div>}
                  </td>
                  <td className="py-2 text-xs">
                    <Changes oldValue={e.old_value} newValue={e.new_value} />
                  </td>
                </tr>
              ))}
              {events.length === 0 && <EmptyRow colSpan={5}>No audit events are tagged with this batch.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </Section>

      {b.kind === 'financials' && (
        <Section
          title={`Financial line changes${history ? ` (${fmtCount(history.total)})` : ''}`}
          id="history-h"
          aside={history && history.total > history.lines.length ? `Showing the first ${HISTORY_SHOWN} — export for every line` : undefined}
        >
          {!history ? (
            <p className="text-sm text-muted">Line-level history is not available in this database.</p>
          ) : history.total === 0 ? (
            <p className="text-sm text-muted">
              No line-level changes are recorded for this batch (it was not published, or it was published before line history was kept).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className={`${TABLE} min-w-[860px]`}>
                <thead className={THEAD}>
                  <tr>
                    <th className="py-1 pr-3">Cost centre</th>
                    <th className="pr-3">Period</th>
                    <th className="pr-3">GL group</th>
                    <th className="pr-3">Change</th>
                    <th className="pr-3 text-right">Budget (old → new)</th>
                    <th className="text-right">Actual (old → new)</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {history.lines.map((l) => (
                    <tr key={`${l.cc_code}|${l.period}|${l.gl_group}|${l.changed_at}`} className={ROW}>
                      <td className="py-1.5 pr-3 font-mono text-xs font-semibold">
                        {l.cc_code}
                        {l.currency && <span className="ml-1 font-sans font-normal text-muted">{l.currency}</span>}
                      </td>
                      <td className="pr-3">{l.period}</td>
                      <td className="pr-3">{l.gl_group}</td>
                      <td className={`pr-3 ${l.change === 'removed' ? RED : ''}`}>{l.change ?? '—'}</td>
                      <td className="pr-3 text-right">
                        <span className="text-muted">{fmtMoney(l.old_budget, l.currency)}</span> → {fmtMoney(l.new_budget, l.currency)}
                      </td>
                      <td className="text-right">
                        <span className="text-muted">{fmtMoney(l.old_actual, l.currency)}</span> → {fmtMoney(l.new_actual, l.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
