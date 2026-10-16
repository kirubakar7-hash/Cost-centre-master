/** Cost centre finder: multi-word, partial, any-order, case-insensitive search over active CCs. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserOn } from '../src/lib/db/core';
import { parseTerms, searchCostCentres, type SearchResult } from '../src/lib/search';
import { ARUN, asSuper, freshDb, type Driver } from './helpers';

describe('parseTerms', () => {
  it('lower-cases, splits on whitespace and strips LIKE / quote / backslash characters', () => {
    expect(parseTerms('  Chen   DES ')).toEqual(['chen', 'des']);
    expect(parseTerms('%')).toEqual([]);
    expect(parseTerms("'; drop table x; --")).toEqual(['drop', 'table', 'x', '--']);
    expect(parseTerms('a\\b')).toEqual(['a', 'b']);
    expect(parseTerms('IN-ENG-101')).toEqual(['in-eng-101']);
    expect(parseTerms('a b c d e f g h i j')).toHaveLength(8);
    expect(parseTerms('x'.repeat(100))[0]).toHaveLength(40);
  });
});

describe('searchCostCentres', () => {
  let db: Driver;
  const search = (q: string, user = ARUN) => withUserOn(db, user, (tx) => searchCostCentres(tx, q));
  const codesOf = async (q: string) => (await search(q)).map((r) => r.cc_code);
  const sortedCodes = async (q: string) => (await codesOf(q)).sort();

  beforeAll(async () => {
    db = await freshDb();
    // An active CC with a literal underscore in its keywords, for the wildcard tests.
    await asSuper(
      db,
      `insert into ccp.cost_centres (cc_code, cc_alias, entity, bu, department, type, keywords, start_date)
       values ('IN-ENG-120', 'Part Numbering', 'IN', 'Engineering', 'PLM', 'Direct', 'abc_def; 100% coverage', '2026-01-01')`,
    );
  });
  afterAll(() => db.close());

  it('"chen des" finds IN-ENG-101 Design Chennai', async () => {
    const rows = await search('chen des');
    expect(rows.map((r) => r.cc_code)).toEqual(['IN-ENG-101']);
    expect(rows[0]).toEqual<SearchResult>({
      cc_code: 'IN-ENG-101',
      cc_alias: 'Design Chennai',
      bu: 'Engineering',
      department: 'Mechanical Design',
      entity: 'IN',
      owner_name: 'Meena Raj',
    });
  });

  it('returns directory fields only (no financial data)', async () => {
    const [row] = await search('design chennai');
    expect(Object.keys(row).sort()).toEqual(['bu', 'cc_alias', 'cc_code', 'department', 'entity', 'owner_name']);
  });

  it('is case-insensitive', async () => {
    expect(await codesOf('CHEN DES')).toEqual(['IN-ENG-101']);
    expect(await codesOf('Design CHENNAI')).toEqual(['IN-ENG-101']);
  });

  it('matches partial words', async () => {
    expect(await sortedCodes('chenn')).toEqual(['IN-ENG-101', 'IN-ENG-102', 'IN-SSV-303']);
    expect(await codesOf('simul')).toEqual(['IN-ENG-102']);
  });

  it('matches words in any order', async () => {
    expect(await codesOf('des chen')).toEqual(['IN-ENG-101']);
    expect(await codesOf('chennai design')).toEqual(['IN-ENG-101']);
  });

  it('every word must match (AND, not OR)', async () => {
    expect(await codesOf('chennai houston')).toEqual([]);
  });

  it('finds by code, with or without dashes, and ranks the exact code first', async () => {
    expect(await codesOf('IN-ENG-101')).toEqual(['IN-ENG-101']);
    expect(await codesOf('in-eng-101')).toEqual(['IN-ENG-101']);
    expect(await codesOf('eng101')).toEqual(['IN-ENG-101']);
    expect(await codesOf('INENG101')).toEqual(['IN-ENG-101']);
    const prefix = await codesOf('IN-ENG');
    expect(prefix.slice(0, 4).sort()).toEqual(['IN-ENG-101', 'IN-ENG-102', 'IN-ENG-103', 'IN-ENG-120']);
  });

  it('finds by owner name', async () => {
    expect(await sortedCodes('meena')).toEqual(['IN-ENG-101', 'IN-ENG-102']);
    expect(await codesOf('suresh babu')).toEqual(['IN-ENG-103']);
    expect(await codesOf('babu suresh')).toEqual(['IN-ENG-103']);
  });

  it('finds by keyword', async () => {
    expect(await codesOf('solidworks')).toEqual(['IN-ENG-101']);
    expect(await codesOf('ansys')).toEqual(['IN-ENG-102']);
    expect(await codesOf('gst')).toEqual(['IN-SSV-301']);
    expect(await codesOf('microsoft 365')).toEqual(['IN-SSV-302']);
  });

  it('finds by BU and department', async () => {
    expect(await sortedCodes('sales')).toEqual(['IN-SAL-501', 'US-SAL-601']);
    expect(await sortedCodes('shared services')).toEqual(['IN-SSV-301', 'IN-SSV-302', 'IN-SSV-303', 'US-SSV-401']);
    expect(await codesOf('human resources')).toEqual(['IN-SSV-303']);
  });

  it('never returns the inactive IN-ENG-199', async () => {
    for (const q of ['IN-ENG-199', 'eng199', 'legacy', 'coimbatore', 'autocad', 'legacy drafting coimbatore']) {
      expect(await codesOf(q), q).toEqual([]);
    }
    // "drafting" matches an active CC's keywords but still not the inactive one
    expect(await codesOf('drafting')).toEqual(['IN-ENG-101']);
  });

  it('treats LIKE wildcards literally', async () => {
    expect(await codesOf('%')).toEqual([]);
    expect(await codesOf('%%%')).toEqual([]);
    // "_" is a literal underscore, not "any character": it only matches the one CC that has one.
    expect(await codesOf('_')).toEqual(['IN-ENG-120']);
    expect(await codesOf('d_sign')).toEqual([]);
    expect(await codesOf('ch_nnai')).toEqual([]);
    expect(await codesOf('c_d')).toEqual(['IN-ENG-120']);
    expect(await codesOf('abc_def')).toEqual(['IN-ENG-120']);
    expect(await codesOf('abcxdef')).toEqual([]);
  });

  it('handles empty, junk and injection-shaped input safely', async () => {
    expect(await codesOf('')).toEqual([]);
    expect(await codesOf('   ')).toEqual([]);
    expect(await codesOf("'; drop table ccp.cost_centres; --")).toEqual([]);
    expect(await codesOf('\\')).toEqual([]);
    expect((await asSuper(db, 'select count(*)::int as n from ccp.cost_centres'))[0]).toEqual({ n: 12 });
  });

  it('returns nothing without a user context (RLS)', async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.query('set local role cc_app');
      return searchCostCentres(tx, 'chennai');
    });
    expect(rows).toEqual([]);
  });

  it('respects the limit', async () => {
    const rows = await withUserOn(db, ARUN, (tx) => searchCostCentres(tx, 'in', 3));
    expect(rows).toHaveLength(3);
  });
});

describe('search performance', () => {
  let db: Driver;

  beforeAll(async () => {
    db = await freshDb();
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into ccp.cost_centres (cc_code, cc_alias, entity, bu, department, type, keywords, start_date)
         select 'IN-PRF-' || (1000 + g), 'Perf Centre ' || g, 'IN',
                (array['Engineering', 'Sales', 'Shared Services', 'Operations'])[1 + g % 4],
                'Department ' || (g % 17), 'Direct',
                'kw' || g || '; chennai; design; load test; tally; laptop', '2024-01-01'
           from generate_series(1, 500) g`,
      );
      await tx.query(
        `insert into ccp.cc_owners (cc_code, owner_name, owner_email, backup_owner_email)
         select 'IN-PRF-' || (1000 + g), 'Owner Person ' || g, 'owner' || g || '@solidpro-es.com',
                'backup' || g || '@solidpro-es.com'
           from generate_series(1, 500) g`,
      );
    });
    const [{ n }] = await asSuper<{ n: number }>(db, `select count(*)::int as n from ccp.cost_centres where status = 'Active'`);
    expect(n).toBe(510);
  });
  afterAll(() => db.close());

  it('each search (incl. RLS transaction setup) completes in < 1000 ms with 510 active CCs', async () => {
    const queries = [
      'chen des',
      'IN-PRF-1250',
      'prf1499',
      'perf centre 42',
      'owner person 317',
      'solidworks',
      'chennai design load test tally laptop department engineering', // 8 terms, broad
      'no such cost centre anywhere',
      'e',
    ];
    const timings: Record<string, number> = {};
    await withUserOn(db, ARUN, (tx) => searchCostCentres(tx, 'warm up'));
    for (const q of queries) {
      const t0 = performance.now();
      const rows = await withUserOn(db, ARUN, (tx) => searchCostCentres(tx, q));
      timings[q] = performance.now() - t0;
      if (q === 'chen des') expect(rows[0].cc_code).toBe('IN-ENG-101'); // still ranked first among 500+ matches
      if (q === 'IN-PRF-1250') expect(rows.map((r) => r.cc_code)).toEqual(['IN-PRF-1250']);
      if (q === 'prf1499') expect(rows.map((r) => r.cc_code)).toEqual(['IN-PRF-1499']);
      if (q === 'owner person 317') expect(rows.map((r) => r.cc_code)).toEqual(['IN-PRF-1317']);
      if (q === 'e') expect(rows).toHaveLength(25);
    }
    for (const [q, ms] of Object.entries(timings)) expect(ms, `"${q}" took ${ms.toFixed(0)} ms`).toBeLessThan(1000);
  });
});
