/**
 * The project's own checklist: a list somebody sent, loaded as it was
 * written and worked by stage and package.
 *
 * The cases are the ones a project manager meets with a consultant's
 * "information required": a list pasted from an email, one exported from a
 * spreadsheet, the same list sent twice, a paper that has arrived under its
 * own name and one that only looks like it, and a dozen parties each owing
 * a few. The lists, the parties and the papers are invented.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHECKLIST_LIMITS,
  CHECKLIST_NO_PACKAGE,
  CHECKLIST_NO_STAGE,
  addChecklistItem,
  addChecklistItems,
  addEvidence,
  checklistFunction,
  checklistOwed,
  checklistSheet,
  createProject,
  createProjectGrant,
  dismissChecklistMatch,
  parseChecklist,
  parseChecklistRows,
  parseChecklistSheets,
  patchChecklistItem,
  projectView,
  raiseChecklistRequests,
  receiveChecklistItem,
  refreshProjectDerived,
  removeChecklistItem,
  reopenChecklistItem,
  requirementSheet,
  functionSections,
  type ChecklistLine,
  type ChecklistSheet,
  type DdProject,
} from '@realytica/shared';

function project(): DdProject {
  return createProject({ name: 'Checklist test', type: 'commercial', location: 'Lake Road', city: 'Kadamba', currentStage: 'design' }, 'RYT-C1');
}

/** A document on file, under the name it was filed as and the name its file came with. */
function file(p: DdProject, title: string, fileName = `${title}.pdf`) {
  const row = addEvidence(p, { title, kind: 'document', status: 'received' }, 'tester');
  row.attachments.push({ id: `att_${row.id}`, fileName, mimeType: 'application/pdf', sizeBytes: 10, storageKey: `${row.id}.pdf`, uploadedAt: '2026-10-01T00:00:00.000Z' });
  return row;
}

const linesOf = (sheet: ChecklistSheet): ChecklistLine[] => sheet.stages.flatMap((s) => s.packages.flatMap((p) => p.lines));
const lineOf = (sheet: ChecklistSheet, title: string): ChecklistLine => {
  const found = linesOf(sheet).find((l) => l.item.title === title);
  assert.ok(found, `no line "${title}"`);
  return found;
};

const LIST = ['Concept:', 'Civil and structural', '1. Soil investigation report', '2. Structural drawings', 'Architectural and interiors', '- Design brief report', '- Built-up area statement', '', 'Tender:', 'MEP', '• Basic prices', '• Final drawing list, with revision numbers'].join('\n');

