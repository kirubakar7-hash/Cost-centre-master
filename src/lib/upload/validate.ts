/**
 * Upload validation rules (pure functions — unit tested, no DB access).
 * Errors block publishing; warnings are informational.
 */
import { isAllowedEmail, allowedDomains } from '../config';
import { TEMPLATES } from './templates';
import type { ParsedFile } from './parse';

export interface Issue {
  row: number | null; // null = file-level
  column: string | null;
  code: string;
  message: string;
}

export interface MasterRecord {
  cc_code: string; cc_alias: string; entity: string; bu: string; department: string;
  type: string; keywords: string; status: string; start_date: string; close_date: string | null;
}
export interface OwnerRecord {
  cc_code: string; owner_name: string; owner_email: string; backup_owner_email: string; bu_head_email: string | null;
}

export interface ExistingState {
  costCentres: { cc_code: string; cc_alias: string; status: string }[];
  ownedCodes: string[];
}

export interface ValidationResult<T> {
  records: T[];
  errors: Issue[];
  warnings: Issue[];
}

const CODE_RE = /^[A-Z]{2}-[A-Z0-9]{2,6}-[0-9]{3,4}$/;
const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const ENTITIES = ['IN', 'US', 'UK'];
const TYPES = ['Direct', 'Shared', 'Allocated'];
const STATUSES = ['Active', 'Inactive'];

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY. Returns ISO date or null. */
export function normalizeDate(input: string): string | null {
  const s = input.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const canon = (value: string, allowed: string[]) => allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase());

function checkHeaders(file: ParsedFile, kind: 'master' | 'owners'): Issue[] {
  const missing = TEMPLATES[kind].columns.filter((c) => c.required && !file.headers.includes(c.key)).map((c) => c.key);
  const issues: Issue[] = missing.map((col) => ({
    row: null, column: col, code: 'MISSING_COLUMN',
    message: `Required column "${col}" is missing. Download the latest template.`,
  }));
  if (file.rows.length === 0) issues.push({ row: null, column: null, code: 'EMPTY_FILE', message: 'The file has no data rows.' });
  return issues;
}

export function validateMaster(file: ParsedFile, existing: ExistingState): ValidationResult<MasterRecord> {
  const errors = checkHeaders(file, 'master');
  const warnings: Issue[] = [];
  if (errors.length) return { records: [], errors, warnings };

  const records: MasterRecord[] = [];
  const seenCode = new Map<string, number>();
  const seenAlias = new Map<string, number>();
  const dbAlias = new Map(existing.costCentres.map((c) => [c.cc_alias.toLowerCase(), c.cc_code]));
  const owned = new Set(existing.ownedCodes);

  for (const { row, values: v } of file.rows) {
    const err = (column: string | null, code: string, message: string) => errors.push({ row, column, code, message });
    const code = (v.CC_Code ?? '').toUpperCase().replace(/\s+/g, '');
    const alias = (v.CC_Alias ?? '').replace(/\s+/g, ' ').trim();
    const entity = (v.Entity ?? '').toUpperCase();
    const type = canon(v.Type ?? '', TYPES);
    const status = canon(v.Status ?? '', STATUSES);
    const start = normalizeDate(v.Start_Date ?? '');
    const close = v.Close_Date ? normalizeDate(v.Close_Date) : null;

    if (!code) err('CC_Code', 'REQUIRED', 'CC_Code is required.');
    else if (!CODE_RE.test(code)) err('CC_Code', 'INVALID_CODE', `"${code}" is not a valid code (format: IN-ENG-101).`);
    else if (seenCode.has(code)) err('CC_Code', 'DUPLICATE_CODE', `Duplicate code ${code} (also on row ${seenCode.get(code)}).`);
    if (code && !seenCode.has(code)) seenCode.set(code, row);

    if (!alias) err('CC_Alias', 'REQUIRED', 'CC_Alias is required.');
    else if (alias.length < 2 || alias.length > 80) err('CC_Alias', 'INVALID_ALIAS', 'CC_Alias must be 2-80 characters.');
    else {
      const key = alias.toLowerCase();
      if (seenAlias.has(key)) err('CC_Alias', 'DUPLICATE_ALIAS', `Duplicate alias "${alias}" (also on row ${seenAlias.get(key)}).`);
      else seenAlias.set(key, row);
      const holder = dbAlias.get(key);
      if (holder && holder !== code) err('CC_Alias', 'DUPLICATE_ALIAS', `Alias "${alias}" is already used by ${holder}.`);
    }

    if (!ENTITIES.includes(entity)) err('Entity', 'INVALID_ENTITY', `Entity must be one of ${ENTITIES.join(', ')}.`);
    else if (CODE_RE.test(code) && code.split('-')[0] !== entity)
      err('CC_Code', 'ENTITY_MISMATCH', `Code prefix ${code.split('-')[0]} does not match Entity ${entity}.`);
    if (!v.BU) err('BU', 'REQUIRED', 'BU is required.');
    if (!v.Department) err('Department', 'REQUIRED', 'Department is required.');
    if (!type) err('Type', 'INVALID_TYPE', `Type must be one of ${TYPES.join(', ')}.`);
    if (!status) err('Status', 'INVALID_STATUS', 'Status must be Active or Inactive.');
    if (!start) err('Start_Date', 'INVALID_DATE', 'Start_Date is required (YYYY-MM-DD or DD/MM/YYYY).');
    if (v.Close_Date && !close) err('Close_Date', 'INVALID_DATE', 'Close_Date is not a valid date.');
    if (start && close && close < start) err('Close_Date', 'CLOSE_BEFORE_START', 'Close_Date is before Start_Date.');
    if (status === 'Inactive' && !v.Close_Date) err('Close_Date', 'INACTIVE_NEEDS_CLOSE', 'Inactive cost centres need a Close_Date.');
    if (status === 'Active' && close) err('Close_Date', 'ACTIVE_WITH_CLOSE', 'An Active cost centre cannot have a Close_Date.');

    if (status === 'Inactive' && owned.has(code))
      warnings.push({ row, column: 'Status', code: 'INACTIVE_WITH_OWNER', message: `${code} has an owner mapping — it will be removed on deactivation.` });

    records.push({
      cc_code: code, cc_alias: alias, entity, bu: (v.BU ?? '').trim(), department: (v.Department ?? '').trim(),
      type: type ?? '', status: status ?? '', start_date: start ?? '', close_date: close,
      keywords: (v.Keywords ?? '').split(/[;,]/).map((k) => k.trim().toLowerCase()).filter(Boolean).join('; '),
    });
  }

  const known = new Set(existing.costCentres.map((c) => c.cc_code));
  const warned = new Set<string>(); // one warning per code, even if the code is duplicated in the file
  for (const r of records) {
    if (r.cc_code && r.status === 'Active' && !owned.has(r.cc_code) && !known.has(r.cc_code) && !warned.has(r.cc_code)) {
      warned.add(r.cc_code);
      warnings.push({ row: seenCode.get(r.cc_code) ?? null, column: null, code: 'NEEDS_OWNER', message: `New cost centre ${r.cc_code} needs an owner mapping upload.` });
    }
  }
  return { records, errors, warnings };
}

