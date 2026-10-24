/**
 * Database access core (no Next.js imports, so scripts can use it too).
 *
 * Two drivers behind one interface:
 *  - Postgres / Supabase via `pg` when DATABASE_URL is set (production)
 *  - Embedded PGlite (Postgres compiled to WASM) for zero-setup local demo
 *
 * Every application query runs through `withUser`, which switches to the
 * least-privileged `cc_app` role and pins the caller's email for the
 * row-level-security policies. There is no code path that lets a request
 * read data as a privileged role.
 */
import fs from 'node:fs';
import path from 'node:path';

export type Row = Record<string, unknown>;

export interface Tx {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run a multi-statement script (no parameters). */
  script(sql: string): Promise<void>;
}

interface Driver {
  kind: 'pg' | 'pglite';
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

// Return DATE / TIMESTAMPTZ / NUMERIC as strings (no timezone drift, no float
// rounding on money); BIGINT as number (ids and counts stay well below 2^53).
const PARSERS: Record<number, (v: string) => unknown> = {
  1082: (v) => v,
  1114: (v) => v,
  1184: (v) => v,
  1700: (v) => v,
  20: (v) => Number(v),
};

async function createPgDriver(url: string): Promise<Driver> {
  const pg = await import('pg');
  const Pool = pg.default?.Pool ?? pg.Pool;
  const types = pg.default?.types ?? pg.types;
  for (const [oid, fn] of Object.entries(PARSERS)) types.setTypeParser(Number(oid), fn);

  const sslDisabled = /sslmode=disable/.test(url) || process.env.DATABASE_SSL === 'false';
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    ssl: sslDisabled ? false : { rejectUnauthorized: process.env.DATABASE_SSL_STRICT !== 'false' },
  });

  return {
    kind: 'pg',
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({
          query: async (sql, params) => (await client.query(sql, params as unknown[])).rows,
          script: async (sql) => {
            await client.query(sql);
          },
        });
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

async function createPgliteDriver(dataDir: string | undefined): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dataDir, { parsers: PARSERS });
  await db.waitReady;
  return {
    kind: 'pglite',
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: async (sql, params) => (await tx.query(sql, params)).rows as never,
          script: async (sql) => {
            await tx.exec(sql);
          },
        }),
      ),
    async exec(sql) {
      await db.exec(sql);
    },
    close: () => db.close(),
  };
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------
export function migrationsDir() {
  return path.join(process.cwd(), 'db', 'migrations');
}

export async function migrate(driver: Driver, log: (m: string) => void = () => {}) {
  await driver.exec(`create schema if not exists ccp;
    create table if not exists ccp.schema_migrations (
      name text primary key, applied_at timestamptz not null default now());`);
  const applied = new Set(
    (await driver.transaction((tx) => tx.query<{ name: string }>('select name from ccp.schema_migrations'))).map(
      (r) => r.name,
    ),
  );
  const files = fs.readdirSync(migrationsDir()).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir(), file), 'utf8');
    await driver.transaction(async (tx) => {
      await tx.script(sql);
      await tx.query('insert into ccp.schema_migrations (name) values ($1)', [file]);
    });
    log(`applied ${file}`);
  }
}

// ---------------------------------------------------------------------------
// Singleton (survives Next.js dev hot reloads)
// ---------------------------------------------------------------------------
type Holder = { driver?: Promise<Driver>; bootstrap?: (d: Driver) => Promise<void> };
const g = globalThis as unknown as { __ccpDb?: Holder };
const holder: Holder = (g.__ccpDb ??= {});

/** Optional hook used in local PGlite mode to auto-migrate and seed. */
export function setBootstrap(fn: (d: Driver) => Promise<void>) {
  holder.bootstrap = fn;
}

export function getDriver(): Promise<Driver> {
  if (!holder.driver) {
    holder.driver = (async () => {
      const url = process.env.DATABASE_URL;
      if (url) return createPgDriver(url);
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_EMBEDDED_DB !== 'true') {
        throw new Error('DATABASE_URL is required in production.');
      }
      const dir = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), '.pglite');
      const driver = await createPgliteDriver(dir === 'memory' ? undefined : dir);
      if (holder.bootstrap) await holder.bootstrap(driver);
      return driver;
    })();
    holder.driver.catch(() => {
      holder.driver = undefined;
    });
  }
  return holder.driver;
}

export async function closeDriver() {
  if (holder.driver) {
    const d = await holder.driver;
    holder.driver = undefined;
    await d.close();
  }
}

export { createPgDriver, createPgliteDriver };
export type { Driver };

// ---------------------------------------------------------------------------
// Request-scoped access
// ---------------------------------------------------------------------------
export interface UserScopeOptions {
  /** Tags audit rows written in this transaction with an upload batch id. */
  batchId?: string;
}

export async function withUserOn<T>(
  driver: Driver,
  email: string,
  fn: (tx: Tx) => Promise<T>,
  opts: UserScopeOptions = {},
): Promise<T> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) throw new Error('withUser: a user email is required');
  return driver.transaction(async (tx) => {
    await tx.query('set local role cc_app');
    await tx.query(`select set_config('app.user_email', $1, true)`, [normalized]);
    if (opts.batchId) await tx.query(`select set_config('app.batch_id', $1, true)`, [opts.batchId]);
    return fn(tx);
  });
}

export async function withUser<T>(email: string, fn: (tx: Tx) => Promise<T>, opts?: UserScopeOptions) {
  return withUserOn(await getDriver(), email, fn, opts);
}
