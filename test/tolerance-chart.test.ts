/**
 * The axis is the whole design, so the axis is what is tested.
 *
 * A chart of two numbers is not interesting. A chart of twenty PAIRS is, and
 * only if they can be read against each other — which raw percentage does not
 * allow. A 3% budget variance sits inside a 5% threshold; a 3% extent variance
 * is triple a 1% one. Plotted on the same percentage axis they land in the
 * same place and say, with no words at all, that they are the same fact.
 *
 * So the axis is multiples of each rule's own tolerance, and these tests pin
 * the properties that makes load-bearing: the normalisation, the ordering it
 * implies, and the two silences — a comparison missing a number is not drawn,
 * and a zero tolerance is a breach rather than a very large multiple.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAssessment,
  createProject,
  projectTolerances,
  recordCheckFields,
  toleranceReadings,
  type DdProject,
} from '@realytica/shared';

function fileWith(dds: Parameters<typeof createAssessment>[1]['ddType'][]): DdProject {
  const project = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-T1');
  for (const ddType of dds) createAssessment(project, { ddType, name: `${ddType} DD`, owner: 'Lead', targetType: 'project' });
  return project;
}

function checkIn(project: DdProject, definitionId: string): string {
  for (const a of project.assessments) {
    for (const s of a.scopes) {
      const hit = s.checks.find((c) => c.definitionId === definitionId);
      if (hit) return hit.id;
    }
  }
  throw new Error(`no ${definitionId} on this file`);
}

describe('divergence is measured against its own line', () => {
  it('normalises so different tolerances become comparable', () => {
    // The claim in one test. Both comparisons are ~3% apart. One is inside a
    // 5% budget threshold; the other is triple a 1% survey one. A percentage
    // axis would put them in the same place.
    const project = fileWith(['acquisition', 'cost']);

    recordCheckFields(project, checkIn(project, 'land_site.parcel_identification'), { extent_title: 1000, extent_survey: 970 });
    recordCheckFields(project, checkIn(project, 'cost_quantity.budget_current'), { sanctioned_budget: 1000, current_forecast: 970 });

    const rows = projectTolerances(project);
    const extent = rows.find((r) => r.checkTitle.includes('Parcel identification'))!;
    const budget = rows.find((r) => r.checkTitle.includes('budget'))!;

    assert.ok(Math.abs(extent.divergence - budget.divergence) < 0.001, 'the same raw percentage apart');
    assert.equal(extent.within, false, 'and yet one is a finding');
    assert.equal(budget.within, true, 'and the other is fine');
    assert.ok(extent.overBy > 2.9 && extent.overBy < 3.1, 'three times its tolerance');
    assert.ok(budget.overBy < 1, 'comfortably inside its own');
  });

  it('sorts by how far past its own line, not by percentage', () => {
    const project = fileWith(['acquisition', 'cost']);
    // 30% on a 5% budget rule is 6×. 2% on a 1% survey rule is 2×. The budget
    // wins on percentage AND on multiples here, so make the extent the worse
    // one to prove the ordering is not just percentage in disguise.
    recordCheckFields(project, checkIn(project, 'land_site.parcel_identification'), { extent_title: 1000, extent_survey: 900 });
    recordCheckFields(project, checkIn(project, 'cost_quantity.budget_current'), { sanctioned_budget: 1000, current_forecast: 850 });

    const rows = projectTolerances(project);
    assert.ok(rows[0]!.checkTitle.includes('Parcel identification'), 'ten times its tolerance beats three times its own');
    assert.ok(rows[0]!.divergence < rows[1]!.divergence, 'even though it is the smaller percentage');
  });

  it('treats a zero tolerance as a breach, not a large multiple', () => {
    // FAR above what the plan permits admits no "slightly over". A finite
    // position would invite a comparison the threshold does not allow.
    const project = fileWith(['approval_compliance']);
    recordCheckFields(project, checkIn(project, 'regulatory.sanction'), { sanctioned_far: 2.5, permissible_far: 2.0 });
    const row = projectTolerances(project).find((r) => r.label.includes('FAR'))!;
    assert.equal(row.tolerance, 0);
    assert.equal(row.overBy, Number.POSITIVE_INFINITY);
    assert.equal(row.within, false);
  });

  it('says nothing at all when a comparison is missing a number', () => {
    // A mark at the origin would render an unanswered question as the safest
    // thing on the chart.
    const project = fileWith(['acquisition']);
    recordCheckFields(project, checkIn(project, 'land_site.parcel_identification'), { extent_title: 1000 });
    assert.deepEqual(projectTolerances(project), []);
  });

  it('says nothing when both figures are zero rather than dividing by it', () => {
    const project = fileWith(['acquisition']);
    recordCheckFields(project, checkIn(project, 'land_site.parcel_identification'), { extent_title: 0, extent_survey: 0 });
    assert.deepEqual(projectTolerances(project), []);
  });

  it('keeps a comparison that agrees, so the chart shows the clean ones too', () => {
    // A chart of only the failures cannot be read as coverage — you cannot
    // tell a file with two clean comparisons from one with none.
    const project = fileWith(['acquisition']);
    recordCheckFields(project, checkIn(project, 'land_site.parcel_identification'), { extent_title: 1000, extent_survey: 1000.5 });
    const rows = projectTolerances(project);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.within, true);
  });
});

describe('each row carries what a reader needs to disagree with it', () => {
  it('names both figures with their units, and the threshold it was judged by', () => {
    const project = fileWith(['acquisition']);
    recordCheckFields(project, checkIn(project, 'land_site.parcel_identification'), { extent_title: 1208, extent_survey: 1161 });
    const [row] = projectTolerances(project);
    assert.ok(row);
    assert.equal(row.aLabel, '1,208 sqm');
    assert.equal(row.bLabel, '1,161 sqm');
    assert.equal(row.tolerance, 0.01);
    assert.ok(row.checkId && row.checkTitle && row.scopeKey, 'and where to go to argue with it');
  });

  it('reads the computed values, not just the typed ones', () => {
    // A comparison against a derived figure has to see the derived figure.
    const defs = [
      { key: 'a', label: 'A', kind: 'number' as const },
      { key: 'b', label: 'B', kind: 'computed' as const, formula: { op: 'const' as const, value: 50 } },
    ];
    const at = '2026-09-01T00:00:00.000Z';
    const rows = toleranceReadings(
      defs,
      { a: { value: 100, at, by: 'x' }, b: { value: 50, at, by: 'computed' } },
      [{ kind: 'compare', fields: ['a', 'b'], tolerance: 0.1, severity: 'high', say: '{a} vs {b}' }],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.overBy, 5);
  });
});
