/**
 * A consultant's other papers as they are sent, and what a project then says
 * of itself: a tracked list, a tender form, a due diligence report's
 * observations, the owner pack for a month, the parties, and the questions a
 * person asks the chat in their own words.
 *
 * Each case holds a layout a rehearsal on a consultant's own papers showed an
 * earlier guess had missed. Every paper here is invented, and reproduces the
 * layout and nothing else:
 *
 * - a tracked list whose section heading carries a remark of its own, which
 *   was loaded as a paper and put every count one over;
 * - a tender form whose rows are written in as few words as their section
 *   allows ("Interest", "Ceiling"), which were read as their neighbours';
 * - a report's observations under a page number set as "1 | P a g e", with
 *   two-figure row numbers set as "1 0", and a row with no recommendation;
 * - a schedule brought in during one month that dates a milestone as done in
 *   an earlier one, read by a pack for a month in between.
 *
 * Every name, firm and figure is made up.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FieldRefused,
  PARTY_GROUPS,
  TENDER_FORM_ROWS,
  TENDER_TERMS,
  addCostReportPackage,
  addFieldRecord,
  chatQuestionAsked,
  chatQuestionRuled,
  checklistSheet,
  checklistSummary,
  createProject,
  daysInWords,
  departmentAnalytics,
  formatMoneyIn,
  importSchedule,
  issueCostReport,
  loadTenderForm,
  loadTrackedList,
  markMilestonePercent,
  mergeParties,
  ownerPack,
  ownerPackPeriod,
  packageDesks,
  pagesSaid,
  papersOwed,
  parseTenderFormRows,
  parseTrackedRows,
  partiesByRole,
  partyReferences,
  placeDrafts,
  progressReadings,
  projectAsAt,
  projectBrief,
  quickAssessment,
  readFunctionFields,
  removeParty,
  renameParty,
  reportObservations,
  setFieldValues,
  startCostReport,
  tenderFormRowsFor,
  type DdProject,
} from '@realytica/shared';

const WHO = 'lead@harbour.example';

function project(stage: 'construction' | 'procurement' = 'construction'): DdProject {
  return createProject({ name: 'Harbour Court', type: 'residential', location: 'Quay Road', city: 'Kadamba', currentStage: stage }, 'RYT-PS1', WHO);
}

/* ==================================================================== */
/* A tracked list                                                        */
/* ==================================================================== */

const LIST_HEAD = ['Ref No', 'Orig. Sl.No', 'Package', 'Description of Information Required', 'Availability (at request)', 'Request Ref', 'Client Response / Remarks', 'Current Status', 'Responsibility', 'Target Date', 'Next Action / Comments'];
const LIST: string[][] = [
  ['Information required to firm up the estimate'],
  ['Status key: Received / Partial / To assume / Pending'],
  LIST_HEAD,
  ['1', '', '', 'GENERAL'],
  ['1.1', '1', 'General', 'Site survey with levels', 'Not available', 'Letter 01', 'Sent', 'Received'],
  ['1.2', '2', 'General', 'Sanctioned plan set', 'Partially available', 'Letter 01', 'Two sheets short', 'Partial'],
  ['2', '', '', 'ENVELOPE AND FINISHES'],
  ['2.1', '', '', 'Joinery'],
  ['2.1.1', '3', 'Envelope and finishes', 'Door schedule', 'Not available', 'Letter 01', '', 'Pending'],
  // A sub-section's heading that carries a remark on the whole of it, and nothing an item carries.
  ['2.2', '', '', 'Curtain wall', '', '', 'Concept note attached'],
  ['2.2.1', '4', 'Envelope and finishes', 'Glazing specification', 'Not available', 'Letter 02', '', 'Pending'],
  ['2.2.2', '5', 'Envelope and finishes', 'Wind load statement', 'Not available', 'Letter 02', '', 'Estimator to assume'],
];

