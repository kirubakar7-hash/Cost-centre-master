import { auth, signOut } from '@/lib/auth';
import { withUser } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  const reason = new URL(req.url).searchParams.get('reason') === 'idle' ? 'idle' : 'signout';
  if (session?.user?.email) {
    await withUser(session.user.email, (tx) =>
      tx.query(`select ccp.log_event('LOGOUT', 'session', null, $1::jsonb)`, [JSON.stringify({ reason })]),
    ).catch(() => {});
  }
  await signOut({ redirectTo: `/login?reason=${reason}` });
}
