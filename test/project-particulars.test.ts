/**
 * What a project carries into the screen.
 *
 * `projectToIdentity` is the whole bridge between the DD operating model and
 * the screening engine, and it used to drop or invent most of what the
 * Karnataka checks are written against: no khata block at all (so eleven
 * title checks resolved `unknown`), a hardcoded `freehold` nobody had
 * entered, and a survey number recovered by regex over an asset's free-text
 * notes.
 *
 * The rule these tests hold: what is recorded is carried, what is written
 * down is read, and what is unknown stays unknown. A default that reads like
 * an answer is worse than a gap, because the product's whole claim is that
 * you can tell the two apart.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createProject,
  patchProject,
  projectToIdentity,
  runProjectScreen,
  screenProject,
  seedDemoProject,
  type CreateProjectInput,
} from '@realytica/shared';

function bareProject(input: Partial<CreateProjectInput> = {}) {
  return createProject(
    {
      name: 'Test site',
      type: 'residential',
      location: 'Whitefield',
      city: 'Bengaluru',
      currency: 'INR',
      ...input,
    },
    'RYT-9001',
  );
}

describe('project particulars reaching the engine', () => {
  it('reads the planning authority out of the jurisdiction people write', () => {
    const cases: Array<[string, string]> = [
      ['Karnataka / BBMP', 'BBMP'],
      ['Karnataka / BMRDA', 'BMRDA'],
      ['Karnataka / BDA', 'BDA'],
      ['Karnataka / BIAAPA', 'BIAAPA'],
      ['Karnataka / Gram Panchayat', 'gram_panchayat'],
    ];
    for (const [jurisdiction, expected] of cases) {
      const identity = projectToIdentity(bareProject({ jurisdiction }));
      assert.equal(identity.karnataka?.jurisdiction, expected, jurisdiction);
    }
  });

  it('leaves an unrecognised jurisdiction unknown rather than guessing', () => {
    const identity = projectToIdentity(bareProject({ jurisdiction: 'Karnataka' }));
    assert.equal(identity.karnataka, undefined);
  });

  it('never infers khata type, conversion status or area basis', () => {
    // These are matters of record and the exact things the product exists to
    // check. A default here would manufacture an answer.
    const identity = projectToIdentity(bareProject({ jurisdiction: 'Karnataka / BBMP' }));
    assert.equal(identity.karnataka?.khataType, 'unknown');
    assert.equal(identity.karnataka?.landConversionStatus, 'unknown');
    assert.equal(identity.karnataka?.areaBasis, 'unknown');
  });

  it('carries recorded particulars through unchanged', () => {
    const project = bareProject({ jurisdiction: 'Karnataka / BBMP' });
    patchProject(project, {
      parcelId: 'Sy. No. 88/3',
      tenure: 'leasehold',
      karnataka: {
        jurisdiction: 'BBMP',
        khataType: 'b_khata',
        eKhataIssued: false,
        landConversionStatus: 'converted',
        areaBasis: 'super_built_up',
      },
    });
    const identity = projectToIdentity(project);
    assert.equal(identity.parcelId, 'Sy. No. 88/3');
    assert.equal(identity.tenure, 'leasehold');
    assert.equal(identity.karnataka?.khataType, 'b_khata');
    assert.equal(identity.karnataka?.landConversionStatus, 'converted');
    assert.equal(identity.karnataka?.areaBasis, 'super_built_up');
  });

  it('reports unrecorded tenure as unknown instead of asserting freehold', () => {
    const identity = projectToIdentity(bareProject());
    assert.equal(identity.tenure, 'unknown');
    const result = runProjectScreen(bareProject({ jurisdiction: 'Karnataka / BBMP' }));
    assert.ok(
      result.risks.some((risk) => risk.code === 'unknown_tenure'),
      'an unconfirmed tenure is a gap the screen should report',
    );
  });

  it('turns a recorded B-khata into the blocker it is', () => {
    const project = bareProject({ jurisdiction: 'Karnataka / BBMP' });
    patchProject(project, {
      karnataka: {
        jurisdiction: 'BBMP',
        khataType: 'b_khata',
        eKhataIssued: false,
        landConversionStatus: 'converted',
        areaBasis: 'carpet',
      },
    });
    const check = runProjectScreen(project).stateCompliance?.checks.find(
      (row) => row.key === 'khata_classification',
    );
    assert.equal(check?.verdict, 'blocker');
  });

  it('raises the seeded township\'s unconverted pocket as a blocker', () => {
    // The seed already says this in prose on the land-use check; recording it
    // as a typed particular is what lets the Karnataka pack see it.
    const result = runProjectScreen(seedDemoProject());
    const conversion = result.stateCompliance?.checks.find((row) => row.key === 'dc_conversion');
    assert.equal(conversion?.verdict, 'blocker');
  });

  it('keeps the whole screen result on the project, not just the headline', () => {
    const project = seedDemoProject();
    screenProject(project);
    assert.ok(project.lastScreen, 'the headline snapshot is still written');
    const full = project.lastScreenResult;
    assert.ok(full, 'the working behind the verdict must survive the run');
    assert.ok(full.anchors.length > 0);
    assert.ok(full.comparables.length > 0);
    assert.ok(full.evidence.length > 0);
    assert.ok(full.stateCompliance, 'the compliance checks are the reason to keep it');
    assert.equal(full.recommendation.verdict, project.lastScreen?.verdict);
  });
});
