/**
 * Acceptance criteria for access control, enforced in the database by
 * row-level security. Every query here is plain SQL run as the `cc_app` role
 * with app.user_email set — exactly what an API route does — so these tests
 * also cover "direct API call / URL tampering" scenarios: no amount of
 * filtering by the caller can widen what the policies return.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserOn } from '../src/lib/db/core';
import { DEMO_DOMAIN, DEMO_USERS } from '../src/lib/db/seed';
import { ARUN, DEEPA, KAVYA, MEENA, RAJESH, VIKRAM, as, asSuper, freshDb, type Driver } from './helpers';

const PROTECTED = [
  'ccp.financials',
  'ccp.allocations',
  'ccp.comments',
  'ccp.audit_log',
  'ccp.upload_batches',
  'ccp.failed_searches',
  'ccp.trial_balances',
  'ccp.periods',
  'ccp.financials_history',
] as const;

const ENGINEERING_ACTIVE = ['IN-ENG-101', 'IN-ENG-102', 'IN-ENG-103', 'US-ENG-201'];
const NON_ENGINEERING = ['IN-SSV-301', 'IN-SSV-302', 'IN-SSV-303', 'US-SSV-401', 'IN-SAL-501', 'US-SAL-601'];

const count = async (rows: Promise<unknown[]>) => (await rows).length;
const codes = (rows: { cc_code: string }[]) => [...new Set(rows.map((r) => r.cc_code))].sort();

/** A transaction as cc_app WITHOUT any user email (e.g. a bug that forgets to set it). */
function noContext<T>(driver: Driver, sql: string, emailSetting?: string) {
  return driver.transaction(async (tx) => {
    await tx.query('set local role cc_app');
    if (emailSetting !== undefined) await tx.query(`select set_config('app.user_email', $1, true)`, [emailSetting]);
    return tx.query<T>(sql);
  });
}

