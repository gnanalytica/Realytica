/**
 * An uploaded table as text: a CSV or tab-separated file as it is, and an
 * Excel workbook's first sheet written out as CSV, so one parser reads what
 * was pasted and what was uploaded.
 *
 * A date cell is written as YYYY-MM-DD. Excel keeps a date as a number and
 * the workbook reader hands it over as an instant at midnight UTC, which as
 * plain text would carry a time zone and read as the day before or after.
 *
 * A cell is written as it is shown: a formula as its result, a link as its
 * words, formatted text as its runs joined, and a cell in error as nothing.
 * A workbook is opened under the same limit as any other (`workbookMayBeOpened`).
 */

import { QuestionnaireTooLarge, workbookMayBeOpened } from './questionnaire-file';

function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return String(value);
  if ('error' in value) return '';
  if ('richText' in value) return ((value as { richText?: Array<{ text?: unknown }> }).richText ?? []).map((run) => String(run.text ?? '')).join('');
  if ('formula' in value || 'sharedFormula' in value || 'result' in value) return cellText((value as { result?: unknown }).result);
  if ('text' in value) return cellText((value as { text: unknown }).text);
  return '';
}

export async function tableTextOf(file: { originalname?: string; buffer: Buffer }): Promise<string> {
  if (!(file.originalname ?? '').toLowerCase().endsWith('.xlsx')) return file.buffer.toString('utf8');
  try {
    workbookMayBeOpened(file.buffer);
  } catch (err) {
    if (err instanceof QuestionnaireTooLarge) throw new Error('That workbook is too large to open: its sheets hold more than 4 MB.');
    throw err;
  }
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
