/**
 * Phase 3 audit reports for Finance (read model + filter validation).
 *
 * Every function takes the caller's transaction (opened by withUser, so
 * row-level security applies) and a filter object produced by the matching
 * parse*Filters() function. Filters are validated and whitelisted before they
 * reach SQL, and they only ever reach SQL as bind parameters: the statements
 * below are fixed strings. Action, entity, upload-type, BU and period values
 * are additionally checked against SELECT DISTINCT lists from the database.
 *
 * Timestamps are rendered and filtered in UTC so an exported report means the
 * same thing wherever it is opened.
 */
import type { Tx } from './db/core';
import { isAllowedEmail, reconTolerance } from './config';
import { currencyOf } from './currency';
import { availablePeriods } from './financials';
import { fiscalYear, isPeriod, variance } from './fiscal';

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------
export const REPORTS = [
  {
    slug: 'audit-log',
    title: 'Audit log',
    description: 'Every master-data change, upload step, sign-in and export — who, what, when, old and new values.',
    control: 'Change management: changes to master data are authorised and traceable.',
  },
  {
    slug: 'uploads',
    title: 'Upload evidence register',
    description: 'One row per upload: file fingerprint (SHA-256), preparer, approver, outcome and trial-balance reconciliation.',
    control: 'Maker-checker: the person who uploads a file never approves it.',
  },
  {
    slug: 'access-review',
    title: 'User access review',
    description: 'Who can see which cost centres, and why — owner mapping and explicit grants, with exceptions flagged.',
    control: 'Periodic access recertification (IT general control).',
  },
  {
    slug: 'commentary',
    title: 'Variance commentary coverage',
    description: 'Lines over ±10% YTD variance for a month, and whether the owner has explained them.',
    control: 'Month-end review: significant variances are explained by the budget holder.',
  },
  {
    slug: 'failed-searches',
    title: 'Failed searches',
    description: 'Search terms that found nothing — add them as keywords to the right cost centre.',
    control: 'Master-data quality: employees can find the right cost centre.',
  },
] as const;

export type ReportSlug = (typeof REPORTS)[number]['slug'];
export const reportBySlug = (slug: string) => REPORTS.find((r) => r.slug === slug);

/** Rows per page on screen, and the most rows any export will contain. */
export const PAGE_SIZE = 50;
export const EXPORT_CAP = 50_000;

/** The identity the demo seed writes as (not a person). */
export const SEED_USER = 'seed@system';

// ---------------------------------------------------------------------------
// Filter parsing (pure)
// ---------------------------------------------------------------------------
export type SearchParams = Record<string, string | string[] | undefined>;

/** URLSearchParams -> the same shape Next.js passes to pages (repeated keys become arrays). */
export function paramsFromUrl(url: URL): SearchParams {
  const out: SearchParams = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    out[key] = all.length === 1 ? all[0] : all;
  }
  return out;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const all = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** A real calendar date in YYYY-MM-DD form, else null. */
export function parseDate(v: string | string[] | undefined): string | null {
  const s = first(v)?.trim();
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

/** Trimmed, length-capped free text (null when empty). */
export function parseText(v: string | string[] | undefined, max = 100): string | null {
  const s = first(v)?.trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
}

const parsePage = (v: string | string[] | undefined) => {
  const n = Number(first(v));
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 1;
};
const parseFlag = (v: string | string[] | undefined) => ['1', 'true', 'on', 'yes'].includes(first(v) ?? '');
const pick = <T extends string>(v: string | string[] | undefined, allowed: readonly T[]): T | null => {
  const s = first(v)?.trim();
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : null;
};
/** A short identifier (lower-case letters and underscores) — shape check before the database whitelist. */
const parseIdent = (v: string | string[] | undefined) => {
  const s = first(v)?.trim();
  return s && /^[a-z_]{1,40}$/.test(s) ? s : null;
};

/** Query string for a filter object (stable order, empty values left out). */
export function toQuery(params: Record<string, string | string[] | number | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '' || v === false) continue;
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else q.set(k, v === true ? '1' : String(v));
  }
  return q.toString();
}