// ---------------------------------------------------------------------------
// Read access
// ---------------------------------------------------------------------------
describe('RLS: read access', () => {
  let db: Driver;

  beforeAll(async () => {
    db = await freshDb();
    // Make sure every protected table has rows, so "0 rows" means "filtered", not "empty".
    await asSuper(
      db,
      `insert into ccp.comments (cc_code, period, gl_group, user_email, comment) values
         ('IN-ENG-101', '2026-09', 'Travel & Conveyance', $1, 'Client visits to Hosur'),
         ('IN-SAL-501', '2026-09', 'Travel & Conveyance', 'anand.k@${DEMO_DOMAIN}', 'Tender travel')`,
      [MEENA],
    );
    await asSuper(db, `insert into ccp.failed_searches (user_email, term) values ('someone@${DEMO_DOMAIN}', 'xyz')`);
    await asSuper(
      db,
      `insert into ccp.upload_batches (kind, file_name, file_sha256, uploaded_by, status, row_count, error_count, payload)
       values ('master', 'm.csv', 'abc', $1, 'Validated', 0, 0, '{}'::jsonb)`,
      [KAVYA],
    );
    // The seed has no trial-balance or line-history rows (ccp.periods is seeded); add one of each.
    await asSuper(
      db,
      `insert into ccp.trial_balances (batch_id, period, entity, tb_total, entered_by)
       select id, '2026-09', 'IN', 1, uploaded_by from ccp.upload_batches where kind = 'financials' and file_name = 'seed-data'`,
    );
    await asSuper(
      db,
      `insert into ccp.financials_history (batch_id, cc_code, period, gl_group, old_budget, old_actual, new_budget, new_actual, change, changed_by)
       select id, 'IN-SAL-501', '2026-09', 'Travel & Conveyance', 1, 1, 2, 2, 'changed', 'seed@system'
         from ccp.upload_batches where kind = 'financials' and file_name = 'seed-data'`,
    );
    for (const t of PROTECTED) {
      expect(await count(asSuper(db, `select * from ${t}`)), `${t} should have seed rows`).toBeGreaterThan(0);
    }
  });
  afterAll(() => db.close());

  it('Employee sees 0 rows in every protected table, even with direct SQL', async () => {
    for (const t of PROTECTED) {
      expect(await count(as(db, ARUN, `select * from ${t}`)), t).toBe(0);
    }
    // Explicit filters (as a tampered API call would send) do not help either.
    expect(await count(as(db, ARUN, `select * from ccp.financials where cc_code = 'IN-ENG-101'`))).toBe(0);
    expect(await count(as(db, ARUN, `select * from ccp.allocations where cc_code = 'IN-SAL-501'`))).toBe(0);
    // Nor do the security-definer helpers leak anything for an employee.
    const [{ v }] = await as<{ v: string[] }>(db, ARUN, 'select ccp.visible_cc_codes() as v');
    expect(v).toEqual([]);
    // Explicit grants: an employee sees only grants about themselves (none).
    expect(await count(as(db, ARUN, 'select * from ccp.cc_access'))).toBe(0);
  });

  it('Employee can read the cost centre directory (including owner names)', async () => {
    const all = await asSuper<{ cc_code: string }>(db, 'select cc_code from ccp.cost_centres');
    const seen = await as<{ cc_code: string }>(db, ARUN, 'select cc_code from ccp.cost_centres');
    expect(seen.length).toBe(all.length);
    expect(seen.length).toBe(11);
    expect(await count(as(db, ARUN, 'select owner_name from ccp.cc_owners'))).toBe(10);
  });

  it('Owner sees financials only for their own cost centres; ID tampering returns nothing', async () => {
    const fin = await as<{ cc_code: string }>(db, MEENA, 'select cc_code from ccp.financials');
    expect(codes(fin)).toEqual(['IN-ENG-101', 'IN-ENG-102']);
    // Every line of her two cost centres (actual months and budget-only months) — and nothing else.
    const [{ n }] = await asSuper<{ n: number }>(
      db, `select count(*)::int as n from ccp.financials where cc_code in ('IN-ENG-101', 'IN-ENG-102')`,
    );
    expect(n).toBeGreaterThan(0);
    expect(fin.length).toBe(n);

    expect(await count(as(db, MEENA, `select * from ccp.financials where cc_code = 'IN-SAL-501'`))).toBe(0);
    expect(await count(as(db, MEENA, `select * from ccp.financials where cc_code in ('IN-SAL-501', 'IN-SSV-301', 'IN-ENG-103')`))).toBe(0);
    expect(await count(as(db, MEENA, `select * from ccp.allocations where cc_code = 'IN-SAL-501'`))).toBe(0);
    expect(await count(as(db, MEENA, `select * from ccp.comments where cc_code = 'IN-SAL-501'`))).toBe(0);

    const alloc = await as<{ cc_code: string }>(db, MEENA, 'select cc_code from ccp.allocations');
    expect(codes(alloc)).toEqual(['IN-ENG-101', 'IN-ENG-102']);
    const comments = await as<{ cc_code: string }>(db, MEENA, 'select cc_code from ccp.comments');
    expect(codes(comments)).toEqual(['IN-ENG-101']);
  });

  it('Owner can comment on own cost centre only, and only as themselves', async () => {
    const ins = (cc: string, user: string) =>
      as(db, MEENA, `insert into ccp.comments (cc_code, period, gl_group, user_email, comment)
                     values ($1, '2026-09', 'Office & Admin', $2, 'note')`, [cc, user]);
    await expect(ins('IN-ENG-101', MEENA)).resolves.toBeDefined();
    await expect(ins('IN-SAL-501', MEENA)).rejects.toThrow(/row-level security/);
    await expect(ins('IN-ENG-101', KAVYA)).rejects.toThrow(/row-level security/); // spoofed author
  });

  it('A backup owner sees the cost centres they back up', async () => {
    const fin = await as<{ cc_code: string }>(db, `karthik.v@${DEMO_DOMAIN}`, 'select cc_code from ccp.financials');
    expect(codes(fin)).toEqual(['IN-ENG-101', 'IN-ENG-102', 'IN-ENG-103']);
  });

  it('BU head sees all Engineering financials and none from Sales / Shared Services', async () => {
    const fin = await as<{ cc_code: string }>(db, VIKRAM, 'select cc_code from ccp.financials');
    expect(codes(fin)).toEqual([...ENGINEERING_ACTIVE].sort());
    expect(await count(as(db, VIKRAM, `select * from ccp.financials where cc_code = any($1)`, [NON_ENGINEERING]))).toBe(0);
    const alloc = await as<{ cc_code: string }>(db, VIKRAM, 'select cc_code from ccp.allocations');
    expect(codes(alloc).every((c) => ENGINEERING_ACTIVE.includes(c))).toBe(true);
    expect(alloc.length).toBeGreaterThan(0);
  });

  it('Mgmt sees all financials', async () => {
    const all = await asSuper(db, 'select * from ccp.financials');
    const seen = await as<{ cc_code: string }>(db, RAJESH, 'select * from ccp.financials');
    expect(all.length).toBeGreaterThan(0);
    expect(seen.length).toBe(all.length);
    expect(codes(seen)).toEqual([...ENGINEERING_ACTIVE, ...NON_ENGINEERING].sort());
  });

  it('Finance sees all financials, the audit log, uploads and failed searches', async () => {
    for (const t of PROTECTED) {
      const all = await count(asSuper(db, `select * from ${t}`));
      expect(await count(as(db, KAVYA, `select * from ${t}`)), t).toBe(all);
    }
  });

  it('No user context -> no rows (cost_centres, owners, financials)', async () => {
    // A previous request in the same session must not leak its identity.
    await as(db, KAVYA, 'select 1');
    for (const t of ['ccp.cost_centres', 'ccp.cc_owners', 'ccp.cc_access', 'ccp.financials', 'ccp.audit_log']) {
      expect((await noContext(db, `select * from ${t}`)).length, t).toBe(0);
      expect((await noContext(db, `select * from ${t}`, '')).length, `${t} (empty email)`).toBe(0);
      expect((await noContext(db, `select * from ${t}`, '   ')).length, `${t} (blank email)`).toBe(0);
    }
    const [{ r }] = await noContext<{ r: string[] }>(db, 'select ccp.my_roles() as r');
    expect(r).toEqual([]);
    await expect(withUserOn(db, '', (tx) => tx.query('select 1'))).rejects.toThrow(/email is required/);
  });

  it('ccp.my_roles() returns the expected roles for each demo user', async () => {
    const roles = async (email: string) => (await as<{ r: string[] }>(db, email, 'select ccp.my_roles() as r'))[0].r;
    expect(await roles(ARUN)).toEqual([]);
    expect(await roles(MEENA)).toEqual(['Owner']);
    expect(await roles(VIKRAM)).toEqual(['BU_Head']);
    expect(await roles(KAVYA)).toEqual(['Finance', 'Owner']); // Finance grant + owns IN-SSV-301
    expect(await roles(DEEPA)).toEqual(['Backup', 'Finance']); // Finance grant + backup of IN-SSV-301/302
    expect(await roles(RAJESH)).toEqual(['BU_Head', 'Mgmt']); // Mgmt grant + BU head of Shared Services CCs
    // Identity is case-insensitive
    expect(await roles(MEENA.toUpperCase())).toEqual(['Owner']);
  });

  it('every demo login holds the role it is labelled with (incl. two Finance users for maker-checker)', async () => {
    expect(DEMO_USERS).toHaveLength(6);
    expect(new Set(DEMO_USERS.map((u) => u.email)).size).toBe(6);
    const expected: Record<string, string> = {
      'Employee': '', 'CC Owner': 'Owner', 'BU Head': 'BU_Head', 'Finance Admin': 'Finance', 'Finance Approver': 'Finance', 'Management / CFO': 'Mgmt',
    };
    for (const u of DEMO_USERS) {
      expect(u.email, u.email).toBe(u.email.toLowerCase());
      expect(u.email.endsWith(`@${DEMO_DOMAIN}`), u.email).toBe(true);
      const [{ r }] = await as<{ r: string[] }>(db, u.email, 'select ccp.my_roles() as r');
      if (expected[u.role]) expect(r, u.email).toContain(expected[u.role]);
      else expect(r, u.email).toEqual([]);
    }
    expect(DEMO_USERS.filter((u) => u.role.startsWith('Finance')).map((u) => u.email).sort()).toEqual([DEEPA, KAVYA]);
  });
});

