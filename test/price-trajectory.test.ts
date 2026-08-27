/**
 * The parcel's own price trajectory.
 *
 * The honesty assertions carry the weight: only dated conveyances with a
 * recited consideration may appear, the Indian understatement caveat must be
 * present in words and as a flag, and no point may sit later than the
 * screen's own timestamp — the trajectory ends at today's indicative mid and
 * projects nothing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOW, screenSeed } from './fixtures';

describe('a documented Bengaluru site', () => {
  // Site 118 carries a sale deed and a mother deed, both dated and both
  // reciting a consideration, so the registered record has two points.
  const { result } = screenSeed('Site No. 118');

  it('draws the registered record plus today, in order', () => {
    const trajectory = result.priceTrajectory;
    assert.ok(trajectory, 'expected a trajectory on a case with dated conveyances');
    const registered = trajectory.points.filter(p => p.kind === 'registered');
    assert.equal(registered.length, 2);
    const dates = trajectory.points.map(p => p.at);
    assert.deepEqual(dates, [...dates].sort(), 'points must be in date order');
    const last = trajectory.points[trajectory.points.length - 1];
    assert.equal(last.kind, 'indicative');
    assert.equal(last.at, NOW);
    assert.equal(last.amount, result.indicativeValue.mid);
  });

  it('every registered point traces to an instrument', () => {
    const trajectory = result.priceTrajectory;
    assert.ok(trajectory);
    for (const point of trajectory.points.filter(p => p.kind === 'registered')) {
      assert.ok(point.documentId, `registered point "${point.label}" must cite its document`);
      assert.ok(point.amount > 0);
    }
  });

  it('states the understatement caveat for an Indian record, in words and as a flag', () => {
    const trajectory = result.priceTrajectory;
    assert.ok(trajectory);
    assert.equal(trajectory.understatementLikely, true);
    assert.ok(trajectory.statements.some(s => /dutiable value|guidance value/i.test(s)));
  });

  it('computes growth only across a real span, and projects nothing', () => {
    const trajectory = result.priceTrajectory;
    assert.ok(trajectory);
    // Mother deed (1994-2008) to sale deed (2015+) is well over a year.
    assert.ok(trajectory.registeredCagrPct !== undefined);
    assert.ok(trajectory.statements.some(s => /No projection/i.test(s)));
    assert.ok(trajectory.points.every(p => p.at <= NOW));
  });
});

describe('a record with nothing to draw', () => {
  it('an Amsterdam case with no consideration-bearing conveyance has no trajectory', () => {
    // The Van Woustraat seed holds a koopovereenkomst (an agreement, which
    // does not convey) and a Kadaster extract — no conveyance recites a
    // consideration, so there is no history to draw and none is invented.
    const { result } = screenSeed('Van Woustraat');
    assert.equal(result.priceTrajectory, undefined);
  });
});
