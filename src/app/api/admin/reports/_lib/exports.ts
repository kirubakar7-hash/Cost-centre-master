/**
 * Report name + query string -> the rows and sheet layout of its Excel export.
 * Runs inside the caller's withUser transaction (RLS applies); the filters go
 * through the same parse/whitelist functions as the report pages.
 */
import type { Tx } from '@/lib/db';
import {
  EXCEPTION_LABELS,
  EXCEPTION_SHORT,
  EXPORT_CAP,
  ROLE_LABELS,
  SOD_LABEL,
  accessReview,
  auditChanges,
  auditLog,
  changeText,
  commentaryCoverage,
  describeAccessFilters,
  describeAuditFilters,
  describeCoverageFilters,
  describeFailedSearchFilters,
  describeUploadFilters,
  failedSearches,
  isAlertAction,
  kindLabel,
  parseAccessFilters,
  parseAuditFilters,
  parseCoverageFilters,
  parseFailedSearchFilters,
  parseUploadFilters,
  reportBySlug,
  scopeText,
  statusLabel,
  uploadBatchDetail,
  uploadRegister,
  type AuditRow,
  type FilterLines,
  type ReconLine,
  type ReportSlug,
  type SearchParams,
  type UploadRow,
} from '@/lib/reports';
import { AMT, AMT2, PCT, type Cell, type Column, type SheetSpec } from './workbook';

export interface ExportResult {
  title: string;
  filters: FilterLines;
  sheets: SheetSpec[];
  /** Effective (whitelisted) filters, recorded with the EXPORT audit event. */
  logDetail: Record<string, unknown>;
  fileName: string;
}

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
const reconLabel = (l: ReconLine) => (l.entity && l.entity !== 'ALL' ? `${l.period} ${l.entity}` : l.period);
const reconText = (lines: ReconLine[]) =>
  lines
    .map((l) => `${reconLabel(l)}: actuals ${l.actualTotal} vs TB ${l.tbTotal ?? 'not entered'} (diff ${l.difference ?? '—'}) ${l.matched ? '✓' : '✗'}`)
    .join('\n');
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

const AUDIT_COLUMNS: Column[] = [
  { header: 'Event id', key: 'id', width: 10 },
  { header: 'When (UTC)', key: 'ts', width: 20 },
  { header: 'User', key: 'user_email', width: 30 },
  { header: 'Action', key: 'action', width: 18 },
  { header: 'Entity', key: 'entity', width: 16 },
  { header: 'Entity id', key: 'entity_id', width: 22 },
  { header: 'Batch id', key: 'batch_id', width: 38 },
  { header: 'Changes (field: old → new)', key: 'changes', width: 70, wrap: true },
  { header: 'Old value (JSON)', key: 'old_value', width: 40 },
  { header: 'New value (JSON)', key: 'new_value', width: 40 },
];
const auditRow = (a: AuditRow): Record<string, Cell> => ({
  id: a.id,
  ts: a.ts,
  user_email: a.user_email,
  action: a.action,
  entity: a.entity,
  entity_id: a.entity_id,
  batch_id: a.batch_id,
  changes: auditChanges(a.old_value, a.new_value).map(changeText).join('\n'),
  old_value: json(a.old_value),
  new_value: json(a.new_value),
});
const alertAction = (r: Record<string, Cell>) => (isAlertAction(String(r.action)) ? ['action'] : []);

