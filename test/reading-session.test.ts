/**
 * A reading, folded from the upload turn's stream into what the canvas draws.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatProposal, DocumentFact } from '@realytica/shared';
import {
  applyReadingEvent,
  cardStateFor,
  finishReading,
  newReadingSession,
  readingFileFromProposal,
} from '../apps/web/src/lib/reading';

const fact = (key: string, source?: 'model'): DocumentFact => ({ key, label: key, value: key, display: key, page: 1, quote: key, ...(source ? { source } : {}) });

const start = (over: Record<string, unknown> = {}) =>
  ({ type: 'reading', event: 'start', key: 'doc_1/deed.pdf', fileName: 'deed.pdf', mimeType: 'application/pdf', sizeBytes: 10, index: 0, total: 1, ...over }) as const;

describe('a reading as it streams', () => {
  it('draws a dropped file from the file itself and a filed one from its row', () => {
    const local = new File(['x'], 'deed.pdf', { type: 'application/pdf' });
    const a = applyReadingEvent(newReadingSession(), start({ sizeBytes: local.size }), { localFiles: [local] });
    assert.equal(a.files[0]!.source?.kind, 'local');
    const b = applyReadingEvent(newReadingSession(), start({ evidenceId: 'ev_1', fileId: 'f_1' }));
    assert.deepEqual(b.files[0]!.source, { kind: 'evidence', evidenceId: 'ev_1', fileId: 'f_1' });
  });

  it('follows the pages, then the facts, then what only the model added', () => {
    let s = applyReadingEvent(newReadingSession(), start());
    s = applyReadingEvent(s, { type: 'reading', event: 'page', key: 'doc_1/deed.pdf', page: 2, of: 3 });
    assert.equal(s.files[0]!.page, 2);
    assert.equal(s.files[0]!.pages, 3);
    s = applyReadingEvent(s, { type: 'reading', event: 'read', key: 'doc_1/deed.pdf', label: 'Sale deed', facts: [fact('vendor'), fact('survey_numbers')] });
    assert.equal(s.files[0]!.phase, 'read');
    assert.equal(s.files[0]!.facts.length, 2);
    s = applyReadingEvent(s, { type: 'reading', event: 'model', key: 'doc_1/deed.pdf', phase: 'start' });
    assert.equal(s.files[0]!.phase, 'model');
    s = applyReadingEvent(s, { type: 'reading', event: 'model', key: 'doc_1/deed.pdf', phase: 'done', facts: [fact('vendor', 'model'), fact('consideration', 'model')], notes: 'A sale deed.' });
    assert.deepEqual(s.files[0]!.modelFacts.map((f) => f.key), ['consideration'], 'the model does not repeat what the page gave');
    assert.equal(s.files[0]!.notes, 'A sale deed.');
  });

  it('settles every file when the turn ends, and calls one with nothing read a failure', () => {
    let s = applyReadingEvent(newReadingSession(), start());
    s = applyReadingEvent(s, start({ key: 'doc_2/ec.pdf', fileName: 'ec.pdf', index: 1 }));
    s = applyReadingEvent(s, { type: 'reading', event: 'read', key: 'doc_1/deed.pdf', facts: [fact('vendor')] });
    s = finishReading(s);
    assert.equal(s.finished, true);
    assert.deepEqual(s.files.map((f) => f.phase), ['done', 'failed']);
  });
});

describe('a document card on the desk', () => {
  const card = (status: ChatProposal['status']): ChatProposal =>
    ({
      id: 'cp_1',
      kind: 'file_evidence',
      title: 'deed.pdf → Title extract',
      status,
      payload: { storageKey: 'doc_1/deed.pdf', fileName: 'deed.pdf', mimeType: 'application/pdf', documentType: 'Sale deed', facts: [fact('vendor'), fact('consideration', 'model')] },
    }) as unknown as ChatProposal;

  it('is drawn from the card, with its own file', () => {
    const file = readingFileFromProposal(card('proposed'))!;
    assert.deepEqual(file.source, { kind: 'proposal', proposalId: 'cp_1' });
    assert.deepEqual(file.facts.map((f) => f.key), ['vendor']);
    assert.deepEqual(file.modelFacts.map((f) => f.key), ['consideration']);
  });

  it('turns filed when its card is approved', () => {
    assert.equal(cardStateFor('doc_1/deed.pdf', [card('proposed')]), 'proposed');
    assert.equal(cardStateFor('doc_1/deed.pdf', [card('committed')]), 'committed');
    assert.equal(cardStateFor('doc_9/other.pdf', [card('committed')]), null);
  });
});
