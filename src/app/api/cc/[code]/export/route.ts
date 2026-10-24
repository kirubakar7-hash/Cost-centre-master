import { withUser } from '@/lib/db';
import { errorResponse, getCurrentUser } from '@/lib/session';
import {
  availablePeriods,
  getDetail,
  getGlBreakdown,
  getMonthlyTrend,
  getTotals,
  type CcDetail,
  type GlLine,
  type Totals,
  type TrendPoint,
} from '@/lib/financials';
import { listComments, type VarianceComment } from '@/lib/comments';
import { allocationsReceived, allocationTotals, type AllocationReceived } from '@/lib/allocations';
import { currencyOf } from '@/lib/currency';
import { fiscalYear, isPeriod, periodLabel, variance } from '@/lib/fiscal';
import { resolveAsOf } from '@/components/cc/period';

const CODE_RE = /^[A-Z]{2}-[A-Z0-9]{2,6}-[0-9]{3,4}$/;
const BLUE = 'FF16469D';
const FLAG_FILL = 'FFFDE3E4';
const AMT = '#,##0';
const PCT = '0.0%';

/** GET /api/cc/[code]/export?period=YYYY-MM — Excel workbook of one cost centre's figures. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: 'Not signed in' }, { status: 401 });

    const { code } = await ctx.params;
    if (!CODE_RE.test(code)) return Response.json({ error: 'Invalid cost centre code' }, { status: 400 });
    const requested = new URL(req.url).searchParams.get('period');
    if (requested !== null && !isPeriod(requested)) {
      return Response.json({ error: 'Invalid period (expected YYYY-MM)' }, { status: 400 });
    }

    const data = await withUser(user.email, async (tx) => {
      const detail = await getDetail(tx, code);
      if (!detail) {
        await tx.query(`select ccp.log_event('ACCESS_DENIED', 'cost_centre', $1)`, [code]);
        return null;
      }
      const asOf = resolveAsOf(requested, await availablePeriods(tx));
      const totals = await getTotals(tx, code, asOf);
      const gl = await getGlBreakdown(tx, code, asOf);
      const trend = await getMonthlyTrend(tx, code, asOf);
      const comments = await listComments(tx, code, asOf);
      const allocations = await allocationsReceived(tx, code, asOf);
      await tx.query(`select ccp.log_event('EXPORT', 'cost_centre', $1, $2::jsonb)`, [code, JSON.stringify({ period: asOf })]);
      return { detail, asOf, totals, gl, trend, comments, allocations };
    });
    // Same response for "does not exist" and "not yours".
    if (!data) return Response.json({ error: 'Not found' }, { status: 404 });

    const buf = await buildWorkbook({ ...data, userEmail: user.email });
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${code}_${data.asOf}.xlsx"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

async function buildWorkbook(d: {
  detail: CcDetail;
  asOf: string;
  totals: Totals;
  gl: GlLine[];
  trend: TrendPoint[];
  comments: VarianceComment[];
  allocations: AllocationReceived[];
  userEmail: string;
}): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  type Row = import('exceljs').Row;
  type Worksheet = import('exceljs').Worksheet;

  const { detail, asOf, totals, gl, trend, comments, allocations } = d;
  const currency = currencyOf(detail.entity);
  const fy = fiscalYear(asOf);
  const monthLabel = periodLabel(asOf);
  const ytdLabel = `YTD ${periodLabel(fy.start)} – ${monthLabel}`;
  const generatedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'SolidPro Cost Centre Portal';
  wb.created = new Date();

  const styleHeader = (row: Row) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Maven Pro' };
    row.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    });
  };
  const fillRow = (row: Row, argb: string, from: number, to: number) => {
    for (let i = from; i <= to; i++) row.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  };
  const title = (ws: Worksheet, text: string) => {
    ws.addRow([text]).font = { bold: true, size: 14, color: { argb: BLUE }, name: 'Maven Pro' };
  };
  const footer = (ws: Worksheet) => {
    ws.addRow([]);
    ws.addRow(['Internal use only — Solidpro Engineering Support Private Limited']).font = { italic: true, color: { argb: 'FF939597' } };
  };

  // ---- Summary -----------------------------------------------------------
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 28 }, { width: 22 }, { width: 22 }, { width: 22 }];
  title(sum, `Cost centre report — ${detail.cc_code} ${detail.cc_alias}`);
  sum.addRow([`As of ${monthLabel} · ${fy.label} · All amounts in ${currency}`]).font = { color: { argb: 'FF939597' } };
  sum.addRow([]);
  const masterHeader = sum.addRow(['Field', 'Value']);
  styleHeader(masterHeader);
  const master: [string, string | null][] = [
    ['CC Code', detail.cc_code],
    ['CC Alias', detail.cc_alias],
    ['Entity', detail.entity],
    ['Currency', currency],
    ['BU', detail.bu],
    ['Department', detail.department],
    ['Type', detail.type],
    ['Status', detail.status],
    ['Owner', detail.owner_name],
    ['Owner email', detail.owner_email],
    ['Backup owner email', detail.backup_owner_email],
    ['BU head email', detail.bu_head_email],
    ['Start date', detail.start_date],
    ['Close date', detail.close_date],
  ];
  for (const [k, v] of master) sum.addRow([k, v ?? '—']).getCell(1).font = { bold: true };
  sum.addRow([]);

  const monthVar = variance(totals.monthBudget, totals.monthActual);
  const outVar = variance(totals.fyBudget, totals.outturn);
  const figHeader = sum.addRow(['Measure', monthLabel, ytdLabel, `Full year ${fy.label}`]);
  styleHeader(figHeader);
  const figRows: (string | number | null)[][] = [
    ['Budget', totals.monthBudget, totals.ytdBudget, totals.fyBudget],
    ['Actual / Outturn', totals.monthActual, totals.ytdActual, totals.outturn],
    ['Variance (Actual − Budget)', monthVar.amount, totals.ytdVariance, outVar.amount],
    ['Variance %', monthVar.pct, totals.ytdVariancePct, outVar.pct],
  ];
  figRows.forEach((vals, i) => {
    const row = sum.addRow(vals);
    row.getCell(1).font = { bold: true };
    const fmt = i === 3 ? PCT : AMT;
    for (let c = 2; c <= 4; c++) row.getCell(c).numFmt = fmt;
  });
  const flaggedNote = sum.addRow([
    'Flag',
    monthVar.flagged ? 'Over ±10%' : '',
    totals.flagged ? 'Over ±10%' : '',
    '',
  ]);
  flaggedNote.getCell(1).font = { bold: true };
  sum.addRow(['Full-year outturn = YTD actual + budget for the remaining months of the fiscal year.']).font = {
    italic: true,
    color: { argb: 'FF939597' },
  };
  sum.addRow([]);
  sum.addRow(['Generated at', generatedAt]).getCell(1).font = { bold: true };
  sum.addRow(['Generated by', d.userEmail]).getCell(1).font = { bold: true };
  footer(sum);

  // ---- GL Breakdown ------------------------------------------------------
  const glWs = wb.addWorksheet('GL Breakdown', { views: [{ state: 'frozen', ySplit: 1 }] });
  glWs.columns = [
    { header: 'GL Group', width: 26 },
    { header: `${monthLabel} Budget`, width: 16 },
    { header: `${monthLabel} Actual`, width: 16 },
    { header: 'YTD Budget', width: 16 },
    { header: 'YTD Actual', width: 16 },
    { header: 'YTD Variance', width: 16 },
    { header: 'YTD Variance %', width: 15 },
    { header: 'FY Budget', width: 16 },
    { header: 'FY Outturn', width: 16 },
    { header: 'Flag', width: 14 },
  ];
  styleHeader(glWs.getRow(1));
  const glNumFmt = [AMT, AMT, AMT, AMT, AMT, PCT, AMT, AMT];
  const addGlRow = (label: string, t: Totals, bold = false) => {
    const row = glWs.addRow([
      label,
      t.monthBudget,
      t.monthActual,
      t.ytdBudget,
      t.ytdActual,
      t.ytdVariance,
      t.ytdVariancePct,
      t.fyBudget,
      t.outturn,
      t.flagged ? (t.ytdVariance > 0 ? 'Over budget' : 'Under budget') : '',
    ]);
    glNumFmt.forEach((f, i) => (row.getCell(i + 2).numFmt = f));
    if (bold) row.font = { bold: true };
    if (t.flagged) {
      fillRow(row, FLAG_FILL, 1, 10);
      row.getCell(10).font = { bold: true, color: { argb: 'FFE01A22' } };
    }
    return row;
  };
  for (const g of gl) addGlRow(g.gl_group, g);
  if (gl.length > 0) {
    const total = addGlRow('Total', totals, true);
    total.getCell(1).border = { top: { style: 'thin' } };
  }
  footer(glWs);

  // ---- Monthly Trend -----------------------------------------------------
  const trWs = wb.addWorksheet('Monthly Trend', { views: [{ state: 'frozen', ySplit: 1 }] });
  trWs.columns = [
    { header: 'Period', width: 12 },
    { header: 'Month', width: 12 },
    { header: 'Budget', width: 16 },
    { header: 'Actual', width: 16 },
    { header: 'Variance', width: 16 },
    { header: 'Variance %', width: 13 },
  ];
  styleHeader(trWs.getRow(1));
  for (const t of trend) {
    const v = t.actual === null ? null : variance(t.budget, t.actual);
    const row = trWs.addRow([t.period, periodLabel(t.period), t.budget, t.actual, v?.amount ?? null, v?.pct ?? null]);
    [AMT, AMT, AMT, PCT].forEach((f, i) => (row.getCell(i + 3).numFmt = f));
    if (v?.flagged) fillRow(row, FLAG_FILL, 1, 6);
  }
  trWs.addRow([]);
  trWs.addRow([`Actuals shown up to ${monthLabel}; later months are budget only.`]).font = { italic: true, color: { argb: 'FF939597' } };
  footer(trWs);

  // ---- Variance explanations ----------------------------------------------
  const glByName = new Map(gl.map((g) => [g.gl_group, g]));
  const exWs = wb.addWorksheet('Variance explanations', { views: [{ state: 'frozen', ySplit: 1 }] });
  exWs.columns = [
    { header: 'Period', width: 10 },
    { header: 'GL Group', width: 26 },
    { header: 'YTD Flag', width: 14 },
    { header: 'Explanation', width: 80 },
    { header: 'Author', width: 32 },
    { header: 'Added (UTC)', width: 20 },
  ];
  styleHeader(exWs.getRow(1));
  for (const c of comments) {
    const line = glByName.get(c.gl_group);
    const row = exWs.addRow([
      c.period,
      c.gl_group,
      line?.flagged ? (line.ytdVariance > 0 ? 'Over budget' : 'Under budget') : '',
      c.comment,
      c.user_email,
      c.created_at.replace('T', ' ').replace('Z', ''),
    ]);
    row.alignment = { vertical: 'top' };
    row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    if (line?.flagged) row.getCell(3).font = { bold: true, color: { argb: 'FFE01A22' } };
  }
  if (comments.length === 0) exWs.addRow(['', '', '', `No explanations recorded for ${monthLabel}.`]);
  exWs.addRow([]);
  exWs.addRow([`Explanations for ${monthLabel}, newest first. Explanations are permanent and cannot be edited.`]).font = {
    italic: true,
    color: { argb: 'FF939597' },
  };
  footer(exWs);

  // ---- Allocations received ------------------------------------------------
  const alWs = wb.addWorksheet('Allocations', { views: [{ state: 'frozen', ySplit: 1 }] });
  alWs.columns = [
    { header: 'Source CC', width: 14 },
    { header: 'Source CC Alias', width: 28 },
    { header: 'Basis', width: 30 },
    { header: `${monthLabel} Amount`, width: 18 },
    { header: 'YTD Amount', width: 18 },
  ];
  styleHeader(alWs.getRow(1));
  for (const a of allocations) {
    const row = alWs.addRow([a.source_cc, a.source_alias, a.basis, a.month, a.ytd]);
    row.getCell(4).numFmt = AMT;
    row.getCell(5).numFmt = AMT;
  }
  if (allocations.length === 0) {
    alWs.addRow(['No allocations received in this period.']);
  } else {
    const t = allocationTotals(allocations);
    const row = alWs.addRow(['Total', '', '', t.month, t.ytd]);
    row.font = { bold: true };
    row.getCell(4).numFmt = AMT;
    row.getCell(5).numFmt = AMT;
    row.getCell(1).border = { top: { style: 'thin' } };
  }
  alWs.addRow([]);
  alWs.addRow([
    `${ytdLabel}, in ${currency}. Shown for information: allocations are recharges from shared-service cost centres and are not added to the actuals.`,
  ]).font = { italic: true, color: { argb: 'FF939597' } };
  footer(alWs);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
