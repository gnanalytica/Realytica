/**
 * Recovering an identifier the model transliterated.
 *
 * The failure this exists for is measured, not imagined: `pnpm
 * eval:multilingual` shows `౨౧౪/అ` coming back as `214/A` from a model that
 * was told in the same paragraph not to do exactly that. What makes it the
 * worst failure in the product is that `214/A` is a WELL-FORMED survey
 * number — it names a different plot, it passes every downstream check
 * because there is nothing wrong with it, and no reader can catch it without
 * the page.
 *
 * So most of what is asserted here is the abstaining. A wrong correction
 * would be the same class of failure with our name on it, so ambiguity,
 * digit mismatches and pages that offer nothing better all have to leave the
 * value alone.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prepareValue, recoverIdentifierFromSource } from '@realytica/shared';

const TELUGU_DEED = `సర్వే నంబరు (Survey No.): ౨౧౪/అ\nవిస్తీర్ణం: ౩౦౦ చదరపు గజాలు`;

describe('recoverIdentifierFromSource', () => {
  it('restores the letter the model romanised', () => {
    assert.equal(recoverIdentifierFromSource('214/A', TELUGU_DEED), '214/అ');
  });

  it('keeps digits Latin while restoring the letter', () => {
    // Both halves of the rule at once: ౨౧౪ and 214 are the same number and
    // should read as 214, but అ has no English spelling.
    const out = recoverIdentifierFromSource('214/A', TELUGU_DEED);
    assert.ok(/^214\//.test(out), `expected Latin digits, got ${out}`);
  });

  it('abstains when the page offers two candidates', () => {
    // Guessing between them is the thing this exists to stop.
    const two = 'Plot ౨౧౪/అ and adjoining ౨౧౪/బ';
    assert.equal(recoverIdentifierFromSource('214/A', two), '214/A');
  });

  it('never changes a digit', () => {
    // Only letter positions may differ. A page saying 216 must not rewrite a
    // model that said 214 — that is a different plot in the other direction.
    assert.equal(recoverIdentifierFromSource('214/A', 'సర్వే ౨౧౬/అ'), '214/A');
  });

  it('leaves an already-Latin identifier alone', () => {
    assert.equal(recoverIdentifierFromSource('KH-7741-B/2019', 'Khata No.: KH-7741-B/2019'), 'KH-7741-B/2019');
  });

  it('leaves a value the page does not mention alone', () => {
    assert.equal(recoverIdentifierFromSource('999/Z', TELUGU_DEED), '999/Z');
  });

  it('does nothing without a page to check against', () => {
    assert.equal(recoverIdentifierFromSource('214/A', ''), '214/A');
  });
});

describe('prepareValue with the page in hand', () => {
  it('recovers for an identifier key', () => {
    assert.equal(prepareValue('surveyNumber', '214/A', undefined, TELUGU_DEED).value, '214/అ');
  });

  it('does not touch a NAME, which is supposed to be romanised', () => {
    // Rule 1 and rule 2 pull in opposite directions and the key is what
    // decides which applies. Recovering a name from the page would undo the
    // reading the product asks for.
    const out = prepareValue('vendorName', 'Venkateswarlu', 'వెంకటేశ్వర్లు', TELUGU_DEED);
    assert.equal(out.value, 'Venkateswarlu');
    assert.equal(out.original, 'వెంకటేశ్వర్లు');
  });

  it('behaves exactly as before when no page is supplied', () => {
    assert.equal(prepareValue('surveyNumber', '214/A').value, '214/A');
  });
});
