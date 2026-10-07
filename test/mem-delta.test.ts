/**
 * What the project's memory is told, from the record.
 *
 * Memory is kept in the graph store, and its ground is an entry for every
 * event that changes what a project knows. `memoryDelta` is the rule that
 * turns the record into those entries, and it is shared so that every build
 * tells the same event under the same id.
 *
 * What is pinned here. Each kind of event is told once, from the operation
 * that really records it, and points at the record by id. Telling the same
 * record again tells nothing. A long record is told in pieces that add up to
 * the whole. A chat turn is told once it has its author, and not before. A
 * note left by a work-pane write is one entry, told at once whether or not
 * it names who wrote, and holds nothing back. Memory written in a higher
 * shape is left alone, and one written in a lower shape is told again whole.
 * A copy of the project that does not hold what memory was last told from
 * tells nothing, and a record that has lost the chats lets go of their
 * entries. And no word of the record's gets into an entry: not from a chat
 * or a page, not a file name, a value, a name, an email, or an identity,
 * phone or account number however it is written. The only words in an entry
 * are the product's own, for a value's key and for a page, and the key of a
 * parcel read off the public map, in the map reader's own fixed form and no
 * other. The last test pins the shape itself, so that a change to what is
 * told is made with the schema and not beside it.
 *
 * The stores' side of the same rules is in `mem-sync.test.ts` and
 * `mem-neo4j-statements.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MEM_ENTRY_KINDS,
  MEM_PARCEL_REF,
  MEM_SCHEMA,
  MEM_TURN_KINDS,
  MEM_TURN_WAIT_MS,
  STANDARD_FACT_KEYS,
  addAction,
  addEvidence,
  addDecision,
  addFinding,
  addQuestionnaire,
  addReviewColumns,
  answerQuestion,
  applyProjectChat,
  applyRevenueMap,
  approveOutgoing,
  clearProjectConversation,
  clearRevenueMap,
  confirmSuggestions,
  createAssessment,
  createProject,
  editOutgoing,
  generateReport,
  issueReport,
  keepMeeting,
  logSiteEntry,
  noteOutgoingExported,
  outgoingSeen,
  patchRecordStatus,
  readMeetingNotes,
  memPointer,
  memWho,
  memoryDelta,
  memoryReplay,
  noteProjectEdit,
  recordAuditEvent,
  removeOutgoing,
  removeRevenueMapRead,
  reopenOutgoing,
  reviewFacts,
  sameMemWatermark,
  scrubMemEntry,
  setRowReviewed,
  startOutgoing,
  startReviewRun,
  stopReviewRun,
  suggestAnswers,
  type ChatIngestFile,
  type DdProject,
  type DocumentFact,
  type MemEntry,
  type MemEntryKind,
  type RevenueMapRead,
} from '@realytica/shared';
import { PARCEL_REF_PATTERN } from '../packages/site-intel/src/cadastre';

const VALUER = 'valuer@example.com';
const LEAD = 'lead@example.com';

/** A voice note's file, by the key the store mints for it: an id and the file's ending, with none of its name. */
const VOICE_NOTE = '6f1c2d3e-0000-4000-8000-000000000001.ogg';

/** Two parcels as the public map's reader keys them: the map, a ten-digit code for the village, the survey number. */
const PARCEL = 'kgis:2003010043:10';
const NEXT_PARCEL = 'kgis:2003010043:11/2A';

const fact = (key: string, value: string | number, display = String(value)): DocumentFact => ({
  key,
  label: key.replaceAll('_', ' '),
  value,
  display,
  page: 1,
  quote: `${key}: ${display}`,
});

/** A paper as the chat receives it, already read: a khata, under the name the rules give one, so its row carries a khata's values. */
const paper = (...facts: DocumentFact[]): ChatIngestFile => ({
  fileName: 'Certificate-scan.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  storageKey: 's3://certificate',
  read: {
    type: 'khata',
    label: 'Khata certificate and extract',
    confidence: 0.9,
    method: 'text',
    summary: 'A certificate for the parcel.',
    facts,
    flags: [],
    rowHints: [],
    scopes: [],
    evidenceKind: 'document',
  },
});

/** A read of the public map for one parcel, with nothing near it. */
function mapRead(parcelRef: string, readAt: string): RevenueMapRead {
  const centre = { lat: 12.71, lng: 77.69 };
  return {
    readAt,
    state: 'KA',
    parcelRef,
    surveyNo: '10',
    village: null,
    mandal: null,
    district: null,
    sourceLabel: 'A published layer',
    rings: [
      [
        { lat: centre.lat, lng: centre.lng },
        { lat: centre.lat, lng: centre.lng + 0.0005 },
        { lat: centre.lat + 0.0005, lng: centre.lng + 0.0005 },
        { lat: centre.lat + 0.0005, lng: centre.lng },
      ],
    ],
    centre,
    areaSqm: 2400,
    registerExtent: null,
    classification: null,
    prohibitedCategory: null,
    prohibitedRegisterUnjoined: false,
    features: [],
    factors: [],
    insights: [],
    anchor: null,
    emptyLayers: [],
    unreadLayers: [],
  };
}