/** Today's date in UTC (YYYY-MM-DD), optionally shifted by whole days. */
export function utcDate(offsetDays = 0, now = new Date()): string {
  return new Date(now.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

// Shared SQL fragments (fixed text; values are parameters)
const UTC_TS = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;
const FROM_DATE = (col: string, p: number) => `($${p}::date is null or ${col} >= ($${p}::date)::timestamp at time zone 'UTC')`;
const TO_DATE = (col: string, p: number) => `($${p}::date is null or ${col} < ($${p}::date + 1)::timestamp at time zone 'UTC')`;

// ---------------------------------------------------------------------------
// 1. Audit log
// ---------------------------------------------------------------------------
export interface AuditFilters {
  from: string | null;
  to: string | null;
  /** Part of the user's email (case-insensitive). */
  user: string | null;
  actions: string[];
  entity: string | null;
  /** Part of the entity id (case-insensitive). */
  entityId: string | null;
  page: number;
}

export function parseAuditFilters(p: SearchParams): AuditFilters {
  return {
    from: parseDate(p.from),
    to: parseDate(p.to),
    user: parseText(p.user)?.toLowerCase() ?? null,
    // shape check only; the values are whitelisted against the database in auditLog()
    actions: [...new Set(all(p.action).map((a) => a.trim().toUpperCase()).filter((a) => /^[A-Z_]{1,40}$/.test(a)))],
    entity: parseIdent(p.entity),
    entityId: parseText(p.entityId)?.toLowerCase() ?? null,
    page: parsePage(p.page),
  };
}

export const auditQuery = (f: AuditFilters, page?: number) =>
  toQuery({ from: f.from, to: f.to, user: f.user, action: f.actions, entity: f.entity, entityId: f.entityId, page });

export interface AuditRow {
  id: number;
  ts: string;
  user_email: string;
  action: string;
  entity: string;
  entity_id: string | null;
  old_value: unknown;
  new_value: unknown;
  batch_id: string | null;
}

/** Distinct actions and entities present in the log (the filter whitelist). */
export async function auditOptions(tx: Tx): Promise<{ actions: string[]; entities: string[] }> {
  const actions = await tx.query<{ v: string }>('select distinct action as v from ccp.audit_log order by 1');
  const entities = await tx.query<{ v: string }>('select distinct entity as v from ccp.audit_log order by 1');
  return { actions: actions.map((r) => r.v), entities: entities.map((r) => r.v) };
}

const AUDIT_WHERE = `
  where ${FROM_DATE('ts', 1)}
    and ${TO_DATE('ts', 2)}
    and ($3::text is null or strpos(lower(user_email), $3::text) > 0)
    and (cardinality($4::text[]) = 0 or action = any ($4::text[]))
    and ($5::text is null or entity = $5::text)
    and ($6::text is null or strpos(lower(coalesce(entity_id, '')), $6::text) > 0)`;

/**
 * Audit events matching the filters, newest first. `limit` defaults to one
 * page; pass EXPORT_CAP (and offset 0) for an export. `total` counts every
 * match, so `total > rows.length` means the result was cut off.
 */
export async function auditLog(
  tx: Tx,
  filters: AuditFilters,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ rows: AuditRow[]; total: number; filters: AuditFilters; options: { actions: string[]; entities: string[] } }> {
  const options = await auditOptions(tx);
  const f: AuditFilters = {
    ...filters,
    actions: filters.actions.filter((a) => options.actions.includes(a)),
    entity: filters.entity && options.entities.includes(filters.entity) ? filters.entity : null,
  };
  const limit = Math.min(Math.max(opts.limit ?? PAGE_SIZE, 1), EXPORT_CAP);
  const offset = Math.max(opts.offset ?? (f.page - 1) * PAGE_SIZE, 0);
  const params = [f.from, f.to, f.user, f.actions, f.entity, f.entityId];
  const [{ n }] = await tx.query<{ n: number }>(`select count(*)::int as n from ccp.audit_log ${AUDIT_WHERE}`, params);
  const rows = await tx.query<AuditRow>(
    `select id, ${UTC_TS('ts')} as ts, user_email, action, entity, entity_id, old_value, new_value, batch_id::text as batch_id
       from ccp.audit_log ${AUDIT_WHERE}
      order by ts desc, id desc
      limit $7 offset $8`,
    [...params, limit, offset],
  );
  return { rows, total: n, filters: f, options };
}

export interface Change {
  field: string;
  before: string | null;
  after: string | null;
  /** added: only a new value (insert / event detail); removed: only an old value (delete). */
  kind: 'added' | 'changed' | 'removed';
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Display text for one JSON value (null stays null). */
export function formatValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * Old/new JSON from the audit log as a field-by-field list. Updates store only
 * the changed columns, so every field of an update is a real change.
 */
export function auditChanges(oldValue: unknown, newValue: unknown): Change[] {
  const hasOld = oldValue !== null && oldValue !== undefined;
  const hasNew = newValue !== null && newValue !== undefined;
  if (!hasOld && !hasNew) return [];
  if ((hasOld && !isRecord(oldValue)) || (hasNew && !isRecord(newValue))) {
    const kind = hasOld && hasNew ? 'changed' : hasNew ? 'added' : 'removed';
    return [{ field: 'value', before: formatValue(oldValue), after: formatValue(newValue), kind }];
  }
  const o = (oldValue ?? {}) as Record<string, unknown>;
  const n = (newValue ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(n), ...Object.keys(o)])];
  const kind: Change['kind'] = hasOld && hasNew ? 'changed' : hasNew ? 'added' : 'removed';
  return keys.map((field) => ({ field, before: formatValue(o[field]), after: formatValue(n[field]), kind }));
}

/** "field: old → new" (or "field: value" for inserts and events). */
export function changeText(c: Change): string {
  const show = (v: string | null) => (v === null || v === '' ? '(blank)' : v);
  if (c.kind === 'added') return `${c.field}: ${show(c.after)}`;
  if (c.kind === 'removed') return `${c.field}: ${show(c.before)} → (removed)`;
  return `${c.field}: ${show(c.before)} → ${show(c.after)}`;
}

/** Actions shown in red: denials, rejections, failed reconciliations, removals. */
export const isAlertAction = (action: string) => /DENIED|REJECTED|FAILED|DEACTIVATE|DELETE/.test(action);

// ---------------------------------------------------------------------------
// 2. Upload evidence register
// ---------------------------------------------------------------------------
export const UPLOAD_STATUSES = ['Validated', 'Rejected', 'Published', 'Discarded'] as const;
export const UPLOAD_KINDS = ['master', 'owners', 'financials', 'allocations'] as const;
export const KIND_LABELS: Record<string, string> = {
  master: 'Cost Centre Master',
  owners: 'Owner Mapping',
  financials: 'Budget & Actuals',
  allocations: 'Allocations',
};
export const kindLabel = (k: string) => KIND_LABELS[k] ?? k;
export const statusLabel = (s: string) => (s === 'Validated' ? 'Awaiting approval' : s);

export interface UploadFilters {
  from: string | null;
  to: string | null;
  kind: string | null;
  status: (typeof UPLOAD_STATUSES)[number] | null;
  page: number;
}

export function parseUploadFilters(p: SearchParams): UploadFilters {
  return {
    from: parseDate(p.from),
    to: parseDate(p.to),
    kind: parseIdent(p.kind),
    status: pick(p.status, UPLOAD_STATUSES),
    page: parsePage(p.page),
  };
}

export const uploadQuery = (f: UploadFilters, page?: number) =>
  toQuery({ from: f.from, to: f.to, kind: f.kind, status: f.status, page });

export interface ReconLine {
  period: string;
  entity?: string | null;
  currency?: string | null;
  actualTotal: number;
  tbTotal: number | null;
  difference: number | null;
  matched?: boolean;
}

export type SodStatus = 'ok' | 'violation' | 'seed' | 'pending' | 'na';

export interface UploadRow {
  id: string;
  kind: string;
  file_name: string;
  file_sha256: string;
  uploaded_by: string;
  uploaded_at: string;
  status: string;
  row_count: number;
  error_count: number;
  warning_count: number;
  approved_by: string | null;
  published_by: string | null;
  published_at: string | null;
  /** Reconciliation lines (financials). From the batch summary, else from the period register. */
  reconciliation: ReconLine[];
  reconSource: 'batch' | 'period register' | null;
  sod: SodStatus;
}

/**
 * Segregation of duties for one batch: a published upload must have been
 * approved and published by someone other than the uploader. The demo seed
 * (written by the system, not a person) is reported separately.
 */
export function sodCheck(b: {
  uploaded_by: string;
  approved_by: string | null;
  published_by: string | null;
  status: string;
}): SodStatus {
  if (b.uploaded_by === SEED_USER) return 'seed';
  if (b.status === 'Validated') return 'pending';
  if (b.status !== 'Published') return 'na';
  const uploader = b.uploaded_by.toLowerCase();
  const approvers = [b.approved_by, b.published_by].filter((x): x is string => Boolean(x));
  if (approvers.length === 0) return 'violation';
  return approvers.some((a) => a.toLowerCase() === uploader) ? 'violation' : 'ok';
}

export const SOD_LABEL: Record<SodStatus, string> = {
  ok: '✓ Different approver',
  violation: '✗ Uploader approved own file',
  seed: 'System seed',
  pending: 'Awaiting approval',
  na: 'Not published',
};

const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

function toReconLines(raw: unknown): ReconLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((r) => {
    const actualTotal = num(r.actualTotal);
    const tbTotal = numOrNull(r.tbTotal);
    const difference = r.difference !== undefined ? numOrNull(r.difference) : tbTotal === null ? null : Math.round((actualTotal - tbTotal) * 100) / 100;
    const entity = typeof r.entity === 'string' ? r.entity : null;
    return {
      period: String(r.period ?? ''),
      entity,
      currency: typeof r.currency === 'string' && r.currency ? r.currency : entity && entity !== 'ALL' ? currencyOf(entity) : null,
      actualTotal,
      tbTotal,
      difference,
      matched: typeof r.matched === 'boolean' ? r.matched : difference !== null && Math.abs(difference) <= reconTolerance(),
    };
  });
}

