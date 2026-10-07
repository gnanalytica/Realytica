/**
 * A document dropped into the chat says where it went.
 *
 * It was filed, read, and its values left waiting, and the reply said only
 * that. Now the reply says the rest of what a person wants to know the moment
 * a paper lands: the function it was filed under and the stage, how many of
 * its values go to which function's checks, what it states that differs from
 * what the file already holds, and what else that reaches. The canvas opens
 * on the function's documents with the new row lit, and one chip under the
 * reply opens the paper in the graph. What a drop took in that is no paper
 * read (a questionnaire, a photograph of the site, a voice note kept as it
 * is) has a chip of its own, which opens it. What a chip counts as waiting is
 * what "approve all" under the reply would take, and it says the page it
 * waits on.
 *
 * Each of those is asked here of the seeded projects. A paper is given as the
 * reader hands it on: what it is comes from the reader's own profile of that
 * kind, so a label the register does not know cannot pass by being typed
 * here, and the last block reads the invented sample PDFs off the page.
 * Nothing in this file may reach the network. A call would fail the test
 * that made it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  acceptedFacts,
  addEvidence,
  addQuestionnaire,
  applyProjectChat,
  asksToFileUnder,
  attachEvidenceFile,
  buildProjectGraph,
  checkSchema,
  classifyIngestFile,
  cockpitPath,
  contestedKeys,
  createChatProposal,
  disagreementSentence,
  documentDisagreements,
  fileCertifiedReport,
  filedGroups,
  functionOfDocument,
  isMeasure,
  offeredByFunction,
  parseDocumentText,
  pickCheckValue,
  proposedFacts,
  reachSentence,
  recordCheckFields,
  reviewFacts,
  seedBdaReferenceProject,
  seedDemoProject,
  setProjectDepartments,
  stageInView,
  stageOf,
  statesTheSame,
  surveyNumbersIn,
  turnChips,
  waitingOnCanvas,
  waitingOnCheck,
  waitingSentence,
  wantsDeterministicProjectChat,
  type ChatIngestFile,
  type CheckInstance,
  type DdProject,
  type DocumentFact,
  type EvidenceRecord,
  type ProjectChatResult,
  type ProjectChatTurn,
  type ProjectCockpitPane,
} from '@realytica/shared';
import { notReadYetCard } from '../apps/api/src/documents/dropped';
import { readIngestLocally } from '../apps/api/src/documents/intake';
import { releaseOcr } from '../apps/api/src/documents/read-text';

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (() => {
    throw new Error('A document drop reached for the network.');
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await releaseOcr();
});

/** The first lines of a paper of each kind, enough for the reader to know what it is. */
const HEADING = {
  khata: 'KHATA CERTIFICATE\nKhata No. 112/4',
  conversion: 'OFFICIAL MEMORANDUM\nConversion of agricultural land for non-agricultural purposes under Section 95 of the Karnataka Land Revenue Act',
  deed: 'SALE DEED\nThis deed of absolute sale is made and executed',
  sanction: 'BUILDING PLAN SANCTION\nLP No. 0219/2022-23, date of sanction as below',
  receipt: 'PROPERTY TAX RECEIPT\nSAS Application No. 2024-25-0047 for the assessment year',
  notes: 'Minutes of the meeting held on site',
} as const;

const fact = (key: string, label: string, value: string | number, display = String(value), page = 1): DocumentFact => ({
  key,
  label,
  value,
  display,
  page,
  quote: `${label}: ${display}`,
  ...(typeof value === 'number' ? { unit: 'sqm' } : {}),
});

/** A paper as the reader hands it on: what it is, read from its heading, and what it states. */
function paper(fileName: string, kind: keyof typeof HEADING, ...facts: DocumentFact[]): ChatIngestFile {
  const read = parseDocumentText([HEADING[kind]], fileName);
  return {
    fileName,
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    storageKey: `s3://${fileName}`,
    read: { type: read.type, label: read.label, confidence: 0.9, method: 'text', summary: read.summary, facts, flags: [], rowHints: read.rowHints, scopes: read.scopes, evidenceKind: read.evidenceKind },
  };
}

const drop = (p: DdProject, ...files: ChatIngestFile[]): ProjectChatResult => applyProjectChat(p, '', { ingest: files });

/** The row a dropped file was filed on. */
const rowOf = (p: DdProject, fileName: string): EvidenceRecord => p.evidence.find((e) => e.attachments.some((a) => a.storageKey === `s3://${fileName}`))!;

const checkOf = (p: DdProject, definitionId: string): CheckInstance =>
  p.assessments.filter((a) => a.status !== 'archived').flatMap((a) => a.scopes.flatMap((s) => s.checks)).find((c) => c.definitionId === definitionId)!;

const chipsOf = (p: DdProject, out: ProjectChatResult) => turnChips(p, out.assistantTurn, waitingOnCanvas(p), {});

/** The address the canvas opens after a reply. */
function landing(p: DdProject, out: ProjectChatResult): string {
  const nav = out.navigations.at(-1)!;
  return cockpitPath(p.id, nav.target as ProjectCockpitPane, nav);
}

describe('where a dropped paper goes', () => {
  it('reads each kind as the reader does', () => {
    assert.equal(paper('a.pdf', 'khata').read!.label, 'Khata certificate and extract');
    assert.equal(paper('b.pdf', 'conversion').read!.label, 'DC conversion order');
    assert.equal(paper('c.pdf', 'deed').read!.label, 'Sale deed');
    assert.equal(paper('d.pdf', 'notes').read!.type, 'other', 'minutes are no kind the reader knows');
  });

  it('is filed under the function that holds its kind, and the reply says so in the menu’s words', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')));
    const row = rowOf(p, 'Khata.pdf');
    const text = out.assistantTurn.text;

    assert.equal(functionOfDocument(p, row), 'legal.title');
    assert.match(text, /^Read the khata certificate and extract\.\nFiled under Legal › Title, at the Land stage\.$/m);
    assert.ok(!text.includes('Khata.pdf') && !/\bev_/.test(text), `no file name and no record id in the words: ${text}`);
    assert.equal(out.assistantTurn.choices, undefined, 'a paper a function holds asks nothing');
  });

  it('opens that function at its documents, with the new row lit', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')));
    const row = rowOf(p, 'Khata.pdf');

    assert.equal(landing(p, out), `/projects/${p.id}/w/legal.title?stage=land&part=documents`, 'the page, at its documents, in the stage the project is at');
    assert.ok(out.highlightIds?.includes(row.id), 'the row is the one lit');
    assert.ok(out.commands.includes('Opened Title documents'));
    assert.ok(!out.navigations.some((n) => n.evidenceId), 'the paper is not opened over the page: its values are reviewed on the desk');
  });

  it('says the stage the project is at, and opens the page at a stage the function shows at', () => {
    const built = seedDemoProject();
    const out = drop(built, paper('Khata.pdf', 'khata'));
    assert.match(out.assistantTurn.text, /Filed under Legal › Title, at the Under construction stage\./);
    assert.equal(out.navigations.at(-1)!.stage, stageOf(built.currentStage));

    // Dropped while an earlier stage is looked at, it is still filed at the project's own, and the page opens in the stage in view.
    const earlier = seedDemoProject();
    const looked = applyProjectChat(earlier, '', { ingest: [paper('Khata.pdf', 'khata')], place: { pane: 'overview', stage: 'pre_development' } });
    assert.match(looked.assistantTurn.text, /at the Under construction stage\./);
    assert.equal(looked.navigations.at(-1)!.stage, 'pre_development');

    // Progress has no page at Completed on a project still at Land. A paper given to it from there opens where Progress shows.
    const p = seedBdaReferenceProject();
    drop(p, paper('Site minutes.pdf', 'notes'));
    const given = applyProjectChat(p, 'File “Site minutes” under Engineering › Progress', { place: { pane: 'overview', stage: 'operations' } });
    const nav = given.navigations.at(-1)!;
    assert.equal(nav.workstream, 'construction.progress');
    assert.equal(nav.section, 'documents');
    assert.equal(nav.stage, stageInView(p, { carried: 'operations', fn: 'construction.progress' }));
    assert.notEqual(nav.stage, 'operations');
  });

  it('opens the first function of several, and leaves a chip for each other one', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')), paper('Conversion order.pdf', 'conversion'));
    const order = rowOf(p, 'Conversion order.pdf');

    assert.match(out.assistantTurn.text, /Filed at the Land stage: 1 under Legal › Title and 1 under Legal › Approvals\./);
    assert.equal(out.navigations.at(-1)!.workstream, 'legal.title', 'Title comes first in the menu');
    assert.deepEqual(filedGroups(p, [order.id, rowOf(p, 'Khata.pdf').id]).map((g) => g.label), ['Legal › Title', 'Legal › Approvals'], 'in the menu’s order, whatever order they were dropped in');

    const chip = chipsOf(p, out).find((c) => c.kind === 'filed');
    assert.ok(chip, 'the other function has a chip');
    assert.equal(chip.words, 'Approvals documents');
    assert.deepEqual(chip.ids, [order.id], 'and the chip lights its row');
    assert.equal(cockpitPath(p.id, chip.open!.pane, chip.open!.extra), `/projects/${p.id}/w/legal.approvals?stage=land&part=documents`);
  });

  it('leaves no second chip for a function whose documents already wait', () => {
    const p = seedBdaReferenceProject();
    const out = drop(
      p,
      paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')),
      paper('Conversion order.pdf', 'conversion', fact('conversion_date', 'Date of the conversion order', '2019-04-02', '2 Apr 2019')),
    );
    const chips = chipsOf(p, out);
    assert.ok(chips.some((c) => c.kind === 'waiting' && c.words === 'waiting on the Approvals documents'));
    assert.ok(!chips.some((c) => c.kind === 'filed'), 'one way to the Approvals documents, not two');
  });
});

