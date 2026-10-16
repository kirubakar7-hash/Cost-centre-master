import 'server-only';
import { migrate, setBootstrap } from './core';
import { seed } from './seed';

// Local demo mode (no DATABASE_URL): auto-create schema and demo data in PGlite.
setBootstrap(async (driver) => {
  await migrate(driver);
  const [{ n }] = await driver.transaction((tx) =>
    tx.query<{ n: number }>('select count(*)::int as n from ccp.cost_centres'),
  );
  if (n === 0) await seed(driver);
});

export { withUser } from './core';
export type { Tx } from './core';
