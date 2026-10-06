/**
 * A questionnaire as a file: read from one, and taken out as one.
 *
 * In, from Word (.docx), a spreadsheet saved as .csv, plain text, Excel
 * (.xlsx) and PDF. Out, as Excel and as PDF, each answer with where it came
 * from and the paper and page behind it. The questions and their order are
 * the sender's own, in and out (`questionnaire.ts`).
 *
 * `exceljs` is loaded only when a workbook is read or written: it is large,
 * and most requests have nothing to do with it.
 */
import {
  QUESTIONNAIRE_COLUMNS,
  parseQuestionnaire,
  parseQuestionnaireCsv,
  parseQuestionnairePages,
  parseQuestionnaireRows,
  parseQuestionnaireText,
  questionnaireRows,
  questionnaireSummary,
  type DdProject,
  type ParsedQuestionnaire,
  type Questionnaire,
} from '@realytica/shared';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { docxOutline } from './docx-outline';
import { readDocumentText } from './read-text';

/** The kinds of file a questionnaire is read from, by the end of the name. */
export const QUESTIONNAIRE_FILE = /\.(?:docx|csv|tsv|txt|md|xlsx|pdf)$/i;

export const QUESTIONNAIRE_FILE_SAID =
  'A questionnaire is read from Excel (.xlsx), Word (.docx), PDF, a spreadsheet saved as .csv, or plain text. Save it as one of those, or paste the questions.';

export interface ReadQuestionnaire {
  parsed: ParsedQuestionnaire;
  /** A sheet that names its Question column: what tells a questionnaire from any other table. */
  namedColumn?: boolean;
}

/**
 * The questions in a file, as it wrote them. Null for a kind of file no
 * questionnaire is read from. `pages` is a PDF's text where the caller has
 * read it already, so it is not read twice.
 */
export async function readQuestionnaireFile(file: { originalname: string; buffer: Buffer }, pages?: readonly string[]): Promise<ReadQuestionnaire | null> {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.docx')) return { parsed: parseQuestionnaire(docxOutline(file.buffer)) };
  if (name.endsWith('.xlsx')) return readWorkbook(file.buffer);
  if (name.endsWith('.pdf')) {
    const text = pages ?? (await readDocumentText(new Uint8Array(file.buffer), 'application/pdf', file.originalname)).pages;
    return { parsed: parseQuestionnairePages(text) };
  }
  const text = file.buffer.toString('utf8');
  if (name.endsWith('.csv') || name.endsWith('.tsv')) {
    return { parsed: parseQuestionnaireCsv(text), namedColumn: /\b(?:question|query)/i.test(text.split(/\r?\n/, 1)[0] ?? '') };
  }
  if (name.endsWith('.txt') || name.endsWith('.md')) return { parsed: parseQuestionnaireText(text) };
  return null;
}

/**
 * The sheet of a workbook that is the questionnaire: the one that names a
 * Question column, else the one with the most rows written. Each cell as it
 * is shown (`cell.text`), so a formula gives its result and a date its
 * written form.
 */
async function readWorkbook(buffer: Buffer): Promise<ReadQuestionnaire> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  // exceljs is typed for an older Buffer than this Node's; the bytes are the same.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  let best: (ParsedQuestionnaire & { named: boolean }) | undefined;
  for (const sheet of workbook.worksheets) {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        cells[column - 1] = String(cell.text ?? '');
      });
      rows.push(Array.from(cells, (cell) => cell ?? ''));
    });
    const parsed = parseQuestionnaireRows(rows);
    if (!best || (parsed.named && !best.named) || (parsed.named === best.named && parsed.questions.length > best.questions.length)) best = parsed;
  }
  const { named, ...parsed } = best ?? { header: [], questions: [], named: false };
  return { parsed, namedColumn: named };
}

/* ==================================================================== */
/* Out                                                                   */
/* ==================================================================== */

const WIDTHS = [6, 18, 52, 52, 16, 32, 14];

/**
 * The answered sheet as an Excel workbook: its name and the facts at its
 * head, then one row a question in the order sent, with the answer, where it
 * came from, the paper and page behind it, and whether a person has confirmed
 * it. Read back in, it is the same questionnaire.
 */
