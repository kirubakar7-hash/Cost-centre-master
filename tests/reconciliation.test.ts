/**
 * Budget & Actuals publishing (PGlite, through RLS):
 * stage -> preparer enters the trial balance -> reconciliation -> a different
 * Finance user approves and publishes (maker-checker). Publishing replaces every
 * line of every period in the file and records the period in ccp.periods.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withUserOn } from '../src/lib/db/core';
import { GL_GROUPS, SEED_PERIODS } from '../src/lib/db/seed';
import { getTotals, latestPeriod, availablePeriods, listMyCostCentres } from '../src/lib/financials';
import { addMonths } from '../src/lib/fiscal';
import { discardUpload, enterTrialBalance, pendingBatches, publishUpload, stageUpload } from '../src/lib/upload/service';
import { TEMPLATES } from '../src/lib/upload/templates';
import { ARUN, DEEPA, KAVYA, MEENA, RAJESH, VIKRAM, as, asSuper, freshDb, resetDb, type Driver } from './helpers';

const FIN_HEADERS = TEMPLATES.financials.columns.map((c) => c.key);
type Line = { CC_Code: string; Period: string; GL_Group: string; Budget: string; Actual: string };
type FinRow = { cc_code: string; period: string; gl_group: string; budget: number; actual: number | null };

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const finCsv = (rows: Line[]) =>
  Buffer.from([FIN_HEADERS.join(','), ...rows.map((r) => FIN_HEADERS.map((h) => csvCell(r[h as keyof Line] ?? '')).join(','))].join('\r\n') + '\r\n');

/** Exact cents arithmetic for expected totals (no float drift). */
const cents = (s: string) => Math.round(Number(s.replace(/,/g, '')) * 100);
const total = (values: string[]) => values.reduce((a, v) => a + cents(v), 0) / 100;

const ENV_KEYS = ['UPLOAD_MAKER_CHECKER', 'RECON_TOLERANCE'] as const;
let savedEnv: Record<string, string | undefined> = {};
function saveEnv() {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k]; // defaults: maker-checker on, tolerance 0
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

function harness(getDb: () => Driver) {
  const db = () => getDb();
  return {
    stage: (rows: Line[], user = KAVYA, name = 'financials.csv') =>
      withUserOn(db(), user, (tx) => stageUpload(tx, user, 'financials', name, finCsv(rows))),
    enterTb: (batchId: string, totals: Record<string, number>, user = KAVYA) =>
      withUserOn(db(), user, (tx) => enterTrialBalance(tx, batchId, totals), { batchId }),
    publish: (batchId: string, user = DEEPA) => withUserOn(db(), user, (tx) => publishUpload(tx, batchId), { batchId }),
    discard: (batchId: string, user = KAVYA) => withUserOn(db(), user, (tx) => discardUpload(tx, batchId), { batchId }),
    pending: (user: string) => withUserOn(db(), user, (tx) => pendingBatches(tx)),
    /** Financial lines (normalised to numbers), optionally only for / excluding some periods. */
    rows: async (where = 'true', params: unknown[] = []): Promise<FinRow[]> =>
      (await asSuper<{ cc_code: string; period: string; gl_group: string; budget: string; actual: string | null }>(
        db(), `select cc_code, period, gl_group, budget, actual from ccp.financials where ${where} order by period, cc_code, gl_group`, params,
      )).map((r) => ({ ...r, budget: Number(r.budget), actual: r.actual === null ? null : Number(r.actual) })),
    batch: async (id: string) =>
      (await asSuper<{ kind: string; status: string; uploaded_by: string; approved_by: string | null; published_by: string | null; published_at: string | null }>(
        db(), 'select kind, status, uploaded_by, approved_by, published_by, published_at from ccp.upload_batches where id = $1', [id],
      ))[0],
    periodRow: async (period: string) =>
      (await asSuper<{ period: string; actual_total: string; tb_total: string; batch_id: string; published_by: string }>(
        db(), 'select period, actual_total, tb_total, batch_id, published_by from ccp.periods where period = $1', [period],
      ))[0],
    events: (batchId: string) =>
      asSuper<{ action: string; user_email: string; batch_id: string | null; new_value: Record<string, unknown> | null }>(
        db(), `select action, user_email, batch_id, new_value from ccp.audit_log where entity = 'upload_batch' and entity_id = $1 order by id`, [batchId],
      ),
    seedBatchId: async () =>
      (await asSuper<{ id: string }>(db(), `select id from ccp.upload_batches where file_name = 'seed-data'`))[0].id,
    currentPeriod: async () => (await asSuper<{ p: string }>(db(), `select to_char(now(), 'YYYY-MM') as p`))[0].p,
  };
}

