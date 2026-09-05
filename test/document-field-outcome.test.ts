/**
 * What survives a document read, and what a page reference is worth.
 *
 * This exists because of a real extraction. Pointed at an OpenAI-compatible
 * gateway, the Anthropic-shaped PDF request reached a non-Claude model, which
 * read a Karnataka encumbrance certificate correctly and returned ten fields.
 * None of them reached the case, and the run told the operator "the document
 * reader could not read this file".
 *
 * The cause was a promise being read instead of a result. The provider
 * descriptor declares `documentCitations: true` — truthfully, about the wire
 * format — so page verification was treated as available; no citations came
 * back, so no quote could be placed; every field was capped beneath the floor
 * and dropped. The branch that exists for exactly this case, which discounts
 * rather than drops, was unreachable.
 *
 * The per-call gap was already being detected and announced to the operator
 * two lines above the loop. It just was not being told to the code.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fieldOutcome } from '../packages/agents/src/agents/document-intelligence';

describe('a route whose citations arrived', () => {
  it('keeps a placed quote at the confidence the model gave it', () => {
    const out = fieldOutcome({ pageVerificationAvailable: true, citationsAvailable: true, sourcePage: 3, confidence: 0.9 });
    assert.deepEqual(out, { keep: true, confidence: 0.9 });
  });

  it('drops a quote the citation engine read the document and could not find', () => {
    const out = fieldOutcome({ pageVerificationAvailable: true, citationsAvailable: true, sourcePage: undefined, confidence: 0.9 });
    assert.equal(out.keep, false, 'words the document does not contain are not an extraction');
  });
});

describe('a route whose citations never arrived', () => {
  it('keeps every field, discounted, rather than reporting an unreadable document', () => {
    const out = fieldOutcome({ pageVerificationAvailable: false, citationsAvailable: false, sourcePage: undefined, confidence: 0.9 });
    assert.equal(out.keep, true, 'ten fields read and none kept told the operator a falsehood');
    assert.ok(out.confidence < 0.9, 'nothing checked these values, and that has to show');
    assert.ok(out.confidence > 0, 'discounted is not the same as absent');
  });

  it('discounts a low-confidence field further rather than promoting it', () => {
    const low = fieldOutcome({ pageVerificationAvailable: false, citationsAvailable: false, sourcePage: undefined, confidence: 0.3 });
    const high = fieldOutcome({ pageVerificationAvailable: false, citationsAvailable: false, sourcePage: undefined, confidence: 0.95 });
    assert.ok(low.confidence < high.confidence);
    assert.ok(high.confidence <= 0.45, 'the ceiling holds however sure the model claims to be');
  });

  it('is the branch taken when the route promised citations but the call got none', () => {
    // The exact production shape: the descriptor said true, the answer said
    // otherwise, and `citationsAvailable` must carry the answer.
    const declaredButAbsent = fieldOutcome({
      pageVerificationAvailable: false,
      citationsAvailable: false,
      sourcePage: undefined,
      confidence: 0.85,
    });
    assert.equal(declaredButAbsent.keep, true);
  });
});

describe('an image, which never had a page to lose', () => {
  it('passes through untouched on a full-capability route', () => {
    const out = fieldOutcome({ pageVerificationAvailable: false, citationsAvailable: true, sourcePage: undefined, confidence: 0.8 });
    assert.deepEqual(out, { keep: true, confidence: 0.8 });
  });
});

describe('confidence is clamped before anything else happens to it', () => {
  it('refuses a value outside 0..1 rather than carrying it into the case', () => {
    assert.equal(fieldOutcome({ pageVerificationAvailable: false, citationsAvailable: true, sourcePage: undefined, confidence: 1.7 }).confidence, 1);
    assert.equal(fieldOutcome({ pageVerificationAvailable: false, citationsAvailable: true, sourcePage: undefined, confidence: -2 }).confidence, 0);
  });
});
