/** Parse an uploaded .xlsx or .csv into header-keyed string rows. */
export interface ParsedRow {
  row: number; // spreadsheet row number (header = 1)
  values: Record<string, string>;
}
export interface ParsedFile {
  headers: string[];
  rows: ParsedRow[];
}

export class UploadParseError extends Error {}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
export const MAX_FINANCIAL_ROWS = 60000;

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.result !== undefined) return cellToString(o.result);
    if (o.text !== undefined) return String(o.text);
    return '';
  }
  return String(v);
}

function toParsed(matrix: string[][]): ParsedFile {
  const nonEmpty = (r: string[]) => r.some((c) => c.trim() !== '');
  const headerIdx = matrix.findIndex(nonEmpty);
  if (headerIdx < 0) return { headers: [], rows: [] };
  const headers = matrix[headerIdx].map((h) => h.trim());
  const rows: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    if (!nonEmpty(matrix[i])) continue;
    const values: Record<string, string> = {};
    headers.forEach((h, j) => {
      if (h) values[h] = (matrix[i][j] ?? '').trim();
    });
    rows.push({ row: i + 1, values });
  }
  return { headers: headers.filter(Boolean), rows };
}

export async function parseUpload(fileName: string, data: Buffer, preferredSheet?: string): Promise<ParsedFile> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return toParsed(parseCsv(data.toString('utf8')));
  if (!lower.endsWith('.xlsx')) throw new UploadParseError('Only .xlsx or .csv files are accepted.');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new UploadParseError('The file could not be read as an Excel workbook.');
  }
  const ws = (preferredSheet && wb.getWorksheet(preferredSheet)) || wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  const matrix: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (r, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(cellToString(r.getCell(c).value));
    matrix[rowNumber - 1] = cells;
  });
  for (let i = 0; i < matrix.length; i++) matrix[i] ??= [];
  return toParsed(matrix);
}
