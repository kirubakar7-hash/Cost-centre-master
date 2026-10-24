export type UploadKind = 'master' | 'owners' | 'financials' | 'allocations';

export interface TemplateDef {
  kind: UploadKind;
  title: string;
  sheet: string;
  fileName: string;
  columns: { key: string; required: boolean; help: string; example: string[] }[];
}

export const TEMPLATES: Record<UploadKind, TemplateDef> = {
  master: {
    kind: 'master',
    title: 'Cost Centre Master',
    sheet: 'CC_Master',
    fileName: 'SolidPro_CC_Master_Template.xlsx',
    columns: [
      { key: 'CC_Code', required: true, help: 'Unique code: <Entity>-<BU code>-<number>, e.g. IN-ENG-101. Prefix must equal Entity.', example: ['IN-ENG-104', 'US-SAL-602'] },
      { key: 'CC_Alias', required: true, help: 'Unique friendly name (2-80 chars), e.g. Design Chennai', example: ['Design Coimbatore', 'Sales Canada'] },
      { key: 'Entity', required: true, help: 'IN, US or UK', example: ['IN', 'US'] },
      { key: 'BU', required: true, help: 'Business unit, e.g. Engineering / Shared Services / Sales', example: ['Engineering', 'Sales'] },
      { key: 'Department', required: true, help: 'Department name', example: ['Mechanical Design', 'Business Development'] },
      { key: 'Type', required: true, help: 'Direct, Shared or Allocated', example: ['Direct', 'Direct'] },
      { key: 'Keywords', required: false, help: 'Search words separated by ; (e.g. cad; solidworks; chennai)', example: ['cad; drafting; coimbatore', 'sales; canada; toronto'] },
      { key: 'Status', required: true, help: 'Active or Inactive (Inactive needs Close_Date). Never delete rows — deactivate.', example: ['Active', 'Active'] },
      { key: 'Start_Date', required: true, help: 'YYYY-MM-DD or DD/MM/YYYY', example: ['2026-10-01', '2026-11-01'] },
      { key: 'Close_Date', required: false, help: 'Required when Status = Inactive; must be on/after Start_Date', example: ['', ''] },
    ],
  },
  owners: {
    kind: 'owners',
    title: 'Owner Mapping',
    sheet: 'Owner_Mapping',
    fileName: 'SolidPro_CC_Owner_Mapping_Template.xlsx',
    columns: [
      { key: 'CC_Code', required: true, help: 'Must exist in the master and be Active', example: ['IN-ENG-101', 'IN-SAL-501'] },
      { key: 'Owner_Name', required: true, help: 'Full name of the accountable owner', example: ['Meena Raj', 'Anand K'] },
      { key: 'Owner_Email', required: true, help: 'Company email (allowed SolidPro domain only)', example: ['meena.raj@solidpro-es.com', 'anand.k@solidpro-es.com'] },
      { key: 'Backup_Owner_Email', required: true, help: 'Company email; must differ from the owner', example: ['karthik.v@solidpro-es.com', 'nisha.r@solidpro-es.com'] },
      { key: 'BU_Head_Email', required: false, help: 'Company email of the BU head', example: ['vikram.iyer@solidpro-es.com', 'nisha.r@solidpro-es.com'] },
    ],
  },
  financials: {
    kind: 'financials',
    title: 'Budget & Actuals',
    sheet: 'Financials',
    fileName: 'SolidPro_CC_Financials_Template.xlsx',
    columns: [
      { key: 'CC_Code', required: true, help: 'Must exist in the master. Every upload REPLACES all lines for every period it contains — include every cost centre for that period.', example: ['IN-ENG-101', 'IN-ENG-101'] },
      { key: 'Period', required: true, help: 'YYYY-MM (or Oct-2026). One file may hold several periods, e.g. a month of actuals or a full-year budget.', example: ['2026-10', '2026-10'] },
      { key: 'GL_Group', required: true, help: 'GL group as mapped from the Tally export', example: ['Employee Costs', 'Travel & Conveyance'] },
      { key: 'Budget', required: true, help: 'Number (commas, currency symbols and (brackets) for negatives are accepted). Required on every row — enter 0 if there is no budget.', example: ['1800000', '120000'] },
      { key: 'Actual', required: true, help: 'Number. Leave blank ONLY for budget-only (future) months; in a month with actuals enter 0, not blank. CC actuals per period and entity must equal that entity\'s trial balance.', example: ['1765000', '158400'] },
    ],
  },
  allocations: {
    kind: 'allocations',
    title: 'Allocations',
    sheet: 'Allocations',
    fileName: 'SolidPro_CC_Allocations_Template.xlsx',
    columns: [
      { key: 'CC_Code', required: true, help: 'Receiving cost centre. Must exist, be in the same entity as the source, and be open in that period.', example: ['IN-ENG-101', 'IN-ENG-102'] },
      { key: 'Period', required: true, help: 'YYYY-MM (or Oct-2026). Not a future month. Each upload replaces the allocations for every period × Source_CC it contains (one allocation run per source).', example: ['2026-10', '2026-10'] },
      { key: 'Source_CC', required: true, help: 'Shared-service cost centre the recharge comes from (normally type Shared or Allocated). Cross-entity recharges must be booked as intercompany instead.', example: ['IN-SSV-302', 'IN-SSV-302'] },
      { key: 'Amount', required: true, help: 'Amount recharged in the entity\'s own currency. Negative for a reversal; 0 is not allowed (leave the line out).', example: ['145000', '62000'] },
      { key: 'Basis', required: true, help: 'How the amount was worked out, up to 120 characters (e.g. "Headcount 42 of 118").', example: ['Headcount (42 of 118)', 'Headcount (18 of 118)'] },
    ],
  }
};

/** Build a template workbook: data sheet (headers + examples) + Instructions sheet. */
export async function buildTemplate(kind: UploadKind): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const def = TEMPLATES[kind];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SolidPro Cost Centre Portal';
  const ws = wb.addWorksheet(def.sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = def.columns.map((c) => ({ header: c.key, key: c.key, width: Math.max(16, c.key.length + 6) }));
  // Data sheet holds the header row only: an unchanged template is rejected
  // as empty instead of loading example data. Examples live on Instructions.
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Maven Pro' };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16469D' } };
  def.columns.forEach((c, i) => {
    ws.getCell(1, i + 1).note = `${c.required ? 'Required' : 'Optional'}: ${c.help}`;
  });
  // Every cell is text so Excel does not reformat codes or dates
  ws.columns.forEach((col) => (col.numFmt = '@'));

  const info = wb.addWorksheet('Instructions');
  info.columns = [{ width: 22 }, { width: 12 }, { width: 90 }];
  info.addRow([`SolidPro Cost Centre Portal — ${def.title} template`]).font = { bold: true, size: 14, color: { argb: 'FF16469D' } };
  info.addRow([`Enter your rows on the "${def.sheet}" sheet under the header row. Keep the header row unchanged. The upload is rejected as a whole if any row has an error.`]);
  info.addRow([]);
  info.addRow(['Column', 'Required', 'Rule']).font = { bold: true };
  for (const c of def.columns) info.addRow([c.key, c.required ? 'Yes' : 'No', c.help]);
  info.addRow([]);
  info.addRow(['Example rows (for illustration only — do not copy blindly)']).font = { bold: true, color: { argb: 'FF16469D' } };
  const ex = info.addRow(def.columns.map((c) => c.key));
  ex.font = { bold: true };
  for (let i = 0; i < def.columns[0].example.length; i++) info.addRow(def.columns.map((c) => c.example[i]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
