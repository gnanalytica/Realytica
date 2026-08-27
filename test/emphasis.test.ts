/**
 * Finding the quantities in a sentence.
 *
 * Two failure modes, and both make a page worse than plain text: missing the
 * number a reader came for, and emphasising so much that nothing stands out.
 * These test the boundary between them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emphasise, quantityDensity, splitLead } from '@realytica/shared';

const marked = (text: string) => emphasise(text).filter(s => s.quantity).map(s => s.text);
const rejoined = (text: string) => emphasise(text).map(s => s.text).join('');

describe('what counts as a quantity', () => {
  it('finds currency, percentages and areas', () => {
    assert.deepEqual(marked('The mid is ₹41.5 L against 4,000 sqm, 16.7% above the floor.'), [
      '₹41.5 L',
      '4,000 sqm',
      '16.7%',
    ]);
  });

  it('finds counts with their units', () => {
    assert.deepEqual(marked('172 spaces across 2 levels on 9 floors.'), ['172 spaces', '2 levels', '9 floors']);
  });

  it('finds a bare number with no unit', () => {
    assert.deepEqual(marked('FAR 2.75 applies.'), ['2.75']);
  });

  it('leaves ordinary words alone', () => {
    assert.deepEqual(marked('The register holds nothing against this parcel.'), []);
  });

  it('never eats a following word as a unit', () => {
    // "5 of" and "3 the" would emphasise half a sentence if the unit list
    // were open. It is closed for exactly this reason.
    assert.deepEqual(marked('5 of the 3 checks'), ['5', '3']);
  });
});

describe('the split is lossless', () => {
  for (const sentence of [
    'The mid is ₹41.5 L against 4,000 sqm, 16.7% above the floor.',
    'No numbers here at all.',
    '2026-08-26',
    '',
    '100%',
    'Ends with a number 42',
  ]) {
    it(`rejoins to the original: ${JSON.stringify(sentence.slice(0, 30))}`, () => {
      assert.equal(rejoined(sentence), sentence);
    });
  }
});

describe('density, so emphasis can be skipped where it would not help', () => {
  it('is low for prose', () => {
    assert.ok(quantityDensity('The register holds nothing against this parcel.') < 0.05);
  });

  it('is high for a figure list', () => {
    // Bolding all of this would be the same as bolding none of it.
    assert.ok(quantityDensity('₹41.5 L · 4,000 sqm · 16.7% · 9 floors') > 0.6);
  });

  it('is zero for an empty string, not NaN', () => {
    assert.equal(quantityDensity(''), 0);
  });
});

describe('splitting a lead sentence off the working', () => {
  it('splits at a real sentence end', () => {
    const { lead, rest } = splitLead('This site cannot carry this scheme. The setbacks leave 21 sqm.');
    assert.equal(lead, 'This site cannot carry this scheme.');
    assert.equal(rest, 'The setbacks leave 21 sqm.');
  });

  it('does not split on a decimal point', () => {
    const { rest } = splitLead('FAR 1.75 applies here because the road is 9m wide.');
    assert.equal(rest, '', 'a decimal is not a sentence end');
  });

  it('does not split on a statute reference', () => {
    const { rest } = splitLead('Duty is charged under s.45B on the higher of the two.');
    assert.equal(rest, '');
  });

  it('does not split on an abbreviation like No.', () => {
    const { rest } = splitLead('Survey No. 42 is the parcel in question here.');
    assert.equal(rest, '');
  });

  it('returns the whole string when there is only one sentence', () => {
    const { lead, rest } = splitLead('One sentence with no follower.');
    assert.equal(lead, 'One sentence with no follower.');
    assert.equal(rest, '');
  });

  it('loses nothing it split', () => {
    const original = 'A short claim here. And the working behind it, at length.';
    const { lead, rest } = splitLead(original);
    assert.equal(`${lead} ${rest}`, original);
  });
});

describe('splitting where this domain makes it hard', () => {
  it('splits when the next sentence starts with a digit', () => {
    // Real string from a compliance check. The second sentence carries the
    // finding, so failing to split here leaves a three-line row.
    const { lead, rest } = splitLead(
      'The encumbrance certificate on file spans 2012-2024 — 12 years of the 30-year window ending 2026. 1996-2012 is not searched.',
    );
    assert.match(lead, /window ending 2026\.$/);
    assert.match(rest, /^1996-2012/);
  });

  it('still refuses to split at Survey No.', () => {
    // Allowing a digit start is what makes this dangerous: "No. 42" is a word,
    // a stop, a space and a digit, which is exactly a sentence break.
    const { rest } = splitLead('The parcel is Survey No. 42 in Devanahalli, and the deed agrees.');
    assert.equal(rest, '');
  });

  it('refuses the other abbreviations this domain is full of', () => {
    for (const text of [
      'Duty is charged under Cl. 7 of the agreement on the higher figure.',
      'The consideration recorded is Rs. 40 lakh against a guidance value above it.',
      'The extent is approx. 220 sqm on the schedule attached to the deed.',
    ]) {
      assert.equal(splitLead(text).rest, '', `wrongly split: ${text}`);
    }
  });

  it('loses nothing when it does split on a digit start', () => {
    const original = 'A claim ending in a year 2026. 1996 is when the other thing happened.';
    const { lead, rest } = splitLead(original);
    assert.equal(`${lead} ${rest}`, original);
  });
});

describe('identifiers are not quantities', () => {
  it('leaves a statute citation alone', () => {
    // Three numbers, none of which a reader is scanning for. Bolding them
    // puts weight on the part of the sentence carrying no decision.
    assert.deepEqual(marked('Karnataka Stamp Act 1957, Article 20, s.3-B applies.'), []);
  });

  it('leaves a plan name alone', () => {
    assert.deepEqual(marked('RMP 2015 as revised.'), []);
    assert.deepEqual(marked('Registration Act 1908 governs this.'), []);
  });

  it('leaves a survey number alone', () => {
    assert.deepEqual(marked('Survey No. 42 in Devanahalli.'), []);
    assert.deepEqual(marked('Form 15 was issued.'), []);
  });

  it('still weights a year that is part of a range', () => {
    // A lookback period is a real quantity — the difference is the dash.
    assert.deepEqual(marked('The certificate covers 2013-2025 only.'), ['2013', '2025']);
    assert.deepEqual(marked('It spans 2012–2024.'), ['2012', '2024']);
  });

  it('still weights a year carrying a unit', () => {
    assert.deepEqual(marked('Built in 2018 and sold 3 years later.'), ['3 years']);
  });

  it('is still lossless when it skips', () => {
    const text = 'Karnataka Stamp Act 1957, Article 20, and ₹41.5 L besides.';
    assert.equal(emphasise(text).map(s => s.text).join(''), text);
    assert.deepEqual(marked(text), ['₹41.5 L']);
  });
});

describe('filenames are identifiers too', () => {
  it('leaves a number inside a filename alone', () => {
    // One identifier, not a figure. Weighting the middle of it reads as a typo.
    assert.deepEqual(marked('EC_30Year_2025_Devanahalli.pdf covers the period.'), []);
    assert.deepEqual(marked('See Sale_Deed_2024_Site118.pdf for the schedule.'), []);
  });

  it('still weights the figures in the same sentence', () => {
    assert.deepEqual(
      marked('EC_30Year_2025.pdf covers 2013-2025, leaving 2 years unsearched.'),
      ['2013', '2025', '2 years'],
    );
  });

  it('stays lossless around a filename', () => {
    const text = 'Read Khata_Extract_2025.pdf and note the 220 sqm.';
    assert.equal(emphasise(text).map(s => s.text).join(''), text);
  });
});

describe('emphasis stops at the number', () => {
  it('does not swallow a trailing comma', () => {
    // The digit class `[\d,]*` ended on the separator, so "covers 2013-2025,
    // leaving" bolded the comma and the weight ran into the next clause.
    assert.deepEqual(marked('covers 2013-2025, leaving a gap'), ['2013', '2025']);
    assert.deepEqual(marked('₹41,500, plus duty'), ['₹41,500']);
  });

  it('keeps the separators inside a number', () => {
    assert.deepEqual(marked('a total of 41,500,000 rupees'), ['41,500,000']);
  });
});
