/**
 * Bringing an old file up to date from its documents: a re-screen that
 * retires what it no longer finds, and filed documents read again onto the
 * rows they are filed on.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDecision,
  applyScreenToProject,
  commitChatProposal,
  createProject,
  projectToScreenDocuments,
  proposalsFromIngest,
  runProjectScreen,
  seedDemoProject,
  type ChatIngestFile,
  type DdProject,
} from '../packages/shared/src';

function screened(): DdProject {
  const project = seedDemoProject();
  applyScreenToProject(project, runProjectScreen(project, '2026-09-01T00:00:00.000Z'), 'first screen');
  return project;
}

describe('a re-screen', () => {
  it('closes what it no longer raises, and leaves what a person took up', () => {
    const project = screened();
    const raisedFirst = project.findings.filter((f) => f.screenCode && f.status === 'open');
    assert.ok(raisedFirst.length >= 2, `the first screen raised findings: ${raisedFirst.length}`);
    const [dropped, taken] = raisedFirst;
    taken!.status = 'under_review';

    const next = runProjectScreen(project, '2026-09-30T00:00:00.000Z');
    next.risks = next.risks.filter((flag) => flag.code !== dropped!.screenCode && flag.code !== taken!.screenCode);
    applyScreenToProject(project, next, 'second screen');

    const closed = project.findings.find((f) => f.id === dropped!.id)!;
    assert.equal(closed.status, 'closed');
    assert.ok(closed.screenClosedAt);
    assert.match(closed.confidenceNote ?? '', /No longer raised by the screen of/);
    assert.equal(project.findings.find((f) => f.id === taken!.id)!.status, 'under_review', 'a finding a person moved on stays');
    const risk = project.risks.find((r) => r.screenCode === dropped!.screenCode)!;
    assert.equal(risk.status, 'closed');
    assert.ok(project.audit.some((a) => a.action === 'rescreen'));
  });

  it('raises afresh what it closed once it finds it again', () => {
    const project = screened();
    const target = project.findings.find((f) => f.screenCode && f.status === 'open' && f.screenCode !== 'title-graph')!;
    const without = runProjectScreen(project);
    without.risks = without.risks.filter((flag) => flag.code !== target.screenCode);
    applyScreenToProject(project, without);
    applyScreenToProject(project, runProjectScreen(project));
    const same = project.findings.filter((f) => f.screenCode === target.screenCode);
    assert.equal(same.length, 2, 'the closed one stays as history beside the new one');
    assert.equal(same.filter((f) => f.status === 'open').length, 1);
  });

  it('replaces an untouched red flag draft and keeps one a person worked on', () => {
    const project = screened();
    const first = project.reports.filter((r) => r.kind === 'red_flag');
    assert.equal(first.length, 1);
    applyScreenToProject(project, runProjectScreen(project));
    const second = project.reports.filter((r) => r.kind === 'red_flag');
    assert.equal(second.length, 1, 'still one draft, not two');
    assert.notEqual(second[0]!.id, first[0]!.id);

    const block = second[0]!.body.blocks[0]!;
    block.state = 'checked';
    block.stateBy = 'Reviewer';
    applyScreenToProject(project, runProjectScreen(project));
    const third = project.reports.filter((r) => r.kind === 'red_flag');
    assert.equal(third.length, 2);
    assert.ok(third.some((r) => r.id === second[0]!.id), 'the checked draft stays');
  });

  it('proposes its verdict again when the only earlier one was withdrawn', () => {
    const project = createProject({ name: 'Client villas', type: 'residential', location: 'Hosakote', city: 'Bengaluru' }, 'RYT-0009');
    const verdict = runProjectScreen(project).recommendation.verdict;
    addDecision(
      project,
      { title: 'Screen: old', decisionType: 'proceed', decisionMaker: 'old screen', status: 'rejected', rationale: 'Withdrawn.', screenCode: `verdict:${verdict}` },
      'cleanup',
    );
    applyScreenToProject(project, runProjectScreen(project));
    assert.ok(project.decisions.some((d) => d.screenCode === `verdict:${verdict}` && d.status === 'proposed'));
  });
});

describe('reading a filed document again', () => {
  function filedProject(): { project: DdProject; storageKey: string; rowId: string } {
    const project = createProject({ name: 'Client villas', type: 'residential', location: 'Hosakote', city: 'Bengaluru' }, 'RYT-0009');
    const storageKey = 'doc_abc/Environment_clearance.pdf';
    project.evidence.push({
      id: 'ev_filed',
      title: 'Environment clearance',
      kind: 'document',
      source: 'chat_upload',
      status: 'received',
      attachments: [{ id: 'file_1', fileName: 'Environment_clearance.pdf', mimeType: 'application/pdf', sizeBytes: 1000, storageKey, uploadedAt: '2026-09-04T00:00:00.000Z' }],
      assessmentIds: [],
      scopeInstanceIds: [],
      checkIds: [],
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    } as unknown as DdProject['evidence'][number]);
    return { project, storageKey, rowId: 'ev_filed' };
  }

  it('lands on the row the file is on, with its facts, and does not attach it twice', () => {
    const { project, storageKey, rowId } = filedProject();
    const file: ChatIngestFile = {
      fileName: 'Environment_clearance.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      storageKey,
      read: {
        type: 'other_certificate',
        label: 'Environment clearance',
        confidence: 0.9,
        method: 'text',
        facts: [{ key: 'issued_on', label: 'Issued on', display: '12 Jan 2015', value: '2015-01-12', page: 1, quote: 'Dated 12th January 2015' }],
        flags: [],
        summary: 'An environment clearance',
        rowHints: [],
        scopes: [],
        evidenceKind: 'certificate',
      },
    } as unknown as ChatIngestFile;
    const cards = proposalsFromIngest(project, [file]);
    const filing = cards.find((c) => c.kind === 'file_evidence')!;
    assert.equal(filing.payload.evidenceId, rowId);
    assert.match(filing.impact, /on the row it is filed on/);

    project.chatProposals.push(filing);
    commitChatProposal(project, filing.id);
    const row = project.evidence.find((e) => e.id === rowId)!;
    assert.equal(row.attachments.length, 1, 'the same file is not listed twice');
    assert.equal(row.facts?.[0]?.quote, 'Dated 12th January 2015');
    assert.equal(project.evidence.filter((e) => e.attachments.some((a) => a.storageKey === storageKey)).length, 1);
  });

  it('moves on past a document a model has read, even with nothing placed on a page', async () => {
    const { rowsToRead } = await import('../apps/api/src/documents/reread');
    const { project, storageKey } = filedProject();
    assert.equal(rowsToRead(project, false).length, 1, 'filed and unread');
    // Read by a model that could say what it is but place nothing on a page.
    const file = { fileName: 'Environment_clearance.pdf', mimeType: 'application/pdf', sizeBytes: 1000, storageKey, kindHint: 'other', extractionNotes: 'An environmental clearance.', modelRead: true } as ChatIngestFile;
    const filing = proposalsFromIngest(project, [file]).find((c) => c.kind === 'file_evidence')!;
    project.chatProposals.push(filing);
    commitChatProposal(project, filing.id);
    assert.ok(project.evidence[0]!.modelReadAt, 'the row says a model read it');
    assert.equal(rowsToRead(project, false).length, 0, 'read, not waiting to be');
    assert.equal(rowsToRead(project, true).length, 1, 'asking again reads it again');
  });

  it('reads once more a document an older reader read and placed nothing on', async () => {
    const { rowsToRead } = await import('../apps/api/src/documents/reread');
    const { MODEL_READER_VERSION } = await import('../packages/shared/src');
    const { project, storageKey } = filedProject();
    const file = { fileName: 'Environment_clearance.pdf', mimeType: 'application/pdf', sizeBytes: 1000, storageKey, kindHint: 'other', modelRead: true } as ChatIngestFile;
    const filing = proposalsFromIngest(project, [file]).find((c) => c.kind === 'file_evidence')!;
    project.chatProposals.push(filing);
    commitChatProposal(project, filing.id);
    const row = project.evidence[0]!;
    assert.equal(row.modelReadVersion, MODEL_READER_VERSION, 'the row says which reader read it');
    assert.equal(rowsToRead(project, false).length, 0, 'the current reader is not asked twice');

    // As a row read before the version was recorded: the reader that placed pages only by citation.
    delete row.modelReadVersion;
    assert.equal(rowsToRead(project, false).length, 1, 'an older reader that placed nothing leaves the row to read again');

    // Once the row states something, it is read, whichever reader read it.
    row.facts = [{ key: 'issued_on', label: 'Issued on', display: '12 Jan 2015', value: '2015-01-12', page: 1, quote: 'Dated 12th January 2015' }];
    assert.equal(rowsToRead(project, false).length, 0);
  });

  it('is asked for in plain words, and not by a question about the documents', async () => {
    // Dynamic: the module reaches storage, whose adapter is chosen with a top-level await.
    const { READ_FILED_REQUEST, asksAgain } = await import('../apps/api/src/documents/reread');
    for (const ask of ['Read the filed documents', 'read the uploaded documents again', 'Re-read the documents', 'please read all the documents on this file']) {
      assert.ok(READ_FILED_REQUEST.test(ask), ask);
    }
    for (const ask of ['Read the documents and tell me the survey number', 'What do the documents say about tenure?', 'read the EC']) {
      assert.equal(READ_FILED_REQUEST.test(ask), false, ask);
    }
    assert.equal(asksAgain('Read the filed documents'), false);
    assert.equal(asksAgain('Re-read the documents'), true);
    assert.equal(asksAgain('read the documents again'), true);
  });
});

describe('what the screen takes a filed document to be', () => {
  function withRow(title: string, fileName: string, documentType?: string): DdProject {
    const project = createProject({ name: 'Client villas', type: 'residential', location: 'Hosakote', city: 'Bengaluru' }, 'RYT-0009');
    project.evidence.push({
      id: 'ev_row',
      title,
      kind: 'document',
      source: 'chat_upload',
      status: 'received',
      documentType,
      attachments: [{ id: 'file_1', fileName, mimeType: 'application/pdf', sizeBytes: 1000, storageKey: `doc/${fileName}`, uploadedAt: '2026-09-04T00:00:00.000Z' }],
      assessmentIds: [],
      scopeInstanceIds: [],
      checkIds: [],
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    } as unknown as DdProject['evidence'][number]);
    return project;
  }

  it('is what the document was read as, whatever its file is called', () => {
    const doc = projectToScreenDocuments(withRow('Registration', 'scan_0042.pdf', 'RERA registration certificate'))[0]!;
    assert.equal(doc.kind, 'rera_registration');
  });

  it('falls back to the file name, and knows a merged set of ECs by it', () => {
    const doc = projectToScreenDocuments(withRow('ECs merged', 'ECs_from_01.04.2015_to_13.05.2024_merged.pdf'))[0]!;
    assert.equal(doc.kind, 'encumbrance_certificate');
  });
});
