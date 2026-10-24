/**
 * Allocations (shared-service recharges): pure validation rules, run summaries,
 * and the stage -> approve/publish workflow against PGlite through RLS.
 * Each upload replaces every allocation run (period × source cost centre) it contains.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withUserOn } from '../src/lib/db/core';
import { SEED_PERIODS } from '../src/lib/db/seed';
import { addMonths } from '../src/lib/fiscal';
import type { ParsedFile } from '../src/lib/upload/parse';
import { discardUpload, enterTrialBalance, publishUpload, stageUpload } from '../src/lib/upload/service';
import { TEMPLATES } from '../src/lib/upload/templates';
import type { Issue } from '../src/lib/upload/validate';
import {
  summarizeAllocations,
  validateAllocations,
  type AllocationRecord,
  type AllocationsContext,
} from '../src/lib/upload/validate-allocations';
import { ARUN, DEEPA, KAVYA, MEENA, RAJESH, VIKRAM, as, asSuper, freshDb, resetDb, type Driver } from './helpers';

const ALLOC_HEADERS = TEMPLATES.allocations.columns.map((c) => c.key);
type Values = Record<string, string>;

function file(headers: string[], rows: Values[]): ParsedFile {
  return {
    headers,
    rows: rows.map((v, i) => ({ row: i + 2, values: Object.fromEntries(headers.map((h) => [h, v[h] ?? ''])) })),
  };
}

const line = (over: Values = {}): Values => ({
  CC_Code: 'IN-ENG-101', Period: '2026-09', Source_CC: 'IN-SSV-302', Amount: '145000', Basis: 'Headcount (42 of 118)', ...over,
});

const CTX: AllocationsContext = {
  costCentres: [
    { cc_code: 'IN-ENG-101', status: 'Active', entity: 'IN', type: 'Direct', close_date: null },
    { cc_code: 'IN-ENG-102', status: 'Active', entity: 'IN', type: 'Direct', close_date: null },
    { cc_code: 'IN-SAL-501', status: 'Active', entity: 'IN', type: 'Direct', close_date: null },
    { cc_code: 'IN-SSV-301', status: 'Active', entity: 'IN', type: 'Shared', close_date: null },
    { cc_code: 'IN-SSV-302', status: 'Active', entity: 'IN', type: 'Shared', close_date: null },
    { cc_code: 'US-ENG-201', status: 'Active', entity: 'US', type: 'Direct', close_date: null },
    { cc_code: 'US-SSV-401', status: 'Active', entity: 'US', type: 'Allocated', close_date: null },
    { cc_code: 'IN-ENG-199', status: 'Inactive', entity: 'IN', type: 'Direct', close_date: '2025-03-31' },
  ],
  currentPeriod: '2026-10',
  sourceActuals: { '2026-09|IN-SSV-302': 300000, '2026-08|IN-SSV-302': 100000, '2026-09|US-SSV-401': 400000 },
};

const alloc = (...rows: Values[]) => validateAllocations(file(ALLOC_HEADERS, rows), CTX);
const pick = (issues: Issue[]) => issues.map(({ row, column, code }) => ({ row, column, code }));
const codesOf = (...rows: Values[]) => pick(alloc(...rows).errors).map((e) => e.code);

// ---------------------------------------------------------------------------
// validateAllocations
// ---------------------------------------------------------------------------
describe('validateAllocations', () => {
  it('a clean file has no errors or warnings and records are normalised', () => {
    const r = alloc(
      line({ CC_Code: ' in-eng-101 ', Period: 'Sep-2026', Source_CC: 'in-ssv-302', Amount: '₹ 1,45,000.00', Basis: '  Headcount   (42 of 118) ' }),
      line({ CC_Code: 'IN-ENG-102', Amount: '(5,000)', Basis: 'Reversal of August over-charge' }), // negative = reversal
      line({ CC_Code: 'US-ENG-201', Source_CC: 'US-SSV-401', Amount: '210000.505', Basis: 'Floor area (60%)' }),
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.records).toEqual<AllocationRecord[]>([
      { cc_code: 'IN-ENG-101', period: '2026-09', source_cc: 'IN-SSV-302', amount: 145000, basis: 'Headcount (42 of 118)' },
      { cc_code: 'IN-ENG-102', period: '2026-09', source_cc: 'IN-SSV-302', amount: -5000, basis: 'Reversal of August over-charge' },
      { cc_code: 'US-ENG-201', period: '2026-09', source_cc: 'US-SSV-401', amount: 210000.51, basis: 'Floor area (60%)' },
    ]);
  });

  it('missing required column -> file-level error, no records; empty file', () => {
    for (const col of ALLOC_HEADERS) {
      const r = validateAllocations(file(ALLOC_HEADERS.filter((h) => h !== col), [line()]), CTX);
      expect(pick(r.errors), col).toEqual([{ row: null, column: col, code: 'MISSING_COLUMN' }]);
      expect(r.records).toEqual([]);
    }
    expect(pick(validateAllocations(file(ALLOC_HEADERS, []), CTX).errors)).toEqual([{ row: null, column: null, code: 'EMPTY_FILE' }]);
  });

  it('REQUIRED: receiving CC, source CC, amount and basis', () => {
    expect(pick(alloc(line({ CC_Code: '' })).errors)).toEqual([{ row: 2, column: 'CC_Code', code: 'REQUIRED' }]);
    expect(pick(alloc(line({ Source_CC: ' ' })).errors)).toEqual([{ row: 2, column: 'Source_CC', code: 'REQUIRED' }]);
    expect(pick(alloc(line({ Amount: '' })).errors)).toEqual([{ row: 2, column: 'Amount', code: 'REQUIRED' }]);
    expect(pick(alloc(line({ Basis: '   ' })).errors)).toEqual([{ row: 2, column: 'Basis', code: 'REQUIRED' }]);
  });

  it('UNKNOWN_CC for the receiving or the source cost centre', () => {
    expect(pick(alloc(line({ CC_Code: 'IN-ENG-777' })).errors)).toEqual([{ row: 2, column: 'CC_Code', code: 'UNKNOWN_CC' }]);
    expect(pick(alloc(line({ Source_CC: 'IN-SSV-777' })).errors)).toEqual([{ row: 2, column: 'Source_CC', code: 'UNKNOWN_CC' }]);
  });

  it('SELF_ALLOCATION (case- and space-insensitive)', () => {
    expect(pick(alloc(line({ CC_Code: 'IN-SSV-302', Source_CC: ' in-ssv-302' })).errors)).toEqual([{ row: 2, column: 'Source_CC', code: 'SELF_ALLOCATION' }]);
  });

  it('CROSS_ENTITY: a US source cannot allocate to an IN cost centre (or vice versa)', () => {
    const r = alloc(line({ CC_Code: 'IN-ENG-101', Source_CC: 'US-SSV-401' }));
    expect(pick(r.errors)).toEqual([{ row: 2, column: 'Source_CC', code: 'CROSS_ENTITY' }]);
    expect(r.errors[0].message).toMatch(/intercompany/);
    expect(codesOf(line({ CC_Code: 'US-ENG-201', Source_CC: 'IN-SSV-302' }))).toEqual(['CROSS_ENTITY']);
  });

  it('INVALID_PERIOD and FUTURE_ACTUAL (allocations are actual recharges)', () => {
    expect(pick(alloc(line({ Period: '2026-13' })).errors)).toEqual([{ row: 2, column: 'Period', code: 'INVALID_PERIOD' }]);
    expect(codesOf(line({ Period: '' }))).toEqual(['INVALID_PERIOD']);
    expect(pick(alloc(line({ Period: '2026-11' })).errors)).toEqual([{ row: 2, column: 'Period', code: 'FUTURE_ACTUAL' }]);
    expect(alloc(line({ Period: '2026-10' })).errors).toEqual([]); // the current month is allowed
  });

  it('INVALID_AMOUNT (not a number, or too large) and ZERO_AMOUNT', () => {
    expect(pick(alloc(line({ Amount: 'abc' })).errors)).toEqual([{ row: 2, column: 'Amount', code: 'INVALID_AMOUNT' }]);
    expect(alloc(line({ Amount: '12x' })).errors[0].message).toMatch(/not a number/);
    expect(pick(alloc(line({ Amount: '10000000000000' })).errors)).toEqual([{ row: 2, column: 'Amount', code: 'INVALID_AMOUNT' }]);
    expect(alloc(line({ Amount: '10000000000000' })).errors[0].message).toMatch(/too large/);
    for (const zero of ['0', '0.00', '(0)', '0.001']) {
      expect(pick(alloc(line({ Amount: zero })).errors), zero).toEqual([{ row: 2, column: 'Amount', code: 'ZERO_AMOUNT' }]);
    }
  });

  it('INVALID_BASIS: at most 120 characters', () => {
    expect(alloc(line({ Basis: 'x'.repeat(120) })).errors).toEqual([]);
    expect(pick(alloc(line({ Basis: 'x'.repeat(121) })).errors)).toEqual([{ row: 2, column: 'Basis', code: 'INVALID_BASIS' }]);
  });

  it('CC_CLOSED: a closed cost centre cannot receive allocations after its close month', () => {
    const r = alloc(line({ CC_Code: 'IN-ENG-199', Period: '2025-04' }));
    expect(pick(r.errors)).toEqual([{ row: 2, column: 'CC_Code', code: 'CC_CLOSED' }]);
    expect(r.errors[0].message).toMatch(/2025-03-31/);
    expect(alloc(line({ CC_Code: 'IN-ENG-199', Period: '2025-03' })).errors).toEqual([]); // closing month is fine
  });

  it('CC_CLOSED: a closed cost centre cannot be the source of a recharge after its close month either', () => {
    const r = alloc(line({ Source_CC: 'IN-ENG-199', Period: '2026-09' }));
    expect(pick(r.errors)).toEqual([{ row: 2, column: 'Source_CC', code: 'CC_CLOSED' }]);
    expect(r.errors[0].message).toMatch(/IN-ENG-199 was closed on 2025-03-31; it cannot allocate costs for 2026-09/);
    expect(alloc(line({ Source_CC: 'IN-ENG-199', Period: '2025-03' })).errors).toEqual([]);
  });

  it('DUPLICATE_LINE: same receiving CC, period and source (case-insensitive)', () => {
    const r = alloc(line(), line({ CC_Code: 'IN-ENG-102' }), line({ CC_Code: 'in-eng-101', Period: 'Sep-2026', Source_CC: 'in-ssv-302', Amount: '1' }));
    expect(pick(r.errors)).toEqual([{ row: 4, column: null, code: 'DUPLICATE_LINE' }]);
    expect(r.errors[0].message).toMatch(/also row 2/);
    // Same target from another source, or in another period, is not a duplicate
    expect(alloc(line(), line({ Source_CC: 'IN-SSV-301' }), line({ Period: '2026-08' })).errors).toEqual([]);
  });

  it('DIRECT_SOURCE warns once per Direct source cost centre', () => {
    const r = alloc(
      line({ CC_Code: 'IN-ENG-101', Source_CC: 'IN-SAL-501', Amount: '10' }),
      line({ CC_Code: 'IN-ENG-102', Source_CC: 'IN-SAL-501', Amount: '10' }),
      line({ CC_Code: 'IN-SAL-501', Source_CC: 'IN-ENG-101', Amount: '10' }),
      line({ CC_Code: 'IN-ENG-102', Source_CC: 'IN-SSV-301', Amount: '10' }), // Shared: no warning
    );
    expect(r.errors).toEqual([]);
    expect(pick(r.warnings)).toEqual([
      { row: 2, column: 'Source_CC', code: 'DIRECT_SOURCE' },
      { row: 4, column: 'Source_CC', code: 'DIRECT_SOURCE' },
    ]);
  });

  it('OVER_ALLOCATED warns when a run recharges more than the source actually cost that month', () => {
    // IN-SSV-302 cost 300,000 in 2026-09: 200,000 + 100,000.01 is over by a paisa
    const over = alloc(line({ Amount: '200000' }), line({ CC_Code: 'IN-ENG-102', Amount: '100000.01' }));
    expect(over.errors).toEqual([]);
    expect(pick(over.warnings)).toEqual([{ row: null, column: 'Amount', code: 'OVER_ALLOCATED' }]);
    expect(over.warnings[0].message).toMatch(/IN-SSV-302 allocates 300000\.01 in 2026-09, more than its recorded actual cost of 300000\.00/);
    // Exactly the cost is fine
    expect(alloc(line({ Amount: '200000' }), line({ CC_Code: 'IN-ENG-102', Amount: '100000' })).warnings).toEqual([]);
    // Each run (period × source) is checked on its own
    const runs = alloc(
      line({ Amount: '250000' }), // 2026-09: under 300,000
      line({ Period: '2026-08', Amount: '150000' }), // 2026-08: over 100,000
      line({ CC_Code: 'US-ENG-201', Source_CC: 'US-SSV-401', Amount: '399999' }), // under
    );
    expect(runs.warnings.map((w) => [w.code, w.message.match(/in (\d{4}-\d{2})/)?.[1]])).toEqual([['OVER_ALLOCATED', '2026-08']]);
    // No recorded cost for the source that month -> nothing to compare with
    expect(alloc(line({ Period: '2026-07', Amount: '9999999' })).warnings).toEqual([]);
    expect(validateAllocations(file(ALLOC_HEADERS, [line({ Amount: '9999999' })]), { ...CTX, sourceActuals: undefined }).warnings).toEqual([]);
  });

  it('reports every problem in one pass', () => {
    const r = alloc(line({ CC_Code: 'XX-YYY-000', Source_CC: 'US-SSV-401', Period: 'never', Amount: '0', Basis: '' }), line(), line());
    expect(pick(r.errors)).toEqual([
      { row: 2, column: 'CC_Code', code: 'UNKNOWN_CC' },
      { row: 2, column: 'Period', code: 'INVALID_PERIOD' },
      { row: 2, column: 'Amount', code: 'ZERO_AMOUNT' },
      { row: 2, column: 'Basis', code: 'REQUIRED' },
      { row: 4, column: null, code: 'DUPLICATE_LINE' },
    ]);
  });
});

describe('summarizeAllocations', () => {
  const rec = (cc_code: string, period: string, source_cc: string, amount: number): AllocationRecord => ({ cc_code, period, source_cc, amount, basis: 'b' });

  it('one line per run (period × source), sorted, with distinct targets and net totals', () => {
    expect(summarizeAllocations([
      rec('US-ENG-201', '2026-09', 'US-SSV-401', 210000),
      rec('IN-ENG-101', '2026-09', 'IN-SSV-302', 145000.1),
      rec('IN-ENG-102', '2026-09', 'IN-SSV-302', 0.2),
      rec('IN-ENG-102', '2026-09', 'IN-SSV-302', -5000), // reversal nets off
      rec('IN-ENG-101', '2026-08', 'IN-SSV-302', 1),
      rec('US-SAL-601', '2026-09', 'US-SSV-401', 140000),
    ])).toEqual([
      { period: '2026-08', source_cc: 'IN-SSV-302', targets: 1, total: 1 },
      { period: '2026-09', source_cc: 'IN-SSV-302', targets: 2, total: 140000.3 },
      { period: '2026-09', source_cc: 'US-SSV-401', targets: 2, total: 350000 },
    ]);
    expect(summarizeAllocations([])).toEqual([]);
  });

  it('totals are exact (BigInt paise), where floating-point sums drift', () => {
    const recs = Array.from({ length: 60000 }, (_, i) => rec(`IN-ENG-${i % 100}`, '2026-09', 'IN-SSV-302', 1234567.89));
    const floatSum = recs.reduce((s, r) => s + r.amount, 0);
    expect(Math.round(floatSum * 100) / 100).not.toBe(74074073400); // the naive sum is off
    expect(summarizeAllocations(recs)).toEqual([{ period: '2026-09', source_cc: 'IN-SSV-302', targets: 100, total: 74074073400 }]);
    // Large offsetting amounts still net to the paisa
    const big = [rec('A', '2026-09', 'S', 9999999999999.99), rec('B', '2026-09', 'S', -9999999999999.99), rec('C', '2026-09', 'S', 0.01)];
    expect(summarizeAllocations(big)[0].total).toBe(0.01);
  });
});

// ---------------------------------------------------------------------------
// Stage -> publish (PGlite, through RLS)
// ---------------------------------------------------------------------------
const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const allocCsv = (rows: Values[]) =>
  Buffer.from([ALLOC_HEADERS.join(','), ...rows.map((r) => ALLOC_HEADERS.map((h) => csvCell(r[h] ?? '')).join(','))].join('\r\n') + '\r\n');

type AllocRow = { cc_code: string; period: string; source_cc: string; amount: string; basis: string };

describe('allocations upload workflow', () => {
  let db: Driver;
  let savedMakerChecker: string | undefined;
  beforeAll(async () => {
    savedMakerChecker = process.env.UPLOAD_MAKER_CHECKER;
    delete process.env.UPLOAD_MAKER_CHECKER;
    db = await freshDb();
  });
  beforeEach(() => resetDb(db));
  afterAll(async () => {
    if (savedMakerChecker === undefined) delete process.env.UPLOAD_MAKER_CHECKER;
    else process.env.UPLOAD_MAKER_CHECKER = savedMakerChecker;
    await db.close();
  });

  const stage = (rows: Values[], user = KAVYA) =>
    withUserOn(db, user, (tx) => stageUpload(tx, user, 'allocations', 'allocations.csv', allocCsv(rows)));
  const publish = (batchId: string, user = DEEPA) => withUserOn(db, user, (tx) => publishUpload(tx, batchId), { batchId });
  const run = (period: string, source: string) =>
    asSuper<AllocRow>(db, `select cc_code, period, source_cc, amount, basis from ccp.allocations where period = $1 and source_cc = $2 order by cc_code`, [period, source]);
  const allRows = () =>
    asSuper<AllocRow>(db, 'select cc_code, period, source_cc, amount, basis from ccp.allocations order by period, source_cc, cc_code');
  const batch = async (id: string) =>
    (await asSuper<{ kind: string; status: string; uploaded_by: string; approved_by: string | null; published_by: string | null }>(
      db, 'select kind, status, uploaded_by, approved_by, published_by from ccp.upload_batches where id = $1', [id],
    ))[0];
  const sourceCost = async (period: string, source: string) =>
    Number((await asSuper<{ t: string }>(db, `select sum(actual)::text as t from ccp.financials where period = $1 and cc_code = $2`, [period, source]))[0].t);

  // New IT recharge for September: 101 and 102 re-based, IN-SSV-301 added, 103 and 501 dropped
  const SEPT_IT = [
    line({ CC_Code: 'IN-ENG-101', Amount: '150000', Basis: 'Headcount (44 of 120)' }),
    line({ CC_Code: 'IN-ENG-102', Amount: '60,000.50', Basis: 'Headcount (18 of 120)' }),
    line({ CC_Code: 'IN-SSV-301', Amount: '20000', Basis: 'Headcount (6 of 120)' }),
  ];

  it('stale-batch guard: an older run cannot overwrite a run published after it was prepared', async () => {
    const older = await stage(SEPT_IT);
    const newer = await stage(SEPT_IT.map((l) => ({ ...l, Amount: '1000' })));
    expect((await publish(newer.batchId)).published).toBe(true);
    const after = await run('2026-09', 'IN-SSV-302');
    const out = await publish(older.batchId);
    expect(out.published).toBe(false);
    expect((out as { error?: string }).error).toMatch(/allocation run IN-SSV-302 2026-09 was published after this file was prepared/);
    expect(await run('2026-09', 'IN-SSV-302')).toEqual(after);
    // The stale batch stays open (not rejected) so it can be discarded
    expect((await batch(older.batchId)).status).toBe('Validated');
  });

  it('KAVYA stages a run: Validated with a run summary; nothing is written yet', async () => {
    const before = await allRows();
    const res = await stage(SEPT_IT);
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.status).toBe('Validated');
    expect(res.summary).toMatchObject({ created: 3, runs: [{ period: '2026-09', source_cc: 'IN-SSV-302', targets: 3, total: 230000.5 }] });
    expect(await batch(res.batchId)).toMatchObject({ kind: 'allocations', status: 'Validated', uploaded_by: KAVYA });
    expect(await allRows()).toEqual(before);
    // There is no trial balance for allocations
    await expect(withUserOn(db, KAVYA, (tx) => enterTrialBalance(tx, res.batchId, { '2026-09': 1 }), { batchId: res.batchId }))
      .rejects.toThrow(/Budget & Actuals uploads only/);
  });

  it('maker-checker: KAVYA cannot publish her own run; DEEPA publishes and the run is replaced exactly', async () => {
    const before = await allRows();
    const res = await stage(SEPT_IT);
    await expect(publish(res.batchId, KAVYA)).rejects.toThrow(/Segregation of duties/);
    expect(await allRows()).toEqual(before);

    const out = await publish(res.batchId);
    expect(out).toMatchObject({
      published: true,
      summary: { created: 3, removed: 4, runs: [{ period: '2026-09', source_cc: 'IN-SSV-302', targets: 3, total: 230000.5 }] },
    });
    expect(await run('2026-09', 'IN-SSV-302')).toEqual([
      { cc_code: 'IN-ENG-101', period: '2026-09', source_cc: 'IN-SSV-302', amount: '150000.00', basis: 'Headcount (44 of 120)' },
      { cc_code: 'IN-ENG-102', period: '2026-09', source_cc: 'IN-SSV-302', amount: '60000.50', basis: 'Headcount (18 of 120)' },
      { cc_code: 'IN-SSV-301', period: '2026-09', source_cc: 'IN-SSV-302', amount: '20000.00', basis: 'Headcount (6 of 120)' },
    ]);
    // Every other run is untouched: US-SSV-401 in September, and IN-SSV-302 in other months
    const isReplaced = (r: AllocRow) => r.period === '2026-09' && r.source_cc === 'IN-SSV-302';
    expect((await allRows()).filter((r) => !isReplaced(r))).toEqual(before.filter((r) => !isReplaced(r)));
    expect((await run('2026-09', 'US-SSV-401')).map((r) => [r.cc_code, r.amount])).toEqual([['US-ENG-201', '6300.00'], ['US-SAL-601', '4200.00']]);
    expect(await run('2026-08', 'IN-SSV-302')).toHaveLength(4);

    expect(await batch(res.batchId)).toMatchObject({ status: 'Published', uploaded_by: KAVYA, approved_by: DEEPA, published_by: DEEPA });

    // Row-level audit of the allocations, tagged with the batch and the approver
    const audit = await asSuper<{ action: string; entity_id: string; user_email: string; old_value: Record<string, unknown> | null; new_value: Record<string, unknown> | null }>(
      db, `select action, entity_id, user_email, old_value, new_value from ccp.audit_log where entity = 'allocations' and batch_id = $1 order by id`, [res.batchId],
    );
    expect(audit.every((a) => a.user_email === DEEPA)).toBe(true);
    expect(audit.filter((a) => a.action === 'DELETE').map((a) => a.entity_id).sort()).toEqual(['IN-ENG-101', 'IN-ENG-102', 'IN-ENG-103', 'IN-SAL-501']);
    expect(audit.filter((a) => a.action === 'CREATE').map((a) => a.entity_id).sort()).toEqual(['IN-ENG-101', 'IN-ENG-102', 'IN-SSV-301']);
    expect(audit.find((a) => a.action === 'DELETE' && a.entity_id === 'IN-ENG-103')!.old_value).toMatchObject({ period: '2026-09', source_cc: 'IN-SSV-302', amount: 55000 });
    expect(audit.find((a) => a.action === 'CREATE' && a.entity_id === 'IN-ENG-102')!.new_value).toMatchObject({ period: '2026-09', source_cc: 'IN-SSV-302', amount: 60000.5 });
    const events = await asSuper<{ action: string; user_email: string }>(
      db, `select action, user_email from ccp.audit_log where entity = 'upload_batch' and batch_id = $1`, [res.batchId],
    );
    expect(events).toEqual([{ action: 'UPLOAD_PUBLISHED', user_email: DEEPA }]);
    // No allocation row changed without the batch id
    expect(await asSuper(db, `select * from ccp.audit_log where entity = 'allocations' and batch_id is null and user_email <> 'seed@system'`)).toEqual([]);

    await expect(publish(res.batchId)).rejects.toThrow(/Upload is Published/);
  });

  it('CROSS_ENTITY: a US source recharging an IN cost centre is rejected and cannot be published', async () => {
    const res = await stage([line({ CC_Code: 'IN-ENG-101', Source_CC: 'US-SSV-401', Amount: '1000', Basis: 'Floor area' })]);
    expect(res.status).toBe('Rejected');
    expect(res.errors.map((e) => e.code)).toEqual(['CROSS_ENTITY']);
    expect(res.summary.runs).toEqual([]);
    await expect(publish(res.batchId)).rejects.toThrow(/Upload is Rejected/);
    expect(await asSuper(db, `select * from ccp.allocations where cc_code = 'IN-ENG-101' and source_cc = 'US-SSV-401'`)).toEqual([]);
  });

  it('OVER_ALLOCATED: a run larger than the source\'s actual cost is a warning, not an error', async () => {
    const cost = await sourceCost('2026-09', 'IN-SSV-302');
    expect(cost).toBeGreaterThan(0);
    const res = await stage([
      line({ CC_Code: 'IN-ENG-101', Amount: String(Math.round(cost / 2)) }),
      line({ CC_Code: 'IN-ENG-102', Amount: String(Math.round(cost / 2) + 1000) }),
    ]);
    expect(res.errors).toEqual([]);
    expect(res.status).toBe('Validated');
    expect(res.warnings.map((w) => w.code)).toEqual(['OVER_ALLOCATED']);
    expect(res.warnings[0].message).toMatch(new RegExp(`recorded actual cost of ${cost.toFixed(2)}`));
    // Within the cost: no warning
    const ok = await stage([line({ CC_Code: 'IN-ENG-101', Amount: String(Math.floor(cost)) })]);
    expect(ok.warnings).toEqual([]);
  });

  it('allocations to a future month are rejected using the database clock', async () => {
    const [{ p }] = await asSuper<{ p: string }>(db, `select to_char(now(), 'YYYY-MM') as p`);
    const res = await stage([line({ Period: addMonths(p, 1) })]);
    expect(res.status).toBe('Rejected');
    expect(res.errors.map((e) => e.code)).toEqual(['FUTURE_ACTUAL']);
  });

  it('publish re-validates: a receiving cost centre closed after staging blocks the run', async () => {
    const res = await stage(SEPT_IT);
    const before = await allRows();
    await as(db, KAVYA, `update ccp.cost_centres set status = 'Inactive', close_date = '2026-08-31' where cc_code = 'IN-SSV-301'`);
    const out = await publish(res.batchId);
    expect(out.published).toBe(false);
    expect(!out.published && out.errors.map((e) => e.code)).toEqual(['CC_CLOSED']);
    expect(await allRows()).toEqual(before);
    expect((await batch(res.batchId)).status).toBe('Rejected');
  });

  it('a discarded run cannot be published', async () => {
    const res = await stage(SEPT_IT);
    expect(await withUserOn(db, DEEPA, (tx) => discardUpload(tx, res.batchId))).toBe(true);
    await expect(publish(res.batchId)).rejects.toThrow(/Upload is Discarded/);
  });

  it('non-Finance users cannot stage or publish allocations, nor write them directly', async () => {
    for (const user of [MEENA, RAJESH, VIKRAM, ARUN]) {
      await expect(stage(SEPT_IT, user), user).rejects.toThrow(/row-level security/);
    }
    const res = await stage(SEPT_IT);
    for (const user of [MEENA, RAJESH]) await expect(publish(res.batchId, user), user).rejects.toThrow(/not found/);
    expect((await batch(res.batchId)).status).toBe('Validated');

    const before = await allRows();
    for (const user of [MEENA, RAJESH, VIKRAM, ARUN]) {
      await expect(
        as(db, user, `insert into ccp.allocations (cc_code, period, source_cc, amount, basis) values ('IN-ENG-101', '2026-03', 'IN-SSV-302', 1, 'x')`),
        user,
      ).rejects.toThrow(/row-level security/);
      expect(await as(db, user, `update ccp.allocations set amount = 0 returning id`), user).toHaveLength(0);
      expect(await as(db, user, `delete from ccp.allocations returning id`), user).toHaveLength(0);
    }
    expect(await allRows()).toEqual(before);
  });

  it('an owner reads only the allocations her cost centres receive', async () => {
    const mine = await as<AllocRow>(db, MEENA, 'select cc_code, period, source_cc, amount, basis from ccp.allocations');
    const [{ n }] = await asSuper<{ n: number }>(db, `select count(*)::int as n from ccp.allocations where cc_code in ('IN-ENG-101', 'IN-ENG-102')`);
    expect(n).toBe(2 * SEED_PERIODS.length);
    expect(mine).toHaveLength(n);
    expect([...new Set(mine.map((r) => r.cc_code))].sort()).toEqual(['IN-ENG-101', 'IN-ENG-102']);
    // She sees the source of her recharge, but not what the source charges anyone else
    expect(await as(db, MEENA, `select * from ccp.allocations where source_cc = 'IN-SSV-302' and cc_code not in ('IN-ENG-101', 'IN-ENG-102')`)).toEqual([]);
    expect(await as(db, MEENA, `select * from ccp.allocations where source_cc = 'US-SSV-401'`)).toEqual([]);
    expect(await as(db, ARUN, 'select * from ccp.allocations')).toEqual([]);
    // Management and Finance see every allocation
    const [{ all }] = await asSuper<{ all: number }>(db, 'select count(*)::int as "all" from ccp.allocations');
    for (const user of [RAJESH, KAVYA]) expect(await as(db, user, 'select * from ccp.allocations'), user).toHaveLength(all);
  });

  it('database constraints back up the file rules', async () => {
    const ins = (cc: string, src: string, basis = 'b') =>
      asSuper(db, `insert into ccp.allocations (cc_code, period, source_cc, amount, basis) values ($1, '2026-09', $2, 1, $3)`, [cc, src, basis]);
    await expect(ins('IN-SSV-302', 'IN-SSV-302')).rejects.toThrow(/allocations_not_self/);
    await expect(ins('IN-ENG-101', 'IN-SSV-302')).rejects.toThrow(/allocations_line_uk|duplicate key/); // seeded line
    await expect(ins('IN-ENG-102', 'IN-SSV-301', '   ')).rejects.toThrow(/allocations_basis_len/);
    await expect(ins('IN-ENG-102', 'IN-SSV-301', 'x'.repeat(121))).rejects.toThrow(/allocations_basis_len/);
  });
});
