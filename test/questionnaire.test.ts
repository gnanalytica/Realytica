/**
 * The questionnaire: read as the client wrote it, answered with its footing.
 *
 * The cases are the ones a real sheet raised: questions that end in no
 * question mark, answers written on the line below, a header printed twice,
 * a Word file whose only reliable mark for "this is a question" is its list
 * numbering, and a model's answers that must never overwrite a person's.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
  addEvidence,
  addQuestion,
  addQuestionnaire,
  answerQuestion,
  confirmSuggestions,
  createProject,
  parseQuestionnaire,
  parseQuestionnaireCsv,
  parseQuestionnaireText,
  questionStatus,
  questionnaireCsv,
  questionnaireSummary,
  questionnaireText,
  removeQuestion,
  suggestAnswers,
  type DdProject,
} from '@realytica/shared';
import { docxOutline } from '../apps/api/src/documents/docx-outline';

function project(): DdProject {
  return createProject({ name: 'Questionnaire test', type: 'commercial', location: 'CBD', city: 'Bengaluru', currentStage: 'operations' }, 'RYT-Q1');
}

function file(p: DdProject, title: string, kind: 'document' | 'photograph' = 'document') {
  const row = addEvidence(p, { title, kind, status: 'received' }, 'tester');
  row.attachments.push({ id: `att_${row.id}`, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, storageKey: `${row.id}.pdf`, uploadedAt: new Date().toISOString() });
  return row;
}

const SHEET = [
  { text: 'Property Name: Example Tower' },
  { text: 'City: Bengaluru' },
  { text: 'Property Name: Example Tower' },
  { text: 'What type of slab is used in construction?', listed: true },
  { text: 'Deck slab' },
  { text: 'How many refuge floors are there?', listed: true },
  { text: 'Name of the SPV', listed: true },
  { text: '– To be confirmed' },
  { text: 'Is the land freehold or leasehold?', listed: true },
  { text: 'Land is Freehold' },
];

/** A .docx is a zip; this writes the one entry the reader needs, deflated like Word's own. */
function docx(documentXml: string): Buffer {
  const name = Buffer.from('word/document.xml');
  const raw = Buffer.from(documentXml, 'utf8');
  const data = deflateRawSync(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

describe('reading a questionnaire', () => {
  it('takes the author’s list numbering as the mark of a question', () => {
    const parsed = parseQuestionnaire(SHEET);
    assert.deepEqual(parsed.questions.map((q) => q.text), ['What type of slab is used in construction?', 'How many refuge floors are there?', 'Name of the SPV', 'Is the land freehold or leasehold?']);
    assert.equal(parsed.questions[0]!.answer, 'Deck slab');
    assert.equal(parsed.questions[1]!.answer, undefined, 'a question with nothing under it is unanswered, not answered by the next question');
    assert.equal(parsed.questions[2]!.answer, 'To be confirmed', 'a leading dash is not part of the answer');
  });

  it('keeps each header fact once', () => {
    const parsed = parseQuestionnaire(SHEET);
    assert.deepEqual(parsed.header, [
      { label: 'Property Name', value: 'Example Tower' },
      { label: 'City', value: 'Bengaluru' },
    ]);
  });

  it('falls back to the wording when nothing is marked', () => {
    const parsed = parseQuestionnaireText('What is the clear height?\n4.0 metres\nHow many lifts are there?\n1. Is there a fire NOC?\nYes');
    assert.equal(parsed.questions.length, 3);
    assert.equal(parsed.questions[0]!.answer, '4.0 metres');
    assert.equal(parsed.questions[1]!.answer, undefined);
    assert.equal(parsed.questions[2]!.text, 'Is there a fire NOC?');
  });

  it('reads a spreadsheet by its column names', () => {
    const parsed = parseQuestionnaireCsv('Section,Question,Answer\nStructure,"Grid size, in metres?",10.5 x 11\nServices,Type of chiller?,\n');
    assert.equal(parsed.questions.length, 2);
    assert.deepEqual(parsed.questions[0], { section: 'Structure', text: 'Grid size, in metres?', answer: '10.5 x 11' });
    assert.equal(parsed.questions[1]!.answer, undefined);
  });

  it('reads a Word file’s paragraphs with their list marks', () => {
    const p = (text: string, listed = false) => `<w:p><w:pPr>${listed ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const xml = `<?xml version="1.0"?><w:document><w:body>${p('City: Bengaluru')}${p('City: Bengaluru')}${p('Who manages the CAM?', true)}${p('Developer')}${p('Fire &amp; CCTV integrated?', true)}</w:body></w:document>`;
    const lines = docxOutline(docx(xml));
    assert.deepEqual(lines.map((l) => [l.text, Boolean(l.listed)]), [
      ['City: Bengaluru', false],
      ['Who manages the CAM?', true],
      ['Developer', false],
      ['Fire & CCTV integrated?', true],
    ]);
    const parsed = parseQuestionnaire(lines);
    assert.equal(parsed.questions.length, 2);
    assert.equal(parsed.questions[0]!.answer, 'Developer');
  });

  it('refuses a file that is not a Word document', () => {
    assert.throws(() => docxOutline(Buffer.from('not a zip at all')), /Word document/);
  });
});

describe('a questionnaire on the project', () => {
  it('brings the sheet’s own answers in as the seller’s', () => {
    const p = project();
    const q = addQuestionnaire(p, { title: 'Building questionnaire', parsed: parseQuestionnaire(SHEET) }, 'tester');
    assert.equal(q.questions.length, 4);
    assert.equal(q.questions[0]!.source, 'seller');
    assert.equal(q.questions[1]!.source, undefined);
    const s = questionnaireSummary(q);
    assert.deepEqual([s.total, s.answered, s.unanswered, s.sellerOnly, s.proven], [4, 3, 1, 3, 0]);
    assert.equal(s.percent, 75);
  });

  it('refuses a sheet with no questions', () => {
    assert.throws(() => addQuestionnaire(project(), { title: 'Empty', parsed: { header: [], questions: [] } }, 'tester'), /No questions/);
  });

  it('records an answer with its source and proof, and only proof that is on the file', () => {
    const p = project();
    const q = addQuestionnaire(p, { title: 'Sheet', parsed: parseQuestionnaire(SHEET) }, 'tester');
    const dbr = file(p, 'Structural design basis report');
    const target = q.questions[1]!;
    assert.throws(() => answerQuestion(p, q.id, target.id, { answer: 'One', proof: [{ evidenceId: 'ev_missing' }] }, 'engineer'), /No document or photograph/);
    const saved = answerQuestion(p, q.id, target.id, { answer: 'One refuge floor, level 8', proof: [{ evidenceId: dbr.id, page: 14, quote: 'Refuge area at level 8' }] }, 'engineer');
    assert.equal(saved.source, 'document', 'proof that names a document makes it a document’s answer');
    assert.equal(saved.proof[0]!.page, 14);
    assert.equal(questionStatus(saved), 'answered');
    assert.equal(questionnaireSummary(q).proven, 1);
  });

  it('clears source and proof with the answer', () => {
    const p = project();
    const q = addQuestionnaire(p, { title: 'Sheet', parsed: parseQuestionnaire(SHEET) }, 'tester');
    const cleared = answerQuestion(p, q.id, q.questions[0]!.id, { answer: null }, 'engineer');
    assert.equal(cleared.answer, undefined);
    assert.equal(cleared.source, undefined);
    assert.deepEqual(cleared.proof, []);
  });

  it('lays a model’s answers down as suggestions, never over a person’s', () => {
    const p = project();
    const q = addQuestionnaire(p, { title: 'Sheet', parsed: parseQuestionnaire(SHEET) }, 'tester');
    const doc = file(p, 'Design basis report');
    const photo = file(p, 'Refuge floor signage', 'photograph');
    const [slab, refuge, spv] = q.questions;
    answerQuestion(p, q.id, spv!.id, { answer: 'Example Realty Pvt Ltd', source: 'engineer' }, 'engineer');
    const landed = suggestAnswers(
      p,
      q.id,
      [
        { questionId: refuge!.id, answer: 'One, at level 8', source: 'site', proof: [{ evidenceId: photo.id }] },
        { questionId: slab!.id, answer: 'Composite deck slab', proof: [{ evidenceId: doc.id, page: 3 }] },
        { questionId: spv!.id, answer: 'Something else', proof: [{ evidenceId: doc.id }] },
      ],
      'copilot',
    );
    assert.equal(landed, 2, 'the engineer’s own answer is left alone');
    assert.equal(spv!.answer, 'Example Realty Pvt Ltd');
    assert.equal(questionStatus(refuge!), 'suggested');
    assert.equal(slab!.answer, 'Composite deck slab', 'a seller’s unproven word gives way to a document');
    assert.equal(questionnaireSummary(q).suggested, 2);

    assert.equal(confirmSuggestions(p, q.id, [refuge!.id], 'engineer'), 1);
    assert.equal(questionStatus(refuge!), 'answered');
    assert.equal(refuge!.answeredBy, 'engineer');
    assert.equal(confirmSuggestions(p, q.id, 'all', 'engineer'), 1);
    assert.equal(questionnaireSummary(q).suggested, 0);
  });

  it('adds and removes questions, keeping the order they were sent in', () => {
    const p = project();
    const q = addQuestionnaire(p, { title: 'Sheet', parsed: parseQuestionnaire(SHEET) }, 'tester');
    const added = addQuestion(p, q.id, { text: 'What is the floor loading?' }, 'engineer');
    assert.equal(added.order, 4);
    removeQuestion(p, q.id, q.questions[0]!.id, 'engineer');
    assert.equal(q.questions.length, 4);
  });

  it('goes back out in the order it came in, with what stands behind each answer', () => {
    const p = project();
    const q = addQuestionnaire(p, { title: 'Sheet', parsed: parseQuestionnaire(SHEET) }, 'tester');
    const doc = file(p, 'Sale deed');
    answerQuestion(p, q.id, q.questions[3]!.id, { answer: 'Freehold', source: 'document', proof: [{ evidenceId: doc.id, page: 2 }] }, 'engineer');
    const csv = questionnaireCsv(p, q).trim().split('\n');
    assert.equal(csv[0], 'No.,Section,Question,Answer,Source,Proof,Status');
    assert.equal(csv.length, 5);
    assert.ok(csv[4]!.includes('Freehold,From a document,"Sale deed, p. 2",Answered'));
    assert.ok(csv[2]!.endsWith('Unanswered'));
    const text = questionnaireText(p, q);
    assert.ok(text.includes('Property Name: Example Tower'));
    assert.ok(text.includes('(not answered)'));
    assert.ok(text.includes('[From a document · Sale deed, p. 2]'));
  });
});