// ---------------------------------------------------------------------------
// Write access, audit trail, deactivation
// ---------------------------------------------------------------------------
describe('RLS: write access and audit trail', () => {
  let db: Driver;
  beforeAll(async () => {
    db = await freshDb();
  });
  afterAll(() => db.close());

  const NEW_CC = `insert into ccp.cost_centres (cc_code, cc_alias, entity, bu, department, type, start_date)
                  values ('IN-ENG-150', 'Test Centre', 'IN', 'Engineering', 'Test', 'Direct', '2026-10-01')`;

  it('Mgmt cannot insert or update cost centres', async () => {
    await expect(as(db, RAJESH, NEW_CC)).rejects.toThrow(/row-level security/);
    const updated = await as(db, RAJESH, `update ccp.cost_centres set cc_alias = 'Hacked' where cc_code = 'IN-ENG-101' returning cc_code`);
    expect(updated).toHaveLength(0);
    const [{ cc_alias }] = await asSuper<{ cc_alias: string }>(db, `select cc_alias from ccp.cost_centres where cc_code = 'IN-ENG-101'`);
    expect(cc_alias).toBe('Design Chennai');
    // Read-only on financials too
    expect(await as(db, RAJESH, `update ccp.financials set actual = 0 where cc_code = 'IN-ENG-101' returning cc_code`)).toHaveLength(0);
  });

  it('Non-finance users cannot insert cost centres or change owners/grants', async () => {
    for (const user of [ARUN, MEENA, VIKRAM, RAJESH]) {
      await expect(as(db, user, NEW_CC), user).rejects.toThrow(/row-level security/);
      expect(await as(db, user, `update ccp.cc_owners set owner_name = 'X' where cc_code = 'IN-ENG-101' returning cc_code`)).toHaveLength(0);
      await expect(
        as(db, user, `insert into ccp.cc_access (user_email, role) values ($1, 'Finance')`, [user]),
        `${user} self-grant`,
      ).rejects.toThrow(/row-level security/);
    }
    expect(await count(asSuper(db, `select * from ccp.cost_centres where cc_code = 'IN-ENG-150'`))).toBe(0);
  });

  it('Finance can update a cost centre; audit_log records who and only the changed column', async () => {
    const [before] = await asSuper<{ keywords: string; cc_alias: string }>(
      db, `select keywords, cc_alias from ccp.cost_centres where cc_code = 'IN-SSV-303'`,
    );
    const updated = await as<{ updated_by: string }>(
      db, KAVYA, `update ccp.cost_centres set keywords = 'recruitment; training; canteen' where cc_code = 'IN-SSV-303' returning updated_by`,
    );
    expect(updated).toEqual([{ updated_by: KAVYA }]);

    const audit = await as<{ user_email: string; action: string; old_value: unknown; new_value: unknown; batch_id: string | null }>(
      db, KAVYA,
      `select user_email, action, old_value, new_value, batch_id from ccp.audit_log
        where entity = 'cost_centres' and entity_id = 'IN-SSV-303' and action <> 'CREATE' order by id`,
    );
    expect(audit).toEqual([
      {
        user_email: KAVYA,
        action: 'UPDATE',
        old_value: { keywords: before.keywords },
        new_value: { keywords: 'recruitment; training; canteen' },
        batch_id: null,
      },
    ]);

    // A no-op update writes no audit row.
    await as(db, KAVYA, `update ccp.cost_centres set keywords = keywords where cc_code = 'IN-SSV-303'`);
    expect(await count(asSuper(db, `select * from ccp.audit_log where entity_id = 'IN-SSV-303' and action = 'UPDATE'`))).toBe(1);
  });

  it('Finance can create a cost centre (audited as CREATE)', async () => {
    await as(db, KAVYA, NEW_CC);
    const rows = await asSuper<{ user_email: string; new_value: Record<string, unknown> }>(
      db, `select user_email, new_value from ccp.audit_log where entity = 'cost_centres' and entity_id = 'IN-ENG-150' and action = 'CREATE'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_email).toBe(KAVYA);
    expect(rows[0].new_value).toMatchObject({ cc_code: 'IN-ENG-150', cc_alias: 'Test Centre', status: 'Active' });
  });

  it('Nobody can delete a cost centre — not Finance, not even the superuser', async () => {
    for (const user of [KAVYA, RAJESH, ARUN]) {
      await expect(as(db, user, `delete from ccp.cost_centres where cc_code = 'IN-ENG-101'`), user).rejects.toThrow(/permission denied/);
    }
    await expect(asSuper(db, `delete from ccp.cost_centres where cc_code = 'IN-ENG-101'`)).rejects.toThrow(/cannot be deleted/);
    expect(await count(asSuper(db, `select * from ccp.cost_centres where cc_code = 'IN-ENG-101'`))).toBe(1);
  });

  it('audit_log is append-only and cannot be written directly by the app', async () => {
    await expect(as(db, KAVYA, `update ccp.audit_log set user_email = 'x@y.com'`)).rejects.toThrow(/permission denied/);
    await expect(as(db, KAVYA, `delete from ccp.audit_log`)).rejects.toThrow(/permission denied/);
    await expect(
      as(db, KAVYA, `insert into ccp.audit_log (user_email, action, entity) values ($1, 'UPDATE', 'cost_centres')`, [KAVYA]),
    ).rejects.toThrow(/permission denied/);
    await expect(as(db, ARUN, `insert into ccp.failed_searches (user_email, term) values ($1, 'x')`, [ARUN])).rejects.toThrow(/permission denied/);
    // Even the privileged connection cannot rewrite history.
    await expect(asSuper(db, `update ccp.audit_log set user_email = 'x@y.com'`)).rejects.toThrow(/append-only/);
    await expect(asSuper(db, `delete from ccp.audit_log`)).rejects.toThrow(/append-only/);
    await expect(asSuper(db, `truncate ccp.audit_log`)).rejects.toThrow(/append-only/);
    // The logging entry point only accepts whitelisted actions and always uses the caller's identity.
    await expect(as(db, KAVYA, `select ccp.log_event('UPDATE', 'cost_centres', 'IN-ENG-101')`)).rejects.toThrow(/not allowed/);
    await as(db, ARUN, `select ccp.log_event('EXPORT', 'search', null, '{"q":"x"}'::jsonb)`);
    const [ev] = await asSuper<{ user_email: string }>(db, `select user_email from ccp.audit_log where action = 'EXPORT'`);
    expect(ev.user_email).toBe(ARUN);
  });

  it('Deactivating a cost centre removes its owner mapping and logs DEACTIVATE + DELETE', async () => {
    const michael = `michael.brown@${DEMO_DOMAIN}`;
    expect(await count(as(db, michael, `select * from ccp.financials where cc_code = 'US-SAL-601'`))).toBeGreaterThan(0);

    // The close date is mandatory for Inactive.
    await expect(as(db, KAVYA, `update ccp.cost_centres set status = 'Inactive' where cc_code = 'US-SAL-601'`)).rejects.toThrow(
      /cc_inactive_needs_close/,
    );

    const updated = await as(
      db, KAVYA,
      `update ccp.cost_centres set status = 'Inactive', close_date = '2026-09-30' where cc_code = 'US-SAL-601' returning cc_code`,
    );
    expect(updated).toHaveLength(1);
    expect(await count(asSuper(db, `select * from ccp.cc_owners where cc_code = 'US-SAL-601'`))).toBe(0);

    const audit = await as<{ action: string; entity: string; user_email: string; old_value: Record<string, unknown>; new_value: Record<string, unknown> | null }>(
      db, KAVYA,
      `select action, entity, user_email, old_value, new_value from ccp.audit_log
        where entity_id = 'US-SAL-601' and action in ('DEACTIVATE', 'DELETE') order by id`,
    );
    const deact = audit.find((a) => a.action === 'DEACTIVATE');
    const del = audit.find((a) => a.action === 'DELETE');
    expect(deact).toMatchObject({
      entity: 'cost_centres',
      user_email: KAVYA,
      old_value: { status: 'Active', close_date: null },
      new_value: { status: 'Inactive', close_date: '2026-09-30' },
    });
    expect(del).toMatchObject({ entity: 'cc_owners', user_email: KAVYA, new_value: null });
    expect(del!.old_value).toMatchObject({ cc_code: 'US-SAL-601', owner_name: 'Michael Brown', owner_email: michael });

    // The former owner loses access immediately.
    expect(await count(as(db, michael, `select * from ccp.financials where cc_code = 'US-SAL-601'`))).toBe(0);
    const [{ r }] = await as<{ r: string[] }>(db, michael, 'select ccp.my_roles() as r');
    expect(r).toEqual([]);
  });

  it('log_failed_search collapses keystrokes from the same user into one row with the longest term', async () => {
    const log = (email: string, term: string) => as(db, email, 'select ccp.log_failed_search($1)', [term]);
    await log(ARUN, 'chen');
    await log(ARUN, 'chen d');
    await log(ARUN, '  CHEN   DXX ');
    await log(ARUN, 'chen dx'); // backspace: shorter prefix keeps the longer term
    const rows = await asSuper<{ term: string }>(db, `select term from ccp.failed_searches where user_email = $1`, [ARUN]);
    expect(rows).toEqual([{ term: 'chen dxx' }]);

    // A different search and a different user are separate rows; 1-char terms are ignored.
    await log(ARUN, 'zzz');
    await log(MEENA, 'chen');
    await log(ARUN, 'q');
    const all = await asSuper<{ user_email: string; term: string }>(db, `select user_email, term from ccp.failed_searches order by id`);
    expect(all).toEqual([
      { user_email: ARUN, term: 'chen dxx' },
      { user_email: ARUN, term: 'zzz' },
      { user_email: MEENA, term: 'chen' },
    ]);
    // ...and the employee who searched cannot read the log.
    expect(await count(as(db, ARUN, 'select * from ccp.failed_searches'))).toBe(0);
  });
});
