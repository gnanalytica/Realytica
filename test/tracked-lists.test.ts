/**
 * A consultant's tracked list of information required, read as it is sent.
 *
 * The list here is shaped as such a list is kept: a title and a legend above
 * the row that names the columns, a number and an older number on every
 * item, section rows between the items, the round each was asked in, a few
 * words on what came back, one of four statuses, and a second sheet that
 * counts it up. It is built as a workbook and read through the reader the
 * API uses, so merged cells arrive as a spreadsheet gives them.
 *
 * Every name, firm and paper is invented.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  PAPER_STANDING_LABEL,
  TENDER_TERMS,
  addChecklistItems,
  addEvidence,
  addFieldRecord,
  assignChecklistItems,
  assumeChecklistItem,
  checklistLoads,
  notAskedSaid,
  papersNeedSaid,
  removeChecklistLoad,
  checklistOwed,
  checklistSheet,
  checklistSummary,
  createProject,
  decideField,
  listDay,
  listLoadSaid,
  listStatus,
  loadTrackedList,
  markChecklistPartial,
  packageDesks,
  suggestedDesks,
  paperLineSaid,
  papersOwed,
  papersOwedCsvFile,
  papersOwedSaid,
  parseChecklist,
  parseTrackedRows,
  parseTrackedSheets,
  parseTrackedText,
  placeDrafts,
  projectBrief,
  projectView,
  proposeFieldValues,
  raiseChecklistRequests,
  readSheet,
  receiveChecklistItem,
  resolveReportBlock,
  type DdProject,
  type PaperLine,
  type ProjectGrant,
} from '@realytica/shared';
import { workbookSheets } from '../apps/api/src/documents/questionnaire-file';

const NOW = '2026-10-13T06:00:00.000Z';
const HEAD = ['Ref No', 'Orig. Sl.No', 'Package', 'Description of Information Required', 'Availability (at request)', 'Request Ref', 'Client Response / Remarks', 'Current Status', 'Responsibility', 'Target Date', 'Next Action / NCC Comments'];

type Row = Array<string | number>;
const section = (ref: string, title: string): Row => [ref, '', '', title];

/** The first copy of the list: sixteen items in five packages, every status, and the odd cases a real list has. */
const FIRST: Row[] = [
  section('1', 'GENERAL'),
  ['1.1', 'A.1', 'General', 'Approved master plan with area statement', 'Not available', 'E mail 01', 'Attached', 'Received'],
  ['1.2', 'A.2', 'General', 'Project programme with key dates', 'Partially available', 'E mail 01', 'Concept available at this stage - attached', 'Partial', '', '', 'Detailed programme awaited'],
  ['1.3', 'A.3', 'General', 'Statutory approvals obtained to date', '', 'E mail 02', '', 'Pending'],
  // Pending and never asked for: no request reference.
  ['1.4', 'A.4', 'General', 'Sales brochure and specification', '', '', '', 'Pending'],
  section('2', 'TOWER – CIVIL & STRUCTURAL WORKS'),
  section('2.1', 'Package Costs & Building Economics'),
  ['2.1.1', 'B.1.1', 'Civil and structural', 'Structural drawings for the tower, all floors', 'Partial / Not available', 'E mail 01', 'Already shared', 'Received'],
  // The package cell left blank, as a merged cell reads below its first row.
  ['2.1.2', 'B.1.2', '', 'Soil investigation report with bearing capacity', 'Not available', 'E mail 01', 'Cost to be considered based on area', 'NCC to assume'],
  ['2.1.3', 'B.1.3', 'Civil and structural', 'Basement waterproofing specification', 'Not available', 'E mail 02', '', 'Pending'],
  section('2.2', 'Structural Quantities'),
  ['2.2.1', 'B.2.1', 'Civil and structural', 'Reinforcement consumption per cubic metre', 'Not available', 'E mail 02', '', 'NCC to assume'],
  // A status left blank on a line that was asked for.
  ['2.2.2', 'B.1.10', 'Civil and structural', 'Bar bending schedules', '', 'E mail 02', '', ''],
  ['3', 'MERGED', '', 'ARCHITECTURAL & FINISHES'],
  ['3.1', 'C.1', 'Architectural and finishes', 'Finishes schedule, space by space', 'Partially available', 'E mail 01', 'Attached', 'Partial'],
  ['3.2', 'C.2', 'Architectural and finishes', 'Door and window schedule', 'Not available', 'E mail 02', '', 'Pending', 'Meridian Design Studio', '14/11/2026'],
  ['3.3', 'C.3', 'Architectural and finishes', 'Façade concept and glazing extent', 'Not available', 'E mail 02', '', 'Pending', '', '05-09-2026'],
  section('4', 'EXTERNAL DEVELOPMENT'),
  ['4.1', 'D.2.3', 'External development', 'Landscape concept plan', 'Not available', 'E mail 02', '', 'Pending'],
  ['4.2', 'D.2.4', 'External development', 'Compound wall and gate details', 'Not available', '', '', 'Pending'],
  section('5', 'MEP'),
  section('5.4', 'Electrical'),
  ['5.4.14', 'E.4.14', 'MEP', 'Transformer and generator capacities', 'Not available', 'E mail 01', 'Attached', 'Received'],
  ['5.4.15', 'E.4.15', 'MEP', 'Lift traffic analysis', 'Not available', 'E mail 02', '', 'Pending'],
];

/** The copy sent a month later: three lines moved on, one came back, one was added where it shifts the numbers below it, one was dropped. */
function second(): Row[] {
  const rows = FIRST.map((row) => [...row]);
  const at = (ref: string) => rows.find((row) => row[0] === ref && row[1] !== '' && row[1] !== 'MERGED')!;
  at('1.3')[6] = 'Attached';
  at('1.3')[7] = 'Received';
  at('3.2')[7] = 'NCC to assume';
  at('5.4.14')[7] = 'Pending';
  const waterproofing = at('2.1.3');
  waterproofing[0] = '2.1.4';
  waterproofing[7] = 'Partial';
  rows.splice(rows.indexOf(waterproofing), 0, ['2.1.3', 'B.1.11', 'Civil and structural', 'Piling layout and pile schedule', 'Not available', 'E mail 03', '', 'Pending']);
  rows.splice(rows.indexOf(at('4.2')), 1);
  return rows;
}

