import { withUser } from '@/lib/db';
import { errorResponse, requireFinanceApi } from '@/lib/session';
import { paramsFromUrl, reportBySlug } from '@/lib/reports';
import { collectExport } from '../_lib/exports';
import { buildWorkbook } from '../_lib/workbook';

/**
 * GET /api/admin/reports/[report]?<the report page's filters> — Excel export.
 * Finance only. The rows are read and the EXPORT event is written in the same
 * transaction, so there is no export without an audit record.
 */
export async function GET(req: Request, ctx: { params: Promise<{ report: string }> }) {
  try {
    const user = await requireFinanceApi();
    const { report } = await ctx.params;
    const def = reportBySlug(report);
    if (!def) return Response.json({ error: 'Unknown report' }, { status: 404 });

    const params = paramsFromUrl(new URL(req.url));
    const result = await withUser(user.email, async (tx) => {
      const out = await collectExport(tx, def.slug, params);
      if (!out) return null;
      const rows = out.sheets.reduce((n, s) => n + s.rows.length, 0);
      await tx.query(`select ccp.log_event('EXPORT', 'report', $1, $2::jsonb)`, [def.slug, JSON.stringify({ ...out.logDetail, rows })]);
      return out;
    });
    if (!result) return Response.json({ error: 'Not found' }, { status: 404 });

    const buf = await buildWorkbook(
      { title: result.title, filters: result.filters, generatedBy: user.email, generatedAt: new Date() },
      result.sheets,
    );
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
