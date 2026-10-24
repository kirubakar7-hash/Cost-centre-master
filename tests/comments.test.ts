/**
 * Phase 3: variance explanations (comments) and allocations received.
 *  - who may comment is decided in the database (ccp.can_comment + the
 *    comments_insert policy), so these tests use plain SQL as cc_app as well
 *    as the src/lib/comments.ts helpers;
 *  - comments are append-only (even for the table owner) and audited;
 *  - allocations are read through RLS.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserOn } from '../src/lib/db/core';
import { DEMO_DOMAIN } from '../src/lib/db/seed';
import {
  addComment,
  canComment,
  COMMENT_MAX_LENGTH,
  CommentError,
  commentableGlGroups,
  listComments,
  normalizeComment,
  type NewComment,
} from '../src/lib/comments';
import { allocationTotals, allocationsReceived } from '../src/lib/allocations';
import { isCrossOrigin } from '../src/app/api/cc/_lib/origin';
import { ARUN, DEEPA, KAVYA, MEENA, RAJESH, VIKRAM, as, asSuper, freshDb, type Driver } from './helpers';

const KARTHIK = `karthik.v@${DEMO_DOMAIN}`; // backup owner of IN-ENG-101..103
const TRAVEL = 'Travel & Conveyance';

const comment = (over: Partial<NewComment> = {}): NewComment => ({
  code: 'IN-ENG-101',
  period: '2026-09',
  glGroup: TRAVEL,
  comment: 'Client visits to Hosur for the gearbox programme.',
  ...over,
});

/** Raw insert as an application user (what a tampered API call could try). */
const rawInsert = (db: Driver, user: string, cc: string, period: string, gl: string, author = user) =>
  as(
    db,
    user,
    `insert into ccp.comments (cc_code, period, gl_group, user_email, comment) values ($1, $2, $3, $4, 'Explained')`,
    [cc, period, gl, author],
  );

