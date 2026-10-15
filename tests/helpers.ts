/** Shared test helpers: a fresh in-memory PGlite database with schema + demo seed. */
import { createPgliteDriver, migrate, withUserOn, type Driver, type Row, type Tx } from '../src/lib/db/core';
import { seed, DEMO_DOMAIN } from '../src/lib/db/seed';

export const ARUN = `arun.kumar@${DEMO_DOMAIN}`; // Employee, no grants
export const MEENA = `meena.raj@${DEMO_DOMAIN}`; // Owner of IN-ENG-101, IN-ENG-102
export const VIKRAM = `vikram.iyer@${DEMO_DOMAIN}`; // BU head, Engineering
export const KAVYA = `kavya.s@${DEMO_DOMAIN}`; // Finance
export const RAJESH = `rajesh.n@${DEMO_DOMAIN}`; // Mgmt / CFO

export async function freshDb(): Promise<Driver> {
  const driver = await createPgliteDriver(undefined);
  await migrate(driver);
  await seed(driver);
  return driver;
}

/** Reset an existing database to the freshly seeded state (cheaper than a new PGlite instance). */
export async function resetDb(driver: Driver): Promise<void> {
  await driver.exec('drop schema if exists ccp cascade');
  await migrate(driver);
  await seed(driver);
}

/** Run as the privileged (migration) connection — bypasses RLS. */
export function asSuper<T = Row>(driver: Driver, sql: string, params?: unknown[]): Promise<T[]> {
  return driver.transaction((tx) => tx.query<T>(sql, params));
}

/** Run one statement as an application user (cc_app role + app.user_email). */
export function as<T = Row>(driver: Driver, email: string, sql: string, params?: unknown[]): Promise<T[]> {
  return withUserOn(driver, email, (tx) => tx.query<T>(sql, params));
}

export type { Driver, Tx };