export async function questionnaireXlsx(project: DdProject, questionnaire: Questionnaire): Promise<Buffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Answers');
  sheet.columns = WIDTHS.map((width) => ({ width }));
  sheet.addRow([questionnaire.title]).font = { bold: true, size: 13 };
  sheet.addRow(['Project', `${project.reference} ${project.name}`]);
  for (const fact of questionnaire.header) sheet.addRow([fact.label, fact.value]);
  sheet.addRow([]);
  const head = sheet.addRow([...QUESTIONNAIRE_COLUMNS]);
  head.font = { bold: true };
  head.eachCell((cell) => {
    cell.border = { bottom: { style: 'thin' } };
  });
  for (const cells of questionnaireRows(project, questionnaire)) {
    const row = sheet.addRow(cells);
    row.alignment = { wrapText: true, vertical: 'top' };
  }
  sheet.views = [{ state: 'frozen', ySplit: head.number }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.42, 0.46);

/** What the built-in PDF fonts cannot print, in the nearest words they can. */
const PLAIN: Array<[RegExp, string]> = [
  [/₹/g, 'Rs '],
  [/[‘’ʼ]/g, "'"],
  [/[“”]/g, '"'],
  [/…/g, '...'],
  [/[   ]/g, ' '],
];

/**
 * The answered sheet as a PDF: each question in the order sent, its answer
 * under it, and under that where the answer came from, the paper and page
 * behind it and whether a person has confirmed it.
 *
 * Drawn in the PDF's own fonts, which print Latin letters only. A letter they
 * cannot print is shown as "?", and the page says so and names the Excel
 * copy, which holds every letter as written.
 */
export async function questionnairePdf(project: DdProject, questionnaire: Questionnaire): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(questionnaire.title);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const printable = new Set(regular.getCharacterSet());
  let unprinted = false;
  const plain = (text: string): string => {
    let out = text.replace(/\s+/g, ' ').trim();
    for (const [from, to] of PLAIN) out = out.replace(from, to);
    return [...out]
      .map((ch) => {
        if (printable.has(ch.codePointAt(0)!)) return ch;
        unprinted = true;
        return '?';
      })
      .join('');
  };

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - MARGIN;
  const width = A4[0] - MARGIN * 2;
  const wrap = (text: string, font: PDFFont, size: number, room: number): string[] => {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(next, size) > room) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const write = (text: string, opts: { font?: PDFFont; size?: number; indent?: number; color?: ReturnType<typeof rgb>; gap?: number } = {}): void => {
    const { font = regular, size = 10, indent = 0, color = INK, gap = 0 } = opts;
    const printed = plain(text);
    if (!printed) return;
    for (const line of wrap(printed, font, size, width - indent)) {
      if (y < MARGIN + size * 1.4) {
        page = doc.addPage(A4);
        y = A4[1] - MARGIN;
      }
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font, color });
      y -= size * 1.4;
    }
    y -= gap;
  };

  const sum = questionnaireSummary(questionnaire);
  write(questionnaire.title, { font: bold, size: 15, gap: 2 });
  write(`${project.reference} ${project.name}`, { size: 9, color: MUTED });
  for (const fact of questionnaire.header) write(`${fact.label}: ${fact.value}`, { size: 9, color: MUTED });
  write(
    `${sum.total} question${sum.total === 1 ? '' : 's'}: ${sum.answered} answered, ${sum.suggested} suggested and not confirmed, ${sum.unanswered} open.`,
    { size: 9, color: MUTED, gap: 10 },
  );

  let section = '';
  for (const [no, heading, question, answer, source, proof, status] of questionnaireRows(project, questionnaire) as Array<[string, string, string, string, string, string, string]>) {
    if (heading && heading !== section) {
      section = heading;
      write(heading.toUpperCase(), { font: bold, size: 8.5, color: MUTED, gap: 2 });
    }
    write(`${no}. ${question}`, { font: bold, size: 10.5 });
    write(answer || 'Not answered.', { indent: 14, color: answer ? INK : MUTED });
    const footing = [source, proof, answer ? status : ''].filter(Boolean).join(' · ');
    if (footing) write(footing, { indent: 14, size: 8.5, color: MUTED });
    y -= 8;
  }
  if (unprinted) write('A letter this file cannot print is shown as "?". The Excel copy holds every letter as written.', { size: 8.5, color: MUTED });
  return Buffer.from(await doc.save());
}