function fresh(): DdProject {
  const project = createProject({ name: 'Lakeside plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-M1');
  createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
  return project;
}

/** The row the dropped paper was filed on. */
function filedRow(project: DdProject) {
  const row = project.evidence.find((e) => e.attachments.some((a) => a.storageKey === 's3://certificate'));
  assert.ok(row, 'the paper was filed');
  return row;
}

/** Asks a question the way the route does: the turns are stamped with who asked and where. */
function ask(project: DdProject, question: string, actor: string, place: { pane?: string; department?: string; fn?: string; stage?: string }) {
  const result = applyProjectChat(project, question, { actor });
  for (const turn of [result.userTurn, result.assistantTurn]) {
    turn.actor = actor;
    turn.place = place;
  }
  return result;
}

/** A project on which every kind of event memory is told of has happened, each through the operation that records it. */
function lived() {
  const project = fresh();
  const dropped = applyProjectChat(project, '', { ingest: [paper(fact('extent_khata', 11850, '11,850 sq ft'), fact('owner_name', 'A Person'))] });
  for (const turn of [dropped.userTurn, dropped.assistantTurn]) turn.actor = VALUER;
  const row = filedRow(project);
  reviewFacts(project, row.id, ['extent_khata'], 'accept', VALUER);
  reviewFacts(project, row.id, ['extent_khata'], 'reopen', VALUER);
  reviewFacts(project, row.id, ['extent_khata'], 'accept', VALUER, { value: 11800, display: '11,800 sq ft' });
  reviewFacts(project, row.id, ['owner_name'], 'reject', VALUER);
  const decision = addDecision(project, { title: 'Hold the advance', decisionType: 'hold_payment', decisionMaker: 'Lead', rationale: 'Waiting on a paper.' }, LEAD);
  const action = addAction(project, { title: 'Ask for the earlier deed', kind: 'evidence_request', owner: 'operator', priority: 'high' }, LEAD);
  const finding = addFinding(project, { title: 'Extent differs', description: 'Two papers disagree.', severity: 'high', discipline: 'legal' }, LEAD);
  applyRevenueMap(project, mapRead(PARCEL, '2026-09-06T06:00:00.000Z'), LEAD);
  applyRevenueMap(project, mapRead(NEXT_PARCEL, '2026-09-06T06:05:00.000Z'), LEAD);
  removeRevenueMapRead(project, NEXT_PARCEL, LEAD);
  // An undo, as the chat that makes one records it: what was put back is named in words, which memory does not keep, and by the record it was put back on, which it does.
  recordAuditEvent(project, { actor: LEAD, action: 'undo', entityType: 'project', entityId: project.id, oldValue: 'Accepted the extent', about: [action.id] });
  // The notes of a meeting kept, and a report made and then issued under a name.
  const { meeting } = keepMeeting(project, { file: { storageKey: 'notes.txt', fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: 60 }, came: 'pasted', reading: readMeetingNotes('Meeting notes\nPresent: A Person, B Person\nDecision: wait for the earlier deed.') }, LEAD);
  const report = issueReport(project, generateReport(project, { kind: 'open_risk_action', generatedBy: LEAD }, LEAD).id, LEAD);
  // A second action, closed, and a second decision, settled: the first of each stay as they were recorded.
  const closed = addAction(project, { title: 'Collect the tax receipts', kind: 'evidence_request', owner: 'operator', priority: 'low' }, LEAD);
  patchRecordStatus(project, project.actions, closed.id, 'closed', 'action', LEAD);
  const settled = addDecision(project, { title: 'Use the earlier survey', decisionType: 'other', decisionMaker: 'Lead', rationale: 'It is the one on record.', status: 'pending' }, LEAD);
  patchRecordStatus(project, project.decisions, settled.id, 'approved', 'decision', VALUER);
  // A voice note kept, as the drop that takes one records it: its file by its key, and what became of it in the product's own words. Then the site entry proposed from it, accepted by a person.
  recordAuditEvent(project, { actor: LEAD, action: 'voice_note', entityType: 'voice_note', entityId: VOICE_NOTE, newValue: 'Put into words; a site entry proposed' });
  const { entry } = logSiteEntry(project, { clientId: `voice:${VOICE_NOTE}`, date: '2026-10-03', workDone: 'Shuttering for the second floor slab', weather: 'Clear', manpower: [{ trade: 'Carpenters', count: 6 }], issues: [{ title: 'Steel delivery is late' }] }, LEAD);
  // The review table: a question asked of the paper in a run that is then stopped, and the paper's row marked reviewed and unmarked.
  addReviewColumns(project, [{ kind: 'question', question: 'Who witnessed the deed?' }]);
  const run = startReviewRun(project, [row.id], LEAD, { model: false });
  stopReviewRun(project, run.id, LEAD);
  setRowReviewed(project, row.id, true, VALUER);
  setRowReviewed(project, row.id, false, VALUER);
  // A letter drafted, given its words, approved by name, exported, taken back to draft and removed.
  const draft = startOutgoing(project, { kind: 'letter', to: 'The seller', subject: 'The earlier deed' }, LEAD);
  editOutgoing(project, draft.id, { body: 'Please send us the earlier deed.' }, LEAD);
  approveOutgoing(project, draft.id, { actor: VALUER, seen: outgoingSeen(draft) });
  noteOutgoingExported(project, draft.id, { actor: LEAD, seen: outgoingSeen(draft) });
  reopenOutgoing(project, draft.id, { actor: LEAD, seen: outgoingSeen(draft) });
  removeOutgoing(project, draft.id, LEAD);
  // A questionnaire taken in, an answer suggested from the paper and confirmed, another given by a person, and that one cleared again.
  const sheet = addQuestionnaire(project, { title: 'Lender’s questions', parsed: { header: [], questions: [{ text: 'What is the extent?' }, { text: 'Who holds the khata?' }] } }, LEAD);
  suggestAnswers(project, sheet.id, [{ questionId: sheet.questions[0]!.id, answer: '11,800 sq ft', proof: [{ evidenceId: row.id, page: 1, quote: 'Extent: 11,850 sq ft' }] }], LEAD);
  confirmSuggestions(project, sheet.id, 'all', VALUER);
  answerQuestion(project, sheet.id, sheet.questions[1]!.id, { answer: 'A Person' }, VALUER);
  answerQuestion(project, sheet.id, sheet.questions[1]!.id, { answer: '' }, VALUER);
  // A write made on a work pane, as its route notes it in the thread.
  noteProjectEdit(project, 'Filed the revenue-map read as evidence.', { citedEvidenceIds: [row.id], actor: LEAD });
  const noted = project.conversation.slice(-2);
  const asked = ask(project, 'what is missing?', VALUER, { pane: 'evidence', department: 'legal', stage: 'pre_development' });
  return { project, row, decision, action, finding, meeting, report, closed, settled, dropped, noted, asked, entry, run, draft, sheet };
}

/** Told from the conversation: a question, an answer, or the note of a work-pane write. */
const isTurn = (entry: MemEntry): boolean => MEM_TURN_KINDS.includes(entry.kind);

const ofKind = (entries: MemEntry[], kind: MemEntryKind): MemEntry[] => entries.filter((entry) => entry.kind === kind);

function only(entries: MemEntry[], kind: MemEntryKind): MemEntry {
  const found = ofKind(entries, kind);
  assert.equal(found.length, 1, `one ${kind} entry`);
  return found[0]!;
}

describe('what memory is told of a project', () => {
  it('is one entry for each event, told from the operation that records it', () => {
    const { project, row, decision, action, finding, meeting, report, closed, settled, noted, asked } = lived();
    const { entries } = memoryDelta(project, {});

    assert.deepEqual([...new Set(entries.map((entry) => entry.kind))].sort(), [...MEM_ENTRY_KINDS].sort(), 'every kind of event was told');
    assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length, 'no id twice');
    for (const entry of entries) {
      assert.ok(entry.id.startsWith(`${project.id}::mem::`), 'an id begins with the project it belongs to');
      assert.equal(entry.id, `${project.id}::mem::${entry.sourceId}`, 'and ends with what it was told from');
      assert.match(entry.by, /^who_[0-9a-f]{14}$/, 'a person is an id');
    }

    const audit = (action_: string, entityId: string) => project.audit.find((event) => event.action === action_ && event.entityId === entityId)!;
    const filed = only(entries, 'paper_filed');
    assert.equal(filed.sourceId, audit('create', row.id).id, 'told from the audit event');
    assert.deepEqual(filed.about, [row.id]);
    assert.equal(filed.at, audit('create', row.id).at);
    assert.deepEqual(only(entries, 'file_added').about, [row.id]);

    const read = only(entries, 'paper_read');
    assert.equal(read.sourceId, audit('read', row.id).id, 'a read is told from the line the record wrote for it');
    assert.deepEqual(read.about, [row.id]);
    assert.equal(read.by, memWho(project.id, audit('read', row.id).actor), 'by who had it read');

    const accepted = only(entries, 'value_accepted');
    assert.equal(accepted.key, 'extent_khata', 'the key of the value');
    assert.equal(accepted.label, STANDARD_FACT_KEYS.extent_khata!.label, 'and the name the fixed list of keys gives it, not the paper’s words for it');
    assert.deepEqual(accepted.about, [row.id], 'and the paper it was read off');
    assert.equal(accepted.by, memWho(project.id, VALUER));
    assert.equal(only(entries, 'value_reopened').key, 'extent_khata');
    assert.equal(only(entries, 'value_corrected').key, 'extent_khata');
    const own = only(entries, 'value_set_aside');
    assert.deepEqual([own.key, own.label], [undefined, undefined], 'a value under a key that is not on the list is told with neither');
    assert.deepEqual(own.about, [row.id]);

    assert.deepEqual(ofKind(entries, 'decision_recorded').map((entry) => entry.about), [[decision.id], [settled.id]]);
    assert.deepEqual(ofKind(entries, 'action_recorded').map((entry) => entry.about), [[action.id], [closed.id]]);
    assert.deepEqual(only(entries, 'action_closed').about, [closed.id], 'an action closed is told, and points at the action');
    assert.deepEqual([only(entries, 'decision_settled').about, only(entries, 'decision_settled').by], [[settled.id], memWho(project.id, VALUER)], 'and a decision settled, by who settled it');
    assert.deepEqual(only(entries, 'finding_raised').about, [finding.id]);
    assert.equal(only(entries, 'finding_raised').by, memWho(project.id, LEAD));
    assert.deepEqual(only(entries, 'meeting_kept').about, [meeting.id], 'a meeting kept points at the meeting, and holds none of its notes');
    const issued = only(entries, 'report_issued');
    assert.deepEqual([issued.about, issued.sourceId], [[report.id], audit('issue_report', report.id).id], 'a report is told when it is issued, not when it is made');

    assert.deepEqual(ofKind(entries, 'map_read_kept').map((entry) => entry.about), [[PARCEL], [NEXT_PARCEL]], 'a map read points at its parcel');
    assert.deepEqual(only(entries, 'map_read_removed').about, [NEXT_PARCEL]);

    const undone = only(entries, 'undone');
    assert.equal(undone.sourceId, project.audit.find((event) => event.action === 'undo')!.id, 'an undo is an event of its own');
    assert.equal(undone.by, memWho(project.id, LEAD));
    assert.deepEqual([undone.about, undone.label], [[project.actions[0]!.id], undefined], 'and holds the record it put something back on, and none of the words that say what');

    const note = only(entries, 'edit_noted');
    assert.equal(note.sourceId, noted[0]!.id, 'a work-pane note is told from the line that says what changed');
    assert.deepEqual([note.at, note.by, note.about], [noted[0]!.at, memWho(project.id, LEAD), [row.id]], 'when, who made the write, and what it cites');
    assert.ok(!entries.some((entry) => entry.sourceId === noted[1]!.id), 'and its one-word reply is no entry of its own');

    const question = ofKind(entries, 'chat_asked').find((entry) => entry.sourceId === asked.userTurn.id)!;
    assert.deepEqual(question.place, { pane: 'evidence', department: 'legal', stage: 'pre_development' }, 'the page it was asked on');
    assert.equal(question.by, memWho(project.id, VALUER));
    assert.equal(question.at, asked.userTurn.at);
    const answer = ofKind(entries, 'chat_answered').find((entry) => entry.sourceId === asked.assistantTurn.id)!;
    assert.deepEqual(
      answer.about,
      [...new Set([...asked.assistantTurn.citedEvidenceIds, ...(asked.assistantTurn.citedNodeIds ?? []), ...(asked.assistantTurn.proposalIds ?? [])])],
      'an answer points at what it cites',
    );
  });

  it('tells what the newer parts of the product do, each as an entry that points at a record by its id', () => {
    const { project, row, entry, run, draft, sheet } = lived();
    const { entries } = memoryDelta(project, {});
    const told = (kind: MemEntryKind) => {
      const one = only(entries, kind);
      return [one.about, one.by, one.key, one.label, one.place];
    };
    const [lead, valuer] = [memWho(project.id, LEAD), memWho(project.id, VALUER)];
    const none = [undefined, undefined, undefined];

    assert.deepEqual(told('voice_note_kept'), [[VOICE_NOTE], lead, ...none], 'a voice note by the key its file is stored under');
    assert.deepEqual(told('site_entry_logged'), [[entry.id], lead, ...none], 'the site entry by its id, and by who entered or accepted it');
    assert.deepEqual([told('review_run_started'), told('review_run_stopped')], [[[run.id], lead, ...none], [[run.id], lead, ...none]], 'a run of the review table by its own id, started and stopped');
    assert.deepEqual([told('paper_reviewed'), told('paper_review_unmarked')], [[[row.id], valuer, ...none], [[row.id], valuer, ...none]], 'a row marked reviewed, and unmarked, by its paper');
    for (const kind of ['outgoing_drafted', 'outgoing_exported', 'outgoing_reopened', 'outgoing_removed'] as const) assert.deepEqual(told(kind), [[draft.id], lead, ...none], kind);
    assert.deepEqual(told('outgoing_approved'), [[draft.id], valuer, ...none], 'a draft approved, by who approved it');
    assert.deepEqual([told('questionnaire_added'), told('answers_suggested')], [[[sheet.id], lead, ...none], [[sheet.id], lead, ...none]], 'a questionnaire taken in and answers suggested, by the questionnaire');
    assert.deepEqual(told('answers_confirmed'), [[sheet.id], valuer, ...none], 'answers confirmed, by who confirmed them');
    assert.deepEqual(told('question_answered'), [[sheet.questions[1]!.id], valuer, ...none], 'a person’s own answer by its question, and one cleared is not told as an answer');

    // None of the record's words is in any of them: not the note's outcome, the work done, the question, the answer, who a letter is to, or its subject.
    const kept = JSON.stringify(entries);
    for (const words of ['Put into words', 'Shuttering', 'Steel delivery', 'witnessed', 'The seller', 'earlier deed', 'Lender', 'What is the extent', '11,800', 'A Person', 'reviewed by']) {
      assert.ok(!kept.includes(words), `“${words}” is in no entry`);
    }
  });

  it('tells every map read removed at once as one event with no parcel', () => {
    const project = fresh();
    applyRevenueMap(project, mapRead(PARCEL, '2026-09-06T06:00:00.000Z'), LEAD);
    clearRevenueMap(project, LEAD);
    assert.deepEqual(only(memoryDelta(project, {}).entries, 'map_read_removed').about, []);
  });

  it('tells a paper read with its filing, and not a paper nothing has been read off', () => {
    const project = fresh();
    applyProjectChat(project, '', { ingest: [paper()] });
    const row = filedRow(project);
    row.readMethod = undefined;
    row.facts = [];
    const { entries } = memoryDelta(project, {});
    assert.equal(ofKind(entries, 'paper_filed').length, 1);
    assert.equal(ofKind(entries, 'paper_read').length, 0);
  });

  it('passes over an event it is not told of', () => {
    const project = fresh();
    assert.deepEqual(project.audit.map((event) => `${event.action} ${event.entityType}`), ['create project', 'create assessment']);
    const delta = memoryDelta(project, {});
    assert.deepEqual(delta.entries, []);
    assert.equal(delta.through.auditThrough, project.audit[1]!.id, 'and still stands past it');
  });
});

