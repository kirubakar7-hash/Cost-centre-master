/* Usage: npm run db:migrate | db:seed | db:reset (reset only for PGlite/local) */
import { closeDriver, getDriver, migrate } from '../src/lib/db/core';
import { seed } from '../src/lib/db/seed';

async function main() {
  const cmd = process.argv[2];
  const driver = await getDriver();
  if (cmd === 'reset') {
    if (process.env.DATABASE_URL && process.env.CONFIRM_RESET !== 'yes') {
      throw new Error('Refusing to reset a remote database without CONFIRM_RESET=yes');
    }
    await driver.exec('drop schema if exists ccp cascade');
  }
  await migrate(driver, console.log);
  if (cmd === 'seed' || cmd === 'reset') {
    await seed(driver);
    console.log('seeded demo data');
  }
  await closeDriver();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