describe('a paper no function holds', () => {
  it('is kept in Documents, and the reply says no function has it', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, paper('Meeting notes.pdf', 'notes'));
    const row = rowOf(p, 'Meeting notes.pdf');

    assert.equal(functionOfDocument(p, row), undefined);
    assert.match(out.assistantTurn.text, /^Read 1 file\.\nKept in Documents, not yet given to a function\.$/);
    assert.equal(landing(p, out), `/projects/${p.id}/evidence`, 'the register of every document, where it has a row');
    assert.ok(out.highlightIds?.includes(row.id));
  });

  it('offers the functions it might belong to, and picks none', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, paper('Meeting notes.pdf', 'notes'));
    const choices = out.assistantTurn.choices ?? [];

    assert.deepEqual(choices.map((c) => c.label), ['Legal › Title', 'Legal › Approvals', 'Finance › Valuation']);
    for (const choice of choices) {
      assert.ok(asksToFileUnder(p, choice.send), `“${choice.send}” is a sentence the chat reads`);
      assert.equal(wantsDeterministicProjectChat(p, choice.send), true, 'and reads with no model');
      assert.deepEqual(choice.sitting, { evidenceId: rowOf(p, 'Meeting notes.pdf').id }, 'the paper travels with the pick');
    }
    assert.equal(rowOf(p, 'Meeting notes.pdf').workstream, undefined, 'nothing was chosen for it');
  });

  it('is not filed against a row it only shares letters with', () => {
    const p = seedBdaReferenceProject();
    const occupancy = p.evidence.find((e) => e.title === 'OC')!;
    assert.equal(occupancy.status, 'expected', 'the seeded acquisition is waiting for an occupancy certificate');

    // "document" and "record" spell OC and EC. Neither names the certificate.
    const unread: ChatIngestFile = { fileName: 'Scan 0042.pdf', mimeType: 'application/pdf', sizeBytes: 2048, storageKey: 's3://scan', excerpt: 'A document for the record of the meeting.' };
    assert.equal(classifyIngestFile(p, unread).evidence, undefined);
    assert.equal(classifyIngestFile(p, paper('Meeting notes.pdf', 'notes')).evidence, undefined);
    drop(p, paper('Meeting notes.pdf', 'notes'));
    assert.equal(occupancy.status, 'expected', 'and the row still waits for its certificate');

    // A file that names the row in words of its own still answers it.
    assert.equal(classifyIngestFile(p, { ...unread, fileName: 'OC_2024.pdf', excerpt: undefined }).evidence?.id, occupancy.id);
  });

  it('is filed where a person says, at once, and the canvas goes there', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, paper('Meeting notes.pdf', 'notes'));
    const row = rowOf(p, 'Meeting notes.pdf');
    const said = applyProjectChat(p, out.assistantTurn.choices![0]!.send, { actor: 'tester' });

    assert.equal(row.workstream, 'legal.title');
    assert.equal(functionOfDocument(p, row), 'legal.title');
    assert.equal(said.assistantTurn.text, '“Meeting notes” is filed under Legal › Title.');
    assert.equal(landing(p, said), `/projects/${p.id}/w/legal.title?stage=land&part=documents`);
    assert.ok(said.highlightIds?.includes(row.id));
    assert.deepEqual(said.commands, ['Filed “Meeting notes” under Legal › Title'], 'said as the instruction it was, so it can be undone');
    const logged = p.audit.at(-1)!;
    assert.deepEqual([logged.action, logged.actor, logged.entityId, logged.newValue], ['assign_document', 'tester', row.id, 'Legal › Title']);
  });

  it('is the firm’s own people’s to give to a function', () => {
    const p = seedBdaReferenceProject();
    const out = applyProjectChat(p, '', { ingest: [paper('Meeting notes.pdf', 'notes')], outside: true });
    assert.match(out.assistantTurn.text, /Kept in Documents, not yet given to a function\./);
    assert.equal(out.assistantTurn.choices, undefined, 'an outside collaborator is offered nothing they may not do');

    const said = applyProjectChat(p, 'File “Meeting notes” under Legal › Title', { outside: true });
    assert.equal(said.assistantTurn.text, 'Only the firm’s own people can file a document under a function. Nothing moved.');
    assert.equal(rowOf(p, 'Meeting notes.pdf').workstream, undefined);
    assert.deepEqual(said.navigations, []);
  });

  it('moves nothing for a paper or a function it cannot find', () => {
    const p = seedBdaReferenceProject();
    drop(p, paper('Meeting notes.pdf', 'notes'));
    const row = rowOf(p, 'Meeting notes.pdf');

    for (const [sentence, reply] of [
      ['File “Board pack” under Legal › Title', 'No document is called “Board pack”. Nothing moved.'],
      ['File “Meeting notes” under Plumbing', 'No function is called “Plumbing”. Nothing moved.'],
      ['File “Meeting notes” under Legal', 'No function is called “Legal”. Nothing moved.'],
    ] as const) {
      const out = applyProjectChat(p, sentence);
      assert.equal(out.assistantTurn.text, reply);
      assert.deepEqual(out.navigations, [], `“${sentence}” goes nowhere`);
      assert.equal(row.workstream, undefined);
    }
  });

  it('is filed by the function’s name in full, and with no quotes round the title', () => {
    for (const sentence of [
      'File “Meeting notes” under Title and land records',
      'File “Meeting notes” under Legal › Title & land records',
      'File Meeting notes under Legal › Title',
      'file the meeting notes under title',
      'Move “Meeting notes” to Legal › Title',
    ]) {
      const p = seedBdaReferenceProject();
      drop(p, paper('Meeting notes.pdf', 'notes'));
      assert.equal(asksToFileUnder(p, sentence), true, sentence);
      assert.equal(applyProjectChat(p, sentence).assistantTurn.text, '“Meeting notes” is filed under Legal › Title.', sentence);
      assert.equal(rowOf(p, 'Meeting notes.pdf').workstream, 'legal.title');
    }
  });

  it('leaves a quoted instruction about something else to the reader of that', () => {
    const p = seedDemoProject();
    const tower = p.assets.find((a) => a.name === 'Tower A')!;
    const risk = p.risks[0]!;
    // "Move" and "give" are said of an asset and a risk as well. Neither name is a document.
    for (const sentence of ['Move "Tower A" to Completed', `Give "${risk.title}" to the site lead`, 'Put "Tower A" under construction', 'File the minutes under review']) {
      assert.equal(asksToFileUnder(p, sentence), false, sentence);
      assert.ok(!/No document is called/.test(applyProjectChat(seedDemoProject(), sentence).assistantTurn.text), sentence);
    }
    applyProjectChat(p, 'Move "Tower A" to Completed');
    assert.equal(tower.currentStage, 'handover', 'the tower moved, as it always has');
  });

  it('does not file under a function that is switched off', () => {
    const p = seedBdaReferenceProject();
    setProjectDepartments(p, ['legal', 'finance'], 'tester');
    drop(p, paper('Meeting notes.pdf', 'notes'));
    const out = applyProjectChat(p, 'File “Meeting notes” under Commercial › Sales');
    assert.equal(out.assistantTurn.text, 'Sales is switched off on this project. Departments are set on Overview. Nothing moved.');
    assert.equal(rowOf(p, 'Meeting notes.pdf').workstream, undefined);
    // A name two functions share is the one that is switched on.
    assert.equal(applyProjectChat(p, 'File “Meeting notes” under Handover').assistantTurn.text, '“Meeting notes” is filed under Legal › Handover.');
  });

  it('asks which function when two share the name, and files under the one picked', () => {
    const p = seedBdaReferenceProject();
    drop(p, paper('Meeting notes.pdf', 'notes'));
    const row = rowOf(p, 'Meeting notes.pdf');
    const asked = applyProjectChat(p, 'File “Meeting notes” under Handover');

    assert.equal(asked.assistantTurn.text, 'Two functions are called Handover. Which one?');
    assert.deepEqual(asked.assistantTurn.choices?.map((c) => c.label), ['Legal › Handover', 'Commercial › Handover']);
    assert.equal(row.workstream, undefined, 'nothing moved on the question');
    const pick = asked.assistantTurn.choices![1]!;
    applyProjectChat(p, pick.send, { sitting: pick.sitting });
    assert.equal(row.workstream, 'commercial.handover');
  });

  it('asks which paper when two share a title, and files the one picked', () => {
    const p = seedBdaReferenceProject();
    drop(p, paper('Meeting notes.pdf', 'notes'));
    const first = rowOf(p, 'Meeting notes.pdf');
    const second = addEvidence(p, { title: 'Meeting notes', kind: 'document', status: 'received' });
    attachEvidenceFile(p, second.id, { fileName: 'Meeting notes (2).pdf', mimeType: 'application/pdf', sizeBytes: 1024, storageKey: 's3://second' });

    const asked = applyProjectChat(p, 'File “Meeting notes” under Legal › Title');
    assert.equal(asked.assistantTurn.text, 'Two documents are called “Meeting notes”. Which one?');
    assert.deepEqual(asked.assistantTurn.choices?.map((c) => [c.label, c.sitting?.evidenceId]), [['Meeting notes.pdf', first.id], ['Meeting notes (2).pdf', second.id]]);
    assert.deepEqual([first.workstream, second.workstream], [undefined, undefined], 'neither was picked for the person');

    const pick = asked.assistantTurn.choices![1]!;
    applyProjectChat(p, pick.send, { sitting: pick.sitting });
    assert.deepEqual([first.workstream, second.workstream], [undefined, 'legal.title']);

    // A paper pinned beside a sentence that does not name it is not taken: the sentence is asked about again.
    const stale = applyProjectChat(p, 'File “Meeting notes” under Legal › Approvals', { sitting: { evidenceId: p.evidence.find((e) => e.title === 'OC')!.id } });
    assert.equal(stale.assistantTurn.text, 'Two documents are called “Meeting notes”. Which one?');
  });

  it('finds a paper by its title in whatever script the title is written', () => {
    const p = seedBdaReferenceProject();
    // Invented titles: meeting notes, in Kannada, Telugu and Hindi.
    const [kannada, telugu, hindi] = ['ಸಭೆಯ ಟಿಪ್ಪಣಿ', 'సమావేశ గమనికలు', 'बैठक के नोट'];
    const named = (title: string) => ({ ...paper('Scan.pdf', 'notes'), fileName: `${title}.pdf`, storageKey: `s3://${title}` });
    const rowOfTitle = (title: string) => p.evidence.find((e) => e.attachments.some((a) => a.storageKey === `s3://${title}`))!;
    const first = drop(p, named(kannada!));
    drop(p, named(telugu!));
    drop(p, named(hindi!));
    assert.deepEqual([kannada, telugu, hindi].map((title) => rowOfTitle(title!).title), [kannada, telugu, hindi], 'the register keeps each title as its file had it');

    // Its own choice files it.
    const pick = first.assistantTurn.choices![0]!;
    assert.equal(pick.send, `File “${kannada}” under Legal › Title`);
    assert.equal(applyProjectChat(p, pick.send, { sitting: pick.sitting }).assistantTurn.text, `“${kannada}” is filed under Legal › Title.`);
    assert.equal(rowOfTitle(kannada!).workstream, 'legal.title');

    // Typed, a title names the paper that has it and no other.
    applyProjectChat(p, `File “${telugu}” under Legal › Approvals`);
    assert.deepEqual([telugu, hindi].map((title) => rowOfTitle(title!).workstream), ['legal.approvals', undefined]);
    assert.equal(asksToFileUnder(p, `Move “${hindi}” to Legal › Title`), true, 'a title in Hindi is a document’s name like any other');

    // A title no paper has files none, however few papers are on file.
    const other = 'ಮನೆಯ ನಕ್ಷೆ';
    const none = applyProjectChat(p, `File “${other}” under Legal › Approvals`);
    assert.equal(none.assistantTurn.text, `No document is called “${other}”. Nothing moved.`);
    assert.deepEqual([kannada, telugu, hindi].map((title) => rowOfTitle(title!).workstream), ['legal.title', 'legal.approvals', undefined]);
  });

  it('leaves “move” to the asset when a document shares its name and a stage follows', () => {
    const p = seedDemoProject();
    const tower = p.assets.find((a) => a.name === 'Tower A')!;
    const sheet = addEvidence(p, { title: 'Tower A', kind: 'document', status: 'received' });
    attachEvidenceFile(p, sheet.id, { fileName: 'Tower A.pdf', mimeType: 'application/pdf', sizeBytes: 1024, storageKey: 's3://tower-a' });

    // A stage and no function follows: it is the tower that moves.
    assert.equal(asksToFileUnder(p, 'Move "Tower A" to Completed'), false);
    applyProjectChat(p, 'Move "Tower A" to Completed');
    assert.equal(tower.currentStage, 'handover');
    assert.equal(sheet.workstream, undefined);

    // A function follows: it is the paper that is filed.
    assert.equal(asksToFileUnder(p, 'Move "Tower A" to Legal › Title'), true);
    applyProjectChat(p, 'Move "Tower A" to Legal › Title');
    assert.equal(sheet.workstream, 'legal.title');
    // "File" is only ever said of a paper.
    assert.equal(asksToFileUnder(p, 'File "Tower A" under Completed'), true);
    assert.equal(applyProjectChat(p, 'File "Tower A" under Completed').assistantTurn.text, 'No function is called “Completed”. Nothing moved.');
  });

  it('files a paper whose title holds a quote mark, from its own chip', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, { ...paper('Scan.pdf', 'notes'), fileName: 'Minutes "A" copy.pdf', storageKey: 's3://quoted' });
    const row = p.evidence.find((e) => e.attachments.some((a) => a.storageKey === 's3://quoted'))!;
    assert.match(row.title, /"/, 'the register keeps the title as the file had it');

    const pick = out.assistantTurn.choices![0]!;
    assert.equal(pick.send, 'File “Minutes A copy” under Legal › Title');
    const said = applyProjectChat(p, pick.send, { sitting: pick.sitting });
    assert.equal(row.workstream, 'legal.title');
    assert.equal(said.assistantTurn.text, `“${row.title}” is filed under Legal › Title.`);
  });
});

