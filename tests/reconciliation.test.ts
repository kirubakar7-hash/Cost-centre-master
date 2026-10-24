/**
 * Budget & Actuals publishing (PGlite, through RLS):
 * stage -> preparer enters the trial balance for each period AND legal entity ->
 * reconciliation -> a different Finance user approves and publishes (maker-checker).
 * Publishing replaces every line of every period in the file, records one period
 * register row per (period, entity) and keeps line-level history of every change.
 *
 * Seed: 10 active cost centres — 7 IN (INR) and 3 US (USD: US-ENG-201, US-SSV-401,
 * US-SAL-601); actuals 2026-04..09, budget-only 2026-10..2027-03.
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
type Entity = 'IN' | 'US';

const IN_ACTIVE = ['IN-ENG-101', 'IN-ENG-102', 'IN-ENG-103', 'IN-SSV-301', 'IN-SSV-302', 'IN-SSV-303', 'IN-SAL-501'];
const US_ACTIVE = ['US-ENG-201', 'US-SSV-401', 'US-SAL-601'];
const ACTIVE = [...IN_ACTIVE, ...US_ACTIVE];
/** The code prefix is the legal entity (enforced by the master-data rules). */
const entityOf = (cc: string) => cc.slice(0, 2) as Entity;

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const finCsv = (rows: Line[]) =>
  Buffer.from([FIN_HEADERS.join(','), ...rows.map((r) => FIN_HEADERS.map((h) => csvCell(r[h as keyof Line] ?? '')).join(','))].join('\r\n') + '\r\n');

/** Exact cents arithmetic for expected totals (no float drift). */
const cents = (s: string) => Math.round(Number(s.replace(/,/g, '')) * 100);
const total = (values: string[]) => values.reduce((a, v) => a + cents(v), 0) / 100;
/** File total of one column for one entity (optionally one period). */
const entityTotal = (lines: Line[], entity: Entity, col: 'Actual' | 'Budget', period?: string) =>
  total(lines.filter((l) => entityOf(l.CC_Code) === entity && (!period || l.Period === period)).map((l) => l[col]));
const tbKey = (period: string, entity: string) => `${period}|${entity}`;

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

/** One sort order for expected and actual rows (independent of the database collation). */
const byKey = (a: FinRow, b: FinRow) =>
  a.period < b.period ? -1 : a.period > b.period ? 1
    : a.cc_code < b.cc_code ? -1 : a.cc_code > b.cc_code ? 1
      : a.gl_group < b.gl_group ? -1 : a.gl_group > b.gl_group ? 1 : 0;

type RegisterRow = { entity: string; actual_total: string; tb_total: string; batch_id: string; published_by: string };
type HistoryRow = {
  cc_code: string; period: string; gl_group: string; change: string; changed_by: string; batch_id: string;
  old_budget: string | null; old_actual: string | null; new_budget: string | null; new_actual: string | null;
};

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
        db(), `select cc_code, period, gl_group, budget, actual from ccp.financials where ${where}`, params,
      )).map((r) => ({ ...r, budget: Number(r.budget), actual: r.actual === null ? null : Number(r.actual) })).sort(byKey),
    batch: async (id: string) =>
      (await asSuper<{ kind: string; status: string; uploaded_by: string; approved_by: string | null; published_by: string | null; published_at: string | null }>(
        db(), 'select kind, status, uploaded_by, approved_by, published_by, published_at from ccp.upload_batches where id = $1', [id],
      ))[0],
    /** Period register rows for one period, one per entity (sorted). */
    register: (period: string) =>
      asSuper<RegisterRow>(
        db(), 'select entity, actual_total, tb_total, batch_id, published_by from ccp.periods where period = $1 order by entity', [period],
      ),
    trialBalances: (batchId: string) =>
      asSuper<{ period: string; entity: string; tb_total: string; entered_by: string }>(
        db(), 'select period, entity, tb_total, entered_by from ccp.trial_balances where batch_id = $1 order by period, entity', [batchId],
      ),
    history: async (batchId: string) =>
      (await asSuper<HistoryRow>(
        db(),
        `select cc_code, period, gl_group, change, changed_by, batch_id, old_budget, old_actual, new_budget, new_actual
           from ccp.financials_history where batch_id = $1`, [batchId],
      )).sort((a, b) => byKey(a as unknown as FinRow, b as unknown as FinRow)),
    events: (batchId: string) =>
      asSuper<{ action: string; user_email: string; batch_id: string | null; new_value: Record<string, unknown> | null }>(
        db(), `select action, user_email, batch_id, new_value from ccp.audit_log where entity = 'upload_batch' and entity_id = $1 order by id`, [batchId],
      ),
    seedBatchId: async () =>
      (await asSuper<{ id: string }>(db(), `select id from ccp.upload_batches where file_name = 'seed-data'`))[0].id,
    currentPeriod: async () => (await asSuper<{ p: string }>(db(), `select to_char(now(), 'YYYY-MM') as p`))[0].p,
    /** A legacy (pre-Phase-3) combined register row, as migration 005 leaves them. */
    addLegacyRow: async (period: string) =>
      asSuper(db(), `insert into ccp.periods (period, entity, actual_total, tb_total, batch_id, published_by)
                     select $1, 'ALL', 1, 1, id, 'legacy@system' from ccp.upload_batches where file_name = 'seed-data'`, [period]),
  };
}
type Harness = ReturnType<typeof harness>;

type PublishResult = Awaited<ReturnType<typeof publishUpload>>;
/** Narrow a publish result that must have been refused (fails the test otherwise). */
function refused(out: PublishResult) {
  if (out.published) throw new Error('expected publishing to be refused');
  return out as Extract<PublishResult, { published: false }> & { error?: string; reconciliation?: unknown };
}

/** File lines -> the rows publishing should leave in ccp.financials (normalised, sorted like rows()). */
function expectedRows(lines: Line[], normalise: (l: Line) => FinRow): FinRow[] {
  return lines.map(normalise).sort(byKey);
}
const num = (l: Line): FinRow => ({
  cc_code: l.CC_Code, period: l.Period, gl_group: l.GL_Group, budget: cents(l.Budget) / 100, actual: l.Actual === '' ? null : cents(l.Actual) / 100,
});

