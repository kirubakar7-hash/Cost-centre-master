/**
 * Stage -> (reconcile) -> approve/publish workflow for all uploads.
 *
 * Controls:
 *  - Any validation error rejects the whole file (nothing saved).
 *  - Publish re-validates against the CURRENT database in the same transaction.
 *  - Maker-checker: the publisher must be a different Finance user from the uploader.
 *  - Financials: every period with actuals must reconcile to the trial-balance
 *    total entered by the preparer, or publishing is blocked.
 */
import crypto from 'node:crypto';
import type { Tx } from '../db/core';
import { makerCheckerEnabled, reconTolerance } from '../config';
import { parseUpload, MAX_ROWS, MAX_FINANCIAL_ROWS, type ParsedFile } from './parse';
import { TEMPLATES } from './templates';
import { validateMaster, validateOwners, type ExistingState, type Issue, type MasterRecord, type OwnerRecord } from './validate';
import {
  MAX_AMOUNT,
  roundMoney,
  summarizePeriods,
  validateFinancials,
  type FinancialRecord,
  type FinancialsContext,
  type PeriodSummary,
} from './validate-financials';

export type MasterKind = 'master' | 'owners';
export type BatchKind = MasterKind | 'financials';

/** Expected, user-correctable problems (shown as 400). Anything else is a 500. */
export class UploadError extends Error {}

async function loadExisting(tx: Tx): Promise<ExistingState> {
  const costCentres = await tx.query<{ cc_code: string; cc_alias: string; status: string }>(
    'select cc_code, cc_alias, status from ccp.cost_centres',
  );
  const owned = await tx.query<{ cc_code: string }>('select cc_code from ccp.cc_owners');
  return { costCentres, ownedCodes: owned.map((o) => o.cc_code) };
}

function runValidation(kind: MasterKind, file: Parameters<typeof validateMaster>[0], existing: ExistingState) {
  return kind === 'master' ? validateMaster(file, existing) : validateOwners(file, existing);
}

async function diffSummary(tx: Tx, kind: MasterKind, records: (MasterRecord | OwnerRecord)[]) {
  const table = kind === 'master' ? 'ccp.cost_centres' : 'ccp.cc_owners';
  const cols = Object.keys(records[0] ?? {});
  const current = await tx.query<Record<string, string | null>>(
    `select ${cols.map((c) => `${c}::text as ${c}`).join(', ')} from ${table} where cc_code = any($1)`,
    [records.map((r) => r.cc_code)],
  );
  const byCode = new Map(current.map((r) => [r.cc_code, r]));
  let created = 0, updated = 0, unchanged = 0;
  for (const r of records) {
    const cur = byCode.get(r.cc_code);
    if (!cur) created++;
    else if (cols.some((c) => (cur[c] ?? null) !== ((r as unknown as Record<string, string | null>)[c] ?? null))) updated++;
    else unchanged++;
  }
  return { created, updated, unchanged };
}

async function loadFinancialsContext(tx: Tx): Promise<FinancialsContext> {
  const costCentres = await tx.query<FinancialsContext['costCentres'][number]>(
    'select cc_code, status, start_date::text as start_date, close_date::text as close_date from ccp.cost_centres',
  );
  const gl = await tx.query<{ gl_group: string }>('select distinct gl_group from ccp.financials');
  // Periods with actuals: the register, plus any month that already holds actual figures
  // (e.g. a database seeded before ccp.periods existed — migration 003 does not backfill it),
  // so a budget-only file can never silently wipe published actuals.
  const periods = await tx.query<{ period: string }>(
    `select period from ccp.periods
     union
     select distinct period from ccp.financials where actual is not null`,
  );
  const [{ now }] = await tx.query<{ now: string }>(`select to_char(now(), 'YYYY-MM') as now`);
  return { costCentres, knownGlGroups: gl.map((g) => g.gl_group), publishedPeriods: periods.map((p) => p.period), currentPeriod: now };
}

export interface ReconLine {
  period: string;
  actualTotal: number;
  tbTotal: number | null;
  difference: number | null;
  matched: boolean;
}

export interface StageResult {
  batchId: string;
  kind: BatchKind;
  status: 'Validated' | 'Rejected';
  rowCount: number;
  errors: Issue[];
  warnings: Issue[];
  summary: { created: number; updated: number; unchanged: number; periods?: PeriodSummary[] };
}