describe('where a dropped paper’s values go', () => {
  const both = () => {
    const p = seedBdaReferenceProject();
    const out = drop(
      p,
      paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm'), fact('survey_numbers', 'Survey number', '12/2', 'Sy. No. 12/2')),
      paper('Conversion order.pdf', 'conversion', fact('conversion_date', 'Date of the conversion order', '2019-04-02', '2 Apr 2019'), fact('conversion_status', 'DC conversion', 'converted', 'Converted')),
    );
    return { p, out };
  };

  it('are counted by the function whose checks they fill', () => {
    const { p, out } = both();
    assert.match(out.assistantTurn.text, /4 values fill checks: 2 on Title, 2 on Approvals\./);
    assert.deepEqual(
      offeredByFunction(p, out.proposals ?? []).map((row) => [row.fn, row.count]),
      [['legal.title', 2], ['legal.approvals', 2]],
    );
  });

  it('have a chip for each function, opening its page at the checks that wait', () => {
    const { p, out } = both();
    const chips = chipsOf(p, out).filter((c) => c.kind === 'waiting' && c.words.endsWith('checks'));
    assert.deepEqual(chips.map((c) => [c.words, c.count]), [['waiting on the Title checks', 2], ['waiting on the Approvals checks', 2]]);
    assert.deepEqual(
      chips.map((c) => cockpitPath(p.id, c.open!.pane, c.open!.extra)),
      [`/projects/${p.id}/w/legal.title?stage=land&part=checks`, `/projects/${p.id}/w/legal.approvals?stage=land&part=checks`],
    );
  });

  it('are on nothing until a person accepts them', () => {
    const { p, out } = both();
    assert.match(out.assistantTurn.text, /Nothing is on the file until you accept it there\./);
    assert.deepEqual(checkOf(p, 'land_site.parcel_identification').fields ?? {}, {});
    assert.deepEqual(checkOf(p, 'regulatory.land_use').fields ?? {}, {});
    assert.equal(acceptedFacts(rowOf(p, 'Khata.pdf')).length, 0);
  });

  it('are said once when one function takes them all', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')));
    assert.match(out.assistantTurn.text, /1 value fills a check on Title\./);
  });
});

