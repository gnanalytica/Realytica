/**
 * An upload does not get to say the same thing three times.
 *
 * Measured on a real six-file batch: the assistant's reply printed every
 * card's title and full rationale, the cards below reprinted both verbatim,
 * and the approval receipt printed the titles a third time next to raw
 * `ev_1a06…` ids. Roughly thirty lines of chat, most of it duplicated, for six
 * PDFs somebody had just dragged in themselves.
 *
 * Underneath the noise sat a worse problem. Four of those six files failed to
 * parse — a rate limit, a schema mismatch — and the provider's HTTP 400 body
 * was pasted into the card where a summary of the document belongs. The cards
 * looked identical to the two that had genuinely been read, so all six were
 * approved together and four evidence rows were filed carrying an error blob
 * as their extraction note.
 *
 * These tests pin both: the reply does not restate the cards, and a file whose
 * text never loaded says so instead of impersonating a classification.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyProjectChat,
  createProject,
  extractClaims,
  type ChatIngestFile,
  type DdProject,
} from '@realytica/shared';

const project = (): DdProject =>
  createProject({ name: 'Dream Acres', type: 'residential', location: 'Balagere', city: 'Bengaluru' }, 'RYT-C1');

const file = (fileName: string, extra: Partial<ChatIngestFile> = {}): ChatIngestFile => ({
  fileName,
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  storageKey: `s3://${fileName}`,
  ...extra,
});

/** The shape the reader hands back when a parse fails. */
const RATE_LIMITED =
  'The document reader was rate limited. The file is attached; upload it again to read it.';

describe('an upload reply does not restate its own cards', () => {
  it('says how many files, not what each one says', () => {
    const p = project();
    const result = applyProjectChat(p, '', {
      ingest: [file('RERA_Cert.pdf'), file('Environment_clearance.pdf')],
    });
    const text = result.assistantTurn.text;

    assert.equal(result.proposals?.length, 2, 'both files still produce a card');
    for (const card of result.proposals ?? []) {
      assert.ok(!text.includes(card.rationale), 'the reply must not reprint a card rationale');
      assert.ok(!text.includes(card.title), 'the reply must not reprint a card title');
    }
    assert.ok(text.length < 120, `the reply is one line, got ${text.length} chars: ${text}`);
    assert.match(text, /2 files/);
  });

  it('states a shared cause once rather than on every card', () => {
    const p = project();
    const result = applyProjectChat(p, '', {
      ingest: [
        file('BWSSB_NOC.pdf', { readFailure: RATE_LIMITED }),
        file('BESCOM_NOC.pdf', { readFailure: RATE_LIMITED }),
        file('AAI_NOC.pdf', { readFailure: RATE_LIMITED }),
      ],
    });
    const text = result.assistantTurn.text;
    assert.ok(text.startsWith(RATE_LIMITED), `the one cause leads: ${text}`);
    assert.equal(text.split('rate limited').length - 1, 1, 'said once, not three times');
    assert.match(text, /all 3 .*unread/);
  });

  it('counts the unreadable ones separately so the batch is not taken at face value', () => {
    const p = project();
    const result = applyProjectChat(p, '', {
      ingest: [
        file('RERA_Cert.pdf'),
        file('BWSSB_NOC.pdf', { readFailure: RATE_LIMITED }),
        file('BESCOM_NOC.pdf', { readFailure: RATE_LIMITED }),
      ],
    });
    assert.match(result.assistantTurn.text, /Read 1 file; 2 could not be read/);
  });

  it('receipts an approval without relisting titles or record ids', () => {
    const p = project();
    applyProjectChat(p, '', { ingest: [file('RERA_Cert.pdf'), file('EC.pdf')] });
    const approved = applyProjectChat(p, 'approve all');
    const text = approved.assistantTurn.text;

    assert.equal(p.evidence.length, 2, 'both were filed');
    assert.ok(!/ev_/.test(text), `no raw record ids in chat prose: ${text}`);
    assert.ok(!text.includes('RERA_Cert.pdf'), 'the cards already carry the names');
    assert.match(text, /Filed 2 cards/);
  });
});

describe('a file that could not be read says so', () => {
  it('never shows the provider error, and never claims a kind', () => {
    const p = project();
    const result = applyProjectChat(p, '', {
      ingest: [file('BWSSB_NOC.pdf', { readFailure: RATE_LIMITED })],
    });
    const card = result.proposals![0]!;

    assert.equal(card.title, 'BWSSB_NOC.pdf', 'no kind is claimed for a file nobody read');
    assert.ok(!/could not be read/.test(card.title), 'the badge says it; the title need not');
    assert.equal(card.rationale, RATE_LIMITED);
    assert.ok(!/\b400\b|invalid_request|request_id|\{"type"/.test(card.rationale), 'no transport detail reaches a person');
  });

  it('does not persist the failure as an extraction note on the evidence row', () => {
    const p = project();
    applyProjectChat(p, '', { ingest: [file('BWSSB_NOC.pdf', { readFailure: RATE_LIMITED })] });
    applyProjectChat(p, 'approve all');

    const row = p.evidence[0]!;
    assert.ok(row, 'the document is still filed — the PDF is real');
    assert.equal(row.extractionNotes, undefined, 'nothing was extracted, so there is no note');
  });

  it('drops the boilerplate that was identical on every card', () => {
    const p = project();
    const result = applyProjectChat(p, '', { ingest: [file('EC.pdf'), file('RERA.pdf')] });
    for (const card of result.proposals ?? []) {
      assert.ok(!/Matched scopes: none yet/.test(card.rationale), 'an absent match is not news');
      assert.ok(!/expected-evidence completeness updates/.test(card.impact), 'no schema-speak in the effect line');
    }
  });
});

describe('grounding flags do not fire on record ids', () => {
  it('ignores digits embedded in an identifier', () => {
    const claims = extractClaims('Queued as prp_1a06d6cf46b-7a5e5f8fcf1098-7134d3e8468978 and ev_1a06d6a157c-060786.');
    assert.deepEqual(claims, [], `an id is not a figure about the property, got ${JSON.stringify(claims)}`);
  });

  it('still catches a real figure beside one', () => {
    const claims = extractClaims('Row ev_1a06d6a157c-060786 carries a budget of ₹52,00,00,000.');
    assert.equal(claims.length, 1);
    assert.equal(claims[0]!.value, 520000000);
  });
});
