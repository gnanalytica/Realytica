/**
 * What the comparable anchor is a mean OF.
 *
 * The adjustment schedule foots its rows with a claim about the ENGINE, made
 * by a component that cannot see the engine: "Weighted mean — the rate the
 * comparable approach uses", derived as Σ(adjusted rate × similarity) ÷
 * Σ similarity, with low and high given as the least and greatest adjusted
 * rates rather than as a confidence interval.
 *
 * That is the shape of statement that goes quietly wrong. Change the engine to
 * a median, an unweighted mean, or start trimming outliers, and the table keeps
 * printing a formula that no longer produces the valuation beside it — and
 * nothing fails, because the table recomputes its own footer from the same
 * comparables and so still agrees with itself. It would simply be describing a
 * calculation the valuation no longer performs.
 *
 * ## Why the assertions are ratios
 *
 * The anchor is a rate times an area, and the area is chosen inside the engine
 * and never published on the anchor. Dividing one anchor figure by another
 * cancels it exactly, so `mid / high` is a pure statement about which rate the
 * mid came from — recoverable without guessing at the area and without the
 * circularity of deriving the area from the same relationship being tested.
 *
 * Each test asserts BOTH that the weighted prediction holds and that the
 * unweighted one holds less well. The second half is what stops this passing
 * against an engine that dropped the weighting: on the seeded set the two means
 * differ by only a fraction of a percent, so an assertion loose enough to
 * absorb rounding would otherwise accept either.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { screenSeed } from './fixtures';

/** The comparable-sales anchor and the transactions behind it. */
function comparableSet(overrides: Parameters<typeof screenSeed>[1] = {}) {
  const { result } = screenSeed('3BHK', overrides);
  const anchor = result.anchors.find((a) => a.method === 'comparable_sales');
  assert.ok(anchor, 'the fixture must produce a comparable-sales anchor');
  const comparables = result.comparables;
  assert.ok(comparables.length > 1, 'a mean over one transaction proves nothing');

  const weights = comparables.map((c) => c.similarity || 0.01);
  const total = weights.reduce((a, b) => a + b, 0);
  const rates = comparables.map((c) => c.adjustedPricePerSqm);

  return {
    anchor,
    comparables,
    rates,
    weighted: comparables.reduce((s, c, i) => s + c.adjustedPricePerSqm * weights[i], 0) / total,
    flat: rates.reduce((a, b) => a + b, 0) / comparables.length,
  };
}

/*
 * Rounding room on a ratio of two rounded currency figures.
 *
 * Measured rather than guessed: the seeded sets land within 3.4e-5 of the
 * weighted prediction, and no closer than 3.4e-4 to the unweighted one. This
 * sits an order of magnitude above the first and an order below the second.
 */
const RATIO_TOLERANCE = 1e-4;

describe('comparable aggregation', () => {
  for (const [name, overrides] of [
    ['the seeded subject', {}],
    // A subject much larger than its comparables, which spreads the similarity
    // scores and so widens the gap between the two candidate means.
    ['a subject far larger than its comparables', { identity: { builtUpAreaSqm: 900 } }],
  ] as [string, Parameters<typeof screenSeed>[1]][]) {
    it(`weights by similarity rather than averaging flat — ${name}`, () => {
      const { anchor, rates, weighted, flat } = comparableSet(overrides);
      const peak = Math.max(...rates);

      const actual = anchor.mid / anchor.high;
      const ifWeighted = weighted / peak;
      const ifFlat = flat / peak;

      const errWeighted = Math.abs(actual - ifWeighted);
      const errFlat = Math.abs(actual - ifFlat);

      assert.ok(
        errWeighted < RATIO_TOLERANCE,
        `mid ÷ high is ${actual}; a similarity-weighted mean predicts ${ifWeighted} (off by ${errWeighted})`,
      );
      // The half that gives the test its teeth.
      assert.ok(
        errFlat > errWeighted * 3,
        `the weighted and unweighted means are too close on this fixture to tell apart — ` +
          `weighted err ${errWeighted}, flat err ${errFlat}`,
      );
    });
  }

  it('takes its low and high from the extremes of the set, not from a percentile', () => {
    const { anchor, rates, weighted } = comparableSet();
    // Both ends expressed against the mid, so the area cancels the same way.
    assert.ok(
      Math.abs(anchor.low / anchor.mid - Math.min(...rates) / weighted) < RATIO_TOLERANCE,
      `low ÷ mid is ${anchor.low / anchor.mid}; the least adjusted rate over the weighted mean is ${Math.min(...rates) / weighted}`,
    );
    assert.ok(
      Math.abs(anchor.high / anchor.mid - Math.max(...rates) / weighted) < RATIO_TOLERANCE,
      `high ÷ mid is ${anchor.high / anchor.mid}; the greatest adjusted rate over the weighted mean is ${Math.max(...rates) / weighted}`,
    );
  });

  it('keeps every transaction — the extremes are the set’s own, not a trimmed one', () => {
    /*
     * The schedule renders one row per comparable and foots them to the anchor.
     * If the engine ever discarded a transaction before averaging, the rows
     * would no longer add up to the total printed under them, and the table
     * would be the last place anybody thought to look for the discrepancy.
     */
    const { anchor, rates, weighted } = comparableSet();
    const sorted = [...rates].sort((a, b) => a - b);
    assert.ok(sorted.length >= 3, 'need at least three to tell a trimmed range from a full one');

    // What the anchor would look like if the outermost transaction at each end
    // had been dropped — which is what a trimmed mean does and what this must
    // not match.
    const trimmedLow = sorted[1] / weighted;
    assert.ok(
      Math.abs(anchor.low / anchor.mid - sorted[0] / weighted) <
        Math.abs(anchor.low / anchor.mid - trimmedLow),
      'the anchor low must follow the lowest transaction, not the second lowest',
    );
  });

  it('never puts the mid outside its own band', () => {
    // A mean of a set cannot fall outside the set. Asserted because the
    // schedule prints the range and the mean on one row, where a reader spots
    // a contradiction well before any test does.
    const { anchor } = comparableSet();
    assert.ok(
      anchor.low <= anchor.mid && anchor.mid <= anchor.high,
      `${anchor.low} ≤ ${anchor.mid} ≤ ${anchor.high}`,
    );
  });
});
