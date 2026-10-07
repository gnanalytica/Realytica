/**
 * What a chat message changed, and putting it back.
 *
 * One test for each rule. A message is compared with the record as it stood
 * before it, and what it changed is listed a thing a line. A reply that only
 * raised cards changed nothing. An undo puts back each thing that still
 * stands as the message left it and leaves the rest, with why. It never
 * takes away a record that something added since rests on, removes a file
 * only when nothing points at it any more, and sends a card back to waiting
 * only together with what accepting it recorded. The clock is not a change.
 * A message keeps only what is its own: all of it when nothing else wrote
 * while it ran, and otherwise what its own lines on the trail tell of and no
 * other line does. That it is wired to the chat is proved over HTTP in
 * `turn-undo-route.test.ts`. Every name and paper is invented.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGE_KEPT_AT_MOST,
  addEvidence,
  addQuestionnaire,
  asksToUndo,
  attachEvidenceFile,
  changeLines,
  changesBetween,
  createProject,
  createValuationRun,
  listedIds,
  logSiteEntry,
  ownChanges,
  recordAsItStands,
  turnChanged,
  undoChanges,
  undoSaid,
  undoSentence,
  type AuditEvent,
  type ChatProposal,
  type DdProject,
  type DocumentFact,
  type KeptGroup,
} from '@realytica/shared';

const LEAD = 'lead@example.com';

const fact = (key: string, label: string, display: string, more: Partial<DocumentFact> = {}): DocumentFact => ({ key, label, value: display, display, page: 1, quote: `${label}: ${display}`, review: 'proposed', ...more });

/** A project with one paper on the register, read, with two values waiting on it. */
function fixture(): { project: DdProject; paperId: string } {
  const project = createProject({ name: 'Northfield corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-0001');
  const paper = addEvidence(project, { title: 'Khata certificate', kind: 'document' }, LEAD);
  attachEvidenceFile(project, paper.id, { fileName: 'khata.pdf', mimeType: 'application/pdf', sizeBytes: 100, storageKey: 'khata-key.pdf' }, LEAD);
  paper.facts = [fact('khata_number', 'Khata number', '112/4'), fact('site_area', 'Site area', '1,115 sq m')];
  return { project, paperId: paper.id };
}

/** What a message did, as the groups kept for it: the record before, then the change. */
function did(project: DdProject, change: () => void): KeptGroup[] {
  const before = recordAsItStands(project);
  change();
  return changesBetween(before, project);
}

const card = (id: string, more: Partial<ChatProposal> = {}): ChatProposal => ({ id, kind: 'patch_project', title: 'Record the land area as 1,115 sqm', rationale: '', impact: '', status: 'proposed', payload: { landAreaSqm: 1115 }, createdAt: '2026-10-01T09:00:00.000Z', createdBy: LEAD, ...more });

describe('what a message changed', () => {
  it('is listed a thing a line: a field set, a value accepted, a paper filed, a meeting kept, a report drafted, a questionnaire taken in', () => {
    const { project, paperId } = fixture();
    const groups = did(project, () => {
      project.landAreaSqm = 1115;
      project.valueSources = { landAreaSqm: { value: 1115, label: 'Site area', evidenceId: paperId, page: 1, at: '2026-10-01T09:00:00.000Z', by: LEAD } };
      const read = project.evidence[0]!.facts!.find((held) => held.key === 'khata_number')!;
      Object.assign(read, { review: 'accepted', decidedBy: LEAD, decidedAt: '2026-10-01T09:00:00.000Z' });
      const filed = addEvidence(project, { title: 'Tax receipt', kind: 'document' }, LEAD);
      attachEvidenceFile(project, filed.id, { fileName: 'tax.pdf', mimeType: 'application/pdf', sizeBytes: 100, storageKey: 'tax-key.pdf' }, LEAD);
      project.meetings = [{ id: 'mtg_1', title: 'Site meeting', heldOn: '2026-10-03', attendees: [], file: { storageKey: 'notes-key.txt', fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: 40 }, came: 'pasted', items: [], keptAt: '2026-10-03T10:00:00.000Z', keptBy: LEAD }];
      project.reports.push({ id: 'rep_1', kind: 'status', title: 'Status report, 28 Sep to 4 Oct 2026', status: 'draft', assessmentIds: [], scopeInstanceIds: [], body: { blocks: [] }, generatedAt: '2026-10-05T09:00:00.000Z', generatedBy: LEAD } as unknown as DdProject['reports'][number]);
      addQuestionnaire(project, { title: 'Lender’s questions', parsed: { header: [], questions: [{ text: 'What is the khata number?' }, { text: 'Who is the architect?' }] } }, LEAD);
    });
    assert.deepEqual(changeLines(groups).sort(), [
      'Accepted Khata number on “Khata certificate”: 112/4',
      'Drafted “Status report, 28 Sep to 4 Oct 2026”',
      'Filed “Tax receipt”',
      'Kept the notes of a meeting of 3 Oct 2026',
      'Set the land area to 1,115 sqm',
      'Took in the questionnaire “Lender’s questions”, 2 questions',
    ]);
    // What it takes to put each back is small: for a record that was added, a fingerprint and no copy of it.
    const filed = groups.find((group) => group.line === 'Filed “Tax receipt”')!;
    assert.deepEqual([filed.changes.map((change) => [change.did, change.before]), filed.files], [[['added', undefined]], ['tax-key.pdf']]);
    assert.ok(JSON.stringify(groups).length < 4_000, 'the whole of it is a few lines of data');
  });

  it('is nothing when the reply only raised cards, or only holds words it is asking about', () => {
    const { project } = fixture();
    assert.deepEqual(did(project, () => project.chatProposals.push(card('prop_1'))), []);
    assert.deepEqual(
      did(project, () => {
        project.meetings = [{ id: 'mtg_asked', title: 'Words to ask about', attendees: [], file: { storageKey: 'held.txt', fileName: 'held.txt', mimeType: 'text/plain', sizeBytes: 9 }, came: 'pasted', items: [], standing: 'asked', keptAt: '2026-10-03T10:00:00.000Z', keptBy: LEAD }];
      }),
      [],
    );
    assert.equal(turnChanged([], true), undefined);
  });

  it('says many of one kind about one thing as one line, and keeps a few lines with the rest counted', () => {
    const { project } = fixture();
    const groups = did(project, () => {
      for (let n = 1; n <= 14; n += 1) addEvidence(project, { title: `Paper ${n}`, kind: 'document' }, LEAD);
    });
    assert.deepEqual(changeLines(groups), ['Listed 14 papers on the register, to be got'], 'a row with no file on it is a paper expected, not one filed');
    const owners = did(project, () => {
      for (let n = 1; n <= 14; n += 1) (project as unknown as Record<string, unknown>)[`field${n}`] = n;
    });
    const kept = turnChanged(owners, true)!;
    assert.deepEqual([kept.lines.length, kept.more, kept.kept], [12, 2, true]);
    assert.equal(undoSentence(kept), `Undo: ${kept.lines[0]}, and 13 more`);
  });

  it('says a valuation run as the valuation, with no name where it has none, and what it brings up to date in words a person would use', () => {
    const { project } = fixture();
    const before = JSON.stringify(recordAsItStands(project));
    const ran = did(project, () => void createValuationRun(project, LEAD));
    // Was: 'Ran the valuation “untitled”' and 'Changed capability runs'.
    assert.deepEqual(changeLines(ran), ['Ran the valuation', 'Changed the Auto-run summary']);
    // Only the words changed. An undo puts back what it always did: the run and the summary, and the record is as it stood.
    const run = project.valuationRuns[0]!;
    assert.deepEqual(changeLines(did(project, () => (run.signOff = 'internal_review'))), ['Changed the valuation']);
    assert.deepEqual(changeLines(did(project, () => (run.status = 'superseded'))), ['Marked the valuation as superseded']);
    run.signOff = 'unsigned';
    run.status = 'computed';
    const undone = undoChanges(project, ran);
    assert.deepEqual([undone.back.map((group) => group.path[0]).sort(), undone.left], [['capabilityRuns', 'valuationRuns'], []]);
    assert.equal(JSON.stringify(recordAsItStands(project)), before);
    const again = did(project, () => void createValuationRun(project, LEAD));
    assert.deepEqual(changeLines(did(project, () => project.valuationRuns.pop())), ['Removed the valuation']);
    assert.equal(again.some((group) => group.quiet), false, 'each is still a thing of its own to put back');
    // A record that has a name is still said by it, and the screen is still called the screen.
    assert.deepEqual(changeLines(did(project, () => project.decisions.push({ id: 'dec_1', title: 'Rebuild the north wall', status: 'approved' } as unknown as DdProject['decisions'][number]))), ['Recorded the decision “Rebuild the north wall”']);
    assert.deepEqual(changeLines(did(project, () => ((project as unknown as Record<string, unknown>).lastScreenResult = { verdict: 'clear' }))), ['Changed the last screen']);
  });

  it('does not take the clock for a change', () => {
    const { project } = fixture();
    assert.deepEqual(
      did(project, () => {
        project.evidence[0]!.updatedAt = '2030-01-01T00:00:00.000Z';
        project.updatedAt = '2030-01-01T00:00:00.000Z';
        (project.evidence[0] as unknown as Record<string, unknown>).quotes = [];
      }),
      [],
      'a later time on a record, and a list that holds nothing where there was none, say nothing new',
    );
  });
});

describe('whose a change is', () => {
  it('is the message’s throughout when nothing else wrote while it ran, and otherwise only where its own lines tell of it and no other line does', () => {
    const { project, paperId } = fixture();
    const groups = did(project, () => {
      // The message files a paper, accepts a value, sets the owner and raises a card. Meanwhile, from a page: a decision, a card, and an answer the review table keeps by the first paper's id.
      addEvidence(project, { title: 'Tax receipt', kind: 'document' }, LEAD);
      Object.assign(project.evidence[0]!.facts!.find((held) => held.key === 'khata_number')!, { review: 'accepted', decidedBy: LEAD, decidedAt: '2026-10-06T09:00:00.000Z' });
      project.owner = 'Asha Rao';
      project.decisions.push({ id: 'dec_1', title: 'Proceed to the agreement' } as unknown as DdProject['decisions'][number]);
      project.reviewTable = { columns: [{ id: 'q_1', kind: 'question', question: 'Who signed it?' }], answers: { q_1: { [paperId]: { text: 'The commissioner' } } } } as unknown as DdProject['reviewTable'];
      project.chatProposals.push(card('prop_mine'), card('prop_theirs'));
    });
    const filedId = project.evidence[1]!.id;
    const line = (more: Partial<AuditEvent>): AuditEvent => ({ id: `aud_${Math.random()}`, at: '2026-10-06T09:00:00.000Z', actor: LEAD, action: 'create', entityType: 'evidence', entityId: '', ...more });
    const quiet = { projectId: project.id, touched: false, mine: [], others: [], raised: new Set(['prop_mine', 'prop_theirs']), listed: listedIds(project) };
    assert.equal(ownChanges(groups, quiet).meanwhile.length, 0, 'with nothing else at work, all of it is the message’s');

    const told = ownChanges(groups, {
      ...quiet,
      touched: true,
      raised: new Set(['prop_mine']),
      // The message's own lines: the paper it filed, the value it accepted, and the field it set.
      mine: [line({ entityId: filedId }), line({ action: 'accept_fact', entityId: paperId, factKey: 'khata_number' }), line({ action: 'patch', entityType: 'project', entityId: project.id, fields: ['owner'] })],
      others: [line({ entityType: 'decision', entityId: 'dec_1' })],
    });
    assert.deepEqual(changeLines(told.own).sort(), ['Accepted Khata number on “Khata certificate”: 112/4', 'Listed “Tax receipt” on the register, to be got', 'Set the owner to Asha Rao']);
    // The message's line about the first paper does not make the review table its own, though an answer there is kept by that paper's id.
    assert.deepEqual(changeLines(told.meanwhile).sort(), ['Changed the review table', 'Recorded the decision “Proceed to the agreement”']);
    assert.deepEqual([told.own.filter((group) => group.quiet).map((group) => group.key), told.meanwhile.filter((group) => group.quiet).map((group) => group.key)], [['chatProposals/#prop_mine'], ['chatProposals/#prop_theirs']], 'a card is the message’s only where it raised it');
    // Somebody else's line is read the other way, for all it could be about: their decision on another value of that paper tells of every value on it.
    const doubted = ownChanges(groups, { ...quiet, touched: true, mine: [line({ action: 'accept_fact', entityId: paperId, factKey: 'khata_number' })], others: [line({ action: 'accept_fact', entityId: paperId, factKey: 'site_area' })] });
    assert.deepEqual(changeLines(doubted.own), []);

    // What is not the message's is not put back with it, and nothing made for it is either.
    const outcome = undoChanges(project, told.own, told.meanwhile.map((group) => group.key));
    assert.deepEqual([project.owner, project.decisions.length, project.evidence.length, Boolean(project.reviewTable), project.chatProposals.map((held) => held.id)], [undefined, 1, 1, true, ['prop_theirs']]);
    assert.deepEqual([outcome.left, project.evidence[0]!.facts!.find((held) => held.key === 'khata_number')!.review], [[], 'proposed']);
  });
});

describe('undoing a message', () => {
  it('puts back each thing that still stands as the message left it, and leaves what was changed again, saying which and why', () => {
    const { project } = fixture();
    const groups = did(project, () => {
      project.owner = 'Asha Rao';
      project.budget = 5_000_000;
    });
    // Later work: the budget is changed again, and a developer is named.
    project.budget = 6_000_000;
    project.developer = 'Northfield Homes';
    const outcome = undoChanges(project, groups);
    assert.deepEqual([project.owner, project.budget, project.developer], [undefined, 6_000_000, 'Northfield Homes'], 'the later budget and the later developer are untouched');
    assert.deepEqual(undoSaid(outcome).split('\n'), ['Undone, 1 of 2:', '- Set the owner to Asha Rao.', 'Left as it is:', '- Set the budget to 50,00,000: it was changed again since.']);
  });

  it('sends a value back to waiting on its own, where another on the same paper was decided since', () => {
    const { project } = fixture();
    const groups = did(project, () => {
      for (const read of project.evidence[0]!.facts!) Object.assign(read, { review: 'accepted', decidedBy: LEAD, decidedAt: '2026-10-01T09:00:00.000Z' });
    });
    assert.deepEqual(changeLines(groups), ['Accepted Khata number on “Khata certificate”: 112/4', 'Accepted Site area on “Khata certificate”: 1,115 sq m']);
    // A person corrects one of them afterwards.
    Object.assign(project.evidence[0]!.facts![1]!, { value: '1,151 sq m', display: '1,151 sq m', edited: true });
    const outcome = undoChanges(project, groups);
    assert.deepEqual(project.evidence[0]!.facts!.map((read) => [read.key, read.review, read.decidedBy]), [['khata_number', 'proposed', undefined], ['site_area', 'accepted', LEAD]]);
    assert.deepEqual([outcome.back.length, outcome.left.map((held) => held.why)], [1, ['it was changed again since']]);
  });

  it('never takes away a record that something added since rests on', () => {
    const { project } = fixture();
    let filedId = '';
    const groups = did(project, () => {
      filedId = addEvidence(project, { title: 'Tax receipt', kind: 'document' }, LEAD).id;
    });
    // Later, a finding is raised that cites the paper.
    project.findings.push({ id: 'fnd_1', title: 'Tax unpaid for a year', evidenceIds: [filedId] } as unknown as DdProject['findings'][number]);
    const outcome = undoChanges(project, groups);
    assert.ok(project.evidence.some((row) => row.id === filedId), 'the paper stays');
    assert.deepEqual(undoSaid(outcome).split('\n'), ['Nothing was undone.', 'Left as it is:', '- Listed “Tax receipt” on the register, to be got: something else on the record still rests on it.']);
    // With the finding gone, nothing rests on it, and it goes.
    project.findings = [];
    assert.equal(undoChanges(project, groups).back.length, 1);
    assert.ok(!project.evidence.some((row) => row.id === filedId));
  });

  it('gives back the files of what it took away, and only those nothing points at any more', () => {
    const { project } = fixture();
    const groups = did(project, () => {
      const filed = addEvidence(project, { title: 'Tax receipt', kind: 'document' }, LEAD);
      attachEvidenceFile(project, filed.id, { fileName: 'tax.pdf', mimeType: 'application/pdf', sizeBytes: 100, storageKey: 'tax-key.pdf' }, LEAD);
      const second = addEvidence(project, { title: 'Zoning certificate', kind: 'document' }, LEAD);
      attachEvidenceFile(project, second.id, { fileName: 'zoning.pdf', mimeType: 'application/pdf', sizeBytes: 100, storageKey: 'zoning-key.pdf' }, LEAD);
    });
    // The zoning certificate was changed since, so it stays, and so does its file.
    project.evidence.find((row) => row.title === 'Zoning certificate')!.status = 'validated';
    const outcome = undoChanges(project, groups);
    assert.deepEqual([outcome.files, project.evidence.map((row) => row.title)], [['tax-key.pdf'], ['Khata certificate', 'Zoning certificate']]);
    assert.match(undoSaid(outcome), /^The file it added is removed from storage\.$/m);
  });

  it('counts among those files the one a questionnaire came from and the words kept beside a voice note', () => {
    const { project } = fixture();
    const groups = did(project, () => {
      addQuestionnaire(project, { title: 'Lender’s questions', fileName: 'queries.xlsx', fileKey: 'queries-key.xlsx', parsed: { header: [], questions: [{ text: 'What is the khata number?' }] } }, LEAD);
      logSiteEntry(project, { clientId: 'phone-1', date: '2026-10-05', workDone: 'Footing concrete poured', voiceNote: { storageKey: 'note-key.m4a', fileName: 'note.m4a', mimeType: 'audio/mp4', wordsKey: 'note-key.m4a.words.txt' } }, LEAD);
    });
    assert.deepEqual(undoChanges(project, groups).files.sort(), ['note-key.m4a', 'note-key.m4a.words.txt', 'queries-key.xlsx']);
    assert.deepEqual([project.questionnaires, project.siteLog], [[], []]);
  });

  it('sends a card back to waiting only together with what accepting it recorded', () => {
    const { project } = fixture();
    project.chatProposals.push(card('prop_1'));
    const accept = (): void => {
      project.landAreaSqm = 1115;
      project.chatProposals[0]!.status = 'committed';
    };
    const groups = did(project, accept);
    assert.deepEqual(changeLines(groups), ['Set the land area to 1,115 sqm'], 'the card is not said beside what it recorded');
    // The area was corrected by hand since: the figure stays, and the card stays accepted with it.
    project.landAreaSqm = 1151;
    assert.equal(undoChanges(project, groups).back.length, 0);
    assert.deepEqual([project.landAreaSqm, project.chatProposals[0]!.status], [1151, 'committed']);
    // Untouched since, both go back: the figure is gone and the card waits again.
    project.landAreaSqm = 1115;
    undoChanges(project, groups);
    assert.deepEqual([project.landAreaSqm, project.chatProposals[0]!.status], [undefined, 'proposed']);
  });

  it('takes back the cards a message raised only when everything it lists went back', () => {
    const { project } = fixture();
    const groups = did(project, () => {
      project.owner = 'Asha Rao';
      project.developer = 'Northfield Homes';
      project.chatProposals.push(card('prop_raised'));
    });
    project.developer = 'Another firm';
    undoChanges(project, groups);
    assert.ok(project.chatProposals.some((held) => held.id === 'prop_raised'), 'one listed thing stayed, so the card stays');
  });

  it('leaves what was added for something that stays', () => {
    const { project } = fixture();
    let ddId = '';
    const groups = did(project, () => {
      ddId = 'dd_1';
      project.assessments.push({ id: ddId, name: 'Acquisition DD', scopes: [] } as unknown as DdProject['assessments'][number]);
      // The papers the due diligence expects, each naming it.
      for (const title of ['Sale deed', 'Encumbrance certificate']) addEvidence(project, { title, kind: 'document' }, LEAD).assessmentIds.push(ddId);
    });
    // A person works on the due diligence afterwards.
    project.assessments[0]!.notes = 'Counsel instructed';
    const outcome = undoChanges(project, groups);
    assert.deepEqual(outcome.left.map((held) => [held.group.line, held.why]).sort(), [
      ['Listed “Encumbrance certificate” on the register, to be got', 'what it was added for could not be put back'],
      ['Listed “Sale deed” on the register, to be got', 'what it was added for could not be put back'],
      ['Started “Acquisition DD”', 'it was changed again since'],
    ]);
    assert.equal(project.evidence.length, 3, 'its papers stay with it');
  });

  it('lists what stood before when it is too large to keep, and does not put it back', () => {
    const { project } = fixture();
    (project as unknown as Record<string, unknown>).siteContext = { notes: 'x'.repeat(CHANGE_KEPT_AT_MOST + 10) };
    const groups = did(project, () => {
      (project as unknown as Record<string, unknown>).siteContext = { notes: 'short' };
    });
    assert.deepEqual(groups.map((group) => group.changes.map((change) => [change.lost, change.before])), [[[true, undefined]]]);
    assert.deepEqual(undoChanges(project, groups).left.map((held) => held.why), ['what stood before was too large to keep with the message']);
  });

  it('does not take an action the clock has called overdue for one a person changed', () => {
    const { project } = fixture();
    const groups = did(project, () => {
      project.actions.push({ id: 'act_1', title: 'Get the tax receipt', status: 'not_started', dueDate: '2026-10-02' } as unknown as DdProject['actions'][number]);
    });
    project.actions[0]!.status = 'overdue';
    assert.equal(undoChanges(project, groups).back.length, 1);
    assert.deepEqual(project.actions, []);
  });
});

describe('asking for an undo', () => {
  it('is read only in full', () => {
    for (const asked of ['undo', 'Undo that.', 'please undo the last change', 'undo what you just did']) assert.equal(asksToUndo(asked), true, asked);
    for (const asked of ['undo the sale deed', 'can a decision be undone?', 'undo everything since Monday']) assert.equal(asksToUndo(asked), false, asked);
  });
});
