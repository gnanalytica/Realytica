/**
 * The statutory constraints, and the three-state discipline behind them.
 *
 * The load-bearing assertion in this file is that "nobody has checked" never
 * renders as "it does not apply". Every other test here is downstream of
 * that one.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DECLARABLE_SITE_CONSTRAINTS, SITE_CONSTRAINT_KEYS } from '@realytica/shared';
import { screenSeed, preciseSiteContext } from './fixtures';

const CONSTRAINT_KEYS = new Set<string>(SITE_CONSTRAINT_KEYS);

describe('site constraints', () => {
  test('every rule produces a check', () => {
    const { result } = screenSeed('Devanahalli');
    const keys = result.stateCompliance!.checks.filter(c => CONSTRAINT_KEYS.has(c.key)).map(c => c.key);
    assert.deepEqual(keys.sort(), [...SITE_CONSTRAINT_KEYS].sort());
  });

  test('undeclared constraints report as unchecked, never as clear', () => {
    const { result } = screenSeed('Devanahalli');
    for (const key of DECLARABLE_SITE_CONSTRAINTS) {
      const check = result.stateCompliance!.checks.find(c => c.key === key)!;
      assert.equal(check.verdict, 'unknown', `${key} must not report clear when nobody has looked`);
      assert.match(check.finding, /MISSING/);
    }
  });

  test('an unchecked constraint does not depress the compliance score', () => {
    // The score is a ratio over answerable checks. Six permanent unknowns
    // dragging it down would make it a measure of this product's coverage
    // rather than of the property.
    const withNone = screenSeed('Devanahalli').result.stateCompliance!.score;
    const withAll = screenSeed('Devanahalli', {
      karnataka: { siteConstraints: DECLARABLE_SITE_CONSTRAINTS.map(key => ({ key, presence: 'absent' as const })) },
    }).result.stateCompliance!.score;
    assert.ok(withAll >= withNone, 'answering the questions must not make the score worse');
  });

  test('a declared constraint raises a risk and cites the declaration', () => {
    const { result } = screenSeed('Devanahalli', {
      karnataka: { siteConstraints: [{ key: 'high_tension_line', presence: 'present', note: 'A 220kV KPTCL line crosses the north-west corner' }] },
    });
    const check = result.stateCompliance!.checks.find(c => c.key === 'high_tension_line')!;
    assert.equal(check.verdict, 'attention');
    assert.match(check.finding, /220kV KPTCL/);
    const risk = result.risks.find(r => r.code === 'karnataka_constraint_high_tension_line');
    assert.ok(risk);
    assert.equal(risk.severity, 'serious');
  });

  test('a cleared search reads as a recorded negative, not a search result', () => {
    const { result } = screenSeed('Devanahalli', {
      karnataka: { siteConstraints: [{ key: 'quarry_lease', presence: 'absent' }] },
    });
    const check = result.stateCompliance!.checks.find(c => c.key === 'quarry_lease')!;
    assert.equal(check.verdict, 'clear');
    assert.match(check.nextStep, /negative recorded on the case rather than a search result/);
    assert.equal(result.risks.filter(r => r.code === 'karnataka_constraint_quarry_lease').length, 0);
  });

  test('no rule quotes a distance', () => {
    // Every one of these depends on a figure the authority computes from
    // facts about the specific site. A metre number here would assert a
    // precision none of them has.
    const { result } = screenSeed('Devanahalli');
    for (const check of result.stateCompliance!.checks.filter(c => CONSTRAINT_KEYS.has(c.key))) {
      assert.doesNotMatch(check.consequence, /\b\d+\s?(m|metres|meters)\b/, `${check.key} must not quote a distance`);
    }
  });
});

describe('the aerodrome check answers itself', () => {
  test('a locality beside an airport is flagged without any map', () => {
    const { result } = screenSeed('Devanahalli');
    const check = result.stateCompliance!.checks.find(c => c.key === 'airport_height')!;
    assert.equal(check.verdict, 'attention');
    assert.match(check.finding, /at locality level/);
    assert.match(check.finding, /Kempegowda International/);
  });

  test('a measured pin replaces the locality estimate and says so', () => {
    const { result } = screenSeed('Devanahalli', {
      siteContext: preciseSiteContext({
        amenities: [
          {
            id: 'airport:1',
            kind: 'airport',
            name: 'Kempegowda International Airport',
            point: { lat: 13.1986, lng: 77.7066 },
            straightLineMetres: 5057,
            fromApproximatePin: false,
          },
        ],
      }),
    });
    const check = result.stateCompliance!.checks.find(c => c.key === 'airport_height')!;
    assert.match(check.finding, /measured from this property's located position/);
    assert.match(check.finding, /5\.1 km/);
  });

  test('a locality-centre pin is refused, exactly as the transit driver refuses it', () => {
    const context = preciseSiteContext({
      amenities: [
        { id: 'airport:1', kind: 'airport', name: 'Somewhere Far', point: { lat: 12, lng: 77 }, straightLineMetres: 90_000, fromApproximatePin: true },
      ],
    });
    context.location!.precision = 'locality_centre';
    const { result } = screenSeed('Devanahalli', { siteContext: context });
    const check = result.stateCompliance!.checks.find(c => c.key === 'airport_height')!;
    // Falls back to the locality figure — an imprecise pin must not be able
    // to talk the check out of a restriction that applies.
    assert.match(check.finding, /at locality level/);
    assert.equal(check.verdict, 'attention');
  });

  test('a locality with no aerodrome and no map reports unchecked', () => {
    const { result } = screenSeed('Sri Ranga Layout');
    assert.equal(result.stateCompliance!.checks.find(c => c.key === 'airport_height')!.verdict, 'unknown');
  });

  test('a confirmed NOC outranks the proximity inference', () => {
    const { result } = screenSeed('Devanahalli', {
      karnataka: { siteConstraints: [{ key: 'airport_height', presence: 'absent', note: 'AAI NOC issued, no height restriction' }] },
    });
    const check = result.stateCompliance!.checks.find(c => c.key === 'airport_height')!;
    assert.equal(check.verdict, 'clear');
    assert.match(check.finding, /AAI NOC issued/);
  });
});

describe('water exposure', () => {
  test('is catchment-level and carries its own provenance', () => {
    const { result } = screenSeed('Sri Ranga Layout');
    const water = result.waterExposure!;
    assert.equal(water.floodExposure, 'high');
    assert.equal(water.valley, 'koramangala_challaghatta');
    assert.ok(water.asOf.length > 0);
    assert.match(water.verifyNote, /says nothing about where this parcel sits within it/);
  });

  test('high exposure plus a buffer flag compounds to critical', () => {
    const { result } = screenSeed('Sri Ranga Layout');
    const risk = result.risks.find(r => r.code === 'flood_catchment_exposure')!;
    assert.equal(risk.severity, 'critical', 'the fixture is both high-exposure and rajakaluve-flagged');
    assert.match(risk.description, /buffer question and the flooding question on the same piece of ground/);
  });

  test('moderate exposure with no buffer flag raises nothing', () => {
    const { result } = screenSeed('Whitefield');
    assert.equal(result.waterExposure!.floodExposure, 'moderate');
    assert.equal(result.risks.filter(r => r.code === 'flood_catchment_exposure').length, 0);
  });

  test('an unclassified locality is recorded as unassessed rather than passed over', () => {
    const { result } = screenSeed('Van Woustraat');
    assert.equal(result.waterExposure, undefined);
    assert.ok(
      result.evidence.some(e => e.sourceRef === 'locality.waterExposure' && /has not been assessed/.test(e.statement)),
      'the absence must be visible in the evidence ledger',
    );
  });
});
