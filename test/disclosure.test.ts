/**
 * What may leave the system, and what may never.
 *
 * These are the tests that hold a privacy boundary, so they are written
 * against the *rendered string* rather than against the option object. What
 * matters is not that the code intended to withhold the owner's name; it is
 * that the owner's name is not in the bytes that go to a search index.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISCLOSURE_LEVELS, DISCLOSURE_ORDER, REFERENCE_DATA, disclosureAllows, resolveDisclosure } from '@realytica/shared';
import type { DisclosureLevel, PropertyCase } from '@realytica/shared';
import { renderCaseContext } from '@realytica/agents';
import { caseFrom, documentsFor, seedFor } from './fixtures';

const OWNER = 'Priya Ramanathan';
const ASKING = 41_500_000;

function caseAt(disclosure: DisclosureLevel | undefined): PropertyCase {
  const seed = seedFor('Site No. 42');
  const identity = {
    ...seed.identity,
    addressLine: '14 Sri Ranga Layout Main Road',
    postalCode: '560035',
    parcelId: '42/3',
    askingPrice: ASKING,
  };
  const c = caseFrom(identity, documentsFor(identity, seed.identity.label));
  return { ...c, ownerName: OWNER, disclosure };
}

function rendered(disclosure: DisclosureLevel | undefined): string {
  return renderCaseContext(caseAt(disclosure), REFERENCE_DATA, { externalSafe: true, disclosure });
}

describe('what never leaves, at any level', () => {
  for (const level of [...DISCLOSURE_ORDER, undefined]) {
    it(`withholds the owner, the price and the documents at ${level ?? 'the default'}`, () => {
      const out = rendered(level);
      assert.ok(!out.includes(OWNER), 'the owner name must never reach an external service');
      assert.ok(!out.includes(String(ASKING)), 'the asking price must never reach an external service');
      assert.ok(!/ownerName|askingPrice|extracted|documents/.test(out), 'no deal or document field may appear');
    });
  }
});

describe('the default is the safe one', () => {
  it('resolves an unset level to locality only', () => {
    assert.equal(resolveDisclosure(undefined), 'locality_only');
  });

  it('sends nothing identifying when nobody has chosen', () => {
    // The important case: a permissive level must not be reachable by
    // forgetting to pass one.
    const out = rendered(undefined);
    assert.ok(!out.includes('42/3'), 'no survey number');
    assert.ok(!out.includes('Sri Ranga Layout Main Road'), 'no address');
    assert.ok(!out.includes('560035'), 'no postcode');
    assert.ok(out.includes('Sarjapur Road'), 'the locality is the point of this level');
  });
});

describe('each level sends exactly what it says it sends', () => {
  it('adds the survey number and khata at property_identifiers, and no more', () => {
    const out = rendered('property_identifiers');
    assert.ok(out.includes('42/3'), 'the survey number is what this level exists to send');
    assert.ok(!out.includes('Sri Ranga Layout Main Road'), 'but not the street address');
    assert.ok(!out.includes('560035'), 'and not the postcode');
  });

  it('adds the address only at full_address', () => {
    const out = rendered('full_address');
    assert.ok(out.includes('Sri Ranga Layout Main Road'));
    assert.ok(out.includes('560035'));
    assert.ok(out.includes('42/3'), 'the wider level includes everything the narrower one sends');
  });

  it('stamps the level it was rendered at into the payload', () => {
    // So a finding can record what was disclosed to reach it.
    assert.ok(rendered('property_identifiers').includes('property_identifiers'));
  });
});

describe('the levels describe themselves honestly', () => {
  it('states a cost for every level, including the default', () => {
    for (const level of DISCLOSURE_ORDER) {
      const d = DISCLOSURE_LEVELS[level];
      assert.ok(d.cost.length > 40, `${level} does not state what it costs`);
      assert.ok(d.sends.length > 0 && d.unlocks.length > 0, `${level} does not say what it sends or unlocks`);
    }
  });

  it('orders the levels from narrowest to widest', () => {
    assert.ok(disclosureAllows('full_address', 'locality_only'));
    assert.ok(disclosureAllows('property_identifiers', 'locality_only'));
    assert.ok(!disclosureAllows('locality_only', 'property_identifiers'));
    assert.ok(!disclosureAllows('property_identifiers', 'full_address'));
  });
});
