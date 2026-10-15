import { withUser } from '@/lib/db';
import { errorResponse, requireFinanceApi } from '@/lib/session';
import { TEMPLATES, buildTemplate, type UploadKind } from '@/lib/upload/templates';

export async function GET(_req: Request, ctx: { params: Promise<{ kind: string }> }) {
  try {
    const user = await requireFinanceApi();
    const { kind } = await ctx.params;
    if (!(kind in TEMPLATES)) return Response.json({ error: 'Unknown template' }, { status: 404 });
    const buf = await buildTemplate(kind as UploadKind);
    await withUser(user.email, (tx) => tx.query(`select ccp.log_event('TEMPLATE_DOWNLOAD', 'template', $1)`, [kind]));
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${TEMPLATES[kind as UploadKind].fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
