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
 * the whole. A chat turn is told once it has its author, and not before.
 * Memory written in a higher shape is left alone, and one written in a lower
 * shape is told again whole. A copy of the project that does not hold what
 * memory was last told from tells nothing, and a record that has lost the
 * chats lets go of their entries. And no word of the record's gets into an
 * entry: not from a chat or a page, not a file name, a value, a name, an
 * email, or an identity, phone or account number however it is written. The
 * only words in an entry are the product's own, for a value's key and for a
 * page. The last test pins the shape itself, so that a change to what is
 * told is made with the schema and not beside it.
 *
 * The stores' side of the same rules is in `mem-sync.test.ts` and
 * `mem-neo4j-statements.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MEM_CHAT_KINDS,
  MEM_ENTRY_KINDS,
  MEM_SCHEMA,
  MEM_TURN_WAIT_MS,
  STANDARD_FACT_KEYS,
  addAction,
  addEvidence,
  addDecision,
  addFinding,
  applyProjectChat,
  applyRevenueMap,
  clearProjectConversation,
  clearRevenueMap,
  createAssessment,
  createProject,
  memPointer,
  memWho,
  memoryDelta,
  memoryReplay,
  recordAuditEvent,
  removeRevenueMapRead,
  reviewFacts,
  sameMemWatermark,
  scrubMemEntry,
  type ChatIngestFile,
  type DdProject,
  type DocumentFact,
  type MemEntry,
  type MemEntryKind,
  type RevenueMapRead,
} from '@realytica/shared';

const VALUER = 'valuer@example.com';
const LEAD = 'lead@example.com';

const fact = (key: string, value: string | number, display = String(value)): DocumentFact => ({
  key,
  label: key.replaceAll('_', ' '),
  value,
  display,
  page: 1,
  quote: `${key}: ${display}`,
});

/** A paper as the chat receives it, already read. */
const paper = (...facts: DocumentFact[]): ChatIngestFile => ({
  fileName: 'Certificate-scan.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  storageKey: 's3://certificate',
  read: {
    type: 'khata',
    label: 'Khata certificate',
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
  applyRevenueMap(project, mapRead('kgis:1:10', '2026-09-06T06:00:00.000Z'), LEAD);
  applyRevenueMap(project, mapRead('kgis:1:11', '2026-09-06T06:05:00.000Z'), LEAD);
  removeRevenueMapRead(project, 'kgis:1:11', LEAD);
  // An undo, as the route that makes one records it: what was put back is named in words, which memory does not keep.
  recordAuditEvent(project, { actor: LEAD, action: 'undo', entityType: 'project', entityId: project.id, oldValue: 'Accepted the extent' });
  const asked = ask(project, 'what is missing?', VALUER, { pane: 'evidence', department: 'legal', stage: 'pre_development' });
  return { project, row, decision, action, finding, dropped, asked };
}

const isChat = (entry: MemEntry): boolean => MEM_CHAT_KINDS.includes(entry.kind);

const ofKind = (entries: MemEntry[], kind: MemEntryKind): MemEntry[] => entries.filter((entry) => entry.kind === kind);

function only(entries: MemEntry[], kind: MemEntryKind): MemEntry {
  const found = ofKind(entries, kind);
  assert.equal(found.length, 1, `one ${kind} entry`);
  return found[0]!;
}

describe('what memory is told of a project', () => {
  it('is one entry for each event, told from the operation that records it', () => {
    const { project, row, decision, action, finding, asked } = lived();
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
    assert.equal(read.sourceId, row.id, 'a read has no audit event: it is told from the paper');
    assert.deepEqual(read.about, [row.id]);
    assert.equal(read.by, memWho(project.id, 'system'), 'the server read it, not a person');

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

    assert.deepEqual(only(entries, 'decision_recorded').about, [decision.id]);
    assert.deepEqual(only(entries, 'action_recorded').about, [action.id]);
    assert.deepEqual(only(entries, 'finding_raised').about, [finding.id]);
    assert.equal(only(entries, 'finding_raised').by, memWho(project.id, LEAD));

    assert.deepEqual(ofKind(entries, 'map_read_kept').map((entry) => entry.about), [['kgis:1:10'], ['kgis:1:11']], 'a map read points at its parcel');
    assert.deepEqual(only(entries, 'map_read_removed').about, ['kgis:1:11']);

    const undone = only(entries, 'undone');
    assert.equal(undone.sourceId, project.audit.find((event) => event.action === 'undo')!.id, 'an undo is an event of its own');
    assert.equal(undone.by, memWho(project.id, LEAD));
    assert.deepEqual([undone.about, undone.label], [[], undefined], 'and holds none of the words that say what was put back');

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

  it('tells every map read removed at once as one event with no parcel', () => {
    const project = fresh();
    applyRevenueMap(project, mapRead('kgis:1:10', '2026-09-06T06:00:00.000Z'), LEAD);
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
    assert.deepEqual(delta.entries.filter(isChat).map((entry) => entry.sourceId), [first.userTurn.id, first.assistantTurn.id]);
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
    assert.deepEqual(replay.forget, [...MEM_CHAT_KINDS], 'the entries of chat turns go before anything is written');
    assert.deepEqual(replay.entries.filter(isChat).map((entry) => entry.sourceId), [again.userTurn.id, again.assistantTurn.id]);
    assert.deepEqual(
      replay.entries.filter((entry) => !isChat(entry)),
      whole.entries.filter((entry) => !isChat(entry)),
      'and every other event is told again as it was',
    );
    assert.equal(replay.through.turnThrough, again.assistantTurn.id);
  });

  it('lets go of them when the chats are deleted and nothing is asked after', () => {
    const { project } = lived();
    const whole = memoryDelta(project, {});
    clearProjectConversation(project);
    const replay = memoryReplay(project, whole.through);
    assert.deepEqual(replay.forget, [...MEM_CHAT_KINDS]);
    assert.deepEqual(replay.entries.filter(isChat), []);
    assert.equal(replay.through.turnThrough, undefined, 'and memory stands at no turn');
  });

  it('lets go of nothing when it is an audit event it lost', () => {
    const { project } = lived();
    const whole = memoryDelta(project, {});
    const lost = structuredClone(project);
    lost.audit = lost.audit.slice(0, -1);
    const replay = memoryReplay(lost, whole.through);
    assert.equal(replay.forget, undefined, 'an event the record lost happened all the same');
    assert.equal(replay.entries.filter(isChat).length, whole.entries.filter(isChat).length);
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
    assert.equal(MEM_SCHEMA, 1);
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
      { id: 'aud_4', at: '2026-10-01T09:15:00.000Z', actor: LEAD, action: 'patch', entityType: 'project', entityId: 'prj_pinned', newValue: 'revenueMap kgis:1:10' },
      { id: 'aud_5', at: '2026-10-01T09:20:00.000Z', actor: LEAD, action: 'undo', entityType: 'project', entityId: 'prj_pinned', oldValue: 'the last change' },
    ];
    project.conversation = [
      { id: 'cht_1', role: 'user', text: 'What does the khata say?', at: '2026-10-01T09:25:00.000Z', actor: VALUER, place: { pane: 'evidence', stage: 'pre_development' }, citedEvidenceIds: ['ev_1'] },
    ];

    assert.deepEqual(memoryDelta(project, {}), {
      projectId: 'prj_pinned',
      entries: [
        { id: 'prj_pinned::mem::aud_1', kind: 'paper_filed', at: '2026-10-01T09:00:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_1', about: ['ev_1'] },
        { id: 'prj_pinned::mem::ev_1', kind: 'paper_read', at: '2026-10-01T09:00:00.000Z', by: 'who_0d97ea4d1cf009', sourceId: 'ev_1', about: ['ev_1'] },
        { id: 'prj_pinned::mem::aud_2', kind: 'value_accepted', at: '2026-10-01T09:05:00.000Z', by: 'who_1444ecd6141d3b', sourceId: 'aud_2', about: ['ev_1'], key: 'extent_khata', label: 'Extent per khata' },
        { id: 'prj_pinned::mem::aud_3', kind: 'finding_raised', at: '2026-10-01T09:10:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_3', about: ['fnd_1'] },
        { id: 'prj_pinned::mem::aud_4', kind: 'map_read_kept', at: '2026-10-01T09:15:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_4', about: ['kgis:1:10'] },
        { id: 'prj_pinned::mem::aud_5', kind: 'undone', at: '2026-10-01T09:20:00.000Z', by: 'who_1bc89fdc731661', sourceId: 'aud_5', about: [] },
        { id: 'prj_pinned::mem::cht_1', kind: 'chat_asked', at: '2026-10-01T09:25:00.000Z', by: 'who_1444ecd6141d3b', sourceId: 'cht_1', about: ['ev_1'], place: { pane: 'evidence', stage: 'pre_development' } },
      ],
      through: { schema: 1, auditThrough: 'aud_5', turnThrough: 'cht_1' },
    });
  });
});