describe('a tracked list whose section heading carries a remark', () => {
  const read = parseTrackedRows(LIST)!;

  it('reads the heading as a section and never as a paper, so every count is the sheet’s own', () => {
    assert.deepEqual(read.drafts.map((draft) => draft.ref), ['1.1', '1.2', '2.1.1', '2.2.1', '2.2.2']);
    assert.deepEqual([read.rows, read.drafts.length, read.sections, read.skipped.length], [9, 5, 4, 0], 'nine rows under the header: five lines and four sections');
    // The two lines under it sit under it, with its remark, and not under the heading before.
    const glazing = read.drafts.find((draft) => draft.ref === '2.2.1')!;
    assert.deepEqual(glazing.headings, [{ ref: '2', title: 'ENVELOPE AND FINISHES' }, { ref: '2.2', title: 'Curtain wall', remark: 'Concept note attached' }]);
    assert.deepEqual(read.drafts.find((draft) => draft.ref === '2.1.1')!.headings?.at(-1), { ref: '2.1', title: 'Joinery' });
  });

  it('still reads an item with a remark and no status column as an item where the list keeps no status', () => {
    const noStatus = parseTrackedRows([['Ref No', 'Description', 'Availability (at request)', 'Request Ref', 'Remarks'], ['1', 'Site survey', 'Not available', 'Letter 01', 'Sent'], ['1.1', 'Levels', '', '', 'With the survey']]);
    assert.deepEqual(noStatus?.drafts.map((draft) => draft.title), ['Site survey', 'Levels']);
  });

  it('stays on the desk it is loaded on, and is counted there one list at a time', () => {
    const p = project();
    loadTrackedList(p, 'finance', placeDrafts(read.drafts, packageDesks(read.packages)), WHO);
    // A second list on the same desk, and one line of the first sent to another department by choice.
    loadTrackedList(p, 'finance', [{ title: 'Bank sanction letter', list: 'Lender’s list', ref: '1', package: 'General', status: 'pending' }], WHO);
    assert.deepEqual([...new Set(p.checklist!.map((item) => item.department))], ['finance']);
    const one = checklistSummary(p, { department: 'finance', list: read.list });
    assert.deepEqual([one.total.total, one.total.received, one.total.partial, one.total.assumed, one.total.pending], [5, 1, 1, 1, 2], 'the lender’s line is not added into this list’s table');
    assert.deepEqual(one.rounds, [{ round: 'Letter 01', total: 3 }, { round: 'Letter 02', total: 2 }]);
    assert.deepEqual(one.elsewhere, []);
    // One package sent to Design by choice: this desk counts what it holds and says where the rest is.
    const split = project();
    loadTrackedList(split, 'finance', placeDrafts(read.drafts, packageDesks(read.packages, { 'Envelope and finishes': 'design.finishes' })), WHO);
    const here = checklistSummary(split, { department: 'finance', list: read.list });
    assert.deepEqual([here.total.total, here.rounds, here.elsewhere], [2, [{ round: 'Letter 01', total: 2 }], [{ department: 'design', lines: 3 }]], 'a chip never counts a line that is on another desk');
  });
});

/* ==================================================================== */
/* A tender form                                                         */
/* ==================================================================== */