describe('telling the same record again', () => {
  it('tells nothing', () => {
    const { project } = lived();
    const first = memoryDelta(project, {});
    const again = memoryDelta(project, first.through);
    assert.deepEqual(again.entries, []);
    assert.ok(sameMemWatermark(again.through, first.through), 'and memory stands where it stood');
    assert.equal(again.standsDown, undefined);
  });

  it('gives every event the id it had the first time', () => {
    const { project } = lived();
    assert.deepEqual(memoryDelta(structuredClone(project), {}), memoryDelta(project, {}), 'two builds given the same record tell the same entries');
  });

  it('tells only what came after', () => {
    const { project } = lived();
    const first = memoryDelta(project, {});
    const finding = addFinding(project, { title: 'Access is unclear', description: 'No road on the sketch.', severity: 'medium', discipline: 'legal' }, LEAD);
    const asked = ask(project, 'what is missing?', LEAD, { pane: 'overview' });
    const next = memoryDelta(project, first.through);
    assert.deepEqual(
      next.entries.map((entry) => [entry.kind, entry.sourceId]),
      [
        ['finding_raised', project.audit.at(-1)!.id],
        ['chat_asked', asked.userTurn.id],
        ['chat_answered', asked.assistantTurn.id],
      ],
    );
    assert.deepEqual(next.entries[0]!.about, [finding.id]);
    assert.deepEqual(next.through, { schema: MEM_SCHEMA, auditThrough: project.audit.at(-1)!.id, turnThrough: asked.assistantTurn.id });
  });

  it('tells a long record in pieces that add up to the whole', () => {
    const { project } = lived();
    const whole = memoryDelta(project, {});
    assert.equal(whole.more, undefined);

    const pieces: MemEntry[][] = [];
    let stands = {};
    for (let turns = 0; turns < 100; turns += 1) {
      const piece = memoryDelta(project, stands, { atMost: 3 });
      pieces.push(piece.entries);
      assert.ok(!sameMemWatermark(piece.through, stands), 'each piece moves memory on');
      stands = piece.through;
      if (!piece.more) break;
    }
    assert.ok(pieces.length > 3, 'it took several');
    const told = pieces.flat();
    // The paper's read is told with its filing and again with its file: the same id, which a store keeps once.
    assert.deepEqual([...new Set(told.map((entry) => entry.id))].sort(), whole.entries.map((entry) => entry.id).sort());
    assert.ok(sameMemWatermark(stands, whole.through), 'and ends where telling it at once ends');
    assert.deepEqual(memoryDelta(project, stands, { atMost: 3 }).entries, []);
  });
});

