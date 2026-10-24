/**
 * Phase 3 audit reports (src/lib/reports.ts) against the seeded PGlite
 * database, through row-level security: every report is run exactly as the
 * pages and the export API run it (withUser -> cc_app role + app.user_email).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserOn } from '../src/lib/db/core';
import { DEMO_DOMAIN } from '../src/lib/db/seed';
import {
  SEED_USER,
  accessReview,
  auditChanges,
  auditLog,
  changeText,
  commentaryCoverage,
  failedSearches,
  paramsFromUrl,
  parseAccessFilters,
  parseAuditFilters,
  parseCoverageFilters,
  parseDate,
  parseFailedSearchFilters,
  parseUploadFilters,
  sodCheck,
  uploadBatchDetail,
  uploadRegister,
  type AccessFilters,
  type AuditFilters,
} from '../src/lib/reports';
import { ARUN, DEEPA, KAVYA, MEENA, RAJESH, VIKRAM, asSuper, freshDb, type Driver, type Tx } from './helpers';

const NON_FINANCE = [MEENA, RAJESH, ARUN, VIKRAM];
const AUDIT: AuditFilters = parseAuditFilters({});
const ACCESS: AccessFilters = parseAccessFilters({});

let db: Driver;
const run = <T>(email: string, fn: (tx: Tx) => Promise<T>) => withUserOn(db, email, fn);

beforeAll(async () => {
  db = await freshDb();
});
afterAll(() => db.close());

// ---------------------------------------------------------------------------
describe('filter parsing (pure)', () => {
  it('accepts only real calendar dates', () => {
    expect(parseDate('2026-09-30')).toBe('2026-09-30');
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate("2026-09-30' or 1=1 --")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });

  it('normalises audit filters and drops malformed values before they reach SQL', () => {
    const f = parseAuditFilters({
      from: '2026-01-01', to: 'yesterday', user: '  KAVYA ', action: ['export', "LOGIN'; drop table x", 'LOGIN'],
      entity: 'cost_centres; --', entityId: 'IN-ENG', page: '-3',
    });
    expect(f).toEqual({ from: '2026-01-01', to: null, user: 'kavya', actions: ['EXPORT', 'LOGIN'], entity: null, entityId: 'in-eng', page: 1 });
  });

  it('reads repeated query keys as arrays (export URL = page URL)', () => {
    const p = paramsFromUrl(new URL('http://x/api?action=LOGIN&action=EXPORT&user=kavya'));
    expect(p).toEqual({ action: ['LOGIN', 'EXPORT'], user: 'kavya' });
    expect(parseAuditFilters(p).actions).toEqual(['LOGIN', 'EXPORT']);
  });

  it('upload, access, coverage and failed-search filters are whitelisted', () => {
    expect(parseUploadFilters({ status: 'Published', kind: 'financials' })).toMatchObject({ status: 'Published', kind: 'financials' });
    expect(parseUploadFilters({ status: 'Hacked', kind: 'FIN ANCIALS' })).toMatchObject({ status: null, kind: null });
    expect(parseAccessFilters({ role: 'Finance', exceptions: '1' })).toMatchObject({ role: 'Finance', exceptionsOnly: true });
    expect(parseAccessFilters({ role: 'Admin' }).role).toBeNull();
    expect(parseCoverageFilters({ period: '2026-13', unexplained: 'on' })).toEqual({ period: null, bu: null, unexplainedOnly: true });
    const now = new Date('2026-10-24T08:00:00Z');
    expect(parseFailedSearchFilters({}, now)).toEqual({ from: '2026-07-26', to: null }); // default: last 90 days
    expect(parseFailedSearchFilters({ from: '' }, now)).toEqual({ from: null, to: null }); // cleared = all time
  });

  it('turns audit JSON into a readable field-by-field diff', () => {
    const upd = auditChanges({ status: 'Active', close_date: null }, { status: 'Inactive', close_date: '2026-09-30' });
    expect(upd.map(changeText)).toEqual(['status: Active → Inactive', 'close_date: (blank) → 2026-09-30']);
    expect(auditChanges(null, { cc_code: 'IN-X-001', rows: 3 }).map(changeText)).toEqual(['cc_code: IN-X-001', 'rows: 3']);
    expect(auditChanges({ owner_email: 'a@b.com' }, null).map(changeText)).toEqual(['owner_email: a@b.com → (removed)']);
    expect(auditChanges(null, { reconciliation: [{ period: '2026-09' }] })[0].after).toBe('[{"period":"2026-09"}]');
    expect(auditChanges(null, null)).toEqual([]);
  });

  it('segregation of duties: seed, ok, violation, pending', () => {
    const b = { uploaded_by: KAVYA, approved_by: DEEPA, published_by: DEEPA, status: 'Published' };
    expect(sodCheck(b)).toBe('ok');
    expect(sodCheck({ ...b, approved_by: KAVYA.toUpperCase(), published_by: KAVYA })).toBe('violation');
    expect(sodCheck({ ...b, approved_by: null, published_by: null })).toBe('violation');
    expect(sodCheck({ ...b, status: 'Validated', approved_by: null, published_by: null })).toBe('pending');
    expect(sodCheck({ uploaded_by: SEED_USER, approved_by: SEED_USER, published_by: SEED_USER, status: 'Published' })).toBe('seed');
  });
});

// ---------------------------------------------------------------------------
describe('1. Audit log', () => {
  beforeAll(async () => {
    // Two events in a known month (inserted directly: the app itself can only append "now").
    await asSuper(
      db,
      `insert into ccp.audit_log (ts, user_email, action, entity, entity_id, new_value) values
         ('2026-01-15 10:00:00+00', $1, 'LOGIN', 'session', null, null),
         ('2026-01-31 23:30:00+00', $2, 'EXPORT', 'report', 'audit-log', '{"rows": 3}')`,
      [DEEPA, KAVYA],
    );
    await run(KAVYA, (tx) => tx.query(`select ccp.log_event('EXPORT', 'cost_centre', 'IN-ENG-101', '{"period":"2026-09"}')`));
  });

  it('Finance sees the seed changes, newest first, 50 per page', async () => {
    const r = await run(KAVYA, (tx) => auditLog(tx, AUDIT));
    expect(r.total).toBeGreaterThan(25); // 11 cost centres + 10 owner rows + 5 grants + events
    expect(r.rows.length).toBeLessThanOrEqual(50);
    expect(r.rows[0]).toMatchObject({ user_email: KAVYA, action: 'EXPORT', entity_id: 'IN-ENG-101' });
    const ts = r.rows.map((x) => x.ts);
    expect([...ts].sort().reverse()).toEqual(ts);
    expect(r.options.actions).toEqual(expect.arrayContaining(['CREATE', 'EXPORT', 'LOGIN']));
    const created = await run(KAVYA, (tx) => auditLog(tx, { ...AUDIT, actions: ['CREATE'], entity: 'cost_centres' }));
    expect(created.total).toBe(11);
    expect(created.rows.every((x) => x.user_email === SEED_USER)).toBe(true);
  });

  it('filters by action, user, entity id and date (UTC, inclusive)', async () => {
    const exports = await run(KAVYA, (tx) => auditLog(tx, { ...AUDIT, actions: ['EXPORT'] }));
    expect(exports.total).toBe(2);
    expect(exports.rows.every((x) => x.action === 'EXPORT')).toBe(true);

    const deepa = await run(KAVYA, (tx) => auditLog(tx, { ...AUDIT, user: 'deepa' }));
    expect(deepa.rows.map((x) => x.user_email)).toEqual([DEEPA]);

    const jan = await run(KAVYA, (tx) => auditLog(tx, { ...AUDIT, from: '2026-01-01', to: '2026-01-31' }));
    expect(jan.rows.map((x) => x.action)).toEqual(['EXPORT', 'LOGIN']); // 31 Jan 23:30 UTC is inside "to 2026-01-31"
    const midJan = await run(KAVYA, (tx) => auditLog(tx, { ...AUDIT, from: '2026-01-16', to: '2026-01-31' }));
    expect(midJan.total).toBe(1);

    const byId = await run(KAVYA, (tx) => auditLog(tx, { ...AUDIT, entityId: 'in-ssv-30' }));
    expect(byId.total).toBeGreaterThan(0);
    expect(byId.rows.every((x) => x.entity_id?.startsWith('IN-SSV-30'))).toBe(true);
  });

  it('whitelists action and entity against SELECT DISTINCT (unknown values are dropped)', async () => {
    const r = await run(KAVYA, (tx) => auditLog(tx, { ...AUDIT, actions: ['EXPORT', 'NOT_AN_ACTION'], entity: 'pg_shadow' }));
    expect(r.filters.actions).toEqual(['EXPORT']);
    expect(r.filters.entity).toBeNull();
    expect(r.total).toBe(2);
  });

  it('paginates and exports up to the cap', async () => {
    const all = await run(KAVYA, (tx) => auditLog(tx, AUDIT, { limit: 50_000, offset: 0 }));
    expect(all.rows.length).toBe(all.total);
    const slice = await run(KAVYA, (tx) => auditLog(tx, AUDIT, { limit: 5, offset: 5 }));
    expect(slice.rows.map((x) => x.id)).toEqual(all.rows.slice(5, 10).map((x) => x.id));
    const p2 = await run(KAVYA, (tx) => auditLog(tx, { ...AUDIT, page: 2 }));
    expect(p2.rows.map((x) => x.id)).toEqual(all.rows.slice(50, 100).map((x) => x.id));
  });

  it('returns nothing for non-Finance users (RLS)', async () => {
    for (const u of NON_FINANCE) {
      const r = await run(u, (tx) => auditLog(tx, AUDIT));
      expect(r.total, u).toBe(0);
      expect(r.rows, u).toEqual([]);
      expect(r.options.actions, u).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
describe('2. Upload evidence register', () => {
  let goodId: string;
  let badId: string;

  beforeAll(async () => {
    // A master upload: Kavya stages, Deepa approves; the publish changes one cost centre.
    [{ id: goodId }] = await run(KAVYA, (tx) =>
      tx.query<{ id: string }>(
        `insert into ccp.upload_batches (kind, file_name, file_sha256, uploaded_by, status, row_count, error_count, payload, errors, summary)
         values ('master', 'master-oct.xlsx', 'abc123', ccp.app_email(), 'Validated', 1, 0, '{}'::jsonb, '[]'::jsonb,
                 '{"created":0,"updated":1,"unchanged":10,"warnings":[{"row":2,"column":"Keywords","code":"NO_KEYWORDS","message":"No keywords"}]}'::jsonb)
         returning id::text as id`,
      ),
    );
    await run(KAVYA, (tx) => tx.query(`select ccp.log_event('UPLOAD_VALIDATED', 'upload_batch', $1)`, [goodId]));
    await withUserOn(
      db,
      DEEPA,
      async (tx) => {
        await tx.query(`update ccp.cost_centres set keywords = 'cad; solidworks; design' where cc_code = 'IN-ENG-101'`);
        await tx.query(
          `update ccp.upload_batches set status = 'Published', published_at = now(), published_by = ccp.app_email(), approved_by = ccp.app_email() where id = $1`,
          [goodId],
        );
        await tx.query(`select ccp.log_event('UPLOAD_PUBLISHED', 'upload_batch', $1, '{"updated":1}')`, [goodId]);
      },
      { batchId: goodId },
    );
    // A batch published by its own uploader (only possible with maker-checker switched off).
    [{ id: badId }] = await asSuper<{ id: string }>(
      db,
      `insert into ccp.upload_batches (kind, file_name, file_sha256, uploaded_by, uploaded_at, status, row_count, error_count, payload, published_at, published_by, approved_by)
       values ('owners', 'owners.csv', 'def456', $1, '2026-02-10 09:00:00+00', 'Published', 3, 0, '{}'::jsonb, now(), $1, $1) returning id::text as id`,
      [KAVYA],
    );
    // A rejected batch with stored errors.
    await asSuper(
      db,
      `insert into ccp.upload_batches (kind, file_name, file_sha256, uploaded_by, status, row_count, error_count, payload, errors)
       values ('financials', 'bad.csv', 'ffff', $1, 'Rejected', 2, 1, '{}'::jsonb,
               '[{"row":3,"column":"Period","code":"BAD_PERIOD","message":"Period must be YYYY-MM"}]'::jsonb)`,
      [DEEPA],
    );
  });

  it('lists every batch with SoD status; the seed batch is "system seed", not a violation', async () => {
    const r = await run(KAVYA, (tx) => uploadRegister(tx, parseUploadFilters({})));
    expect(r.total).toBe(4);
    const seed = r.rows.find((b) => b.uploaded_by === SEED_USER)!;
    expect(seed).toMatchObject({ kind: 'financials', status: 'Published', sod: 'seed' });
    // The seed batch has no stored reconciliation: lines come from the period register (6 months).
    expect(seed.reconSource).toBe('period register');
    expect(new Set(seed.reconciliation.map((l) => l.period)).size).toBe(6);
    expect(seed.reconciliation.every((l) => l.difference === 0 && l.matched)).toBe(true);

    expect(r.rows.find((b) => b.id === goodId)).toMatchObject({ sod: 'ok', approved_by: DEEPA, warning_count: 1, file_sha256: 'abc123' });
    expect(r.rows.find((b) => b.id === badId)).toMatchObject({ sod: 'violation' });
    expect(r.violations).toBe(1);
  });

  it('filters by type, status and upload date', async () => {
    const pub = await run(KAVYA, (tx) => uploadRegister(tx, parseUploadFilters({ status: 'Published' })));
    expect(pub.rows.map((b) => b.status)).toEqual(['Published', 'Published', 'Published']);
    const fin = await run(KAVYA, (tx) => uploadRegister(tx, parseUploadFilters({ kind: 'financials' })));
    expect(fin.total).toBe(2);
    const feb = await run(KAVYA, (tx) => uploadRegister(tx, parseUploadFilters({ from: '2026-02-01', to: '2026-02-28' })));
    expect(feb.rows.map((b) => b.id)).toEqual([badId]);
    const unknownKind = await run(KAVYA, (tx) => uploadRegister(tx, { ...parseUploadFilters({}), kind: 'nonsense' }));
    expect(unknownKind.filters.kind).toBeNull();
  });

  it('batch detail: stored warnings/errors, the audit events it caused, and line history when available', async () => {
    const d = (await run(KAVYA, (tx) => uploadBatchDetail(tx, goodId)))!;
    expect(d.batch.sod).toBe('ok');
    expect(d.warnings).toEqual([{ row: 2, column: 'Keywords', code: 'NO_KEYWORDS', message: 'No keywords' }]);
    expect(d.summary).toEqual({ created: 0, updated: 1, unchanged: 10 });
    expect(d.events.map((e) => e.action)).toEqual(['UPLOAD_VALIDATED', 'UPDATE', 'UPLOAD_PUBLISHED']);
    const update = d.events.find((e) => e.action === 'UPDATE')!;
    expect(update).toMatchObject({ entity: 'cost_centres', entity_id: 'IN-ENG-101', user_email: DEEPA, batch_id: goodId });
    expect(auditChanges(update.old_value, update.new_value).map(changeText)).toEqual([
      'keywords: cad; solidworks; product design; drafting; chennai → cad; solidworks; design',
    ]);

    const rejected = (await run(KAVYA, async (tx) => {
      const [{ id }] = await tx.query<{ id: string }>(`select id::text as id from ccp.upload_batches where file_name = 'bad.csv'`);
      return uploadBatchDetail(tx, id);
    }))!;
    expect(rejected.errors).toEqual([{ row: 3, column: 'Period', code: 'BAD_PERIOD', message: 'Period must be YYYY-MM' }]);
    expect(rejected.batch.sod).toBe('na');

    const [{ exists }] = await asSuper<{ exists: boolean }>(db, `select to_regclass('ccp.financials_history') is not null as exists`);
    if (!exists) {
      expect(d.history).toBeNull();
    } else {
      const [seed] = await asSuper<{ id: string }>(db, `select id::text as id from ccp.upload_batches where uploaded_by = $1`, [SEED_USER]);
      const [{ cols }] = await asSuper<{ cols: string[] }>(
        db,
        `select array_agg(column_name::text) as cols from information_schema.columns where table_schema = 'ccp' and table_name = 'financials_history'`,
      );
      await asSuper(
        db,
        `insert into ccp.financials_history (batch_id, cc_code, period, gl_group, old_budget, old_actual, new_budget, new_actual, changed_by${cols.includes('change') ? ', change' : ''})
         values ($1, 'IN-ENG-101', '2026-09', 'Travel & Conveyance', 100, 120, 100, 150, $2${cols.includes('change') ? `, 'changed'` : ''})`,
        [seed.id, DEEPA],
      );
      const h = (await run(KAVYA, (tx) => uploadBatchDetail(tx, seed.id)))!.history!;
      expect(h.total).toBeGreaterThanOrEqual(1);
      expect(h.lines).toContainEqual(
        expect.objectContaining({ cc_code: 'IN-ENG-101', period: '2026-09', gl_group: 'Travel & Conveyance', old_actual: 120, new_actual: 150, changed_by: DEEPA }),
      );
    }
  });

  it('rejects malformed ids and hides everything from non-Finance users', async () => {
    expect(await run(KAVYA, (tx) => uploadBatchDetail(tx, "x' or '1'='1"))).toBeNull();
    for (const u of NON_FINANCE) {
      const r = await run(u, (tx) => uploadRegister(tx, parseUploadFilters({})));
      expect(r.total, u).toBe(0);
      expect(await run(u, (tx) => uploadBatchDetail(tx, goodId)), u).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
describe('3. User access review', () => {
  it('lists owner-mapping and explicit-grant rights with their source', async () => {
    const r = await run(KAVYA, (tx) => accessReview(tx, ACCESS));
    // 10 owner mappings x (owner + backup + BU head) + 5 explicit grants
    expect(r.totalRows).toBe(35);
    expect(r.rows).toContainEqual(
      expect.objectContaining({ user_email: VIKRAM, role: 'BU_Head', scope: 'bu', bu: 'Engineering', source: 'explicit grant', granted_by: 'seed', bu_cc_count: 4 }),
    );
    expect(r.rows).toContainEqual(
      expect.objectContaining({ user_email: MEENA, role: 'Owner', scope: 'cc', cc_code: 'IN-ENG-101', source: 'owner mapping' }),
    );
    expect(r.usersByRole.Finance).toBe(2);
    expect(r.usersByRole.Mgmt).toBe(1);
  });

  it('flags Finance users who own or back up cost centres (segregation of duties)', async () => {
    const r = await run(KAVYA, (tx) => accessReview(tx, ACCESS));
    const sod = r.exceptions.filter((e) => e.kind === 'sod');
    expect(sod.map((e) => e.user_email)).toEqual([DEEPA, KAVYA]);
    expect(sod.find((e) => e.user_email === KAVYA)!.detail).toContain('Owner of IN-SSV-301');
    const kavyaRows = r.rows.filter((x) => x.user_email === KAVYA);
    expect(kavyaRows.find((x) => x.role === 'Finance')!.exceptions).toContain('sod');
    expect(kavyaRows.find((x) => x.role === 'Owner' && x.cc_code === 'IN-SSV-301')!.exceptions).toContain('sod');
    // seed: Nisha is both backup owner and BU head of IN-SAL-501
    expect(r.exceptions).toContainEqual(expect.objectContaining({ kind: 'backup_is_bu_head', cc_code: 'IN-SAL-501' }));
    expect(r.exceptions.some((e) => e.kind === 'owner_is_bu_head' || e.kind === 'inactive_cc' || e.kind === 'external_email')).toBe(false);
  });

  it('flags owner = BU head, grants on inactive cost centres and emails outside the allowed domains', async () => {
    await asSuper(db, `update ccp.cc_owners set bu_head_email = owner_email where cc_code = 'IN-ENG-103'`);
    await asSuper(
      db,
      `insert into ccp.cc_access (user_email, role, cc_code, created_by) values ('old.owner@${DEMO_DOMAIN}', 'Owner', 'IN-ENG-199', $1),
         ('contractor@gmail.com', 'Backup', 'IN-ENG-102', $1)`,
      [KAVYA],
    );
    try {
      const r = await run(KAVYA, (tx) => accessReview(tx, ACCESS));
      expect(r.exceptions).toContainEqual(expect.objectContaining({ kind: 'owner_is_bu_head', cc_code: 'IN-ENG-103' }));
      expect(r.exceptions).toContainEqual(expect.objectContaining({ kind: 'inactive_cc', cc_code: 'IN-ENG-199' }));
      expect(r.exceptions).toContainEqual(expect.objectContaining({ kind: 'external_email', user_email: 'contractor@gmail.com' }));
      const ext = r.rows.find((x) => x.user_email === 'contractor@gmail.com')!;
      expect(ext).toMatchObject({ source: 'explicit grant', granted_by: KAVYA, exceptions: ['external_email'] });

      const only = await run(KAVYA, (tx) => accessReview(tx, { ...ACCESS, exceptionsOnly: true }));
      expect(only.rows.length).toBeGreaterThan(0);
      expect(only.rows.every((x) => x.exceptions.length > 0)).toBe(true);
    } finally {
      await asSuper(db, `delete from ccp.cc_access where created_by = $1 and role in ('Owner', 'Backup')`, [KAVYA]);
      await asSuper(db, `update ccp.cc_owners set bu_head_email = $1 where cc_code = 'IN-ENG-103'`, [VIKRAM]);
    }
  });

  it('filters by user, role and BU (company-wide grants stay under a BU filter)', async () => {
    const meena = await run(KAVYA, (tx) => accessReview(tx, { ...ACCESS, user: 'meena' }));
    expect(meena.rows.map((x) => `${x.role}:${x.cc_code}`)).toEqual(['Owner:IN-ENG-101', 'Owner:IN-ENG-102']);
    const heads = await run(KAVYA, (tx) => accessReview(tx, { ...ACCESS, role: 'BU_Head' }));
    expect(heads.rows.every((x) => x.role === 'BU_Head')).toBe(true);
    const sales = await run(KAVYA, (tx) => accessReview(tx, { ...ACCESS, bu: 'Sales' }));
    expect(sales.rows.every((x) => x.bu === 'Sales' || x.scope === 'all')).toBe(true);
    expect(sales.rows.some((x) => x.role === 'Finance')).toBe(true);
    const bogus = await run(KAVYA, (tx) => accessReview(tx, { ...ACCESS, bu: 'Nope' }));
    expect(bogus.filters.bu).toBeNull();
  });

  it('is only meaningful for Finance: others never see other users’ explicit grants', async () => {
    for (const u of NON_FINANCE) {
      const r = await run(u, (tx) => accessReview(tx, ACCESS));
      const grants = r.rows.filter((x) => x.source === 'explicit grant');
      expect(grants.every((x) => x.user_email === u), u).toBe(true);
      expect(r.exceptions.filter((e) => e.kind === 'sod'), u).toEqual([]);
    }
    const meena = await run(MEENA, (tx) => accessReview(tx, ACCESS));
    expect(meena.rows.filter((x) => x.source === 'explicit grant')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('4. Variance commentary coverage', () => {
  it('defaults to the latest period and lists lines over ±10% YTD variance', async () => {
    const r = await run(KAVYA, (tx) => commentaryCoverage(tx, parseCoverageFilters({})));
    expect(r.period).toBe('2026-09');
    expect(r.ytdFrom).toBe('2026-04');
    const eng101 = r.lines.filter((l) => l.cc_code === 'IN-ENG-101').map((l) => l.gl_group).sort();
    expect(eng101).toEqual(['Software & Licences', 'Travel & Conveyance']);
    expect(r.lines.every((l) => l.variancePct === null || Math.abs(l.variancePct) > 0.1)).toBe(true);
    const travel = r.lines.find((l) => l.cc_code === 'IN-ENG-101' && l.gl_group === 'Travel & Conveyance')!;
    expect(travel).toMatchObject({ owner_name: 'Meena Raj', owner_email: MEENA, currency: 'INR', commentCount: 0, explained: false });
    expect(travel.variancePct!).toBeGreaterThan(0.2);
    expect(r.kpi).toMatchObject({ flagged: r.lines.length, explained: 0, pct: 0 });
  });

  it('a comment for the cc + period + GL line makes it explained', async () => {
    await asSuper(
      db,
      `insert into ccp.comments (cc_code, period, gl_group, user_email, comment, created_at) values
         ('IN-ENG-101', '2026-09', 'Travel & Conveyance', $1, 'Older note', now() - interval '1 day'),
         ('IN-ENG-101', '2026-09', 'Travel & Conveyance', $1, 'Client visits to Hosur for the pump-skid project', now()),
         ('IN-ENG-101', '2026-08', 'Software & Licences', $1, 'Wrong month: does not explain September', now())`,
      [MEENA],
    );
    const r = await run(KAVYA, (tx) => commentaryCoverage(tx, { period: '2026-09', bu: null, unexplainedOnly: false }));
    const travel = r.lines.find((l) => l.cc_code === 'IN-ENG-101' && l.gl_group === 'Travel & Conveyance')!;
    expect(travel).toMatchObject({ explained: true, commentCount: 2, latestComment: 'Client visits to Hosur for the pump-skid project', latestCommentBy: MEENA });
    const sw = r.lines.find((l) => l.cc_code === 'IN-ENG-101' && l.gl_group === 'Software & Licences')!;
    expect(sw.explained).toBe(false);
    expect(r.kpi.explained).toBe(1);
    expect(r.kpi.pct).toBeCloseTo(1 / r.kpi.flagged);

    const open = await run(KAVYA, (tx) => commentaryCoverage(tx, { period: '2026-09', bu: null, unexplainedOnly: true }));
    expect(open.lines.some((l) => l.explained)).toBe(false);
    expect(open.lines.length).toBe(r.kpi.flagged - 1);
    expect(open.kpi).toEqual(r.kpi); // the KPI covers every flagged line, not just the ones shown
  });

  it('filters by BU and whitelists the period', async () => {
    const eng = await run(KAVYA, (tx) => commentaryCoverage(tx, { period: '2026-09', bu: 'Engineering', unexplainedOnly: false }));
    expect(eng.lines.length).toBeGreaterThan(0);
    expect(eng.lines.every((l) => l.bu === 'Engineering')).toBe(true);
    expect(eng.byBu.map((b) => b.bu)).toEqual(['Engineering']);
    const future = await run(KAVYA, (tx) => commentaryCoverage(tx, { period: '2027-01', bu: null, unexplainedOnly: false }));
    expect(future.period).toBe('2026-09'); // budget-only month is not a valid choice
  });

  it('non-Finance users only ever get their own cost centres (RLS on financials)', async () => {
    const meena = await run(MEENA, (tx) => commentaryCoverage(tx, parseCoverageFilters({})));
    expect(new Set(meena.lines.map((l) => l.cc_code))).toEqual(new Set(['IN-ENG-101', 'IN-ENG-102']));
    const arun = await run(ARUN, (tx) => commentaryCoverage(tx, parseCoverageFilters({})));
    expect(arun.lines).toEqual([]);
    expect(arun.period).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('5. Failed searches', () => {
  beforeAll(async () => {
    await asSuper(
      db,
      `insert into ccp.failed_searches (ts, user_email, term) values
         (now() - interval '1 day', $1, 'forklift'), (now() - interval '2 days', $2, 'forklift'),
         (now() - interval '3 days', $1, 'forklift'), (now() - interval '5 days', $2, 'canteen tea'),
         ('2025-01-10 12:00:00+00', $1, 'very old term')`,
      [ARUN, MEENA],
    );
  });

  it('groups terms by count with users and first/last seen, within the date range', async () => {
    const r = await run(KAVYA, (tx) => failedSearches(tx, parseFailedSearchFilters({})));
    expect(r.terms.map((t) => [t.term, t.searches, t.users])).toEqual([
      ['forklift', 3, 2],
      ['canteen tea', 1, 1],
    ]);
    expect(r.searches).toBe(4);
    const allTime = await run(KAVYA, (tx) => failedSearches(tx, { from: null, to: null }, { withEvents: true }));
    expect(allTime.totalTerms).toBe(3);
    expect(allTime.events).toHaveLength(5);
    const old = await run(KAVYA, (tx) => failedSearches(tx, { from: '2025-01-01', to: '2025-01-31' }));
    expect(old.terms.map((t) => t.term)).toEqual(['very old term']);
  });

  it('returns nothing for non-Finance users (RLS)', async () => {
    for (const u of NON_FINANCE) {
      const r = await run(u, (tx) => failedSearches(tx, { from: null, to: null }, { withEvents: true }));
      expect(r.terms, u).toEqual([]);
      expect(r.events, u).toEqual([]);
    }
  });
});
