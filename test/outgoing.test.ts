/**
 * What goes out: a letter, a reply, a request for information, minutes.
 *
 * One test a rule. The sources of a draft are what counts on the record and
 * nothing that waits. A model's body is held to those sources, mark by mark.
 * Minutes are put together by code, and say what waits. A draft changes
 * nothing on the record. It is approved by name by a lead or a signer, a
 * change after that puts it back to draft, and the file says which it is.
 *
 * Everything here is invented: the land, the parties and the numbers.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OUTGOING_NOT_APPROVED,
  addDecision,
  addEvidence,
  addPaperPassages,
  approveOutgoing,
  asksForOutgoing,
  attachEvidenceFile,
  createProject,
  editOutgoing,
  keepMeeting,
  mayApproveOutgoing,
  noteOutgoingExported,
  outgoingAsked,
  outgoingBodyHeld,
  outgoingDocument,
  outgoingNeeds,
  outgoingSources,
  outgoingStatements,
  paperPassages,
  projectView,
  proposeFacts,
  readOutgoingAsk,
  reopenOutgoing,
  setOutgoingBody,
  setTeamMember,
  startOutgoing,
  wantsDeterministicProjectChat,
  type DdProject,
  type DocumentFact,
  type EvidenceRecord,
  type OutgoingSource,
} from '@realytica/shared';

const fact = (key: string, label: string, value: DocumentFact['value'], display: string, more: Partial<DocumentFact> = {}): DocumentFact => ({ key, label, value, display, page: 2, quote: `${label}: ${display}`, ...more });

function project(): DdProject {
  return createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0042');
}

function filed(p: DdProject, title: string, type: string | undefined, facts: DocumentFact[] = []): EvidenceRecord {
  const row = addEvidence(p, { title, kind: 'document', status: 'received' }, 'tester');
  attachEvidenceFile(p, row.id, { fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 1, storageKey: `k-${row.id}.pdf`, capture: {} }, 'tester');
  if (type) row.documentType = type;
  row.readMethod = 'text';
  row.facts = proposeFacts([], facts);
  return row;
}

/** A sale deed with one value the rules read (it stands) and one a model read that nobody accepted (it waits). */
function deed(p: DdProject): EvidenceRecord {
  return filed(p, 'Sale deed 2021', 'Sale deed', [
    fact('consideration', 'Sale consideration', 31850000, 'Rs 3.19 Cr', { page: 1, quote: 'for a total sale consideration of Rs. 3,18,50,000' }),
    fact('registration_date', 'Registered on', '2021-07-09', '9 Jul 2021', { quote: 'registered on 09-07-2021' }),
    fact('stamp_duty', 'Stamp duty', 1783600, 'Rs 17.84 lakh', { source: 'model', proof: 'page_text' }),
  ]);
}

/** A meeting kept on the file, its items on cards as the chat puts them. */
function met(p: DdProject) {
  const { meeting, cards } = keepMeeting(
    p,
    {
      file: { storageKey: 'notes.txt', fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: 1 },
      came: 'pasted',
      reading: {
        heldOn: '2026-10-03',
        attendees: ['Asha Rao', 'Ravi Kumar'],
        items: [
          { kind: 'decision', text: 'Use the survey of 2019', quote: 'Decision: use the survey of 2019', readBy: 'rules' },
          { kind: 'action', text: 'Collect the tax receipts', owner: 'Ravi Kumar', dueDate: '2026-10-10', quote: 'Action: Ravi to collect the tax receipts by 10 October', readBy: 'rules' },
          { kind: 'open', text: 'Whether to apply for the khata transfer now', quote: 'Open: whether to apply for the khata transfer now', readBy: 'rules' },
          { kind: 'decision', text: 'Appoint a second surveyor', quote: 'Decision: appoint a second surveyor', readBy: 'rules' },
        ],
      },
    },
    'asha@firm.test',
  );
  p.chatProposals.push(...cards);
  return { meeting, cards };
}