async function stageFinancials(tx: Tx, file: ParsedFile) {
  if (file.rows.length > MAX_FINANCIAL_ROWS) throw new UploadError(`Too many rows (max ${MAX_FINANCIAL_ROWS}).`);
  const { records, errors, warnings } = validateFinancials(file, await loadFinancialsContext(tx));
  const periods = errors.length ? [] : summarizePeriods(records);
  return { errors, warnings, summary: { created: records.length, updated: 0, unchanged: 0, periods } };
}

export async function stageUpload(tx: Tx, user: string, kind: BatchKind, fileName: string, data: Buffer): Promise<StageResult> {
  const file = await parseUpload(fileName, data, TEMPLATES[kind].sheet);
  let errors: Issue[];
  let warnings: Issue[];
  let summary: StageResult['summary'];
  if (kind === 'financials') {
    ({ errors, warnings, summary } = await stageFinancials(tx, file));
  } else {
    if (file.rows.length > MAX_ROWS) throw new UploadError(`Too many rows (max ${MAX_ROWS}).`);
    const v = runValidation(kind, file, await loadExisting(tx));
    ({ errors, warnings } = v);
    summary = errors.length ? { created: 0, updated: 0, unchanged: 0 } : await diffSummary(tx, kind, v.records);
  }
  const status = errors.length ? 'Rejected' : 'Validated';
  // uploaded_by is the authenticated DB identity (normalised by ccp.app_email()), not the
  // caller-supplied string: maker-checker compares it with ccp.app_email() at publish time,
  // so a differently-cased or wrong `user` must not let the uploader approve their own file.
  const [{ id }] = await tx.query<{ id: string }>(
    `insert into ccp.upload_batches (kind, file_name, file_sha256, uploaded_by, status, row_count, error_count, payload, errors, summary)
     values ($1,$2,$3,coalesce(ccp.app_email(), $4),$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb) returning id`,
    [kind, fileName.slice(0, 200), crypto.createHash('sha256').update(data).digest('hex'), user, status,
     file.rows.length, errors.length, JSON.stringify(file), JSON.stringify(errors), JSON.stringify({ ...summary, warnings })],
  );
  await tx.query(`select ccp.log_event($1, 'upload_batch', $2, $3::jsonb)`, [
    errors.length ? 'UPLOAD_REJECTED' : 'UPLOAD_VALIDATED', id,
    JSON.stringify({ kind, fileName, rows: file.rows.length, errors: errors.length }),
  ]);
  return { batchId: id, kind, status, rowCount: file.rows.length, errors, warnings, summary };
}

interface BatchRow {
  kind: BatchKind;
  status: string;
  uploaded_by: string;
  payload: ParsedFile;
}

async function lockBatch(tx: Tx, batchId: string): Promise<BatchRow> {
  const [batch] = await tx.query<BatchRow>(
    'select kind, status, uploaded_by, payload from ccp.upload_batches where id = $1 for update', [batchId],
  );
  if (!batch) throw new UploadError('Upload not found.');
  if (batch.status !== 'Validated') throw new UploadError(`Upload is ${batch.status} and cannot be changed.`);
  return batch;
}

async function currentUser(tx: Tx): Promise<string> {
  const [{ email }] = await tx.query<{ email: string }>('select ccp.app_email() as email');
  return email;
}

/** Compare uploaded CC actuals with the trial-balance totals stored for this batch. */
async function reconcile(tx: Tx, batchId: string, periods: PeriodSummary[]): Promise<ReconLine[]> {
  const tbRows = await tx.query<{ period: string; tb_total: string }>(
    'select period, tb_total from ccp.trial_balances where batch_id = $1', [batchId],
  );
  const tb = new Map(tbRows.map((r) => [r.period, Number(r.tb_total)]));
  const tol = reconTolerance();
  return periods
    .filter((p) => p.actualTotal !== null)
    .map((p) => {
      const tbTotal = tb.has(p.period) ? tb.get(p.period)! : null;
      const difference = tbTotal === null ? null : Math.round((p.actualTotal! - tbTotal) * 100) / 100;
      return { period: p.period, actualTotal: p.actualTotal!, tbTotal, difference, matched: difference !== null && Math.abs(difference) <= tol };
    });
}

/**
 * Preparer (the uploader) enters the trial-balance total for each period
 * that has actuals. Returns the reconciliation; does not publish.
 */
