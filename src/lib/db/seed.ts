/**
 * Demo seed data: 10 active cost centres (+1 inactive) across 3 BUs and
 * 2 entities, 6 users covering every role (two Finance users for maker-checker),
 * 6 months of published budget/actuals with deliberate >10% variances, 6
 * budget-only months for the full-year outturn, and a few allocations.
 */
import type { Driver, Tx } from './core';

export const DEMO_DOMAIN = 'solidpro-es.com';

export const DEMO_USERS = [
  { email: `arun.kumar@${DEMO_DOMAIN}`, name: 'Arun Kumar', role: 'Employee', note: 'Finder only' },
  { email: `meena.raj@${DEMO_DOMAIN}`, name: 'Meena Raj', role: 'CC Owner', note: 'Owns IN-ENG-101, IN-ENG-102' },
  { email: `vikram.iyer@${DEMO_DOMAIN}`, name: 'Vikram Iyer', role: 'BU Head', note: 'Engineering BU' },
  { email: `kavya.s@${DEMO_DOMAIN}`, name: 'Kavya S', role: 'Finance Admin', note: 'Full access + admin (maker)' },
  { email: `deepa.m@${DEMO_DOMAIN}`, name: 'Deepa M', role: 'Finance Approver', note: 'Finance admin (checker)' },
  { email: `rajesh.n@${DEMO_DOMAIN}`, name: 'Rajesh N', role: 'Management / CFO', note: 'Read-only, all CCs' },
] as const;

const e = (local: string) => `${local}@${DEMO_DOMAIN}`;

type SeedCC = {
  code: string; alias: string; entity: 'IN' | 'US'; bu: string; dept: string;
  type: 'Direct' | 'Shared' | 'Allocated'; keywords: string; status?: 'Active' | 'Inactive';
  start: string; close?: string;
  owner?: [name: string, email: string, backup: string, buHead: string];
};

export const SEED_COST_CENTRES: SeedCC[] = [
  { code: 'IN-ENG-101', alias: 'Design Chennai', entity: 'IN', bu: 'Engineering', dept: 'Mechanical Design', type: 'Direct',
    keywords: 'cad; solidworks; product design; drafting; chennai', start: '2019-04-01',
    owner: ['Meena Raj', e('meena.raj'), e('karthik.v'), e('vikram.iyer')] },
  { code: 'IN-ENG-102', alias: 'Simulation & CAE Chennai', entity: 'IN', bu: 'Engineering', dept: 'Simulation', type: 'Direct',
    keywords: 'fea; cfd; ansys; analysis; structural', start: '2020-04-01',
    owner: ['Meena Raj', e('meena.raj'), e('karthik.v'), e('vikram.iyer')] },
  { code: 'IN-ENG-103', alias: 'Plant Engineering Pune', entity: 'IN', bu: 'Engineering', dept: 'Plant Design', type: 'Direct',
    keywords: 'piping; plant 3d; layout; pune; process', start: '2021-07-01',
    owner: ['Suresh Babu', e('suresh.babu'), e('karthik.v'), e('vikram.iyer')] },
  { code: 'US-ENG-201', alias: 'Design Houston', entity: 'US', bu: 'Engineering', dept: 'Mechanical Design', type: 'Direct',
    keywords: 'cad; onsite; houston; oil and gas', start: '2022-01-01',
    owner: ['Sarah Mitchell', e('sarah.mitchell'), e('john.carter'), e('vikram.iyer')] },
  { code: 'IN-SSV-301', alias: 'Finance & Accounts', entity: 'IN', bu: 'Shared Services', dept: 'Finance', type: 'Shared',
    keywords: 'accounts; tally; audit; gst; tds; payroll; bank charges', start: '2019-04-01',
    owner: ['Kavya S', e('kavya.s'), e('deepa.m'), e('rajesh.n')] },
  { code: 'IN-SSV-302', alias: 'IT Infrastructure', entity: 'IN', bu: 'Shared Services', dept: 'IT', type: 'Shared',
    keywords: 'laptop; software licence; network; internet; cloud; aws; microsoft 365', start: '2019-04-01',
    owner: ['Ganesh R', e('ganesh.r'), e('deepa.m'), e('rajesh.n')] },
  { code: 'IN-SSV-303', alias: 'HR & Admin Chennai', entity: 'IN', bu: 'Shared Services', dept: 'Human Resources', type: 'Shared',
    keywords: 'recruitment; training; facilities; canteen; housekeeping; insurance', start: '2019-04-01',
    owner: ['Lakshmi Prasad', e('lakshmi.prasad'), e('ganesh.r'), e('rajesh.n')] },
  { code: 'US-SSV-401', alias: 'Corporate Office Houston', entity: 'US', bu: 'Shared Services', dept: 'Administration', type: 'Allocated',
    keywords: 'rent; insurance; legal; corporate; office lease', start: '2022-01-01',
    owner: ['John Carter', e('john.carter'), e('sarah.mitchell'), e('rajesh.n')] },
  { code: 'IN-SAL-501', alias: 'Sales India', entity: 'IN', bu: 'Sales', dept: 'Business Development', type: 'Direct',
    keywords: 'sales; client visit; travel; proposal; tender; marketing', start: '2019-04-01',
    owner: ['Anand K', e('anand.k'), e('nisha.r'), e('nisha.r')] },
  { code: 'US-SAL-601', alias: 'Sales North America', entity: 'US', bu: 'Sales', dept: 'Business Development', type: 'Direct',
    keywords: 'sales; trade show; crm; hubspot; usa', start: '2022-01-01',
    owner: ['Michael Brown', e('michael.brown'), e('anand.k'), e('nisha.r')] },
  { code: 'IN-ENG-199', alias: 'Legacy Drafting Coimbatore', entity: 'IN', bu: 'Engineering', dept: 'Drafting', type: 'Direct',
    keywords: 'drafting; coimbatore; autocad', status: 'Inactive', start: '2018-04-01', close: '2025-03-31' },
];

