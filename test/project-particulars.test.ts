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
  addEvidence,
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
    // Nothing built on the illustrative market tables reaches a project.
    assert.equal(full.anchors.length, 0);
    assert.equal(full.comparables.length, 0);
    assert.equal(full.drivers.length, 0);
    assert.equal(full.indicativeValue.mid, 0);
    assert.equal(full.evidence.some((e) => e.sourceType === 'comparable'), false);
    assert.ok(full.evidence.length > 0);
    assert.ok(full.stateCompliance, 'the compliance checks are the reason to keep it');
    assert.equal(full.recommendation.verdict, project.lastScreen?.verdict);
  });
});

describe('a development under way, as the title rules see it', () => {
  function developing() {
    const project = bareProject({ jurisdiction: 'Karnataka / BBMP', currentStage: 'construction' });
    const file = (title: string, documentType: string, facts: Array<[string, string]> = []) => {
      const row = addEvidence(project, { title, kind: 'document', status: 'received' }, 'tester');
      row.documentType = documentType;
      row.attachments.push({ id: `a_${row.id}`, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: 1, storageKey: `${row.id}.pdf`, uploadedAt: '2026-10-01T00:00:00.000Z' });
      row.facts = facts.map(([key, value]) => ({ key, label: key, value, display: value, page: 1, quote: value }));
    };
    const check = (key: string) => runProjectScreen(project).stateCompliance!.checks.find((row) => row.key === key)!;
    return { project, file, check };
  }

  it('takes a K-RERA certificate on file as a registration, whatever the subject is called', () => {
    const { file, check } = developing();
    file('RERA certificate', 'RERA registration certificate', [['rera_number', 'PRM/KA/RERA/1251/446/PR/030824/006958']]);
    const rera = check('krera_registration');
    assert.equal(rera.verdict, 'clear');
    assert.match(rera.finding, /PRM\/KA\/RERA\/1251/);
  });

  it('says an occupancy certificate is not yet due on a building going up, not that the land is bare', () => {
    const { file, check } = developing();
    file('Plans', 'Sanctioned building plan');
    assert.equal(check('occupancy_certificate_compliance').headline, 'Not yet due — under construction');
  });

  it('states the EC period the file shows, and does not call nine years thirty', () => {
    const { file, check } = developing();
    file('EC', 'Encumbrance certificate');
    assert.equal(check('encumbrance_continuity').verdict, 'unknown', 'an EC whose period was never read');
    file('EC 2015-2024', 'Encumbrance certificate', [['ec_from', '2015-04-01'], ['ec_to', '2024-05-13']]);
    const short = check('encumbrance_continuity');
    assert.equal(short.verdict, 'attention');
    assert.match(short.headline, /9 years \(2015–2024\)/);
    file('EC 1990-2015', 'Encumbrance certificate', [['ec_from', '1990-04-01'], ['ec_to', '2015-03-31']]);
    assert.equal(check('encumbrance_continuity').verdict, 'clear');
  });
});