/** A consultant's form in its own few words, a row to each row of the table: its number, what it asks, and the form of the answer. */
const TERSE: Array<[no: string, item: string, details: string]> = [
  ['1.1', 'Owner', 'Company, registered office, contact, phone, email'],
  ['1.2', 'Architect', 'Firm, address, contact, phone, email'],
  ['1.3', 'Structural Consultant', 'Firm, address, contact, phone, email'],
  ['1.4', 'MEP Consultant', 'Firm, address, contact, phone, email'],
  ['1.5', 'PMC', 'Firm, address, contact, phone, email (where appointed)'],
  ['1.6', 'Others (landscape, lighting and the like)', 'Firm, scope, contact (where appointed)'],
  ['2.1', 'EMD applicable?', 'Yes / No'],
  ['2.2', 'How much', 'A sum in rupees, or % of the tender value'],
  ['2.3', 'In what form', 'DD / BG / online; payable to whom'],
  ['2.4', 'Validity & refund', 'Days valid, and days to refund the losing bidders'],
  ['3.1', 'Advance applicable?', 'Yes / No'],
  ['3.2', 'Advance %', '% of the contract value'],
  ['3.3', 'Security for it', 'BG at 100% / 110%, and when it is due'],
  ['3.4', 'Interest', 'Free of interest, or bearing it (the rate)'],
  ['3.5', 'How recovered', 'From which RA bill, and recovered in full by what % of work'],
  ['4.1', 'What the client supplies', 'Cement, reinforcement steel, others, or none'],
  ['4.2', 'Rate of issue', 'Rs. per unit for each'],
  ['4.3', 'Delivery, storage', 'Where delivered, who unloads, who keeps custody'],
  ['4.4', 'Wastage & recovery', 'Wastage % allowed and the penal rate beyond it'],
  ['5.1', 'Water', 'At site? Source; free / chargeable'],
  ['5.2', 'Power', 'At site? Point of supply and load; free / chargeable'],
  ['5.3', 'Borewell / generator', 'Borewell allowed? Contractor to bring a DG set?'],
  ['6.1', 'Retention rate', '% held from each running bill'],
  ['6.2', 'Ceiling', 'Held up to % of the contract or executed value'],
  ['6.3', 'When released', '% on completion, the rest after the DLP'],
  ['6.4', 'Against a BG?', 'May it be released against a guarantee? Yes / No'],
  ['6.5', 'Security deposit or performance guarantee', '% of the contract value, its form and how long it runs'],
  ['7.1', 'Kind of contract', 'Item rate / Lump sum / Re-measurable / Design & Build'],
  ['7.2', 'Price basis', 'Firm, or with escalation (the formula or indices)'],
  ['7.3', 'Period', 'Months to complete, and the expected start'],
  ['7.4', 'DLP', 'Months from completion'],
  ['7.5', 'LD', 'Rate per week or day, and the cap (%)'],
  ['7.6', 'Payment', 'How often billed, the least bill, days to certify and to pay'],
  ['8.1', 'Makes list', 'The approved makes for every material'],
  ['8.2', 'Alternates', 'Whether equivalents are allowed, and who approves'],
  ['9.1', 'Guarantee format: EMD', 'The client’s format'],
  ['9.2', 'Guarantee format: advance', 'The client’s format'],
  ['9.3', 'Guarantee format: security deposit or performance', 'The client’s format'],
  ['9.4', 'Banks accepted', 'Which banks a BG may come from'],
  ['10.1', 'Appendix 1 – Specifications', 'The final technical specifications'],
  ['10.2', 'Appendix 2 – BOQ', 'The final schedule of quantities'],
  ['10.3', 'Appendix 3 – Drawings', 'The tender set with its list and revisions'],
  ['10.4', 'Appendix 4 – Advance guarantee specimen', 'The client’s format'],
  ['10.5', 'Appendix 5 – Insurance', 'Policies, sums insured, and by whom'],
  ['10.6', 'Appendix 6 – Warranty', 'What is under warranty and for how long'],
  ['10.7', 'Appendix 7 – Warranty format', 'The client’s format'],
  ['10.8', 'Appendix 8 – Basic prices', 'The materials with their basic rates'],
  ['10.9', 'Appendix 9 – Day work', 'The labour and plant to be rated'],
  ['10.10', 'Appendix 10 – Soil report', 'The final geotechnical report'],
  ['10.11', 'Safety manual / site rules', 'The client’s HSE manual, if any'],
];
/** The ten sections, headed in capitals as a form heads them, by the table's own names for them. */
const SECTION_SAID: Record<string, string> = Object.fromEntries(TENDER_FORM_ROWS.map((section) => [section.no, section.title.toUpperCase()]));

/** The form as a sheet's rows, each row answered by `answers[no]` where one is given. */
function formRows(answers: Record<string, string> = {}): string[][] {
  const rows: string[][] = [['INFORMATION WANTED FROM THE CLIENT BEFORE THE TENDER IS WRITTEN'], ['Project', '', 'Harbour Court'], ['Client', '', 'Harbour Court Homes'], ['Package', '', 'Frame and envelope'], ['Response Required by', '', '20/11/2026'], [], ['S.No', 'Information / Document Required', 'Details to be Provided', 'Client Response', 'Document Attached', 'Remarks']];
  let section = '';
  for (const [no, item, details] of TERSE) {
    const of = no.split('.')[0]!;
    if (of !== section) rows.push([of, SECTION_SAID[(section = of)]!]);
    rows.push([no, item, details, answers[no] ?? '', '', '']);
  }
  rows.push([], ['Name of the client’s representative'], ['Signed, with the date']);
  return rows;
}