export const GL_GROUPS = [
  'Employee Costs',
  'Travel & Conveyance',
  'Software & Licences',
  'Rent & Facilities',
  'Professional Fees',
  'Office & Admin',
] as const;

/** Periods with published actuals (FY 2026-27, April start). */
export const SEED_PERIODS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
/** Remaining FY months: budget only (actual blank), used for full-year outturn. */
export const SEED_BUDGET_ONLY_PERIODS = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];

/** Deterministic pseudo-random in [0,1) so the demo data is stable. */
function rand(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

// Monthly budget by GL group (INR-equivalent units) per cost-centre type.
const BASE: Record<string, number[]> = {
  Direct: [1_800_000, 120_000, 260_000, 150_000, 80_000, 45_000],
  Shared: [900_000, 40_000, 180_000, 220_000, 120_000, 70_000],
  Allocated: [400_000, 30_000, 60_000, 520_000, 160_000, 50_000],
};

// Cost centres/GL lines that run deliberately over or under budget (> ±10%).
const HOTSPOTS: Record<string, Record<string, number>> = {
  'IN-ENG-101': { 'Travel & Conveyance': 1.32, 'Software & Licences': 1.18 },
  'IN-ENG-102': { 'Professional Fees': 0.72 },
  'US-ENG-201': { 'Employee Costs': 1.14 },
  'IN-SSV-302': { 'Software & Licences': 1.27 },
  'IN-SAL-501': { 'Travel & Conveyance': 1.45, 'Office & Admin': 0.8 },
  'US-SSV-401': { 'Rent & Facilities': 1.12 },
};

export function buildFinancials() {
  const rows: { cc: string; period: string; gl: string; budget: number; actual: number | null }[] = [];
  for (const cc of SEED_COST_CENTRES.filter((c) => c.status !== 'Inactive')) {
    const scale = cc.entity === 'US' ? 0.6 : 1;
    GL_GROUPS.forEach((gl, i) => {
      for (const period of SEED_PERIODS) {
        const budget = Math.round(BASE[cc.type][i] * scale * (0.95 + rand(cc.code + gl) * 0.1));
        const noise = 0.95 + rand(cc.code + gl + period) * 0.08; // within ±5%
        const factor = HOTSPOTS[cc.code]?.[gl] ?? 1;
        rows.push({ cc: cc.code, period, gl, budget, actual: Math.round(budget * noise * factor) });
      }
      for (const period of SEED_BUDGET_ONLY_PERIODS) {
        const budget = Math.round(BASE[cc.type][i] * scale * (0.95 + rand(cc.code + gl) * 0.1));
        rows.push({ cc: cc.code, period, gl, budget, actual: null });
      }
    });
  }
  return rows;
}

export async function seedData(tx: Tx) {
  for (const c of SEED_COST_CENTRES) {
    await tx.query(
      `insert into ccp.cost_centres (cc_code, cc_alias, entity, bu, department, type, keywords, status, start_date, close_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (cc_code) do nothing`,
      [c.code, c.alias, c.entity, c.bu, c.dept, c.type, c.keywords, c.status ?? 'Active', c.start, c.close ?? null],
    );
    if (c.owner) {
      await tx.query(
        `insert into ccp.cc_owners (cc_code, owner_name, owner_email, backup_owner_email, bu_head_email)
         values ($1,$2,$3,$4,$5) on conflict (cc_code) do nothing`,
        [c.code, ...c.owner],
      );
    }
  }

  const grants: [string, string, string | null][] = [
    [e('kavya.s'), 'Finance', null],
    [e('deepa.m'), 'Finance', null],
    [e('rajesh.n'), 'Mgmt', null],
    [e('vikram.iyer'), 'BU_Head', 'Engineering'],
    [e('nisha.r'), 'BU_Head', 'Sales'],
  ];
  for (const [email, role, bu] of grants) {
    await tx.query(
      `insert into ccp.cc_access (user_email, role, bu, created_by) values ($1,$2,$3,'seed')
       on conflict do nothing`,
      [email, role, bu],
    );
  }

  // Bulk insert (one statement) — far faster than row-by-row
  await tx.query(
    `insert into ccp.financials (cc_code, period, gl_group, budget, actual)
     select cc, period, gl, budget, actual
       from jsonb_to_recordset($1::jsonb) as r(cc text, period text, gl text, budget numeric, actual numeric)
     on conflict do nothing`,
    [JSON.stringify(buildFinancials())],
  );

  // Period register: seeded actuals are treated as published and reconciled
  const [{ n: periodsSeeded }] = await tx.query<{ n: number }>('select count(*)::int as n from ccp.periods');
  if (periodsSeeded === 0) {
    const [{ id }] = await tx.query<{ id: string }>(
      `insert into ccp.upload_batches (kind, file_name, file_sha256, uploaded_by, status, row_count, error_count, payload,
                                       published_at, published_by, approved_by)
       values ('financials', 'seed-data', 'seed', 'seed@system', 'Published', 0, 0, '{}'::jsonb, now(), 'seed@system', 'seed@system')
       returning id`,
    );
    await tx.query(
      `insert into ccp.periods (period, actual_total, tb_total, batch_id, published_by)
       select period, sum(actual), sum(actual), $1, 'seed@system'
         from ccp.financials where actual is not null group by period`,
      [id],
    );
  }

  // Shared-service recharges to direct cost centres
  const allocations: [string, string, number, string][] = [
    ['IN-ENG-101', 'IN-SSV-302', 145_000, 'Headcount (42 of 118)'],
    ['IN-ENG-102', 'IN-SSV-302', 62_000, 'Headcount (18 of 118)'],
    ['IN-ENG-103', 'IN-SSV-302', 55_000, 'Headcount (16 of 118)'],
    ['IN-SAL-501', 'IN-SSV-302', 31_000, 'Headcount (9 of 118)'],
    ['US-ENG-201', 'US-SSV-401', 210_000, 'Floor area (60%)'],
    ['US-SAL-601', 'US-SSV-401', 140_000, 'Floor area (40%)'],
  ];
  const existing = await tx.query<{ n: number }>('select count(*)::int as n from ccp.allocations');
  if (existing[0].n === 0) {
    for (const period of SEED_PERIODS) {
      for (const [cc, src, amount, basis] of allocations) {
        await tx.query(
          `insert into ccp.allocations (cc_code, period, source_cc, amount, basis) values ($1,$2,$3,$4,$5)`,
          [cc, period, src, amount, basis],
        );
      }
    }
  }
}

/** Runs as the privileged migration connection (not through RLS). */
export async function seed(driver: Driver) {
  await driver.transaction(async (tx) => {
    await tx.query(`select set_config('app.user_email', 'seed@system', true)`);
    await seedData(tx);
  });
}