describe('the sources of a draft', () => {
  it('are what counts on the record, each with its paper and page, and nothing that waits', () => {
    const p = project();
    const row = deed(p);
    const decided = addDecision(p, { title: 'Pay the balance consideration in two parts', decisionType: 'other', decisionMaker: 'Asha Rao', rationale: 'Agreed with the vendor.', status: 'approved' }, 'asha@firm.test');
    addDecision(p, { title: 'Whether to pay the consideration early', decisionType: 'other', decisionMaker: '', rationale: '', status: 'pending' }, 'asha@firm.test');

    const sources = outgoingSources(p, { kind: 'paper', id: row.id }, 'the balance consideration');
    assert.deepEqual(
      sources.map((source) => [source.n, source.kind, source.title, source.page, source.says]),
      [
        [1, 'paper', 'Sale deed 2021', 1, 'Sale consideration: Rs 3.19 Cr'],
        [2, 'paper', 'Sale deed 2021', 2, 'Registered on: 9 Jul 2021'],
        [3, 'decision', 'Decision', undefined, `Decided: Pay the balance consideration in two parts (${new Date(decided.createdAt).getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(decided.createdAt).getUTCMonth()]} ${new Date(decided.createdAt).getUTCFullYear()})`],
      ],
      'the model’s stamp duty nobody accepted is no source, and neither is a decision nobody has made',
    );
    assert.equal(sources[0]!.quote, 'for a total sale consideration of Rs. 3,18,50,000');
  });

  it('take the words of the paper being answered as passages, each with its page', () => {
    const pages = [
      { page: 1, text: 'Tarangini Builders\n12 September 2026\nWe refer to the delay in handing over the site at Navilugudda.\nThe site was to be handed over on 1 August 2026.' },
      { page: 2, text: 'We claim an extension of 42 days.' },
    ];
    assert.deepEqual(paperPassages(pages), [
      { page: 1, text: 'Tarangini Builders 12 September 2026 We refer to the delay in handing over the site at Navilugudda.' },
      { page: 1, text: 'The site was to be handed over on 1 August 2026.' },
      { page: 2, text: 'We claim an extension of 42 days.' },
    ]);
    const p = project();
    const letter = filed(p, 'Contractor’s letter on the delay', undefined);
    const draft = startOutgoing(p, { kind: 'reply', about: { kind: 'paper', id: letter.id } }, 'asha@firm.test');
    addPaperPassages(draft, letter, pages.map((page) => ({ ...page, scanned: page.page === 2 })));
    assert.deepEqual(draft.sources.map((source) => [source.n, source.page, source.passage, source.scanned]), [[1, 1, true, undefined], [2, 1, true, undefined], [3, 2, true, true]]);
  });
});