describe('a tender form written in as few words as its sections allow', () => {
  const table = TENDER_FORM_ROWS.flatMap((section) => section.rows);

  it('has a row of the table for every row of the form, and each is its own', () => {
    assert.deepEqual(TERSE.map(([no]) => no), table.map((row) => row.no), 'the table is the form: fifty rows in ten sections');
    const read = parseTenderFormRows(formRows())!;
    assert.equal(read.rows.length, 50);
    const matched = tenderFormRowsFor(read.rows);
    assert.deepEqual(matched.map((row, n) => [read.rows[n]!.no, row?.no]).filter(([asked, got]) => asked !== got), [], 'no row is read as its neighbour’s, and none is left unmatched');
  });

  it('gives every row a field of the kind its answer takes, or the paper it asks for', () => {
    const read = parseTenderFormRows(formRows())!;
    const matched = tenderFormRowsFor(read.rows);
    const faults: string[] = [];
    read.rows.forEach((written, n) => {
      const row = matched[n];
      if (!row) return void faults.push(`${written.no} ${written.item}: no row of the table`);
      // The one row that is words alone: other consultants, each with a role, typed as parties.
      if (!row.fields.length && !row.paper && row.no !== '1.6') faults.push(`${written.no} ${written.item}: reaches no field and no paper`);
      const kinds = new Set(row.fields.map((field) => field.read.as));
      // A material's wastage and its rate are read into the materials' own table, which takes both.
      const asks = (kind: string, says: RegExp) => says.test(written.details) && row.fields.length > 0 && !kinds.has(kind as never) && !kinds.has('materials');
      if (asks('yes_no', /\byes\s*\/\s*no\b/i)) faults.push(`${written.no} ${written.item}: asks yes or no, and no field of it takes one`);
      if (asks('share', /%/)) faults.push(`${written.no} ${written.item}: asks a percentage, and no field of it takes one`);
      if (/\bmonths?\b/i.test(written.details) && row.fields.length > 0 && !kinds.has('count') && !kinds.has('share')) faults.push(`${written.no} ${written.item}: asks a period, and no field of it takes one`);
    });
    assert.deepEqual(faults, []);
  });

  it('lists every answer row of a blank form as owed by the client, none missing', () => {
    const p = project('procurement');
    const report = loadTenderForm(p, parseTenderFormRows(formRows())!, { file: 'Client inputs.xlsx', actor: WHO, today: '2026-11-01' });
    // The one thing a blank form states is the day its reply is wanted by, in the lines above the table.
    assert.deepEqual([report.rows, report.unanswered, report.owed.added.length, report.unmatched, report.offered], [50, 50, 50, [], 1]);
    assert.deepEqual(p.checklist!.map((item) => item.ref), TERSE.map(([no]) => no));
    assert.ok(report.record, 'and a blank form still has a record whose sheet the answers are typed on');
    assert.deepEqual([...new Set(p.checklist!.map((item) => item.owedBy))], ['Harbour Court Homes'], 'owed by the client as the form names it, where People names no owner');
    // Where People names one owner, the rows are that party's, by the name every other list uses.
    const named = project('procurement');
    addFieldRecord(named, 'shared.parties', { name: 'Harbour Court Homes Pvt Ltd', roles: ['owner'] }, WHO);
    loadTenderForm(named, parseTenderFormRows(formRows())!, { file: 'Client inputs.xlsx', actor: WHO, today: '2026-11-01' });
    assert.deepEqual([...new Set(named.checklist!.map((item) => item.owedBy))], ['Harbour Court Homes Pvt Ltd']);
  });

  it('ticks a line owed when its answer is typed on the Tender terms sheet', () => {
    const p = project('procurement');
    const report = loadTenderForm(p, parseTenderFormRows(formRows())!, { file: 'Client inputs.xlsx', actor: WHO, today: '2026-11-01' });
    const standing = (no: string) => checklistSheet(p).stages.flatMap((stage) => stage.packages.flatMap((pack) => pack.lines)).find((line) => line.item.ref === no)!;
    assert.deepEqual([standing('6.1').status, standing('7.4').status], ['requested', 'requested']);
    assert.deepEqual(setFieldValues(p, { set: TENDER_TERMS, record: report.record! }, { retention_pct: 5, defects_months: 12 }, WHO).rejected, []);
    assert.deepEqual([standing('6.1').status, standing('6.1').bySheet, standing('7.4').status, standing('6.2').status], ['received', true, 'received', 'requested']);
    const owed = papersOwed(p, { department: 'procurement' });
    assert.equal(owed.parties.flatMap((party) => party.lines).some((line) => line.ref === '6.1'), false, 'and it is no longer among the papers owed');
  });

  it('offers each answer to its own field: the retention rate, its ceiling, the interest on the advance, the earnest money’s amount and the advance’s share', () => {
    const p = project('procurement');
    const answers = { '2.1': 'Yes', '2.2': 'Rs. 12,00,000', '3.1': 'Yes', '3.2': '10% of the contract value', '3.4': 'Interest-bearing at 9% a year', '5.3': 'Borewell not allowed; contractor to bring a DG set', '6.1': '5%', '6.2': '7.5% of the contract value', '7.4': '12 months' };
    const report = loadTenderForm(p, parseTenderFormRows(formRows(answers))!, { file: 'Client inputs.xlsx', actor: WHO, today: '2026-11-01' });
    assert.deepEqual([report.unmatched, report.unread, report.refused, report.unanswered], [[], [], [], 41]);
    const line = readFunctionFields(p, 'procurement.boq', new Date('2026-11-01T06:00:00Z')).needs.accept.find((held) => held.parts)!;
    const offered = Object.fromEntries(line.parts!.map((part) => [part.label, part.text]));
    assert.deepEqual(
      [offered['Retention from each running bill'], offered['Retention, at most'], offered['The cap is of the'], offered['Mobilisation advance: Interest'], offered['Mobilisation advance: Rate of interest a year'], offered['Earnest money deposit: Amount'], offered['Mobilisation advance: Advance, of the contract value'], offered['Defects liability period']],
      ['5%', '7.5%', 'contract value', 'interest bearing', '9%', '₹12 lakh', '10%', '12 months'],
      'each shown among the offered values, the ones on a sheet that opens only once "applies: yes" is accepted among them',
    );
    assert.deepEqual([offered['Contractor may sink a borewell'], offered['Contractor to provide generator backup']], ['no', 'yes'], 'one row that asks two things answers both');
  });
});

