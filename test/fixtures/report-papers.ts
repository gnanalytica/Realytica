/**
 * Invented reports as PDFs, built as the tests run.
 *
 * - A cost consultant's monthly cost report with a text layer: a cover, the
 *   cost table (test/fixtures/cost-report.ts) set cell by cell, and a page of
 *   photograph captions.
 * - The same report as a page of type with a picture set on it: a heading and
 *   a footer in type, and the table, or two photographs, as one picture.
 * - A technical due diligence report: two typed pages of numbered
 *   observations, each with what was seen, a risk category and a
 *   recommendation, in the two ways such a list is written.
 * - The cost report with its table set in cells, as a spreadsheet prints it:
 *   headings wrapped over three lines, a long name and a contractor wrapped
 *   over two, and every figure at the middle of its cell, set to the right.
 *
 * Every name, figure and observation is made up.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { COST_HEADINGS, COST_LINES } from './cost-report';

const A4_ACROSS: [number, number] = [842, 595];

function lines(page: PDFPage, font: PDFFont, said: string[], from = 520, size = 12): void {
  said.forEach((line, n) => page.drawText(line, { x: 50, y: from - n * (size + 8), size, font }));
}

const COVER = ['MONTHLY COST REPORT', 'Cost Report No. 5 - August 2026', 'Lakeview Residences, Mysuru', 'Prepared by Meridian Cost Consultants for Lakeview Homes', 'Built-up area 1,20,000 sq ft', 'INVENTED FOR TESTS - NOT A REAL REPORT'];

/** Where each column of the cost table starts on the page. */
const COLUMN_AT = [30, 58, 270, 360, 450, 590, 690, 780];

/** A cost report with a text layer: every cell of its table is type. */
export async function costReportWithTextLayer(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  lines(pdf.addPage(A4_ACROSS), font, COVER, 480, 16);
  const table = pdf.addPage(A4_ACROSS);
  table.drawText('COST SUMMARY - BUDGET AGAINST ANTICIPATED FINAL COST', { x: 30, y: 555, size: 11, font });
  [COST_HEADINGS, ...COST_LINES].forEach((cells, row) => {
    cells.forEach((cell, column) => {
      if (cell) table.drawText(cell, { x: COLUMN_AT[column]!, y: 530 - row * 22, size: 7, font });
    });
  });
  table.drawText('All amounts in Indian rupees. GST shown separately.', { x: 30, y: 40, size: 8, font });
  lines(pdf.addPage(A4_ACROSS), font, ['SITE PROGRESS PHOTOGRAPHS', 'Photo 1: Tower A - third floor slab reinforcement in progress', 'Photo 2: Tower B - blockwork to the second floor']);
  return pdf.save();
}

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(path.resolve('test/fixtures/documents', name)));

/**
 * A cost report whose pages are type round a picture: a cover in type, then a
 * page with a heading and a footer in type and one large picture on it, the
 * cost table or two site photographs.
 */
export async function costReportWithPictureOn(what: 'table' | 'photographs'): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  lines(pdf.addPage(A4_ACROSS), font, COVER, 480, 16);
  const page = pdf.addPage(A4_ACROSS);
  page.drawText('Lakeview Residences, Mysuru - Cost Report No. 5 - August 2026', { x: 30, y: 570, size: 9, font });
  const picture = what === 'table' ? await pdf.embedPng(fixture('Cost_Report_Table_Picture.png')) : await pdf.embedJpg(fixture('Cost_Report_Photographs_Picture.jpg'));
  page.drawImage(picture, { x: 30, y: 40, width: 782, height: 520 });
  page.drawText('Meridian Cost Consultants - page 2 of 2', { x: 30, y: 20, size: 8, font });
  return pdf.save();
}

/** The thirteen observations of the invented due diligence report: what it is of, what was seen, the risk, and what is recommended. */
export const OBSERVATIONS: Array<{ of: string; seen: string; risk: 'Critical' | 'High' | 'Medium' | 'Low'; action: string }> = [
  { of: 'Basement retaining wall', seen: 'Seepage along the construction joint at grid C-4, with staining to the floor below.', risk: 'High', action: 'Inject the joint with polyurethane grout and test again after the monsoon.' },
  { of: 'Third floor slab', seen: 'Honeycombing at the soffit near column C7, about 0.4 sqm.', risk: 'Medium', action: 'Break out the loose concrete and repair with non-shrink grout.' },
  { of: 'Ground floor columns', seen: 'Concrete cover measured at 18 mm against 40 mm on the drawing at four columns.', risk: 'High', action: 'Have the structural engineer assess, and apply a protective coating.' },
  { of: 'Terrace', seen: 'Ponding of water at the north-east corner after rain.', risk: 'Medium', action: 'Re-lay the screed to falls and renew the waterproofing membrane.' },
  { of: 'Fire fighting', seen: 'The sprinkler main is not yet connected to the pump room.', risk: 'Critical', action: 'Complete the connection before any floor is occupied.' },
  { of: 'Electrical rooms', seen: 'Earthing pits are not marked and no test record was available.', risk: 'Medium', action: 'Mark the pits and file the earth resistance test record.' },
  { of: 'Lift shafts', seen: 'The shaft of lift 2 is out of plumb by 22 mm over three floors.', risk: 'High', action: 'Survey the shaft and agree the tolerance with the lift supplier.' },
  { of: 'External walls', seen: 'Cracks at the junction of blockwork and beam on the west face.', risk: 'Low', action: 'Fix a mesh across the junction before plastering.' },
  { of: 'Plumbing shafts', seen: 'Pipes pass through slabs with no sleeves at the fourth floor.', risk: 'Medium', action: 'Core and sleeve the openings and seal them against fire.' },
  { of: 'Storm water drain', seen: 'The drain along the south boundary is silted and blocked.', risk: 'Low', action: 'Desilt the drain and fix gratings.' },
  { of: 'Statutory records', seen: 'The commencement certificate was not on the site file.', risk: 'High', action: 'Obtain a copy from the authority and keep it on site.' },
  { of: 'Staircase 2', seen: 'Riser heights vary between 150 mm and 175 mm on the second flight.', risk: 'Medium', action: 'Correct the risers in the screed before finishes.' },
  { of: 'Basement ventilation', seen: 'Exhaust fans are installed and no commissioning record was produced.', risk: 'Low', action: 'Commission the fans and record the air changes achieved.' },
];

