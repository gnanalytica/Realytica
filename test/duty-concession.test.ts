/**
 * Who a concessional duty rate is actually for.
 *
 * Karnataka's 2% and 3% bands are not general rates for inexpensive property.
 * They attach to conditions — what is being registered, and whether it is
 * being registered for the first time. `computeSlabDuty` received a value and
 * a table and checked none of them, so a resale flat and a bare plot were both
 * quoted the first-time-buyer rate: on a ₹40,00,000 transaction, 3% against a
 * general 5%, understating by ₹80,000 on the one line a buyer budgets from.
 *
 * The direction matters as much as the arithmetic. A condition the file does
 * not establish is NOT satisfied, so the figure errs high — an over-estimate
 * is corrected at the counter, an under-estimate is discovered there.
 *
 * Asserted through `computeTransactionCosts` rather than the private helper,
 * because the property that matters is what the cost breakdown says, and the
 * note it writes is the only place a reader learns a concession was withheld.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeTransactionCosts, REFERENCE_DATA, resolveStatePack, type PropertyIdentity } from '@realytica/shared';

const KA = resolveStatePack({ country: 'IN', state: 'Karnataka' }, REFERENCE_DATA.statePacks);

function identity(over: Partial<PropertyIdentity>): PropertyIdentity {
  return {
    country: 'IN',
    state: 'Karnataka',
    city: 'Bengaluru',
    locality: 'Whitefield',
    propertyType: 'residential_apartment',
    currency: 'INR',
    plotAreaSqm: 0,
    // Sized so the GUIDANCE value stays under the concessional ceiling too:
    // duty is charged on the higher of consideration and guidance, so a large
    // unit in a dear locality leaves the concessional band on price alone.
    builtUpAreaSqm: 60,
    askingPrice: 4_000_000,
    ...over,
  } as PropertyIdentity;
}

/** The stamp-duty line for a subject, priced so the ₹45L concessional band would cover it. */
function dutyLine(over: Partial<PropertyIdentity>) {
  assert.ok(KA, 'the Karnataka pack must resolve');
  const locality = REFERENCE_DATA.localities.find((l) => l.locality === 'Whitefield');
  assert.ok(locality, 'the fixture locality must exist');
  const costs = computeTransactionCosts(identity(over), KA, locality);
  const line = costs.lines.find((l) => l.key === 'stamp_duty');
  assert.ok(line, 'there must be a stamp duty line');
  return { line, costs };
}

describe('the concessional stamp-duty bands', () => {
  it('applies the concession when the file establishes every condition', () => {
    const { line } = dutyLine({ firstRegistration: true, propertyType: 'residential_apartment' });
    assert.match(line.note, /at 3%/, `expected the concessional band, got: ${line.note}`);
    assert.doesNotMatch(line.note, /is not applied/);
  });

  it('withholds it from a resale, where first registration is not established', () => {
    // The single commonest case, and the one that was silently under-quoted:
    // every field identical to a first sale except the one nothing infers.
    const { line } = dutyLine({ propertyType: 'residential_apartment' });
    assert.match(line.note, /at 5%/, `expected the general rate, got: ${line.note}`);
    assert.match(line.note, /is not applied/);
    assert.match(line.note, /first registration since construction/);
  });

  it('withholds it from bare land, which is not a residential unit', () => {
    const { line } = dutyLine({ propertyType: 'land_parcel', firstRegistration: true, plotAreaSqm: 60, builtUpAreaSqm: 0 });
    assert.match(line.note, /at 5%/);
    assert.match(line.note, /residential unit/);
  });

  it('treats a plot as land rather than as a residential unit', () => {
    // `residential_plot` reads residential and is a site: the concession is
    // for the unit, and a plot has no unit on it yet.
    const { line } = dutyLine({ propertyType: 'residential_plot', firstRegistration: true, plotAreaSqm: 60, builtUpAreaSqm: 0 });
    assert.match(line.note, /residential unit/);
  });

  it('names what the buyer would save, rather than only that something was withheld', () => {
    // A withheld concession the reader cannot act on is just a higher number.
    const { line } = dutyLine({ propertyType: 'residential_apartment' });
    assert.match(line.note, /Recording that would reduce this line to/);
  });

  it('errs high, never low, when a condition is simply unrecorded', () => {
    const withheld = dutyLine({ propertyType: 'residential_apartment' }).line;
    const granted = dutyLine({ propertyType: 'residential_apartment', firstRegistration: true }).line;
    assert.ok(
      withheld.amount > granted.amount,
      `an unestablished concession must cost more, not less — got ${withheld.amount} vs ${granted.amount}`,
    );
  });

  it('leaves the general band alone above the concessional ceiling', () => {
    // Nothing above ₹45L was ever concessional, so the gate must not have
    // changed it in either direction.
    const first = dutyLine({ askingPrice: 90_000_000, firstRegistration: true }).line;
    const resale = dutyLine({ askingPrice: 90_000_000 }).line;
    assert.equal(first.amount, resale.amount, 'first registration must not matter above the concessional bands');
    assert.doesNotMatch(first.note, /is not applied/);
  });

  it('keeps every line summing exactly to the total', () => {
    // The invariant `computeTransactionCosts` documents; the new branch must
    // not have introduced a rounding path that breaks it.
    const { costs } = dutyLine({ propertyType: 'residential_apartment' });
    assert.equal(costs.lines.reduce((sum, l) => sum + l.amount, 0), costs.total);
  });
});