/** File lines -> the rows publishing should leave in ccp.financials (normalised, sorted like rows()). */
function expectedRows(lines: Line[], normalise: (l: Line) => FinRow): FinRow[] {
  return lines.map(normalise).sort((a, b) =>
    a.period.localeCompare(b.period) || a.cc_code.localeCompare(b.cc_code) || a.gl_group.localeCompare(b.gl_group));
}

/** Seed rows of one published period as a re-upload file, with every actual changed. */
async function reuploadOf(h: ReturnType<typeof harness>, period: string, bump = '1000.25'): Promise<Line[]> {
  const rows = await h.rows('period = $1', [period]);
  expect(rows.length).toBeGreaterThan(0);
  return rows.map((r) => ({
    CC_Code: r.cc_code, Period: r.period, GL_Group: r.gl_group, Budget: r.budget.toFixed(2),
    Actual: ((cents(String(r.actual)) + cents(bump)) / 100).toFixed(2),
  }));
}

// ---------------------------------------------------------------------------
// The full maker-checker story, step by step on one database
// ---------------------------------------------------------------------------
describe('financials publish: trial-balance reconciliation and maker-checker (September re-upload)', () => {
  let db: Driver;
  const h = harness(() => db);
  let lines: Line[];
  let tbTotal: number;
  let batchId: string;
  let before: FinRow[]; // every financial line before the upload
  const SEPT = '2026-09';

  beforeAll(async () => {
    saveEnv();
    db = await freshDb();
    // Corrected September file: every actual changed, one line dropped, one new GL line
    // (written as Sep-2026 / 45,000.50 to prove values are normalised before storing).
    lines = (await reuploadOf(h, SEPT)).filter((l) => !(l.CC_Code === 'IN-ENG-101' && l.GL_Group === 'Office & Admin'));
    lines.push({ CC_Code: 'IN-ENG-101', Period: 'Sep-2026', GL_Group: 'Recruitment', Budget: '0', Actual: '45,000.50' });
    tbTotal = total(lines.map((l) => l.Actual));
    before = await h.rows();
  });
  afterAll(async () => {
    restoreEnv();
    await db.close();
  });

  const unchanged = async () => expect(await h.rows()).toEqual(before);
  const normalise = (l: Line): FinRow => ({
    cc_code: l.CC_Code, period: SEPT, gl_group: l.GL_Group, budget: cents(l.Budget) / 100, actual: cents(l.Actual) / 100,
  });

  it('KAVYA stages the file: Validated, summarised per period, nothing written to financials', async () => {
    const res = await h.stage(lines);
    batchId = res.batchId;
    expect(res.errors).toEqual([]);
    expect(res.status).toBe('Validated');
    expect(res.warnings.map((w) => [w.code, w.row])).toEqual([['NEW_GL_GROUP', lines.length + 1]]);
    expect(res.summary.periods).toEqual([
      { period: SEPT, rows: 60, costCentres: 10, budgetTotal: total(lines.map((l) => l.Budget)), actualTotal: tbTotal },
    ]);
    expect(await h.batch(batchId)).toMatchObject({ kind: 'financials', status: 'Validated', uploaded_by: KAVYA, approved_by: null });
    await unchanged();

    // It waits for approval (Finance only)
    expect((await h.pending(DEEPA)).map((b) => b.id)).toContain(batchId);
    expect(await h.pending(MEENA)).toEqual([]);
    expect(await h.pending(RAJESH)).toEqual([]);
  });

  it('publishing before any trial balance is entered is blocked and logged (RECON_FAILED)', async () => {
    const out = await h.publish(batchId);
    expect(out.published).toBe(false);
    if (out.published) return;
    expect(out.errors).toEqual([]);
    expect('error' in out && out.error).toMatch(/2026-09 has no trial balance entered/);
    expect('reconciliation' in out && out.reconciliation).toEqual([
      { period: SEPT, actualTotal: tbTotal, tbTotal: null, difference: null, matched: false },
    ]);
    await unchanged();
    expect((await h.batch(batchId)).status).toBe('Validated'); // not rejected: fix the TB and try again
    expect((await h.periodRow(SEPT)).batch_id).toBe(await h.seedBatchId());

    const failed = (await h.events(batchId)).filter((e) => e.action === 'RECON_FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ user_email: DEEPA, batch_id: batchId, new_value: { stage: 'publish' } });
  });

  it('a wrong trial balance fails reconciliation with the exact difference; publishing stays blocked', async () => {
    const wrongTb = (cents(tbTotal.toFixed(2)) - 123456) / 100; // 1,234.56 short
    const r = await h.enterTb(batchId, { [SEPT]: wrongTb });
    expect(r).toEqual({
      reconciled: false,
      reconciliation: [{ period: SEPT, actualTotal: tbTotal, tbTotal: wrongTb, difference: 1234.56, matched: false }],
    });
    const [tb] = await asSuper<{ tb_total: string; entered_by: string }>(db, 'select tb_total, entered_by from ccp.trial_balances where batch_id = $1', [batchId]);
    expect(tb).toEqual({ tb_total: wrongTb.toFixed(2), entered_by: KAVYA });

    const out = await h.publish(batchId);
    expect(out.published).toBe(false);
    expect('error' in out && out.error).toMatch(/2026-09 differs from the trial balance by 1234\.56/);
    await unchanged();

    const ev = await h.events(batchId);
    expect(ev.filter((e) => e.action === 'TB_ENTERED')).toEqual([
      { action: 'TB_ENTERED', user_email: KAVYA, batch_id: batchId, new_value: { totals: { [SEPT]: wrongTb } } },
    ]);
    expect(ev.filter((e) => e.action === 'RECON_FAILED').map((e) => e.user_email)).toEqual([DEEPA, KAVYA, DEEPA]);
    expect(ev.filter((e) => e.action === 'RECON_PASSED')).toEqual([]);

    // A trial balance above the file total gives a negative difference
    const over = await h.enterTb(batchId, { [SEPT]: (cents(tbTotal.toFixed(2)) + 50) / 100 });
    expect(over.reconciliation[0]).toMatchObject({ difference: -0.5, matched: false });
  });

  it('only the preparer can enter the trial balance, only for periods with actuals in the file', async () => {
    await expect(h.enterTb(batchId, { [SEPT]: tbTotal }, DEEPA)).rejects.toThrow(/Only the preparer/);
    await expect(h.enterTb(batchId, { '2026-08': tbTotal })).rejects.toThrow(/2026-08 has no actuals in this upload/);
    await expect(h.enterTb(batchId, { [SEPT]: Number.NaN })).rejects.toThrow(/must be a number/);
    await expect(h.enterTb(batchId, { [SEPT]: Number.POSITIVE_INFINITY })).rejects.toThrow(/must be a number/);
    for (const user of [MEENA, RAJESH, ARUN]) await expect(h.enterTb(batchId, { [SEPT]: tbTotal }, user), user).rejects.toThrow(/not found/);
    // None of that changed the stored trial balance
    const tbs = await asSuper<{ entered_by: string }>(db, 'select entered_by from ccp.trial_balances where batch_id = $1', [batchId]);
    expect(tbs).toEqual([{ entered_by: KAVYA }]);
  });

  it('the correct trial balance reconciles, but the preparer still cannot publish her own upload', async () => {
    const r = await h.enterTb(batchId, { [SEPT]: tbTotal });
    expect(r).toEqual({
      reconciled: true,
      reconciliation: [{ period: SEPT, actualTotal: tbTotal, tbTotal, difference: 0, matched: true }],
    });
    const pending = (await h.pending(DEEPA)).find((b) => b.id === batchId)!;
    expect(pending.summary).toMatchObject({ reconciled: true, reconciliation: r.reconciliation });

    await expect(h.publish(batchId, KAVYA)).rejects.toThrow(/Segregation of duties/);
    await unchanged();
    expect(await h.batch(batchId)).toMatchObject({ status: 'Validated', published_by: null, approved_by: null });
  });

  it('DEEPA publishes: September is replaced by the file exactly, other periods are untouched', async () => {
    const out = await h.publish(batchId);
    expect(out.published).toBe(true);
    if (!out.published) return;
    expect(out.summary).toMatchObject({
      created: 60,
      periods: [{ period: SEPT, rows: 60, costCentres: 10, actualTotal: tbTotal }],
      reconciliation: [{ period: SEPT, actualTotal: tbTotal, tbTotal, difference: 0, matched: true }],
    });

    // September now equals the file — the dropped line is gone, the new GL line is there
    const sept = await h.rows('period = $1', [SEPT]);
    expect(sept).toEqual(expectedRows(lines, normalise));
    expect(sept.find((r) => r.cc_code === 'IN-ENG-101' && r.gl_group === 'Office & Admin')).toBeUndefined();
    expect(sept.find((r) => r.gl_group === 'Recruitment')).toEqual({ cc_code: 'IN-ENG-101', period: SEPT, gl_group: 'Recruitment', budget: 0, actual: 45000.5 });
    // Every other period is untouched
    expect(await h.rows('period <> $1', [SEPT])).toEqual(before.filter((r) => r.period !== SEPT));

    // Period register points at this batch, reconciled to the trial balance
    expect(await h.periodRow(SEPT)).toEqual({
      period: SEPT, actual_total: tbTotal.toFixed(2), tb_total: tbTotal.toFixed(2), batch_id: batchId, published_by: DEEPA,
    });
    const seedId = await h.seedBatchId();
    for (const p of SEED_PERIODS.filter((x) => x !== SEPT)) expect((await h.periodRow(p)).batch_id, p).toBe(seedId);

    // Maker-checker evidence on the batch
    const b = await h.batch(batchId);
    expect(b).toMatchObject({ status: 'Published', uploaded_by: KAVYA, approved_by: DEEPA, published_by: DEEPA });
    expect(b.published_at).not.toBeNull();

    // Audit trail: every workflow event carries the batch id
    const ev = await h.events(batchId);
    const pairs = ev.filter((e) => e.action !== 'UPLOAD_VALIDATED').map((e) => [e.action, e.user_email]);
    expect(pairs).toContainEqual(['TB_ENTERED', KAVYA]);
    expect(pairs).toContainEqual(['RECON_PASSED', KAVYA]);
    expect(pairs).toContainEqual(['UPLOAD_PUBLISHED', DEEPA]);
    expect(ev.filter((e) => e.action !== 'UPLOAD_VALIDATED').every((e) => e.batch_id === batchId)).toBe(true);
    expect(ev.at(-1)).toMatchObject({ action: 'UPLOAD_PUBLISHED', user_email: DEEPA, batch_id: batchId });
    expect(ev[0]).toMatchObject({ action: 'UPLOAD_VALIDATED', user_email: KAVYA });

    // The owner's dashboard shows the new numbers
    const t = await withUserOn(db, MEENA, (tx) => getTotals(tx, 'IN-ENG-101', SEPT));
    expect(t.monthActual).toBeCloseTo(total(lines.filter((l) => l.CC_Code === 'IN-ENG-101').map((l) => l.Actual)), 2);
  });

  it('a published batch is final: no re-publish, no new trial balance, no discard', async () => {
    await expect(h.publish(batchId)).rejects.toThrow(/Upload is Published/);
    await expect(h.enterTb(batchId, { [SEPT]: 1 })).rejects.toThrow(/Upload is Published/);
    expect(await h.discard(batchId)).toBe(false);
    expect(await h.discard(batchId, DEEPA)).toBe(false);
    expect((await h.batch(batchId)).status).toBe('Published');
  });
});

// ---------------------------------------------------------------------------
// Independent scenarios (fresh seed each)
// ---------------------------------------------------------------------------
describe('financials publish: other scenarios', () => {
  let db: Driver;
  const h = harness(() => db);
  beforeAll(async () => {
    saveEnv();
    db = await freshDb();
  });
  beforeEach(() => resetDb(db));
  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterAll(async () => {
    restoreEnv();
    await db.close();
  });

  const ACTIVE = ['IN-ENG-101', 'IN-ENG-102', 'IN-ENG-103', 'US-ENG-201', 'IN-SSV-301', 'IN-SSV-302', 'IN-SSV-303', 'US-SSV-401', 'IN-SAL-501', 'US-SAL-601'];
  /** One line per active CC and GL group for a period. */
  const fullPeriod = (period: string, actual: ((i: number) => string) | null, budget = (i: number) => String(10000 + i * 100)) =>
    ACTIVE.flatMap((cc, c) => GL_GROUPS.map((gl, g) => {
      const i = c * GL_GROUPS.length + g;
      return { CC_Code: cc, Period: period, GL_Group: gl, Budget: budget(i), Actual: actual ? actual(i) : '' };
    }));
  const num = (l: Line): FinRow => ({
    cc_code: l.CC_Code, period: l.Period, gl_group: l.GL_Group, budget: cents(l.Budget) / 100, actual: l.Actual === '' ? null : cents(l.Actual) / 100,
  });

  it('a new past period (2026-03, FY 2025-26) gets its own period register entry', async () => {
    const lines = fullPeriod('2026-03', (i) => `${9000 + i}.${String(i % 100).padStart(2, '0')}`);
    const tb = total(lines.map((l) => l.Actual));
    const before = await h.rows();

    const res = await h.stage(lines);
    expect(res.status).toBe('Validated');
    expect((await h.enterTb(res.batchId, { '2026-03': tb })).reconciled).toBe(true);
    expect((await h.publish(res.batchId)).published).toBe(true);

    expect(await h.rows(`period = '2026-03'`)).toEqual(expectedRows(lines, num));
    expect(await h.rows(`period <> '2026-03'`)).toEqual(before);
    expect(await h.periodRow('2026-03')).toMatchObject({ actual_total: tb.toFixed(2), tb_total: tb.toFixed(2), batch_id: res.batchId, published_by: DEEPA });
    expect(await asSuper(db, 'select period from ccp.periods order by period')).toEqual(['2026-03', ...SEED_PERIODS].map((period) => ({ period })));

    // Read model: the new month belongs to FY 2025-26 and does not move "latest"
    await withUserOn(db, MEENA, async (tx) => {
      expect(await latestPeriod(tx)).toBe('2026-09');
      expect(await availablePeriods(tx)).toEqual([...[...SEED_PERIODS].reverse(), '2026-03']);
      const [eng101] = (await listMyCostCentres(tx, '2026-03')).filter((r) => r.cc_code === 'IN-ENG-101');
      const mine = lines.filter((l) => l.CC_Code === 'IN-ENG-101');
      expect(eng101.ytdActual).toBeCloseTo(total(mine.map((l) => l.Actual)), 2); // FY 2025-26 YTD = March only
      expect(eng101.ytdBudget).toBeCloseTo(total(mine.map((l) => l.Budget)), 2);
      expect(eng101.outturn).toBeCloseTo(eng101.ytdActual, 2); // March is the last month of that FY
    });
  });

  it('a budget-only upload for future months needs no trial balance and publishes', async () => {
    const cur = await h.currentPeriod();
    const [m1, m2] = [addMonths(cur, 1), addMonths(cur, 2)];
    const lines = [...fullPeriod(m1, null), ...fullPeriod(m2, null, (i) => `${20000 + i}`)];
    const periodsBefore = await asSuper(db, 'select * from ccp.periods order by period');
    const before = await h.rows();

    const res = await h.stage(lines);
    expect(res.errors).toEqual([]);
    expect(res.status).toBe('Validated');
    expect(res.summary.periods!.map((p) => [p.period, p.actualTotal])).toEqual([[m1, null], [m2, null]]);
    await expect(h.enterTb(res.batchId, { [m1]: 0 })).rejects.toThrow(/has no actuals in this upload/);
    await expect(h.publish(res.batchId, KAVYA)).rejects.toThrow(/Segregation of duties/); // maker-checker applies to budgets too

    const out = await h.publish(res.batchId);
    expect(out.published).toBe(true);
    expect(out.published && out.summary.reconciliation).toEqual([]);
    expect(await h.rows('period = any($1)', [[m1, m2]])).toEqual(expectedRows(lines, num));
    expect((await h.rows('period = any($1)', [[m1, m2]])).every((r) => r.actual === null)).toBe(true);
    expect(await h.rows('period <> all($1)', [[m1, m2]])).toEqual(before.filter((r) => r.period !== m1 && r.period !== m2));
    expect(await asSuper(db, 'select * from ccp.periods order by period')).toEqual(periodsBefore); // no actuals -> no register entry
  });

  it('staging rejects actuals for a future month (DB clock) and budget-only files for published months', async () => {
    const cur = await h.currentPeriod();
    const future = await h.stage(fullPeriod(addMonths(cur, 1), () => '100'));
    expect(future.status).toBe('Rejected');
    expect(new Set(future.errors.map((e) => e.code))).toEqual(new Set(['FUTURE_ACTUAL']));
    expect((await h.batch(future.batchId)).status).toBe('Rejected');
    await expect(h.enterTb(future.batchId, {})).rejects.toThrow(/Upload is Rejected/);
    await expect(h.publish(future.batchId)).rejects.toThrow(/Upload is Rejected/);

    // The current month may carry actuals
    const now = await h.stage(fullPeriod(cur, () => '100'));
    expect(now.errors).toEqual([]);

    const wipe = await h.stage(fullPeriod('2026-09', null));
    expect(wipe.status).toBe('Rejected');
    expect(wipe.errors.map((e) => e.code)).toEqual(['WOULD_REMOVE_ACTUALS']);
    expect(wipe.summary.periods).toEqual([]);
  });

  it('a file with several periods needs a matching trial balance for each period with actuals', async () => {
    const cur = await h.currentPeriod();
    const aug = await reuploadOf(h, '2026-08', '10');
    const sep = await reuploadOf(h, '2026-09', '20');
    const budget = fullPeriod(addMonths(cur, 1), null);
    const lines = [...aug, ...sep, ...budget];
    const [tbAug, tbSep] = [total(aug.map((l) => l.Actual)), total(sep.map((l) => l.Actual))];

    const res = await h.stage(lines);
    expect(res.status).toBe('Validated');
    const r1 = await h.enterTb(res.batchId, { '2026-09': tbSep });
    expect(r1.reconciled).toBe(false);
    expect(r1.reconciliation.map((r) => [r.period, r.matched])).toEqual([['2026-08', false], ['2026-09', true]]);
    const blocked = await h.publish(res.batchId);
    expect(blocked.published).toBe(false);
    expect('error' in blocked && blocked.error).toMatch(/2026-08 has no trial balance entered/);
    expect('error' in blocked && blocked.error).not.toMatch(/2026-09/);

    expect((await h.enterTb(res.batchId, { '2026-08': tbAug })).reconciled).toBe(true);
    expect((await h.publish(res.batchId)).published).toBe(true);
    expect(await h.periodRow('2026-08')).toMatchObject({ actual_total: tbAug.toFixed(2), batch_id: res.batchId });
    expect(await h.periodRow('2026-09')).toMatchObject({ actual_total: tbSep.toFixed(2), batch_id: res.batchId });
    expect(await h.periodRow('2026-07')).toMatchObject({ batch_id: await h.seedBatchId() });
  });

  it('RECON_TOLERANCE allows a small difference; the default (0) does not', async () => {
    const lines = fullPeriod('2026-03', (i) => `${1000 + i}.10`);
    const tb = total(lines.map((l) => l.Actual));
    const offBy50p = (cents(tb.toFixed(2)) - 50) / 100;
    const res = await h.stage(lines);

    // Default: must be equal to the paisa
    const strict = await h.enterTb(res.batchId, { '2026-03': offBy50p });
    expect(strict).toMatchObject({ reconciled: false, reconciliation: [{ difference: 0.5, matched: false }] });
    expect((await h.publish(res.batchId)).published).toBe(false);

    for (const bad of ['-5', 'abc']) {
      process.env.RECON_TOLERANCE = bad; // invalid values fall back to 0
      expect((await h.enterTb(res.batchId, { '2026-03': offBy50p })).reconciled, bad).toBe(false);
    }

    process.env.RECON_TOLERANCE = '0.49';
    expect((await h.enterTb(res.batchId, { '2026-03': offBy50p })).reconciled).toBe(false);

    process.env.RECON_TOLERANCE = '1';
    const tolerant = await h.enterTb(res.batchId, { '2026-03': offBy50p });
    expect(tolerant).toMatchObject({ reconciled: true, reconciliation: [{ difference: 0.5, matched: true }] });
    expect((await h.enterTb(res.batchId, { '2026-03': tb - 1.01 })).reconciled).toBe(false);
    expect((await h.enterTb(res.batchId, { '2026-03': tb + 1 })).reconciled).toBe(true);
    expect((await h.enterTb(res.batchId, { '2026-03': offBy50p })).reconciled).toBe(true);
    const out = await h.publish(res.batchId);
    expect(out.published).toBe(true);
    // The register keeps both figures so the accepted difference stays visible
    expect(await h.periodRow('2026-03')).toMatchObject({ actual_total: tb.toFixed(2), tb_total: offBy50p.toFixed(2) });
  });

  it('UPLOAD_MAKER_CHECKER=false lets the preparer reconcile and publish alone', async () => {
    process.env.UPLOAD_MAKER_CHECKER = 'false';
    const lines = fullPeriod('2026-03', () => '1');
    const res = await h.stage(lines);
    expect((await h.enterTb(res.batchId, { '2026-03': lines.length })).reconciled).toBe(true);
    expect((await h.publish(res.batchId, KAVYA)).published).toBe(true);
    expect(await h.batch(res.batchId)).toMatchObject({ status: 'Published', uploaded_by: KAVYA, approved_by: KAVYA });

    // ...but reconciliation is still enforced
    const again = await h.stage(fullPeriod('2026-02', () => '1'));
    const out = await h.publish(again.batchId, KAVYA);
    expect(out.published).toBe(false);
  });

  it('non-Finance users cannot stage, reconcile, publish or discard, nor read trial balances', async () => {
    const lines = fullPeriod('2026-03', () => '5');
    for (const user of [MEENA, RAJESH, VIKRAM, ARUN]) {
      await expect(h.stage(lines, user), user).rejects.toThrow(/row-level security/);
    }
    const res = await h.stage(lines);
    await h.enterTb(res.batchId, { '2026-03': lines.length * 5 });
    for (const user of [MEENA, RAJESH]) {
      await expect(h.enterTb(res.batchId, { '2026-03': 1 }, user), user).rejects.toThrow(/not found/);
      await expect(h.publish(res.batchId, user), user).rejects.toThrow(/not found/);
      expect(await h.discard(res.batchId, user), user).toBe(false);
    }
    expect((await h.batch(res.batchId)).status).toBe('Validated');
    expect(await h.rows(`period = '2026-03'`)).toEqual([]);

    // Trial balances: Finance only
    const [{ n }] = await asSuper<{ n: number }>(db, 'select count(*)::int as n from ccp.trial_balances');
    expect(n).toBeGreaterThan(0);
    for (const user of [KAVYA, DEEPA]) expect(await as(db, user, 'select * from ccp.trial_balances'), user).toHaveLength(n);
    for (const user of [MEENA, RAJESH, VIKRAM, ARUN]) {
      expect(await as(db, user, 'select * from ccp.trial_balances'), user).toHaveLength(0);
      await expect(
        as(db, user, `insert into ccp.trial_balances (batch_id, period, tb_total, entered_by) values ($1, '2026-03', 1, $2)`, [res.batchId, user]),
        user,
      ).rejects.toThrow(/row-level security/);
      expect(await as(db, user, `update ccp.trial_balances set tb_total = 0 returning period`), user).toHaveLength(0);
    }
    // Finance cannot record a trial balance in someone else's name
    await expect(
      as(db, KAVYA, `insert into ccp.trial_balances (batch_id, period, tb_total, entered_by) values ($1, '2026-02', 1, $2)`, [res.batchId, DEEPA]),
    ).rejects.toThrow(/row-level security/);
    await expect(as(db, KAVYA, `delete from ccp.trial_balances`)).rejects.toThrow(/permission denied/);
  });

  it('ccp.periods is readable by Finance and Management only, and writable by Finance only', async () => {
    const [{ n }] = await asSuper<{ n: number }>(db, 'select count(*)::int as n from ccp.periods');
    expect(n).toBe(SEED_PERIODS.length);
    for (const user of [RAJESH, KAVYA, DEEPA]) expect(await as(db, user, 'select * from ccp.periods'), user).toHaveLength(n);
    for (const user of [MEENA, ARUN, VIKRAM]) expect(await as(db, user, 'select * from ccp.periods'), user).toHaveLength(0);

    for (const user of [RAJESH, MEENA]) {
      expect(await as(db, user, `update ccp.periods set actual_total = 0 returning period`), user).toHaveLength(0);
      await expect(
        as(db, user, `insert into ccp.periods (period, actual_total, tb_total, batch_id, published_by)
                      select '2026-03', 0, 0, batch_id, $1 from ccp.periods limit 1`, [user]),
        user,
      ).rejects.toThrow(/row-level security|null value/);
    }
    expect((await asSuper<{ n: number }>(db, 'select count(*)::int as n from ccp.periods where actual_total = 0'))[0].n).toBe(0);
  });

  it('a discarded batch cannot be reconciled or published', async () => {
    const lines = fullPeriod('2026-03', () => '7');
    const res = await h.stage(lines);
    await h.enterTb(res.batchId, { '2026-03': lines.length * 7 });
    expect(await h.discard(res.batchId, DEEPA)).toBe(true); // either Finance user may discard
    expect(await h.discard(res.batchId)).toBe(false);
    expect((await h.batch(res.batchId)).status).toBe('Discarded');
    await expect(h.publish(res.batchId)).rejects.toThrow(/Upload is Discarded/);
    await expect(h.enterTb(res.batchId, { '2026-03': 1 })).rejects.toThrow(/Upload is Discarded/);
    expect(await h.rows(`period = '2026-03'`)).toEqual([]);
    expect(await h.periodRow('2026-03')).toBeUndefined();
    expect((await h.pending(DEEPA)).map((b) => b.id)).not.toContain(res.batchId);
    const ev = (await h.events(res.batchId)).filter((e) => e.action === 'UPLOAD_DISCARDED');
    expect(ev).toEqual([expect.objectContaining({ user_email: DEEPA, batch_id: res.batchId })]);
  });

  it('publish re-validates against the current master: a CC closed after staging blocks the file', async () => {
    const lines = await reuploadOf(h, '2026-09');
    const res = await h.stage(lines);
    await h.enterTb(res.batchId, { '2026-09': total(lines.map((l) => l.Actual)) });
    const before = await h.rows();
    // Meanwhile IN-ENG-103 is closed at the end of August
    await as(db, KAVYA, `update ccp.cost_centres set status = 'Inactive', close_date = '2026-08-31' where cc_code = 'IN-ENG-103'`);

    const out = await h.publish(res.batchId);
    expect(out.published).toBe(false);
    expect(new Set(out.errors.map((e) => e.code))).toEqual(new Set(['CC_CLOSED']));
    expect(out.errors).toHaveLength(GL_GROUPS.length);
    expect(await h.rows()).toEqual(before);
    expect((await h.batch(res.batchId)).status).toBe('Rejected');
    expect((await h.events(res.batchId)).map((e) => e.action)).toContain('UPLOAD_REJECTED');
    await expect(h.publish(res.batchId)).rejects.toThrow(/Upload is Rejected/);
  });

  it('the uploader is recorded from the database identity, so letter case cannot defeat maker-checker', async () => {
    const lines = fullPeriod('2026-03', () => '3');
    const res = await withUserOn(db, KAVYA, (tx) => stageUpload(tx, KAVYA.toUpperCase(), 'financials', 'f.csv', finCsv(lines)));
    expect((await h.batch(res.batchId)).uploaded_by).toBe(KAVYA);
    expect((await h.enterTb(res.batchId, { '2026-03': lines.length * 3 }, KAVYA.toUpperCase())).reconciled).toBe(true);
    await expect(h.publish(res.batchId, KAVYA)).rejects.toThrow(/Segregation of duties/);
    await expect(h.publish(res.batchId, ` ${KAVYA.toUpperCase()} `)).rejects.toThrow(/Segregation of duties/);
    expect((await h.publish(res.batchId, DEEPA)).published).toBe(true);
  });
});
