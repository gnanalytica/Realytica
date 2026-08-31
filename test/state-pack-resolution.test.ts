/**
 * The State Pack has to load for the jurisdiction people actually write down.
 *
 * A project records its state AND the planning authority within it —
 * "Karnataka / BMRDA" — because which authority sanctions a layout is what an
 * analyst needs on the file. The resolver used to be an exact string equality
 * against the pack's `state`, so every such project missed: no Karnataka
 * title checks, no transaction costs, the state's own required documents
 * dropped from completeness, and an `outside_covered_state` risk that told
 * the reader a Bengaluru property was outside Karnataka.
 *
 * These tests pin the two halves that have to agree — the pack lookup and the
 * covered-state test — and the fact that matching is still exact per segment,
 * so a pack for one state can never answer for another.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  REFERENCE_DATA,
  jurisdictionSegments,
  resolveStatePack,
  runProjectScreen,
  seedBdaReferenceProject,
  seedDemoProject,
} from '@realytica/shared';

describe('state pack resolution', () => {
  it('resolves Karnataka from a state-and-authority jurisdiction', () => {
    for (const state of [
      'Karnataka',
      'karnataka',
      'Karnataka / BMRDA',
      'Karnataka / BBMP',
      'Karnataka, BDA',
      'State of Karnataka | BIAAPA',
      '  Karnataka / Gram Panchayat  ',
    ]) {
      const pack = resolveStatePack({ country: 'IN', state });
      assert.equal(pack?.id, 'karnataka', `expected the Karnataka pack for ${JSON.stringify(state)}`);
    }
  });

  it('does not answer for a state it was not calibrated for', () => {
    for (const state of ['Kerala', 'Karnataka Pradesh', 'Tamil Nadu / CMDA', 'Maharashtra']) {
      assert.equal(resolveStatePack({ country: 'IN', state }), undefined, state);
    }
  });

  it('does not cross a country boundary', () => {
    assert.equal(resolveStatePack({ country: 'NL', state: 'Karnataka' }), undefined);
  });

  it('treats a hyphenated province as one name, not two segments', () => {
    assert.deepEqual(jurisdictionSegments('Noord-Holland'), ['noord-holland']);
    assert.deepEqual(jurisdictionSegments('Karnataka / BMRDA'), ['karnataka', 'bmrda']);
  });

  it('loads the pack, its checks and its transaction costs for the seeded projects', () => {
    for (const project of [seedDemoProject(), seedBdaReferenceProject()]) {
      const result = runProjectScreen(project);
      assert.ok(result.stateCompliance, `${project.reference} lost the Karnataka compliance summary`);
      assert.equal(result.stateCompliance?.statePackId, 'karnataka');
      assert.ok(
        (result.stateCompliance?.checks.length ?? 0) > 10,
        `${project.reference} should carry the pack's title checks`,
      );
      assert.ok(result.transactionCosts, `${project.reference} lost its stamp duty / registration costs`);
    }
  });

  it('stops telling a Bengaluru project it is outside Karnataka', () => {
    const result = runProjectScreen(seedDemoProject());
    const codes = result.risks.map((risk) => risk.code);
    assert.ok(
      !codes.includes('outside_covered_state'),
      'a Karnataka / BMRDA project is inside the covered state',
    );
  });

  it('still raises the coverage risk for a genuinely uncovered state', () => {
    const project = seedDemoProject();
    project.jurisdiction = 'Tamil Nadu / CMDA';
    const result = runProjectScreen(project);
    assert.ok(result.risks.some((risk) => risk.code === 'outside_covered_state'));
    assert.equal(result.stateCompliance, undefined);
  });

  it('keeps the staleness view on the same pack as the screen', () => {
    // Both used to carry their own copy of the equality test. The report only
    // watches statutory ages when it agrees with the engine about which pack
    // is in force.
    const pack = resolveStatePack({ country: 'IN', state: 'Karnataka / BBMP' }, REFERENCE_DATA.statePacks);
    assert.equal(pack?.state, 'Karnataka');
  });
});