/** Seed rows of one published period as a re-upload file, with every actual changed by `bump`. */
async function reuploadOf(h: Harness, period: string, bump = '1000.25'): Promise<Line[]> {
  const rows = await h.rows('period = $1', [period]);
  expect(rows.length).toBeGreaterThan(0);
  return rows.map((r) => ({
    CC_Code: r.cc_code, Period: r.period, GL_Group: r.gl_group, Budget: r.budget.toFixed(2),
    Actual: ((cents(String(r.actual)) + cents(bump)) / 100).toFixed(2),
  }));
}

/** Correct trial balances for every (period, entity) with actuals in the file. */
function correctTbs(lines: Line[]): Record<string, number> {
  const paise: Record<string, number> = {};
  for (const l of lines.filter((x) => x.Actual !== '')) {
    const k = tbKey(l.Period, entityOf(l.CC_Code));
    paise[k] = (paise[k] ?? 0) + cents(l.Actual);
  }
  return Object.fromEntries(Object.entries(paise).map(([k, v]) => [k, v / 100]));
}

/** One line per given CC and GL group for a period. */
const fullPeriod = (period: string, actual: ((i: number) => string) | null, budget = (i: number) => String(10000 + i * 100), ccs = ACTIVE): Line[] =>
  ccs.flatMap((cc, c) => GL_GROUPS.map((gl, g) => {
    const i = c * GL_GROUPS.length + g;
    return { CC_Code: cc, Period: period, GL_Group: gl, Budget: budget(i), Actual: actual ? actual(i) : '' };
  }));