describe('reading a checklist', () => {
  it('takes one paper to a line, without its bullet or its number, and skips blank lines', () => {
    const drafts = parseChecklist('1. Package strategy\n\n  - Design brief report\n\n(c) Schedule of finishes\n   \n[ ] Facade details\n');
    assert.deepEqual(
      drafts.map((d) => d.title),
      ['Package strategy', 'Design brief report', 'Schedule of finishes', 'Facade details'],
    );
    assert.ok(drafts.every((d) => !d.stage && !d.package && !d.owedBy));
    assert.deepEqual(parseChecklist('\n \n'), []);
  });

  it('keeps a comma in a paper’s own name when nothing says the text is a table', () => {
    assert.deepEqual(parseChecklist('Final drawing list, with revision numbers').map((d) => d.title), ['Final drawing list, with revision numbers']);
  });

  it('lets a heading set the stage or the package for the lines under it', () => {
    const drafts = parseChecklist(LIST);
    assert.deepEqual(
      drafts.map((d) => [d.stage, d.package, d.title]),
      [
        ['Concept', 'Civil and structural', 'Soil investigation report'],
        ['Concept', 'Civil and structural', 'Structural drawings'],
        ['Concept', 'Architectural and interiors', 'Design brief report'],
        ['Concept', 'Architectural and interiors', 'Built-up area statement'],
        // A new stage starts its packages afresh.
        ['Tender', 'MEP', 'Basic prices'],
        ['Tender', 'MEP', 'Final drawing list, with revision numbers'],
      ],
    );
  });

  it('knows a stage or a package by its name, a heading by its colon or its capitals, and a paper from both', () => {
    const drafts = parseChecklist(['Detailed design stage', 'External development', 'Design brief report', 'Structural drawings', 'SIGNAGE AND WAYFINDING', 'BOQ', 'Tender: Lifts', 'Lift shaft details', 'Handing over file:', 'Warranty register'].join('\n'));
    assert.deepEqual(
      drafts.map((d) => [d.stage, d.package, d.title]),
      [
        ['Detailed design stage', 'External development', 'Design brief report'],
        ['Detailed design stage', 'External development', 'Structural drawings'],
        ['Detailed design stage', 'SIGNAGE AND WAYFINDING', 'BOQ'],
        // One heading may name both.
        ['Tender', 'Lifts', 'Lift shaft details'],
        ['Tender', 'Handing over file', 'Warranty register'],
      ],
    );
  });

  it('uses the row that names the columns, wherever they sit', () => {
    const drafts = parseChecklist(
      ['Sl No,Owed by,Item,Stage,Package,Remarks', '1,Structural consultant,Structural drawings,Schematic,Civil and structural,"GFC set, signed"', '2,,Schedule of finishes,Schematic,Architectural and interiors,', '3,Cost consultant,Basic prices,,,'].join('\n'),
    );
    assert.deepEqual(drafts, [
      { title: 'Structural drawings', stage: 'Schematic', package: 'Civil and structural', owedBy: 'Structural consultant', note: 'GFC set, signed' },
      { title: 'Schedule of finishes', stage: 'Schematic', package: 'Architectural and interiors', owedBy: undefined, note: undefined },
      { title: 'Basic prices', stage: undefined, package: undefined, owedBy: 'Cost consultant', note: undefined },
    ]);
  });

  it('reads a paste from a spreadsheet: a heading is the row with nothing beside it', () => {
    const drafts = parseChecklist(
      ['Item\tFrom', 'Podium works', 'Waterproofing details\tArchitect', 'Landscape layout\tLandscape consultant', 'Paving pattern\tLandscape consultant', 'Closing papers', 'As-built set\tContractor', 'Warranty register\tContractor', 'Operation manuals'].join('\n'),
    );
    assert.deepEqual(
      drafts.map((d) => [d.package, d.title, d.owedBy]),
      [
        ['Podium works', 'Waterproofing details', 'Architect'],
        ['Podium works', 'Landscape layout', 'Landscape consultant'],
        ['Podium works', 'Paving pattern', 'Landscape consultant'],
        ['Closing papers', 'As-built set', 'Contractor'],
        ['Closing papers', 'Warranty register', 'Contractor'],
        // Nothing under it: it was a paper after all.
        ['Closing papers', 'Operation manuals', undefined],
      ],
    );
  });

  it('keeps a paper whose other columns were left blank: it is not taken for a heading', () => {
    // The sections are marked, so a row with nothing beside it is a paper nobody was named for.
    const marked = parseChecklist(['Item\tOwed by', 'Tender:', 'MEP', 'Basic prices\t', 'Final drawing list\tArchitect'].join('\n'));
    assert.deepEqual(marked.map((d) => [d.stage, d.package, d.title, d.owedBy]), [
      ['Tender', 'MEP', 'Basic prices', undefined],
      ['Tender', 'MEP', 'Final drawing list', 'Architect'],
    ]);
    // No sections at all: the table opens with a full row.
    const flat = parseChecklist(['Item\tOwed by', 'Soil investigation report\tGeotechnical consultant', 'Basic prices', 'Facade details\tFacade consultant'].join('\n'));
    assert.deepEqual(flat.map((d) => [d.package, d.title]), [[undefined, 'Soil investigation report'], [undefined, 'Basic prices'], [undefined, 'Facade details']]);
    // Numbered rows: the row without a number heads them, and a numbered row is a paper whatever is beside it.
    const numbered = parseChecklistRows([
      ['Sl No', 'Description', 'Remarks'],
      ['', 'Podium works', ''],
      ['1', 'Waterproofing details', 'Two sets'],
      ['2', 'Paving pattern', ''],
      ['', 'Closing papers', ''],
      ['3', 'As-built set', ''],
    ]);
    assert.deepEqual(numbered.map((d) => [d.package, d.title, d.note]), [
      ['Podium works', 'Waterproofing details', 'Two sets'],
      ['Podium works', 'Paving pattern', undefined],
      ['Closing papers', 'As-built set', undefined],
    ]);
  });

  it('reads a table with no names for its columns: the first cell written is the paper', () => {
    const drafts = parseChecklistRows([
      ['', 'Schematic'],
      ['1', 'Facade details', 'Elevations and sections'],
      ['2', 'Package strategy', ''],
    ]);
    assert.deepEqual(drafts.map((d) => [d.stage, d.title, d.note]), [
      ['Schematic', 'Facade details', 'Elevations and sections'],
      ['Schematic', 'Package strategy', undefined],
    ]);
    // A CSV file is a table whether or not its first row says so.
    assert.deepEqual(parseChecklist('Soil investigation report,Borehole logs attached', { csv: true }), [{ title: 'Soil investigation report', stage: undefined, package: undefined, owedBy: undefined, note: 'Borehole logs attached' }]);
  });

  it('reads a workbook kept a sheet to a stage: the sheet’s name heads its lines', () => {
    const drafts = parseChecklistSheets([
      { name: 'Concept', rows: [['Item', 'Package'], ['Design brief report', 'Architectural'], ['Soil investigation report', 'Civil']] },
      { name: 'Tender', rows: [['Basic prices'], ['Final drawing list']] },
      { name: 'Sheet3', rows: [] },
    ]);
    assert.deepEqual(
      drafts.map((d) => [d.stage, d.package, d.title]),
      [
        ['Concept', 'Architectural', 'Design brief report'],
        ['Concept', 'Civil', 'Soil investigation report'],
        ['Tender', undefined, 'Basic prices'],
        ['Tender', undefined, 'Final drawing list'],
      ],
    );
    // One sheet: its name is whatever the spreadsheet called it, and says nothing.
    assert.equal(parseChecklistSheets([{ name: 'Tender', rows: [['Basic prices']] }])[0]!.stage, undefined);
  });
});

