/** Upload validation rules (pure) + the stage -> publish workflow against a real (PGlite) database. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withUserOn } from '../src/lib/db/core';
import { parseCsv, parseUpload, MAX_ROWS, type ParsedFile } from '../src/lib/upload/parse';
import { discardUpload, publishUpload, stageUpload } from '../src/lib/upload/service';
import { buildTemplate, TEMPLATES } from '../src/lib/upload/templates';
import { normalizeDate, validateMaster, validateOwners, type ExistingState, type Issue } from '../src/lib/upload/validate';
import { ARUN, KAVYA, MEENA, RAJESH, as, asSuper, freshDb, resetDb, type Driver } from './helpers';

const MASTER_HEADERS = TEMPLATES.master.columns.map((c) => c.key);
const OWNER_HEADERS = TEMPLATES.owners.columns.map((c) => c.key);
const D = 'solidpro-es.com';

type Values = Record<string, string>;

function file(headers: string[], rows: Values[]): ParsedFile {
  return {
    headers,
    rows: rows.map((v, i) => ({ row: i + 2, values: Object.fromEntries(headers.map((h) => [h, v[h] ?? ''])) })),
  };
}

const cc = (over: Values = {}): Values => ({
  CC_Code: 'IN-ENG-104', CC_Alias: 'Design Coimbatore', Entity: 'IN', BU: 'Engineering', Department: 'Mechanical Design',
  Type: 'Direct', Keywords: 'cad; coimbatore', Status: 'Active', Start_Date: '2026-10-01', Close_Date: '', ...over,
});
const owner = (over: Values = {}): Values => ({
  CC_Code: 'IN-ENG-101', Owner_Name: 'Meena Raj', Owner_Email: `meena.raj@${D}`,
  Backup_Owner_Email: `karthik.v@${D}`, BU_Head_Email: `vikram.iyer@${D}`, ...over,
});

const EXISTING: ExistingState = {
  costCentres: [
    { cc_code: 'IN-ENG-101', cc_alias: 'Design Chennai', status: 'Active' },
    { cc_code: 'IN-ENG-102', cc_alias: 'Simulation & CAE Chennai', status: 'Active' },
    { cc_code: 'IN-ENG-199', cc_alias: 'Legacy Drafting Coimbatore', status: 'Inactive' },
  ],
  ownedCodes: ['IN-ENG-101', 'IN-ENG-102'],
};

const master = (...rows: Values[]) => validateMaster(file(MASTER_HEADERS, rows), EXISTING);
const owners = (...rows: Values[]) => validateOwners(file(OWNER_HEADERS, rows), EXISTING);
const pick = (issues: Issue[]) => issues.map(({ row, column, code }) => ({ row, column, code }));

let savedDomains: string | undefined;
beforeAll(() => {
  savedDomains = process.env.ALLOWED_EMAIL_DOMAINS;
  delete process.env.ALLOWED_EMAIL_DOMAINS; // default: solidpro-es.com
});
afterAll(() => {
  if (savedDomains === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
  else process.env.ALLOWED_EMAIL_DOMAINS = savedDomains;
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
describe('normalizeDate', () => {
  it('accepts ISO, DD/MM/YYYY and DD-MM-YYYY', () => {
    expect(normalizeDate('2026-10-01')).toBe('2026-10-01');
    expect(normalizeDate('2026-1-5')).toBe('2026-01-05');
    expect(normalizeDate('01/10/2026')).toBe('2026-10-01'); // day first
    expect(normalizeDate('1-10-2026')).toBe('2026-10-01');
    expect(normalizeDate(' 29/02/2024 ')).toBe('2024-02-29');
  });
  it('rejects impossible or ambiguous dates', () => {
    for (const bad of ['', 'abc', '31/02/2026', '29/02/2025', '2026-13-01', '2026-00-10', '10/01/26', '2026/10/01', '01.10.2026']) {
      expect(normalizeDate(bad), bad).toBeNull();
    }
  });
});

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas/newlines, CRLF and BOM', () => {
    const text = '﻿CC_Code,CC_Alias,Keywords\r\nIN-ENG-101,"Design, Chennai","say ""hi""\nline2"\r\nIN-ENG-102,Sim,\r\n';
    expect(parseCsv(text)).toEqual([
      ['CC_Code', 'CC_Alias', 'Keywords'],
      ['IN-ENG-101', 'Design, Chennai', 'say "hi"\nline2'],
      ['IN-ENG-102', 'Sim', ''],
    ]);
  });
  it('keeps a trailing empty field on the last line without a newline', () => {
    expect(parseCsv('a,b\n1,')).toEqual([['a', 'b'], ['1', '']]);
    expect(parseCsv('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });
});

describe('parseUpload', () => {
  it('parses CSV into header-keyed rows with spreadsheet row numbers, skipping blank lines', async () => {
    const parsed = await parseUpload('x.csv', Buffer.from('\n CC_Code , CC_Alias \nIN-ENG-101,  Design Chennai \n,\nIN-ENG-102,Sim\n'));
    expect(parsed.headers).toEqual(['CC_Code', 'CC_Alias']);
    expect(parsed.rows).toEqual([
      { row: 3, values: { CC_Code: 'IN-ENG-101', CC_Alias: 'Design Chennai' } },
      { row: 5, values: { CC_Code: 'IN-ENG-102', CC_Alias: 'Sim' } },
    ]);
  });
  it('reads the generated .xlsx template', async () => {
    const parsed = await parseUpload('t.xlsx', await buildTemplate('master'), TEMPLATES.master.sheet);
    expect(parsed.headers).toEqual(MASTER_HEADERS);
    expect(parsed.rows.map((r) => r.values.CC_Code)).toEqual(['IN-ENG-104', 'US-SAL-602']);
    expect(parsed.rows[0].row).toBe(2);
  });
  it('rejects other file types', async () => {
    await expect(parseUpload('x.xls', Buffer.from(''))).rejects.toThrow(/Only .xlsx or .csv/);
  });
});

// ---------------------------------------------------------------------------
// validateMaster
// ---------------------------------------------------------------------------
describe('validateMaster', () => {
  it('a clean file has no errors and records are normalised', () => {
    const r = master(
      cc({ CC_Code: ' in-eng-104 ', CC_Alias: '  Design   Coimbatore ', Type: 'direct', Status: 'active',
           Keywords: 'CAD;  Coimbatore , drafting;', Start_Date: '01/10/2026' }),
      cc({ CC_Code: 'IN-ENG-101', CC_Alias: 'Design Chennai', Keywords: 'cad' }), // update keeps its own alias
      cc({ CC_Code: 'IN-ENG-199', CC_Alias: 'Legacy Drafting Coimbatore', Status: 'Inactive', Start_Date: '2018-04-01', Close_Date: '2025-03-31' }),
    );
    expect(r.errors).toEqual([]);
    expect(r.records[0]).toEqual({
      cc_code: 'IN-ENG-104', cc_alias: 'Design Coimbatore', entity: 'IN', bu: 'Engineering', department: 'Mechanical Design',
      type: 'Direct', keywords: 'cad; coimbatore; drafting', status: 'Active', start_date: '2026-10-01', close_date: null,
    });
    expect(r.records[2]).toMatchObject({ status: 'Inactive', close_date: '2025-03-31' });
    expect(pick(r.warnings)).toEqual([{ row: 2, column: null, code: 'NEEDS_OWNER' }]);
  });

  it('optional columns may be absent', () => {
    const headers = MASTER_HEADERS.filter((h) => h !== 'Keywords' && h !== 'Close_Date');
    const r = validateMaster(file(headers, [cc()]), EXISTING);
    expect(r.errors).toEqual([]);
    expect(r.records[0].keywords).toBe('');
  });

  it('duplicate codes in the file (case/space-insensitive)', () => {
    const r = master(cc(), cc({ CC_Code: ' in-eng-104', CC_Alias: 'Other Alias' }));
    expect(pick(r.errors)).toEqual([{ row: 3, column: 'CC_Code', code: 'DUPLICATE_CODE' }]);
    expect(r.errors[0].message).toMatch(/row 2/);
    // NEEDS_OWNER is reported once per code, not once per duplicated row
    expect(r.warnings.filter((w) => w.code === 'NEEDS_OWNER')).toHaveLength(1);
  });

  it('duplicate aliases in the file (case/space-insensitive)', () => {
    const r = master(cc(), cc({ CC_Code: 'IN-ENG-105', CC_Alias: 'design  COIMBATORE' }));
    expect(pick(r.errors)).toEqual([{ row: 3, column: 'CC_Alias', code: 'DUPLICATE_ALIAS' }]);
  });

  it('alias already used by another cost centre in the database', () => {
    const r = master(cc({ CC_Alias: 'design chennai' }));
    expect(pick(r.errors)).toEqual([{ row: 2, column: 'CC_Alias', code: 'DUPLICATE_ALIAS' }]);
    expect(r.errors[0].message).toMatch(/IN-ENG-101/);
    // ...including an inactive one (aliases stay unique forever)
    expect(pick(master(cc({ CC_Alias: 'Legacy Drafting Coimbatore' })).errors)).toEqual([
      { row: 2, column: 'CC_Alias', code: 'DUPLICATE_ALIAS' },
    ]);
  });

  it('entity / code prefix mismatch', () => {
    const r = master(cc({ CC_Code: 'US-ENG-104', Entity: 'IN' }));
    expect(pick(r.errors)).toEqual([{ row: 2, column: 'CC_Code', code: 'ENTITY_MISMATCH' }]);
  });

  it('inactive without a close date', () => {
    const r = master(cc({ Status: 'Inactive' }));
    expect(pick(r.errors)).toEqual([{ row: 2, column: 'Close_Date', code: 'INACTIVE_NEEDS_CLOSE' }]);
  });

  it('deactivating an owned cost centre is allowed but warns that the owner mapping goes', () => {
    const r = master(cc({ CC_Code: 'IN-ENG-101', CC_Alias: 'Design Chennai', Status: 'Inactive', Close_Date: '2026-09-30', Start_Date: '2019-04-01' }));
    expect(r.errors).toEqual([]);
    expect(pick(r.warnings)).toEqual([{ row: 2, column: 'Status', code: 'INACTIVE_WITH_OWNER' }]);
  });

  it('other field rules', () => {
    const codes = (v: Values) => pick(master(cc(v)).errors).map((e) => e.code);
    expect(codes({ CC_Code: '' })).toEqual(['REQUIRED']);
    expect(codes({ CC_Code: 'ENG-104' })).toEqual(['INVALID_CODE']);
    expect(codes({ CC_Alias: '' })).toEqual(['REQUIRED']);
    expect(codes({ CC_Alias: 'X' })).toEqual(['INVALID_ALIAS']);
    expect(codes({ CC_Alias: 'x'.repeat(81) })).toEqual(['INVALID_ALIAS']);
    expect(codes({ Entity: 'DE' })).toEqual(['INVALID_ENTITY']);
    expect(codes({ BU: '' })).toEqual(['REQUIRED']);
    expect(codes({ Department: '' })).toEqual(['REQUIRED']);
    expect(codes({ Type: 'Indirect' })).toEqual(['INVALID_TYPE']);
    expect(codes({ Status: 'Closed' })).toEqual(['INVALID_STATUS']);
    expect(codes({ Start_Date: '' })).toEqual(['INVALID_DATE']);
    expect(codes({ Start_Date: '31/02/2026' })).toEqual(['INVALID_DATE']);
    expect(codes({ Status: 'Inactive', Close_Date: 'soon' })).toEqual(['INVALID_DATE']);
    expect(codes({ Status: 'Inactive', Close_Date: '2026-09-30' })).toEqual(['CLOSE_BEFORE_START']);
    expect(codes({ Close_Date: '2027-01-01' })).toEqual(['ACTIVE_WITH_CLOSE']);
  });

  it('missing required column -> file-level error, no records', () => {
    const headers = MASTER_HEADERS.filter((h) => h !== 'CC_Alias');
    const r = validateMaster(file(headers, [cc()]), EXISTING);
    expect(pick(r.errors)).toEqual([{ row: null, column: 'CC_Alias', code: 'MISSING_COLUMN' }]);
    expect(r.records).toEqual([]);
  });

  it('empty file -> file-level error', () => {
    expect(pick(validateMaster(file(MASTER_HEADERS, []), EXISTING).errors)).toEqual([{ row: null, column: null, code: 'EMPTY_FILE' }]);
  });
});

// ---------------------------------------------------------------------------
// validateOwners
// ---------------------------------------------------------------------------
describe('validateOwners', () => {
  afterEach(() => {
    delete process.env.ALLOWED_EMAIL_DOMAINS;
  });

  it('a clean file has no errors and emails are normalised', () => {
    const r = owners(owner({ CC_Code: ' in-eng-101', Owner_Email: ` Meena.Raj@${D.toUpperCase()} `, BU_Head_Email: '' }),
      owner({ CC_Code: 'IN-ENG-102' }));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.records[0]).toEqual({
      cc_code: 'IN-ENG-101', owner_name: 'Meena Raj', owner_email: `meena.raj@${D}`,
      backup_owner_email: `karthik.v@${D}`, bu_head_email: null,
    });
  });

  it('missing owner name / email', () => {
    expect(pick(owners(owner({ Owner_Name: '' })).errors)).toEqual([{ row: 2, column: 'Owner_Name', code: 'MISSING_OWNER' }]);
    expect(pick(owners(owner({ Owner_Email: ' ' })).errors)).toEqual([{ row: 2, column: 'Owner_Email', code: 'MISSING_OWNER' }]);
  });

  it('invalid email', () => {
    expect(pick(owners(owner({ Owner_Email: 'meena.raj' })).errors)).toEqual([{ row: 2, column: 'Owner_Email', code: 'INVALID_EMAIL' }]);
    expect(pick(owners(owner({ Backup_Owner_Email: 'karthik v@solidpro-es.com' })).errors)).toEqual([
      { row: 2, column: 'Backup_Owner_Email', code: 'INVALID_EMAIL' },
    ]);
    expect(pick(owners(owner({ BU_Head_Email: 'vikram@' })).errors)).toEqual([{ row: 2, column: 'BU_Head_Email', code: 'INVALID_EMAIL' }]);
  });

  it('owner / backup / BU head not on the allowed domain', () => {
    expect(pick(owners(owner({ Owner_Email: 'meena@gmail.com' })).errors)).toEqual([{ row: 2, column: 'Owner_Email', code: 'EXTERNAL_DOMAIN' }]);
    expect(pick(owners(owner({ Owner_Email: 'meena@solidpro-es.com.evil.io' })).errors)).toEqual([
      { row: 2, column: 'Owner_Email', code: 'EXTERNAL_DOMAIN' },
    ]);
    expect(pick(owners(owner({ Owner_Email: 'meena@mail.solidpro-es.com' })).errors)).toEqual([
      { row: 2, column: 'Owner_Email', code: 'EXTERNAL_DOMAIN' },
    ]);
    expect(pick(owners(owner({ Backup_Owner_Email: 'k@outlook.com' })).errors)).toEqual([
      { row: 2, column: 'Backup_Owner_Email', code: 'EXTERNAL_DOMAIN' },
    ]);
    expect(pick(owners(owner({ BU_Head_Email: 'v@yahoo.com' })).errors)).toEqual([{ row: 2, column: 'BU_Head_Email', code: 'EXTERNAL_DOMAIN' }]);
  });

  it('honours ALLOWED_EMAIL_DOMAINS (comma-separated, optional @)', () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'solidpro-es.com, @SolidPro.in';
    expect(owners(owner({ Backup_Owner_Email: 'karthik.v@solidpro.in' })).errors).toEqual([]);
    expect(pick(owners(owner({ Backup_Owner_Email: 'karthik.v@gmail.com' })).errors).map((e) => e.code)).toEqual(['EXTERNAL_DOMAIN']);
  });

  it('inactive cost centre cannot get an owner', () => {
    expect(pick(owners(owner({ CC_Code: 'IN-ENG-199' })).errors)).toEqual([{ row: 2, column: 'CC_Code', code: 'INACTIVE_WITH_OWNER' }]);
  });

  it('cost centre with no backup owner', () => {
    expect(pick(owners(owner({ Backup_Owner_Email: '' })).errors)).toEqual([
      { row: 2, column: 'Backup_Owner_Email', code: 'NO_BACKUP_OWNER' },
    ]);
  });

  it('backup owner same as owner (case-insensitive)', () => {
    expect(pick(owners(owner({ Backup_Owner_Email: `MEENA.RAJ@${D}` })).errors)).toEqual([
      { row: 2, column: 'Backup_Owner_Email', code: 'BACKUP_SAME_AS_OWNER' },
    ]);
  });

  it('unknown cost centre', () => {
    expect(pick(owners(owner({ CC_Code: 'IN-ENG-777' })).errors)).toEqual([{ row: 2, column: 'CC_Code', code: 'UNKNOWN_CC' }]);
  });

  it('duplicate cost centre in the file', () => {
    expect(pick(owners(owner(), owner({ CC_Code: 'in-eng-101' })).errors)).toEqual([{ row: 3, column: 'CC_Code', code: 'DUPLICATE_CODE' }]);
  });

  it('warns about active cost centres that will still have no owner', () => {
    const r = validateOwners(file(OWNER_HEADERS, [owner()]), {
      ...EXISTING,
      costCentres: [...EXISTING.costCentres, { cc_code: 'IN-ENG-104', cc_alias: 'Design Coimbatore', status: 'Active' }],
    });
    expect(r.errors).toEqual([]);
    expect(pick(r.warnings)).toEqual([{ row: null, column: null, code: 'MISSING_OWNER' }]);
    expect(r.warnings[0].message).toMatch(/IN-ENG-104/);
  });

  it('missing required column -> file-level error', () => {
    const headers = OWNER_HEADERS.filter((h) => h !== 'Backup_Owner_Email');
    const r = validateOwners(file(headers, [owner()]), EXISTING);
    expect(pick(r.errors)).toEqual([{ row: null, column: 'Backup_Owner_Email', code: 'MISSING_COLUMN' }]);
    expect(r.records).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stage -> publish workflow (PGlite, through RLS as the Finance user)
// ---------------------------------------------------------------------------
const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const csv = (headers: string[], rows: Values[]) =>
  Buffer.from([headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h] ?? '')).join(','))].join('\r\n') + '\r\n');
const masterCsv = (...rows: Values[]) => csv(MASTER_HEADERS, rows);
const ownersCsv = (...rows: Values[]) => csv(OWNER_HEADERS, rows);

// Exactly the seeded IN-ENG-101 / IN-ENG-102 rows
const SEED_101 = cc({ CC_Code: 'IN-ENG-101', CC_Alias: 'Design Chennai', Keywords: 'cad; solidworks; product design; drafting; chennai', Start_Date: '2019-04-01' });
const SEED_102 = cc({ CC_Code: 'IN-ENG-102', CC_Alias: 'Simulation & CAE Chennai', Department: 'Simulation', Keywords: 'fea; cfd; ansys; analysis; structural', Start_Date: '2020-04-01' });

describe('upload workflow (stage -> publish)', () => {
  let db: Driver;
  beforeAll(async () => {
    db = await freshDb();
  });
  beforeEach(() => resetDb(db)); // every test starts from the seeded state
  afterAll(() => db.close());

  const stage = (kind: 'master' | 'owners', name: string, data: Buffer, user = KAVYA) =>
    withUserOn(db, user, (tx) => stageUpload(tx, user, kind, name, data));
  const publish = (batchId: string, user = KAVYA) => withUserOn(db, user, (tx) => publishUpload(tx, batchId), { batchId });
  const batch = async (id: string) =>
    (await asSuper<{ status: string; error_count: number; published_by: string | null }>(
      db, 'select status, error_count, published_by from ccp.upload_batches where id = $1', [id],
    ))[0];
  const ccRow = async (code: string) =>
    (await asSuper<Record<string, string | null>>(db, 'select * from ccp.cost_centres where cc_code = $1', [code]))[0];

  it('a file with an error is Rejected and cannot be published', async () => {
    const res = await stage('master', 'bad.csv', masterCsv(cc(), cc({ CC_Alias: 'Other' })));
    expect(res.status).toBe('Rejected');
    expect(res.errors.map((e) => e.code)).toEqual(['DUPLICATE_CODE']);
    expect(await batch(res.batchId)).toMatchObject({ status: 'Rejected', error_count: 1 });

    const ev = await asSuper(db, `select user_email from ccp.audit_log where action = 'UPLOAD_REJECTED' and entity_id = $1`, [res.batchId]);
    expect(ev).toEqual([{ user_email: KAVYA }]);

    await expect(publish(res.batchId)).rejects.toThrow(/Rejected and cannot be published/);
    expect(await ccRow('IN-ENG-104')).toBeUndefined();
  });

  it('a file with a missing column is Rejected', async () => {
    const res = await stage('master', 'bad.csv', csv(MASTER_HEADERS.filter((h) => h !== 'Status'), [cc()]));
    expect(res.status).toBe('Rejected');
    expect(res.errors).toEqual([expect.objectContaining({ row: null, column: 'Status', code: 'MISSING_COLUMN' })]);
  });

  it('a clean master upload is Validated, then publish upserts and audits with the batch id', async () => {
    const res = await stage('master', 'master.csv', masterCsv(
      cc(), // new IN-ENG-104
      { ...SEED_102, Keywords: 'fea; cfd; ansys; abaqus' }, // changed
      SEED_101, // unchanged
    ));
    expect(res.errors).toEqual([]);
    expect(res.status).toBe('Validated');
    expect(res.summary).toEqual({ created: 1, updated: 1, unchanged: 1 });
    expect(await ccRow('IN-ENG-104')).toBeUndefined(); // staging writes nothing to the master

    const out = await publish(res.batchId);
    expect(out).toEqual({ published: true, summary: { created: 1, updated: 1, unchanged: 1 } });
    expect(await ccRow('IN-ENG-104')).toMatchObject({ cc_alias: 'Design Coimbatore', status: 'Active', updated_by: KAVYA });
    expect((await ccRow('IN-ENG-102')).keywords).toBe('fea; cfd; ansys; abaqus');
    expect(await batch(res.batchId)).toMatchObject({ status: 'Published', published_by: KAVYA });

    const audit = await as<{ action: string; entity: string; entity_id: string; user_email: string; batch_id: string; old_value: unknown; new_value: unknown }>(
      db, KAVYA, 'select action, entity, entity_id, user_email, batch_id, old_value, new_value from ccp.audit_log where batch_id = $1 order by id',
      [res.batchId],
    );
    expect(audit.map((a) => [a.action, a.entity, a.entity_id])).toEqual([
      ['CREATE', 'cost_centres', 'IN-ENG-104'],
      ['UPDATE', 'cost_centres', 'IN-ENG-102'],
      ['UPLOAD_PUBLISHED', 'upload_batch', res.batchId],
    ]);
    expect(audit.every((a) => a.user_email === KAVYA && a.batch_id === res.batchId)).toBe(true);
    expect(audit[1]).toMatchObject({
      old_value: { keywords: 'fea; cfd; ansys; analysis; structural' },
      new_value: { keywords: 'fea; cfd; ansys; abaqus' },
    });
    // Every master change for these CCs is attributed to the batch (none leaked without it)
    const untagged = await asSuper(db,
      `select * from ccp.audit_log where entity = 'cost_centres' and entity_id in ('IN-ENG-104', 'IN-ENG-102') and action <> 'CREATE' and batch_id is null`);
    expect(untagged).toEqual([]);

    await expect(publish(res.batchId)).rejects.toThrow(/Published and cannot be published/);
  });

  it('publish is blocked when the master changed after staging and re-validation fails', async () => {
    const res = await stage('master', 'master.csv', masterCsv(cc({ CC_Code: 'IN-ENG-105', CC_Alias: 'Design Hosur' })));
    expect(res.status).toBe('Validated');

    // Meanwhile another Finance user gives that alias to an existing cost centre.
    await as(db, KAVYA, `update ccp.cost_centres set cc_alias = 'Design Hosur' where cc_code = 'IN-ENG-103'`);

    const out = await publish(res.batchId);
    expect(out.published).toBe(false);
    expect(out.published === false && out.errors.map((e) => e.code)).toEqual(['DUPLICATE_ALIAS']);
    expect(await ccRow('IN-ENG-105')).toBeUndefined();
    expect(await batch(res.batchId)).toMatchObject({ status: 'Rejected', error_count: 1 });
    await expect(publish(res.batchId)).rejects.toThrow(/Rejected/);
  });

  it('owners publish is blocked when the cost centre was deactivated after staging', async () => {
    const res = await stage('owners', 'owners.csv', ownersCsv(owner({ CC_Code: 'IN-ENG-103', Owner_Name: 'New Owner', Owner_Email: `new.owner@${D}` })));
    expect(res.status).toBe('Validated');
    await as(db, KAVYA, `update ccp.cost_centres set status = 'Inactive', close_date = '2026-09-30' where cc_code = 'IN-ENG-103'`);
    const out = await publish(res.batchId);
    expect(out.published === false && out.errors.map((e) => e.code)).toEqual(['INACTIVE_WITH_OWNER']);
    expect(await asSuper(db, `select * from ccp.cc_owners where cc_code = 'IN-ENG-103'`)).toEqual([]);
  });

  it('owners upload: rejected for inactive/unknown CCs; clean upload re-maps access', async () => {
    const bad = await stage('owners', 'o.csv', ownersCsv(owner({ CC_Code: 'IN-ENG-199' }), owner({ CC_Code: 'IN-ENG-777' })));
    expect(bad.status).toBe('Rejected');
    expect(bad.errors.map((e) => e.code)).toEqual(['INACTIVE_WITH_OWNER', 'UNKNOWN_CC']);

    const newOwner = `priya.s@${D}`;
    expect(await as(db, newOwner, `select * from ccp.financials where cc_code = 'IN-ENG-103'`)).toHaveLength(0);
    const res = await stage('owners', 'o.csv', ownersCsv(owner({ CC_Code: 'IN-ENG-103', Owner_Name: 'Priya S', Owner_Email: newOwner })));
    expect(res.status).toBe('Validated');
    expect(res.summary).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect((await publish(res.batchId)).published).toBe(true);

    expect(await as(db, newOwner, `select * from ccp.financials where cc_code = 'IN-ENG-103'`)).toHaveLength(36);
    const audit = await asSuper<{ action: string; entity: string; old_value: unknown; new_value: unknown }>(
      db, `select action, entity, old_value, new_value from ccp.audit_log where batch_id = $1 and entity = 'cc_owners'`, [res.batchId],
    );
    expect(audit).toEqual([{
      action: 'UPDATE', entity: 'cc_owners',
      old_value: { owner_name: 'Suresh Babu', owner_email: `suresh.babu@${D}` },
      new_value: { owner_name: 'Priya S', owner_email: newOwner },
    }]);
  });

  it('deactivating via a master upload removes the owner mapping; all audit rows carry the batch id', async () => {
    const res = await stage('master', 'm.csv', masterCsv({ ...SEED_101, Status: 'Inactive', Close_Date: '30/09/2026' }));
    expect(res.status).toBe('Validated');
    expect(res.warnings.map((w) => w.code)).toEqual(['INACTIVE_WITH_OWNER']);
    expect((await publish(res.batchId)).published).toBe(true);
    expect(await asSuper(db, `select * from ccp.cc_owners where cc_code = 'IN-ENG-101'`)).toEqual([]);
    const audit = await asSuper<{ action: string; entity: string }>(
      db, `select action, entity from ccp.audit_log where batch_id = $1 order by id`, [res.batchId],
    );
    expect(audit).toEqual([
      { action: 'DEACTIVATE', entity: 'cost_centres' },
      { action: 'DELETE', entity: 'cc_owners' },
      { action: 'UPLOAD_PUBLISHED', entity: 'upload_batch' },
    ]);
  });

  it('the generated .xlsx template stages cleanly', async () => {
    const res = await stage('master', 'SolidPro_CC_Master_Template.xlsx', await buildTemplate('master'));
    expect(res.errors).toEqual([]);
    expect(res.status).toBe('Validated');
    expect(res.summary).toEqual({ created: 2, updated: 0, unchanged: 0 });
    expect((await publish(res.batchId)).published).toBe(true);
    expect(await ccRow('US-SAL-602')).toMatchObject({ cc_alias: 'Sales Canada', entity: 'US' });
  });

  it('a validated upload can be discarded and then not published', async () => {
    const res = await stage('master', 'm.csv', masterCsv(cc()));
    expect(await withUserOn(db, KAVYA, (tx) => discardUpload(tx, res.batchId))).toBe(true);
    expect(await withUserOn(db, KAVYA, (tx) => discardUpload(tx, res.batchId))).toBe(false);
    await expect(publish(res.batchId)).rejects.toThrow(/Discarded/);
  });

  it('only Finance can stage or publish', async () => {
    for (const user of [ARUN, MEENA, RAJESH]) {
      await expect(stage('master', 'm.csv', masterCsv(cc()), user), user).rejects.toThrow(/row-level security/);
    }
    const res = await stage('master', 'm.csv', masterCsv(cc()));
    for (const user of [ARUN, MEENA, RAJESH]) {
      await expect(publish(res.batchId, user), user).rejects.toThrow(/not found/);
    }
    expect(await batch(res.batchId)).toMatchObject({ status: 'Validated' });
    expect(await ccRow('IN-ENG-104')).toBeUndefined();
  });

  it('rejects files with too many rows', async () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => cc({ CC_Code: `IN-ENG-${1000 + i}`, CC_Alias: `Alias ${i}` }));
    await expect(stage('master', 'big.csv', masterCsv(...rows))).rejects.toThrow(/Too many rows/);
  });
});