/* ==================================================================== */
/* A report's observations                                               */
/* ==================================================================== */

describe('a report’s observations set in a table whose text layer spaces its figures', () => {
  const pageOne = ['1 | P a g e', 'FINDINGS AND REMEDIES', 'NO. WHAT WAS FOUND', 'RISK', 'RATING', 'REMEDY'];
  const seen = (n: number) => `Observation number ${n} is that the plant room door opens against the escape route.`;
  const rows = (from: number, to: number, spaced: boolean, bare?: number): string[] =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i).flatMap((n) => [spaced && n >= 10 ? String(n).split('').join(' ') : String(n), seen(n), n % 2 ? 'High Risk' : 'Moderate Risk', ...(n === bare ? [] : [`Rehang door ${n} to open with the escape route.`])]);
  const read = reportObservations([[...pageOne, ...rows(1, 9, false)].join('\n'), ['2 | P a g e', ...rows(10, 13, true, 11)].join('\n')]);

  it('offers every one, numbered as the report numbers them, across the page break', () => {
    assert.deepEqual(read.map((one) => one.number), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);
    assert.deepEqual(read.map((one) => one.page), [1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2]);
    assert.deepEqual(read.map((one) => one.risk).slice(0, 4), ['high', 'medium', 'high', 'medium']);
  });

  it('never runs the page’s number or the table’s headings into what was seen', () => {
    assert.equal(read[0]!.seen, seen(1));
    assert.equal(read[9]!.seen, seen(10), 'the tenth is the tenth, not the first with a nought before its words');
    assert.equal(read.some((one) => /P a g e|FINDINGS|REMEDY|RATING/.test(`${one.seen} ${one.action ?? ''}`)), false);
  });

  it('keeps a row with no recommendation as it is written, and does not borrow the next row’s', () => {
    assert.deepEqual([read[10]!.seen, read[10]!.action], [seen(11), undefined]);
    assert.equal(read[11]!.action, 'Rehang door 12 to open with the escape route.');
  });
});

/* ==================================================================== */
/* The owner pack for a month, and the board                             */
/* ==================================================================== */

