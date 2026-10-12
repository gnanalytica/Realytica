/**
 * A template as a file: its blanks found, the same file filled, and the
 * list of sources that goes out beside it.
 *
 * In, a Word file (.docx) or a workbook (.xlsx). Out, the same kind of file
 * with only what a person accepted or typed written into it, and a PDF that
 * lists each value written with the paper and page or the record entry it
 * came from and who accepted it, and each blank left empty with why.
 */

import { TEMPLATE_LIMITS, templateSourceList, templateValues, type DdProject, type DetectedField, type FillTemplate, type TemplateFormat } from '@realytica/shared';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { QuestionnaireTooLarge, WorkbookPartsTooLarge } from './questionnaire-file';
import { detectDocxFields, fillDocx } from './template-docx';
import { detectXlsxFields, fillXlsx } from './template-xlsx';
import { ZipTooLarge } from './zip';

export const TEMPLATE_FILE_SAID = 'A template is a Word file (.docx) or an Excel workbook (.xlsx). Save the form as one of those and send it again.';

export const TEMPLATE_MIME: Record<TemplateFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** A file too large to open as a template. Its message is for the person who sent it. */
export class TemplateTooLarge extends Error {}

/** The kind of template a file is, by the end of its name. Null for any other file. */
export function templateFormatOf(fileName: string): TemplateFormat | null {
  const m = /\.(docx|xlsx)$/i.exec(fileName);
  return m ? (m[1]!.toLowerCase() as TemplateFormat) : null;
}

/**
 * The blanks of a file, in its own order. Refuses a file that unpacks to
 * more than may be opened, before anything reads it.
 */
export async function detectTemplateFields(file: { originalname: string; buffer: Buffer }): Promise<{ format: TemplateFormat; detected: DetectedField[] }> {
  const format = templateFormatOf(file.originalname);
  if (!format) throw new Error(TEMPLATE_FILE_SAID);
  if (file.buffer.length > TEMPLATE_LIMITS.fileBytes) throw new TemplateTooLarge('That file is larger than 4 MB, the most a template may be.');
  try {
    return { format, detected: format === 'docx' ? detectDocxFields(file.buffer) : await detectXlsxFields(file.buffer) };
  } catch (err) {
    if (err instanceof ZipTooLarge) throw new TemplateTooLarge(err.message);
    if (err instanceof WorkbookPartsTooLarge) throw new TemplateTooLarge(err.message);
    if (err instanceof QuestionnaireTooLarge) throw new TemplateTooLarge('That workbook is too large to open as a template: its sheets hold more than 4 MB. Save the form as a file of its own and send that.');
    throw err;
  }
}

/** The file as it was sent, with what a person accepted or typed written into its blanks, and nothing else. */
export async function filledTemplateFile(template: FillTemplate, original: Buffer): Promise<Buffer> {
  const values = templateValues(template);
  return template.format === 'docx' ? fillDocx(original, values) : fillXlsx(original, values);
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
  [/[–—]/g, '-'],
  [/[   ]/g, ' '],
];

/**
 * The list of sources for a filled template, as a PDF: a page for a form of
 * usual length, more where it runs on. Each value written, where it went,
 * what it was taken from and how that stands; then each blank left empty,
 * and why.
 *
 * Drawn in the PDF's own fonts, which print Latin letters only. A letter
 * they cannot print is shown as "?", and the page says so.
 */
export async function templateSourcesPdf(project: DdProject, template: FillTemplate): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${template.title}: sources`);
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
    const { font = regular, size = 9, indent = 0, color = INK, gap = 0 } = opts;
    const printed = plain(text);
    if (!printed) return;
    for (const line of wrap(printed, font, size, width - indent)) {
      if (y < MARGIN + size * 1.35) {
        page = doc.addPage(A4);
        y = A4[1] - MARGIN;
      }
      page.drawText(line, { x: MARGIN + indent, y: y - size, size, font, color });
      y -= size * 1.35;
    }
    y -= gap;
  };

  const { written, empty } = templateSourceList(project, template);
  write(`${template.title}: sources`, { font: bold, size: 14, gap: 2 });
  write(`${project.reference} ${project.name} · ${template.fileName} · ${new Date().toISOString().slice(0, 10)}`, { size: 8.5, color: MUTED });
  write(`${written.length} value${written.length === 1 ? '' : 's'} written, ${empty.length} blank${empty.length === 1 ? '' : 's'} left empty. Only what a named person accepted or typed is in the file.`, { size: 8.5, color: MUTED, gap: 8 });

  if (written.length) write('WRITTEN', { font: bold, size: 8, color: MUTED, gap: 2 });
  written.forEach((line, n) => {
    write(`${n + 1}. ${line.label}: ${line.value}`, { font: bold });
    write(`${line.where} · ${line.source} · ${line.standing}`, { indent: 12, size: 8, color: MUTED, gap: 3 });
  });
  if (empty.length) {
    y -= 4;
    write('LEFT EMPTY', { font: bold, size: 8, color: MUTED, gap: 2 });
    for (const line of empty) write(`${line.label} (${line.where}): ${line.why}.`, { size: 8.5 });
  }
  if (unprinted) write('A letter this page cannot print is shown as "?". The filled file holds every letter as written.', { size: 8, color: MUTED });
  return Buffer.from(await doc.save());
}