describe('a checklist on a project', () => {
  it('does not take the same list twice', () => {
    const p = project();
    const first = addChecklistItems(p, 'finance', parseChecklist(LIST), 'tester');
    assert.equal(first.added.length, 6);
    assert.equal(first.skipped, 0);
    // The same list again, retyped: case, spacing and punctuation are not a difference.
    const again = addChecklistItems(p, 'finance', parseChecklist(LIST.replace('Soil investigation report', 'SOIL  investigation-report')), 'tester');
    assert.equal(again.added.length, 0);
    assert.equal(again.skipped, 6);
    assert.equal(p.checklist!.length, 6);
    // The same paper at another stage is another line, and so is the same list on another desk.
    assert.equal(addChecklistItems(p, 'finance', [{ title: 'Structural drawings', stage: 'Tender', package: 'Civil and structural' }], 'tester').added.length, 1);
    assert.equal(addChecklistItems(p, 'construction', parseChecklist(LIST), 'tester').added.length, 6);
    // Twice in one list is once.
    const twice = addChecklistItems(p, 'legal', [{ title: 'Basic prices' }, { title: 'basic prices' }, { title: '  ' }], 'tester');
    assert.equal(twice.added.length, 1);
    assert.equal(twice.skipped, 1);
  });

  it('takes none of a list that does not fit: a refused import leaves the project as it was', () => {
    const p = project();
    const papers = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ title: `Paper ${from + i}` }));
    addChecklistItems(p, 'finance', papers(0, 10), 'tester');
    const was = structuredClone({ checklist: p.checklist, audit: p.audit, updatedAt: p.updatedAt });
    // One line more than there is room for, the first of them already on the list.
    assert.throws(() => addChecklistItems(p, 'finance', papers(9, CHECKLIST_LIMITS.items - 8), 'tester'), /holds 1000 lines at most/);
    assert.deepEqual({ checklist: p.checklist, audit: p.audit, updatedAt: p.updatedAt }, was);
    // Exactly what there is room for is taken, and then not one line more.
    assert.equal(addChecklistItems(p, 'finance', papers(9, CHECKLIST_LIMITS.items - 9), 'tester').added.length, CHECKLIST_LIMITS.items - 10);
    assert.equal(p.checklist!.length, CHECKLIST_LIMITS.items);
    assert.throws(() => addChecklistItems(p, 'legal', [{ title: 'One more' }], 'tester'), /holds 1000 lines at most/);
    assert.equal(p.checklist!.length, CHECKLIST_LIMITS.items);
    // A list that is all on there already adds nothing and is not refused.
    assert.deepEqual([addChecklistItems(p, 'finance', papers(0, 5), 'tester').skipped, p.checklist!.length], [5, CHECKLIST_LIMITS.items]);
  });

  it('keeps apart papers whose names differ only after a dot', () => {
    const p = project();
    const list = [{ title: 'Annexure A.1' }, { title: 'Annexure A.2' }, { title: 'Schedule 1.1' }, { title: 'Schedule 1.2' }, { title: 'Drawing list Rev.A' }, { title: 'Drawing list Rev.B' }];
    const first = addChecklistItems(p, 'legal', list, 'tester');
    assert.deepEqual([first.added.length, first.skipped], [6, 0]);
    assert.deepEqual(p.checklist!.map((i) => i.title), list.map((l) => l.title));
    // The same again, retyped, is still the same list.
    assert.deepEqual(addChecklistItems(p, 'legal', [{ title: 'annexure  a.1' }, { title: 'SCHEDULE 1.2' }], 'tester').skipped, 2);
    // And one cannot be renamed into the other.
    assert.throws(() => patchChecklistItem(p, p.checklist![0]!.id, { title: 'Annexure A.2' }, 'tester'), /already on the list/);
  });

  it('is added to, renamed, moved and cut a line at a time', () => {
    const p = project();
    const item = addChecklistItem(p, 'construction', { title: ' Facade details ', stage: 'Schematic', owedBy: 'Facade consultant' }, 'tester');
    assert.equal(item.title, 'Facade details');
    assert.throws(() => addChecklistItem(p, 'construction', { title: 'facade details', stage: 'schematic' }, 'tester'), /already on the list/);
    assert.throws(() => addChecklistItem(p, 'construction', { title: ' ' }, 'tester'), /Name the paper/);

    patchChecklistItem(p, item.id, { title: 'Facade details and samples', stage: 'Detailed design', package: 'Facade', owedBy: null, note: 'Mock-up photographs too' }, 'tester');
    assert.deepEqual(
      { title: item.title, stage: item.stage, package: item.package, owedBy: item.owedBy, note: item.note },
      { title: 'Facade details and samples', stage: 'Detailed design', package: 'Facade', owedBy: undefined, note: 'Mock-up photographs too' },
    );
    assert.throws(() => patchChecklistItem(p, item.id, { title: '' }, 'tester'), /Name the paper/);

    // A rename may not make two lines one.
    const other = addChecklistItem(p, 'construction', { title: 'Lift shaft details', stage: 'Detailed design', package: 'Facade' }, 'tester');
    assert.throws(() => patchChecklistItem(p, other.id, { title: 'Facade details and samples' }, 'tester'), /already on the list/);
    assert.equal(other.title, 'Lift shaft details');

    removeChecklistItem(p, item.id, 'tester');
    assert.deepEqual(p.checklist!.map((i) => i.title), ['Lift shaft details']);
    assert.throws(() => removeChecklistItem(p, item.id, 'tester'), /not on the list/);
    assert.ok(p.audit.some((a) => a.entityType === 'checklist' && a.action === 'checklist_removed'));
  });

  it('is grouped by stage, then package, with what is in hand of each', () => {
    const p = project();
    addChecklistItems(p, 'finance', [...parseChecklist(LIST), { title: 'Package strategy' }], 'tester');
    file(p, 'Soil investigation report');
    file(p, 'Basic prices');
    const sheet = checklistSheet(p, { department: 'finance' });
    assert.deepEqual(
      sheet.stages.map((s) => [s.label, `${s.received}/${s.total}`, s.packages.map((g) => `${g.label} ${g.received}/${g.total}`)]),
      [
        ['Concept', '1/4', ['Civil and structural 1/2', 'Architectural and interiors 0/2']],
        ['Tender', '1/2', ['MEP 1/2']],
        [CHECKLIST_NO_STAGE, '0/1', [`${CHECKLIST_NO_PACKAGE} 0/1`]],
      ],
    );
    assert.deepEqual([sheet.total, sheet.received, sheet.requested, sheet.pending, sheet.percent], [7, 2, 0, 5, 29]);
    // One desk's list is that desk's, and the sheet the checks make is not touched by it.
    assert.equal(checklistSheet(p, { department: 'legal' }).total, 0);
    assert.equal(requirementSheet(p, { department: 'finance' }).total, 0);
  });
});

