import { auth } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { searchCostCentres } from '@/lib/search';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return Response.json({ error: 'Not signed in' }, { status: 401 });
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 120);
  const started = performance.now();
  const results = await withUser(email, async (tx) => {
    const rows = await searchCostCentres(tx, q);
    if (rows.length === 0 && q.trim().length >= 2) await tx.query('select ccp.log_failed_search($1)', [q]);
    return rows;
  });
  return Response.json(
    { results, ms: Math.round(performance.now() - started) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
