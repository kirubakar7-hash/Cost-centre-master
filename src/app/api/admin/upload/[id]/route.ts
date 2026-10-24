import { withUser } from '@/lib/db';
import { errorResponse, requireFinanceApi } from '@/lib/session';
import { UploadParseError } from '@/lib/upload/parse';
import { UploadError, discardUpload, enterTrialBalance, publishUpload } from '@/lib/upload/service';

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireFinanceApi();
    const { id } = await ctx.params;
    if (!UUID.test(id)) return Response.json({ error: 'Invalid id' }, { status: 400 });
    const { action, tb } = (await req.json()) as { action?: string; tb?: Record<string, unknown> };
    if (action === 'reconcile') {
      const totals: Record<string, number> = {};
      for (const [key, v] of Object.entries(tb ?? {})) {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
        if (!/^\d{4}-(0[1-9]|1[0-2])(\|(IN|US|UK))?$/.test(key) || !Number.isFinite(n))
          return Response.json({ error: `Enter a valid trial-balance total for ${key.replace('|', ' ')}` }, { status: 400 });
        totals[key] = n;
      }
      const result = await withUser(user.email, (tx) => enterTrialBalance(tx, id, totals), { batchId: id });
      return Response.json(result);
    }
    if (action === 'discard') {
      const ok = await withUser(user.email, (tx) => discardUpload(tx, id), { batchId: id });
      return Response.json({ discarded: ok });
    }
    if (action !== 'publish') return Response.json({ error: 'Unknown action' }, { status: 400 });
    const result = await withUser(user.email, (tx) => publishUpload(tx, id), { batchId: id });
    return Response.json(result, { status: result.published ? 200 : 422 });
  } catch (err) {
    if (err instanceof UploadError || err instanceof UploadParseError) return Response.json({ error: err.message }, { status: 400 });
    return errorResponse(err);
  }
}