describe('a model’s body', () => {
  const sources: OutgoingSource[] = [
    { n: 1, kind: 'paper', id: 'ev_1', title: 'Sale deed 2021', page: 1, says: 'Sale consideration: Rs 3.19 Cr', quote: 'for a total sale consideration of Rs. 3,18,50,000' },
    { n: 2, kind: 'paper', id: 'ev_1', title: 'Sale deed 2021', page: 2, says: 'Registered on: 9 Jul 2021', quote: 'registered on 09-07-2021' },
    { n: 3, kind: 'meeting', id: 'mtg_1', itemId: 'mi_1', title: 'Meeting, 3 Oct 2026', says: 'Decided: Appoint a second surveyor', quote: 'Decision: appoint a second surveyor', waiting: true },
  ];
  const body = (...sentences: Array<{ text: string; sources: number[] }>) => outgoingBodyHeld([{ sentences }], sources).split('\n');

  it('keeps a mark only where the statement’s figures and months are its source’s own', () => {
    assert.deepEqual(
      body(
        { text: 'The deed records a sale consideration of Rs. 3,18,50,000.', sources: [1] },
        { text: 'The deed was registered on 9 July 2021.', sources: [2] },
        // A digit out, a month out, a source that is not on the list, and a source it has nothing to do with.
        { text: 'The deed records a sale consideration of Rs. 3,18,00,000.', sources: [1] },
        { text: 'The deed was registered on 9 June 2021.', sources: [2] },
        { text: 'The deed was registered at Suvarnagiri.', sources: [7] },
        { text: 'Please confirm the name of the engineer.', sources: [2] },
      ),
      [
        'The deed records a sale consideration of Rs. 3,18,50,000. [1]',
        'The deed was registered on 9 July 2021. [2]',
        'The deed records a sale consideration of Rs. 3,18,00,000.',
        'The deed was registered on 9 June 2021.',
        'The deed was registered at Suvarnagiri.',
        'Please confirm the name of the engineer.',
      ],
    );
  });

  it('cannot mark itself, and cannot state what waits', () => {
    assert.deepEqual(body({ text: 'A second surveyor was appointed [1].', sources: [3] }, { text: 'Kindly reply within 7 days [2][approved].', sources: [] }), ['A second surveyor was appointed.', 'Kindly reply within 7 days.']);
    assert.equal(outgoingBodyHeld('not a body', sources), '');
  });

  it('is read back line by line: what rests on the record, and what is the drafter’s own to check', () => {
    const read = outgoingStatements('The deed was registered on 9 July 2021. [2]\nKindly confirm receipt.\n\nThe consideration was Rs. 4 crore. [1]', sources);
    assert.deepEqual(read.map((s) => [s.paragraph, s.text, s.marks, s.own, s.unheld]), [
      [0, 'The deed was registered on 9 July 2021.', [2], false, false],
      [0, 'Kindly confirm receipt.', [], true, false],
      [1, 'The consideration was Rs. 4 crore.', [1], false, true],
    ]);
  });
});

describe('minutes', () => {
  it('are put together by code from the meeting: who was there, what was decided, to be done and left open, and what waits is said to wait', () => {
    const p = project();
    const { meeting, cards } = met(p);
    // The first decision was accepted onto the record. The last was set aside.
    Object.assign(cards[0]!, { status: 'committed', committedRecordId: 'dec_1' });
    cards[3]!.status = 'rejected';
    const draft = startOutgoing(p, { kind: 'minutes', about: { kind: 'meeting', id: meeting.id } }, 'asha@firm.test');

    assert.deepEqual([draft.subject, draft.to, draft.written, draft.status], ['Minutes of the meeting of 3 Oct 2026', 'Asha Rao, Ravi Kumar', 'code', 'draft']);
    assert.equal(
      draft.body,
      [
        'Present: Asha Rao, Ravi Kumar.',
        '',
        'Decided',
        '1. Use the survey of 2019. [1]',
        '',
        'To be done',
        '1. Collect the tax receipts. On: Ravi Kumar. By: 10 Oct 2026. (waiting to be accepted on the record) [2]',
        '',
        'Left open',
        '1. Whether to apply for the khata transfer now. (waiting to be accepted on the record) [3]',
      ].join('\n'),
    );
    assert.deepEqual(draft.sources.map((source) => [source.n, source.says, source.quote, source.waiting]), [
      [1, 'Decided: Use the survey of 2019', 'Decision: use the survey of 2019', undefined],
      [2, 'To be done: Collect the tax receipts', 'Action: Ravi to collect the tax receipts by 10 October', true],
      [3, 'Left open: Whether to apply for the khata transfer now', 'Open: whether to apply for the khata transfer now', true],
    ]);
    assert.deepEqual(outgoingStatements(draft.body, draft.sources).map((s) => [s.heading, s.own, s.unheld]).filter(([, own, unheld]) => own || unheld), [[false, true, false]], 'only the line of who was there has no mark');
  });
});