describe('what a dropped paper disagrees with', () => {
  it('says a value that differs from one recorded on a check, with both and who recorded it', () => {
    const p = seedBdaReferenceProject();
    const parcel = checkOf(p, 'land_site.parcel_identification');
    recordCheckFields(p, parcel.id, { extent_khata: 1850 }, 'tester');
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1790, '1,790 sqm', 2)));

    assert.match(out.assistantTurn.text, new RegExp(`⚑ Differs from what is on file: Extent per khata 1,790 sqm \\(p\\.2\\) against 1,850 sqm on \\[${parcel.id}\\], recorded by tester\\. Nothing is overwritten\\.`));
    assert.ok(out.assistantTurn.citedNodeIds?.includes(parcel.id), 'the card that waits on that check is this reply’s');
  });

  it('says it on the card, and overwrites nothing', () => {
    const p = seedBdaReferenceProject();
    const parcel = checkOf(p, 'land_site.parcel_identification');
    recordCheckFields(p, parcel.id, { extent_khata: 1850 }, 'tester');
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1790, '1,790 sqm', 2)));
    const card = (out.proposals ?? []).find((c) => c.kind === 'record_check_fields')!;

    assert.match(card.rationale, /Differs from what is recorded: Extent per khata is 1,850 sqm on the check, recorded by tester\./);
    assert.match(card.impact, /waits beside it on the check until a person keeps one/);
    assert.equal(parcel.fields?.extent_khata?.value, 1850);
    assert.deepEqual(contestedKeys(p, card), ['extent_khata'], 'the two wait side by side on the check');

    // Accepting everything is not choosing between them.
    applyProjectChat(p, 'approve all');
    assert.equal(parcel.fields?.extent_khata?.value, 1850);
    assert.equal(card.status, 'proposed');
  });

  it('names the paper a recorded value came from', () => {
    const p = seedBdaReferenceProject();
    const parcel = checkOf(p, 'land_site.parcel_identification');
    drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')));
    reviewFacts(p, rowOf(p, 'Khata.pdf').id, 'all', 'accept', 'tester');
    assert.equal(parcel.fields?.extent_khata?.value, 1850);

    const out = drop(p, paper('Khata revised.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1790, '1,790 sqm', 2)));
    assert.match(out.assistantTurn.text, /against 1,850 sqm on \[chk_[^\]]+\], from Khata certificate and extract p\.1\./);
    // The check, the paper it was read from and the project record all hold 1,850 sqm. That is one disagreement.
    assert.equal(documentDisagreements(p, rowOf(p, 'Khata revised.pdf')).length, 1);
    assert.ok(!/and \d+ more/.test(out.assistantTurn.text), out.assistantTurn.text);
  });

  it('does not call the same value written another way a difference', () => {
    const p = seedBdaReferenceProject();
    const parcel = checkOf(p, 'land_site.parcel_identification');
    recordCheckFields(p, parcel.id, { survey_numbers: 'Sy. No. 12/2', extent_khata: 1850 }, 'tester');
    const out = drop(p, paper('Khata.pdf', 'khata', fact('survey_numbers', 'Survey number', '12/2', 'Sy. No. 12/2'), fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')));

    assert.ok(!out.assistantTurn.text.includes('⚑'), out.assistantTurn.text);
    assert.ok(!(out.proposals ?? []).some((c) => c.kind === 'record_check_fields'), 'nothing is offered for a field that already says it');
    assert.equal(statesTheSame('conversion_status', 'Converted', 'converted'), true);
    // A full stop is part of a number and of nothing else.
    assert.equal(statesTheSame('owner', 'K. Ramaiah', 'K Ramaiah'), true);
    assert.equal(statesTheSame('owner', 'Example Estates Pvt. Ltd.', 'Example Estates Pvt Ltd'), true);
    assert.equal(statesTheSame('owner', 'K. Ramaiah', 'K. Ramesh'), false);
    assert.equal(statesTheSame('permissible_far', '2.5', '25'), false);
    assert.deepEqual(surveyNumbersIn('Sy. Nos. 41/1, 41/2 & 42'), ['41/1', '41/2', '42']);
  });

  it('takes one measure rounded twice as one measure', () => {
    assert.equal(statesTheSame('extent_khata', 9105, 9105.43, true), true, 'a khata in square feet and a deed in square metres');
    assert.equal(statesTheSame('extent_khata', 111, 111.48, true), true, 'a small plot rounded to the square metre');
    assert.equal(statesTheSame('extent_khata', 1850, 1790, true), false);
    assert.equal(statesTheSame('extent_khata', 11850, 11900, true), false, 'fifty apart is two figures, however large the plot');
    assert.equal(statesTheSame('extent_khata', 9105, 9106.2, true), false, 'more than a unit apart');
    assert.equal(statesTheSame('road_width_ft', 30, 30.1, true), true);
    assert.equal(statesTheSame('road_width_ft', 9, 9.5, true), false, 'half a unit on a small measure is more than a rounding');
    assert.equal(statesTheSame('extent_khata', 0, 0, true), true);

    const p = seedBdaReferenceProject();
    const parcel = checkOf(p, 'land_site.parcel_identification');
    assert.equal(isMeasure(checkSchema(parcel).fields.find((f) => f.key === 'extent_khata')!), true, 'an area is a measure');
    assert.equal(isMeasure(checkSchema(checkOf(p, 'land_site.access')).fields.find((f) => f.key === 'road_width_ft')!), true, 'and so is a width in feet');
    recordCheckFields(p, parcel.id, { extent_khata: 1850 }, 'tester');
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850.43, '1,850 sqm')));
    assert.ok(!out.assistantTurn.text.includes('⚑'), out.assistantTurn.text);
    assert.ok(!(out.proposals ?? []).some((c) => c.kind === 'record_check_fields'), 'and no card puts the rounding beside the figure');
  });

  it('takes any other number for the same only when it is the same number', () => {
    // A budget, a ratio, a count, a year and a number that names something are exact. One off is another value.
    assert.equal(statesTheSame('gross_revenue', 1_200_000_000, 1_205_000_000), false);
    assert.equal(statesTheSame('sanctioned_far', 2.25, 2.26), false);
    assert.equal(statesTheSame('units_sold', 400, 401), false);
    assert.equal(statesTheSame('years_required', 1987, 1994), false);
    assert.equal(statesTheSame('khata_number', 11204, 11205), false);
    assert.equal(statesTheSame('units_sold', 400, 400), true);

    const p = seedBdaReferenceProject();
    const margin = checkOf(p, 'financial_appraisal.margin');
    const sanction = checkOf(p, 'regulatory.sanction');
    for (const [check, key] of [[margin, 'gross_revenue'], [sanction, 'sanctioned_far'], [checkOf(p, 'commercial_market.absorption'), 'units_sold']] as const) {
      assert.equal(isMeasure(checkSchema(check).fields.find((f) => f.key === key)!), false, `${key} is no measure`);
    }
    recordCheckFields(p, margin.id, { gross_revenue: 1_200_000_000 }, 'tester');
    recordCheckFields(p, sanction.id, { sanctioned_far: 2.25 }, 'tester');
    assert.deepEqual([margin.fields?.gross_revenue?.value, sanction.fields?.sanctioned_far?.value], [1_200_000_000, 2.25]);

    // On the paper that carries it: a ratio sanctioned is a sanctioned plan's to state.
    const out = drop(p, paper('Sanctioned plan.pdf', 'sanction', fact('gross_revenue', 'Gross revenue', 1_205_000_000, 'Rs 120.5 Cr'), fact('sanctioned_far', 'FAR sanctioned', 2.26, '2.26')));
    const cards = (out.proposals ?? []).filter((c) => c.kind === 'record_check_fields');
    assert.deepEqual(cards.flatMap((c) => Object.keys(c.payload.values as object)).sort(), ['gross_revenue', 'sanctioned_far'], 'each is put to its check beside the figure held');
    assert.match(out.assistantTurn.text, /⚑ Differs from what is on file: Gross revenue Rs 120\.5 Cr \(p\.1\) against [^;]+; FAR sanctioned 2\.26 \(p\.1\) against 2\.25 on \[chk_/);
  });

  it('does not make two papers a rounding apart into a choice on a blank field', () => {
    const p = seedBdaReferenceProject();
    const parcel = checkOf(p, 'land_site.parcel_identification');
    drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')));
    const second = drop(p, paper('Khata copy.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850.43, '1,850 sqm')));
    assert.ok(!(second.proposals ?? []).some((c) => c.kind === 'record_check_fields'), 'the figure already waits on the check');
    const waiting = waitingOnCheck(p, parcel.id).fields.find((f) => f.key === 'extent_khata')!;
    assert.deepEqual([waiting.values.length, waiting.disagree], [1, false]);
    // A figure that is another figure still waits beside it.
    drop(p, paper('Khata later.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1790, '1,790 sqm')));
    assert.equal(waitingOnCheck(p, parcel.id).fields.find((f) => f.key === 'extent_khata')!.disagree, true);
  });

  it('reads survey numbers as the numbers they are', () => {
    assert.equal(statesTheSame('survey_numbers', 'Sy. No. 41A', '41B'), false, 'a letter on the number is part of it');
    assert.equal(statesTheSame('survey_numbers', '41/1, 41/2 & 42', '41/1'), true, 'one parcel of the three held');
    assert.equal(statesTheSame('survey_numbers', '41/1, 41/2 & 42', '42, 99'), false, 'a parcel the list does not have');
    assert.equal(statesTheSame('survey_numbers', '41/1', '41/10'), false);
    assert.deepEqual(surveyNumbersIn('Sy. No. 12/2, Example Layout, Bengaluru 560066'), ['12/2'], 'a pin code is not a parcel');
    assert.deepEqual(surveyNumbersIn('Sy. No. 12/2, 560066'), ['12/2']);

    // A paper that names a parcel the site does not have is about other land, whatever else it shares with it.
    const p = seedDemoProject();
    const out = drop(p, paper('Sale deed.pdf', 'deed', fact('survey_numbers', 'Survey numbers', '42, 99', 'Sy. Nos. 42, 99')));
    assert.match(out.assistantTurn.text, /⚑ Differs from what is on file: Survey numbers Sy\. Nos\. 42, 99 \(p\.1\) against Sy\. Nos\. 41\/1, 41\/2 & 42 on the project record\./);
  });

  it('puts right a check that holds a parcel the project does not have', () => {
    const p = seedBdaReferenceProject();
    const parcel = checkOf(p, 'land_site.parcel_identification');
    recordCheckFields(p, parcel.id, { survey_numbers: 'Sy. No. 12/3' }, 'tester');
    const out = drop(p, paper('Khata.pdf', 'khata', fact('survey_numbers', 'Survey number', '12/2', 'Sy. No. 12/2')));
    assert.match(out.assistantTurn.text, /⚑ Differs from what is on file: Survey number Sy\. No\. 12\/2 \(p\.1\) against Sy\. No\. 12\/3 on \[chk_[^\]]+\], recorded by tester\./);
    assert.ok((out.proposals ?? []).some((c) => c.kind === 'record_check_fields' && (c.payload.values as Record<string, unknown>).survey_numbers === '12/2'), 'the project’s own number is put to the check');
  });

  it('still sets an extent against the land area when the project’s parcel is written with its address', () => {
    const p = seedBdaReferenceProject();
    p.parcelId = `${p.parcelId}, Example Layout, Bengaluru 560066`;
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1790, '1,790 sqm')));
    assert.match(out.assistantTurn.text, /Extent per khata 1,790 sqm \(p\.1\) against 1,850 sqm on the project record\./);
  });

  it('says nothing of a value the check cannot take, which no card offers', () => {
    const p = seedBdaReferenceProject();
    const use = checkOf(p, 'regulatory.land_use');
    recordCheckFields(p, use.id, { conversion_status: 'converted' }, 'tester');
    const out = drop(p, paper('Conversion order.pdf', 'conversion', fact('conversion_status', 'DC conversion', 'converted in part', 'Converted in part')));
    assert.ok(!(out.proposals ?? []).some((c) => c.kind === 'record_check_fields'), 'the field takes one of its own words, and this is none of them');
    assert.ok(!out.assistantTurn.text.includes('⚑'), out.assistantTurn.text);
    assert.equal(use.fields?.conversion_status?.value, 'converted');
  });

  it('does not raise again a value a person has set aside', () => {
    const p = seedBdaReferenceProject();
    const parcel = checkOf(p, 'land_site.parcel_identification');
    recordCheckFields(p, parcel.id, { extent_khata: 1850 }, 'tester');
    const khata = paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1790, '1,790 sqm', 2));
    assert.match(drop(p, khata).assistantTurn.text, /⚑ Differs from what is on file: Extent per khata 1,790 sqm/);
    // The person keeps what the check holds.
    pickCheckValue(p, parcel.id, 'extent_khata', null, 'tester');
    assert.equal(parcel.fields?.extent_khata?.value, 1850);

    // The same paper read again states the same figure. The check and the land area on the project record still hold the other.
    const again = drop(p, khata);
    assert.ok(!again.assistantTurn.text.includes('⚑'), again.assistantTurn.text);
    assert.ok(!(again.proposals ?? []).some((c) => c.kind === 'record_check_fields' && c.status === 'proposed'), 'and is not put to the check a second time');
  });

  it('asks afresh of another paper that states a value set aside for the first', () => {
    const p = seedBdaReferenceProject();
    const parcel = checkOf(p, 'land_site.parcel_identification');
    // A khata for other land: its parcel is set aside on the check.
    const khata = paper('Khata.pdf', 'khata', fact('survey_numbers', 'Survey number', '118/2', 'Sy. No. 118/2'));
    assert.match(drop(p, khata).assistantTurn.text, /⚑ Differs from what is on file: Survey number Sy\. No\. 118\/2/);
    pickCheckValue(p, parcel.id, 'survey_numbers', null, 'tester');
    assert.ok(!drop(p, khata).assistantTurn.text.includes('⚑'), 'read again, the khata is not raised again');

    // A deed for the same other land is another paper. It is filed under Title, and it is not this project's parcel either.
    const deed = drop(p, paper('Sale deed.pdf', 'deed', fact('survey_numbers', 'Survey number', '118/2', 'Sy. No. 118/2')));
    assert.match(deed.assistantTurn.text, /Filed under Legal › Title/);
    assert.match(deed.assistantTurn.text, new RegExp(`⚑ Differs from what is on file: Survey number Sy\\. No\\. 118/2 \\(p\\.1\\) against ${p.parcelId!.replaceAll('.', '\\.')} on the project record\\.`));
  });

  it('sets two papers against each other only when they are about one parcel', () => {
    // A site of three parcels, each with a khata of its own.
    const p = seedDemoProject();
    drop(p, paper('Khata 41-1.pdf', 'khata', fact('survey_numbers', 'Survey number', '41/1', 'Sy. No. 41/1'), fact('khata_number', 'Khata number', '112/4'), fact('owner', 'Owner on the khata', 'A. Example')));
    reviewFacts(p, rowOf(p, 'Khata 41-1.pdf').id, 'all', 'accept', 'tester');
    const next = drop(p, paper('Khata 41-2.pdf', 'khata', fact('survey_numbers', 'Survey number', '41/2', 'Sy. No. 41/2'), fact('khata_number', 'Khata number', '98/1'), fact('owner', 'Owner on the khata', 'B. Example')));
    assert.ok(!next.assistantTurn.text.includes('⚑'), `another parcel’s khata does not disagree: ${next.assistantTurn.text}`);
    // A second khata for the first parcel does.
    const same = drop(p, paper('Khata 41-1 later.pdf', 'khata', fact('survey_numbers', 'Survey number', '41/1', 'Sy. No. 41/1'), fact('khata_number', 'Khata number', '77/9')));
    assert.match(same.assistantTurn.text, /⚑ Differs from what is on file: Khata number 77\/9 \(p\.1\) against 112\/4 in \[ev:/);
  });

  it('says a paper about other land than the project record names', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, paper('Khata.pdf', 'khata', fact('survey_numbers', 'Survey number', '118/2', 'Sy. No. 118/2', 2), fact('extent_khata', 'Extent per khata', 12000, '12,000 sqm', 2)));

    assert.match(out.assistantTurn.text, new RegExp(`⚑ Differs from what is on file: Survey number Sy\\. No\\. 118/2 \\(p\\.2\\) against ${p.parcelId!.replaceAll('.', '\\.')} on the project record\\. Nothing is overwritten\\.`));
    // Its extent is of that other land, and is not set against this project's area.
    assert.deepEqual(documentDisagreements(p, rowOf(p, 'Khata.pdf')).map((d) => d.key), ['survey_numbers']);
  });

  it('says an extent that differs from the land area, for a paper about the whole site', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1790, '1,790 sqm')));
    assert.match(out.assistantTurn.text, /Extent per khata 1,790 sqm \(p\.1\) against 1,850 sqm on the project record\./);

    const rounded = seedBdaReferenceProject();
    assert.ok(!drop(rounded, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1849.6, '1,849.6 sqm'))).assistantTurn.text.includes('⚑'), 'a rounding is not a disagreement');
  });

  it('does not take a deed for one parcel of several as disagreeing with the site', () => {
    const p = seedDemoProject();
    assert.deepEqual(surveyNumbersIn(p.parcelId), ['41/1', '41/2', '42']);
    const out = drop(p, paper('Sale deed.pdf', 'deed', fact('survey_numbers', 'Survey number', '41/1', 'Sy. No. 41/1'), fact('extent_title', 'Extent per title', 16000, '16,000 sqm')));
    assert.ok(!out.assistantTurn.text.includes('⚑'), out.assistantTurn.text);
  });

  it('says a value that differs from one a person accepted on another paper, and links that paper', () => {
    const p = seedBdaReferenceProject();
    drop(p, paper('Khata.pdf', 'khata', fact('khata_number', 'Khata number', '112/4'), fact('owner', 'Owner on the khata', 'A. Example')));
    const first = rowOf(p, 'Khata.pdf');

    // Unaccepted, the first paper holds nothing for a second to differ from.
    const early = seedBdaReferenceProject();
    drop(early, paper('Khata.pdf', 'khata', fact('khata_number', 'Khata number', '112/4')));
    assert.ok(!drop(early, paper('Khata 2.pdf', 'khata', fact('khata_number', 'Khata number', '98/1'))).assistantTurn.text.includes('⚑'));

    reviewFacts(p, first.id, 'all', 'accept', 'tester');
    const out = drop(p, paper('Khata 2.pdf', 'khata', fact('khata_number', 'Khata number', '98/1'), fact('owner', 'Owner on the khata', 'B. Example')));
    assert.match(out.assistantTurn.text, new RegExp(`Khata number 98/1 \\(p\\.1\\) against 112/4 in \\[ev:${first.id}\\], p\\.1; Owner on the khata B\\. Example \\(p\\.1\\) against A\\. Example in \\[ev:${first.id}\\], p\\.1\\.`));
    // The other paper is a link in the words. It is not one of the papers this reply brought.
    assert.deepEqual(out.assistantTurn.citedEvidenceIds, [rowOf(p, 'Khata 2.pdf').id]);
  });

  it('leaves the paper it differs from as it was when everything is approved', () => {
    const p = seedBdaReferenceProject();
    // Each value on a paper that carries it: the PID on a tax receipt and a khata, the date on the conversion order.
    drop(p, paper('Tax receipt.pdf', 'receipt', fact('pid', 'PID', '81-120-12')), paper('Conversion order.pdf', 'conversion', fact('conversion_date', 'Date of the conversion order', '2019-04-02', '2 Apr 2019')));
    const order = rowOf(p, 'Conversion order.pdf');
    const receipt = rowOf(p, 'Tax receipt.pdf');
    // The receipt's PID is accepted. The order's date is still to be decided, on the paper and on the check it would fill.
    reviewFacts(p, receipt.id, ['pid'], 'accept', 'tester');
    assert.deepEqual(proposedFacts(order).map((f) => f.key), ['conversion_date']);

    // The khata states only another PID, so it leaves no card of its own open.
    const out = drop(p, paper('Khata.pdf', 'khata', fact('pid', 'PID', '81-120-99')));
    assert.match(out.assistantTurn.text, new RegExp(`PID 81-120-99 \\(p\\.1\\) against 81-120-12 in \\[ev:${receipt.id}\\]`));
    assert.ok(!p.chatProposals.some((c) => c.status === 'proposed' && out.assistantTurn.proposalIds?.includes(c.id)));
    // The chips under the reply are for the khata: nothing counts the order's date, and no chip goes to its function.
    assert.deepEqual(chipsOf(p, out).map((c) => [c.kind, c.words, c.count]), [['waiting', 'waiting on the Title documents', 1], ['graph', 'In the graph', undefined]]);

    const approved = applyProjectChat(p, 'approve all');
    // The receipt says what it left: the order's date, on the paper and on the check.
    assert.equal(approved.assistantTurn.text, 'Accepted 1 value on 1 document. 2 more are waiting: 1 on the Approvals documents and 1 on the Approvals checks.');
    assert.equal(acceptedFacts(rowOf(p, 'Khata.pdf')).length, 1, 'the khata’s own value is accepted');
    assert.deepEqual(proposedFacts(order).map((f) => f.key), ['conversion_date'], 'the order’s date still waits for a person');
    assert.equal(checkOf(p, 'regulatory.land_use').fields?.conversion_date, undefined, 'and is not on the check');
  });

  it('says where the rest waits when the last reply has nothing left to accept', () => {
    const p = seedBdaReferenceProject();
    drop(p, paper('Conversion order.pdf', 'conversion', fact('conversion_date', 'Date of the conversion order', '2019-04-02', '2 Apr 2019')));
    const order = rowOf(p, 'Conversion order.pdf');
    drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')));
    // The khata's value is accepted where it sits, which settles the card it raised.
    reviewFacts(p, rowOf(p, 'Khata.pdf').id, 'all', 'accept', 'tester');

    const out = applyProjectChat(p, 'approve all');
    assert.equal(out.assistantTurn.text, 'Nothing from the last reply is left to accept. 2 more are waiting: 1 on the Approvals documents and 1 on the Approvals checks. Each is accepted where it is shown.');
    assert.deepEqual(proposedFacts(order).map((f) => f.key), ['conversion_date'], 'nothing of another reply was taken');
    assert.equal(checkOf(p, 'regulatory.land_use').fields?.conversion_date, undefined);
    // Saying which ones is still an instruction.
    applyProjectChat(p, 'approve all open');
    assert.equal(checkOf(p, 'regulatory.land_use').fields?.conversion_date?.value, '2019-04-02');
  });

  it('takes no card of an earlier reply for a word of assent, nor for “approve all” after a reply that raised none', () => {
    const waitingDate = () => {
      const p = seedBdaReferenceProject();
      drop(p, paper('Conversion order.pdf', 'conversion', fact('conversion_date', 'Date of the conversion order', '2019-04-02', '2 Apr 2019')));
      return p;
    };
    const dateOn = (p: DdProject) => checkOf(p, 'regulatory.land_use').fields?.conversion_date?.value;

    // The khata raised no card. A sentence that names none answers the khata's reply, and the order's card is not it.
    const assent = waitingDate();
    drop(assent, paper('Khata.pdf', 'khata', fact('pid', 'PID', '81-120-99')));
    applyProjectChat(assent, 'approve');
    assert.equal(dateOn(assent), undefined);

    // A reply that raises no card of its own leaves "approve all" nothing to take. It no longer means every open card.
    const after = waitingDate();
    applyProjectChat(after, 'open Title');
    applyProjectChat(after, 'approve all');
    assert.equal(dateOn(after), undefined);
  });

  it('does not set two deeds of one chain against each other', () => {
    const p = seedBdaReferenceProject();
    drop(p, paper('Deed 2011.pdf', 'deed', fact('vendor', 'Vendor', 'A. Example'), fact('purchaser', 'Purchaser', 'B. Example'), fact('registration_date', 'Registered on', '2011-03-04', '4 Mar 2011')));
    reviewFacts(p, rowOf(p, 'Deed 2011.pdf').id, 'all', 'accept', 'tester');
    const out = drop(p, paper('Deed 2019.pdf', 'deed', fact('vendor', 'Vendor', 'B. Example'), fact('purchaser', 'Purchaser', 'C. Example'), fact('registration_date', 'Registered on', '2019-03-12', '12 Mar 2019')));
    assert.ok(!out.assistantTurn.text.includes('⚑'), out.assistantTurn.text);
  });

  it('names two, the one about which land first, and counts the rest', () => {
    const p = seedBdaReferenceProject();
    drop(p, paper('Khata.pdf', 'khata', fact('khata_number', 'Khata number', '112/4'), fact('owner', 'Owner on the khata', 'A. Example')));
    reviewFacts(p, rowOf(p, 'Khata.pdf').id, 'all', 'accept', 'tester');
    const out = drop(p, paper('Khata 2.pdf', 'khata', fact('owner', 'Owner on the khata', 'B. Example'), fact('khata_number', 'Khata number', '98/1'), fact('survey_numbers', 'Survey number', '118/2', 'Sy. No. 118/2')));
    assert.match(out.assistantTurn.text, /⚑ Differs from what is on file: Survey number Sy\. No\. 118\/2 \(p\.1\) against [^;]+ on the project record; Khata number 98\/1 [^;]+; and 1 more\. Nothing is overwritten\./);
    assert.equal(disagreementSentence([]), '');
  });
});