const UPLOAD_COLUMNS = `
  b.id::text as id, b.kind, b.file_name, b.file_sha256, b.uploaded_by, ${UTC_TS('b.uploaded_at')} as uploaded_at,
  b.status, b.row_count, b.error_count,
  case when jsonb_typeof(b.summary -> 'warnings') = 'array' then jsonb_array_length(b.summary -> 'warnings') else 0 end as warning_count,
  b.approved_by, b.published_by, ${UTC_TS('b.published_at')} as published_at,
  b.summary -> 'reconciliation' as reconciliation,
  (select coalesce(jsonb_agg(jsonb_build_object('period', p.period, 'entity', to_jsonb(p) ->> 'entity',
                                                'actualTotal', p.actual_total, 'tbTotal', p.tb_total)
                             order by p.period, to_jsonb(p) ->> 'entity'), '[]'::jsonb)
     from ccp.periods p where p.batch_id = b.id) as register_lines`;

type RawUpload = Omit<UploadRow, 'reconciliation' | 'reconSource' | 'sod'> & { reconciliation: unknown; register_lines: unknown };

function toUploadRow(r: RawUpload): UploadRow {
  const fromBatch = toReconLines(r.reconciliation);
  const fromRegister = r.kind === 'financials' && fromBatch.length === 0 ? toReconLines(r.register_lines) : [];
  const { register_lines: _ignored, ...rest } = r;
  return {
    ...rest,
    reconciliation: fromBatch.length ? fromBatch : fromRegister,
    reconSource: fromBatch.length ? 'batch' : fromRegister.length ? 'period register' : null,
    sod: sodCheck(r),
  };
}

/** Upload types present in the register plus the known ones (the filter whitelist). */
export async function uploadKinds(tx: Tx): Promise<string[]> {
  const rows = await tx.query<{ kind: string }>('select distinct kind from ccp.upload_batches');
  return [...new Set([...UPLOAD_KINDS, ...rows.map((r) => r.kind)])];
}

const UPLOAD_WHERE = `
  where ${FROM_DATE('b.uploaded_at', 1)}
    and ${TO_DATE('b.uploaded_at', 2)}
    and ($3::text is null or b.kind = $3::text)
    and ($4::text is null or b.status = $4::text)`;