describe('a draft', () => {
  it('changes nothing on the record, and leaves the trail a line when it is made', () => {
    const p = project();
    const row = deed(p);
    const before = JSON.stringify([p.evidence, p.decisions, p.actions, p.findings]);
    const draft = startOutgoing(p, { kind: 'letter', to: 'the authority', topic: 'asking for the khata extract', about: { kind: 'paper', id: row.id } }, 'asha@firm.test', '2026-10-06T09:00:00.000Z');
    setOutgoingBody(p, draft.id, 'The deed was registered on 9 July 2021. [2]');
    editOutgoing(p, draft.id, { to: 'The Tahsildar, Suvarnagiri' }, 'asha@firm.test');

    assert.equal(JSON.stringify([p.evidence, p.decisions, p.actions, p.findings]), before);
    assert.deepEqual([draft.ref, draft.dated, draft.subject, draft.written, draft.to], ['RYT-0042/OUT/1', '2026-10-06', 'Request for the khata extract', 'model', 'The Tahsildar, Suvarnagiri']);
    assert.deepEqual(p.audit.filter((e) => e.entityType === 'outgoing').map((e) => [e.action, e.entityId, e.newValue]), [['outgoing_drafted', draft.id, 'Letter: Request for the khata extract']]);
    assert.equal(startOutgoing(p, { kind: 'rfi', topic: 'on the revised drawings' }, 'asha@firm.test').ref, 'RYT-0042/OUT/2');
    assert.throws(() => startOutgoing(p, { kind: 'reply' }, 'asha@firm.test'), /answers a paper/);
    assert.throws(() => startOutgoing(p, { kind: 'minutes' }, 'asha@firm.test'), /of a meeting/);
  });

  it('is approved by name by a lead or a signer, and a change after that puts it back to draft', () => {
    const p = project();
    const row = deed(p);
    const draft = startOutgoing(p, { kind: 'letter', topic: 'the registration', about: { kind: 'paper', id: row.id } }, 'ravi@firm.test');

    // Owners and managers lead by the firm's roles. Staff contribute, until the project's team names one a lead or a signer.
    const may = (email: string, role: 'owner' | 'manager' | 'staff' | 'viewer' | 'collaborator') => mayApproveOutgoing(p, { email, role });
    assert.deepEqual([may('asha@firm.test', 'owner'), may('m@firm.test', 'manager'), may('ravi@firm.test', 'staff'), may('v@firm.test', 'viewer'), may('c@out.test', 'collaborator')], [true, true, false, false, false]);
    setTeamMember(p, { email: 'ravi@firm.test', departments: { legal: 'lead' } }, 'asha@firm.test');
    assert.equal(may('ravi@firm.test', 'staff'), true);

    assert.deepEqual(outgoingNeeds(p, draft), ['Say who it goes to.', 'It has no body yet.']);
    assert.throws(() => approveOutgoing(p, draft.id, { actor: 'asha@firm.test' }), /who it goes to/);
    editOutgoing(p, draft.id, { to: 'The Sub-Registrar', body: 'The deed was registered on 9 July 2021. [2]\nKindly send a certified copy.' }, 'ravi@firm.test');
    approveOutgoing(p, draft.id, { actor: 'asha@firm.test', name: 'Asha Rao' }, '2026-10-07T10:00:00.000Z');
    assert.deepEqual([draft.status, draft.approvedBy, draft.approvedName, draft.approvedAt, draft.dated], ['approved', 'asha@firm.test', 'Asha Rao', '2026-10-07T10:00:00.000Z', '2026-10-07']);

    noteOutgoingExported(p, draft.id, 'ravi@firm.test');
    editOutgoing(p, draft.id, { body: 'The deed was registered on 9 July 2021. [2]' }, 'ravi@firm.test');
    // What was approved is not what it now says, and the body is the person's own now.
    assert.deepEqual([draft.status, draft.approvedBy, draft.approvedAt, draft.written], ['draft', undefined, undefined, 'person']);
    approveOutgoing(p, draft.id, { actor: 'asha@firm.test' });
    reopenOutgoing(p, draft.id, 'asha@firm.test');
    assert.deepEqual(
      p.audit.filter((e) => e.entityType === 'outgoing').map((e) => [e.action, e.actor, e.newValue]),
      [
        ['outgoing_drafted', 'ravi@firm.test', 'Letter: The registration'],
        ['outgoing_approved', 'asha@firm.test', 'approved'],
        ['outgoing_exported', 'ravi@firm.test', 'approved'],
        ['outgoing_reopened', 'ravi@firm.test', 'draft'],
        ['outgoing_approved', 'asha@firm.test', 'approved'],
        ['outgoing_reopened', 'asha@firm.test', 'draft'],
      ],
    );
  });

  it('is not approved while a statement is marked with what no longer stands, or writes a figure its source does not', () => {
    const p = project();
    const row = deed(p);
    const draft = startOutgoing(p, { kind: 'letter', to: 'The Sub-Registrar', topic: 'the registration', about: { kind: 'paper', id: row.id } }, 'asha@firm.test');
    editOutgoing(p, draft.id, { body: 'The consideration was Rs. 3 crore. [1]' }, 'asha@firm.test');
    assert.match(outgoingNeeds(p, draft)[0]!, /writes a figure its source does not/);
    editOutgoing(p, draft.id, { body: 'The consideration was Rs. 3,18,50,000. [1]' }, 'asha@firm.test');
    assert.deepEqual(outgoingNeeds(p, draft), []);
    // A person sets the value aside on the paper: the draft's source no longer stands.
    row.facts!.find((f) => f.key === 'consideration')!.review = 'rejected';
    assert.deepEqual(outgoingNeeds(p, draft), ['Source 1 no longer stands on the record. Change the statement or take its mark off.']);
    assert.throws(() => approveOutgoing(p, draft.id, { actor: 'asha@firm.test' }), /no longer stands/);
  });
});