describe('a chat turn nobody has named the author of yet', () => {
  it('waits, and every turn after it waits behind it', () => {
    const project = fresh();
    const first = ask(project, 'what is missing?', VALUER, { pane: 'overview' });
    // Written and not named yet: the request that asked is still waiting on its answer.
    const waiting = applyProjectChat(project, 'what is missing?');
    const later = ask(project, 'what is missing?', LEAD, { pane: 'overview' });

    const delta = memoryDelta(project, {});
    assert.deepEqual(delta.entries.filter(isTurn).map((entry) => entry.sourceId), [first.userTurn.id, first.assistantTurn.id]);
    assert.equal(delta.through.turnThrough, first.assistantTurn.id, 'memory stands before the turn that waits');
    assert.equal(delta.more, undefined, 'and there is nothing more to tell now');
    assert.deepEqual(memoryDelta(project, delta.through).entries, []);

    // The request ends: it names who asked, and where.
    for (const turn of [waiting.userTurn, waiting.assistantTurn]) {
      turn.actor = VALUER;
      turn.place = { pane: 'evidence' };
    }
    const after = memoryDelta(project, delta.through);
    assert.deepEqual(
      after.entries.map((entry) => [entry.sourceId, entry.by, entry.place]),
      [
        [waiting.userTurn.id, memWho(project.id, VALUER), { pane: 'evidence' }],
        [waiting.assistantTurn.id, memWho(project.id, VALUER), { pane: 'evidence' }],
        [later.userTurn.id, memWho(project.id, LEAD), { pane: 'overview' }],
        [later.assistantTurn.id, memWho(project.id, LEAD), { pane: 'overview' }],
      ],
      'the turn is told with its author and its page, and the turns behind it after it',
    );
  });

  it('is told as nobody’s once nobody is coming to name it, and never as the server’s', () => {
    const project = fresh();
    const old = applyProjectChat(project, 'what is missing?');
    const asked = Date.parse(old.userTurn.at);
    assert.deepEqual(memoryDelta(project, {}, { now: asked + MEM_TURN_WAIT_MS }).entries, [], 'not while a request could still be naming it');

    const { entries, more } = memoryDelta(project, {}, { now: Date.parse(old.assistantTurn.at) + MEM_TURN_WAIT_MS + 1 });
    assert.deepEqual(entries.map((entry) => entry.sourceId), [old.userTurn.id, old.assistantTurn.id]);
    assert.equal(more, undefined);
    for (const entry of entries) {
      assert.notEqual(entry.by, memWho(project.id, 'system'), 'a person asked, whoever it was');
      assert.equal(entry.by, memWho(project.id, 'nobody'));
    }
  });

  it('says there is more to tell only when the next turn can be told', () => {
    const project = fresh();
    ask(project, 'what is missing?', VALUER, { pane: 'overview' });
    ask(project, 'what is missing?', VALUER, { pane: 'overview' });
    applyProjectChat(project, 'what is missing?');
    // A project made and a diligence started are two events; the four named turns follow them.
    const piece = memoryDelta(project, {}, { atMost: 4 });
    assert.equal(piece.entries.length, 2);
    assert.equal(piece.more, true, 'two named turns are still to tell');
    const rest = memoryDelta(project, piece.through, { atMost: 2 });
    assert.equal(rest.entries.length, 2);
    assert.equal(rest.more, undefined, 'and behind them only a turn that waits');
  });
});

describe('a note left by a work-pane write', () => {
  /** The last note written: the line that says what changed, and its one-word reply. */
  const lastNote = (project: DdProject) => project.conversation.slice(-2) as [DdProject['conversation'][number], DdProject['conversation'][number]];

  it('is told at once when nobody is named on it, as nobody’s, and holds back no question behind it', () => {
    const project = fresh();
    // What a route that does not say who wrote leaves in the thread, and then a question from a person.
    noteProjectEdit(project, 'Filed Deed.pdf (1.2 MB) in the vault.');
    const [line, reply] = lastNote(project);
    assert.deepEqual([line.actor, reply.actor], [undefined, undefined], 'nothing names its turns');
    const asked = ask(project, 'what is missing?', VALUER, { pane: 'overview' });

    // No time is given: nothing here has waited.
    const delta = memoryDelta(project, {});
    assert.deepEqual(
      delta.entries.filter(isTurn).map((entry) => [entry.kind, entry.sourceId, entry.by]),
      [
        ['edit_noted', line.id, memWho(project.id, 'nobody')],
        ['chat_asked', asked.userTurn.id, memWho(project.id, VALUER)],
        ['chat_answered', asked.assistantTurn.id, memWho(project.id, VALUER)],
      ],
    );
    assert.equal(delta.through.turnThrough, asked.assistantTurn.id);
    assert.equal(delta.more, undefined);
  });

  it('is its author’s when the write names one, on both of its turns', () => {
    const project = fresh();
    noteProjectEdit(project, 'Added a comparable.', { actor: LEAD });
    const [line, reply] = lastNote(project);
    assert.deepEqual([line.actor, reply.actor], [LEAD, LEAD]);
    assert.equal(only(memoryDelta(project, {}).entries, 'edit_noted').by, memWho(project.id, LEAD));
  });

  it('is one entry and one place in a piece, and memory stands past both of its turns', () => {
    const project = fresh();
    noteProjectEdit(project, 'Supplied a survey outline.', { actor: LEAD });
    const [first, firstReply] = lastNote(project);
    // The second names nobody, and is as ready to be told as the first.
    noteProjectEdit(project, 'Cleared the survey outline.');
    const [second, secondReply] = lastNote(project);

    // A project made and a diligence started are two events, and leave room for one more thing.
    const piece = memoryDelta(project, {}, { atMost: 3 });
    assert.deepEqual(piece.entries.map((entry) => entry.sourceId), [first.id]);
    assert.equal(piece.through.turnThrough, firstReply.id, 'never between a note’s two turns');
    assert.equal(piece.more, true, 'the second note can be told now, though nobody is named on it');
    const rest = memoryDelta(project, piece.through, { atMost: 3 });
    assert.deepEqual(rest.entries.map((entry) => [entry.kind, entry.sourceId]), [['edit_noted', second.id]]);
    assert.equal(rest.through.turnThrough, secondReply.id);
    assert.equal(rest.more, undefined);
    assert.deepEqual(memoryDelta(project, rest.through).entries, []);
  });

  it('waits behind a question that is still waiting for its author, as every turn does', () => {
    const project = fresh();
    const waiting = applyProjectChat(project, 'what is missing?');
    noteProjectEdit(project, 'Added a comparable.', { actor: LEAD });
    const delta = memoryDelta(project, {});
    assert.deepEqual(delta.entries.filter(isTurn), []);
    assert.equal(delta.through.turnThrough, undefined);
    assert.equal(delta.more, undefined);

    for (const turn of [waiting.userTurn, waiting.assistantTurn]) turn.actor = VALUER;
    assert.deepEqual(memoryDelta(project, delta.through).entries.map((entry) => entry.kind), ['chat_asked', 'chat_answered', 'edit_noted']);
  });

  it('holds none of the words that say what changed', () => {
    const project = fresh();
    noteProjectEdit(project, 'Read the revenue map for Sy. 42/1A, Seller Person Village.', { actor: LEAD, citedNodeIds: [`${project.id}::evidence::kept`] });
    const note = only(memoryDelta(project, {}).entries, 'edit_noted');
    assert.deepEqual(Object.keys(note).sort(), ['about', 'at', 'by', 'id', 'kind', 'sourceId']);
    assert.deepEqual(note.about, [`${project.id}::evidence::kept`]);
    for (const word of ['42/1A', 'Seller', 'revenue map', 'Recorded']) assert.ok(!JSON.stringify(note).includes(word), `${word} is not in memory`);
  });
});