describe('an owner pack for a month that has ended', () => {
  const OCTOBER = new Date('2026-10-13T06:00:00.000Z');
  function scheduled(): DdProject {
    const p = project();
    // A schedule brought in on 13 October: one milestone done in June, one under way, one not begun.
    importSchedule(
      p,
      [
        { name: 'Excavation', plannedStart: '2026-04-01', plannedFinish: '2026-06-30', weight: 10, percent: 100 },
        { name: 'Basement', plannedStart: '2026-07-01', plannedFinish: '2026-09-15', weight: 20, percent: 55 },
        { name: 'Frame', plannedStart: '2026-09-16', plannedFinish: '2027-03-31', weight: 70, percent: 0 },
      ],
      WHO,
      OCTOBER.toISOString(),
    );
    return p;
  }
  const said = (p: DdProject, key: string, month = '2026-09') => ownerPack(p, ownerPackPeriod({ month }), OCTOBER).sections.find((section) => section.key === key)!.parts.flatMap((part) => [...part.lines.map((line) => line.what), part.note ?? '']).filter(Boolean);

  it('reads a milestone the record dates as done in June as done, though the schedule was typed in October', () => {
    const p = scheduled();
    const excavation = p.milestones!.find((m) => m.name === 'Excavation')!;
    assert.equal(excavation.completedOn, '2026-06-30');
    const then = projectAsAt(p, '2026-09-30').milestones!;
    // Done in June: done. At 55% as typed in October: nothing says where it stood in September. At nought in October: not begun in September either.
    assert.deepEqual(then.map((m) => [m.name, m.percent, m.completedOn, m.unread]), [['Excavation', 100, '2026-06-30', undefined], ['Basement', 0, undefined, true], ['Frame', 0, undefined, undefined]]);
  });

  it('says there is no reading for the month, and prints no late count against anything', () => {
    const p = scheduled();
    assert.equal(said(p, 'standing')[1], '10% complete: 1 of 3 milestones finished, each weighted by its share of the work. 1 milestone has no reading for September 2026 and is counted as not begun.');
    assert.deepEqual(said(p, 'time'), ['No reading for September 2026: Basement. Nothing is said of it here.']);
    assert.equal(JSON.stringify(ownerPack(p, ownerPackPeriod({ month: '2026-09' }), OCTOBER)).includes('days late'), false, 'a milestone planned to finish on 15 September with no reading by the 30th is not said to be 15 days late at 0%');
    // Every unfinished milestone typed after the month: there is no percent to give for it at all.
    const all = project();
    importSchedule(all, [{ name: 'Excavation', plannedStart: '2026-04-01', plannedFinish: '2026-06-30', weight: 10, percent: 100 }, { name: 'Basement', plannedStart: '2026-07-01', plannedFinish: '2026-09-15', weight: 20, percent: 55 }], WHO, OCTOBER.toISOString());
    assert.equal(said(all, 'standing')[1], 'No reading for September 2026: no progress is dated on or before 30 Sep 2026 for 1 milestone. 1 of 2 milestones is dated as finished by then.');
  });

  it('reads a reading dated in the month though it was entered after it, and then says how late', () => {
    const p = scheduled();
    // Seen on site on 28 September, typed on the board on 13 October by somebody who may.
    markMilestonePercent(p, p.milestones!.find((m) => m.name === 'Basement')!.id, 40, WHO, { now: OCTOBER, on: '2026-09-28' });
    const basement = p.milestones!.find((m) => m.name === 'Basement')!;
    assert.deepEqual(progressReadings(p, basement), [{ on: '2026-09-28', percent: 40 }, { on: '2026-10-13', percent: 55 }], 'the earlier day is kept at its day, and lowers nothing');
    assert.equal(basement.percent, 55);
    const then = projectAsAt(p, '2026-09-30').milestones!.find((m) => m.name === 'Basement')!;
    assert.deepEqual([then.percent, then.unread], [40, undefined]);
    const time = said(p, 'time');
    assert.equal(time[0], 'Basement: 15 days late, 40% done.');
    assert.throws(() => markMilestonePercent(p, basement.id, 60, WHO, { now: OCTOBER, on: '2026-10-20' }), /not one still ahead/);
  });

  it('shows cost and time for the same month: the latest Cost Report issued for a period that has ended by its last day, named', () => {
    const p = scheduled();
    const august = startCostReport(p, { month: '2026-08-01', seedPackages: false }, WHO);
    addCostReportPackage(p, august.id, { name: 'Frame and envelope', budget: 9_00_00_000, anticipatedCost: 9_40_00_000, awardedTo: 'Harbourline Constructions' }, WHO);
    issueCostReport(p, august.id, WHO);
    const cost = said(p, 'cost', '2026-10');
    assert.equal(cost[0], 'No Cost Report is issued for October 2026. What follows is the latest issued before it: August 2026, for the period to 31 Aug 2026.');
    assert.match(cost[1]!, /^As at August 2026: forecast ₹9\.4 Cr against a budget of ₹9 Cr, ₹40 lakh over\.$/);
    // Awarded to a party with no PO figure typed: awarded, and said so.
    assert.deepEqual(said(p, 'decisions', '2026-10').filter((line) => /awarded/i.test(line)), ['Awarded, PO value not entered: Frame and envelope, to Harbourline Constructions, budget ₹9 Cr.']);
    // And October's time section stands beside it, read as the board reads it.
    assert.match(said(p, 'time', '2026-10').join(' '), /Basement: \d+ days late, 55% done\./);
  });
});

/* ==================================================================== */
/* Overview                                                              */
/* ==================================================================== */

