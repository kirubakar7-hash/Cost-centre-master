import Link from 'next/link';
import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface Audit { id: number; ts: string; user_email: string; action: string; entity: string; entity_id: string | null; old_value: unknown; new_value: unknown }
interface Miss { term: string; searches: number; users: number; last_seen: string }

const fmt = (v: unknown) => (v == null ? '' : JSON.stringify(v));

export default async function AuditPage() {
  const user = await requireUser();
  if (!user.isFinance) redirect('/');
  const { audit, misses } = await withUser(user.email, async (tx) => ({
    audit: await tx.query<Audit>(`
      select id, to_char(ts, 'DD Mon YYYY HH24:MI:SS') as ts, user_email, action, entity, entity_id, old_value, new_value
        from ccp.audit_log order by id desc limit 200`),
    misses: await tx.query<Miss>(`
      select term, count(*)::int as searches, count(distinct user_email)::int as users,
             to_char(max(ts), 'DD Mon YYYY') as last_seen
        from ccp.failed_searches where ts > now() - interval '90 days'
       group by term order by count(*) desc, max(ts) desc limit 100`),
  }));

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin" className="text-sm text-brand hover:underline dark:text-brand-light">← Admin</Link>
        <h1 className="heading mt-1 text-2xl">Audit log &amp; failed searches</h1>
      </div>

      <section className="surface rounded-lg p-5">
        <h2 className="heading text-lg">Failed searches (last 90 days)</h2>
        <p className="text-sm text-muted">Terms employees searched that returned nothing — add them as keywords to the right cost centre.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-1 pr-4">Search term</th><th className="pr-4">Searches</th><th className="pr-4">Users</th><th>Last seen</th></tr></thead>
            <tbody>
              {misses.map((m) => (
                <tr key={m.term} className="border-theme border-t"><td className="py-1.5 pr-4 font-medium">{m.term}</td><td className="pr-4">{m.searches}</td><td className="pr-4">{m.users}</td><td>{m.last_seen}</td></tr>
              ))}
              {misses.length === 0 && <tr><td colSpan={4} className="py-2 text-muted">None.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="surface rounded-lg p-5">
        <h2 className="heading text-lg">Audit log (latest 200)</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="text-muted"><tr><th className="py-1 pr-3">When</th><th className="pr-3">User</th><th className="pr-3">Action</th><th className="pr-3">Entity</th><th className="pr-3">Old value</th><th>New value</th></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-theme border-t align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{a.ts}</td>
                  <td className="pr-3">{a.user_email}</td>
                  <td className={`pr-3 font-semibold ${/DENIED|REJECTED|DEACTIVATE|DELETE/.test(a.action) ? 'text-accent' : ''}`}>{a.action}</td>
                  <td className="pr-3 whitespace-nowrap">{a.entity}{a.entity_id ? ` · ${a.entity_id}` : ''}</td>
                  <td className="pr-3 max-w-xs break-all font-mono text-muted">{fmt(a.old_value)}</td>
                  <td className="max-w-xs break-all font-mono">{fmt(a.new_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
