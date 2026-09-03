/**
 * Which way a comparable adjustment points.
 *
 * An adjustment brings a comparable to what it would have fetched with the
 * SUBJECT's characteristics, so the sign always describes the subject: a
 * subject on a narrow road prices its comparables down, a corner-site subject
 * prices them up. Every adjustment in `adjustComparable` follows that except
 * the size one, which was written from the comparable's side and therefore
 * carried the opposite sign — a 40sqm subject was priced 3% BELOW its 145sqm
 * comparables, when the engine's own stated principle is that a smaller unit
 * commands a premium per sqm.
 *
 * It went unnoticed because nothing pinned the direction. Magnitudes are the
 * engine's business and may be tuned; the direction is a correctness property
 * and is pinned here, for size and for the two adjustments that establish the
 * convention it has to agree with.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { screenSeed } from './fixtures';

/** The signed percentage of one adjustment on the first comparable that has it. */
function adjustmentPct(
  result: ReturnType<typeof screenSeed>['result'],
  key: string,
): number | undefined {
  for (const comp of result.comparables) {
    const found = comp.adjustments?.find((a) => a.key === key);
    if (found) return found.pct;
  }
  return undefined;
}

describe('comparable adjustment direction', () => {
  it('prices comparables UP when the subject is smaller than them', () => {
    // The fixture's comparables sit around 100-145sqm, so 40 is decisively
    // smaller than all of them.
    const { result } = screenSeed('3BHK', { identity: { builtUpAreaSqm: 40 } });
    const size = adjustmentPct(result, 'size');
    assert.ok(size !== undefined, 'a subject this much smaller must attract a size adjustment');
    assert.ok(
      size > 0,
      `a smaller subject commands a premium per sqm, so its comparables adjust upward — got ${size}%`,
    );
  });

  it('prices comparables DOWN when the subject is larger than them', () => {
    const { result } = screenSeed('3BHK', { identity: { builtUpAreaSqm: 500 } });
    const size = adjustmentPct(result, 'size');
    assert.ok(size !== undefined, 'a subject this much larger must attract a size adjustment');
    assert.ok(
      size < 0,
      `a larger subject transacts at a discount per sqm, so its comparables adjust downward — got ${size}%`,
    );
  });

  it('adjusts for size exactly when the areas differ by more than a fifth', () => {
    // Inside the tolerance the adjustment is noise: one firing on a 5%
    // difference would imply a precision the comparable pool does not have.
    // Outside it, one must fire — a 3x area difference priced as equivalent is
    // the same error as pricing it the wrong way.
    const subjectArea = 120;
    const { result } = screenSeed('3BHK', { identity: { builtUpAreaSqm: subjectArea } });
    assert.ok(result.comparables.length > 0, 'the fixture must produce comparables');

    for (const comp of result.comparables) {
      const size = comp.adjustments?.find((a) => a.key === 'size');
      const smaller = subjectArea < comp.areaSqm / 1.2;
      const larger = subjectArea > comp.areaSqm * 1.2;
      if (smaller) {
        assert.ok(size && size.pct > 0, `${comp.areaSqm}sqm comp vs ${subjectArea}sqm subject should adjust up`);
      } else if (larger) {
        assert.ok(size && size.pct < 0, `${comp.areaSqm}sqm comp vs ${subjectArea}sqm subject should adjust down`);
      } else {
        assert.equal(size, undefined, `${comp.areaSqm}sqm is within a fifth of ${subjectArea}sqm — no size adjustment`);
      }
    }
  });

  it('agrees with tenure, which sets the convention', () => {
    // A leasehold subject is worth less than the freehold pool, so its
    // comparables come down. This is the adjustment the size sign has to match.
    const { result } = screenSeed('3BHK', { identity: { tenure: 'leasehold' } });
    const tenure = adjustmentPct(result, 'tenure');
    assert.ok(tenure !== undefined, 'a leasehold subject must attract a tenure adjustment');
    assert.ok(tenure < 0, `a leasehold subject prices its freehold comparables down — got ${tenure}%`);
  });

  it('carries every adjustment through to the adjusted rate, compounding', () => {
    // The chain is multiplicative, so the adjusted rate must be the raw rate
    // with each percentage applied in turn — not a sum, and not the raw rate
    // with the adjustments recorded beside it and never used.
    const { result } = screenSeed('3BHK', { identity: { builtUpAreaSqm: 40, tenure: 'leasehold' } });
    const comp = result.comparables.find((c) => (c.adjustments ?? []).length >= 2);
    assert.ok(comp, 'the fixture must produce a comparable carrying at least two adjustments');
    const expected = (comp.adjustments ?? []).reduce((running, a) => running * (1 + a.pct / 100), comp.pricePerSqm);
    // Rounded to the currency's own step by `roundRate`, so compare loosely.
    assert.ok(
      Math.abs(comp.adjustedPricePerSqm - expected) / expected < 0.02,
      `adjusted rate ${comp.adjustedPricePerSqm} should be the compounded ${Math.round(expected)}`,
    );
  });

  it('scales with how different the sizes are, rather than a flat band', () => {
    // The step function priced a 3x difference and a 1.25x difference the
    // same. The point of a curve is that it does not.
    const near = screenSeed('3BHK', { identity: { builtUpAreaSqm: 90 } }).result;
    const far = screenSeed('3BHK', { identity: { builtUpAreaSqm: 20 } }).result;
    const nearPct = adjustmentPct(near, 'size');
    const farPct = adjustmentPct(far, 'size');
    assert.ok(nearPct !== undefined && farPct !== undefined, 'both subjects differ enough to be adjusted');
    assert.ok(
      farPct > nearPct,
      `a subject 5x smaller must attract a larger premium than one slightly smaller — got ${farPct}% vs ${nearPct}%`,
    );
  });

  it('never lets one size adjustment carry the valuation', () => {
    // Beyond a point the comparable is a different product, not a different
    // size, and an unbounded elasticity would let it swamp everything else.
    const { result } = screenSeed('3BHK', { identity: { builtUpAreaSqm: 1 } });
    for (const comp of result.comparables) {
      const size = comp.adjustments?.find((a) => a.key === 'size');
      if (!size) continue;
      assert.ok(Math.abs(size.pct) <= 12, `size adjustment ${size.pct}% must stay inside the cap`);
    }
  });
});
