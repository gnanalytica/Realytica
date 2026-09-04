/**
 * What the sheet may propose, and what it must leave empty.
 *
 * A new project reports "no approach had all of its inputs" four times, and
 * several of those cells hold quantities this deployment already stores. Making
 * somebody retype them is friction, not rigour, so the sheet proposes them.
 *
 * The tests that matter are the refusals. A suggestion is a claim about a
 * property, and the two ways to get this wrong are proposing a number with no
 * defensible source, and proposing one from a source that looks right and is
 * not. Both produce a filled cell somebody will trust.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  KARNATAKA_PACK,
  REFERENCE_DATA,
  suggestValuationInputs,
  suggestionsFor,
  type DdProject,
} from '@realytica/shared';

const locality = REFERENCE_DATA.localities.find((l) => l.locality === 'Whitefield');
assert.ok(locality, 'the fixture locality must exist');

const project = { id: 'prj_1', builtUpAreaSqm: 4_200, plotAreaSqm: 1_850 } as unknown as DdProject;
const all = suggestValuationInputs(project, locality, KARNATAKA_PACK);
const byKey = new Map(all.map((s) => [s.key, s]));

describe('what the sheet proposes', () => {
  it('offers the locality rates it already holds', () => {
    assert.equal(byKey.get('rate_per_sqm')?.value, locality.medianPricePerSqm);
    assert.equal(byKey.get('replacement_rate')?.value, locality.replacementCostPerSqm);
    assert.equal(byKey.get('land_rate_per_sqm')?.value, locality.medianLandRatePerSqm);
  });

  it('does not confuse the land rate with the built-up rate', () => {
    // Conflating the two is the classic way to misprice a site, and the type
    // that carries them says so.
    assert.notEqual(byKey.get('land_rate_per_sqm')?.value, byKey.get('rate_per_sqm')?.value);
  });

  it('carries the built-up area across rather than asking for it twice', () => {
    assert.equal(byKey.get('let_area')?.value, 4_200);
    assert.equal(byKey.get('let_area')?.source, 'project');
  });

  it('computes acquisition costs from the pack instead of restating a rule of thumb', () => {
    // 5% duty, +10% cess and +2% surcharge on that duty, +1% registration.
    const s = byKey.get('land_acquisition_pct');
    assert.ok(s);
    assert.equal(s.source, 'pack');
    assert.ok(Math.abs(s.value - (5 * 1.12 + 1)) < 0.01, `expected 6.6, got ${s.value}`);
    // The basis has to name the figures, or it is a number with a label.
    assert.match(s.basis, /duty/);
    assert.match(s.basis, /registration/);
  });

  it('gives every suggestion a basis and a source', () => {
    for (const s of all) {
      assert.ok(s.basis.length > 20, `${s.key} needs a real basis, got "${s.basis}"`);
      assert.ok(['reference', 'pack', 'project', 'convention'].includes(s.source));
    }
  });
});

describe('what the sheet refuses to propose', () => {
  it('never proposes a capitalisation rate', () => {
    // The obvious source is `grossYield`, and it is the wrong quantity: a cap
    // rate is applied to NET income, so a gross yield would overstate the
    // value by the whole of the outgoings. An empty cell beats that.
    assert.equal(byKey.has('cap_rate_pct'), false);
  });

  it('never proposes the three inputs that decide a residual', () => {
    // GDV, construction cost and required profit are appraisal judgements
    // with no source on the file. Proposing them would be inventing the
    // answer and calling it a default.
    for (const key of ['gdv', 'construction_cost', 'developer_profit_pct']) {
      assert.equal(byKey.has(key), false, `${key} must not be suggested`);
    }
  });

  it('offers only conventions when there is no locality and no pack', () => {
    /*
     * The distinction this pins, and the reason the first draft of this test
     * was wrong: a CONVENTION does not depend on reference data. Expected life
     * for RCC framed residential is 60 years whether or not this deployment
     * holds a locality, and the field's own guidance already says so.
     *
     * What must never survive is anything DERIVED from data that is absent —
     * a rate, a cost, an acquisition percentage. Offering one of those with no
     * source behind it is the failure this guards.
     */
    const bare = suggestValuationInputs({ id: 'p' } as unknown as DdProject, undefined, undefined);
    assert.ok(
      bare.every((s) => s.source === 'convention'),
      `only conventions survive with no data, got ${bare.map((s) => `${s.key}:${s.source}`).join(', ')}`,
    );
    assert.equal(bare.some((s) => s.key === 'expected_life_years'), true);
  });

  it('skips a figure the reference data does not actually hold', () => {
    const thin = { ...locality, medianPricePerSqm: 0, replacementCostPerSqm: 0 };
    const out = suggestValuationInputs(project, thin, undefined);
    assert.equal(out.some((s) => s.key === 'rate_per_sqm'), false);
    assert.equal(out.some((s) => s.key === 'replacement_rate'), false);
    // And a zero median must not produce a rent either.
    assert.equal(out.some((s) => s.key === 'achievable_rent'), false);
  });
});

describe('suggestionsFor', () => {
  it('indexes one check without leaking another', () => {
    const cost = suggestionsFor(all, 'indicative_valuation.cost_inputs');
    assert.ok(cost.has('replacement_rate'));
    assert.equal(cost.has('rate_per_sqm'), false, 'the comparable rate belongs to another check');
  });
});