/** One row per upload batch, newest first (Finance only, by RLS). */
export async function uploadRegister(
  tx: Tx,
  filters: UploadFilters,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ rows: UploadRow[]; total: number; filters: UploadFilters; kinds: string[]; violations: number }> {
  const kinds = await uploadKinds(tx);
  const f: UploadFilters = { ...filters, kind: filters.kind && kinds.includes(filters.kind) ? filters.kind : null };
  const limit = Math.min(Math.max(opts.limit ?? PAGE_SIZE, 1), EXPORT_CAP);
  const offset = Math.max(opts.offset ?? (f.page - 1) * PAGE_SIZE, 0);
  const params = [f.from, f.to, f.kind, f.status];
  const [{ n, violations }] = await tx.query<{ n: number; violations: number }>(
    `select count(*)::int as n,
            -- same rule as sodCheck()
            count(*) filter (where b.status = 'Published' and b.uploaded_by <> $5
                               and ((b.approved_by is null and b.published_by is null)
                                    or lower(b.approved_by) = lower(b.uploaded_by)
                                    or lower(b.published_by) = lower(b.uploaded_by)))::int as violations
       from ccp.upload_batches b ${UPLOAD_WHERE}`,
    [...params, SEED_USER],
  );
  const raw = await tx.query<RawUpload>(
    `select ${UPLOAD_COLUMNS} from ccp.upload_batches b ${UPLOAD_WHERE}
      order by b.uploaded_at desc, b.id limit $5 offset $6`,
    [...params, limit, offset],
  );
  return { rows: raw.map(toUploadRow), total: n, filters: f, kinds, violations };
}

export interface Issue {
  row: number | null;
  column: string | null;
  code: string;
  message: string;
}

export interface TrialBalanceEntry {
  period: string;
  entity: string | null;
  tb_total: number;
  entered_by: string;
  entered_at: string;
}

export interface HistoryLine {
  cc_code: string;
  period: string;
  gl_group: string;
  /** Currency of the cost centre's entity (null if the code is not in the master). */
  currency: string | null;
  change: string | null;
  old_budget: number | null;
  old_actual: number | null;
  new_budget: number | null;
  new_actual: number | null;
  changed_at: string;
  changed_by: string;
}

