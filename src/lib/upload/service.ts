/** Stage -> (review) -> publish workflow for master data uploads. */
import crypto from 'node:crypto';
import type { Tx } from '../db/core';
import { parseUpload, MAX_ROWS } from './parse';
import { TEMPLATES } from './templates';
import { validateMaster, validateOwners, type ExistingState, type Issue, type MasterRecord, type OwnerRecord } from './validate';

export type MasterKind = 'master' | 'owners';

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

export interface StageResult {
  batchId: string;
  status: 'Validated' | 'Rejected';
  rowCount: number;
  errors: Issue[];
  warnings: Issue[];
  summary: { created: number; updated: number; unchanged: number };
}

export async function stageUpload(tx: Tx, user: string, kind: MasterKind, fileName: string, data: Buffer): Promise<StageResult> {
  const file = await parseUpload(fileName, data, TEMPLATES[kind].sheet);
  if (file.rows.length > MAX_ROWS) throw new Error(`Too many rows (max ${MAX_ROWS}).`);
  const existing = await loadExisting(tx);
  const { records, errors, warnings } = runValidation(kind, file, existing);
  const summary = errors.length ? { created: 0, updated: 0, unchanged: 0 } : await diffSummary(tx, kind, records);
  const status = errors.length ? 'Rejected' : 'Validated';
  const [{ id }] = await tx.query<{ id: string }>(
    `insert into ccp.upload_batches (kind, file_name, file_sha256, uploaded_by, status, row_count, error_count, payload, errors, summary)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb) returning id`,
    [kind, fileName.slice(0, 200), crypto.createHash('sha256').update(data).digest('hex'), user, status,
     file.rows.length, errors.length, JSON.stringify(file), JSON.stringify(errors), JSON.stringify({ ...summary, warnings })],
  );
  await tx.query(`select ccp.log_event($1, 'upload_batch', $2, $3::jsonb)`, [
    errors.length ? 'UPLOAD_REJECTED' : 'UPLOAD_VALIDATED', id,
    JSON.stringify({ kind, fileName, rows: file.rows.length, errors: errors.length }),
  ]);
  return { batchId: id, status, rowCount: file.rows.length, errors, warnings, summary };
}

/**
 * Publish a validated batch. Re-validates against the CURRENT master in the
 * same transaction (someone may have changed data since staging) and only
 * then upserts. Audit rows written by the triggers carry the batch id.
 */
export async function publishUpload(tx: Tx, batchId: string) {
  const [batch] = await tx.query<{ kind: MasterKind; status: string; payload: Parameters<typeof validateMaster>[0] }>(
    'select kind, status, payload from ccp.upload_batches where id = $1 for update', [batchId],
  );
  if (!batch) throw new Error('Upload not found.');
  if (batch.status !== 'Validated') throw new Error(`Upload is ${batch.status} and cannot be published.`);

  const { records, errors } = runValidation(batch.kind, batch.payload, await loadExisting(tx));
  if (errors.length) {
    await tx.query(`update ccp.upload_batches set status = 'Rejected', errors = $2::jsonb, error_count = $3 where id = $1`,
      [batchId, JSON.stringify(errors), errors.length]);
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
  await tx.query(
    `update ccp.upload_batches set status = 'Published', published_at = now(), published_by = ccp.app_email(),
       summary = summary || $2::jsonb where id = $1`,
    [batchId, JSON.stringify(summary)],
  );
  await tx.query(`select ccp.log_event('UPLOAD_PUBLISHED', 'upload_batch', $1, $2::jsonb)`, [batchId, JSON.stringify({ kind: batch.kind, ...summary })]);
  return { published: true as const, summary };
}

export async function discardUpload(tx: Tx, batchId: string) {
  const rows = await tx.query(`update ccp.upload_batches set status = 'Discarded' where id = $1 and status = 'Validated' returning id`, [batchId]);
  if (rows.length) await tx.query(`select ccp.log_event('UPLOAD_DISCARDED', 'upload_batch', $1)`, [batchId]);
  return rows.length > 0;
}