describe('the parcel a map read points at', () => {
  it('is kept in the map reader’s own form for a parcel’s key, and that is the one form there is', () => {
    assert.equal(MEM_PARCEL_REF.source, PARCEL_REF_PATTERN.source, 'memory keeps what the reader of the public map makes, and the two patterns are one');
    assert.equal(MEM_PARCEL_REF.flags, PARCEL_REF_PATTERN.flags);
  });

  it('is not kept when what the trail names is anything else', () => {
    const project = fresh();
    const said = (newValue: string) => recordAuditEvent(project, { actor: LEAD, action: 'patch', entityType: 'project', entityId: project.id, newValue });
    // A key in no form the reader makes, a name where the key should be, and a real key.
    said('revenueMap kgis:1:10');
    said('revenueMap SellerPersonName');
    said(`revenueMap ${PARCEL}`);
    recordAuditEvent(project, { actor: LEAD, action: 'patch', entityType: 'project', entityId: project.id, oldValue: 'revenueMap 9876543210' });
    const { entries } = memoryDelta(project, {});
    assert.deepEqual(ofKind(entries, 'map_read_kept').map((entry) => entry.about), [[], [], [PARCEL]], 'the read is told all the same, pointing at nothing');
    assert.deepEqual(only(entries, 'map_read_removed').about, []);
  });

  it('is held to that form on the way into a store too, whoever made the entry', () => {
    const entry: MemEntry = { id: 'prj_one::mem::aud_1', kind: 'map_read_kept', at: '2026-09-06T06:00:00.000Z', by: memWho('prj_one', LEAD), sourceId: 'aud_1', about: ['SellerPersonName', PARCEL, 'ev_1', 'ulb:4412'] };
    assert.deepEqual(scrubMemEntry('prj_one', entry)!.about, [PARCEL, 'ulb:4412'], 'a map read points at parcels and at nothing else');
    assert.deepEqual(scrubMemEntry('prj_one', { ...entry, kind: 'map_read_removed' })!.about, [PARCEL, 'ulb:4412']);
    assert.deepEqual(scrubMemEntry('prj_one', { ...entry, kind: 'finding_raised' })!.about, ['SellerPersonName', PARCEL, 'ev_1', 'ulb:4412'], 'the ids of any other entry are left as they are');
  });
});

describe('a memory written in another shape', () => {
  it('is left alone when the shape is a later one', () => {
    const { project } = lived();
    const newer = { schema: MEM_SCHEMA + 1, auditThrough: project.audit[0]!.id };
    const delta = memoryDelta(project, newer);
    assert.equal(delta.standsDown, 'newer');
    assert.deepEqual(delta.entries, []);
    assert.deepEqual(delta.through, newer, 'the watermark is not this build\'s to move');
  });

  it('is told again whole when the shape is an earlier one', () => {
    const { project } = lived();
    const whole = memoryDelta(project, {});
    const older = memoryDelta(project, { ...whole.through, schema: MEM_SCHEMA - 1 });
    assert.equal(older.standsDown, undefined);
    assert.deepEqual(older.entries, whole.entries);
    assert.equal(older.through.schema, MEM_SCHEMA, 'and is in this build\'s shape afterwards');
  });
});

describe('a copy of the project that does not hold what memory was told from', () => {
  it('tells nothing, whether it is the event or the turn it lacks', () => {
    const { project } = lived();
    const whole = memoryDelta(project, {});
    const older = structuredClone(project);
    older.audit = older.audit.slice(0, -1);
    const delta = memoryDelta(older, whole.through);
    assert.equal(delta.standsDown, 'behind');
    assert.deepEqual(delta.entries, []);
    assert.deepEqual(delta.through, whole.through);

    const cleared = structuredClone(project);
    clearProjectConversation(cleared);
    assert.equal(memoryDelta(cleared, whole.through).standsDown, 'behind');
  });
});

describe('a record that has lost what memory was told from', () => {
  it('lets go of the entries of chat turns when it is the chats it lost, and tells the turns it holds now', () => {
    const { project } = lived();
    const whole = memoryDelta(project, {});
    // Every chat is deleted, and then a question is asked.
    clearProjectConversation(project);
    const again = ask(project, 'what is missing?', LEAD, { pane: 'overview' });

    const replay = memoryReplay(project, whole.through);
    assert.deepEqual(replay.forget, ['chat_asked', 'chat_answered', 'edit_noted'], 'the entries told from the conversation go before anything is written, a note’s with the rest');
    assert.deepEqual(replay.forget, [...MEM_TURN_KINDS]);
    assert.deepEqual(replay.entries.filter(isTurn).map((entry) => entry.sourceId), [again.userTurn.id, again.assistantTurn.id]);
    assert.deepEqual(
      replay.entries.filter((entry) => !isTurn(entry)),
      whole.entries.filter((entry) => !isTurn(entry)),
      'and every other event is told again as it was',
    );
    assert.equal(replay.through.turnThrough, again.assistantTurn.id);
  });

  it('lets go of them when the chats are deleted and nothing is asked after', () => {
    const { project } = lived();
    const whole = memoryDelta(project, {});
    clearProjectConversation(project);
    const replay = memoryReplay(project, whole.through);
    assert.deepEqual(replay.forget, [...MEM_TURN_KINDS]);
    assert.deepEqual(replay.entries.filter(isTurn), []);
    assert.equal(replay.through.turnThrough, undefined, 'and memory stands at no turn');
  });

  it('lets go of nothing when it is an audit event it lost', () => {
    const { project } = lived();
    const whole = memoryDelta(project, {});
    const lost = structuredClone(project);
    lost.audit = lost.audit.slice(0, -1);
    const replay = memoryReplay(lost, whole.through);
    assert.equal(replay.forget, undefined, 'an event the record lost happened all the same');
    assert.equal(replay.entries.filter(isTurn).length, whole.entries.filter(isTurn).length);
  });
});

