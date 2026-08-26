/**
 * The copilot's read-only view of a case.
 *
 * The product is chat-first, so a screen output the tools cannot reach is an
 * output most users will never see. These assert reachability and, for the
 * three tools whose data is easy to misreport, that the description carries
 * the caveat the model needs.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_DATA } from '@valytica/shared';
import { createCaseTools } from '@valytica/agents';
import { caseFrom, documentsFor, preciseSiteContext, screenSeed, seedFor } from './fixtures';

function toolsFor(match: string, withSiteContext = false) {
  const seed = seedFor(match);
  const documents = documentsFor(seed.identity, seed.identity.label);
  const { result } = screenSeed(match, { documents });
  const caseData = caseFrom(seed.identity, documents, result, withSiteContext ? { siteContext: preciseSiteContext() } : {});
  return { tools: createCaseTools(caseData, REFERENCE_DATA), result };
}

async function call(match: string, name: string, withSiteContext = false) {
  const { tools } = toolsFor(match, withSiteContext);
  const tool = tools.find(t => t.name === name);
  assert.ok(tool, `expected a ${name} tool`);
  return JSON.parse(await tool.run({} as never, {} as never));
}

describe('case tools', () => {
  test('every screen output a user might ask about is reachable', () => {
    const names = toolsFor('Devanahalli').tools.map(t => t.name);
    for (const expected of [
      'get_offer_advice',
      'get_forced_sale_value',
      'get_site_context',
      'get_site_constraints',
      'get_staleness',
    ]) {
      assert.ok(names.includes(expected), `${expected} must be reachable from chat`);
    }
  });

  test('offer advice comes back whole', async () => {
    const offer = await call('Devanahalli', 'get_offer_advice');
    assert.ok(offer.opening > 0 && offer.target > 0 && offer.walkAway > 0);
    assert.ok(Array.isArray(offer.arguments));
    assert.ok(typeof offer.stance === 'string');
  });

  test('the offer tool tells the model not to collapse the three prices', () => {
    const tool = toolsFor('Devanahalli').tools.find(t => t.name === 'get_offer_advice')!;
    assert.match(tool.description!, /never average them into one/);
  });

  test('the forced-sale tool carries the lendability caveat', async () => {
    const tool = toolsFor('Sri Ranga Layout').tools.find(t => t.name === 'get_forced_sale_value')!;
    assert.match(tool.description!, /If `lendable` is false you must say so/);
    const forced = await call('Sri Ranga Layout', 'get_forced_sale_value');
    assert.equal(forced.lendable, false);
  });

  test('the constraints tool refuses to let unknown read as clear', () => {
    const tool = toolsFor('Devanahalli').tools.find(t => t.name === 'get_site_constraints')!;
    assert.match(tool.description!, /never report it as clear/);
  });

  test('constraints and water come back together, with the catchment caveat', async () => {
    const payload = await call('Sri Ranga Layout', 'get_site_constraints');
    assert.equal(payload.waterExposure.floodExposure, 'high');
    assert.match(payload.waterExposureNote, /catchment, not this parcel/);
    assert.equal(payload.constraints.length, 6);
  });

  test('an unassessed locality says so rather than returning null silently', async () => {
    const payload = await call('Van Woustraat', 'get_site_constraints');
    assert.equal(payload.waterExposure, null);
    assert.match(payload.waterExposureNote, /not the same as low exposure/);
  });

  test('a case with no map lookup gets an explanation, not an empty object', async () => {
    const payload = await call('Devanahalli', 'get_site_context');
    assert.match(payload.error, /No map lookup has been built/);
  });

  test('a case with a map lookup gets it', async () => {
    const payload = await call('Devanahalli', 'get_site_context', true);
    assert.equal(payload.location.precision, 'rooftop');
  });

  test('staleness is computed at call time, not read off the result', async () => {
    const payload = await call('Devanahalli', 'get_staleness');
    assert.ok(Array.isArray(payload.items));
    assert.ok(typeof payload.checkedAt === 'string');
  });
});
