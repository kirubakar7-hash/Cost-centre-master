import 'server-only';
import { redirect } from 'next/navigation';
import { requireUser, type CurrentUser } from '@/lib/session';

/** Report pages are Finance only: anyone else is sent to the home page. */
export async function requireFinancePage(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isFinance) redirect('/');
  return user;
}
