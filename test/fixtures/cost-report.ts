/**
 * An invented cost consultant's monthly cost report, as figures.
 *
 * Every name and amount is made up. It is laid out as such a report is: a
 * row for each package under a heading for its section, a sub-total under
 * each section, a contingency and the consultant's own fee, a total, GST and
 * a grand total. The same table is drawn as pictures in
 * test/fixtures/documents/SCANNED_Cost_Report_Tables_As_Images.pdf
 * (make_reports.py), so the three forms a report arrives in are read against
 * one set of figures.
 */

export const COST_HEADINGS = ['Sl', 'Packages', 'Budget', 'Awarded value', 'Awarded to', 'Anticipated final cost', 'Amount certified', 'Cost per sq ft'];

/** The table's lines, a cell to each heading. "-" is a cell with nothing in it. */
export const COST_LINES: string[][] = [
  ['A', 'CIVIL AND STRUCTURE', '', '', '', '', '', ''],
  ['1', 'Earthwork and excavation', '85,00,000', '82,40,000', 'Ridgeline Earthmovers', '82,40,000', '82,40,000', '69'],
  ['2', 'RCC structure', '12,50,00,000', '12,18,60,000', 'Northgate Constructions', '12,46,10,000', '6,04,25,000', '1,038'],
  ['3', 'Masonry and plastering', '2,40,00,000', '-', '-', '2,40,00,000', '-', '200'],
  ['', 'SUB-TOTAL A', '15,75,00,000', '13,01,00,000', '', '15,68,50,000', '6,86,65,000', '1,307'],
  ['B', 'FINISHES', '', '', '', '', '', ''],
  ['4', 'Flooring and tiling', '3,10,00,000', '-', '-', '3,10,00,000', '-', '258'],
  ['5', 'Doors and windows', '2,25,00,000', '2,31,50,000', 'Harbour Joinery', '2,31,50,000', '23,15,000', '193'],
  ['6', 'Painting', '95,00,000', '-', '-', '95,00,000', '-', '79'],
  ['', 'SUB-TOTAL B', '6,30,00,000', '2,31,50,000', '', '6,36,50,000', '23,15,000', '530'],
  ['C', 'SERVICES', '', '', '', '', '', ''],
  ['7', 'Electrical works', '2,80,00,000', '2,74,00,000', 'Corewire Electricals', '2,74,00,000', '54,80,000', '228'],
  ['8', 'Plumbing and fire fighting', '1,90,00,000', '-', '-', '1,90,00,000', '-', '158'],
  ['9', 'Lifts', '1,20,00,000', '1,16,00,000', 'Summit Elevators', '1,16,00,000', '11,60,000', '97'],
  ['', 'SUB-TOTAL C', '5,90,00,000', '3,90,00,000', '', '5,80,00,000', '66,40,000', '483'],
  ['10', 'Design contingency', '1,00,00,000', '-', '-', '1,00,00,000', '-', '83'],
  ['11', 'Project management consultancy fee', '90,00,000', '90,00,000', 'Meridian Cost Consultants', '90,00,000', '36,00,000', '75'],
  ['', 'TOTAL', '29,85,00,000', '20,12,50,000', '', '29,75,00,000', '8,12,20,000', '2,479'],
  ['', 'GST @ 18%', '5,37,30,000', '', '', '5,35,50,000', '', ''],
  ['', 'GRAND TOTAL', '35,22,30,000', '', '', '35,10,50,000', '', '2,925'],
];

/** The eleven package rows, by name, with what each holds. Amounts in rupees. */
export const COST_PACKAGES: Array<{ name: string; budget: number; awarded?: number; awardedTo?: string; anticipated: number; certified?: number }> = [
  { name: 'Earthwork and excavation', budget: 85_00_000, awarded: 82_40_000, awardedTo: 'Ridgeline Earthmovers', anticipated: 82_40_000, certified: 82_40_000 },
  { name: 'RCC structure', budget: 12_50_00_000, awarded: 12_18_60_000, awardedTo: 'Northgate Constructions', anticipated: 12_46_10_000, certified: 6_04_25_000 },
  { name: 'Masonry and plastering', budget: 2_40_00_000, anticipated: 2_40_00_000 },
  { name: 'Flooring and tiling', budget: 3_10_00_000, anticipated: 3_10_00_000 },
  { name: 'Doors and windows', budget: 2_25_00_000, awarded: 2_31_50_000, awardedTo: 'Harbour Joinery', anticipated: 2_31_50_000, certified: 23_15_000 },
  { name: 'Painting', budget: 95_00_000, anticipated: 95_00_000 },
  { name: 'Electrical works', budget: 2_80_00_000, awarded: 2_74_00_000, awardedTo: 'Corewire Electricals', anticipated: 2_74_00_000, certified: 54_80_000 },
  { name: 'Plumbing and fire fighting', budget: 1_90_00_000, anticipated: 1_90_00_000 },
  { name: 'Lifts', budget: 1_20_00_000, awarded: 1_16_00_000, awardedTo: 'Summit Elevators', anticipated: 1_16_00_000, certified: 11_60_000 },
  { name: 'Design contingency', budget: 1_00_00_000, anticipated: 1_00_00_000 },
  { name: 'Project management consultancy fee', budget: 90_00_000, awarded: 90_00_000, awardedTo: 'Meridian Cost Consultants', anticipated: 90_00_000, certified: 36_00_000 },
];

export const COST_TOTAL = { budget: 29_85_00_000, awarded: 20_12_50_000, anticipated: 29_75_00_000, certified: 8_12_20_000 };
export const COST_GST = { budget: 5_37_30_000, anticipated: 5_35_50_000 };
export const COST_GRAND_TOTAL = { budget: 35_22_30_000, anticipated: 35_10_50_000 };

/** The built-up area the report works its cost per square foot on. */
export const COST_BUILT_UP_SQFT = 1_20_000;

/** The table as a spreadsheet copies it: a tab between cells. */
export function costTablePasted(withHeadings = true): string {
  return [...(withHeadings ? [COST_HEADINGS] : []), ...COST_LINES].map((cells) => cells.join('\t')).join('\n');
}

/** The table as a page of a PDF gives it: each line's words in order, with nothing to mark a cell and nothing where a cell is blank. */
export function costTableAsPageText(): string {
  return [
    'COST SUMMARY - BUDGET AGAINST ANTICIPATED FINAL COST',
    COST_HEADINGS.join(' '),
    ...COST_LINES.map((cells) => cells.filter((cell) => cell !== '').join(' ')),
    'All amounts in Indian rupees. GST shown separately.',
  ].join('\n');
}
