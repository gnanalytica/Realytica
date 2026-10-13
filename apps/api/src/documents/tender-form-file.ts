/**
 * The tender form as a workbook to send to the client: the title, the lines
 * that name the project, the package and the days, the six columns, the ten
 * sections with their rows, and the signature block. It is laid out as the
 * form is read (`parseTenderFormRows`), so the copy that comes back filled
 * is read into the same fields.
 */

import { tenderFormTable, type TenderFormOut } from '@realytica/shared';

const WIDTHS = [8, 44, 46, 44, 28, 24];

/** A cell that opens with a sign a spreadsheet reads as a formula is written as text. */
const safe = (cell: string): string => (/^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell);

export async function tenderFormXlsx(out: TenderFormOut): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Tender information');
  sheet.columns = WIDTHS.map((width) => ({ width }));
  const sections = new Set(out.rows.filter((row) => row.section).map((row) => row.cells.join('|')));
  for (const cells of tenderFormTable(out)) {
    const row = sheet.addRow(cells.map(safe));
    row.alignment = { wrapText: true, vertical: 'top' };
    const heads = cells.length === out.columns.length && cells.every((cell, n) => cell === out.columns[n]);
    if (cells[0] === out.title || heads || sections.has(cells.join('|'))) row.font = { bold: true, ...(cells[0] === out.title ? { size: 13 } : {}) };
    if (heads) {
      row.eachCell((cell) => {
        cell.border = { bottom: { style: 'thin' } };
      });
      sheet.views = [{ state: 'frozen', ySplit: row.number }];
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
