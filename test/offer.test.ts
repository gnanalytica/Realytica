/**
 * Offer advice and forced-sale value.
 *
 * These two turn the range, the costs and the findings into numbers a buyer
 * acts on, so the assertions here are mostly about *refusals*: that an
 * unquantified defect stays unquantified, that a blocker suppresses the
 * headroom rather than lowering the price, and that a cheap-looking ask is
 * not reported as a bargain.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { screenSeed, preciseSiteContext } from './fixtures';

describe('offer advice', () => {
  test('a clean, fully documented case is ready to offer', () => {
    const { result } = screenSeed('Whitefield');
    const offer = result.offer!;
    assert.equal(offer.stance, 'offer');
    assert.equal(offer.preconditions.length, 0);
  });

  test('an aerodrome cap does not raise a risk against a completed building', () => {
    // Whitefield is a certified apartment inside HAL's vicinity. The height
    // restriction is true and is reported, but there is nothing left to
    // build, so it must not land in the risk register as a serious finding
    // against this purchase.
    const { result } = screenSeed('Whitefield');
    const check = result.stateCompliance!.checks.find(c => c.key === 'airport_height')!;
    assert.equal(check.verdict, 'attention');
    assert.match(check.finding, /completed building/);
    assert.equal(result.risks.filter(r => r.code === 'karnataka_aerodrome_height_restriction').length, 0);
  });

  test('and does raise one against a site being bought for its envelope', () => {
    const { result } = screenSeed('Devanahalli');
    const risk = result.risks.find(r => r.code === 'karnataka_aerodrome_height_restriction');
    assert.ok(risk, 'a plot inside the vicinity must carry the risk');
    assert.equal(risk.severity, 'serious');
  });

  test('three prices, ordered, and the target inside the range', () => {
    const { result } = screenSeed('Whitefield');
    const offer = result.offer!;
    assert.ok(offer.opening <= offer.target, 'opening must not exceed target');
    assert.ok(offer.target <= offer.walkAway, 'target must not exceed walk-away');
    assert.ok(offer.target <= result.indicativeValue.mid, 'target must not exceed the mid');
    assert.ok(offer.target >= result.indicativeValue.low * 0.75);
  });

  test('a statutory blocker suppresses the headroom instead of lowering the price', () => {
    const { result } = screenSeed('Sri Ranga Layout');
    const offer = result.offer!;
    assert.equal(offer.stance, 'do_not_offer');
    // With a blocker there is nothing to concede into: the answer is "not
    // yet", not "less".
    assert.equal(offer.walkAway, offer.target);
    assert.ok(offer.preconditions.length > 0, 'a blocking stance must name what has to clear');
    assert.match(offer.headline, /Do not put a number in writing/);
  });

  test('value drivers argue but never deduct', () => {
    const { result } = screenSeed('Sri Ranga Layout');
    const offer = result.offer!;
    const fromDrivers = offer.arguments.filter(a => a.key.startsWith('driver:'));
    assert.ok(fromDrivers.length > 0, 'expected driver-derived arguments');
    // They are already inside the mid; deducting them again is double
    // counting, and the type carries null rather than zero to say so.
    for (const argument of fromDrivers) assert.equal(argument.amount, null);
  });

  test('an ask far below the evidence is reported as information, not headroom', () => {
    const { result } = screenSeed('Sri Ranga Layout');
    const offer = result.offer!;
    assert.ok(offer.gapToAsking !== null && offer.gapToAsking < 0, 'fixture should have an ask below target');
    const flagged = offer.arguments.find(a => a.key === 'ask_below_evidence');
    assert.ok(flagged, 'a below-evidence ask must be flagged');
    assert.match(flagged.argument, /Do not read it as headroom/);
  });

  test('all-in cash adds the acquisition costs computed at the offer', () => {
    const { result } = screenSeed('Whitefield');
    const offer = result.offer!;
    assert.ok(offer.acquisitionCostsAtTarget > 0, 'a Karnataka case must compute acquisition costs');
    assert.equal(offer.allInAtTarget, offer.target + offer.acquisitionCostsAtTarget);
  });

  test('an unassessed check is listed as unpriced with a sentence, not a bare label', () => {
    const { result } = screenSeed('Devanahalli');
    const offer = result.offer!;
    const fromChecks = offer.unpriced.filter(u => /has not been established either way/.test(u));
    assert.ok(fromChecks.length > 0, 'unresolved checks must reach the unpriced list');
    for (const entry of fromChecks) {
      assert.match(entry, /nothing is priced for the possibility that it applies/);
    }
  });

  test('no state pack means the all-in figure says so rather than understating', () => {
    const { result } = screenSeed('Van Woustraat');
    const offer = result.offer!;
    assert.equal(offer.acquisitionCostsAtTarget, 0);
    assert.ok(
      offer.unpriced.some(u => /No state pack covers this property/.test(u)),
      'an uncomputed cost must be named, not silently treated as zero',
    );
  });
});

describe('forced-sale value', () => {
  test('sits below the open-market mid and names every component', () => {
    const { result } = screenSeed('Whitefield');
    const forced = result.forcedSale!;
    assert.ok(forced.value < result.indicativeValue.mid);
    assert.ok(forced.components.length > 0);
    const summed = forced.components.reduce((total, c) => total + c.pct, 0);
    assert.ok(Math.abs(summed - forced.discountPct) < 0.5, 'the headline discount must be the components');
  });

  test('a clean case discounts only for the compressed window', () => {
    const { result } = screenSeed('Whitefield');
    const forced = result.forcedSale!;
    assert.deepEqual(forced.components.map(c => c.key), ['compelled_seller']);
    assert.equal(forced.lendable, true);
  });

  test('a blocked case is not lendable and refuses to be read as a lending input', () => {
    const { result } = screenSeed('Sri Ranga Layout');
    const forced = result.forcedSale!;
    assert.equal(forced.lendable, false);
    assert.match(forced.basis, /NOT a lending input/);
    assert.ok(
      forced.components.some(c => c.key === 'finance_ineligible'),
      'a khata/conversion blocker must show up as the finance component',
    );
  });

  test('an illiquid locality is charged only for the excess over the window', () => {
    const { result } = screenSeed('Vertex Panache');
    const forced = result.forcedSale!;
    const illiquid = forced.components.find(c => c.key === 'illiquid_locality');
    assert.ok(illiquid, 'a 145-day locality must carry the illiquidity component');
    assert.match(illiquid.reason, /145 days/);
  });

  test('the discount is capped', () => {
    const { result } = screenSeed('Sri Ranga Layout');
    assert.ok(result.forcedSale!.discountPct <= 45);
  });
});

describe('the transit driver', () => {
  test('a precise pin with a measured station prices the measurement', () => {
    const { result } = screenSeed('Devanahalli', {
      siteContext: preciseSiteContext({
        amenities: [
          {
            id: 'transit:1',
            kind: 'transit',
            name: 'Test Metro Station',
            point: { lat: 13.22, lng: 77.706 },
            straightLineMetres: 2720,
            drivingMetres: 3400,
            drivingSeconds: 480,
            fromApproximatePin: false,
          },
        ],
      }),
    });
    const driver = result.drivers.find(d => d.label === 'Transit proximity')!;
    assert.match(driver.explanation, /Test Metro Station/);
    const evidence = result.evidence.find(e => driver.evidenceIds.includes(e.id))!;
    assert.equal(evidence.sourceType, 'external_dataset');
  });

  test('a locality-centre pin is refused, and the refusal is explained', () => {
    const context = preciseSiteContext({
      amenities: [
        {
          id: 'transit:1',
          kind: 'transit',
          name: 'Test Metro Station',
          point: { lat: 13.22, lng: 77.706 },
          straightLineMetres: 2720,
          fromApproximatePin: true,
        },
      ],
    });
    context.location!.precision = 'locality_centre';
    const { result } = screenSeed('Devanahalli', { siteContext: context });
    const driver = result.drivers.find(d => d.label === 'Transit proximity')!;
    // The estimate is used, and the case says why — otherwise two screens
    // would show different distances to the same station with nothing
    // accounting for the gap.
    assert.match(driver.explanation, /Estimated/);
    assert.match(driver.explanation, /only located to/);
    const evidence = result.evidence.find(e => driver.evidenceIds.includes(e.id))!;
    assert.equal(evidence.sourceType, 'model_inference');
  });

  test('with no site context at all the estimate carries no unexplained aside', () => {
    const { result } = screenSeed('Devanahalli');
    const driver = result.drivers.find(d => d.label === 'Transit proximity')!;
    assert.match(driver.explanation, /Estimated/);
    assert.doesNotMatch(driver.explanation, /only located to/);
  });
});