describe('a paper against the documents on file', () => {
  function loaded(): DdProject {
    const p = project();
    addChecklistItems(p, 'construction', [{ title: 'Soil investigation report', owedBy: 'Geotechnical consultant' }, { title: 'Design brief report' }, { title: 'Structural drawings' }], 'tester');
    return p;
  }

  it('is in hand when a filed document carries its name', () => {
    const p = loaded();
    const drawings = file(p, 'Tower A structure', 'structural_drawings.PDF');
    // Expected and not filed: a row with no file answers nothing.
    addEvidence(p, { title: 'Design brief report', kind: 'document', status: 'expected' }, 'tester');
    const sheet = checklistSheet(p);
    const line = lineOf(sheet, 'Structural drawings');
    assert.equal(line.status, 'received');
    assert.equal(line.evidenceId, drawings.id);
    assert.equal(line.fileName, 'structural_drawings.PDF');
    assert.equal(line.byHand, undefined);
    assert.equal(lineOf(sheet, 'Design brief report').status, 'pending');
  });

  it('is only offered a document that looks like it, until a person confirms', () => {
    const p = loaded();
    const logs = file(p, 'Borehole logs', 'soil-investigation-borehole-logs.pdf');
    const before = lineOf(checklistSheet(p), 'Soil investigation report');
    assert.equal(before.status, 'pending');
    assert.equal(before.suggestion?.evidenceId, logs.id);
    assert.equal(before.evidenceId, undefined);
    assert.equal(checklistSheet(p).received, 0);
    assert.equal(checklistSheet(p).toConfirm, 1);

    receiveChecklistItem(p, before.item.id, { evidenceId: logs.id }, 'tester');
    const after = lineOf(checklistSheet(p), 'Soil investigation report');
    assert.equal(after.status, 'received');
    assert.equal(after.byHand, true);
    assert.equal(after.evidenceId, logs.id);
    assert.equal(after.suggestion, undefined);
    assert.equal(checklistSheet(p).toConfirm, 0);
  });

  it('is not offered a document a person refused, by likeness or by name', () => {
    const p = loaded();
    const logs = file(p, 'Borehole logs', 'soil-investigation-borehole-logs.pdf');
    const soil = lineOf(checklistSheet(p), 'Soil investigation report').item;
    dismissChecklistMatch(p, soil.id, logs.id, 'tester');
    assert.equal(lineOf(checklistSheet(p), 'Soil investigation report').suggestion, undefined);

    const wrong = file(p, 'Structural drawings');
    const drawings = lineOf(checklistSheet(p), 'Structural drawings');
    assert.equal(drawings.status, 'received');
    dismissChecklistMatch(p, drawings.item.id, wrong.id, 'tester');
    assert.equal(lineOf(checklistSheet(p), 'Structural drawings').status, 'pending');
  });

  it('is answered by the document of its own name and not by its neighbour: "Annexure A.2" filed does not mark "Annexure A.1"', () => {
    const p = project();
    addChecklistItems(p, 'legal', [{ title: 'Annexure A.1' }, { title: 'Annexure A.2' }, { title: 'Schedule 1.1' }, { title: 'Rev.A' }], 'tester');
    const second = file(p, 'Annexure A.2');
    const sheet = checklistSheet(p);
    assert.deepEqual([lineOf(sheet, 'Annexure A.1').status, lineOf(sheet, 'Annexure A.2').status, lineOf(sheet, 'Annexure A.2').evidenceId], ['pending', 'received', second.id]);
    assert.equal(sheet.received, 1);
    // A file's own extension still says nothing, whatever the title it was filed under.
    file(p, 'Scan 0041', 'Annexure A.1.PDF');
    file(p, 'Scan 0042', 'schedule 1.1.xlsx');
    file(p, 'Scan 0043', 'Rev.B.pdf');
    const after = checklistSheet(p);
    assert.deepEqual(['Annexure A.1', 'Schedule 1.1', 'Rev.A'].map((title) => lineOf(after, title).status), ['received', 'received', 'pending']);
  });

  it('refuses to set aside a document the project does not hold', () => {
    const p = loaded();
    const soil = lineOf(checklistSheet(p), 'Soil investigation report').item;
    const was = structuredClone(soil);
    assert.throws(() => dismissChecklistMatch(p, soil.id, 'ev_nothing', 'tester'), /Evidence ev_nothing not found/);
    assert.throws(() => dismissChecklistMatch(p, soil.id, 'x'.repeat(5000), 'tester'), /not found/);
    assert.deepEqual(soil, was);
  });

  it('does not choose between two lines of one name: the same paper at two stages is offered, not marked', () => {
    const p = project();
    addChecklistItems(p, 'construction', [{ title: 'Structural drawings', stage: 'Schematic' }, { title: 'Structural drawings', stage: 'Tender' }], 'tester');
    const doc = file(p, 'Structural drawings');
    const sheet = checklistSheet(p);
    assert.equal(sheet.received, 0);
    assert.ok(linesOf(sheet).every((l) => l.status === 'pending' && l.suggestion?.evidenceId === doc.id));
    // Confirmed for one, it is that one's, and is not offered to the other.
    receiveChecklistItem(p, linesOf(sheet)[0]!.item.id, { evidenceId: doc.id }, 'tester');
    const after = linesOf(checklistSheet(p));
    assert.deepEqual(after.map((l) => [l.status, l.suggestion]), [['received', undefined], ['pending', undefined]]);
  });

  it('is marked in hand by a person, with a document or without, and reopened', () => {
    const p = loaded();
    const brief = lineOf(checklistSheet(p), 'Design brief report').item;
    receiveChecklistItem(p, brief.id, {}, 'the project manager');
    const marked = lineOf(checklistSheet(p), 'Design brief report');
    assert.deepEqual([marked.status, marked.byHand, marked.evidenceId], ['received', true, undefined]);
    assert.equal(brief.received?.by, 'the project manager');
    assert.throws(() => receiveChecklistItem(p, brief.id, { evidenceId: 'ev_nothing' }, 'tester'), /not found/);

    const minutes = file(p, 'Minutes of the briefing meeting');
    receiveChecklistItem(p, brief.id, { evidenceId: minutes.id }, 'tester');
    assert.equal(lineOf(checklistSheet(p), 'Design brief report').fileName, 'Minutes of the briefing meeting.pdf');
    reopenChecklistItem(p, brief.id, 'tester');
    assert.equal(lineOf(checklistSheet(p), 'Design brief report').status, 'pending');
  });
});

