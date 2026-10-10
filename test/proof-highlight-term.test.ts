import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { proofHighlightTerm } from '../apps/web/src/components/reading/find-on-page';

describe('proofHighlightTerm', () => {
  it('returns nothing when the fact already has marks on the page', () => {
    assert.equal(
      proofHighlightTerm({
        display: '2 Acres 18 Guntas',
        quote: 'totally measuring 2 Acres 18 Guntas), all situated',
        marks: { quote: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }] },
      }),
      undefined,
    );
  });

  it('prefers the value as it sits inside the quote', () => {
    assert.equal(
      proofHighlightTerm({
        display: '2 Acres 18 Guntas Acres-Guntas',
        value: '2 Acres 18 Guntas',
        quote: 'totally measuring 2 Acres 18 Guntas), all situated in Balagere Village',
      }),
      '2 Acres 18 Guntas',
    );
  });

  it('falls back to a short stretch of the quote', () => {
    const term = proofHighlightTerm({
      display: 'something else',
      quote: 'totally measuring two acres eighteen guntas all situated in Balagere Village of the said Hobli',
    });
    assert.equal(term, 'totally measuring two acres eighteen guntas');
  });
});