describe('what a dropped paper reaches', () => {
  /** A valuation a registered valuer signed, on file. */
  const certified = (p: DdProject) => {
    const report = addEvidence(p, { title: 'Valuation report', kind: 'document', status: 'received' });
    attachEvidenceFile(p, report.id, { fileName: 'valuation.pdf', mimeType: 'application/pdf', sizeBytes: 1024, storageKey: 's3://valuation' });
    return fileCertifiedReport(p, { workstream: 'finance.valuation', title: 'Valuation report', evidenceId: report.id, signer: { name: 'A. Valuer', profession: 'Registered Valuer' }, figure: { value: 120_000_000, unit: 'INR' } }, 'tester');
  };

  it('names the functions downstream of the one it was filed under', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')));
    assert.match(out.assistantTurn.text, /\nReaches Valuation\.$/, 'Title feeds Valuation');
  });

  it('names a certified report that rests on what it reaches', () => {
    const p = seedBdaReferenceProject();
    certified(p);
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')));
    assert.match(out.assistantTurn.text, /\nReaches Valuation\. Valuation report \(A\. Valuer\), certified, rests on this and may need revisiting\.$/);
  });

  it('is not said to an outside collaborator', () => {
    const p = seedBdaReferenceProject();
    certified(p);
    const out = applyProjectChat(p, '', { ingest: [paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm'))], outside: true });
    assert.match(out.assistantTurn.text, /Filed under Legal › Title, at the Land stage\./);
    assert.ok(!/Reaches|Valuation report/.test(out.assistantTurn.text), out.assistantTurn.text);
  });

  it('names three functions and counts the rest', () => {
    const p = seedBdaReferenceProject();
    const out = drop(
      p,
      paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')),
      paper('Conversion order.pdf', 'conversion', fact('conversion_date', 'Date of the conversion order', '2019-04-02', '2 Apr 2019')),
    );
    assert.match(out.assistantTurn.text, /\nReaches Progress, Valuation and Budget, and 2 more downstream\.$/, 'nearest first: what Approvals gates, then what that feeds');
  });

  it('says nothing for a paper that brings nothing to move a value', () => {
    const p = seedBdaReferenceProject();
    certified(p);
    const bare = drop(p, paper('Khata.pdf', 'khata'));
    assert.ok(!bare.assistantTurn.text.includes('Reaches'), bare.assistantTurn.text);
    assert.match(reachSentence(p, [rowOf(p, 'Khata.pdf').id]), /^Reaches Valuation\./, 'though the graph could say it');

    const loose = drop(p, paper('Meeting notes.pdf', 'notes'));
    assert.ok(!loose.assistantTurn.text.includes('Reaches'));
    assert.equal(reachSentence(p, [rowOf(p, 'Meeting notes.pdf').id]), '', 'a paper no function holds reaches nothing');
    assert.equal(reachSentence(p, []), '');
  });
});

describe('a dropped paper in the graph', () => {
  it('has one chip, last, that opens the graph on the paper', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')), paper('Conversion order.pdf', 'conversion'));
    const chips = chipsOf(p, out);
    const chip = chips.at(-1)!;
    const first = rowOf(p, 'Khata.pdf');

    assert.equal(chips.filter((c) => c.kind === 'graph').length, 1);
    assert.equal(chip.words, 'In the graph');
    assert.equal(cockpitPath(p.id, chip.open!.pane, chip.open!.extra), `/projects/${p.id}/graph?node=${first.id}`, 'the first paper, the one the page opened on');
  });

  it('is drawn from the register: the paper is a node its function holds, and nothing was stored for the chip', () => {
    const p = seedBdaReferenceProject();
    const before = Object.keys(p).sort();
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')));
    const row = rowOf(p, 'Khata.pdf');
    const graph = buildProjectGraph(p);

    assert.equal(graph.nodes.find((n) => n.id === row.id)?.kind, 'evidence');
    const holder = graph.edges.find((e) => e.rel === 'holds' && e.to === row.id);
    assert.equal(graph.nodes.find((n) => n.id === holder?.from)?.key, 'legal.title');
    assert.deepEqual(Object.keys(p).sort(), before, 'the project grew no new part');
    assert.ok(!JSON.stringify(p.conversation.at(-1)).includes('In the graph'), 'the chip is read off the reply, not kept on it');
    assert.equal(p.conversation.at(-1)!.id, out.assistantTurn.id);
  });

  it('is offered only for a drop', () => {
    const p = seedBdaReferenceProject();
    drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')));
    const asked = applyProjectChat(p, 'What is waiting?');
    assert.ok(!chipsOf(p, asked).some((c) => c.kind === 'graph' || c.kind === 'filed'));
  });
});

describe('what a drop took in that is no paper read', () => {
  /** The reply to a drop of a questionnaire, a photograph of the site and a voice note nothing could put into words, as the server writes it. */
  function sorted(p: DdProject) {
    const sheet = addQuestionnaire(p, { title: 'Queries on title', department: 'legal', fileName: 'Queries on title.xlsx', parsed: { header: [], questions: [{ text: 'Who holds the original deed?' }] } }, 'tester');
    const photo = addEvidence(p, { title: 'Site photograph, 2 Oct 2026', kind: 'photograph', status: 'received', source: 'chat_upload' }, 'tester');
    attachEvidenceFile(p, photo.id, { fileName: 'IMG_2041.jpg', mimeType: 'image/jpeg', sizeBytes: 9, storageKey: 's3://IMG_2041.jpg', capture: { purpose: 'progress' } }, 'tester');
    photo.workstream = 'construction.progress';
    const note = notReadYetCard({ fileName: 'voice-note.wav', mimeType: 'audio/wav', sizeBytes: 9, storageKey: 's3://voice-note.wav' }, 'tester');
    p.chatProposals.push(note);
    const turn = { toolCalls: [{ name: 'ingest' }], citedEvidenceIds: [photo.id], citedNodeIds: [sheet.id, note.id], proposalIds: [] };
    return { sheet, photo, note, turn };
  }
  const address = (p: DdProject, chip: { open?: { pane: ProjectCockpitPane; extra: Parameters<typeof cockpitPath>[2] } }) => cockpitPath(p.id, chip.open!.pane, chip.open!.extra);

  it('has a chip for each: the questionnaire and the photograph on their pages, the note where it waits to be filed', () => {
    const p = seedBdaReferenceProject();
    const { sheet, photo, note, turn } = sorted(p);
    const chips = turnChips(p, turn, waitingOnCanvas(p), {});
    assert.deepEqual(chips.map((chip) => [chip.kind, chip.count, chip.words]), [
      ['filed', undefined, 'The questionnaire'],
      ['filed', undefined, 'The photograph'],
      ['filed', undefined, 'The voice note'],
    ]);
    const [questions, picture, voice] = chips;
    assert.deepEqual([questions!.ids, address(p, questions!)], [[sheet.id], `/projects/${p.id}/d/legal?stage=land&step=questions&item=${sheet.id}`], 'the Questions step of the page the questionnaire is on, at itself');
    assert.deepEqual(picture!.ids, [photo.id]);
    assert.match(address(p, picture!), new RegExp(`^/projects/${p.id}/w/construction\\.progress\\?.*part=documents`), 'Progress, at its documents, with the photograph lit');
    assert.deepEqual([voice!.ids, address(p, voice!)], [[note.id], `/projects/${p.id}/evidence`], 'the voice note by the card it waits on, at the documents, where it waits');
    assert.ok(!chips.some((chip) => chip.kind === 'graph'), 'and no paper to open in the graph');
  });

  it('counts as waiting only what “approve all” under the reply would take, and a voice note kept unread is none of it', () => {
    const p = seedBdaReferenceProject();
    const { note, turn } = sorted(p);
    // The reply as the thread holds it: the last thing the chat said.
    const reply: ProjectChatTurn = { id: 'cht_drop', role: 'assistant', text: 'A questionnaire, a photograph and a voice note.', at: new Date().toISOString(), ...turn, toolCalls: [{ name: 'ingest', summary: 'Sorted what was dropped' }] };
    p.conversation.push(reply);
    assert.ok(waitingOnCanvas(p).entries.some((entry) => entry.proposalId === note.id), 'the note’s card does wait, on the documents');
    assert.deepEqual(turnChips(p, turn, waitingOnCanvas(p), {}).filter((chip) => chip.kind === 'waiting'), [], 'and is not counted as what this reply left');
    assert.match(applyProjectChat(p, 'approve all').assistantTurn.text, /^Nothing from the last reply is left to accept\./, 'which is what the instruction finds');
    // Two notes are told apart by their files' names.
    const second = notReadYetCard({ fileName: 'voice-note-2.wav', mimeType: 'audio/wav', sizeBytes: 9, storageKey: 's3://voice-note-2.wav' }, 'tester');
    p.chatProposals.push(second);
    const words = turnChips(p, { ...turn, citedNodeIds: [...turn.citedNodeIds, second.id] }, waitingOnCanvas(p), {}).map((chip) => chip.words);
    assert.deepEqual(words.slice(-2), ['voice-note.wav', 'voice-note-2.wav']);
  });

  it('says a card that waits on a function’s own page waits under that page: a site entry, under Progress', () => {
    const p = seedDemoProject();
    const card = createChatProposal('log_site_entry', 'Site entry, 5 Oct 2026', 'From a voice note.', 'Adds an entry to the site log.', {}, 'tester');
    p.chatProposals.push(card);
    const waiting = waitingOnCanvas(p);
    const [chip] = turnChips(p, { proposalIds: [card.id] }, waiting, {});
    assert.deepEqual([chip!.kind, chip!.count, chip!.words, chip!.entry?.fn], ['waiting', 1, 'waiting under Progress', 'construction.progress'], 'the page the chip opens is the page it names');
    assert.equal(waitingSentence(p, { entries: waiting.entries.filter((entry) => entry.proposalId === card.id) }, {}, false), '1 is waiting: 1 under Progress.');
    // With no Progress page on the project the card waits on Overview, and is said to.
    setProjectDepartments(p, ['legal'], 'tester');
    assert.equal(turnChips(p, { proposalIds: [card.id] }, waitingOnCanvas(p), {})[0]!.words, 'waiting under Overview');
  });

  it('counts photographs on one chip, tells two questionnaires apart by title, and still names where the papers went', () => {
    const p = seedBdaReferenceProject();
    const out = drop(p, paper('Khata.pdf', 'khata', fact('extent_khata', 'Extent per khata', 1850, '1,850 sqm')));
    const { sheet, photo, note } = sorted(p);
    const second = addQuestionnaire(p, { title: 'Queries on approvals', department: 'legal', fileName: 'Queries on approvals.xlsx', parsed: { header: [], questions: [{ text: 'Is the plan sanction in hand?' }] } }, 'tester');
    const other = addEvidence(p, { title: 'Site photograph, 3 Oct 2026', kind: 'photograph', status: 'received', source: 'chat_upload' }, 'tester');
    attachEvidenceFile(p, other.id, { fileName: 'IMG_2042.jpg', mimeType: 'image/jpeg', sizeBytes: 9, storageKey: 's3://IMG_2042.jpg', capture: { purpose: 'progress' } }, 'tester');
    other.workstream = 'construction.progress';
    // The reply to a drop that held a paper as well: what the rules cite, with what the server adds for the rest.
    const turn = { ...out.assistantTurn, citedEvidenceIds: [...out.assistantTurn.citedEvidenceIds, photo.id, other.id], citedNodeIds: [...(out.assistantTurn.citedNodeIds ?? []), sheet.id, second.id, note.id] };
    const words = turnChips(p, turn, waitingOnCanvas(p), {}).map((chip) => chip.words);
    assert.deepEqual(words.filter((said) => /questionnaire|Queries|photograph/.test(said)), ['Queries on title', 'Queries on approvals', 'The 2 photographs']);
    assert.equal(words.at(-1), 'In the graph', 'the paper is still the one opened in the graph');
    assert.ok(!words.includes('Progress documents'), 'the photographs are not said a second time as papers');
  });

  it('is named only by a drop’s reply: another reply that cites the same things has no such chip', () => {
    const p = seedBdaReferenceProject();
    const { turn } = sorted(p);
    assert.deepEqual(turnChips(p, { ...turn, toolCalls: [{ name: 'answer_from_file' }] }, waitingOnCanvas(p), {}), []);
  });
});

describe('papers read off the page', () => {
  const DOCS = path.resolve('test/fixtures/documents');
  const read = (name: string): Promise<ChatIngestFile> => {
    const bytes = readFileSync(path.join(DOCS, name));
    return readIngestLocally({ fileName: name, mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: `s3://${name}` }, bytes);
  };

  it('are filed, counted and set against the file as the reader read them', async () => {
    const files = await Promise.all(['Khata_Certificate_and_Extract_BBMP.pdf', 'DC_Conversion_Order_2017.pdf', 'Sale_Deed_2019_Sy_118-2_Whitefield.pdf'].map(read));
    assert.deepEqual(files.map((f) => f.read?.type), ['khata', 'conversion_order', 'sale_deed']);

    const p = seedBdaReferenceProject();
    const out = drop(p, ...files);
    const lines = out.assistantTurn.text.split('\n');

    assert.equal(lines[0], 'Read 3 documents: khata certificate and extract, DC conversion order, sale deed.');
    assert.equal(lines[1], 'Filed at the Land stage: 2 under Legal › Title and 1 under Legal › Approvals.');
    // The samples are of other land than the seeded acquisition. Three papers saying so is one thing to know.
    assert.equal(lines[2], `⚑ Differs from what is on file: Survey number Sy. No. 118/2 (3 documents) against ${p.parcelId} on the project record. Nothing is overwritten.`);
    assert.match(lines[3]!, /^\d+ values are waiting on the right, each beside the words it came from\. \d+ values fill checks: \d+ on Title, \d+ on Approvals\. Nothing is on the file until you accept it there\.$/);
    assert.equal(lines[4], 'Reaches Progress, Valuation and Budget, and 2 more downstream.');
    assert.equal(lines.length, 5);

    assert.equal(landing(p, out), `/projects/${p.id}/w/legal.title?stage=land&part=documents`);
    assert.deepEqual(chipsOf(p, out).map((c) => c.words), [
      'waiting on the Title documents',
      'waiting on the Approvals documents',
      'waiting on the Title checks',
      'waiting on the Approvals checks',
      'In the graph',
    ]);
  });
});
