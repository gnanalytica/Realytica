/**
 * An uploaded table as text: a CSV or tab-separated file as it is, and an
 * Excel workbook's first sheet written out as CSV, so one parser reads what
 * was pasted and what was uploaded.
 *
 * A date cell is written as YYYY-MM-DD. Excel keeps a date as a number and
 * the workbook reader hands it over as an instant at midnight UTC, which as
 * plain text would carry a time zone and read as the day before or after.
 */

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'result' in value) return cellText((value as { result: unknown }).result);
  if (typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text ?? '');
  return String(value);
}

export async function tableTextOf(file: { originalname?: string; buffer: Buffer }): Promise<string> {
  if (!(file.originalname ?? '').toLowerCase().endsWith('.xlsx')) return file.buffer.toString('utf8');
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('That workbook has no sheet.');
  const lines: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = (Array.isArray(row.values) ? (row.values as unknown[]).slice(1) : []).map((value) => cellText(value).replace(/\s*\n\s*/g, ' '));
    lines.push(cells.map((cell) => (/[",]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','));
  });
  return lines.join('\n');
}
