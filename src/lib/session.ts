import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from './auth';
import { withUser } from './db';

export type PrimaryRole = 'Finance' | 'Mgmt' | 'BU_Head' | 'Owner' | 'Employee';

export interface CurrentUser {
  email: string;
  name: string;
  roles: string[];
  primaryRole: PrimaryRole;
  isFinance: boolean;
}

const ROLE_LABEL: Record<PrimaryRole, string> = {
  Finance: 'Finance Admin',
  Mgmt: 'Management',
  BU_Head: 'BU Head',
  Owner: 'CC Owner',
  Employee: 'Employee',
};
export const roleLabel = (r: PrimaryRole) => ROLE_LABEL[r];

/**
 * Resolve the signed-in user and their roles. Roles are read from the
 * database on every request (never cached in the cookie), so revoking
 * access in the master takes effect immediately.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  const [{ roles }] = await withUser(email, (tx) => tx.query<{ roles: string[] }>('select ccp.my_roles() as roles'));
  const has = (r: string) => roles.includes(r);
  const primaryRole: PrimaryRole = has('Finance')
    ? 'Finance'
    : has('Mgmt')
      ? 'Mgmt'
      : has('BU_Head')
        ? 'BU_Head'
        : has('Owner') || has('Backup')
          ? 'Owner'
          : 'Employee';
  return { email, name: session.user?.name ?? email, roles, primaryRole, isFinance: has('Finance') };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** For route handlers: throws 401/403 instead of redirecting. */
export async function requireFinanceApi(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, 'Not signed in');
  if (!user.isFinance) {
    await withUser(user.email, (tx) => tx.query(`select ccp.log_event('ACCESS_DENIED', 'admin_api')`)).catch(() => {});
    throw new HttpError(403, 'Finance Admin access required');
  }
  return user;
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  console.error(err);
  return Response.json({ error: 'Unexpected error' }, { status: 500 });
}