/** The workbook as a consultant keeps it: the title and the legend merged across the sheet, a section row merged, and a sheet of counts. */
async function workbook(rows: Row[]): Promise<Buffer> {
  const ExcelJS = createRequire(path.resolve('apps/api/package.json'))('exceljs') as typeof import('../apps/api/node_modules/exceljs');
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Tracker');
  sheet.addRow(['INFORMATION REQUIRED TO UPDATE THE BUDGET']);
  sheet.mergeCells('A1:K1');
  sheet.addRow(['Status legend: Received / Partial / NCC to assume / Pending']);
  sheet.mergeCells('A2:K2');
  sheet.addRow([]);
  sheet.addRow(HEAD);
  for (const row of rows) {
    const merged = row[1] === 'MERGED';
    const added = sheet.addRow(merged ? [row[0], row[3]] : row);
    if (merged) sheet.mergeCells(`B${added.number}:K${added.number}`);
  }
  const summary = book.addWorksheet('Summary');
  summary.addRows([
    ['Package', 'Description of Information Required', 'Total', 'Received', 'Partial', 'NCC to assume', 'Pending', '% Received', 'Current Status'],
    ['General', 'Wrong on purpose: the count is worked out, not read', 99, 99, 0, 0, 0, '100%', 'Received'],
    ['Total', '', 99, 99, 0, 0, 0, '100%', 'Received'],
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

function project(): DdProject {
  return createProject({ name: 'Lake Road offices', type: 'commercial', location: 'Lake Road', city: 'Kadamba', currentStage: 'design' }, 'RYT-L1');
}

async function tracked(rows: Row[]) {
  const read = parseTrackedSheets(await workbookSheets(await workbook(rows)));
  assert.ok(read, 'the workbook is a tracked list');
  return read;
}

async function loaded(rows: Row[] = FIRST): Promise<DdProject> {
  const p = project();
  const read = await tracked(rows);
  loadTrackedList(p, 'finance', placeDrafts(read.drafts, packageDesks(read.packages, suggestedDesks(read.packages))), 'qs@northbank.example');
  return p;
}

const lineOf = (p: DdProject, ref: string) => {
  const item = (p.checklist ?? []).find((held) => held.ref === ref);
  assert.ok(item, `no line ${ref}`);
  return item;
};
const paper = (p: DdProject, ref: string, now = NOW): PaperLine => {
  const view = papersOwed(p, { now });
  const found = [...view.parties.flatMap((party) => party.lines), ...view.assumed, ...view.inHand].find((line) => line.ref === ref);
  assert.ok(found, `no paper ${ref}`);
  return found;
};
const day = (iso: string) => iso.slice(0, 10);

describe('a tracked list read as it is sent', () => {
  it('skips the title and the legend, finds the header, and reads every item with its numbers, round, remark and status', async () => {
    const read = await tracked(FIRST);
    assert.equal(read.list, 'INFORMATION REQUIRED TO UPDATE THE BUDGET');
    assert.equal(read.drafts.length, 16);
    assert.deepEqual(read.packages, ['General', 'Civil and structural', 'Architectural and finishes', 'External development', 'MEP']);
    const at = (ref: string) => read.drafts.find((draft) => draft.ref === ref)!;
    assert.deepEqual(
      { ...at('1.2') },
      {
        title: 'Project programme with key dates',
        list: read.list,
        order: 1,
        ref: '1.2',
        oldRef: 'A.2',
        headings: [{ ref: '1', title: 'GENERAL' }],
        package: 'General',
        availability: 'Partially available',
        round: 'E mail 01',
        remark: 'Concept available at this stage - attached',
        note: 'Detailed programme awaited',
        status: 'partial',
      },
    );
    assert.deepEqual(at('3.2').owedBy, 'Meridian Design Studio');
    assert.deepEqual([at('3.2').targetDate, at('3.3').targetDate], ['2026-11-14', '2026-09-05']);
    assert.deepEqual(read.drafts.map((draft) => draft.status), ['received', 'partial', 'pending', 'pending', 'received', 'assumed', 'pending', 'assumed', 'pending', 'partial', 'pending', 'pending', 'pending', 'pending', 'received', 'pending']);
  });

  it('keeps section rows as headings with their numbering, nested as the list nests them, and never as lines', async () => {
    const read = await tracked(FIRST);
    const at = (ref: string) => read.drafts.find((draft) => draft.ref === ref)!;
    assert.deepEqual(at('2.1.3').headings, [{ ref: '2', title: 'TOWER – CIVIL & STRUCTURAL WORKS' }, { ref: '2.1', title: 'Package Costs & Building Economics' }]);
    assert.deepEqual(at('2.2.1').headings, [{ ref: '2', title: 'TOWER – CIVIL & STRUCTURAL WORKS' }, { ref: '2.2', title: 'Structural Quantities' }]);
    // A section row merged across the sheet reads as the same words in every cell.
    assert.deepEqual(at('3.1').headings, [{ ref: '3', title: 'ARCHITECTURAL & FINISHES' }]);
    assert.deepEqual(at('5.4.14').headings, [{ ref: '5', title: 'MEP' }, { ref: '5.4', title: 'Electrical' }]);
    assert.ok(!read.drafts.some((draft) => /GENERAL|TOWER|Structural Quantities|^MEP$|Electrical$/.test(draft.title)));
  });

  it('reads who is to assume out of the status, takes a blank package from the line above, and leaves the count sheet alone', async () => {
    const read = await tracked(FIRST);
    const soil = read.drafts.find((draft) => draft.ref === '2.1.2')!;
    assert.deepEqual([soil.status, soil.assumer, soil.package], ['assumed', 'NCC', 'Civil and structural']);
    assert.ok(!read.drafts.some((draft) => /Wrong on purpose/.test(draft.title)));
    assert.deepEqual(listStatus('Northbank to assume'), { status: 'assumed', assumer: 'Northbank' });
    assert.deepEqual(listStatus('To be assumed'), { status: 'assumed' });
    assert.deepEqual([listStatus('Partly received').status, listStatus('RECEIVED').status, listStatus('Not received').status, listStatus('').status], ['partial', 'received', 'pending', 'pending']);
  });

  it('reads the same list from a CSV and from pasted rows, whatever the spelling of its columns', () => {
    const head = ['Ref. No.', 'Orig Sl No', 'Package', 'Description of Information Required', 'Availability (at request)', 'Request Ref.', 'Client Response/Remarks', 'Current status', 'Responsibility', 'Target Date', 'Next Action / Northbank comments'];
    const csv = ['Information required to update the budget,,,,,,,,,,', 'Legend: Received; Partial; Northbank to assume; Pending,,,,,,,,,,', head.join(','), '2,,,CIVIL WORKS,,,,,,,', '2.1,B.1,Civil and structural,"Structural drawings, all floors",Not available,E mail 01,Attached,Received,,,', '2.2,B.2,Civil and structural,Soil investigation report,Not available,E mail 01,,Northbank to assume,,,'].join('\n');
    const fromCsv = parseTrackedText(csv);
    assert.ok(fromCsv);
    assert.equal(fromCsv.list, 'Information required to update the budget');
    assert.deepEqual(fromCsv.drafts.map((draft) => [draft.ref, draft.oldRef, draft.title, draft.status, draft.assumer, draft.headings?.[0]?.title]), [
      ['2.1', 'B.1', 'Structural drawings, all floors', 'received', undefined, 'CIVIL WORKS'],
      ['2.2', 'B.2', 'Soil investigation report', 'assumed', 'Northbank', 'CIVIL WORKS'],
    ]);
    const pasted = parseTrackedText([head.join('\t'), ['7', 'G.1', 'MEP', 'Lift traffic analysis', '', 'E mail 02', '', 'Pending', '', '', ''].join('\t')].join('\n'));
    assert.deepEqual(pasted?.drafts.map((draft) => [draft.ref, draft.round, draft.status]), [['7', 'E mail 02', 'pending']]);
    // A plain list is no tracked list, and is read as it always was.
    assert.equal(parseTrackedText('Concept:\nSoil investigation report\nBuilt-up area statement'), undefined);
    assert.equal(parseTrackedRows([['Item', 'Package'], ['Soil investigation report', 'Civil']]), undefined);
    assert.deepEqual(parseChecklist('Concept:\nSoil investigation report').map((draft) => draft.title), ['Soil investigation report']);
  });

  it('reads a day however the list writes it, and nothing where it is no day', () => {
    assert.deepEqual([listDay('2026-11-14'), listDay('14/11/2026'), listDay('14-11-26'), listDay('14 Nov 2026'), listDay('Nov 14, 2026'), listDay('Sat Nov 14 2026 05:30:00 GMT+0530 (India Standard Time)')], Array(6).fill('2026-11-14'));
    assert.deepEqual([listDay('31/02/2026'), listDay('soon'), listDay('')], [undefined, undefined, undefined]);
  });
});

describe('the lines it puts on the project', () => {
  it('go to the department and the function their package belongs to, by a table a firm may answer differently', async () => {
    const p = await loaded();
    assert.deepEqual(
      ['1.1', '2.1.1', '3.1', '4.1', '5.4.14'].map((ref) => [lineOf(p, ref).department, lineOf(p, ref).fn]),
      [
        ['finance', 'finance.budget'],
        ['design', 'design.structure'],
        ['design', 'design.finishes'],
        ['design', 'design.landscape'],
        ['design', 'design.electrical'],
      ],
    );
    assert.deepEqual(packageDesks(['MEP', 'Lifts and escalators'], { mep: 'design.fire' }), [{ package: 'MEP', fn: 'design.fire', department: 'design', suggested: 'design.electrical' }, { package: 'Lifts and escalators' }]);
    // Left unanswered, the table moves nothing: it says where a package could go, and the list stays on the desk it is loaded on.
    assert.deepEqual(packageDesks(['MEP', 'General']), [{ package: 'MEP', suggested: 'design.electrical' }, { package: 'General', suggested: 'finance.budget' }]);
    const stays = project();
    const whole = await tracked(FIRST);
    loadTrackedList(stays, 'finance', placeDrafts(whole.drafts, packageDesks(whole.packages)), 'qs');
    assert.deepEqual([...new Set(stays.checklist!.map((item) => item.department))], ['finance'], 'every line is on the desk it was loaded on');
    assert.equal(stays.checklist!.some((item) => item.fn), false);
    // A package the table does not know stays on the desk the list was loaded on.
    const q = project();
    loadTrackedList(q, 'procurement', placeDrafts([{ title: 'Lift traffic analysis', list: 'L', ref: '1', package: 'Vertical transport', status: 'pending' }], packageDesks(['Vertical transport'])), 'qs');
    assert.deepEqual([q.checklist![0]!.department, q.checklist![0]!.fn], ['procurement', undefined]);
  });

  it('stand as the list says: received is in hand, partial is partial, to assume is to be assumed, pending is asked where a round is named and not asked where none is', async () => {
    const p = await loaded();
    assert.deepEqual(
      ['1.1', '1.2', '2.1.2', '1.3', '2.2.2', '1.4', '4.2'].map((ref) => paper(p, ref).standing),
      ['in_hand', 'partial', 'assumed', 'asked', 'asked', 'not_asked', 'not_asked'],
    );
    assert.equal(paper(p, '2.1.2').assumer, 'NCC');
    assert.equal(paper(p, '1.2').remark, 'Concept available at this stage - attached');
    assert.equal(paper(p, '1.3').round, 'E mail 02');
    assert.equal(paper(p, '2.1.3').where, 'Civil and structural · 2 TOWER – CIVIL & STRUCTURAL WORKS · 2.1 Package Costs & Building Economics');
    const view = papersOwed(p, { now: NOW });
    // Sixteen lines: three in hand, two that will not come, eleven still owed.
    assert.deepEqual([view.total, view.inHand.length, view.assumed.length, view.owed, view.partial, view.asked, view.notAsked], [16, 3, 2, 11, 2, 7, 2]);
    assert.deepEqual(view.rounds, ['E mail 01', 'E mail 02']);
    assert.equal(papersOwedSaid(view), '9 owed · 2 partial · 7 asked for · 2 not asked · 2 to be assumed · 1 overdue');
    assert.equal(PAPER_STANDING_LABEL.assumed, 'To be assumed');
    // What will not come is owed by nobody: it is not chased, and not counted as owed anywhere.
    assert.equal(checklistOwed(p, { now: NOW }).owed, 11);
    assert.ok(!checklistSheet(p, { now: NOW }).owing.flatMap((group) => group.lines).some((line) => line.mark === 'assumed'));
  });

  it('are kept in the list’s own order, with a line a later copy adds set where the list puts it', async () => {
    const p = await loaded();
    const read = await tracked(second());
    loadTrackedList(p, 'finance', placeDrafts(read.drafts, packageDesks(read.packages, suggestedDesks(read.packages))), 'qs@northbank.example');
    const refs = checklistSheet(p, { department: 'design', now: NOW }).stages.flatMap((stage) => stage.packages.flatMap((pack) => pack.lines)).map((line) => line.item.ref);
    assert.deepEqual(refs.slice(0, 4), ['2.1.1', '2.1.2', '2.1.3', '2.1.4']);
  });
});

describe('the same list sent again', () => {
  it('updates the lines it already has, says what changed, and never adds one twice', async () => {
    const p = await loaded();
    const before = p.checklist!.map((item) => item.id);
    const read = await tracked(second());
    const drafts = placeDrafts(read.drafts, packageDesks(read.packages, suggestedDesks(read.packages)));
    const would = loadTrackedList(p, 'finance', drafts, 'qs@northbank.example', { dryRun: true });
    assert.equal(p.checklist!.length, 16, 'a dry run changes nothing');
    const report = loadTrackedList(p, 'finance', drafts, 'qs@northbank.example');
    assert.deepEqual(would, report);
    assert.deepEqual(
      { added: report.added, becameReceived: report.becameReceived, becamePartial: report.becamePartial, becameAssumed: report.becameAssumed, reopened: report.reopened, gone: report.gone },
      {
        added: ['2.1.3 Piling layout and pile schedule'],
        becameReceived: ['1.3 Statutory approvals obtained to date'],
        becamePartial: ['2.1.4 Basement waterproofing specification'],
        becameAssumed: ['3.2 Door and window schedule'],
        reopened: ['5.4.14 Transformer and generator capacities'],
        gone: ['4.2 Compound wall and gate details'],
      },
    );
    assert.equal(listLoadSaid(report), `1 added · 1 now received · 1 now partial · 1 now to be assumed · 1 pending again · ${report.updated} updated · 1 no longer on the list`);
    // Seventeen lines: the sixteen there were, each the same record, and the one added. The line dropped from the list is kept.
    assert.equal(p.checklist!.length, 17);
    assert.deepEqual(p.checklist!.slice(0, 16).map((item) => item.id), before);
    assert.equal(new Set(p.checklist!.map((item) => `${item.ref}|${item.title}`)).size, 17);
    // The line whose number moved is the same line, under its new number.
    assert.equal(lineOf(p, '2.1.4').title, 'Basement waterproofing specification');
    assert.equal(lineOf(p, '2.1.4').id, before[6]);
    assert.deepEqual(['1.3', '2.1.4', '3.2', '5.4.14', '4.2'].map((ref) => paper(p, ref).standing), ['in_hand', 'partial', 'assumed', 'asked', 'not_asked']);
    assert.equal(lineOf(p, '1.3').remark?.text, 'Attached');

    const again = loadTrackedList(p, 'finance', drafts, 'qs@northbank.example');
    assert.deepEqual([again.added.length, again.updated, again.unchanged, again.gone.length, p.checklist!.length], [0, 0, 17 - 1, 1, 17]);
    assert.match(listLoadSaid(again), /no longer on the list/);
  });

  it('does not undo what a person settled here, and keeps the party and the day they set where the list gives none', async () => {
    const p = await loaded();
    const deed = addEvidence(p, { title: 'Approvals register', kind: 'document', status: 'received' }, 'pm');
    receiveChecklistItem(p, lineOf(p, '1.3').id, { evidenceId: deed.id }, 'pm@builders.example');
    assignChecklistItems(p, [lineOf(p, '4.1').id], { owedBy: 'Greenline Landscape', targetDate: '2026-12-01' }, 'pm@builders.example');
    const rows = FIRST.map((row) => [...row]);
    // The list still calls 1.3 pending: a person here has it in hand, with its document.
    const read = await tracked(rows);
    const report = loadTrackedList(p, 'finance', placeDrafts(read.drafts, packageDesks(read.packages, suggestedDesks(read.packages))), 'qs@northbank.example');
    assert.deepEqual([report.reopened, report.becameReceived], [[], []]);
    assert.equal(paper(p, '1.3').standing, 'in_hand');
    assert.deepEqual([lineOf(p, '4.1').owedBy, lineOf(p, '4.1').targetDate], ['Greenline Landscape', '2026-12-01']);
  });
});

describe('partly in hand, and to be assumed', () => {
  it('are set by a person, with what is still wanted and who assumes, and are taken back', async () => {
    const p = await loaded();
    const id = lineOf(p, '4.1').id;
    markChecklistPartial(p, id, { wanted: 'Planting schedule and irrigation layout' }, 'pm@builders.example');
    assert.deepEqual([paper(p, '4.1').standing, paper(p, '4.1').wanted], ['partial', 'Planting schedule and irrigation layout']);
    assert.equal(paperLineSaid(paper(p, '4.1'), day, { tracked: true }), 'Partly in hand, still wanted: Planting schedule and irrigation layout · Asked in E mail 02 · nobody named, no date');
    assumeChecklistItem(p, id, { assumer: 'Northbank Cost Consultants' }, 'pm@builders.example');
    assert.deepEqual([paper(p, '4.1').standing, paper(p, '4.1').assumer, lineOf(p, '4.1').partial], ['assumed', 'Northbank Cost Consultants', undefined]);
    assert.equal(paperLineSaid(paper(p, '4.1'), day), 'Will not come · Northbank Cost Consultants to assume · what is assumed is not recorded yet');
    assumeChecklistItem(p, id, null, 'pm@builders.example');
    assert.equal(paper(p, '4.1').standing, 'asked');
    assert.throws(() => assumeChecklistItem(p, id, { assumer: ' ' }, 'pm'), /Name who is to assume/);
    // In hand is all of it.
    markChecklistPartial(p, id, {}, 'pm');
    receiveChecklistItem(p, id, {}, 'pm');
    assert.deepEqual([paper(p, '4.1').standing, lineOf(p, '4.1').partial], ['in_hand', undefined]);
  });

  it('a line to be assumed makes the field it stands in for read as ASSUMED, feeds what is worked out, and gives way to a real value', async () => {
    const p = await loaded();
    const tender = addFieldRecord(p, TENDER_TERMS, { contract_type: 'item rate', contract_months: 18 }, 'buyer@builders.example').record!;
    const address = { fn: 'procurement.boq', set: TENDER_TERMS, field: 'defects_months', record: tender.id };
    const field = (key: string) => readSheet(p, TENDER_TERMS, tender.id)!.fields.find((view) => view.def.key === key)!;
    assert.equal(field('defects_months').state, 'empty');
    assert.equal(field('performance_needed_months').text, '—');

    // The defects liability period will not be stated before the tender goes out: the consultant proceeds on twelve months.
    const line = addChecklistItems(p, 'procurement', [{ title: 'Defects liability period for the civil package', ref: '7.4', list: 'Tender queries' }], 'buyer').added[0]!;
    assumeChecklistItem(p, line.id, { assumer: 'Northbank Cost Consultants', fields: [{ address, value: '12' }] }, 'buyer@builders.example');
    assert.equal(field('defects_months').state, 'assumed');
    assert.equal(field('defects_months').held?.value, 12);
    assert.deepEqual(field('defects_months').source, { kind: 'default', label: 'Papers owed: 7.4 Defects liability period for the civil package, Northbank Cost Consultants to assume' });
    // Worked out on it, and said to rest on an assumed value.
    assert.equal(field('performance_needed_months').held?.value, 30);
    assert.deepEqual(field('performance_needed_months').assumes, ['Defects liability period']);
    assert.equal(paperLineSaid(paper(p, '7.4'), day), 'Will not come · Northbank Cost Consultants to assume');
    // Nothing was written onto the field itself.
    assert.equal(p.fieldSheets![TENDER_TERMS]!.records![0]!.values.defects_months, undefined);

    // A value somebody offers changes nothing while it waits; accepted, it replaces the assumption.
    assert.deepEqual(proposeFieldValues(p, [{ address, value: 24, origin: { kind: 'external', source: 'Client’s reply to the tender form', asOf: '2026-10-12' } }], 'parser').map((o) => o.outcome), ['waiting']);
    assert.equal(field('defects_months').state, 'proposed');
    assert.equal(field('performance_needed_months').held?.value, 30);
    decideField(p, address, 'accept', 'lead@builders.example');
    assert.deepEqual([field('defects_months').state, field('defects_months').held?.value], ['accepted', 24]);
    assert.equal(field('performance_needed_months').held?.value, 42);
    assert.equal(field('performance_needed_months').assumes, undefined);
  });

  it('refuses a value the field cannot hold, a field that is worked out, and more fields than a line may stand in for', async () => {
    const p = await loaded();
    const tender = addFieldRecord(p, TENDER_TERMS, { contract_months: 18 }, 'buyer').record!;
    const id = lineOf(p, '4.1').id;
    const at = (field: string, record: string | undefined = tender.id) => ({ fn: 'procurement.boq', set: TENDER_TERMS, field, ...(record ? { record } : {}) });
    assert.throws(() => assumeChecklistItem(p, id, { assumer: 'NCC', fields: [{ address: at('defects_months'), value: 'a year or so' }] }, 'pm'));
    assert.throws(() => assumeChecklistItem(p, id, { assumer: 'NCC', fields: [{ address: at('performance_needed_months'), value: 30 }] }, 'pm'), /not a field a value can be assumed for/);
    assert.throws(() => assumeChecklistItem(p, id, { assumer: 'NCC', fields: [{ address: at('defects_months', ''), value: 12 }] }, 'pm'), /name the record/);
    assert.throws(() => assumeChecklistItem(p, id, { assumer: 'NCC', fields: [{ address: at('no_such_field'), value: 1 }] }, 'pm'), /not a field of a sheet/);
    assert.throws(() => assumeChecklistItem(p, id, { assumer: 'NCC', fields: Array(7).fill({ address: at('defects_months'), value: 12 }) }, 'pm'), /6 fields at most/);
    assert.equal(lineOf(p, '4.1').assumed, undefined);
  });
});

describe('the summary a consultant counts by hand', () => {
  it('is worked out per package and in total, and equals a count made by hand', async () => {
    const p = await loaded();
    const summary = checklistSummary(p, { now: NOW });
    assert.equal(summary.tracked, true);
    assert.deepEqual(
      summary.rows.map((row) => [row.package, row.total, row.received, row.partial, row.assumed, row.pending, row.percent]),
      [
        ['General', 4, 1, 1, 0, 2, 25],
        ['Civil and structural', 5, 1, 0, 2, 2, 20],
        ['Architectural and finishes', 3, 0, 1, 0, 2, 0],
        ['External development', 2, 0, 0, 0, 2, 0],
        ['MEP', 2, 1, 0, 0, 1, 50],
      ],
    );
    const total = summary.total;
    assert.deepEqual([total.total, total.received, total.partial, total.assumed, total.pending, total.percent], [16, 3, 2, 2, 9, 19]);
    // Counted by hand from the rows of the list itself.
    const items = FIRST.filter((row) => row.length > 4);
    const count = (status: RegExp) => items.filter((row) => status.test(String(row[7]))).length;
    assert.deepEqual([items.length, count(/^Received$/), count(/^Partial$/), count(/to assume/)], [total.total, total.received, total.partial, total.assumed]);
    for (const row of summary.rows) assert.equal(row.total, row.received + row.partial + row.assumed + row.pending);
    assert.deepEqual(summary.rows.map((row) => row.departments), [['finance'], ['design'], ['design'], ['design'], ['design']]);
  });

  it('narrows to the lines asked for in one round, and to one department', async () => {
    const p = await loaded();
    const summary = checklistSummary(p, { now: NOW });
    assert.deepEqual(summary.rounds, [{ round: 'E mail 01', total: 6 }, { round: 'E mail 02', total: 8 }]);
    const round2 = checklistSummary(p, { round: 'e mail 02', now: NOW });
    assert.deepEqual([round2.total.total, round2.total.received, round2.total.assumed, round2.total.pending], [8, 0, 1, 7]);
    assert.deepEqual(checklistSummary(p, { department: 'finance', now: NOW }).rows.map((row) => row.package), ['General']);
  });

  it('is a block a report can carry, bound to the list', async () => {
    const p = await loaded();
    const block = resolveReportBlock(p, { id: 'b1', origin: 'derived', heading: 'Information status', source: { kind: 'information_status' } });
    assert.deepEqual(block.table?.columns, ['Package', 'Total', 'Received', 'Partial', 'To be assumed', 'Pending', 'Received %']);
    assert.deepEqual(block.table?.rows.map((row) => row.cells), [
      ['General', '4', '1', '1', '0', '2', '25%'],
      ['Civil and structural', '5', '1', '0', '2', '2', '20%'],
      ['Architectural and finishes', '3', '0', '1', '0', '2', '0%'],
      ['External development', '2', '0', '0', '0', '2', '0%'],
      ['MEP', '2', '1', '0', '0', '1', '50%'],
      ['Total', '16', '3', '2', '2', '9', '19%'],
    ]);
    assert.equal(block.lines[1], 'Civil and structural: 1 of 5 received (20%), 2 to be assumed, 2 pending');
    assert.match(block.note ?? '', /2 papers will not come/);
    assert.deepEqual(resolveReportBlock(p, { id: 'b2', origin: 'derived', heading: 'Information status', source: { kind: 'information_status', department: 'finance' } }).table?.rows.length, 2);
    assert.deepEqual(resolveReportBlock(project(), { id: 'b3', origin: 'derived', heading: 'Information status', source: { kind: 'information_status' } }), { lines: [], recordIds: [], note: 'No list of information required is loaded.' });
  });
});

describe('who owes it, and by when', () => {
  it('is said on the line where either is blank, and counted', async () => {
    const p = await loaded();
    const view = papersOwed(p, { now: NOW });
    // Eleven lines are still owed. One names its party and its day, one names a day alone.
    assert.deepEqual([view.nobodyNamed, view.noDate, view.tracked], [10, 9, true]);
    assert.equal(paperLineSaid(paper(p, '1.3'), day, { tracked: true }), 'Asked in E mail 02 · nobody named, no date');
    assert.equal(paperLineSaid(paper(p, '1.4'), day, { tracked: true }), 'On the list · nobody named, no date');
    assert.equal(paperLineSaid(paper(p, '3.2'), day, { tracked: true }), 'Asked in E mail 02 · due 2026-11-14');
    // What is in hand, and what will not come, wants no party and no day.
    assert.deepEqual([paper(p, '1.1').unnamed, paper(p, '1.1').undated, paper(p, '2.1.2').unnamed, paper(p, '2.1.2').undated], [undefined, undefined, undefined, undefined]);
  });

  it('is set for several lines in one act', async () => {
    const p = await loaded();
    const ids = ['1.3', '1.4', '4.1'].map((ref) => lineOf(p, ref).id);
    const changed = assignChecklistItems(p, ids, { owedBy: 'Lake Road Developers', targetDate: '20/11/2026' }, 'pm@builders.example');
    assert.equal(changed.length, 3);
    assert.deepEqual(ids.map((id) => [p.checklist!.find((item) => item.id === id)!.owedBy, p.checklist!.find((item) => item.id === id)!.targetDate]), Array(3).fill(['Lake Road Developers', '2026-11-20']));
    const view = papersOwed(p, { now: NOW });
    assert.deepEqual([view.nobodyNamed, view.noDate], [7, 6]);
    assert.equal(view.parties[0]!.party, 'Lake Road Developers');
    // A party alone leaves each line's day as it was.
    assignChecklistItems(p, [lineOf(p, '3.3').id], { owedBy: 'Meridian Design Studio' }, 'pm');
    assert.deepEqual([lineOf(p, '3.3').owedBy, lineOf(p, '3.3').targetDate], ['Meridian Design Studio', '2026-09-05']);
    assert.throws(() => assignChecklistItems(p, ids, {}, 'pm'), /Name who owes them/);
    assert.throws(() => assignChecklistItems(p, ids, { targetDate: 'next week' }, 'pm'), /as a date/);
    assert.throws(() => assignChecklistItems(p, ['chk_nothing'], { owedBy: 'X' }, 'pm'), /not on the list/);
  });

  it('a line past its day is overdue, and is counted where papers owed are already counted', async () => {
    const p = await loaded();
    assert.deepEqual([paper(p, '3.3').overdue, paper(p, '3.2').overdue], [true, undefined]);
    assert.equal(papersOwed(p, { now: NOW }).overdue, 1);
    // The day after the other line's day, both are.
    assert.equal(papersOwed(p, { now: '2026-11-15T06:00:00.000Z' }).overdue, 2);
    assert.equal(paperLineSaid(paper(p, '3.3'), day, { tracked: true }), 'Asked in E mail 02 · due 2026-09-05 (overdue) · nobody named');
    // Overview reads the same list: nothing new is counted, and the overdue line is in its count.
    const owed = projectBrief(p, new Date(NOW)).find((line) => line.key === 'owed')!;
    assert.deepEqual(owed.parts.slice(0, 2).map((part) => part.text), ['9 owed', '1 overdue']);
    // A line that will not come is never overdue, and neither is one in hand.
    const id = lineOf(p, '3.3').id;
    assumeChecklistItem(p, id, { assumer: 'NCC' }, 'pm');
    assert.equal(papersOwed(p, { now: NOW }).overdue, 0);
    // A request raised from here goes only for what is still owed and not yet asked.
    const { requests } = raiseChecklistRequests(p, { department: 'finance', recipient: 'Lake Road Developers', dueAt: '2026-10-30' }, 'pm@builders.example');
    assert.deepEqual(requests.map((request) => request.detail), ['Sales brochure and specification (General)']);
  });
});


describe('what a rehearsal on real lists found', () => {
  it('the title, the legend, the header and the sections are never papers, no line is titled with its number, and the load says what the sheet held', async () => {
    const read = await tracked(FIRST);
    // Twenty-four rows under the header: sixteen lines and eight sections, nothing skipped.
    assert.deepEqual([read.rows, read.drafts.length, read.sections, read.skipped], [24, 16, 8, []]);
    assert.equal(read.rows, read.drafts.length + read.sections + read.skipped.length);
    for (const draft of read.drafts) {
      assert.ok(!/^[A-Z]?\d+(\.\d+)*$/.test(draft.title), `${draft.ref} is titled with a number`);
      assert.ok(!/INFORMATION REQUIRED TO UPDATE|Status legend|Description of Information Required/.test(draft.title), draft.title);
    }
    // A row with a number and a heading and nothing else is a section, even with nothing numbered under it.
    const lone = parseTrackedRows([HEAD, ['7', '', '', 'HANDOVER'], ['8', '', '', 'FIT-OUT'], ['8.1', 'H.1', 'General', 'Fit-out guidelines', '', 'E mail 01', '', 'Pending']])!;
    assert.deepEqual([lone.drafts.map((draft) => draft.title), lone.sections], [['Fit-out guidelines'], 2]);
    // A row with words and no description is said, with the row of the sheet it is on.
    const odd = parseTrackedRows([HEAD, ['1.1', 'A.1', 'General', 'Master plan', '', 'E mail 01', '', 'Pending'], [], ['1.2', 'A.2', 'General', '', 'Not available', 'E mail 01', '', 'Pending']])!;
    assert.deepEqual(odd.skipped, [{ row: 4, text: '1.2 · A.2 · General · Not available · E mail 01 · Pending', reason: 'no description' }]);
  });

  it('two phases that ask for a paper in the same words are two lines, by their number or by their section, and stay two when the list is sent again', () => {
    const phased = (refs: boolean) =>
      parseTrackedRows([
        HEAD,
        [refs ? '2' : '', '', '', 'PHASE 1 – TOWERS A AND B'],
        [refs ? '2.1' : '', '', 'Civil and structural', 'Structural Drawings for Towers', 'Not available', 'E mail 01', '', 'Received'],
        [refs ? '3' : '', '', '', 'PHASE 2 – TOWERS C AND D'],
        [refs ? '3.1' : '', '', 'Civil and structural', 'Structural Drawings for Towers', 'Not available', 'E mail 02', '', 'Pending'],
      ])!;
    for (const refs of [true, false]) {
      const p = project();
      const read = phased(refs);
      assert.deepEqual([read.drafts.length, read.sections], [2, 2]);
      const first = loadTrackedList(p, 'design', read.drafts, 'qs');
      assert.deepEqual([first.added.length, p.checklist!.length], [2, 2]);
      assert.deepEqual(p.checklist!.map((item) => [item.headings![0]!.title, Boolean(item.received)]), [['PHASE 1 – TOWERS A AND B', true], ['PHASE 2 – TOWERS C AND D', false]]);
      const again = loadTrackedList(p, 'design', read.drafts, 'qs');
      assert.deepEqual([again.added, again.unchanged, p.checklist!.length], [[], 2, 2], refs ? 'with numbers' : 'without numbers');
      // The second phase's is received on the next copy: that line moves, and the first is left alone.
      const next = phased(refs);
      next.drafts[1]!.status = 'received';
      assert.deepEqual(loadTrackedList(p, 'design', next.drafts, 'qs').becameReceived.length, 1);
      assert.deepEqual(p.checklist!.map((item) => Boolean(item.received)), [true, true]);
    }
  });

  it('a load is one step that is taken back whole, and a list is removed whole', async () => {
    const p = project();
    addChecklistItems(p, 'finance', [{ title: 'A line typed by hand' }], 'pm');
    const read = await tracked(FIRST);
    loadTrackedList(p, 'finance', placeDrafts(read.drafts, packageDesks(read.packages, suggestedDesks(read.packages))), 'qs', { load: 'load_first' });
    const later = await tracked(second());
    loadTrackedList(p, 'finance', placeDrafts(later.drafts, packageDesks(later.packages, suggestedDesks(later.packages))), 'qs', { load: 'load_second' });
    assert.deepEqual(checklistLoads(p), [{ list: 'INFORMATION REQUIRED TO UPDATE THE BUDGET', lines: 17, departments: ['finance', 'design'] }]);
    // Taking the second load back takes the one line it added, and no line of the first.
    assert.deepEqual(removeChecklistLoad(p, { load: 'load_second' }, 'pm').map((item) => item.ref), ['2.1.3']);
    assert.equal(p.checklist!.length, 17);
    assert.throws(() => removeChecklistLoad(p, { load: 'load_second' }, 'pm'), /No line of that/);
    // The list taken off whole: every line of it on every desk, and nothing else.
    assert.equal(removeChecklistLoad(p, { list: 'information required to update the budget' }, 'pm').length, 16);
    assert.deepEqual(p.checklist!.map((item) => item.title), ['A line typed by hand']);
    // A plain list's load is taken back the same way.
    const plain = addChecklistItems(p, 'finance', [{ title: 'Soil report' }, { title: 'A line typed by hand' }], 'pm', { load: 'load_plain' });
    assert.deepEqual([plain.added.length, plain.skippedTitles], [1, ['A line typed by hand']]);
    assert.equal(removeChecklistLoad(p, { load: 'load_plain' }, 'pm').length, 1);
  });

  it('lines ticked are set together: in hand, partial, to be assumed, asked for on a day, owed by and wanted by', async () => {
    const p = await loaded();
    const ids = (refs: string[]) => refs.map((ref) => lineOf(p, ref).id);
    assignChecklistItems(p, ids(['1.3', '2.1.3', '4.1']), { standing: 'in_hand' }, 'pm@builders.example');
    assert.deepEqual(['1.3', '2.1.3', '4.1'].map((ref) => paper(p, ref).standing), ['in_hand', 'in_hand', 'in_hand']);
    assignChecklistItems(p, ids(['3.2', '3.3']), { standing: 'partial', wanted: 'Ironmongery schedule' }, 'pm');
    assert.deepEqual(['3.2', '3.3'].map((ref) => [paper(p, ref).standing, paper(p, ref).wanted]), Array(2).fill(['partial', 'Ironmongery schedule']));
    assignChecklistItems(p, ids(['5.4.15']), { standing: 'assumed', assumer: 'Northbank Cost Consultants' }, 'pm');
    assert.deepEqual([paper(p, '5.4.15').standing, paper(p, '5.4.15').assumer], ['assumed', 'Northbank Cost Consultants']);
    assert.throws(() => assignChecklistItems(p, ids(['1.4']), { standing: 'assumed' }, 'pm'), /Name who is to assume/);
    // Asked for on a day, with who owes them and the day they are wanted by, in the same act.
    assignChecklistItems(p, ids(['1.4', '4.2']), { standing: 'asked', askedOn: '10/10/2026', owedBy: 'Lake Road Developers', targetDate: '2026-10-31' }, 'pm');
    for (const ref of ['1.4', '4.2']) {
      const line = paper(p, ref);
      assert.deepEqual([line.standing, line.askedOn, line.party, line.dueAt], ['asked', '2026-10-10', 'Lake Road Developers', '2026-10-31']);
      assert.equal(paperLineSaid(line, day, { tracked: true }), 'Asked 2026-10-10 · due 2026-10-31');
    }
    assert.throws(() => assignChecklistItems(p, ids(['1.4']), { standing: 'asked', askedOn: 'last week' }, 'pm'), /as a date/);
  });

  it('a document is offered for a line only on words that mean something: "client" in both is no likeness', () => {
    const p = project();
    addChecklistItems(p, 'finance', [{ title: 'Client brief and design intent' }, { title: 'List of drawings' }, { title: 'Soil investigation report' }], 'pm');
    const file = (title: string, name: string) => {
      const row = addEvidence(p, { title, kind: 'document', status: 'received' }, 'pm');
      row.attachments.push({ id: `att_${row.id}`, fileName: name, mimeType: 'application/pdf', sizeBytes: 10, storageKey: `${row.id}.pdf`, uploadedAt: '2026-10-01T00:00:00.000Z' });
    };
    file('Client meeting notes', 'Client meeting notes 12 Oct.pdf');
    file('Drawing register details', 'List of client works.pdf');
    const none = checklistSheet(p, { now: NOW });
    assert.equal(none.toConfirm, 0, JSON.stringify(none.stages.flatMap((s) => s.packages.flatMap((k) => k.lines)).map((l) => l.suggestion?.title)));
    file('Borehole logs', 'soil-investigation-borehole-logs.pdf');
    const some = checklistSheet(p, { now: NOW }).stages.flatMap((s) => s.packages.flatMap((k) => k.lines));
    assert.deepEqual(some.map((line) => line.suggestion?.title), [undefined, undefined, 'Borehole logs']);
  });

  it('the list is counted one way on every screen: what is owed is what somebody was asked for', async () => {
    const p = project();
    addChecklistItems(p, 'procurement', Array.from({ length: 6 }, (_, n) => ({ title: `Paper ${n + 1}` })), 'pm');
    const view = papersOwed(p, { now: NOW });
    const overview = projectBrief(p, new Date(NOW)).find((line) => line.key === 'owed')!;
    // Six lines nobody was asked for: neither screen calls them owed.
    assert.deepEqual([view.askedFor, view.notAsked], [0, 6]);
    assert.equal(papersOwedSaid(view), 'Nothing owed · 6 not asked');
    assert.deepEqual([overview.parts, overview.quiet], [[], notAskedSaid(6)]);
    assert.equal(notAskedSaid(6), 'Nothing owed. 6 papers on the list, not asked for yet.');
    // Two asked for: both screens say two owed.
    assignChecklistItems(p, p.checklist!.slice(0, 2).map((item) => item.id), { standing: 'asked', askedOn: '2026-10-10' }, 'pm');
    const asked = papersOwed(p, { now: NOW });
    assert.equal(papersOwedSaid(asked), '2 owed · 2 asked for · 4 not asked');
    assert.equal(projectBrief(p, new Date(NOW)).find((line) => line.key === 'owed')!.parts[0]!.text, `${asked.askedFor} owed`);
  });

  it('lines nobody was asked for, with nobody named or no day, are said in one line with a count as what needs somebody', async () => {
    const p = project();
    assert.equal(papersNeedSaid(papersOwed(p, { department: 'procurement', now: NOW })), undefined);
    addChecklistItems(p, 'procurement', Array.from({ length: 60 }, (_, n) => ({ title: `Tender paper ${n + 1}` })), 'pm');
    assert.equal(papersNeedSaid(papersOwed(p, { department: 'procurement', now: NOW })), 'Papers owed: 60 not asked for yet, 60 with nobody named, 60 with no date.');
    assignChecklistItems(p, p.checklist!.map((item) => item.id), { owedBy: 'Lake Road Developers', targetDate: '2026-12-01', standing: 'asked' }, 'pm');
    assert.equal(papersNeedSaid(papersOwed(p, { department: 'procurement', now: NOW })), undefined);
    assert.equal(papersNeedSaid(papersOwed(p, { department: 'procurement', now: '2026-12-02T06:00:00.000Z' })), 'Papers owed: 60 overdue.');
  });
});

describe('a project that had a checklist before any of this', () => {
  /** A list as it was stored: a title and whatever it said, and nothing a tracked list adds. */
  function old(): DdProject {
    const p = project();
    addChecklistItems(
      p,
      'finance',
      [
        { title: 'Soil investigation report', stage: 'Concept', package: 'Civil and structural', owedBy: 'Geotechnical consultant' },
        { title: 'Built-up area statement', stage: 'Concept', package: 'Architectural and interiors' },
        { title: 'Basic prices', stage: 'Tender', package: 'MEP', note: 'For cement and steel' },
      ],
      'pm@builders.example',
    );
    const filed = addEvidence(p, { title: 'Built-up area statement', kind: 'document', status: 'received' }, 'pm');
    filed.attachments.push({ id: 'att_1', fileName: 'Built-up area statement.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'a.pdf', uploadedAt: '2026-10-01T00:00:00.000Z' });
    return p;
  }

  it('loads and reads as it did: the same lines, standings, words and file', () => {
    const p = old();
    for (const item of p.checklist!) assert.deepEqual(Object.keys(item).filter((key) => item[key as keyof typeof item] !== undefined).sort(), ['createdAt', 'createdBy', 'department', 'id', ...(item.note ? ['note'] : []), ...(item.owedBy ? ['owedBy'] : []), 'package', 'stage', 'title', 'updatedAt'].sort());
    const view = papersOwed(p, { now: NOW });
    assert.deepEqual([view.total, view.owed, view.notAsked, view.asked, view.answered, view.overdue, view.inHand.length], [3, 2, 2, 0, 0, 0, 1]);
    assert.deepEqual([view.partial, view.assumed.length, view.tracked, view.rounds], [0, 0, false, []]);
    assert.equal(papersOwedSaid(view), 'Nothing owed · 2 not asked');
    const lines = view.parties.flatMap((party) => party.lines);
    assert.deepEqual(
      lines.map((line) => [line.title, line.standing, line.where, paperLineSaid(line, day, { tracked: view.tracked })]),
      [
        ['Soil investigation report', 'not_asked', 'Concept · Civil and structural', 'On the list'],
        ['Basic prices', 'not_asked', 'Tender · MEP', 'On the list, nobody named'],
      ],
    );
    assert.equal(paperLineSaid(view.inHand[0]!, day), 'Built-up area statement.pdf');
    assert.equal(papersOwedCsvFile(view).split('\n')[0], '﻿Owed by,Paper,Standing,Asked on,Due,Overdue,Department,Where,Document');
    assert.equal(checklistSummary(p, { now: NOW }).tracked, false);
    const sheet = checklistSheet(p, { now: NOW });
    assert.deepEqual([sheet.total, sheet.received, sheet.pending, sheet.requested, sheet.partial, sheet.assumed, sheet.percent], [3, 1, 2, 0, 0, 0, 33]);
    for (const line of sheet.stages.flatMap((stage) => stage.packages.flatMap((pack) => pack.lines))) assert.equal(line.mark, undefined);
  });

  it('keeps its own lines apart from a tracked list loaded beside it', async () => {
    const p = old();
    const read = await tracked(FIRST);
    loadTrackedList(p, 'finance', placeDrafts(read.drafts, packageDesks(read.packages, suggestedDesks(read.packages))), 'qs@northbank.example');
    assert.equal(p.checklist!.length, 19);
    assert.deepEqual(p.checklist!.slice(0, 3).map((item) => [item.title, item.list, item.ref]), [['Soil investigation report', undefined, undefined], ['Built-up area statement', undefined, undefined], ['Basic prices', undefined, undefined]]);
  });
});

describe('what a collaborator’s copy holds of it', () => {
  it('is none of the list, and so no value assumed because of it', async () => {
    const p = await loaded();
    const tender = addFieldRecord(p, TENDER_TERMS, { contract_months: 18 }, 'buyer').record!;
    assumeChecklistItem(p, lineOf(p, '2.1.2').id, { assumer: 'NCC', fields: [{ address: { fn: 'procurement.boq', set: TENDER_TERMS, field: 'defects_months', record: tender.id }, value: 12 }] }, 'buyer');
    const grant: ProjectGrant = { id: 'g1', tenantId: 't1', projectId: p.id, email: 'agent@tenders.example', role: 'contributor', allAssessments: true, assessmentIds: [], allScopes: false, scopeKeys: ['cost_quantity', 'procurement'], areas: [], createdAt: NOW, createdBy: 'dev' };
    const copy = projectView(p, { kind: 'granted', grant, email: grant.email }).project;
    assert.deepEqual([copy.checklist, copy.tenderForms], [[], []]);
    assert.equal(papersOwed(copy, { now: NOW, outside: true }).total, 0);
    const field = readSheet(copy, TENDER_TERMS, tender.id)!.fields.find((view) => view.def.key === 'defects_months')!;
    assert.equal(field.state, 'empty');
    assert.ok(!JSON.stringify(copy).includes('NCC to assume') && !JSON.stringify(copy).includes('Cost to be considered based on area'));
  });
});
