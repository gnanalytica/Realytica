/**
 * Values are decided where they land, one at a time.
 *
 * An upload used to put a card in the chat for every document, and a second
 * card for every check the document could fill, and the person approved them
 * there — a click that filed their own file, and a second click that accepted
 * a value they could not see beside its page. Now the document is filed as it
 * arrives, what it states waits on its row value by value, and accepting a
 * value there records it on the check it answers. The chat only talks.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acceptWaiting,
  acceptedFacts,
  applyProjectChat,
  createAssessment,
  createChatProposal,
  createProject,
  decideCheckFields,
  liveFacts,
  pickCheckValue,
  proposeFacts,
  proposedFacts,
  reviewFacts,
  setAsideWaiting,
  waitingOnCanvas,
  waitingOnCheck,
  type ChatIngestFile,
  type DdProject,
  type DocumentFact,
} from '@realytica/shared';

const project = (): DdProject =>
  createProject({ name: 'Dream Acres', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-C1');

const fact = (key: string, value: string | number, display = String(value), page = 1): DocumentFact => ({
  key,
  label: key.replaceAll('_', ' '),
  value,
  display,
  page,
  quote: `${key}: ${display}`,
});

const khata = (...facts: DocumentFact[]): ChatIngestFile => ({
  fileName: 'Khata.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  storageKey: 's3://khata',
  read: {
    type: 'khata',
    label: 'Khata certificate',
    confidence: 0.9,
    method: 'text',
    summary: 'Khata certificate for the parcel.',
    facts,
    flags: [],
    rowHints: [],
    scopes: [],
    evidenceKind: 'document',
  },
});

/** A project with the acquisition DD running, and a khata just dropped in. */
function uploaded(...facts: DocumentFact[]) {
  const p = project();
  createAssessment(p, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
  const result = applyProjectChat(p, '', { ingest: [khata(...facts)] });
  const row = p.evidence.find((e) => e.attachments.some((a) => a.storageKey === 's3://khata'))!;
  const parcel = p.assessments[0]!.scopes.flatMap((s) => s.checks).find((c) => c.title.startsWith('Parcel identification'))!;
  const card = p.chatProposals.find((c) => c.kind === 'record_check_fields' && c.payload.checkId === parcel.id);
  return { p, result, row, parcel, card };
}

describe('an upload', () => {
  it('files the document at once, with what it states waiting on its row', () => {
    const { p, row, card } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    assert.ok(row, 'filed without anybody approving it');
    assert.equal(proposedFacts(row).length, 1);
    assert.equal(acceptedFacts(row).length, 0, 'nothing it states is on the file yet');
    assert.equal(liveFacts(row).length, 1, 'but it is what the document says, as far as anybody knows');
    assert.equal(card?.status, 'proposed', 'the check it answers waits for the same value');
    assert.ok(p.chatProposals.every((c) => c.kind !== 'file_evidence' || c.status === 'committed'));
  });

  it('is counted where it waits: the value on the document, the field on the check', () => {
    const { p, row } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    const waiting = waitingOnCanvas(p);
    assert.equal(waiting.byPane.evidence, 1);
    assert.equal(waiting.byPane.scope, 1);
    assert.equal(waiting.total, 2);
    assert.equal(waiting.entries[0]!.kind, 'facts', 'documents come first: everything else is read from them');
    assert.equal(waiting.entries[0]!.evidenceId, row.id);
  });
});

describe('accepting a value on a document', () => {
  it('records it on the check it answers, citing the page', () => {
    const { p, row, parcel, card } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    reviewFacts(p, row.id, ['extent_khata'], 'accept', 'tester');

    assert.equal(acceptedFacts(row).length, 1);
    const field = parcel.fields?.extent_khata;
    assert.equal(field?.value, 11850);
    assert.equal(field?.sourceEvidenceId, row.id);
    assert.equal(field?.page, 1);
    assert.match(field?.quote ?? '', /11,850/);
    assert.equal(card?.status, 'committed', 'one decision, made once');
    assert.equal(waitingOnCanvas(p).total, 0);
    assert.ok(p.audit.some((a) => a.action === 'accept_fact' && a.entityId === row.id));
  });

  it('keeps the page’s own reading when a person corrects it', () => {
    const { p, row, parcel } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    reviewFacts(p, row.id, ['extent_khata'], 'accept', 'tester', { value: 11800, display: '11,800 sq ft' });

    const [accepted] = acceptedFacts(row);
    assert.equal(accepted?.value, 11800);
    assert.equal(accepted?.edited, true);
    assert.deepEqual(accepted?.readAs, { value: 11850, display: '11,850 sq ft' });
    assert.equal(parcel.fields?.extent_khata?.value, 11800, 'the check holds the person’s figure');
    assert.equal(parcel.fields?.extent_khata?.quote, undefined, 'and no quote that says otherwise');
    assert.ok(p.audit.some((a) => a.action === 'accept_fact_corrected'));

    reviewFacts(p, row.id, ['extent_khata'], 'reopen', 'tester');
    const [back] = proposedFacts(row);
    assert.equal(back?.value, 11850, 'reopening puts the page’s reading back');
    assert.equal(back?.readAs, undefined);
  });

  it('sets the check value aside with it', () => {
    const { p, row, parcel, card } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    reviewFacts(p, row.id, 'all', 'reject', 'tester');

    assert.equal(liveFacts(row).length, 0, 'a value set aside is not what the document says');
    assert.equal(card?.status, 'rejected');
    assert.equal(parcel.fields?.extent_khata, undefined);
    assert.equal(waitingOnCanvas(p).total, 0);
  });

  it('does not decide a different field that happens to hold the same value', () => {
    const { p, row, card } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'), fact('extent_title', 11850, '11,850 sq ft'));
    assert.deepEqual(Object.keys(card!.payload.values as object).sort(), ['extent_khata', 'extent_title']);
    reviewFacts(p, row.id, ['extent_khata'], 'accept', 'tester');
    assert.deepEqual(card!.payload.decided, { extent_khata: 'accepted' });
    assert.equal(card!.status, 'proposed', 'the title extent still waits for its own decision');
  });
});

describe('a check’s values', () => {
  it('are decided one field at a time, and the card closes when the last one is', () => {
    const { p, parcel, card } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'), fact('survey_numbers', '118/2'));
    decideCheckFields(p, card!.id, ['survey_numbers'], 'accept', 'tester');
    assert.equal(parcel.fields?.survey_numbers?.value, '118/2');
    assert.equal(parcel.fields?.extent_khata, undefined, 'only what was accepted');
    assert.equal(card!.status, 'proposed');
    assert.equal(waitingOnCanvas(p).byPane.scope, 1);

    decideCheckFields(p, card!.id, ['extent_khata'], 'reject', 'tester');
    assert.equal(card!.status, 'committed', 'one value was accepted, so the card reads as filed');
    assert.equal(parcel.fields?.extent_khata, undefined);
  });

  it('accepted on the check, are accepted on the document they were read from', () => {
    const { p, row, card } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'), fact('survey_numbers', '118/2'));
    decideCheckFields(p, card!.id, ['extent_khata'], 'accept', 'tester');
    assert.deepEqual(acceptedFacts(row).map((f) => f.key), ['extent_khata'], 'the same value is not asked about twice');
    decideCheckFields(p, card!.id, ['survey_numbers'], 'reject', 'tester');
    assert.deepEqual(proposedFacts(row).map((f) => f.key), ['survey_numbers'], 'setting it aside on a check says nothing about the page');
    assert.equal(waitingOnCanvas(p).byPane.evidence, 1);
  });

  it('refuse a decision twice', () => {
    const { p, card } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    decideCheckFields(p, card!.id, ['extent_khata'], 'reject', 'tester');
    assert.equal(card!.status, 'rejected');
    assert.throws(() => decideCheckFields(p, card!.id, ['extent_khata'], 'accept', 'tester'), /already decided/);
  });
});

describe('a newer reading of the same document', () => {
  it('waits beside the accepted value, which stays in force until the new one is accepted', () => {
    const accepted = { ...fact('extent_khata', 11850), review: 'accepted' as const };
    const same = proposeFacts([accepted], [fact('extent_khata', 11850)]);
    assert.equal(same.length, 1, 'the page still says it: nothing to ask again');

    const facts = proposeFacts([accepted], [fact('extent_khata', 11900)]);
    assert.equal(facts.length, 2);
    assert.deepEqual(acceptedFacts({ facts }).map((f) => f.value), [11850]);
    assert.deepEqual(proposedFacts({ facts }).map((f) => f.value), [11900]);
  });

  it('replaces the old value when accepted, and gives it back when reopened', () => {
    const { p, row } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    reviewFacts(p, row.id, 'all', 'accept', 'tester');
    row.facts = proposeFacts(row.facts ?? [], [fact('extent_khata', 11900, '11,900 sq ft')]);

    reviewFacts(p, row.id, 'all', 'accept', 'tester');
    assert.deepEqual(acceptedFacts(row).map((f) => f.value), [11900]);
    assert.equal(acceptedFacts(row)[0]!.replaced?.value, 11850);

    reviewFacts(p, row.id, ['extent_khata'], 'reopen', 'tester');
    assert.deepEqual(acceptedFacts(row).map((f) => f.value), [11850], 'the older reading is in force again');
    assert.deepEqual(proposedFacts(row).map((f) => f.value), [11900]);
  });
});

describe('anything else waiting', () => {
  it('starts a DD where it waits, and offers it the values already accepted', () => {
    const p = project();
    applyProjectChat(p, '', { ingest: [khata(fact('extent_khata', 11850, '11,850 sq ft'))] });
    const row = p.evidence.find((e) => e.attachments.length)!;
    reviewFacts(p, row.id, 'all', 'accept', 'tester');
    const dd = p.chatProposals.find((c) => c.kind === 'start_dd' && c.status === 'proposed')!;
    assert.ok(dd, 'the DD the khata answers is waiting under Technical DD');

    const { offered } = acceptWaiting(p, dd.id, 'tester');
    assert.equal(p.assessments.length, 1);
    assert.ok(offered.some((c) => c.kind === 'record_check_fields'), 'the accepted extent is offered to the new check');
    assert.ok(p.audit.some((a) => a.action === 'accept_proposal' && a.entityId === dd.id));
  });

  it('can be set aside, and stays in the record decided', () => {
    const p = project();
    const card = createChatProposal('add_risk', 'Flood risk on the eastern boundary', 'Low-lying.', 'Logs a risk.', { title: 'Flood risk', description: 'Low-lying.', owner: 'tester' }, 'tester');
    p.chatProposals.push(card);
    assert.equal(waitingOnCanvas(p).byPane.risks, 1);
    setAsideWaiting(p, card.id, 'tester');
    assert.equal(card.status, 'rejected');
    assert.equal(waitingOnCanvas(p).total, 0);
    assert.ok(p.audit.some((a) => a.action === 'set_aside_proposal'));
  });
});

describe('"accept all" typed in the chat', () => {
  it('accepts what the last upload left waiting, values and checks together', () => {
    const { p, row, parcel } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    const done = applyProjectChat(p, 'approve all');
    assert.equal(acceptedFacts(row).length, 1);
    assert.equal(parcel.fields?.extent_khata?.value, 11850);
    assert.match(done.assistantTurn.text, /Accepted 1 value on 1 document/);
    const after = waitingOnCanvas(p);
    assert.equal(after.byPane.evidence ?? 0, 0);
    assert.equal(after.byPane.scope ?? 0, 0);
    assert.ok(after.total <= 1, 'at most the one next step it offers');
  });
});

/** A second document stating the same field differently, dropped onto the same project. */
function deed(value: number): ChatIngestFile {
  return {
    ...khata(fact('extent_khata', value, `${value.toLocaleString('en-IN')} sq ft`, 2)),
    fileName: `Khata_${value}.pdf`,
    storageKey: `s3://khata-${value}`,
  };
}

describe('documents that disagree about a check', () => {
  it('are both offered, and the check says they disagree', () => {
    const { p, parcel } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    applyProjectChat(p, '', { ingest: [deed(11900)] });
    const waiting = waitingOnCheck(p, parcel.id);
    const field = waiting.fields.find((f) => f.key === 'extent_khata')!;
    assert.deepEqual(field.values.map((v) => v.value).sort(), [11850, 11900]);
    assert.equal(field.disagree, true);
    assert.equal(field.values[0]!.source, 'Khata certificate', 'each value names the document it was read from');
  });

  it('never let the last document accepted overwrite the other', () => {
    const { p, parcel } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    applyProjectChat(p, '', { ingest: [deed(11900)] });
    const second = p.evidence.find((e) => e.attachments.some((a) => a.storageKey === 's3://khata-11900'))!;
    reviewFacts(p, second.id, 'all', 'accept', 'tester');
    assert.equal(acceptedFacts(second).length, 1, 'the document still states what it states');
    assert.equal(parcel.fields?.extent_khata, undefined, 'but the check waits for a person to pick');
    assert.equal(waitingOnCheck(p, parcel.id).fields[0]?.disagree, true);
  });

  it('carry the value a person picks, and set the other aside', () => {
    const { p, parcel } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    applyProjectChat(p, '', { ingest: [deed(11900)] });
    const field = waitingOnCheck(p, parcel.id).fields[0]!;
    const chosen = field.values.find((v) => v.value === 11900)!;
    pickCheckValue(p, parcel.id, 'extent_khata', chosen.proposalId, 'tester');
    assert.equal(parcel.fields?.extent_khata?.value, 11900);
    assert.equal(waitingOnCheck(p, parcel.id).fields.length, 0, 'nothing left to settle');
  });

  it('can keep neither, leaving the field as it was', () => {
    const { p, parcel } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    applyProjectChat(p, '', { ingest: [deed(11900)] });
    pickCheckValue(p, parcel.id, 'extent_khata', null, 'tester');
    assert.equal(parcel.fields?.extent_khata, undefined);
    assert.equal(waitingOnCheck(p, parcel.id).fields.length, 0);
  });
});

describe('"accept all" over documents that disagree', () => {
  it('accepts what they state, and leaves the choice between them on the check', () => {
    const { p, parcel } = uploaded(fact('extent_khata', 11850, '11,850 sq ft'));
    applyProjectChat(p, '', { ingest: [deed(11900)] });
    const done = applyProjectChat(p, 'accept all', { actor: 'tester' });
    assert.equal(parcel.fields?.extent_khata, undefined, 'neither value wins by being accepted last');
    const field = waitingOnCheck(p, parcel.id).fields.find((f) => f.key === 'extent_khata');
    assert.equal(field?.values.length, 2);
    assert.match(done.assistantTurn.text, /disagree on waits? on the checks for you to pick/);
  });
});