describe('what Overview says of a project in two places', () => {
  it('counts what waits to be accepted the same way in its top line and by department', () => {
    const p = project('procurement');
    loadTenderForm(p, parseTenderFormRows(formRows({ '6.1': '5%', '7.4': '12 months', '7.1': 'Item rate' }))!, { file: 'Client inputs.xlsx', actor: WHO, today: '2026-11-01' });
    const now = new Date('2026-11-01T06:00:00Z');
    const top = projectBrief(p, now).find((line) => line.key === 'needs')!.parts.find((part) => /to accept/.test(part.text))!.text;
    const byDepartment = departmentAnalytics(p, now).departments.reduce((sum, department) => sum + department.waiting.count, 0);
    assert.equal(top, `${byDepartment} to accept`, 'never "N to accept" above "nothing waits in any department"');
    assert.ok(byDepartment > 0);
  });

  it('never badges Budget "clear" beside a forecast over its budget, nor Progress beside a milestone that is late', () => {
    const p = project();
    const report = startCostReport(p, { month: '2026-08-01', seedPackages: false }, WHO);
    addCostReportPackage(p, report.id, { name: 'Frame and envelope', budget: 9_00_00_000, anticipatedCost: 9_40_00_000 }, WHO);
    issueCostReport(p, report.id, WHO);
    importSchedule(p, [{ name: 'Basement', plannedStart: '2026-07-01', plannedFinish: '2026-09-15', weight: 20, percent: 55 }], WHO, '2026-10-13T06:00:00.000Z');
    assert.equal(quickAssessment(p, 'finance.budget')?.verdictSaid, 'Over budget');
    assert.equal(quickAssessment(p, 'construction.progress')?.verdictSaid, 'Late');
  });
});

/* ==================================================================== */
/* Parties                                                               */
/* ==================================================================== */

describe('a party that was typed wrongly', () => {
  function withParties(): { p: DdProject; mep: string; twin: string; lender: string } {
    const p = project('procurement');
    const add = (name: string, role: string) => addFieldRecord(p, 'shared.parties', { name, roles: [role] }, WHO).record!.id;
    const mep = add('Voltlne Services', 'mep_consultant');
    const twin = add('Voltline Services', 'mep_consultant');
    const lender = add('Quay Bank', 'lender');
    loadTrackedList(p, 'finance', [{ title: 'Load schedule', list: 'Estimate list', ref: '1', owedBy: 'Voltlne Services', status: 'pending' }, { title: 'Cable routes', list: 'Estimate list', ref: '2', owedBy: 'Voltline Services', status: 'pending' }], WHO);
    return { p, mep, twin, lender };
  }
  const names = (p: DdProject) => partiesByRole(p).groups.flatMap((group) => group.parties.map((party) => party.name));

  it('is renamed, and the papers owed that named it follow', () => {
    const { p, mep, lender } = withParties();
    assert.throws(() => renameParty(p, mep, 'Voltline Services', WHO), (err: unknown) => err instanceof FieldRefused && /already called Voltline Services\. If they are the same party, merge the two\./.test((err as Error).message));
    assert.deepEqual(renameParty(p, lender, 'Quayside Bank', WHO), { name: 'Quayside Bank', moved: 0 });
    assert.deepEqual(renameParty(p, mep, 'Voltline MEP', WHO), { name: 'Voltline MEP', moved: 1 });
    assert.deepEqual(p.checklist!.map((item) => item.owedBy), ['Voltline MEP', 'Voltline Services']);
    assert.ok(names(p).includes('Voltline MEP') && names(p).includes('Quayside Bank'));
  });

  it('is merged with its duplicate, and every paper and link that named it names the party kept', () => {
    const { p, mep, twin } = withParties();
    const tender = addFieldRecord(p, TENDER_TERMS, { mep_consultant: mep }, WHO).record!.id;
    assert.deepEqual(mergeParties(p, twin, mep, WHO), { name: 'Voltline Services', moved: 2 });
    assert.deepEqual(p.checklist!.map((item) => item.owedBy), ['Voltline Services', 'Voltline Services']);
    assert.equal(p.fieldSheets![TENDER_TERMS]!.records!.find((record) => record.id === tender)!.values.mep_consultant!.value, twin);
    assert.deepEqual(names(p).filter((name) => /Volt/.test(name)), ['Voltline Services']);
  });

  it('is removed only while nothing refers to it, and the refusal says what does', () => {
    const { p, mep, lender } = withParties();
    assert.deepEqual(partyReferences(p, mep), [{ what: 'a paper owed that names it', count: 1 }]);
    assert.throws(() => removeParty(p, mep, WHO), (err: unknown) => err instanceof FieldRefused && err.message === 'Voltlne Services cannot be removed while a paper owed that names it refers to it. Merge it into the right party, or take that off first.');
    removeParty(p, lender, WHO);
    assert.equal(names(p).includes('Quay Bank'), false);
    assert.ok(PARTY_GROUPS.some((group) => group.key === 'lender'));
  });

  it('is renamed only by somebody who may edit the project’s people', () => {
    const { p, lender } = withParties();
    assert.throws(() => renameParty(p, lender, 'Quayside Bank', 'reader@harbour.example', { mayEdit: () => false }), FieldRefused);
    assert.throws(() => removeParty(p, lender, 'contributor@harbour.example', { mayEdit: () => true, mayDecide: () => false }), /needs a lead or signer/);
  });
});