const REGISTER_COLUMNS: Column[] = [
  { header: 'Batch id', key: 'id', width: 38 },
  { header: 'Type', key: 'kind', width: 18 },
  { header: 'File name', key: 'file_name', width: 30 },
  { header: 'SHA-256', key: 'file_sha256', width: 66 },
  { header: 'Uploaded by', key: 'uploaded_by', width: 28 },
  { header: 'Uploaded at (UTC)', key: 'uploaded_at', width: 20 },
  { header: 'Status', key: 'status', width: 18 },
  { header: 'Rows', key: 'row_count', width: 8, numFmt: AMT },
  { header: 'Errors', key: 'error_count', width: 8 },
  { header: 'Warnings', key: 'warning_count', width: 9 },
  { header: 'Approved by', key: 'approved_by', width: 28 },
  { header: 'Published by', key: 'published_by', width: 28 },
  { header: 'Published at (UTC)', key: 'published_at', width: 20 },
  { header: 'Segregation of duties', key: 'sod', width: 28 },
  { header: 'Reconciliation', key: 'recon', width: 60, wrap: true },
  { header: 'Reconciliation source', key: 'recon_source', width: 18 },
];
const registerRow = (b: UploadRow): Record<string, Cell> => ({
  ...b,
  kind: kindLabel(b.kind),
  status: statusLabel(b.status),
  sod: SOD_LABEL[b.sod],
  sod_status: b.sod,
  recon: reconText(b.reconciliation),
  recon_source: b.reconSource,
  reconciliation: null,
  recon_bad: b.reconciliation.some((l) => !l.matched),
});

const RECON_COLUMNS: Column[] = [
  { header: 'Batch id', key: 'batch_id', width: 38 },
  { header: 'File name', key: 'file_name', width: 30 },
  { header: 'Period', key: 'period', width: 10 },
  { header: 'Entity', key: 'entity', width: 8 },
  { header: 'Currency', key: 'currency', width: 9 },
  { header: 'CC actuals total', key: 'actualTotal', width: 18, numFmt: AMT2 },
  { header: 'Trial balance total', key: 'tbTotal', width: 18, numFmt: AMT2 },
  { header: 'Difference', key: 'difference', width: 14, numFmt: AMT2 },
  { header: 'Status', key: 'status', width: 16 },
  { header: 'Source', key: 'source', width: 18 },
];
const reconRows = (b: UploadRow) =>
  b.reconciliation.map((l) => ({
    batch_id: b.id,
    file_name: b.file_name,
    period: l.period,
    entity: l.entity ?? null,
    currency: l.currency ?? null,
    actualTotal: l.actualTotal,
    tbTotal: l.tbTotal,
    difference: l.difference,
    status: l.tbTotal === null ? 'TB not entered' : l.matched ? 'Reconciled' : 'Does not match',
    source: b.reconSource,
  }));
const reconRed = (r: Record<string, Cell>) => (r.status === 'Does not match' ? ['difference', 'status'] : []);

