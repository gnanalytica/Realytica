/**
 * What a reviewed chat card may and may not change about itself.
 *
 * The wizard turned Approve from a blind commit into a form, which means a
 * payload composed on the server now comes back from a browser. Two rules
 * follow, and this pins both: the person's corrections win, and the card's
 * subject is not up for negotiation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROPOSAL_IDENTITY, applyReviewedPayload } from '../apps/api/src/proposal-review';

describe('a reviewed proposal', () => {
  it('files the values the person confirmed, not the ones proposed', () => {
    const stored: Record<string, unknown> = { name: 'Land parcel', assetType: 'Land' };
    applyReviewedPayload(stored, { name: 'North land parcel', assetType: 'Land' });
    assert.equal(stored.name, 'North land parcel');
  });

  it('keeps payload the form never rendered', () => {
    // A `file_evidence` card carries a storage key, page count and quotes that
    // no form shows. Editing the title must not detach the document.
    const stored: Record<string, unknown> = {
      title: 'Sale deed',
      storageKey: 'ev/abc123',
      pages: 14,
      quotes: [{ text: 'conveys 1,200 sqm', page: 3 }],
    };
    applyReviewedPayload(stored, { title: 'Sale deed (2019)' });
    assert.equal(stored.title, 'Sale deed (2019)');
    assert.equal(stored.storageKey, 'ev/abc123');
    assert.equal(stored.pages, 14);
    assert.deepEqual(stored.quotes, [{ text: 'conveys 1,200 sqm', page: 3 }]);
  });

  it('refuses to be pointed at a different subject', () => {
    const stored: Record<string, unknown> = {
      checkId: 'chk_real',
      storageKey: 'ev/original',
      values: { extent_survey: 1200 },
    };
    applyReviewedPayload(stored, {
      checkId: 'chk_somebody_elses',
      storageKey: 'ev/swapped',
      values: { extent_survey: 9999 },
    });
    // The reading is the person's to correct; which check it lands on is not.
    assert.equal(stored.checkId, 'chk_real');
    assert.equal(stored.storageKey, 'ev/original');
    assert.deepEqual(stored.values, { extent_survey: 9999 });
  });

  it('leaves the card alone when nothing was confirmed', () => {
    // Approve with no wizard — an upload filed in one click — must behave
    // exactly as it did before the wizard existed.
    const stored: Record<string, unknown> = { title: 'Encumbrance certificate' };
    applyReviewedPayload(stored, undefined);
    assert.deepEqual(stored, { title: 'Encumbrance certificate' });
  });

  it('guards every key that names a record or a file', () => {
    // A reminder to extend the set when a new card kind carries a new subject.
    for (const key of ['storageKey', 'checkId', 'reportId', 'blockId', 'draftIds', 'evidenceId', 'assetId']) {
      assert.ok(PROPOSAL_IDENTITY.has(key), `${key} should be an identity key`);
    }
  });
});