/* ==================================================================== */
/* The chat, in a person's own words                                     */
/* ==================================================================== */

describe('a question asked the way a person says it', () => {
  it('is known in its other wordings', () => {
    assert.deepEqual(chatQuestionAsked('what has the MEP consultant not sent yet'), { shape: 'papers_pending', party: 'MEP consultant' });
    assert.deepEqual(chatQuestionAsked('what hasn’t the architect given us'), { shape: 'papers_pending', party: 'architect' });
    assert.deepEqual(chatQuestionAsked('what is the client yet to send'), { shape: 'papers_pending', party: 'client' });
    assert.deepEqual(chatQuestionAsked('pending from the client'), { shape: 'papers_pending', party: 'client' });
    assert.deepEqual(chatQuestionAsked('what do I need to do today'), { shape: 'needs_me' });
    // An instruction, and a question of another shape, are still not these.
    assert.equal(chatQuestionAsked('set the budget to 4 Cr'), undefined);
    assert.equal(chatQuestionAsked('what has the board decided'), undefined);
    assert.equal(chatQuestionAsked('what should I do next on title'), undefined, 'what is next is still the next step’s to answer');
  });

  it('names a party by what it is to the project as well as by its name', () => {
    const p = project();
    addFieldRecord(p, 'shared.parties', { name: 'Harbour Court Homes', roles: ['owner'] }, WHO);
    addFieldRecord(p, 'shared.parties', { name: 'Voltline Services', roles: ['mep_consultant'] }, WHO);
    loadTrackedList(p, 'finance', [{ title: 'Title deed copy', list: 'Estimate list', ref: '1', owedBy: 'Harbour Court Homes', round: 'Letter 01', status: 'pending' }], WHO);
    const client = chatQuestionRuled(p, 'pending from the client', { now: new Date('2026-11-01T06:00:00Z') })!;
    assert.equal(client.card.outcome, 'answered');
    assert.deepEqual(client.card.rows.map((row) => row.label), ['Harbour Court Homes (the owner) · owed', 'Harbour Court Homes (the owner) · Asked for']);
    assert.doesNotMatch(client.card.said?.lead ?? '', /goes by/);
    // A role People names somebody for, who owes nothing: said so, not "nobody goes by".
    const mep = chatQuestionRuled(p, 'what has the MEP consultant not sent yet', { now: new Date('2026-11-01T06:00:00Z') })!;
    assert.equal(mep.card.said?.lead, 'Nothing on the papers owed lists is owed by Voltline Services, the MEP consultant.');
  });
});

/* ==================================================================== */
/* Said one way                                                          */
/* ==================================================================== */

describe('words and figures said one way', () => {
  it('writes nothing as ₹0 in every unit, pages as a short run, and a day in a line of words as a day', () => {
    assert.deepEqual([formatMoneyIn(0, 'crore'), formatMoneyIn(0, 'lakh'), formatMoneyIn(49, 'crore')], ['₹0', '₹0', '₹0']);
    assert.deepEqual([pagesSaid([4]), pagesSaid([3, 2]), pagesSaid([1, 6, 7, 8, 9, 10, 11, 12]), pagesSaid([])], ['page 4', 'pages 2 and 3', 'pages 1 and 6 to 12', '']);
    assert.equal(daysInWords('Logged the site entry for 2026-09-29.'), 'Logged the site entry for 29 Sep 2026.');
    assert.equal(daysInWords('Saved at 2026-09-29T10:00:00Z'), 'Saved at 2026-09-29T10:00:00Z', 'a timestamp is not a day in words');
  });
});