export interface BatchDetail {
  batch: UploadRow;
  errors: Issue[];
  warnings: Issue[];
  summary: { created: number | null; updated: number | null; unchanged: number | null };
  trialBalances: TrialBalanceEntry[];
  events: AuditRow[];
  /** null when ccp.financials_history does not exist (yet) in this database. */
  history: { total: number; lines: HistoryLine[] } | null;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const HISTORY_COLUMNS = ['batch_id', 'cc_code', 'period', 'gl_group', 'old_budget', 'old_actual', 'new_budget', 'new_actual', 'changed_at', 'changed_by'];

/** Which line-history columns exist (the table arrives with the Phase 3 migration). */
async function historyShape(tx: Tx): Promise<{ available: boolean; hasChange: boolean }> {
  const cols = await tx.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema = 'ccp' and table_name = 'financials_history'`,
  );
  const names = new Set(cols.map((c) => c.column_name));
  return { available: HISTORY_COLUMNS.every((c) => names.has(c)), hasChange: names.has('change') };
}

const asIssues = (v: unknown): Issue[] =>
  Array.isArray(v)
    ? v.filter(isRecord).map((i) => ({
        row: typeof i.row === 'number' ? i.row : null,
        column: typeof i.column === 'string' ? i.column : null,
        code: String(i.code ?? ''),
        message: String(i.message ?? ''),
      }))
    : [];

/**
 * Everything recorded about one upload: the batch, its stored errors and
 * warnings, trial-balance entries, every audit event tagged with the batch
 * (including the master changes it caused) and, where the line-history table
 * exists, the financial lines it changed. Null when not found / not visible.
 */
export async function uploadBatchDetail(tx: Tx, id: string, opts: { historyLimit?: number } = {}): Promise<BatchDetail | null> {
  if (!isUuid(id)) return null;
  const [raw] = await tx.query<RawUpload & { errors_json: unknown; warnings_json: unknown; counts: Record<string, unknown> | null }>(
    `select ${UPLOAD_COLUMNS}, b.errors as errors_json, b.summary -> 'warnings' as warnings_json,
            jsonb_build_object('created', b.summary -> 'created', 'updated', b.summary -> 'updated',
                               'unchanged', b.summary -> 'unchanged') as counts
       from ccp.upload_batches b where b.id = $1::uuid`,
    [id],
  );
  if (!raw) return null;
  const { errors_json, warnings_json, counts, ...batch } = raw;

  const trialBalances = await tx.query<TrialBalanceEntry>(
    `select t.period, to_jsonb(t) ->> 'entity' as entity, t.tb_total, t.entered_by, ${UTC_TS('t.entered_at')} as entered_at
       from ccp.trial_balances t where t.batch_id = $1::uuid
      order by t.period, to_jsonb(t) ->> 'entity'`,
    [id],
  );
  const events = await tx.query<AuditRow>(
    `select id, ${UTC_TS('ts')} as ts, user_email, action, entity, entity_id, old_value, new_value, batch_id::text as batch_id
       from ccp.audit_log
      where batch_id = $1::uuid or (entity = 'upload_batch' and entity_id = $1::text)
      order by ts, id
      limit $2`,
    [id, EXPORT_CAP],
  );

  let history: BatchDetail['history'] = null;
  const shape = await historyShape(tx);
  if (shape.available) {
    const limit = Math.min(Math.max(opts.historyLimit ?? 500, 1), EXPORT_CAP);
    const [{ n }] = await tx.query<{ n: number }>(
      'select count(*)::int as n from ccp.financials_history where batch_id = $1::uuid',
      [id],
    );
    const lines = await tx.query<HistoryLine & { entity: string | null }>(
      `select h.cc_code, h.period, h.gl_group, ${shape.hasChange ? 'h.change' : 'null::text'} as change,
              (select c.entity from ccp.cost_centres c where c.cc_code = h.cc_code) as entity,
              h.old_budget, h.old_actual, h.new_budget, h.new_actual,
              ${UTC_TS('h.changed_at')} as changed_at, h.changed_by
         from ccp.financials_history h where h.batch_id = $1::uuid
        order by h.period, h.cc_code, h.gl_group
        limit $2`,
      [id, limit],
    );
    history = {
      total: n,
      lines: lines.map(({ entity, ...l }) => ({
        ...l,
        currency: entity ? currencyOf(entity) : null,
        old_budget: numOrNull(l.old_budget),
        old_actual: numOrNull(l.old_actual),
        new_budget: numOrNull(l.new_budget),
        new_actual: numOrNull(l.new_actual),
      })),
    };
  }

  const s = counts ?? {};
  return {
    batch: toUploadRow(batch),
    errors: asIssues(errors_json),
    warnings: asIssues(warnings_json),
    summary: { created: numOrNull(s.created), updated: numOrNull(s.updated), unchanged: numOrNull(s.unchanged) },
    trialBalances: trialBalances.map((t) => ({ ...t, tb_total: Number(t.tb_total) })),
    events,
    history,
  };
}

// ---------------------------------------------------------------------------
// 3. User access review
// ---------------------------------------------------------------------------
export const ACCESS_ROLES = ['Finance', 'Mgmt', 'BU_Head', 'Owner', 'Backup'] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];
export const ROLE_LABELS: Record<AccessRole, string> = {
  Finance: 'Finance',
  Mgmt: 'Management',
  BU_Head: 'BU head',
  Owner: 'Owner',
  Backup: 'Backup owner',
};

export interface AccessFilters {
  user: string | null;
  role: AccessRole | null;
  bu: string | null;
  exceptionsOnly: boolean;
}

export function parseAccessFilters(p: SearchParams): AccessFilters {
  return {
    user: parseText(p.user)?.toLowerCase() ?? null,
    role: pick(p.role, ACCESS_ROLES),
    bu: parseText(p.bu, 80),
    exceptionsOnly: parseFlag(p.exceptions),
  };
}

export const accessQuery = (f: AccessFilters) => toQuery({ user: f.user, role: f.role, bu: f.bu, exceptions: f.exceptionsOnly });

export type AccessExceptionKind = 'sod' | 'owner_is_bu_head' | 'backup_is_bu_head' | 'inactive_cc' | 'external_email';
export const EXCEPTION_LABELS: Record<AccessExceptionKind, string> = {
  sod: 'Finance user also owns cost centres (segregation of duties)',
  owner_is_bu_head: 'Owner is also the BU head (no independent review)',
  backup_is_bu_head: 'Backup owner is also the BU head',
  inactive_cc: 'Inactive cost centre still has access',
  external_email: 'Email outside the allowed company domains',
};

/** Short form for table cells. */
export const EXCEPTION_SHORT: Record<AccessExceptionKind, string> = {
  sod: 'Finance + owner (SoD)',
  owner_is_bu_head: 'Owner = BU head',
  backup_is_bu_head: 'Backup = BU head',
  inactive_cc: 'Inactive cost centre',
  external_email: 'External email',
};

export interface AccessException {
  kind: AccessExceptionKind;
  user_email: string | null;
  cc_code: string | null;
  detail: string;
}

export interface AccessRow {
  user_email: string;
  role: AccessRole;
  /** 'all' = every cost centre (Finance / Management), 'bu' = a whole business unit, 'cc' = one cost centre. */
  scope: 'all' | 'bu' | 'cc';
  cc_code: string | null;
  cc_alias: string | null;
  cc_status: string | null;
  bu: string | null;
  /** Active cost centres covered by a BU-wide grant. */
  bu_cc_count: number | null;
  source: 'owner mapping' | 'explicit grant';
  granted_by: string | null;
  granted_at: string | null;
  exceptions: AccessExceptionKind[];
}

export interface AccessReview {
  rows: AccessRow[];
  /** Distinct users per role (over the filtered rows). */
  usersByRole: Record<AccessRole, number>;
  users: number;
  exceptions: AccessException[];
  bus: string[];
  filters: AccessFilters;
  totalRows: number;
}

export const scopeText = (r: Pick<AccessRow, 'scope' | 'cc_code' | 'cc_alias' | 'bu' | 'bu_cc_count'>) =>
  r.scope === 'all'
    ? 'All cost centres'
    : r.scope === 'bu'
      ? `All of ${r.bu}${r.bu_cc_count !== null ? ` (${r.bu_cc_count} active CC${r.bu_cc_count === 1 ? '' : 's'})` : ''}`
      : `${r.cc_code}${r.cc_alias ? ` ${r.cc_alias}` : ''}`;

/**
 * Every access right, from the owner mapping (Owner / Backup / BU head per
 * cost centre) and from explicit grants (Finance, Management, BU-wide and
 * per-CC grants), with control exceptions. Explicit grants of other users are
 * visible to Finance only (RLS on cc_access), so this is a Finance report.
 */
export async function accessReview(tx: Tx, filters: AccessFilters): Promise<AccessReview> {
  const raw = await tx.query<Omit<AccessRow, 'exceptions' | 'bu_cc_count'>>(
    `select o.owner_email as user_email, 'Owner' as role, 'cc' as scope, c.cc_code, c.cc_alias, c.status as cc_status, c.bu,
            'owner mapping' as source, o.updated_by as granted_by, ${UTC_TS('o.updated_at')} as granted_at
       from ccp.cc_owners o join ccp.cost_centres c on c.cc_code = o.cc_code
     union all
     select o.backup_owner_email, 'Backup', 'cc', c.cc_code, c.cc_alias, c.status, c.bu,
            'owner mapping', o.updated_by, ${UTC_TS('o.updated_at')}
       from ccp.cc_owners o join ccp.cost_centres c on c.cc_code = o.cc_code
     union all
     select o.bu_head_email, 'BU_Head', 'cc', c.cc_code, c.cc_alias, c.status, c.bu,
            'owner mapping', o.updated_by, ${UTC_TS('o.updated_at')}
       from ccp.cc_owners o join ccp.cost_centres c on c.cc_code = o.cc_code
      where o.bu_head_email is not null
     union all
     select a.user_email, a.role,
            case when a.cc_code is not null then 'cc' when a.bu is not null then 'bu' else 'all' end,
            a.cc_code, c.cc_alias, c.status, coalesce(a.bu, c.bu),
            'explicit grant', a.created_by, ${UTC_TS('a.created_at')}
       from ccp.cc_access a left join ccp.cost_centres c on c.cc_code = a.cc_code`,
  );
  const ccs = await tx.query<{ cc_code: string; bu: string; status: string; owner_email: string | null; backup_owner_email: string | null; bu_head_email: string | null }>(
    `select c.cc_code, c.bu, c.status, o.owner_email, o.backup_owner_email, o.bu_head_email
       from ccp.cost_centres c left join ccp.cc_owners o on o.cc_code = c.cc_code`,
  );

  const activeByBu = new Map<string, number>();
  for (const c of ccs) if (c.status === 'Active') activeByBu.set(c.bu, (activeByBu.get(c.bu) ?? 0) + 1);
  const bus = [...new Set([...ccs.map((c) => c.bu), ...raw.map((r) => r.bu).filter((b): b is string => Boolean(b))])].sort();

  const rows: AccessRow[] = raw.map((r) => ({
    ...r,
    bu_cc_count: r.scope === 'bu' && r.bu ? (activeByBu.get(r.bu) ?? 0) : null,
    exceptions: [],
  }));

  // --- exceptions (computed over every row, before filtering) -------------
  const exceptions: AccessException[] = [];
  const flag = (row: AccessRow, kind: AccessExceptionKind) => {
    if (!row.exceptions.includes(kind)) row.exceptions.push(kind);
  };

  const financeUsers = new Set(rows.filter((r) => r.role === 'Finance').map((r) => r.user_email));
  const byUser = new Map<string, AccessRow[]>();
  for (const r of rows) byUser.set(r.user_email, [...(byUser.get(r.user_email) ?? []), r]);
  for (const user of [...financeUsers].sort()) {
    const owned = (byUser.get(user) ?? []).filter((r) => r.role === 'Owner' || r.role === 'Backup');
    if (owned.length === 0) continue;
    for (const r of byUser.get(user) ?? []) if (r.role === 'Finance' || r.role === 'Owner' || r.role === 'Backup') flag(r, 'sod');
    exceptions.push({
      kind: 'sod',
      user_email: user,
      cc_code: null,
      detail: `${user} has Finance access and is ${owned.map((r) => `${ROLE_LABELS[r.role]} of ${r.cc_code}`).join(', ')} — can upload and approve figures for cost centres they are accountable for.`,
    });
  }

  for (const c of ccs) {
    if (c.owner_email && c.bu_head_email && c.owner_email === c.bu_head_email) {
      exceptions.push({ kind: 'owner_is_bu_head', user_email: c.owner_email, cc_code: c.cc_code, detail: `${c.cc_code}: owner and BU head are both ${c.owner_email}.` });
      for (const r of rows) if (r.cc_code === c.cc_code && r.source === 'owner mapping' && (r.role === 'Owner' || r.role === 'BU_Head')) flag(r, 'owner_is_bu_head');
    }
    if (c.backup_owner_email && c.bu_head_email && c.backup_owner_email === c.bu_head_email) {
      exceptions.push({ kind: 'backup_is_bu_head', user_email: c.backup_owner_email, cc_code: c.cc_code, detail: `${c.cc_code}: backup owner and BU head are both ${c.backup_owner_email}.` });
      for (const r of rows) if (r.cc_code === c.cc_code && r.source === 'owner mapping' && (r.role === 'Backup' || r.role === 'BU_Head')) flag(r, 'backup_is_bu_head');
    }
  }

  const inactive = new Map<string, AccessRow[]>();
  for (const r of rows) if (r.scope === 'cc' && r.cc_status === 'Inactive') inactive.set(r.cc_code!, [...(inactive.get(r.cc_code!) ?? []), r]);
  for (const [code, list] of [...inactive].sort(([a], [b]) => (a < b ? -1 : 1))) {
    list.forEach((r) => flag(r, 'inactive_cc'));
    exceptions.push({
      kind: 'inactive_cc',
      user_email: null,
      cc_code: code,
      detail: `${code} is Inactive but still grants access to ${[...new Set(list.map((r) => `${r.user_email} (${ROLE_LABELS[r.role]})`))].join(', ')}.`,
    });
  }

  for (const user of [...byUser.keys()].sort()) {
    if (isAllowedEmail(user)) continue;
    byUser.get(user)!.forEach((r) => flag(r, 'external_email'));
    exceptions.push({
      kind: 'external_email',
      user_email: user,
      cc_code: null,
      detail: `${user} is not on an allowed company domain but holds ${[...new Set(byUser.get(user)!.map((r) => ROLE_LABELS[r.role]))].join(', ')} access.`,
    });
  }

  // --- filters ---------------------------------------------------------------
  const f: AccessFilters = { ...filters, bu: filters.bu && bus.includes(filters.bu) ? filters.bu : null };
  const roleOrder = (r: AccessRole) => ACCESS_ROLES.indexOf(r);
  const filtered = rows
    .filter((r) => !f.user || r.user_email.includes(f.user))
    .filter((r) => !f.role || r.role === f.role)
    // a BU filter keeps company-wide grants too: they give access to that BU as well
    .filter((r) => !f.bu || r.bu === f.bu || r.scope === 'all')
    .filter((r) => !f.exceptionsOnly || r.exceptions.length > 0)
    .sort((a, b) =>
      a.user_email < b.user_email ? -1 : a.user_email > b.user_email ? 1
        : roleOrder(a.role) - roleOrder(b.role) || (a.cc_code ?? '').localeCompare(b.cc_code ?? ''),
    );

  const usersByRole = Object.fromEntries(
    ACCESS_ROLES.map((role) => [role, new Set(filtered.filter((r) => r.role === role).map((r) => r.user_email)).size]),
  ) as Record<AccessRole, number>;

  return {
    rows: filtered,
    usersByRole,
    users: new Set(filtered.map((r) => r.user_email)).size,
    exceptions,
    bus,
    filters: f,
    totalRows: rows.length,
  };
}

// ---------------------------------------------------------------------------
// 4. Variance commentary coverage
// ---------------------------------------------------------------------------
export interface CoverageFilters {
  period: string | null;
  bu: string | null;
  unexplainedOnly: boolean;
}

export function parseCoverageFilters(p: SearchParams): CoverageFilters {
  const period = first(p.period)?.trim();
  return {
    period: period && isPeriod(period) ? period : null,
    bu: parseText(p.bu, 80),
    unexplainedOnly: parseFlag(p.unexplained),
  };
}

export const coverageQuery = (f: CoverageFilters) => toQuery({ period: f.period, bu: f.bu, unexplained: f.unexplainedOnly });

export interface CoverageLine {
  cc_code: string;
  cc_alias: string;
  entity: string;
  currency: string;
  bu: string;
  owner_name: string | null;
  owner_email: string | null;
  gl_group: string;
  ytdBudget: number;
  ytdActual: number;
  variance: number;
  variancePct: number | null;
  commentCount: number;
  latestComment: string | null;
  latestCommentBy: string | null;
  latestCommentAt: string | null;
  explained: boolean;
}

export interface CoverageKpi {
  flagged: number;
  explained: number;
  unexplained: number;
  /** explained / flagged (null when nothing is flagged) */
  pct: number | null;
}

export interface CoverageReport {
  period: string | null;
  periods: string[];
  fyLabel: string | null;
  ytdFrom: string | null;
  lines: CoverageLine[];
  kpi: CoverageKpi;
  byBu: (CoverageKpi & { bu: string })[];
  bus: string[];
  filters: CoverageFilters;
}

const kpiOf = (lines: CoverageLine[]): CoverageKpi => {
  const explained = lines.filter((l) => l.explained).length;
  return { flagged: lines.length, explained, unexplained: lines.length - explained, pct: lines.length ? explained / lines.length : null };
};

/** Characters of the latest comment shown in the report. */
export const EXCERPT_LENGTH = 160;

/**
 * For one period (default: the latest with actuals), every cost centre × GL
 * line whose YTD variance is over ±10% (same YTD definition and threshold as
 * My Cost Centres), and whether a comment exists for that cc + period + GL.
 */
export async function commentaryCoverage(tx: Tx, filters: CoverageFilters): Promise<CoverageReport> {
  const periods = await availablePeriods(tx);
  const busRows = await tx.query<{ bu: string }>('select distinct bu from ccp.cost_centres order by 1');
  const bus = busRows.map((b) => b.bu);
  const f: CoverageFilters = {
    ...filters,
    period: filters.period && periods.includes(filters.period) ? filters.period : (periods[0] ?? null),
    bu: filters.bu && bus.includes(filters.bu) ? filters.bu : null,
  };
  const empty: CoverageKpi = { flagged: 0, explained: 0, unexplained: 0, pct: null };
  if (!f.period) return { period: null, periods, fyLabel: null, ytdFrom: null, lines: [], kpi: empty, byBu: [], bus, filters: f };

  const fy = fiscalYear(f.period);
  const raw = await tx.query<Record<string, unknown>>(
    `with ytd as (
       select f.cc_code, f.gl_group, sum(f.budget) as ytd_budget, sum(f.actual) as ytd_actual
         from ccp.financials f
        where f.period between $2 and $1
        group by f.cc_code, f.gl_group
     )
     select y.cc_code, c.cc_alias, c.entity, c.bu, o.owner_name, o.owner_email, y.gl_group, y.ytd_budget, y.ytd_actual,
            coalesce(k.n, 0) as comment_count, k.latest, k.latest_by, k.latest_at
       from ytd y
       join ccp.cost_centres c on c.cc_code = y.cc_code
       left join ccp.cc_owners o on o.cc_code = y.cc_code
       left join lateral (
         select count(*)::int as n,
                (array_agg(left(m.comment, ${EXCERPT_LENGTH + 1}) order by m.created_at desc, m.id desc))[1] as latest,
                (array_agg(m.user_email order by m.created_at desc, m.id desc))[1] as latest_by,
                ${UTC_TS('max(m.created_at)')} as latest_at
           from ccp.comments m
          where m.cc_code = y.cc_code and m.period = $1 and m.gl_group = y.gl_group
            and length(trim(m.comment)) > 0   -- a blank comment explains nothing
       ) k on true
      where ($3::text is null or c.bu = $3::text)
      order by c.bu, y.cc_code, y.gl_group`,
    [f.period, fy.start, f.bu],
  );

  const flagged: CoverageLine[] = [];
  for (const r of raw) {
    const ytdBudget = num(r.ytd_budget);
    const ytdActual = num(r.ytd_actual);
    const v = variance(ytdBudget, ytdActual);
    if (!v.flagged) continue;
    const count = Number(r.comment_count ?? 0);
    const latest = (r.latest as string | null) ?? null;
    flagged.push({
      cc_code: String(r.cc_code),
      cc_alias: String(r.cc_alias),
      entity: String(r.entity),
      currency: currencyOf(String(r.entity)),
      bu: String(r.bu),
      owner_name: (r.owner_name as string | null) ?? null,
      owner_email: (r.owner_email as string | null) ?? null,
      gl_group: String(r.gl_group),
      ytdBudget,
      ytdActual,
      variance: v.amount,
      variancePct: v.pct,
      commentCount: count,
      latestComment: latest && latest.length > EXCERPT_LENGTH ? `${latest.slice(0, EXCERPT_LENGTH)}…` : latest,
      latestCommentBy: (r.latest_by as string | null) ?? null,
      latestCommentAt: (r.latest_at as string | null) ?? null,
      explained: count > 0,
    });
  }

  const byBuMap = new Map<string, CoverageLine[]>();
  for (const l of flagged) byBuMap.set(l.bu, [...(byBuMap.get(l.bu) ?? []), l]);
  return {
    period: f.period,
    periods,
    fyLabel: fy.label,
    ytdFrom: fy.start,
    lines: f.unexplainedOnly ? flagged.filter((l) => !l.explained) : flagged,
    kpi: kpiOf(flagged),
    byBu: [...byBuMap].map(([bu, lines]) => ({ bu, ...kpiOf(lines) })),
    bus,
    filters: f,
  };
}

// ---------------------------------------------------------------------------
// 5. Failed searches
// ---------------------------------------------------------------------------
export interface FailedSearchFilters {
  from: string | null;
  to: string | null;
}

/** Default window (when the form has not been submitted): the last 90 days. */
export function parseFailedSearchFilters(p: SearchParams, now = new Date()): FailedSearchFilters {
  const submitted = 'from' in p || 'to' in p;
  return { from: submitted ? parseDate(p.from) : utcDate(-90, now), to: parseDate(p.to) };
}

/** The empty `from=` is kept so "all time" survives a round trip. */
export const failedSearchQuery = (f: FailedSearchFilters) => {
  const q = new URLSearchParams();
  q.set('from', f.from ?? '');
  if (f.to) q.set('to', f.to);
  return q.toString();
};

export interface FailedTerm {
  term: string;
  searches: number;
  users: number;
  first_seen: string;
  last_seen: string;
}

export interface FailedSearchEvent {
  ts: string;
  user_email: string;
  term: string;
}

const FS_WHERE = `where ${FROM_DATE('ts', 1)} and ${TO_DATE('ts', 2)}`;

/** Terms that returned nothing, most searched first (Finance only, by RLS). */
export async function failedSearches(
  tx: Tx,
  f: FailedSearchFilters,
  opts: { limit?: number; withEvents?: boolean } = {},
): Promise<{ terms: FailedTerm[]; totalTerms: number; searches: number; events: FailedSearchEvent[] }> {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), EXPORT_CAP);
  const [{ terms: totalTerms, searches }] = await tx.query<{ terms: number; searches: number }>(
    `select count(distinct term)::int as terms, count(*)::int as searches from ccp.failed_searches ${FS_WHERE}`,
    [f.from, f.to],
  );
  const terms = await tx.query<FailedTerm>(
    `select term, count(*)::int as searches, count(distinct user_email)::int as users,
            ${UTC_TS('min(ts)')} as first_seen, ${UTC_TS('max(ts)')} as last_seen
       from ccp.failed_searches ${FS_WHERE}
      group by term order by count(*) desc, max(ts) desc, term
      limit $3`,
    [f.from, f.to, limit],
  );
  const events = opts.withEvents
    ? await tx.query<FailedSearchEvent>(
        `select ${UTC_TS('ts')} as ts, user_email, term from ccp.failed_searches ${FS_WHERE}
          order by ts desc, id desc limit $3`,
        [f.from, f.to, EXPORT_CAP],
      )
    : [];
  return { terms, totalTerms, searches, events };
}

// ---------------------------------------------------------------------------
// Export metadata
// ---------------------------------------------------------------------------
export type FilterLines = [label: string, value: string][];

const range = (from: string | null, to: string | null) =>
  from && to ? `${from} to ${to}` : from ? `from ${from}` : to ? `up to ${to}` : 'All dates';

export const describeAuditFilters = (f: AuditFilters): FilterLines => [
  ['Date (UTC)', range(f.from, f.to)],
  ['User contains', f.user ?? 'Any'],
  ['Action', f.actions.length ? f.actions.join(', ') : 'Any'],
  ['Entity', f.entity ?? 'Any'],
  ['Entity id contains', f.entityId ?? 'Any'],
];

export const describeUploadFilters = (f: UploadFilters): FilterLines => [
  ['Uploaded (UTC)', range(f.from, f.to)],
  ['Type', f.kind ? kindLabel(f.kind) : 'Any'],
  ['Status', f.status ? statusLabel(f.status) : 'Any'],
];

export const describeAccessFilters = (f: AccessFilters): FilterLines => [
  ['User contains', f.user ?? 'Any'],
  ['Role', f.role ? ROLE_LABELS[f.role] : 'Any'],
  ['Business unit', f.bu ? `${f.bu} (plus company-wide grants)` : 'Any'],
  ['Rows', f.exceptionsOnly ? 'Exceptions only' : 'All'],
];

export const describeCoverageFilters = (r: CoverageReport): FilterLines => [
  ['Period', r.period ?? 'No actuals published'],
  ['YTD', r.ytdFrom && r.period ? `${r.ytdFrom} to ${r.period} (${r.fyLabel})` : '—'],
  ['Business unit', r.filters.bu ?? 'All'],
  ['Lines', r.filters.unexplainedOnly ? 'Unexplained only' : 'All flagged (|YTD variance| > 10%)'],
];

export const describeFailedSearchFilters = (f: FailedSearchFilters): FilterLines => [['Searched (UTC)', range(f.from, f.to)]];