describe('variance comments', () => {
  let db: Driver;
  const add = (user: string, c: NewComment) => withUserOn(db, user, (tx) => addComment(tx, c));
  const auditCount = async (cc: string) => {
    const [{ n }] = await asSuper<{ n: number }>(
      db,
      `select count(*)::int as n from ccp.audit_log where action = 'COMMENT' and entity = 'comment' and entity_id = $1`,
      [cc],
    );
    return n;
  };

  beforeAll(async () => {
    db = await freshDb();
  });
  afterAll(() => db.close());

  it('ccp.can_comment: owner, backup and BU head of the CC, and Finance — not Mgmt or employees', async () => {
    const can = (user: string, cc: string) => withUserOn(db, user, (tx) => canComment(tx, cc));
    expect(await can(MEENA, 'IN-ENG-101')).toBe(true);
    expect(await can(MEENA, 'IN-ENG-102')).toBe(true);
    expect(await can(MEENA, 'IN-ENG-103')).toBe(false);
    expect(await can(MEENA, 'IN-SAL-501')).toBe(false);
    expect(await can(KARTHIK, 'IN-ENG-103')).toBe(true); // backup owner
    expect(await can(VIKRAM, 'US-ENG-201')).toBe(true); // BU head (Engineering)
    expect(await can(VIKRAM, 'IN-SAL-501')).toBe(false);
    expect(await can(KAVYA, 'IN-SAL-501')).toBe(true); // Finance
    expect(await can(DEEPA, 'US-SAL-601')).toBe(true);
    expect(await can(RAJESH, 'IN-ENG-101')).toBe(false); // Mgmt: read-only
    expect(await can(ARUN, 'IN-ENG-101')).toBe(false); // employee
    expect(await can(ARUN, 'XX-NOPE-000')).toBe(false);
  });

  it('a BU_Head grant in cc_access is enough (no owner mapping needed)', async () => {
    const head = `new.head@${DEMO_DOMAIN}`;
    await asSuper(db, `insert into ccp.cc_access (user_email, role, bu, created_by) values ($1, 'BU_Head', 'Sales', 'test')`, [head]);
    expect(await withUserOn(db, head, (tx) => canComment(tx, 'US-SAL-601'))).toBe(true);
    expect(await withUserOn(db, head, (tx) => canComment(tx, 'IN-ENG-101'))).toBe(false);
  });

  it('the owner can comment on her own CC for a published period, as herself', async () => {
    const before = await auditCount('IN-ENG-101');
    const c = await add(MEENA, comment({ comment: '  Client visits to Hosur.\r\nOne-off.  ' }));
    expect(c).toMatchObject({
      cc_code: 'IN-ENG-101',
      period: '2026-09',
      gl_group: TRAVEL,
      user_email: MEENA,
      comment: 'Client visits to Hosur.\nOne-off.', // trimmed, newlines normalised
    });
    expect(c.id).toBeGreaterThan(0);
    expect(c.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(await auditCount('IN-ENG-101')).toBe(before + 1);
  });

  it('each comment writes an audit_log COMMENT row with who and what', async () => {
    const c = await add(MEENA, comment({ glGroup: 'Software & Licences', comment: 'True-up of CAD licences.' }));
    const [row] = await asSuper<{ user_email: string; action: string; entity: string; entity_id: string; new_value: Record<string, unknown> }>(
      db,
      `select user_email, action, entity, entity_id, new_value from ccp.audit_log
        where action = 'COMMENT' and (new_value ->> 'id')::bigint = $1`,
      [c.id],
    );
    expect(row).toEqual({
      user_email: MEENA,
      action: 'COMMENT',
      entity: 'comment',
      entity_id: 'IN-ENG-101',
      new_value: { id: c.id, period: '2026-09', gl_group: 'Software & Licences', comment: 'True-up of CAD licences.' },
    });
    // Finance can read it through RLS; the owner cannot read the audit log at all.
    expect((await as(db, KAVYA, `select 1 from ccp.audit_log where action = 'COMMENT'`)).length).toBeGreaterThan(0);
    expect(await as(db, MEENA, `select 1 from ccp.audit_log where action = 'COMMENT'`)).toEqual([]);
  });

  it('the owner cannot comment on another cost centre (RLS)', async () => {
    await expect(rawInsert(db, MEENA, 'IN-SAL-501', '2026-09', TRAVEL)).rejects.toThrow(/row-level security/);
    await expect(rawInsert(db, MEENA, 'IN-ENG-103', '2026-09', TRAVEL)).rejects.toThrow(/row-level security/);
    await expect(add(MEENA, comment({ code: 'IN-SAL-501' }))).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('Management and employees cannot comment', async () => {
    await expect(rawInsert(db, RAJESH, 'IN-ENG-101', '2026-09', TRAVEL)).rejects.toThrow(/row-level security/);
    await expect(rawInsert(db, ARUN, 'IN-ENG-101', '2026-09', TRAVEL)).rejects.toThrow(/row-level security/);
    await expect(add(RAJESH, comment())).rejects.toBeInstanceOf(CommentError);
    await expect(add(RAJESH, comment())).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(add(ARUN, comment())).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('Finance can comment on any cost centre', async () => {
    const c = await add(KAVYA, comment({ code: 'IN-SAL-501', comment: 'Tender travel for the Pune bid.' }));
    expect(c.user_email).toBe(KAVYA);
    await expect(rawInsert(db, DEEPA, 'US-SAL-601', '2026-09', 'Office & Admin')).resolves.toBeDefined();
  });

  it('cannot comment on a period with no actuals (budget only) or a GL group that does not exist', async () => {
    await expect(rawInsert(db, MEENA, 'IN-ENG-101', '2026-11', TRAVEL)).rejects.toThrow(/row-level security/);
    await expect(rawInsert(db, KAVYA, 'IN-ENG-101', '2026-11', TRAVEL)).rejects.toThrow(/row-level security/);
    await expect(rawInsert(db, MEENA, 'IN-ENG-101', '2026-09', 'Catering')).rejects.toThrow(/row-level security/);
    await expect(rawInsert(db, MEENA, 'IN-ENG-101', '2025-09', TRAVEL)).rejects.toThrow(/row-level security/);

    await expect(add(MEENA, comment({ period: '2026-11' }))).rejects.toThrow(/not published yet/);
    await expect(add(MEENA, comment({ glGroup: 'Catering' }))).rejects.toThrow(/no "Catering" line/);
    await expect(add(MEENA, comment({ period: '2026-13' }))).rejects.toMatchObject({ kind: 'invalid' });
    await expect(add(MEENA, comment({ code: 'in-eng-101' }))).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('cannot comment as somebody else', async () => {
    await expect(rawInsert(db, MEENA, 'IN-ENG-101', '2026-09', TRAVEL, KAVYA)).rejects.toThrow(/row-level security/);
    await expect(rawInsert(db, KAVYA, 'IN-ENG-101', '2026-09', TRAVEL, MEENA)).rejects.toThrow(/row-level security/);
  });

  it('validates the text: 1–2000 characters after trimming', async () => {
    expect(() => normalizeComment('   ')).toThrow(/Enter an explanation/);
    expect(() => normalizeComment(42)).toThrow(CommentError);
    expect(normalizeComment(`  ${'x'.repeat(COMMENT_MAX_LENGTH)}  `)).toHaveLength(COMMENT_MAX_LENGTH);
    expect(() => normalizeComment('x'.repeat(COMMENT_MAX_LENGTH + 1))).toThrow(/limited to 2,000 characters/);
    await expect(add(MEENA, comment({ comment: ' \n ' }))).rejects.toMatchObject({ kind: 'invalid' });
    // The database enforces the same limits.
    await expect(
      as(db, MEENA, `insert into ccp.comments (cc_code, period, gl_group, user_email, comment) values ('IN-ENG-101', '2026-09', $1, $2, '   ')`, [TRAVEL, MEENA]),
    ).rejects.toThrow(/comments_not_blank/);
    await expect(
      as(db, MEENA, `insert into ccp.comments (cc_code, period, gl_group, user_email, comment) values ('IN-ENG-101', '2026-09', $1, $2, $3)`, [
        TRAVEL,
        MEENA,
        'x'.repeat(COMMENT_MAX_LENGTH + 1),
      ]),
    ).rejects.toThrow(/check constraint/);
  });

  it('comments cannot be updated or deleted — not by the app, not even by the table owner', async () => {
    await expect(as(db, MEENA, `update ccp.comments set comment = 'changed'`)).rejects.toThrow(/permission denied/);
    await expect(as(db, KAVYA, `delete from ccp.comments`)).rejects.toThrow(/permission denied/);
    await expect(asSuper(db, `update ccp.comments set comment = 'changed'`)).rejects.toThrow(/append-only/);
    await expect(asSuper(db, `delete from ccp.comments`)).rejects.toThrow(/append-only/);
    await expect(asSuper(db, `truncate ccp.comments`)).rejects.toThrow(/append-only/);
    const [{ n }] = await asSuper<{ n: number }>(db, `select count(*)::int as n from ccp.comments where comment = 'changed'`);
    expect(n).toBe(0);
  });

  it('listComments: newest first, all GL groups of the CC and period, only for visible CCs', async () => {
    const mine = await withUserOn(db, MEENA, (tx) => listComments(tx, 'IN-ENG-101', '2026-09'));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(new Set(mine.map((c) => c.gl_group))).toEqual(new Set([TRAVEL, 'Software & Licences']));
    const order = mine.map((c) => [c.created_at, c.id] as const);
    const sorted = [...order].sort((a, b) => (a[0] === b[0] ? b[1] - a[1] : a[0] < b[0] ? 1 : -1));
    expect(order).toEqual(sorted);
    expect(mine.every((c) => c.cc_code === 'IN-ENG-101' && c.period === '2026-09')).toBe(true);

    // Kavya (Finance) commented on IN-SAL-501, but Meena cannot see that cost centre.
    expect(await withUserOn(db, MEENA, (tx) => listComments(tx, 'IN-SAL-501', '2026-09'))).toEqual([]);
    expect(await withUserOn(db, ARUN, (tx) => listComments(tx, 'IN-ENG-101', '2026-09'))).toEqual([]);
    // Management reads everything (read-only).
    expect((await withUserOn(db, RAJESH, (tx) => listComments(tx, 'IN-SAL-501', '2026-09'))).length).toBe(1);
    // Other periods are separate.
    expect(await withUserOn(db, MEENA, (tx) => listComments(tx, 'IN-ENG-101', '2026-08'))).toEqual([]);
  });

  it('commentableGlGroups lists the lines with actuals for the period (none for a budget-only month)', async () => {
    const sep = await withUserOn(db, MEENA, (tx) => commentableGlGroups(tx, 'IN-ENG-101', '2026-09'));
    expect(sep).toContain(TRAVEL);
    expect(sep.length).toBe(6);
    expect(await withUserOn(db, MEENA, (tx) => commentableGlGroups(tx, 'IN-ENG-101', '2026-11'))).toEqual([]);
  });
});

describe('allocations received', () => {
  let db: Driver;
  beforeAll(async () => {
    db = await freshDb();
  });
  afterAll(() => db.close());

  it('IN-ENG-101, Sep 2026: the IN-SSV-302 recharge with its basis, month and fiscal YTD', async () => {
    const rows = await withUserOn(db, MEENA, (tx) => allocationsReceived(tx, 'IN-ENG-101', '2026-09'));
    expect(rows).toEqual([
      {
        source_cc: 'IN-SSV-302',
        source_alias: 'IT Infrastructure',
        basis: 'Headcount (42 of 118)',
        month: 145_000,
        ytd: 870_000, // Apr–Sep 2026: 6 × 145,000
      },
    ]);
    expect(allocationTotals(rows)).toEqual({ month: 145_000, ytd: 870_000 });
  });

  it('YTD follows the fiscal year and the As-of month', async () => {
    const jun = await withUserOn(db, MEENA, (tx) => allocationsReceived(tx, 'IN-ENG-101', '2026-06'));
    expect(jun[0]).toMatchObject({ month: 145_000, ytd: 435_000 });
    // October has no allocation yet: month is 0, YTD is still Apr–Sep.
    const oct = await withUserOn(db, MEENA, (tx) => allocationsReceived(tx, 'IN-ENG-101', '2026-10'));
    expect(oct[0]).toMatchObject({ month: 0, ytd: 870_000 });
    // March 2026 is in the previous fiscal year: nothing.
    expect(await withUserOn(db, MEENA, (tx) => allocationsReceived(tx, 'IN-ENG-101', '2026-03'))).toEqual([]);
  });

  it('is filtered by RLS: an employee sees nothing; an owner sees nothing for another CC', async () => {
    expect(await withUserOn(db, ARUN, (tx) => allocationsReceived(tx, 'IN-ENG-101', '2026-09'))).toEqual([]);
    expect(await withUserOn(db, MEENA, (tx) => allocationsReceived(tx, 'IN-SAL-501', '2026-09'))).toEqual([]);
    expect(await withUserOn(db, RAJESH, (tx) => allocationsReceived(tx, 'IN-SAL-501', '2026-09'))).toHaveLength(1);
  });
});

describe('comments API: cross-site request check', () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it('allows same-origin requests and requests without an Origin header', () => {
    expect(isCrossOrigin(h({ host: 'portal.example.com', origin: 'https://portal.example.com' }), undefined)).toBe(false);
    expect(isCrossOrigin(h({ host: 'localhost:3101', origin: 'http://localhost:3101' }), undefined)).toBe(false);
    expect(isCrossOrigin(h({ host: 'internal:3000', 'x-forwarded-host': 'portal.example.com', origin: 'https://portal.example.com' }), undefined)).toBe(false);
    expect(isCrossOrigin(h({ host: 'internal:3000', origin: 'https://portal.example.com' }), 'https://portal.example.com')).toBe(false);
    expect(isCrossOrigin(h({ host: 'portal.example.com' }), undefined)).toBe(false);
    expect(isCrossOrigin(h({ host: 'portal.example.com', 'sec-fetch-site': 'same-origin' }), undefined)).toBe(false);
  });
  it('refuses a different Origin, an opaque Origin, and cross-site fetch metadata', () => {
    expect(isCrossOrigin(h({ host: 'portal.example.com', origin: 'https://evil.example.net' }), undefined)).toBe(true);
    expect(isCrossOrigin(h({ host: 'portal.example.com', origin: 'https://portal.example.com:8443' }), undefined)).toBe(true);
    expect(isCrossOrigin(h({ host: 'portal.example.com', origin: 'null' }), undefined)).toBe(true);
    expect(isCrossOrigin(h({ host: 'portal.example.com', 'sec-fetch-site': 'cross-site' }), undefined)).toBe(true);
    expect(isCrossOrigin(h({ host: 'portal.example.com', 'sec-fetch-site': 'same-site' }), undefined)).toBe(true);
  });
});