export async function enterTrialBalance(tx: Tx, batchId: string, totals: Record<string, number>) {
  const batch = await lockBatch(tx, batchId);
  if (batch.kind !== 'financials') throw new UploadError('Trial balance applies to Budget & Actuals uploads only.');
  const me = await currentUser(tx);
  if (makerCheckerEnabled() && batch.uploaded_by !== me)
    throw new UploadError('Only the preparer who uploaded the file can enter the trial balance.');

  const { records } = validateFinancials(batch.payload, await loadFinancialsContext(tx));
  const periods = summarizePeriods(records);
  const needed = new Set(periods.filter((p) => p.actualTotal !== null).map((p) => p.period));
  for (const [period, value] of Object.entries(totals)) {
    if (!needed.has(period)) throw new UploadError(`Period ${period} has no actuals in this upload.`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new UploadError(`Trial balance for ${period} must be a number.`);
    if (Math.abs(value) >= MAX_AMOUNT) throw new UploadError(`Trial balance for ${period} is too large.`);
    await tx.query(
      `insert into ccp.trial_balances (batch_id, period, tb_total, entered_by) values ($1, $2, $3, ccp.app_email())
       on conflict (batch_id, period) do update set tb_total = excluded.tb_total, entered_by = excluded.entered_by, entered_at = now()`,
      [batchId, period, roundMoney(value)],
    );
  }
  const recon = await reconcile(tx, batchId, periods);
  const allMatched = recon.length > 0 && recon.every((r) => r.matched);
  await tx.query(`update ccp.upload_batches set summary = summary || $2::jsonb where id = $1`, [
    batchId, JSON.stringify({ reconciliation: recon, reconciled: allMatched }),
  ]);
  await tx.query(`select ccp.log_event('TB_ENTERED', 'upload_batch', $1, $2::jsonb)`, [batchId, JSON.stringify({ totals })]);
  await tx.query(`select ccp.log_event($1, 'upload_batch', $2, $3::jsonb)`, [
    allMatched ? 'RECON_PASSED' : 'RECON_FAILED', batchId, JSON.stringify({ reconciliation: recon }),
  ]);
  return { reconciliation: recon, reconciled: allMatched };
}

async function publishFinancials(tx: Tx, batchId: string, batch: BatchRow) {
  const { records, errors } = validateFinancials(batch.payload, await loadFinancialsContext(tx));
  if (errors.length) return { published: false as const, errors };
  const periods = summarizePeriods(records);
  const recon = await reconcile(tx, batchId, periods);
  const blocked = recon.filter((r) => !r.matched);
  if (blocked.length) {
    await tx.query(`select ccp.log_event('RECON_FAILED', 'upload_batch', $1, $2::jsonb)`, [
      batchId, JSON.stringify({ stage: 'publish', reconciliation: recon }),
    ]);
    return {
      published: false as const,
      errors: [] as Issue[],
      reconciliation: recon,
      error: `Publishing blocked: ${blocked.map((r) => (r.tbTotal === null ? `${r.period} has no trial balance entered` : `${r.period} differs from the trial balance by ${r.difference}`)).join('; ')}.`,
    };
  }

  const periodList = periods.map((p) => p.period);
  const before = await tx.query<{ period: string; budget: string; actual: string | null }>(
    `select period, sum(budget)::text as budget, sum(actual)::text as actual
       from ccp.financials where period = any ($1) group by period`, [periodList],
  );
  await tx.query('delete from ccp.financials where period = any ($1)', [periodList]);
  await tx.query(
    `insert into ccp.financials (cc_code, period, gl_group, budget, actual)
     select cc_code, period, gl_group, budget, actual
       from jsonb_to_recordset($1::jsonb) as r(cc_code text, period text, gl_group text, budget numeric, actual numeric)`,
    [JSON.stringify(records satisfies FinancialRecord[])],
  );
  for (const r of recon) {
    await tx.query(
      `insert into ccp.periods (period, actual_total, tb_total, batch_id, published_by, published_at)
       values ($1, $2, $3, $4, ccp.app_email(), now())
       on conflict (period) do update set actual_total = excluded.actual_total, tb_total = excluded.tb_total,
         batch_id = excluded.batch_id, published_by = excluded.published_by, published_at = now()`,
      [r.period, r.actualTotal, r.tbTotal, batchId],
    );
  }
  return {
    published: true as const,
    summary: { created: records.length, updated: 0, unchanged: 0, periods, reconciliation: recon, before },
  };
}

/**
 * Publish a validated batch. Re-validates against the CURRENT master in the
 * same transaction (someone may have changed data since staging) and only
 * then upserts. Audit rows written by the triggers carry the batch id.
 */
export async function publishUpload(tx: Tx, batchId: string) {
  const batch = await lockBatch(tx, batchId);
  const me = await currentUser(tx);
  if (makerCheckerEnabled() && batch.uploaded_by === me)
    throw new UploadError('Segregation of duties: a different Finance user must approve and publish this upload.');

  if (batch.kind === 'financials') {
    const result = await publishFinancials(tx, batchId, batch);
    if (result.published) {
      await markPublished(tx, batchId, result.summary);
    } else if (result.errors.length) {
      await markRejected(tx, batchId, result.errors);
    }
    return result;
  }

  const { records, errors } = runValidation(batch.kind, batch.payload, await loadExisting(tx));
  if (errors.length) {
    await markRejected(tx, batchId, errors);
    return { published: false as const, errors };
  }
  const summary = await diffSummary(tx, batch.kind, records);

  if (batch.kind === 'master') {
    for (const r of records as MasterRecord[]) {
      await tx.query(
        `insert into ccp.cost_centres (cc_code, cc_alias, entity, bu, department, type, keywords, status, start_date, close_date)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (cc_code) do update set cc_alias = excluded.cc_alias, entity = excluded.entity, bu = excluded.bu,
           department = excluded.department, type = excluded.type, keywords = excluded.keywords, status = excluded.status,
           start_date = excluded.start_date, close_date = excluded.close_date`,
        [r.cc_code, r.cc_alias, r.entity, r.bu, r.department, r.type, r.keywords, r.status, r.start_date, r.close_date],
      );
    }
  } else {
    for (const r of records as OwnerRecord[]) {
      await tx.query(
        `insert into ccp.cc_owners (cc_code, owner_name, owner_email, backup_owner_email, bu_head_email)
         values ($1,$2,$3,$4,$5)
         on conflict (cc_code) do update set owner_name = excluded.owner_name, owner_email = excluded.owner_email,
           backup_owner_email = excluded.backup_owner_email, bu_head_email = excluded.bu_head_email`,
        [r.cc_code, r.owner_name, r.owner_email, r.backup_owner_email, r.bu_head_email],
      );
    }
  }
  await markPublished(tx, batchId, summary);
  return { published: true as const, summary };
}

async function markRejected(tx: Tx, batchId: string, errors: Issue[]) {
  await tx.query(`update ccp.upload_batches set status = 'Rejected', errors = $2::jsonb, error_count = $3 where id = $1`,
    [batchId, JSON.stringify(errors), errors.length]);
  await tx.query(`select ccp.log_event('UPLOAD_REJECTED', 'upload_batch', $1, $2::jsonb)`,
    [batchId, JSON.stringify({ stage: 'publish', errors: errors.length })]);
}

async function markPublished(tx: Tx, batchId: string, summary: object) {
  await tx.query(
    `update ccp.upload_batches set status = 'Published', published_at = now(), published_by = ccp.app_email(),
       approved_by = ccp.app_email(), summary = summary || $2::jsonb where id = $1`,
    [batchId, JSON.stringify(summary)],
  );
  await tx.query(`select ccp.log_event('UPLOAD_PUBLISHED', 'upload_batch', $1, $2::jsonb)`, [batchId, JSON.stringify(summary)]);
}

export interface PendingBatch {
  id: string;
  kind: BatchKind;
  file_name: string;
  file_sha256: string;
  uploaded_by: string;
  uploaded_at: string;
  row_count: number;
  summary: StageResult['summary'] & { warnings?: Issue[]; reconciliation?: ReconLine[]; reconciled?: boolean };
}

/** Validated uploads waiting for approval (Finance only via RLS). */
export async function pendingBatches(tx: Tx): Promise<PendingBatch[]> {
  return tx.query<PendingBatch>(
    `select id, kind, file_name, file_sha256, uploaded_by, to_char(uploaded_at, 'DD Mon YYYY HH24:MI') as uploaded_at,
            row_count, summary
       from ccp.upload_batches where status = 'Validated' order by uploaded_at desc limit 20`,
  );
}

export async function discardUpload(tx: Tx, batchId: string) {
  const rows = await tx.query(`update ccp.upload_batches set status = 'Discarded' where id = $1 and status = 'Validated' returning id`, [batchId]);
  if (rows.length) await tx.query(`select ccp.log_event('UPLOAD_DISCARDED', 'upload_batch', $1)`, [batchId]);
  return rows.length > 0;
}