export async function collectExport(tx: Tx, slug: ReportSlug, params: SearchParams): Promise<ExportResult | null> {
  const title = reportBySlug(slug)!.title;

  switch (slug) {
    case 'audit-log': {
      const { rows, total, filters } = await auditLog(tx, parseAuditFilters(params), { limit: EXPORT_CAP, offset: 0 });
      const { page: _page, ...logDetail } = filters;
      return {
        title,
        filters: describeAuditFilters(filters),
        logDetail,
        fileName: `audit-log_${stamp()}.xlsx`,
        sheets: [{ name: 'Audit log', columns: AUDIT_COLUMNS, rows: rows.map(auditRow), totalRows: total, redCells: alertAction, notes: ['Newest first.'] }],
      };
    }

    case 'uploads': {
      const batchId = typeof params.batch === 'string' ? params.batch : null;
      if (batchId !== null) return collectBatch(tx, batchId);
      const { rows, total, filters, violations } = await uploadRegister(tx, parseUploadFilters(params), { limit: EXPORT_CAP, offset: 0 });
      const { page: _page, ...logDetail } = filters;
      return {
        title,
        filters: describeUploadFilters(filters),
        logDetail,
        fileName: `upload-evidence-register_${stamp()}.xlsx`,
        sheets: [
          {
            name: 'Register',
            columns: REGISTER_COLUMNS,
            rows: rows.map(registerRow),
            totalRows: total,
            flagRow: (r) => r.sod_status === 'violation',
            redCells: (r) => [...(r.sod_status === 'violation' ? ['sod'] : []), ...(Number(r.error_count) > 0 ? ['error_count'] : []), ...(r.recon_bad ? ['recon'] : [])],
            notes: [
              `Segregation of duties: ✓ when the approver differs from the uploader. Violations in this selection: ${violations}.`,
              '"System seed" = demo data loaded by the system, not a person.',
            ],
          },
          { name: 'Reconciliation', columns: RECON_COLUMNS, rows: rows.flatMap(reconRows), redCells: reconRed },
        ],
      };
    }

    case 'access-review': {
      const r = await accessReview(tx, parseAccessFilters(params));
      return {
        title,
        filters: describeAccessFilters(r.filters),
        logDetail: { ...r.filters },
        fileName: `user-access-review_${stamp()}.xlsx`,
        sheets: [
          {
            name: 'Summary',
            columns: [
              { header: 'Role', key: 'role', width: 22 },
              { header: 'Users', key: 'users', width: 10 },
            ],
            rows: [
              ...(Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[]).map((k) => ({ role: ROLE_LABELS[k], users: r.usersByRole[k] })),
              { role: 'All users (distinct)', users: r.users },
              { role: 'Access rights', users: r.rows.length },
              { role: 'Exceptions', users: r.exceptions.length },
            ],
            redCells: (row) => (row.role === 'Exceptions' && Number(row.users) > 0 ? ['users'] : []),
          },
          {
            name: 'Exceptions',
            columns: [
              { header: 'Exception', key: 'kind', width: 46 },
              { header: 'User', key: 'user_email', width: 30 },
              { header: 'Cost centre', key: 'cc_code', width: 14 },
              { header: 'Detail', key: 'detail', width: 90, wrap: true },
            ],
            rows: r.exceptions.map((e) => ({ ...e, kind: EXCEPTION_LABELS[e.kind] })),
            redCells: () => ['kind'],
            notes: ['Checked across all access, whatever the filters.'],
          },
          {
            name: 'Access rights',
            columns: [
              { header: 'User', key: 'user_email', width: 30 },
              { header: 'Role', key: 'role', width: 14 },
              { header: 'Scope', key: 'scope', width: 40 },
              { header: 'Cost centre', key: 'cc_code', width: 14 },
              { header: 'BU', key: 'bu', width: 18 },
              { header: 'CC status', key: 'cc_status', width: 10 },
              { header: 'Source', key: 'source', width: 16 },
              { header: 'Granted by', key: 'granted_by', width: 28 },
              { header: 'Granted at (UTC)', key: 'granted_at', width: 20 },
              { header: 'Exceptions', key: 'exceptions', width: 40, wrap: true },
              { header: 'Certified (Y/N)', key: 'certified', width: 14 },
              { header: 'Reviewer comment', key: 'comment', width: 30 },
            ],
            rows: r.rows.map((x) => ({
              ...x,
              role: ROLE_LABELS[x.role],
              scope: scopeText(x),
              bu: x.bu ?? 'All',
              exceptions: x.exceptions.map((k) => EXCEPTION_SHORT[k]).join('\n'),
              certified: null,
              comment: null,
            })),
            flagRow: (x) => Boolean(x.exceptions),
            redCells: (x) => (x.exceptions ? ['exceptions'] : []),
            notes: [
              'One row per access right. Owner-mapping rows: "granted" is the last change to that cost centre’s mapping.',
              'Reviewers: mark each row Y (keep) or N (remove) and return the file to Finance.',
            ],
          },
        ],
      };
    }

    case 'commentary': {
      const r = await commentaryCoverage(tx, parseCoverageFilters(params));
      const kpi = `${r.kpi.explained} of ${r.kpi.flagged} flagged lines explained (${r.kpi.pct === null ? '—' : `${(r.kpi.pct * 100).toFixed(1)}%`}); ${r.kpi.unexplained} unexplained.`;
      return {
        title,
        filters: describeCoverageFilters(r),
        logDetail: { ...r.filters },
        fileName: `variance-commentary-coverage_${r.period ?? 'none'}.xlsx`,
        sheets: [
          {
            name: 'Flagged lines',
            columns: [
              { header: 'Period', key: 'period', width: 9 },
              { header: 'BU', key: 'bu', width: 16 },
              { header: 'Cost centre', key: 'cc_code', width: 13 },
              { header: 'CC alias', key: 'cc_alias', width: 26 },
              { header: 'Entity', key: 'entity', width: 7 },
              { header: 'Currency', key: 'currency', width: 9 },
              { header: 'Owner', key: 'owner_name', width: 18 },
              { header: 'Owner email', key: 'owner_email', width: 28 },
              { header: 'GL group', key: 'gl_group', width: 22 },
              { header: 'YTD budget', key: 'ytdBudget', width: 15, numFmt: AMT },
              { header: 'YTD actual', key: 'ytdActual', width: 15, numFmt: AMT },
              { header: 'YTD variance', key: 'variance', width: 15, numFmt: AMT },
              { header: 'Variance %', key: 'variancePct', width: 11, numFmt: PCT },
              { header: 'Comments', key: 'commentCount', width: 10 },
              { header: 'Explained', key: 'explained', width: 10 },
              { header: 'Latest comment', key: 'latestComment', width: 60, wrap: true },
              { header: 'Latest comment by', key: 'latestCommentBy', width: 28 },
              { header: 'Latest comment at (UTC)', key: 'latestCommentAt', width: 20 },
            ],
            rows: r.lines.map((l) => ({ ...l, period: r.period, explained: l.explained ? 'Yes' : 'No' })),
            flagRow: (l) => l.explained === 'No',
            redCells: (l) => (l.explained === 'No' ? ['explained'] : []),
            notes: [kpi, 'Variance = YTD actual − YTD budget (positive = overspend). Amounts in each entity’s own currency.'],
          },
          {
            name: 'Coverage by BU',
            columns: [
              { header: 'BU', key: 'bu', width: 20 },
              { header: 'Flagged', key: 'flagged', width: 10 },
              { header: 'Explained', key: 'explained', width: 10 },
              { header: 'Unexplained', key: 'unexplained', width: 12 },
              { header: 'Coverage %', key: 'pct', width: 12, numFmt: PCT },
            ],
            rows: [...r.byBu.map((b) => ({ ...b })), { bu: 'Total', ...r.kpi }],
            redCells: (b) => (Number(b.unexplained) > 0 ? ['unexplained'] : []),
          },
        ],
      };
    }

    case 'failed-searches': {
      const f = parseFailedSearchFilters(params);
      const r = await failedSearches(tx, f, { limit: EXPORT_CAP, withEvents: true });
      return {
        title,
        filters: describeFailedSearchFilters(f),
        logDetail: { ...f },
        fileName: `failed-searches_${stamp()}.xlsx`,
        sheets: [
          {
            name: 'Terms',
            columns: [
              { header: 'Search term', key: 'term', width: 36 },
              { header: 'Searches', key: 'searches', width: 10 },
              { header: 'Users', key: 'users', width: 8 },
              { header: 'First seen (UTC)', key: 'first_seen', width: 20 },
              { header: 'Last seen (UTC)', key: 'last_seen', width: 20 },
            ],
            rows: r.terms.map((t) => ({ ...t })),
            totalRows: r.totalTerms,
            notes: ['Most searched first. Add these as keywords to the right cost centre.'],
          },
          {
            name: 'Searches',
            columns: [
              { header: 'When (UTC)', key: 'ts', width: 20 },
              { header: 'User', key: 'user_email', width: 30 },
              { header: 'Search term', key: 'term', width: 36 },
            ],
            rows: r.events.map((e) => ({ ...e })),
            totalRows: r.searches,
          },
        ],
      };
    }
  }
}