export function validateOwners(file: ParsedFile, existing: ExistingState): ValidationResult<OwnerRecord> {
  const errors = checkHeaders(file, 'owners');
  const warnings: Issue[] = [];
  if (errors.length) return { records: [], errors, warnings };

  const status = new Map(existing.costCentres.map((c) => [c.cc_code, c.status]));
  const seen = new Map<string, number>();
  const records: OwnerRecord[] = [];
  const domains = allowedDomains().map((d) => `@${d}`).join(' / ');

  for (const { row, values: v } of file.rows) {
    const err = (column: string | null, code: string, message: string) => errors.push({ row, column, code, message });
    const code = (v.CC_Code ?? '').toUpperCase().replace(/\s+/g, '');
    const name = (v.Owner_Name ?? '').replace(/\s+/g, ' ').trim();
    const owner = (v.Owner_Email ?? '').trim().toLowerCase();
    const backup = (v.Backup_Owner_Email ?? '').trim().toLowerCase();
    const head = (v.BU_Head_Email ?? '').trim().toLowerCase();

    if (!code) err('CC_Code', 'REQUIRED', 'CC_Code is required.');
    else if (!status.has(code)) err('CC_Code', 'UNKNOWN_CC', `${code} is not in the cost centre master. Publish a master upload with this code first.`);
    else if (status.get(code) === 'Inactive') err('CC_Code', 'INACTIVE_WITH_OWNER', `${code} is Inactive — an inactive cost centre cannot have an owner.`);
    if (code && seen.has(code)) err('CC_Code', 'DUPLICATE_CODE', `${code} appears more than once (also row ${seen.get(code)}).`);
    else if (code) seen.set(code, row);

    if (!name) err('Owner_Name', 'MISSING_OWNER', 'Owner_Name is missing.');
    if (!owner) err('Owner_Email', 'MISSING_OWNER', 'Owner_Email is missing.');

    const checkEmail = (col: string, email: string) => {
      if (!email) return;
      if (!EMAIL_RE.test(email)) err(col, 'INVALID_EMAIL', `"${email}" is not a valid email address.`);
      else if (!isAllowedEmail(email)) err(col, 'EXTERNAL_DOMAIN', `${email} is not on the ${domains} domain.`);
    };
    checkEmail('Owner_Email', owner);
    if (!backup) err('Backup_Owner_Email', 'NO_BACKUP_OWNER', 'Every cost centre needs a backup owner.');
    checkEmail('Backup_Owner_Email', backup);
    if (owner && backup && owner === backup) err('Backup_Owner_Email', 'BACKUP_SAME_AS_OWNER', 'Backup owner must be a different person.');
    checkEmail('BU_Head_Email', head);

    records.push({ cc_code: code, owner_name: name, owner_email: owner, backup_owner_email: backup, bu_head_email: head || null });
  }

  const mapped = new Set([...existing.ownedCodes, ...records.map((r) => r.cc_code)]);
  for (const c of existing.costCentres) {
    if (c.status === 'Active' && !mapped.has(c.cc_code))
      warnings.push({ row: null, column: null, code: 'MISSING_OWNER', message: `Active cost centre ${c.cc_code} still has no owner.` });
  }
  return { records, errors, warnings };
}