const DD_COVER = ['TECHNICAL DUE DILIGENCE REPORT', 'Lakeview Residences, Mysuru', 'Site visit of 12 August 2026 - visual inspection of the works in progress', 'Prepared by Plumbline Engineers', 'INVENTED FOR TESTS - NOT A REAL REPORT'];

/**
 * A technical due diligence report with a text layer. `as` says how its
 * observations are written: as the rows of a table (numbered lines, the risk
 * between what was seen and what is recommended, long cells running on to a
 * second line) or with a label to each part. Seven observations to the first
 * page and six to the second.
 */
export async function dueDiligenceReport(as: 'table' | 'labelled' = 'table'): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = [OBSERVATIONS.slice(0, 7), OBSERVATIONS.slice(7)];
  pages.forEach((held, index) => {
    const page = pdf.addPage(A4_ACROSS);
    let y = 560;
    const say = (text: string, size = 8): void => {
      page.drawText(text, { x: 30, y, size, font });
      y -= size + 6;
    };
    if (index === 0) {
      DD_COVER.forEach((line, n) => say(line, n === 0 ? 14 : 9));
      say('Summary of observations, with the risk category and the mitigation recommended for each');
      if (as === 'table') say('Sl No   Observation   Risk category   Mitigation recommended');
    }
    held.forEach((one, n) => {
      const number = index * 7 + n + 1;
      if (as === 'labelled') {
        say(`Observation ${number}: ${one.of}`);
        say(one.seen);
        say(`Risk category: ${one.risk}`);
        say(`Mitigation: ${one.action}`);
        return;
      }
      // A table's row: the cells of one line, then what ran over to the next.
      const words = `${one.of}: ${one.seen}`.split(' ');
      const first = words.slice(0, 12).join(' ');
      const rest = words.slice(12).join(' ');
      if (rest) {
        say(`${number} ${first}`);
        say(`${rest} ${one.risk} ${one.action}`);
      } else say(`${number} ${first} ${one.risk} ${one.action}`);
    });
  });
  return pdf.save();
}

/** Where each column of the table set in cells starts and ends on the page. */
const CELL_AT: Array<[number, number]> = [[30, 50], [56, 190], [200, 290], [300, 390], [400, 500], [510, 610], [620, 710], [720, 810]];
/** Its headings, each as the lines its cell wraps it onto. */
const CELL_HEADINGS: string[][] = [['Sl'], ['Packages'], ['Budget'], ['Awarded', 'value'], ['Awarded to'], ['Anticipated final', 'cost'], ['Amount', 'certified'], ['Cost per', 'sq ft']];

/** A cell's words as the lines a narrow column wraps them onto: two where there are three words or more. */
function wrapped(cell: string, column: number): string[] {
  const words = cell.split(' ');
  if ((column !== 1 && column !== 4) || words.length < 3 || /^[A-Z -]+$/.test(cell)) return [cell];
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(' '), words.slice(half).join(' ')];
}

/**
 * The cost report with its table set in cells. Read line by line, its heading
 * is in pieces and a row's name is on other lines than its figures; the page
 * is the same table all the same.
 */
export async function costReportSetInCells(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  lines(pdf.addPage(A4_ACROSS), font, COVER, 480, 16);
  const page = pdf.addPage(A4_ACROSS);
  const size = 7;
  const pitch = 8.4;
  page.drawText('COST SUMMARY - BUDGET AGAINST ANTICIPATED FINAL COST', { x: 30, y: 560, size: 11, font });
  /** A cell's lines about the middle of its row, numbers set to the right of their column. */
  const cell = (said: string[], column: number, middle: number): void => {
    said.forEach((line, n) => {
      if (!line) return;
      const [left, right] = CELL_AT[column]!;
      const numeric = column !== 1 && column !== 4 && column !== 0;
      const x = numeric ? right - font.widthOfTextAtSize(line, size) : left;
      page.drawText(line, { x, y: middle + ((said.length - 1) / 2 - n) * pitch, size, font });
    });
  };
  CELL_HEADINGS.forEach((said, column) => cell(said, column, 528));
  COST_LINES.forEach((cells, row) => cells.forEach((said, column) => cell(wrapped(said, column), column, 496 - row * 22)));
  page.drawText('All amounts in Indian rupees. GST shown separately.', { x: 30, y: 40, size: 8, font });
  return pdf.save();
}