/** Evidence pack for one upload batch. */
async function collectBatch(tx: Tx, id: string): Promise<ExportResult | null> {
  const d = await uploadBatchDetail(tx, id, { historyLimit: EXPORT_CAP });
  if (!d) return null;
  const b = d.batch;
  const issueColumns: Column[] = [
    { header: 'Row', key: 'row', width: 8 },
    { header: 'Column', key: 'column', width: 18 },
    { header: 'Code', key: 'code', width: 24 },
    { header: 'Message', key: 'message', width: 90, wrap: true },
  ];
  const facts: [string, Cell][] = [
    ['Batch id', b.id],
    ['Type', kindLabel(b.kind)],
    ['File name', b.file_name],
    ['SHA-256', b.file_sha256],
    ['Uploaded by', b.uploaded_by],
    ['Uploaded at (UTC)', b.uploaded_at],
    ['Status', statusLabel(b.status)],
    ['Rows', b.row_count],
    ['Errors', b.error_count],
    ['Warnings', b.warning_count],
    ['Approved by', b.approved_by],
    ['Published by', b.published_by],
    ['Published at (UTC)', b.published_at],
    ['Segregation of duties', SOD_LABEL[b.sod]],
    ['Created / updated / unchanged', d.summary.created === null ? null : `${d.summary.created} / ${d.summary.updated ?? 0} / ${d.summary.unchanged ?? 0}`],
  ];
  const tbBy = new Map(d.trialBalances.map((t) => [`${t.period}|${t.entity ?? ''}`, t]));
  const sheets: SheetSpec[] = [
    {
      name: 'Batch',
      columns: [
        { header: 'Field', key: 'field', width: 30 },
        { header: 'Value', key: 'value', width: 70, wrap: true },
      ],
      rows: facts.map(([field, value]) => ({ field, value })),
      redCells: (r) => (r.field === 'Segregation of duties' && b.sod === 'violation' ? ['value'] : []),
    },
    {
      name: 'Reconciliation',
      columns: [
        ...RECON_COLUMNS.filter((c) => c.key !== 'batch_id' && c.key !== 'file_name'),
        { header: 'TB entered by', key: 'entered_by', width: 28 },
        { header: 'TB entered at (UTC)', key: 'entered_at', width: 20 },
      ],
      rows: reconRows(b).map((l) => {
        const t = tbBy.get(`${l.period}|${l.entity ?? ''}`) ?? tbBy.get(`${l.period}|ALL`);
        return { ...l, entered_by: t?.entered_by ?? null, entered_at: t?.entered_at ?? null };
      }),
      redCells: reconRed,
    },
    { name: 'Errors', columns: issueColumns, rows: d.errors.map((i) => ({ ...i, row: i.row ?? 'File' })), redCells: () => ['code'] },
    { name: 'Warnings', columns: issueColumns, rows: d.warnings.map((i) => ({ ...i, row: i.row ?? 'File' })) },
    { name: 'Audit trail', columns: AUDIT_COLUMNS, rows: d.events.map(auditRow), redCells: alertAction, notes: ['Oldest first: upload steps and every master-data change made by this batch.'] },
  ];
  if (d.history && (b.kind === 'financials' || d.history.total > 0)) {
    sheets.push({
      name: 'Line changes',
      columns: [
        { header: 'Cost centre', key: 'cc_code', width: 13 },
        { header: 'Currency', key: 'currency', width: 9 },
        { header: 'Period', key: 'period', width: 9 },
        { header: 'GL group', key: 'gl_group', width: 22 },
        { header: 'Change', key: 'change', width: 10 },
        { header: 'Old budget', key: 'old_budget', width: 15, numFmt: AMT2 },
        { header: 'New budget', key: 'new_budget', width: 15, numFmt: AMT2 },
        { header: 'Old actual', key: 'old_actual', width: 15, numFmt: AMT2 },
        { header: 'New actual', key: 'new_actual', width: 15, numFmt: AMT2 },
        { header: 'Changed at (UTC)', key: 'changed_at', width: 20 },
        { header: 'Changed by', key: 'changed_by', width: 28 },
      ],
      rows: d.history.lines.map((l) => ({ ...l })),
      totalRows: d.history.total,
    });
  }
  return {
    title: `Upload evidence — ${b.file_name}`,
    filters: [['Batch', `${b.id} (${kindLabel(b.kind)}, ${b.file_name})`]],
    logDetail: { batch: b.id },
    fileName: `upload-evidence_${b.id.slice(0, 8)}.xlsx`,
    sheets,
  };
}