// ---------------------------------------------------------------------------
// The full maker-checker story, step by step on one database
// ---------------------------------------------------------------------------
describe('financials publish: per-entity reconciliation, maker-checker and line history (September re-upload)', () => {
  let db: Driver;
  const h = harness(() => db);
  let lines: Line[];
  let tbIN: number;
  let tbUS: number;
  let batchId: string;
  let seedId: string;
  let before: FinRow[]; // every financial line before the upload
  const SEPT = '2026-09';
  const IN = tbKey(SEPT, 'IN');
  const US = tbKey(SEPT, 'US');

  beforeAll(async () => {
    saveEnv();
    db = await freshDb();
    // Corrected September file: every actual changed, one line dropped, one new GL line
    // (written as Sep-2026 / 45,000.50 to prove values are normalised before storing).
    lines = (await reuploadOf(h, SEPT)).filter((l) => !(l.CC_Code === 'IN-ENG-101' && l.GL_Group === 'Office & Admin'));
    lines.push({ CC_Code: 'IN-ENG-101', Period: 'Sep-2026', GL_Group: 'Recruitment', Budget: '0', Actual: '45,000.50' });
    tbIN = entityTotal(lines, 'IN', 'Actual');
    tbUS = entityTotal(lines, 'US', 'Actual');
    before = await h.rows();
    seedId = await h.seedBatchId();
    // Pre-Phase-3 combined register rows for September (to be replaced) and August (untouched)
    await h.addLegacyRow(SEPT);
    await h.addLegacyRow('2026-08');
  });
  afterAll(async () => {
    restoreEnv();
    await db.close();
  });

  const unchanged = async () => expect(await h.rows()).toEqual(before);
  const normalise = (l: Line): FinRow => ({ ...num(l), period: SEPT });
  const reconLine = (entity: Entity, actualTotal: number, tbTotal: number | null, matched: boolean, difference: number | null = tbTotal === null ? null : 0) => ({
    period: SEPT, entity, currency: entity === 'IN' ? 'INR' : 'USD', actualTotal, tbTotal, difference, matched,
  });

  it('KAVYA stages the file: Validated, summarised per period and entity, nothing written to financials', async () => {
    const res = await h.stage(lines);
    batchId = res.batchId;
    expect(res.errors).toEqual([]);
    expect(res.status).toBe('Validated');
    expect(res.warnings.map((w) => [w.code, w.row])).toEqual([['NEW_GL_GROUP', lines.length + 1]]);
    expect(res.summary.periods).toEqual([
      { period: SEPT, entity: 'IN', currency: 'INR', rows: 42, costCentres: 7, budgetTotal: entityTotal(lines, 'IN', 'Budget'), actualTotal: tbIN },
      { period: SEPT, entity: 'US', currency: 'USD', rows: 18, costCentres: 3, budgetTotal: entityTotal(lines, 'US', 'Budget'), actualTotal: tbUS },
    ]);
    expect(await h.batch(batchId)).toMatchObject({ kind: 'financials', status: 'Validated', uploaded_by: KAVYA, approved_by: null });
    await unchanged();

    // It waits for approval (Finance only)
    expect((await h.pending(DEEPA)).map((b) => b.id)).toContain(batchId);
    expect(await h.pending(MEENA)).toEqual([]);
    expect(await h.pending(RAJESH)).toEqual([]);
  });

  it('publishing before any trial balance is entered is blocked for each entity and logged (RECON_FAILED)', async () => {
    const out = refused(await h.publish(batchId));
    expect(out.errors).toEqual([]);
    expect(out.error).toMatch(/2026-09 IN has no trial balance entered; 2026-09 US has no trial balance entered/);
    expect(out.reconciliation).toEqual([reconLine('IN', tbIN, null, false), reconLine('US', tbUS, null, false)]);
    await unchanged();
    expect((await h.batch(batchId)).status).toBe('Validated'); // not rejected: fix the TB and try again
    expect((await h.register(SEPT)).map((r) => [r.entity, r.batch_id])).toEqual([['ALL', seedId], ['IN', seedId], ['US', seedId]]);

    const failed = (await h.events(batchId)).filter((e) => e.action === 'RECON_FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ user_email: DEEPA, batch_id: batchId, new_value: { stage: 'publish' } });
  });

  it('a bare period key is refused when that period has actuals for two entities', async () => {
    await expect(h.enterTb(batchId, { [SEPT]: tbIN })).rejects.toThrow(/2026-09 has actuals for several entities \(IN, US\)/);
    expect(await h.trialBalances(batchId)).toEqual([]);
  });

  it('a correct IN trial balance with a wrong US one fails reconciliation for US only; publishing stays blocked', async () => {
    const wrongUS = (cents(tbUS.toFixed(2)) - 123456) / 100; // 1,234.56 short
    const r = await h.enterTb(batchId, { [IN]: tbIN, [US]: wrongUS });
    expect(r).toEqual({ reconciled: false, reconciliation: [reconLine('IN', tbIN, tbIN, true), reconLine('US', tbUS, wrongUS, false, 1234.56)] });
    expect(await h.trialBalances(batchId)).toEqual([
      { period: SEPT, entity: 'IN', tb_total: tbIN.toFixed(2), entered_by: KAVYA },
      { period: SEPT, entity: 'US', tb_total: wrongUS.toFixed(2), entered_by: KAVYA },
    ]);

    const out = refused(await h.publish(batchId));
    expect(out.errors).toEqual([]);
    expect(out.error).toMatch(/2026-09 US differs from the trial balance by 1234\.56/);
    expect(out.error).not.toMatch(/2026-09 IN/);
    await unchanged();

    const ev = await h.events(batchId);
    expect(ev.filter((e) => e.action === 'TB_ENTERED')).toEqual([
      { action: 'TB_ENTERED', user_email: KAVYA, batch_id: batchId, new_value: { totals: { [IN]: tbIN, [US]: wrongUS } } },
    ]);
    expect(ev.filter((e) => e.action === 'RECON_FAILED').map((e) => e.user_email)).toEqual([DEEPA, KAVYA, DEEPA]);
    expect(ev.filter((e) => e.action === 'RECON_PASSED')).toEqual([]);

    // A trial balance above the file total gives a negative difference; IN stays as entered
    const over = await h.enterTb(batchId, { [US]: (cents(tbUS.toFixed(2)) + 50) / 100 });
    expect(over.reconciliation).toEqual([reconLine('IN', tbIN, tbIN, true), expect.objectContaining({ entity: 'US', difference: -0.5, matched: false })]);
  });

  it('only the preparer can enter trial balances, only for periods and entities with actuals in the file', async () => {
    await expect(h.enterTb(batchId, { [US]: tbUS }, DEEPA)).rejects.toThrow(/Only the preparer/);
    await expect(h.enterTb(batchId, { '2026-08|IN': tbIN })).rejects.toThrow(/2026-08 IN has no actuals in this upload/);
    await expect(h.enterTb(batchId, { '2026-08': tbIN })).rejects.toThrow(/Period 2026-08 has no actuals in this upload/);
    await expect(h.enterTb(batchId, { '2026-09|UK': 1 })).rejects.toThrow(/2026-09 UK has no actuals in this upload/);
    await expect(h.enterTb(batchId, { [US]: Number.NaN })).rejects.toThrow(/Trial balance for 2026-09 US must be a number/);
    await expect(h.enterTb(batchId, { [US]: Number.POSITIVE_INFINITY })).rejects.toThrow(/must be a number/);
    await expect(h.enterTb(batchId, { [IN]: 1e17 })).rejects.toThrow(/Trial balance for 2026-09 IN is too large/); // not a raw numeric overflow
    for (const user of [MEENA, RAJESH, ARUN]) await expect(h.enterTb(batchId, { [US]: tbUS }, user), user).rejects.toThrow(/not found/);
    // None of that changed the stored trial balances
    expect((await h.trialBalances(batchId)).map((t) => [t.entity, t.entered_by])).toEqual([['IN', KAVYA], ['US', KAVYA]]);
  });

  it('the correct US trial balance reconciles both entities; the preparer still cannot publish her own upload', async () => {
    const r = await h.enterTb(batchId, { '2026-09|us': tbUS }); // entity key is case-insensitive
    expect(r).toEqual({ reconciled: true, reconciliation: [reconLine('IN', tbIN, tbIN, true), reconLine('US', tbUS, tbUS, true)] });
    const pending = (await h.pending(DEEPA)).find((b) => b.id === batchId)!;
    expect(pending.summary).toMatchObject({ reconciled: true, reconciliation: r.reconciliation });

    await expect(h.publish(batchId, KAVYA)).rejects.toThrow(/Segregation of duties/);
    await unchanged();
    expect(await h.batch(batchId)).toMatchObject({ status: 'Validated', published_by: null, approved_by: null });
  });

  it('DEEPA publishes: September is replaced by the file exactly, other periods are untouched', async () => {
    const out = await h.publish(batchId);
    expect(out).toMatchObject({ published: true });
    const sum = (rows: FinRow[], e: Entity, k: 'budget' | 'actual') =>
      (rows.filter((r) => r.period === SEPT && entityOf(r.cc_code) === e).reduce((a, r) => a + Math.round((r[k] ?? 0) * 100), 0) / 100).toFixed(2);
    expect(out.published && out.summary).toMatchObject({
      created: 60,
      changedLines: 61, // 59 changed + 1 removed + 1 added
      periods: [
        { period: SEPT, entity: 'IN', rows: 42, costCentres: 7, actualTotal: tbIN },
        { period: SEPT, entity: 'US', rows: 18, costCentres: 3, actualTotal: tbUS },
      ],
      reconciliation: [reconLine('IN', tbIN, tbIN, true), reconLine('US', tbUS, tbUS, true)],
      before: [
        { period: SEPT, entity: 'IN', budget: sum(before, 'IN', 'budget'), actual: sum(before, 'IN', 'actual') },
        { period: SEPT, entity: 'US', budget: sum(before, 'US', 'budget'), actual: sum(before, 'US', 'actual') },
      ],
    });

    // September now equals the file — the dropped line is gone, the new GL line is there
    const sept = await h.rows('period = $1', [SEPT]);
    expect(sept).toEqual(expectedRows(lines, normalise));
    expect(sept.find((r) => r.cc_code === 'IN-ENG-101' && r.gl_group === 'Office & Admin')).toBeUndefined();
    expect(sept.find((r) => r.gl_group === 'Recruitment')).toEqual({ cc_code: 'IN-ENG-101', period: SEPT, gl_group: 'Recruitment', budget: 0, actual: 45000.5 });
    // Every other period is untouched
    expect(await h.rows('period <> $1', [SEPT])).toEqual(before.filter((r) => r.period !== SEPT));

    // Period register: one row per entity, reconciled to that entity's TB; the legacy combined row is gone
    expect(await h.register(SEPT)).toEqual([
      { entity: 'IN', actual_total: tbIN.toFixed(2), tb_total: tbIN.toFixed(2), batch_id: batchId, published_by: DEEPA },
      { entity: 'US', actual_total: tbUS.toFixed(2), tb_total: tbUS.toFixed(2), batch_id: batchId, published_by: DEEPA },
    ]);
    expect((await h.register('2026-08')).map((r) => [r.entity, r.batch_id])).toEqual([['ALL', seedId], ['IN', seedId], ['US', seedId]]);
    for (const p of SEED_PERIODS.filter((x) => x !== SEPT)) {
      expect((await h.register(p)).filter((r) => r.entity !== 'ALL').map((r) => [r.entity, r.batch_id]), p).toEqual([['IN', seedId], ['US', seedId]]);
    }

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

  it('line history: every changed, added and removed line, with old and new values and the batch id', async () => {
    const hist = await h.history(batchId);
    expect(hist).toHaveLength(61);
    expect(hist.every((r) => r.batch_id === batchId && r.changed_by === DEEPA && r.period === SEPT)).toBe(true);
    const old = new Map(before.filter((r) => r.period === SEPT).map((r) => [`${r.cc_code}|${r.gl_group}`, r]));
    const n = (v: string | null) => (v === null ? null : Number(v));

    const changed = hist.filter((r) => r.change === 'changed');
    expect(changed).toHaveLength(59);
    for (const r of changed) {
      const o = old.get(`${r.cc_code}|${r.gl_group}`)!;
      expect([n(r.old_budget), n(r.old_actual), n(r.new_budget)], r.cc_code + r.gl_group).toEqual([o.budget, o.actual, o.budget]);
      expect(Math.round(n(r.new_actual)! * 100) - Math.round(o.actual! * 100)).toBe(100025); // +1,000.25
    }
    const removed = old.get('IN-ENG-101|Office & Admin')!;
    expect(hist.filter((r) => r.change === 'removed')).toEqual([{
      cc_code: 'IN-ENG-101', period: SEPT, gl_group: 'Office & Admin', change: 'removed', changed_by: DEEPA, batch_id: batchId,
      old_budget: removed.budget.toFixed(2), old_actual: removed.actual!.toFixed(2), new_budget: null, new_actual: null,
    }]);
    expect(hist.filter((r) => r.change === 'added')).toEqual([{
      cc_code: 'IN-ENG-101', period: SEPT, gl_group: 'Recruitment', change: 'added', changed_by: DEEPA, batch_id: batchId,
      old_budget: null, old_actual: null, new_budget: '0.00', new_actual: '45000.50',
    }]);
    // Nothing for other periods, and no other batch wrote history
    expect(await asSuper(db, 'select count(*)::int as n from ccp.financials_history where batch_id <> $1', [batchId])).toEqual([{ n: 0 }]);
  });

  it('a published batch is final: no re-publish, no new trial balance, no discard', async () => {
    await expect(h.publish(batchId)).rejects.toThrow(/Upload is Published/);
    await expect(h.enterTb(batchId, { [IN]: 1 })).rejects.toThrow(/Upload is Published/);
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

  it('a budget correction for one cost centre is refused instead of wiping the others for that month', async () => {
    const before = await h.rows();
    // 2027-01 is budget-only in the seed, for all 10 active cost centres
    const lines = GL_GROUPS.map((gl) => ({ CC_Code: 'IN-ENG-101', Period: '2027-01', GL_Group: gl, Budget: '500000', Actual: '' }));
    const res = await h.stage(lines);
    expect(res.status).toBe('Rejected');
    expect(res.errors.map((e) => e.code)).toEqual(['INCOMPLETE_PERIOD']);
    expect(res.errors[0].message).toMatch(/2027-01 \(IN\) already has figures for 6 cost centre/);
    expect(await h.rows()).toEqual(before);

    // The full month (every active cost centre) is accepted and publishes without a TB
    const full = fullPeriod('2027-01', null);
    const ok = await h.stage(full);
    expect(ok.status).toBe('Validated');
    expect((await h.publish(ok.batchId)).published).toBe(true);
    expect(await h.rows(`period = '2027-01'`)).toEqual(expectedRows(full, num));
  });

  it('a single-entity file accepts a bare period key and registers only that entity', async () => {
    const lines = fullPeriod('2026-03', (i) => `${9000 + i}.25`, undefined, IN_ACTIVE);
    const tb = entityTotal(lines, 'IN', 'Actual');
    const res = await h.stage(lines);
    expect(res.status).toBe('Validated');
    expect(res.summary.periods).toEqual([
      { period: '2026-03', entity: 'IN', currency: 'INR', rows: 42, costCentres: 7, budgetTotal: entityTotal(lines, 'IN', 'Budget'), actualTotal: tb },
    ]);
    expect(await h.enterTb(res.batchId, { '2026-03': tb })).toMatchObject({ reconciled: true, reconciliation: [{ entity: 'IN', currency: 'INR', matched: true }] });
    expect((await h.trialBalances(res.batchId)).map((t) => [t.period, t.entity])).toEqual([['2026-03', 'IN']]);
    expect((await h.publish(res.batchId)).published).toBe(true);
    expect(await h.register('2026-03')).toEqual([
      { entity: 'IN', actual_total: tb.toFixed(2), tb_total: tb.toFixed(2), batch_id: res.batchId, published_by: DEEPA },
    ]);
  });

  it('entities close independently: a US-only file replaces US September and leaves India untouched', async () => {
    const US_CCS = ['US-ENG-201', 'US-SSV-401', 'US-SAL-601'];
    const inBefore = await h.rows(`period = '2026-09' and cc_code like 'IN-%'`);
    const inRegister = await asSuper(db, `select * from ccp.periods where period = '2026-09' and entity = 'IN'`);
    const lines = fullPeriod('2026-09', (i) => `${5000 + i}.25`).filter((l) => US_CCS.includes(l.CC_Code));
    const res = await h.stage(lines);
    expect(res.status).toBe('Validated');
    expect(res.summary.periods?.map((p) => `${p.period}|${p.entity}`)).toEqual(['2026-09|US']);
    // Only the US trial balance is needed (a bare period key works: one entity in the file)
    expect((await h.enterTb(res.batchId, { '2026-09': total(lines.map((l) => l.Actual)) })).reconciled).toBe(true);
    expect((await h.publish(res.batchId)).published).toBe(true);
    expect(await h.rows(`period = '2026-09' and cc_code like 'US-%'`)).toEqual(expectedRows(lines, num));
    expect(await h.rows(`period = '2026-09' and cc_code like 'IN-%'`)).toEqual(inBefore);
    expect(await asSuper(db, `select * from ccp.periods where period = '2026-09' and entity = 'IN'`)).toEqual(inRegister);
    // A US file that leaves out a US cost centre is still refused
    const partial = await h.stage(lines.filter((l) => l.CC_Code !== 'US-SAL-601'));
    expect(partial.errors.map((e) => e.code)).toEqual(['INCOMPLETE_PERIOD']);
    expect(partial.errors[0].message).toMatch(/2026-09 \(US\).*US-SAL-601/);
  });

  it('a new past period (2026-03, FY 2025-26) with both entities needs both TBs and gets two register rows', async () => {
    const lines = fullPeriod('2026-03', (i) => `${9000 + i}.${String(i % 100).padStart(2, '0')}`);
    const tbs = correctTbs(lines);
    expect(Object.keys(tbs).sort()).toEqual(['2026-03|IN', '2026-03|US']);
    const before = await h.rows();

    const res = await h.stage(lines);
    expect(res.status).toBe('Validated');
    // Only one entity's TB: not reconciled
    expect((await h.enterTb(res.batchId, { '2026-03|IN': tbs['2026-03|IN'] })).reconciled).toBe(false);
    expect(refused(await h.publish(res.batchId)).error).toMatch(/2026-03 US has no trial balance entered/);
    expect((await h.enterTb(res.batchId, { '2026-03|US': tbs['2026-03|US'] })).reconciled).toBe(true);
    expect((await h.publish(res.batchId)).published).toBe(true);

    expect(await h.rows(`period = '2026-03'`)).toEqual(expectedRows(lines, num));
    expect(await h.rows(`period <> '2026-03'`)).toEqual(before);
    expect(await h.register('2026-03')).toEqual([
      { entity: 'IN', actual_total: tbs['2026-03|IN'].toFixed(2), tb_total: tbs['2026-03|IN'].toFixed(2), batch_id: res.batchId, published_by: DEEPA },
      { entity: 'US', actual_total: tbs['2026-03|US'].toFixed(2), tb_total: tbs['2026-03|US'].toFixed(2), batch_id: res.batchId, published_by: DEEPA },
    ]);
    // A brand-new month: every line is recorded as added
    const hist = await h.history(res.batchId);
    expect(hist).toHaveLength(lines.length);
    expect(hist.every((r) => r.change === 'added' && r.old_budget === null && r.old_actual === null)).toBe(true);

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

  it('line history records exactly the lines that changed; an identical re-upload records nothing', async () => {
    const seedSept = await h.rows(`period = '2026-09'`);
    const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2 }); // "1,23,456.00" — still the same number
    const lines: Line[] = seedSept
      .filter((r) => !(r.cc_code === 'US-SAL-601' && r.gl_group === 'Office & Admin')) // removed
      .map((r) => ({ CC_Code: r.cc_code, Period: r.period, GL_Group: r.gl_group, Budget: fmt(r.budget), Actual: fmt(r.actual!) }));
    const edit = (cc: string, gl: string, over: Partial<Line>) => Object.assign(lines.find((l) => l.CC_Code === cc && l.GL_Group === gl)!, over);
    const o = (cc: string, gl: string) => seedSept.find((r) => r.cc_code === cc && r.gl_group === gl)!;
    edit('IN-ENG-102', 'Employee Costs', { Actual: (o('IN-ENG-102', 'Employee Costs').actual! + 500).toFixed(2) }); // actual only
    edit('US-ENG-201', 'Travel & Conveyance', { Budget: (o('US-ENG-201', 'Travel & Conveyance').budget + 100).toFixed(2) }); // budget only
    edit('IN-SAL-501', 'Office & Admin', { Budget: '1.00', Actual: '2.00' }); // both
    lines.push({ CC_Code: 'IN-SSV-301', Period: '2026-09', GL_Group: 'Recruitment', Budget: '0', Actual: '1,234.56' }); // added

    const res = await h.stage(lines);
    expect(res.status).toBe('Validated');
    await h.enterTb(res.batchId, correctTbs(lines));
    const out = await h.publish(res.batchId);
    expect(out).toMatchObject({ published: true, summary: { changedLines: 5 } });

    const s = (n: number | null) => (n === null ? null : n.toFixed(2));
    const line = (cc: string, gl: string, change: string, oldB: number | null, oldA: number | null, newB: number | null, newA: number | null): HistoryRow => ({
      cc_code: cc, period: '2026-09', gl_group: gl, change, changed_by: DEEPA, batch_id: res.batchId,
      old_budget: s(oldB), old_actual: s(oldA), new_budget: s(newB), new_actual: s(newA),
    });
    const r102 = o('IN-ENG-102', 'Employee Costs');
    const r201 = o('US-ENG-201', 'Travel & Conveyance');
    const r501 = o('IN-SAL-501', 'Office & Admin');
    const r601 = o('US-SAL-601', 'Office & Admin');
    expect(await h.history(res.batchId)).toEqual([
      line('IN-ENG-102', 'Employee Costs', 'changed', r102.budget, r102.actual, r102.budget, r102.actual! + 500),
      line('IN-SAL-501', 'Office & Admin', 'changed', r501.budget, r501.actual, 1, 2),
      line('IN-SSV-301', 'Recruitment', 'added', null, null, 0, 1234.56),
      line('US-ENG-201', 'Travel & Conveyance', 'changed', r201.budget, r201.actual, r201.budget + 100, r201.actual),
      line('US-SAL-601', 'Office & Admin', 'removed', r601.budget, r601.actual, null, null),
    ]);

    // Uploading the now-current figures again changes nothing and records nothing
    const again = await h.stage(lines);
    expect(again.status).toBe('Validated');
    await h.enterTb(again.batchId, correctTbs(lines));
    expect(await h.publish(again.batchId)).toMatchObject({ published: true, summary: { changedLines: 0 } });
    expect(await h.history(again.batchId)).toEqual([]);
  });

  it('financials_history is readable by Finance only and is append-only for everyone', async () => {
    const lines = await reuploadOf(h, '2026-09', '1');
    const res = await h.stage(lines);
    await h.enterTb(res.batchId, correctTbs(lines));
    expect((await h.publish(res.batchId)).published).toBe(true);
    const [{ n }] = await asSuper<{ n: number }>(db, 'select count(*)::int as n from ccp.financials_history');
    expect(n).toBe(60);

    for (const user of [KAVYA, DEEPA]) expect(await as(db, user, 'select * from ccp.financials_history'), user).toHaveLength(n);
    for (const user of [RAJESH, VIKRAM, MEENA, ARUN]) {
      expect(await as(db, user, 'select * from ccp.financials_history'), user).toHaveLength(0); // not even Management
      expect(await as(db, user, `select * from ccp.financials_history where cc_code = 'IN-ENG-101'`), user).toHaveLength(0);
    }

    const insert = (user: string, changedBy: string) =>
      as(db, user, `insert into ccp.financials_history (batch_id, cc_code, period, gl_group, new_budget, new_actual, change, changed_by)
                    values ($1, 'IN-ENG-101', '2026-09', 'Employee Costs', 1, 1, 'added', $2)`, [res.batchId, changedBy]);
    await expect(insert(MEENA, MEENA)).rejects.toThrow(/row-level security/);
    await expect(insert(RAJESH, RAJESH)).rejects.toThrow(/row-level security/);
    await expect(insert(KAVYA, DEEPA)).rejects.toThrow(/row-level security/); // Finance cannot write in someone else's name

    for (const user of [KAVYA, DEEPA, RAJESH]) {
      await expect(as(db, user, `update ccp.financials_history set new_actual = 0`), user).rejects.toThrow(/permission denied/);
      await expect(as(db, user, `delete from ccp.financials_history`), user).rejects.toThrow(/permission denied/);
      await expect(as(db, user, `truncate ccp.financials_history`), user).rejects.toThrow(/permission denied/);
    }
    // Not even the privileged connection can rewrite it
    await expect(asSuper(db, `update ccp.financials_history set new_actual = 0`)).rejects.toThrow(/append-only/);
    await expect(asSuper(db, `delete from ccp.financials_history`)).rejects.toThrow(/append-only/);
    await expect(asSuper(db, `truncate ccp.financials_history`)).rejects.toThrow(/append-only/);
    expect((await asSuper<{ n: number }>(db, 'select count(*)::int as n from ccp.financials_history'))[0].n).toBe(n);
  });

  it('a budget-only upload for future months needs no trial balance and publishes', async () => {
    const cur = await h.currentPeriod();
    const [m1, m2] = [addMonths(cur, 1), addMonths(cur, 2)];
    const lines = [...fullPeriod(m1, null), ...fullPeriod(m2, null, (i) => `${20000 + i}`)];
    const periodsBefore = await asSuper(db, 'select * from ccp.periods order by period, entity');
    const before = await h.rows();

    const res = await h.stage(lines);
    expect(res.errors).toEqual([]);
    expect(res.status).toBe('Validated');
    expect(res.summary.periods!.map((p) => [p.period, p.entity, p.actualTotal])).toEqual([[m1, 'IN', null], [m1, 'US', null], [m2, 'IN', null], [m2, 'US', null]]);
    await expect(h.enterTb(res.batchId, { [m1]: 0 })).rejects.toThrow(/has no actuals in this upload/);
    await expect(h.enterTb(res.batchId, { [tbKey(m1, 'IN')]: 0 })).rejects.toThrow(/has no actuals in this upload/);
    await expect(h.publish(res.batchId, KAVYA)).rejects.toThrow(/Segregation of duties/); // maker-checker applies to budgets too

    const out = await h.publish(res.batchId);
    expect(out).toMatchObject({ published: true, summary: { reconciliation: [] } });
    expect(await h.rows('period = any($1)', [[m1, m2]])).toEqual(expectedRows(lines, num));
    expect((await h.rows('period = any($1)', [[m1, m2]])).every((r) => r.actual === null)).toBe(true);
    expect(await h.rows('period <> all($1)', [[m1, m2]])).toEqual(before.filter((r) => r.period !== m1 && r.period !== m2));
    expect(await asSuper(db, 'select * from ccp.periods order by period, entity')).toEqual(periodsBefore); // no actuals -> no register entry
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
    // One error per entity whose published actuals the file would remove
    expect(wipe.errors.map((e) => e.code)).toEqual(['WOULD_REMOVE_ACTUALS', 'WOULD_REMOVE_ACTUALS']);
    expect(wipe.errors.map((e) => e.message).join(' ')).toMatch(/2026-09 \(IN\).*2026-09 \(US\)/);
    expect(wipe.summary.periods).toEqual([]);
  });

  it('the budget-only guard also protects actuals that are not in the period register', async () => {
    // A database seeded before Phase 2 has actuals in ccp.financials but an empty ccp.periods
    // (migration 003 does not backfill the register, and the demo bootstrap only seeds empty DBs).
    await asSuper(db, 'delete from ccp.periods');
    const wipe = await h.stage(fullPeriod('2026-08', null));
    expect(wipe.status).toBe('Rejected');
    expect(wipe.errors.map((e) => e.code)).toEqual(['WOULD_REMOVE_ACTUALS', 'WOULD_REMOVE_ACTUALS']);
    // ...and a corrected re-upload of that month still works, and registers it per entity
    const lines = await reuploadOf(h, '2026-08');
    const res = await h.stage(lines);
    expect(res.status).toBe('Validated');
    await h.enterTb(res.batchId, correctTbs(lines));
    expect((await h.publish(res.batchId)).published).toBe(true);
    expect((await h.register('2026-08')).map((r) => [r.entity, r.batch_id])).toEqual([['IN', res.batchId], ['US', res.batchId]]);
  });

  it('a file with several periods needs a matching trial balance for each period and entity', async () => {
    const cur = await h.currentPeriod();
    const aug = await reuploadOf(h, '2026-08', '10');
    const sep = await reuploadOf(h, '2026-09', '20');
    const budget = fullPeriod(addMonths(cur, 1), null);
    const lines = [...aug, ...sep, ...budget];
    const tbs = correctTbs(lines);
    expect(Object.keys(tbs).sort()).toEqual(['2026-08|IN', '2026-08|US', '2026-09|IN', '2026-09|US']);
    await h.addLegacyRow('2026-08');

    const res = await h.stage(lines);
    expect(res.status).toBe('Validated');
    const { '2026-08|US': tbAugUS, ...allButAugUS } = tbs;
    const r1 = await h.enterTb(res.batchId, allButAugUS);
    expect(r1.reconciled).toBe(false);
    expect(r1.reconciliation.map((r) => [r.period, r.entity, r.matched])).toEqual([
      ['2026-08', 'IN', true], ['2026-08', 'US', false], ['2026-09', 'IN', true], ['2026-09', 'US', true],
    ]);
    const blocked = refused(await h.publish(res.batchId));
    expect(blocked.error).toMatch(/2026-08 US has no trial balance entered/);
    expect(blocked.error).not.toMatch(/2026-08 IN|2026-09/);

    expect((await h.enterTb(res.batchId, { '2026-08|US': tbAugUS })).reconciled).toBe(true);
    expect((await h.publish(res.batchId)).published).toBe(true);
    for (const p of ['2026-08', '2026-09']) {
      expect(await h.register(p), p).toEqual((['IN', 'US'] as const).map((e) => ({
        entity: e, actual_total: tbs[tbKey(p, e)].toFixed(2), tb_total: tbs[tbKey(p, e)].toFixed(2), batch_id: res.batchId, published_by: DEEPA,
      })));
    }
    // The legacy combined row for August was replaced; July is untouched
    expect((await h.register('2026-07')).map((r) => [r.entity, r.batch_id])).toEqual([['IN', await h.seedBatchId()], ['US', await h.seedBatchId()]]);
  });

  it('RECON_TOLERANCE allows a small difference; the default (0) does not', async () => {
    const lines = fullPeriod('2026-03', (i) => `${1000 + i}.10`, undefined, IN_ACTIVE);
    const tb = entityTotal(lines, 'IN', 'Actual');
    const offBy50p = (cents(tb.toFixed(2)) - 50) / 100;
    const res = await h.stage(lines);

    // Default: must be equal to the paisa
    const strict = await h.enterTb(res.batchId, { '2026-03': offBy50p });
    expect(strict).toMatchObject({ reconciled: false, reconciliation: [{ entity: 'IN', difference: 0.5, matched: false }] });
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
    expect(await h.register('2026-03')).toEqual([expect.objectContaining({ entity: 'IN', actual_total: tb.toFixed(2), tb_total: offBy50p.toFixed(2) })]);
  });

  it('UPLOAD_MAKER_CHECKER=false lets the preparer reconcile and publish alone', async () => {
    process.env.UPLOAD_MAKER_CHECKER = 'false';
    const lines = fullPeriod('2026-03', () => '1', undefined, IN_ACTIVE);
    const res = await h.stage(lines);
    expect((await h.enterTb(res.batchId, { '2026-03': lines.length })).reconciled).toBe(true);
    expect((await h.publish(res.batchId, KAVYA)).published).toBe(true);
    expect(await h.batch(res.batchId)).toMatchObject({ status: 'Published', uploaded_by: KAVYA, approved_by: KAVYA });

    // ...but reconciliation is still enforced
    const again = await h.stage(fullPeriod('2026-02', () => '1', undefined, IN_ACTIVE));
    expect(refused(await h.publish(again.batchId, KAVYA)).error).toMatch(/2026-02 IN has no trial balance/);
  });

  it('non-Finance users cannot stage, reconcile, publish or discard, nor read trial balances', async () => {
    const lines = fullPeriod('2026-03', () => '5', undefined, IN_ACTIVE);
    for (const user of [MEENA, RAJESH, VIKRAM, ARUN]) {
      await expect(h.stage(lines, user), user).rejects.toThrow(/row-level security/);
    }
    const res = await h.stage(lines);
    await h.enterTb(res.batchId, { '2026-03|IN': lines.length * 5 });
    for (const user of [MEENA, RAJESH]) {
      await expect(h.enterTb(res.batchId, { '2026-03|IN': 1 }, user), user).rejects.toThrow(/not found/);
      await expect(h.publish(res.batchId, user), user).rejects.toThrow(/not found/);
      expect(await h.discard(res.batchId, user), user).toBe(false);
    }
    expect((await h.batch(res.batchId)).status).toBe('Validated');
    expect(await h.rows(`period = '2026-03'`)).toEqual([]);

    // Trial balances: Finance only
    const [{ n }] = await asSuper<{ n: number }>(db, 'select count(*)::int as n from ccp.trial_balances');
    expect(n).toBeGreaterThan(0);
    const insertTb = (user: string, period: string, enteredBy: string) =>
      as(db, user, `insert into ccp.trial_balances (batch_id, period, entity, tb_total, entered_by) values ($1, $2, 'IN', 1, $3)`, [res.batchId, period, enteredBy]);
    for (const user of [KAVYA, DEEPA]) expect(await as(db, user, 'select * from ccp.trial_balances'), user).toHaveLength(n);
    for (const user of [MEENA, RAJESH, VIKRAM, ARUN]) {
      expect(await as(db, user, 'select * from ccp.trial_balances'), user).toHaveLength(0);
      await expect(insertTb(user, '2026-02', user), user).rejects.toThrow(/row-level security|Only the preparer/);
      expect(await as(db, user, `update ccp.trial_balances set tb_total = 0 returning period`), user).toHaveLength(0);
    }
    // Finance cannot record a trial balance in someone else's name
    await expect(insertTb(KAVYA, '2026-02', DEEPA)).rejects.toThrow(/row-level security|Only the preparer/);
    // ...nor for an entity outside the allowed list
    await expect(
      as(db, KAVYA, `insert into ccp.trial_balances (batch_id, period, entity, tb_total, entered_by) values ($1, '2026-02', 'XX', 1, $2)`, [res.batchId, KAVYA]),
    ).rejects.toThrow(/trial_balances_entity_chk/);
    await expect(as(db, KAVYA, `delete from ccp.trial_balances`)).rejects.toThrow(/permission denied/);
  });

  it('ccp.periods is readable by Finance and Management only; only legacy rows can be deleted', async () => {
    const [{ n }] = await asSuper<{ n: number }>(db, 'select count(*)::int as n from ccp.periods');
    expect(n).toBe(SEED_PERIODS.length * 2); // one row per period and entity (IN, US)
    expect(await asSuper(db, `select distinct entity from ccp.periods order by entity`)).toEqual([{ entity: 'IN' }, { entity: 'US' }]);
    for (const user of [RAJESH, KAVYA, DEEPA]) expect(await as(db, user, 'select * from ccp.periods'), user).toHaveLength(n);
    for (const user of [MEENA, ARUN, VIKRAM]) expect(await as(db, user, 'select * from ccp.periods'), user).toHaveLength(0);

    const seedId = await h.seedBatchId();
    for (const user of [RAJESH, MEENA, VIKRAM, ARUN]) {
      expect(await as(db, user, `update ccp.periods set actual_total = 0 returning period`), user).toHaveLength(0);
      await expect(
        as(db, user, `insert into ccp.periods (period, entity, actual_total, tb_total, batch_id, published_by) values ('2026-03', 'IN', 0, 0, $1, $2)`, [seedId, user]),
        user,
      ).rejects.toThrow(/row-level security/);
      expect(await as(db, user, `delete from ccp.periods returning period`), user).toHaveLength(0);
    }
    // Finance may not delete a per-entity register entry directly (publishing only removes legacy 'ALL' rows)
    expect(await as(db, KAVYA, `delete from ccp.periods returning period`)).toHaveLength(0);
    expect((await asSuper<{ n: number }>(db, 'select count(*)::int as n from ccp.periods'))[0].n).toBe(n);
    expect((await asSuper<{ n: number }>(db, 'select count(*)::int as n from ccp.periods where actual_total = 0'))[0].n).toBe(0);
    await h.addLegacyRow('2026-03');
    expect(await as(db, RAJESH, `delete from ccp.periods where entity = 'ALL' returning period`)).toHaveLength(0);
    expect(await as(db, KAVYA, `delete from ccp.periods where entity = 'ALL' returning period`)).toEqual([{ period: '2026-03' }]);
    await expect(
      asSuper(db, `insert into ccp.periods (period, entity, actual_total, tb_total, batch_id, published_by) values ('2026-03', 'EU', 0, 0, $1, 'x')`, [seedId]),
    ).rejects.toThrow(/periods_entity_chk/);
  });

  it('a discarded batch cannot be reconciled or published', async () => {
    const lines = fullPeriod('2026-03', () => '7', undefined, IN_ACTIVE);
    const res = await h.stage(lines);
    await h.enterTb(res.batchId, { '2026-03': lines.length * 7 });
    expect(await h.discard(res.batchId, DEEPA)).toBe(true); // either Finance user may discard
    expect(await h.discard(res.batchId)).toBe(false);
    expect((await h.batch(res.batchId)).status).toBe('Discarded');
    await expect(h.publish(res.batchId)).rejects.toThrow(/Upload is Discarded/);
    await expect(h.enterTb(res.batchId, { '2026-03': 1 })).rejects.toThrow(/Upload is Discarded/);
    expect(await h.rows(`period = '2026-03'`)).toEqual([]);
    expect(await h.register('2026-03')).toEqual([]);
    expect(await h.history(res.batchId)).toEqual([]);
    expect((await h.pending(DEEPA)).map((b) => b.id)).not.toContain(res.batchId);
    const ev = (await h.events(res.batchId)).filter((e) => e.action === 'UPLOAD_DISCARDED');
    expect(ev).toEqual([expect.objectContaining({ user_email: DEEPA, batch_id: res.batchId })]);
  });

  it('publish re-validates against the current master: a CC closed after staging blocks the file', async () => {
    const lines = await reuploadOf(h, '2026-09');
    const res = await h.stage(lines);
    await h.enterTb(res.batchId, correctTbs(lines));
    const before = await h.rows();
    // Meanwhile IN-ENG-103 is closed at the end of August
    await as(db, KAVYA, `update ccp.cost_centres set status = 'Inactive', close_date = '2026-08-31' where cc_code = 'IN-ENG-103'`);

    const out = refused(await h.publish(res.batchId));
    expect(new Set(out.errors.map((e) => e.code))).toEqual(new Set(['CC_CLOSED']));
    expect(out.errors).toHaveLength(GL_GROUPS.length);
    expect(await h.rows()).toEqual(before);
    expect(await h.history(res.batchId)).toEqual([]);
    expect((await h.batch(res.batchId)).status).toBe('Rejected');
    expect((await h.events(res.batchId)).map((e) => e.action)).toContain('UPLOAD_REJECTED');
    await expect(h.publish(res.batchId)).rejects.toThrow(/Upload is Rejected/);
  });

  it('the uploader is recorded from the database identity, so letter case cannot defeat maker-checker', async () => {
    const lines = fullPeriod('2026-03', () => '3', undefined, IN_ACTIVE);
    const res = await withUserOn(db, KAVYA, (tx) => stageUpload(tx, KAVYA.toUpperCase(), 'financials', 'f.csv', finCsv(lines)));
    expect((await h.batch(res.batchId)).uploaded_by).toBe(KAVYA);
    expect((await h.enterTb(res.batchId, { '2026-03|IN': lines.length * 3 }, KAVYA.toUpperCase())).reconciled).toBe(true);
    await expect(h.publish(res.batchId, KAVYA)).rejects.toThrow(/Segregation of duties/);
    await expect(h.publish(res.batchId, ` ${KAVYA.toUpperCase()} `)).rejects.toThrow(/Segregation of duties/);
    expect((await h.publish(res.batchId, DEEPA)).published).toBe(true);
  });
});

describe('segregation of duties is enforced in the database too', () => {
  it('blocks self-publish and non-preparer trial balances even when the app layer is bypassed', async () => {
    const db = await freshDb();
    try {
      await asSuper(
        db,
        `insert into ccp.upload_batches (kind, file_name, file_sha256, uploaded_by, status, row_count, error_count, payload)
         values ('financials', 'x.csv', 'h', $1, 'Validated', 0, 0, '{}'::jsonb)`,
        [KAVYA],
      );
      const [{ id }] = await asSuper<{ id: string }>(db, `select id from ccp.upload_batches where file_name = 'x.csv'`);
      // Uploader marks own batch Published directly -> trigger refuses
      await expect(
        as(db, KAVYA, `update ccp.upload_batches set status = 'Published', published_by = $2 where id = $1`, [id, KAVYA]),
      ).rejects.toThrow(/Segregation of duties/);
      // A different Finance user entering the TB directly -> trigger refuses
      await expect(
        as(db, DEEPA, `insert into ccp.trial_balances (batch_id, period, entity, tb_total, entered_by) values ($1, '2026-02', 'IN', 1, $2)`, [id, DEEPA]),
      ).rejects.toThrow(/Only the preparer/);
      // The preparer can
      expect(await as(db, KAVYA, `insert into ccp.trial_balances (batch_id, period, entity, tb_total, entered_by) values ($1, '2026-02', 'IN', 1, $2) returning entity`, [id, KAVYA])).toHaveLength(1);
      // Recording an upload under someone else's name -> RLS refuses
      await expect(
        as(db, DEEPA, `insert into ccp.upload_batches (kind, file_name, file_sha256, uploaded_by, status, row_count, error_count, payload)
                       values ('master', 'y.csv', 'h', $1, 'Validated', 0, 0, '{}'::jsonb)`, [KAVYA]),
      ).rejects.toThrow(/row-level security/);
      // The checker can publish
      expect(await as(db, DEEPA, `update ccp.upload_batches set status = 'Published', published_by = $2 where id = $1 returning id`, [id, DEEPA])).toHaveLength(1);
    } finally {
      await db.close();
    }
  });
});
