/**
 * A questionnaire dropped in the chat, and Excel and PDF in and out.
 *
 * A file dropped in the chat used to be filed as a paper whatever it was. A
 * list of questions somebody sent is taken in as a questionnaire, answers are
 * suggested from what stands on the file, and what a file is is decided in
 * one place. Invented papers and questions only; no model.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { deflateRawSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  addEvidence,
  addQuestionnaire,
  createProject,
  parseQuestionnaireRows,
  questionnaireCsv,
  withinQuestionnaireLimits,
  proposeFacts,
  questionStatus,
  questionnaireOrPaper,
  questionnaireSaid,
  suggestFromFile,
  type ChatIngestFile,
  type DdProject,
  type DocumentFact,
} from '@realytica/shared';

let server: Server;
let base: string;
let dataDir: string;

async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((line, i) => page.drawText(line, { x: 40, y: 780 - i * 22, size: 11, font }));
  return Buffer.from(await doc.save());
}

const QUESTIONS = ['What is the survey number of the land?', 'What is the extent of the site?', 'Who is the architect of record?', 'Is the building plan sanctioned?'];

/** A workbook as a client sends one: a title, the property, then a table with a Question column. */
async function workbook(): Promise<Buffer> {
  // The Excel library is the API's own, and is found from there.
  const ExcelJS = createRequire(path.resolve('apps/api/package.json'))('exceljs') as typeof import('../apps/api/node_modules/exceljs');
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Queries');
  sheet.addRow(['Queries on title and approvals']);
  sheet.addRow(['Property', 'Navilugudda land']);
  sheet.addRow([]);
  sheet.addRow(['Sl. No.', 'Question', 'Response']);
  QUESTIONS.forEach((question, i) => sheet.addRow([i + 1, question, i === 2 ? 'Kadamba Design Studio' : '']));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const fact = (key: string, label: string, value: DocumentFact['value'], display: string, more: Partial<DocumentFact> = {}): DocumentFact => ({ key, label, value, display, page: 2, quote: `${label}: ${display}`, ...more });

/** A project with a deed on file: one value the rules read surely, which stands, and a model's, which waits. */
function withDeed(): { p: DdProject; deedId: string } {
  const p = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0042');
  const deed = addEvidence(p, { title: 'Sale deed', kind: 'document', status: 'received' });
  deed.documentType = 'Sale deed';
  deed.facts = proposeFacts([], [fact('survey_numbers', 'Survey number', '73/4', 'Sy. No. 73/4'), fact('extent_title', 'Extent per title', 2450, '2,450 sqm', { source: 'model', proof: 'second_reader' })]);
  return { p, deedId: deed.id };
}

async function drop(projectId: string, files: Array<[string, Buffer, string]>, question = ''): Promise<Array<Record<string, any>>> {
  const form = new FormData();
  for (const [name, bytes, type] of files) form.append('files', new Blob([bytes], { type }), name);
  form.append('question', question);
  const res = await fetch(`${base}/api/projects/${projectId}/chat/files`, { method: 'POST', body: form });
  return (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
}

async function seeded(p: DdProject): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  store.data.projects!.push(p);
  await store.save();
  return p;
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-qdrop-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = createServer(app).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  const { releaseOcr } = await import('../apps/api/src/documents/read-text');
  await releaseOcr();
  // A drop is still the request's work after its reply: let that end before its directory goes.
  const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
  await afterReplyWorkDone();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('a questionnaire as a file', () => {
  it('is read from Excel under the row that names its columns, and taken out as Excel that reads back the same', async () => {
    const { readQuestionnaireFile, questionnaireXlsx } = await import('../apps/api/src/documents/questionnaire-file');
    const read = (await readQuestionnaireFile({ originalname: 'queries.xlsx', buffer: await workbook() }))!;
    assert.equal(read.namedColumn, true);
    assert.deepEqual(read.parsed.header, [{ label: 'Property', value: 'Navilugudda land' }]);
    assert.deepEqual(read.parsed.questions.map((q) => [q.text, q.answer]), QUESTIONS.map((q, i) => [q, i === 2 ? 'Kadamba Design Studio' : undefined]));

    const { p, deedId } = withDeed();
    const sheet = addQuestionnaire(p, { title: 'Queries', parsed: read.parsed }, 'tester');
    suggestFromFile(p, sheet.id, 'tester');
    const back = (await readQuestionnaireFile({ originalname: 'answered.xlsx', buffer: await questionnaireXlsx(p, sheet) }))!;
    assert.deepEqual(back.parsed.questions.map((q) => q.text), QUESTIONS, 'the questions, in the order sent');
    assert.match(back.parsed.questions[0]!.answer!, /Survey number: Sy\. No\. 73\/4 \(Sale deed, p\. 2\)/, 'each answer with its source');
    assert.ok(deedId && parseQuestionnaireRows([['Rent roll'], ['Unit', 'Tenant', 'Rent'], ['101', 'A', '1000']]).named === false, 'a table with no Question column does not say it is one');
  });

  it('is read from a PDF, a question that runs over a line kept whole, and taken out as a PDF with each answer and its source', async () => {
    const { readQuestionnaireFile, questionnairePdf } = await import('../apps/api/src/documents/questionnaire-file');
    const { readDocumentText } = await import('../apps/api/src/documents/read-text');
    const bytes = await pdfOf(['Queries on title', '1. What is the survey number of the land', 'as the latest record of rights shows it?', '2. Who is the owner on record?', '3. Is the land converted?']);
    const read = (await readQuestionnaireFile({ originalname: 'queries.pdf', buffer: bytes }))!;
    assert.deepEqual(read.parsed.questions.map((q) => q.text), ['What is the survey number of the land as the latest record of rights shows it?', 'Who is the owner on record?', 'Is the land converted?']);

    const { p } = withDeed();
    const sheet = addQuestionnaire(p, { title: 'Queries on title', parsed: read.parsed }, 'tester');
    suggestFromFile(p, sheet.id, 'tester');
    const out = await questionnairePdf(p, sheet);
    assert.equal(out.subarray(0, 5).toString('latin1'), '%PDF-');
    const words = (await readDocumentText(new Uint8Array(out), 'application/pdf', 'answered.pdf')).pages.join('\n');
    assert.match(words, /1\. What is the survey number of the land/);
    assert.match(words, /Survey number: Sy\. No\. 73\/4/);
    assert.match(words, /From a document · Sale deed, p\. 2 · Suggested/, 'where it came from, the paper and page, and that nobody has confirmed it');
    assert.match(words, /Not answered\./);
  });
});

/** A zip of one packed entry that says of itself that it unpacks to nothing: a file can say anything about its own size. */
function zipOf(name: string, data: Buffer): Buffer {
  const packed = deflateRawSync(data);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12);
  end.writeUInt32LE(30 + n.length + packed.length, 16);
  return Buffer.concat([local, n, packed, central, n, end]);
}

describe('how much is taken in as one questionnaire', () => {
  it('holds five hundred questions of six hundred characters, opens no workbook past four megabytes, and says what was left out', async () => {
    const many = { header: [], questions: Array.from({ length: 60_000 }, (_, i) => ({ text: `What is item ${i + 1}?` })) };
    const cut = withinQuestionnaireLimits(many);
    assert.deepEqual([cut.parsed.questions.length, cut.leftOut], [500, 'Only the first 500 of its 60,000 questions were taken in: one questionnaire holds no more.']);
    const long = withinQuestionnaireLimits({ header: [], questions: [{ text: 'x'.repeat(3_000_000) }] });
    assert.deepEqual([long.parsed.questions[0]!.text.length, long.leftOut], [600, 'One question was longer than 600 characters and was cut there.']);
    assert.equal(withinQuestionnaireLimits({ header: [], questions: QUESTIONS.map((text) => ({ text })) }).leftOut, undefined, 'nothing is said of a questionnaire that was taken in whole');

    // Whichever door it comes by, and said where the questionnaire is shown and in the chat.
    const p = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0049');
    const sheet = addQuestionnaire(p, { title: 'Everything', parsed: many }, 'tester');
    assert.equal(sheet.questions.length, 500);
    assert.match(questionnaireSaid(sheet), /500 questions\..*Only the first 500 of its 60,000 questions were taken in/);

    // A workbook is unpacked under a limit before it is opened, whatever it says of its own size.
    const { readQuestionnaireFile, QuestionnaireTooLarge } = await import('../apps/api/src/documents/questionnaire-file');
    await assert.rejects(
      readQuestionnaireFile({ originalname: 'everything.xlsx', buffer: zipOf('xl/worksheets/sheet1.xml', Buffer.alloc(5 * 1024 * 1024, 0x20)) }),
      (err: Error) => err instanceof QuestionnaireTooLarge && /too large to open as a questionnaire: its sheets hold more than 4 MB/.test(err.message),
    );
    const csv = `Question,Answer\n${Array.from({ length: 900 }, (_, i) => `What is item ${i + 1}?,`).join('\n')}`;
    const read = (await readQuestionnaireFile({ originalname: 'queries.csv', buffer: Buffer.from(csv) }))!;
    assert.deepEqual([read.parsed.questions.length, read.leftOut], [500, 'Only the first 500 of its 900 questions were taken in: one questionnaire holds no more.']);

    // The older CSV download: an answer a spreadsheet would run as a formula is written as words.
    sheet.questions[0]!.answer = '=HYPERLINK("http://example.test","x")';
    assert.match(questionnaireCsv(p, sheet), /"'=HYPERLINK\(""http:\/\/example\.test"",""x""\)"/);
  });
});

describe('answers suggested from the file', () => {
  it('are only what stands, each with the paper and page behind it, and wait for a person', () => {
    const { p, deedId } = withDeed();
    const sheet = addQuestionnaire(p, { title: 'Queries', parsed: { header: [], questions: QUESTIONS.map((text) => ({ text })) } }, 'tester');
    assert.equal(suggestFromFile(p, sheet.id, 'tester'), 1);
    const [survey, extent] = sheet.questions;
    assert.deepEqual([survey!.answer, survey!.source, survey!.suggested, questionStatus(survey!)], ['Survey number: Sy. No. 73/4 (Sale deed, p. 2)', 'document', true, 'suggested']);
    assert.deepEqual(survey!.proof, [{ evidenceId: deedId, page: 2, quote: 'Survey number: Sy. No. 73/4' }]);
    assert.equal(extent!.answer, undefined, 'a model’s extent nobody has accepted answers nothing');
    assert.equal(questionnaireSaid(sheet), 'Took in the questionnaire “Queries”: 4 questions. 1 has an answer suggested from the file, waiting for you and 3 are open.');
  });
});

describe('what a dropped file is', () => {
  const questions = (n: number, asked: number) => ({ header: [], questions: Array.from({ length: n }, (_, i) => ({ text: i < asked ? `What is item ${i + 1}?` : `Item ${i + 1} of the schedule` })) });

  it('is told from the file: a questionnaire, a paper, or not told', () => {
    assert.equal(questionnaireOrPaper({ fileName: 'scan.pdf', parsed: questions(8, 8), recognised: true }), 'paper', 'a paper the reader knows is a paper, whatever it numbers');
    assert.equal(questionnaireOrPaper({ fileName: 'TDD questionnaire.docx', parsed: questions(2, 0) }), 'unsure', 'only its name says so: asked, not assumed');
    assert.equal(questionnaireOrPaper({ fileName: 'Reply to queries - vendor.pdf', parsed: questions(4, 0) }), 'unsure', 'a letter of numbered replies is not taken for a questionnaire by its name');
    assert.equal(questionnaireOrPaper({ fileName: 'TDD questionnaire.docx', parsed: questions(6, 5) }), 'questionnaire', 'what is in it says so');
    assert.equal(questionnaireOrPaper({ fileName: 'sheet.xlsx', parsed: questions(3, 0), namedColumn: true }), 'questionnaire', 'a Question column says so');
    assert.equal(questionnaireOrPaper({ fileName: 'list.txt', parsed: questions(6, 5) }), 'questionnaire', 'most of its items read as questions');
    assert.equal(questionnaireOrPaper({ fileName: 'letter.txt', parsed: questions(9, 3) }), 'unsure', 'a few questions among other lines: a person is asked');
    assert.equal(questionnaireOrPaper({ fileName: 'letter.txt', parsed: questions(9, 1) }), 'paper');
    assert.equal(questionnaireOrPaper({ fileName: 'photo.jpg', parsed: null }), 'paper');
  });

  it('is decided in one place, so notes of a meeting and a questionnaire do not both claim a file', async () => {
    const { whatWasDropped } = await import('../apps/api/src/documents/questionnaire-drop');
    const p = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0044');
    const notes = ['Minutes of the site meeting', 'Present: Asha, Vikram, Meera', 'Date: 3 October 2026', 'Decisions:', '- The retaining wall is to be redesigned.', 'Actions:', '- Vikram to send the revised drawing by 10 October.', 'Open points:', '- Who pays for the redesign?', '- When does the contractor resume?', '- Is the sanction affected?', '- What does the lender need?'].join('\n');
    const asDropped = (fileName: string, text: string): { paper: ChatIngestFile; file: { originalname: string; buffer: Buffer } } => ({
      paper: { fileName, mimeType: 'text/plain', sizeBytes: text.length, storageKey: `k-${fileName}`, excerpt: text },
      file: { originalname: fileName, buffer: Buffer.from(text) },
    });
    const ask = async (fileName: string, text: string, more: Partial<Parameters<typeof whatWasDropped>[0]> = {}) => (await whatWasDropped({ project: p, ...asDropped(fileName, text), fresh: true, whole: true, ...more })).as;

    assert.equal(await ask('site meeting.txt', notes), 'notes', 'notes with open questions in them are notes');
    assert.equal(await ask('queries from the lender.txt', notes), 'notes', 'and a name alone does not make them a questionnaire');
    assert.equal(await ask('list.txt', QUESTIONS.concat('What is the road width?').join('\n')), 'questionnaire');
    assert.equal(await ask('letter.txt', ['Dear Sir,', 'We write about the land at Navilugudda.', 'The papers were sent last week.', ...QUESTIONS.slice(0, 3), 'We look forward to your reply.', 'Yours faithfully'].join('\n')), 'unsure', 'asked, where nothing else claims it');
    assert.equal(await ask('list.txt', QUESTIONS.join('\n'), { whole: false }), 'paper', 'an outside collaborator’s file is a paper');
    assert.equal(await ask('list.txt', QUESTIONS.join('\n'), { said: 'paper' }), 'paper', 'what a person said it is, is what it is');
    assert.equal(await ask('letter.txt', 'Dear Sir,\nThe papers were sent.\nIs that all?', { said: 'questionnaire' }), 'questionnaire');
  });
});

describe('a questionnaire dropped in the chat', () => {
  it('is taken in and not filed as a paper, answered from what stands, and said in the reply with where it is', async () => {
    const { p } = withDeed();
    await seeded(p);
    const lines = await drop(p.id, [['Queries on title.xlsx', await workbook(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]);
    const result = lines.find((l) => l.type === 'result')!;
    const project = result.project as DdProject;
    assert.equal(project.evidence.filter((e) => e.attachments.length).length, 0, 'no row on the register: it is not a paper');
    assert.equal(project.questionnaires?.length, 1);
    assert.deepEqual(project.questionnaires![0]!.questions.map((q) => questionStatus(q)), ['suggested', 'unanswered', 'answered', 'unanswered']);
    assert.equal(
      result.assistantTurn.text,
      'Took in the questionnaire “Queries on title”: 4 questions. 1 is answered, 1 has an answer suggested from the file, waiting for you and 2 are open. It is on the Questions page of Engineering & Construction.',
    );
    const taken = lines.find((l) => l.type === 'reading' && l.event === 'taken')!;
    assert.deepEqual([taken.as, taken.said, taken.department], ['questionnaire', 'A questionnaire: 4 questions', 'construction'], 'and the desk is told, with the way to the questions');
    assert.equal(project.chatProposals.filter((c) => c.kind === 'file_evidence').length, 0, 'nor left noted as a file not read');
    assert.deepEqual(project.audit.filter((a) => a.entityType === 'questionnaire').map((a) => a.action), ['questionnaire_added', 'answers_suggested']);
    // The file it came from is kept, and can be opened again.
    const sheet = project.questionnaires![0]!;
    assert.ok(sheet.fileKey, 'the questionnaire keeps the key of its file');
    const sent = await fetch(`${base}/api/projects/${p.id}/questionnaires/${sheet.id}/file`);
    assert.deepEqual([sent.status, (await sent.arrayBuffer()).byteLength], [200, (await workbook()).length]);
  });

  it('asks about a letter that only its name calls queries, and honours “a paper” typed with the file', async () => {
    const p = await seeded(createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0050'));
    const letter = Buffer.from(['Reply to your queries', '1. The vendor confirms the boundaries as shown.', '2. The tax is paid to date.', '3. No notice has been received.', '4. Possession is with the vendor.'].join('\n'));
    const name = 'Reply to queries - vendor.txt';
    const first = (await drop(p.id, [[name, letter, 'text/plain']])).find((l) => l.type === 'result')!;
    assert.equal(first.assistantTurn.text, `I could not tell whether ${name} is a questionnaire to answer or a paper to file. Which is it?`);
    assert.equal((first.project as DdProject).questionnaires?.length ?? 0, 0, 'it is not taken in on its name');

    const again = (await drop(p.id, [[name, letter, 'text/plain']], `File “${name}” as a paper`)).find((l) => l.type === 'result')!;
    const project = again.project as DdProject;
    assert.equal(project.questionnaires?.length ?? 0, 0, 'what the person said it is, is what it is');
    assert.equal(project.evidence.filter((e) => e.attachments.some((a) => a.fileName === name)).length, 1, 'filed as the paper it is');
  });

  it('is asked about, with two answers to press, when the file does not say what it is', async () => {
    const p = await seeded(createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0045'));
    const letter = ['Dear Sir,', 'We write about the land at Navilugudda.', 'The papers were sent last week.', ...QUESTIONS.slice(0, 3), 'We look forward to your reply.', 'Yours faithfully'].join('\n');
    // Dropped beside a questionnaire that is taken in at once: the letter is still held, to be asked about.
    const lines = await drop(p.id, [['Queries on title.xlsx', await workbook(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ['letter.txt', Buffer.from(letter), 'text/plain']]);
    const result = lines.find((l) => l.type === 'result')!;
    assert.match(result.assistantTurn.text, /^Took in the questionnaire “Queries on title”: 4 questions\..*\n\nI could not tell whether letter\.txt is a questionnaire to answer or a paper to file\. Which is it\?$/);
    assert.deepEqual(result.assistantTurn.choices.map((c: { label: string; send: string }) => [c.label, c.send]), [
      ['A questionnaire', 'Take in “letter.txt” as a questionnaire'],
      ['A paper to file', 'File “letter.txt” as a paper'],
    ]);
    const asked = result.project as DdProject;
    assert.deepEqual([asked.questionnaires?.length ?? 0, asked.evidence.filter((e) => e.attachments.length).length], [1, 0], 'nothing is assumed of the letter meanwhile');
    assert.deepEqual(asked.chatProposals.filter((c) => c.kind === 'file_evidence' && c.status === 'proposed').map((c) => c.title), ['letter.txt'], 'it stays noted as a file not read');

    const res = await fetch(`${base}/api/projects/${p.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Take in “letter.txt” as a questionnaire' }) });
    const answered = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>).find((l) => l.type === 'result')!;
    const project = answered.project as DdProject;
    assert.equal(project.questionnaires?.length, 2, 'pressed, it is taken in as what the person said');
    assert.match(answered.assistantTurn.text, /^Took in the questionnaire “letter”: \d+ questions?\./);
    assert.equal(project.chatProposals.filter((c) => c.kind === 'file_evidence' && c.status === 'proposed').length, 0);
  });

  it('leaves the notes of a meeting to the meeting rules, and says so on the desk', async () => {
    const p = await seeded(createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0046'));
    const notes = ['Minutes of the site meeting', 'Present: Asha, Vikram, Meera', 'Date: 3 October 2026', 'Decisions:', '- The retaining wall is to be redesigned.', 'Actions:', '- Vikram to send the revised drawing by 10 October.'].join('\n');
    const lines = await drop(p.id, [['site meeting.txt', Buffer.from(notes), 'text/plain']]);
    const project = lines.find((l) => l.type === 'result')!.project as DdProject;
    assert.equal(project.evidence.filter((e) => e.attachments.length).length, 0, 'not put on the register as a paper');
    const taken = lines.find((l) => l.type === 'reading' && l.event === 'taken')!;
    assert.equal(taken.as, 'notes');
    assert.match(taken.said, /^Notes of a meeting: \d+ items? proposed$/);
    assert.equal(lines.filter((l) => l.type === 'reading' && l.event === 'filed').length, 0);
  });
});