/** A finance desk's list of five papers: two parties named once, one named twice, one line with nobody named. */
function owing(): DdProject {
  const p = project();
  addChecklistItems(
    p,
    'finance',
    [
      { title: 'Soil investigation report', stage: 'Concept', package: 'Civil and structural', owedBy: 'Geotechnical consultant' },
      { title: 'Structural drawings', stage: 'Concept', package: 'Civil and structural', owedBy: 'Structural consultant' },
      { title: 'Column schedule', stage: 'Tender', owedBy: 'structural consultant' },
      { title: 'Schedule of finishes', stage: 'Concept', owedBy: 'Architect' },
      { title: 'Package strategy' },
    ],
    'tester',
  );
  return p;
}

describe('asking for what is missing', () => {
  it('says who owes each missing paper', () => {
    const p = owing();
    file(p, 'Schedule of finishes');
    const sheet = checklistSheet(p, { department: 'finance' });
    assert.deepEqual(
      sheet.owing.map((g) => [g.owedBy, g.lines.map((l) => l.item.title)]),
      [
        ['Structural consultant', ['Structural drawings', 'Column schedule']],
        ['Geotechnical consultant', ['Soil investigation report']],
        [undefined, ['Package strategy']],
      ],
    );
  });

  it('raises one request to each party, for everything it owes', () => {
    const p = owing();
    file(p, 'Schedule of finishes');
    const { requests, unassigned } = raiseChecklistRequests(p, { department: 'finance', dueAt: '2026-10-20' }, 'tester');
    assert.equal(unassigned, 1);
    assert.deepEqual(
      requests.map((r) => [r.recipient, r.title, r.status, r.dueAt, r.checklistItemIds?.length]),
      [
        ['Structural consultant', '2 documents', 'sent', '2026-10-20', 2],
        ['Geotechnical consultant', 'Soil investigation report', 'sent', '2026-10-20', 1],
      ],
    );
    assert.equal(requests[0]!.detail, 'Structural drawings (Concept · Civil and structural)\nColumn schedule (Tender)');
    // They are the project's own requests, and the lines say who was asked and by when.
    assert.equal((p.requests ?? []).length, 2);
    const sheet = checklistSheet(p, { department: 'finance', now: '2026-10-25T00:00:00Z' });
    const asked = lineOf(sheet, 'Column schedule');
    assert.deepEqual([asked.status, asked.askedOf, asked.dueAt, asked.overdue, asked.requestId], ['requested', 'Structural consultant', '2026-10-20', true, requests[0]!.id]);
    assert.deepEqual([sheet.requested, sheet.pending, sheet.overdue], [3, 1, 3]);

    // Asked once: a second press sends nothing more, and the unnamed line goes to whoever is named for it.
    assert.equal(raiseChecklistRequests(p, { department: 'finance' }, 'tester').requests.length, 0);
    const rest = raiseChecklistRequests(p, { department: 'finance', recipient: 'The developer' }, 'tester');
    assert.deepEqual(rest.requests.map((r) => [r.recipient, r.title]), [['The developer', 'Package strategy']]);
    assert.equal(rest.unassigned, 0);
  });

  it('closes a request when everything it asked for is in hand, and not before', () => {
    const p = owing();
    const { requests } = raiseChecklistRequests(p, { department: 'finance' }, 'tester');
    const structural = requests.find((r) => r.recipient === 'Structural consultant')!;
    file(p, 'Structural drawings');
    refreshProjectDerived(p);
    assert.equal(structural.status, 'sent');
    const schedule = file(p, 'Schedule of columns, tower A');
    receiveChecklistItem(p, p.checklist!.find((i) => i.title === 'Column schedule')!.id, { evidenceId: schedule.id }, 'tester');
    refreshProjectDerived(p);
    assert.equal(structural.status, 'answered');
    assert.ok(structural.answeredAt);
    assert.equal(requests.find((r) => r.recipient === 'Architect')!.status, 'sent');
  });
});