describe('what may be kept in an entry', () => {
  // Made up, and shaped like the real thing: an Aadhaar number, a PAN, a phone number, a bank account number.
  const AADHAAR = '2345 6789 0123';
  const PAN = 'ABCDE1234F';
  const PHONE = '+91 98765 43210';
  const ACCOUNT = '50100123456789';
  const ADDRESS = 'seller@example.com';

  it('is never the record’s words for a value, however they are written', () => {
    // What a scrub by pattern let through: a number spaced with dashes, digits in Devanagari and in Kannada, a PAN with spaces, a phone number in brackets, a person’s name.
    const words = ['1234 - 5678 - 9012', '१२३४ ५६७८ ९०१२', '೧೨೩೪೫೬೭೮೯೦೧೨', 'ABCDE 1234 F', '(080) 2345 6789', 'Seller Person Name', AADHAAR, PAN, PHONE, ACCOUNT, ADDRESS];
    const project = fresh();
    const dropped = applyProjectChat(project, '', {
      ingest: [
        paper(
          // Values under keys of the paper's own, each with one of those as its label.
          ...words.map((label, at) => ({ ...fact(`own_key_${at}`, 'stated'), label })),
          // And a value under a key on the fixed list, which the paper labels in words of its own.
          { ...fact('extent_khata', 11850), label: 'Seller Person Name, (080) 2345 6789' },
        ),
      ],
    });
    for (const turn of [dropped.userTurn, dropped.assistantTurn]) turn.actor = VALUER;
    const row = filedRow(project);
    reviewFacts(project, row.id, 'all', 'accept', VALUER);

    const { entries } = memoryDelta(project, {});
    const accepted = ofKind(entries, 'value_accepted');
    assert.equal(accepted.length, words.length + 1, 'every value accepted is told');
    const kept = JSON.stringify(entries);
    for (const word of words) assert.ok(!kept.includes(word), `${word} is not in memory`);
    assert.deepEqual(
      accepted.filter((entry) => entry.label !== undefined).map((entry) => [entry.key, entry.label]),
      [['extent_khata', STANDARD_FACT_KEYS.extent_khata!.label]],
      'the one label kept is the fixed list’s name for the one key that is on it',
    );
  });

  it('holds nothing of what was said, read or filed, whatever the record holds', () => {
    const project = fresh();
    const said = `Is ${PAN} the seller, reachable on ${PHONE}?`;
    const dropped = applyProjectChat(project, said, {
      ingest: [paper({ ...fact('owner_aadhaar', AADHAAR), label: `Aadhaar ${AADHAAR} of ${ADDRESS}`, quote: `Account ${ACCOUNT}` })],
    });
    for (const turn of [dropped.userTurn, dropped.assistantTurn]) {
      turn.actor = ADDRESS;
      turn.place = { pane: 'evidence', department: `legal ${PHONE}`, fn: ADDRESS };
    }
    dropped.assistantTurn.citedNodeIds = [
      `${project.id}::member::${ADDRESS}`,
      `${project.id}::title::node-party-a-seller-by-name-1a2b3c4d`,
      `not an id ${PHONE}`,
      ADDRESS,
      `${project.id}::evidence::kept`,
    ];
    const row = filedRow(project);
    reviewFacts(project, row.id, 'all', 'accept', ADDRESS);

    const { entries } = memoryDelta(project, {});
    const kept = JSON.stringify(entries);
    for (const secret of [AADHAAR, PAN, PHONE, ACCOUNT, ADDRESS, '@', said, 'reachable', 'a-seller-by-name', 'Certificate-scan.pdf', 'A certificate for the parcel', row.title, project.name]) {
      assert.ok(!kept.includes(secret), `${secret} is not in memory`);
    }
    const spoken = dropped.assistantTurn.text.split(/\s+/).filter((word) => word.length > 6).slice(0, 3);
    assert.ok(spoken.length > 0 && spoken.every((word) => !kept.includes(word)), 'nor is what was answered');
    for (const turn of entries.filter((entry) => entry.kind === 'chat_asked' || entry.kind === 'chat_answered')) {
      assert.equal(turn.label, undefined, 'a chat turn has no label: there is nothing of it to name but its words');
    }
    assert.deepEqual([only(entries, 'value_accepted').key, only(entries, 'value_accepted').label], [undefined, undefined], 'a value under a key of the paper’s own has no label');
    const answer = only(entries, 'chat_answered');
    assert.deepEqual(answer.place, { pane: 'evidence' }, 'a place is the words the product has for one');
    assert.ok(answer.about.includes(`${project.id}::member::${memWho(project.id, ADDRESS)}`), 'a person cited is kept as who they are, without the address');
    assert.equal(answer.about.filter((id) => new RegExp(`^${project.id}::title::ref_[0-9a-f]{14}$`).test(id)).length, 1, 'a name read off a paper is kept as a token for it');
    assert.equal(memPointer(project.id, `${project.id}::title::node-party-a-seller-by-name-1a2b3c4d`), answer.about.find((id) => id.includes('::title::')), 'the same id always gives the same pointer');
    assert.ok(answer.about.includes(`${project.id}::evidence::kept`));
    assert.ok(answer.about.every((id) => !/\s/.test(id)), 'what is not an id is not kept');
    assert.deepEqual(scrubMemEntry(project.id, answer), answer, 'and an entry scrubbed again is the same entry');
    for (const entry of entries) {
      assert.deepEqual(
        Object.keys(entry).filter((key) => !['id', 'kind', 'at', 'by', 'sourceId', 'about', 'key', 'label', 'place'].includes(key)),
        [],
        'an entry has its own properties and no others',
      );
    }
  });

  it('is scrubbed again on the way into a store, whoever made the entry', () => {
    const projectId = 'prj_one';
    const entry = {
      id: `${projectId}::mem::aud_1`,
      kind: 'value_accepted',
      at: '2026-09-06T06:00:00.000Z',
      by: ADDRESS,
      sourceId: 'aud_1',
      about: ['ev_1', ADDRESS, 'ev_1', 7, `two words`],
      key: 'extent_khata',
      label: `Account ${ACCOUNT}`,
      place: { pane: 'evidence', stage: 'not a stage!', department: 'Seller Person Name', fn: '9876543210' },
      text: said(),
      quote: 'what the page says',
    } as unknown as MemEntry;
    assert.deepEqual(scrubMemEntry(projectId, entry), {
      id: `${projectId}::mem::aud_1`,
      kind: 'value_accepted',
      at: '2026-09-06T06:00:00.000Z',
      by: memWho(projectId, ADDRESS),
      sourceId: 'aud_1',
      about: ['ev_1'],
      key: 'extent_khata',
      label: STANDARD_FACT_KEYS.extent_khata!.label,
      place: { pane: 'evidence' },
    }, 'the label is the list’s whatever the caller wrote, and a place is the menu’s words or nothing');
    for (const key of ['made_up_key', 'constructor', 'Seller Person Name', 7]) {
      const clean = scrubMemEntry(projectId, { ...entry, key } as unknown as MemEntry)!;
      assert.deepEqual([clean.key, clean.label], [undefined, undefined], `${String(key)} is not a key on the list, and takes its label with it`);
    }
    assert.deepEqual(
      scrubMemEntry(projectId, { ...entry, place: { pane: 'evidence', department: 'legal', stage: 'pre_development' } })!.place,
      { pane: 'evidence', department: 'legal', stage: 'pre_development' },
    );
    assert.equal(scrubMemEntry(projectId, { ...entry, place: { pane: 'Seller Person Name' } })!.place, undefined, 'a pane is one of the product’s panes');

    assert.equal(scrubMemEntry('prj_other', entry), undefined, 'an entry of another project is not this one\'s to write');
    assert.equal(scrubMemEntry(projectId, { ...entry, kind: 'page_text' as MemEntryKind }), undefined, 'nor a kind memory does not have');
    assert.equal(scrubMemEntry(projectId, { ...entry, at: 'yesterday' }), undefined);
    assert.equal(scrubMemEntry(projectId, { ...entry, sourceId: ADDRESS }), undefined);

    function said(): string {
      return 'what somebody typed';
    }
  });

  it('names a person the same way every time on one project, and differently on another', () => {
    assert.equal(memWho('prj_one', 'Valuer@Example.com '), memWho('prj_one', VALUER));
    assert.notEqual(memWho('prj_one', VALUER), memWho('prj_two', VALUER));
    assert.notEqual(memWho('prj_one', VALUER), memWho('prj_one', LEAD));
    assert.match(memWho('prj_one', VALUER), /^who_[0-9a-f]{14}$/);
  });
});