describe('the file that goes out', () => {
  it('says DRAFT, NOT APPROVED until it is approved, then who approved it and when, and lists its sources by paper and page', () => {
    const p = project();
    const row = deed(p);
    const draft = startOutgoing(p, { kind: 'reply', to: 'The vendor', about: { kind: 'paper', id: row.id } }, 'asha@firm.test', '2026-10-06T09:00:00.000Z');
    editOutgoing(p, draft.id, { body: 'The deed was registered on 9 July 2021. [2]\nIts consideration was Rs. 3,18,50,000. [1]\n\nKindly confirm.' }, 'asha@firm.test');

    const file = outgoingDocument(p, draft);
    assert.deepEqual([file.banner, file.approval, file.fileName], [OUTGOING_NOT_APPROVED, undefined, 'RYT-0042-OUT-1 Reply (draft).docx']);
    assert.deepEqual(file.head, [
      { label: 'Project', value: 'Navilugudda land (RYT-0042)' },
      { label: 'Reference', value: 'RYT-0042/OUT/1' },
      { label: 'Date', value: '6 Oct 2026' },
      { label: 'To', value: 'The vendor' },
      { label: 'Subject', value: 'Reply: Sale deed 2021' },
      { label: 'In reply to', value: 'Sale deed 2021' },
    ]);
    // Marks are renumbered in the order the body first uses them, and a paragraph's lines run together.
    assert.deepEqual(file.body, [
      { kind: 'text', text: 'The deed was registered on 9 July 2021. [1] Its consideration was Rs. 3,18,50,000. [2]' },
      { kind: 'text', text: 'Kindly confirm.' },
    ]);
    assert.deepEqual(file.sources, ['Sale deed 2021, page 2: Registered on: 9 Jul 2021 (“registered on 09-07-2021”)', 'Sale deed 2021, page 1: Sale consideration: Rs 3.19 Cr (“for a total sale consideration of Rs. 3,18,50,000”)']);

    approveOutgoing(p, draft.id, { actor: 'asha@firm.test', name: 'Asha Rao' }, '2026-10-07T10:00:00.000Z');
    const sent = outgoingDocument(p, draft);
    assert.deepEqual([sent.banner, sent.approval, sent.fileName], [undefined, 'Approved for sending by Asha Rao on 7 Oct 2026.', 'RYT-0042-OUT-1 Reply.docx']);
  });
});