describe('the papers still owed, in a line', () => {
  it('counts what is not in hand, asked for or not, and names who owes the most first', () => {
    const p = owing();
    file(p, 'Schedule of finishes');
    // Asking for a paper does not make it any less owed.
    raiseChecklistRequests(p, { department: 'finance', itemIds: [p.checklist!.find((i) => i.title === 'Structural drawings')!.id] }, 'tester');
    const owed = checklistOwed(p);
    assert.deepEqual([owed.owed, owed.total, owed.department], [4, 5, 'finance']);
    assert.deepEqual(
      owed.parties.map((party) => [party.owedBy, party.lines.map((l) => l.item.title)]),
      [
        ['Structural consultant', ['Structural drawings', 'Column schedule']],
        ['Geotechnical consultant', ['Soil investigation report']],
        [undefined, ['Package strategy']],
      ],
    );
  });

  it('reads every desk’s list together, or one desk’s, and opens the desk that holds the most', () => {
    const p = owing();
    addChecklistItems(p, 'construction', [{ title: 'Pour cards', owedBy: 'Contractor' }, { title: 'Cube test results', owedBy: 'Contractor' }], 'tester');
    for (const title of ['Soil investigation report', 'Structural drawings', 'Column schedule', 'Schedule of finishes']) file(p, title);
    const all = checklistOwed(p);
    assert.deepEqual([all.owed, all.total, all.department], [3, 7, 'construction']);
    assert.deepEqual(all.parties.map((party) => [party.owedBy, party.lines.length]), [['Contractor', 2], [undefined, 1]]);
    assert.deepEqual([checklistOwed(p, { department: 'finance' }).owed, checklistOwed(p, { department: 'legal' }).total], [1, 0]);
    // A line the list names nobody for is owed by whoever it was asked of.
    raiseChecklistRequests(p, { department: 'finance', recipient: 'The developer' }, 'tester');
    assert.deepEqual(checklistOwed(p).parties.map((party) => [party.owedBy, party.lines.length]), [['Contractor', 2], ['The developer', 1]]);
  });

  it('says so when nothing is owed, and when there is no list', () => {
    const p = project();
    assert.deepEqual(checklistOwed(p), { total: 0, owed: 0, parties: [] });
    addChecklistItems(p, 'legal', [{ title: 'Sale deed', owedBy: 'The owner' }], 'tester');
    file(p, 'Sale deed');
    assert.deepEqual(checklistOwed(p), { total: 1, owed: 0, parties: [] });
  });

  it('opens on the Documents part of a function of the desk, for each department that is live', () => {
    assert.deepEqual(
      (['legal', 'construction', 'finance', 'procurement'] as const).map((department) => checklistFunction(department)),
      ['legal.title', 'construction.progress', 'finance.feasibility', 'procurement.boq'],
    );
    for (const department of ['legal', 'construction', 'finance', 'procurement'] as const) assert.ok(functionSections(checklistFunction(department)!).includes('documents'));
    // A department with no built function laid out in parts has nowhere to open it.
    assert.equal(checklistFunction('commercial'), undefined);
  });

  it('is nothing to a collaborator: the list is not in what they are handed', () => {
    const p = owing();
    const grant = createProjectGrant({ email: 'sam@site.in' }, { id: 'grt_1', tenantId: 'ten_1', projectId: p.id, createdBy: 'tester' });
    const seen = projectView(p, { kind: 'granted', grant, email: 'sam@site.in' }).project;
    assert.ok(p.checklist!.length > 0 && checklistOwed(p).owed > 0, 'there is a list, with papers owed, to be withheld');
    assert.deepEqual(seen.checklist, [], 'the copy they are handed carries no line of it');
    assert.deepEqual(checklistOwed(seen), { total: 0, owed: 0, parties: [] });
    assert.equal(checklistSheet(seen).total, 0);
  });
});

describe('a project saved before there were checklists', () => {
  it('loads as it was, with an empty sheet and nothing added to it', () => {
    const p = project();
    file(p, 'Soil investigation report');
    p.requests = [{ id: 'req_old', title: 'Sale deed', recipient: 'The owner', status: 'sent', sentAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z', createdBy: 'tester', updatedAt: '2026-09-01T00:00:00.000Z' }];
    const stored = JSON.parse(JSON.stringify(p)) as DdProject;
    assert.equal('checklist' in stored, false);

    refreshProjectDerived(stored);
    const sheet = checklistSheet(stored, { department: 'construction' });
    assert.deepEqual([sheet.total, sheet.received, sheet.percent, sheet.stages.length, sheet.owing.length], [0, 0, 0, 0, 0]);
    assert.deepEqual(raiseChecklistRequests(stored, {}, 'tester'), { requests: [], unassigned: 0 });
    // Reading it wrote nothing: the field is there only once a list is loaded.
    assert.equal('checklist' in stored, false);
    assert.equal(stored.requests![0]!.status, 'sent');

    addChecklistItem(stored, 'construction', { title: 'Soil investigation report' }, 'tester');
    assert.equal(checklistSheet(stored).received, 1);
  });
});