describe('the shape memory is told in', () => {
  /*
   * A record written out by hand, and the entries this schema tells of it,
   * written out by hand. An entry is created once and never rewritten, so
   * whichever build tells an event first has told it for good. If this test
   * fails, the rule now tells the same record differently: raise MEM_SCHEMA
   * with the change, and only then change what is expected here.
   */
  it(`is the one schema ${MEM_SCHEMA} was pinned to`, () => {
    assert.equal(MEM_SCHEMA, 6);
    const project = createProject({ name: 'Pinned plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-PIN');
    project.id = 'prj_pinned';
    const row = addEvidence(project, { title: 'Khata certificate', kind: 'document' }, LEAD);
    row.id = 'ev_1';
    row.readMethod = 'text';
    row.facts = [{ key: 'extent_khata', label: 'Extent per khata', value: 11850, display: '11,850 sq ft', page: 1, quote: 'Extent: 11,850 sq ft' }];
    project.audit = [
      { id: 'aud_1', at: '2026-10-01T09:00:00.000Z', actor: LEAD, action: 'create', entityType: 'evidence', entityId: 'ev_1' },
      { id: 'aud_2', at: '2026-10-01T09:05:00.000Z', actor: VALUER, action: 'accept_fact', entityType: 'evidence', entityId: 'ev_1', newValue: 'Extent per khata: 11,850 sq ft' },
      { id: 'aud_3', at: '2026-10-01T09:10:00.000Z', actor: LEAD, action: 'create', entityType: 'finding', entityId: 'fnd_1' },
      { id: 'aud_4', at: '2026-10-01T09:15:00.000Z', actor: LEAD, action: 'patch', entityType: 'project', entityId: 'prj_pinned', newValue: 'revenueMap kgis:2003010043:10' },
      { id: 'aud_5', at: '2026-10-01T09:20:00.000Z', actor: LEAD, action: 'undo', entityType: 'project', entityId: 'prj_pinned', oldValue: 'the last change' },
      { id: 'aud_6', at: '2026-10-01T09:22:00.000Z', actor: LEAD, action: 'patch', entityType: 'project', entityId: 'prj_pinned', newValue: 'revenueMap kgis:1:10' },
      // The notes of a meeting kept, and a report issued. A report made or edited is not told.
      { id: 'aud_7', at: '2026-10-01T09:23:00.000Z', actor: LEAD, action: 'create', entityType: 'meeting', entityId: 'mtg_1', newValue: 'Site meeting' },
      { id: 'aud_8', at: '2026-10-01T09:24:00.000Z', actor: LEAD, action: 'generate_report', entityType: 'report', entityId: 'rep_1', newValue: 'status' },
      { id: 'aud_9', at: '2026-10-01T09:24:30.000Z', actor: LEAD, action: 'issue_report', entityType: 'report', entityId: 'rep_1', newValue: 'issued' },
      // An action closed and a decision settled. A change of standing that is neither is not told.
      { id: 'aud_10', at: '2026-10-01T09:24:40.000Z', actor: LEAD, action: 'status_change', entityType: 'action', entityId: 'act_1', oldValue: 'not_started', newValue: 'in_progress' },
      { id: 'aud_11', at: '2026-10-01T09:24:45.000Z', actor: LEAD, action: 'status_change', entityType: 'action', entityId: 'act_1', oldValue: 'in_progress', newValue: 'closed' },
      { id: 'aud_12', at: '2026-10-01T09:24:50.000Z', actor: VALUER, action: 'status_change', entityType: 'decision', entityId: 'dec_1', oldValue: 'pending', newValue: 'approved' },
      // What the newer parts of the product do, as each writes it on the trail. The words beside each are the record's, and none is kept.
      { id: 'aud_13', at: '2026-10-02T09:00:00.000Z', actor: LEAD, action: 'voice_note', entityType: 'voice_note', entityId: 'note_1.ogg', newValue: 'Put into words; a site entry proposed' },
      { id: 'aud_14', at: '2026-10-02T09:01:00.000Z', actor: LEAD, action: 'site_log', entityType: 'site_log', entityId: 'log_1', newValue: '2026-10-02: Shuttering for the slab' },
      { id: 'aud_15', at: '2026-10-02T09:02:00.000Z', actor: LEAD, action: 'review_run', entityType: 'review_table', entityId: 'rr_1', newValue: '1 paper, 1 question', reason: 'the pages kept were searched: no model is set up' },
      { id: 'aud_16', at: '2026-10-02T09:03:00.000Z', actor: LEAD, action: 'review_run_stopped', entityType: 'review_table', entityId: 'rr_1', newValue: '0 of 1 paper' },
      { id: 'aud_17', at: '2026-10-02T09:04:00.000Z', actor: VALUER, action: 'review_row_reviewed', entityType: 'evidence', entityId: 'ev_1', newValue: 'reviewed' },
      { id: 'aud_18', at: '2026-10-02T09:05:00.000Z', actor: VALUER, action: 'review_row_unmarked', entityType: 'evidence', entityId: 'ev_1', oldValue: 'reviewed by valuer@example.com' },
      { id: 'aud_19', at: '2026-10-02T09:06:00.000Z', actor: LEAD, action: 'outgoing_drafted', entityType: 'outgoing', entityId: 'out_1', newValue: 'Letter: The earlier deed' },
      { id: 'aud_20', at: '2026-10-02T09:07:00.000Z', actor: VALUER, action: 'outgoing_approved', entityType: 'outgoing', entityId: 'out_1', oldValue: 'draft', newValue: 'approved' },
      { id: 'aud_21', at: '2026-10-02T09:08:00.000Z', actor: LEAD, action: 'outgoing_exported', entityType: 'outgoing', entityId: 'out_1', newValue: 'approved' },
      { id: 'aud_22', at: '2026-10-02T09:09:00.000Z', actor: LEAD, action: 'outgoing_reopened', entityType: 'outgoing', entityId: 'out_1', oldValue: 'approved by valuer@example.com', newValue: 'draft', reason: 'approval taken back' },
      { id: 'aud_23', at: '2026-10-02T09:10:00.000Z', actor: LEAD, action: 'outgoing_removed', entityType: 'outgoing', entityId: 'out_1', oldValue: 'Letter: The earlier deed' },
      { id: 'aud_24', at: '2026-10-02T09:11:00.000Z', actor: LEAD, action: 'questionnaire_added', entityType: 'questionnaire', entityId: 'qnr_1', newValue: 'Lender’s questions · 2 question(s)' },
      { id: 'aud_25', at: '2026-10-02T09:12:00.000Z', actor: LEAD, action: 'answers_suggested', entityType: 'questionnaire', entityId: 'qnr_1', newValue: '1 answer(s)' },
      { id: 'aud_26', at: '2026-10-02T09:13:00.000Z', actor: VALUER, action: 'answers_confirmed', entityType: 'questionnaire', entityId: 'qnr_1', newValue: '1 answer(s)' },
      { id: 'aud_27', at: '2026-10-02T09:14:00.000Z', actor: VALUER, action: 'question_answered', entityType: 'questionnaire', entityId: 'q_2', newValue: 'A Person' },
      // An answer cleared, a question added and a questionnaire removed are not told.
      { id: 'aud_28', at: '2026-10-02T09:15:00.000Z', actor: VALUER, action: 'question_answered', entityType: 'questionnaire', entityId: 'q_2', newValue: '(cleared)' },
      { id: 'aud_29', at: '2026-10-02T09:16:00.000Z', actor: LEAD, action: 'question_added', entityType: 'questionnaire', entityId: 'q_3', newValue: 'Who is the architect?' },
    ];
    project.conversation = [
      { id: 'cht_1', role: 'user', text: 'What does the khata say?', at: '2026-10-01T09:25:00.000Z', actor: VALUER, place: { pane: 'evidence', stage: 'pre_development' }, citedEvidenceIds: ['ev_1'] },
      // Two work-pane notes: one that names who wrote, one that does not.
      { id: 'cht_2', role: 'user', text: 'Filed the revenue-map read as evidence.', at: '2026-10-01T09:30:00.000Z', actor: LEAD, citedEvidenceIds: ['ev_1'] },
      { id: 'cht_3', role: 'assistant', text: 'Recorded.', at: '2026-10-01T09:30:00.000Z', actor: LEAD, citedEvidenceIds: ['ev_1'], toolCalls: [{ name: 'pane_write', summary: 'Filed the revenue-map read as evidence.' }] },
      { id: 'cht_4', role: 'user', text: 'Added a comparable.', at: '2026-10-01T09:35:00.000Z', citedEvidenceIds: [] },
      { id: 'cht_5', role: 'assistant', text: 'Recorded.', at: '2026-10-01T09:35:00.000Z', citedEvidenceIds: [], toolCalls: [{ name: 'pane_write', summary: 'Added a comparable.' }] },
    ];

    assert.deepEqual(memoryDelta(project, {}), {
      projectId: 'prj_pinned',
      entries: [
        { id: 'prj_pinned::mem::aud_1', kind: 'paper_filed', at: '2026-10-01T09:00:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_1', about: ['ev_1'] },
        { id: 'prj_pinned::mem::ev_1', kind: 'paper_read', at: '2026-10-01T09:00:00.000Z', by: 'who_0d97ea4d1cf009', sourceId: 'ev_1', about: ['ev_1'] },
        { id: 'prj_pinned::mem::aud_2', kind: 'value_accepted', at: '2026-10-01T09:05:00.000Z', by: 'who_1444ecd6141d3b', sourceId: 'aud_2', about: ['ev_1'], key: 'extent_khata', label: 'Extent per khata' },
        { id: 'prj_pinned::mem::aud_3', kind: 'finding_raised', at: '2026-10-01T09:10:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_3', about: ['fnd_1'] },
        { id: 'prj_pinned::mem::aud_4', kind: 'map_read_kept', at: '2026-10-01T09:15:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_4', about: ['kgis:2003010043:10'] },
        { id: 'prj_pinned::mem::aud_5', kind: 'undone', at: '2026-10-01T09:20:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_5', about: [] },
        { id: 'prj_pinned::mem::aud_6', kind: 'map_read_kept', at: '2026-10-01T09:22:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_6', about: [] },
        { id: 'prj_pinned::mem::aud_7', kind: 'meeting_kept', at: '2026-10-01T09:23:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_7', about: ['mtg_1'] },
        { id: 'prj_pinned::mem::aud_9', kind: 'report_issued', at: '2026-10-01T09:24:30.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_9', about: ['rep_1'] },
        { id: 'prj_pinned::mem::aud_11', kind: 'action_closed', at: '2026-10-01T09:24:45.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_11', about: ['act_1'] },
        { id: 'prj_pinned::mem::aud_12', kind: 'decision_settled', at: '2026-10-01T09:24:50.000Z', by: 'who_1444ecd6141d3b', sourceId: 'aud_12', about: ['dec_1'] },
        { id: 'prj_pinned::mem::aud_13', kind: 'voice_note_kept', at: '2026-10-02T09:00:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_13', about: ['note_1.ogg'] },
        { id: 'prj_pinned::mem::aud_14', kind: 'site_entry_logged', at: '2026-10-02T09:01:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_14', about: ['log_1'] },
        { id: 'prj_pinned::mem::aud_15', kind: 'review_run_started', at: '2026-10-02T09:02:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_15', about: ['rr_1'] },
        { id: 'prj_pinned::mem::aud_16', kind: 'review_run_stopped', at: '2026-10-02T09:03:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_16', about: ['rr_1'] },
        { id: 'prj_pinned::mem::aud_17', kind: 'paper_reviewed', at: '2026-10-02T09:04:00.000Z', by: 'who_1444ecd6141d3b', sourceId: 'aud_17', about: ['ev_1'] },
        { id: 'prj_pinned::mem::aud_18', kind: 'paper_review_unmarked', at: '2026-10-02T09:05:00.000Z', by: 'who_1444ecd6141d3b', sourceId: 'aud_18', about: ['ev_1'] },
        { id: 'prj_pinned::mem::aud_19', kind: 'outgoing_drafted', at: '2026-10-02T09:06:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_19', about: ['out_1'] },
        { id: 'prj_pinned::mem::aud_20', kind: 'outgoing_approved', at: '2026-10-02T09:07:00.000Z', by: 'who_1444ecd6141d3b', sourceId: 'aud_20', about: ['out_1'] },
        { id: 'prj_pinned::mem::aud_21', kind: 'outgoing_exported', at: '2026-10-02T09:08:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_21', about: ['out_1'] },
        { id: 'prj_pinned::mem::aud_22', kind: 'outgoing_reopened', at: '2026-10-02T09:09:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_22', about: ['out_1'] },
        { id: 'prj_pinned::mem::aud_23', kind: 'outgoing_removed', at: '2026-10-02T09:10:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_23', about: ['out_1'] },
        { id: 'prj_pinned::mem::aud_24', kind: 'questionnaire_added', at: '2026-10-02T09:11:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_24', about: ['qnr_1'] },
        { id: 'prj_pinned::mem::aud_25', kind: 'answers_suggested', at: '2026-10-02T09:12:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_25', about: ['qnr_1'] },
        { id: 'prj_pinned::mem::aud_26', kind: 'answers_confirmed', at: '2026-10-02T09:13:00.000Z', by: 'who_1444ecd6141d3b', sourceId: 'aud_26', about: ['qnr_1'] },
        { id: 'prj_pinned::mem::aud_27', kind: 'question_answered', at: '2026-10-02T09:14:00.000Z', by: 'who_1444ecd6141d3b', sourceId: 'aud_27', about: ['q_2'] },
        { id: 'prj_pinned::mem::cht_1', kind: 'chat_asked', at: '2026-10-01T09:25:00.000Z', by: 'who_1444ecd6141d3b', sourceId: 'cht_1', about: ['ev_1'], place: { pane: 'evidence', stage: 'pre_development' } },
        { id: 'prj_pinned::mem::cht_2', kind: 'edit_noted', at: '2026-10-01T09:30:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'cht_2', about: ['ev_1'] },
        { id: 'prj_pinned::mem::cht_4', kind: 'edit_noted', at: '2026-10-01T09:35:00.000Z', by: 'who_1995cea6e537b6', sourceId: 'cht_4', about: [] },
      ],
      through: { schema: 6, auditThrough: 'aud_29', turnThrough: 'cht_5' },
    });
  });
});
