import { withUser } from '@/lib/db';
import { errorResponse, getCurrentUser } from '@/lib/session';
import { addComment, CommentError } from '@/lib/comments';
import { isPeriod } from '@/lib/fiscal';
import { isCrossOrigin } from '../../_lib/origin';

const CODE_RE = /^[A-Z]{2}-[A-Z0-9]{2,6}-[0-9]{3,4}$/;
const MAX_BODY_CHARS = 16_000; // a 2,000-character comment is far below this, even fully escaped

/**
 * POST /api/cc/[code]/comments — add a variance explanation as the signed-in user.
 * Body (JSON): { period: "YYYY-MM", glGroup: string, comment: string }
 * 201 → the created comment. 400 invalid input · 401 not signed in ·
 * 403 cross-site request or not allowed to comment on this cost centre.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    if (isCrossOrigin(req.headers)) {
      return Response.json({ error: 'Cross-site request refused' }, { status: 403 });
    }
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });

    const { code } = await ctx.params;
    if (!CODE_RE.test(code)) return Response.json({ error: 'Invalid cost centre code' }, { status: 400 });
    if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return Response.json({ error: 'Send the comment as JSON' }, { status: 415 });
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY_CHARS) return Response.json({ error: 'Request too large' }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { period, glGroup, comment } = (body ?? {}) as Record<string, unknown>;
    if (typeof period !== 'string' || !isPeriod(period)) {
      return Response.json({ error: 'Invalid period (expected YYYY-MM)' }, { status: 400 });
    }
    if (typeof glGroup !== 'string' || typeof comment !== 'string') {
      return Response.json({ error: 'glGroup and comment are required' }, { status: 400 });
    }

    try {
      const created = await withUser(user.email, (tx) => addComment(tx, { code, period, glGroup, comment }));
      return Response.json({ comment: created }, { status: 201 });
    } catch (err) {
      if (!(err instanceof CommentError)) throw err;
      if (err.kind === 'forbidden') {
        // The failed transaction rolled back; record the attempt separately.
        await withUser(user.email, (tx) =>
          tx.query(`select ccp.log_event('ACCESS_DENIED', 'comment', $1, $2::jsonb)`, [code, JSON.stringify({ period, gl_group: glGroup })]),
        ).catch(() => {});
        return Response.json({ error: err.message }, { status: 403 });
      }
      return Response.json({ error: err.message }, { status: 400 });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