describe('asked for in the chat', () => {
  it('is a draft made by rule, for the paper or the meeting the sentence names', () => {
    const p = project();
    const letter = filed(p, 'Contractor’s letter on the delay', undefined);
    filed(p, 'Contractor’s letter on the retention money', undefined);
    deed(p);
    const { meeting } = met(p);

    for (const said of ['draft a reply to the contractor’s letter on the delay', 'Draft an RFI on the revised drawings', 'please write a letter to the authority asking for the khata extract', 'draft the minutes of the meeting of 3 October']) {
      assert.ok(asksForOutgoing(said), said);
      assert.ok(wantsDeterministicProjectChat(p, said), `no model answers “${said}” in the rules’ place`);
    }
    for (const said of ['write this week’s status for the owner', 'draft a report', 'what does the reply say?']) assert.equal(asksForOutgoing(said), false, said);

    assert.deepEqual(readOutgoingAsk(p, 'draft a reply to the contractor’s letter on the delay'), { input: { kind: 'reply', about: { kind: 'paper', id: letter.id }, to: 'The contractor', topic: 'the contractor’s letter on the delay' } });
    assert.deepEqual(readOutgoingAsk(p, 'write a letter to the authority asking for the khata extract.'), { input: { kind: 'letter', to: 'The authority', topic: 'asking for the khata extract' } });
    assert.deepEqual(readOutgoingAsk(p, 'draft the minutes of the meeting of 3 October'), { input: { kind: 'minutes', about: { kind: 'meeting', id: meeting.id } } });

    // Two letters from the contractor: it asks which, and each answer names one paper whole.
    const which = readOutgoingAsk(p, 'draft a reply to the contractor’s letter');
    assert.ok('said' in which && which.choices?.length === 2);
    assert.deepEqual(readOutgoingAsk(p, which.choices![0]!.send), { input: { kind: 'reply', about: { kind: 'paper', id: letter.id }, to: 'The contractor', topic: '“Contractor’s letter on the delay”' } });
    // A name before the possessive is kept as it was typed.
    const named = readOutgoingAsk(p, 'draft a reply to Tarangini’s letter on the retention money');
    assert.equal('input' in named && named.input.to, 'Tarangini');

    const went: Array<[string, string, string | undefined]> = [];
    const out = outgoingAsked(p, 'draft an RFI to the architect on the revised drawings', 'asha@firm.test', (pane, label, extra) => went.push([pane, label, extra?.item]));
    const draft = p.outgoing![0]!;
    assert.deepEqual([draft.kind, draft.to, draft.subject, draft.asked], ['rfi', 'The architect', 'Request for information: revised drawings', 'draft an RFI to the architect on the revised drawings']);
    assert.deepEqual(went, [['outgoing', 'Drafted a request for information', draft.id]]);
    assert.match(out.assistantText, /^Drafted a request for information to the architect as RYT-0042\/OUT\/1\. It is open in Outgoing\./);
    assert.match(out.assistantText, /nothing goes out until a lead or a signer approves it\.$/);
  });

  it('says so where there is no meeting to take minutes of', () => {
    const p = project();
    const read = readOutgoingAsk(p, 'draft the minutes');
    assert.ok('said' in read && /No meeting is kept on this file yet/.test(read.said));
  });
});

describe('somebody working from a grant', () => {
  it('is handed a project with no drafts on it', () => {
    const p = project();
    startOutgoing(p, { kind: 'letter', to: 'The authority', topic: 'the khata extract' }, 'asha@firm.test');
    const grant = { id: 'grant-1', tenantId: 't1', projectId: p.id, email: 'contractor@outside.test', role: 'contributor' as const, allAssessments: true, assessmentIds: [], allScopes: true, scopeKeys: [], areas: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'asha@firm.test' };
    assert.deepEqual(projectView(p, { kind: 'granted', grant, email: grant.email }).project.outgoing, []);
  });
});
