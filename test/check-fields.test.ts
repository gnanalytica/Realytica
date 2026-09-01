/**
 * A check records facts, and the arithmetic over them belongs to the engine.
 *
 * Two claims are under test and they are the whole point of typed fields:
 *
 *   The prose was not a record. "extent looks a bit off vs the khata" cannot
 *   be compared, cited, charted or reasoned over. Two numbers can.
 *
 *   An insight is a calculation, not a generation. It names both inputs and
 *   the tolerance, so a reader can disagree with it by checking them — which
 *   is the only kind of automated observation worth putting in front of a
 *   valuer.
 *
 * Plus the silence rule, which is the one most likely to regress: an
 * unanswered field produces no insight at all. "0 sqm — 100% divergence" from
 * an empty box would be the confident wrong answer this product is built
 * against.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHECK_DEFINITIONS,
  checkFieldReading,
  checkInsights,
  createAssessment,
  createProject,
  formatFieldValue,
  recordCheckFields,
  validateFieldValue,
  type CheckInstance,
  type DdProject,
} from '@realytica/shared';

function landCheck(): { project: DdProject; check: CheckInstance } {
  const project = createProject({ name: 'Harohalli', type: 'residential', location: 'Kanakapura Road', city: 'Bengaluru' }, 'RYT-F1');
  createAssessment(project, { ddType: 'acquisition', name: 'Land DD', owner: 'Lead', targetType: 'project' });
  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      const hit = scope.checks.find((c) => c.definitionId === 'land_site.parcel_identification');
      if (hit) return { project, check: hit };
    }
  }
  throw new Error('the land DD no longer instantiates parcel identification');
}

describe('a check declares what it records', () => {
  it('carries a field schema where the criteria are a comparison', () => {
    const def = CHECK_DEFINITIONS.find((d) => d.id === 'land_site.parcel_identification')!;
    assert.ok(def.fields?.length, 'parcel identification records extents');
    assert.ok(def.fields.some((f) => f.key === 'extent_title' && f.unit === 'sqm'));
    assert.ok(def.insightRules?.length, 'and knows what a divergence between them means');
  });

  it('carries none where the criteria are a judgement', () => {
    // Deliberate, not a gap: inventing two numbers for "constructability is
    // reasonable" would be worse than the sentence it replaced.
    const def = CHECK_DEFINITIONS.find((d) => d.id === 'technical.constructability')!;
    assert.ok(!def.fields?.length);
  });

  it('reads the schema live, so a field added later reaches running checks', () => {
    const { check } = landCheck();
    const reading = checkFieldReading(check);
    assert.ok(reading.defs.length > 0);
    assert.equal(reading.filled, 0);
    assert.equal(reading.missing.length, reading.defs.filter((d) => d.required !== false).length);
  });
});

describe('values are coerced or refused, never half-written', () => {
  it('takes a number with Indian grouping', () => {
    const def = { key: 'x', label: 'Extent', kind: 'area' as const, unit: 'sqm' };
    assert.deepEqual(validateFieldValue(def, '1,208'), { value: 1208 });
    assert.deepEqual(validateFieldValue(def, 1208), { value: 1208 });
  });

  it('refuses what is not a number, and says what it wanted', () => {
    const def = { key: 'x', label: 'Extent', kind: 'area' as const, unit: 'sqm' };
    const out = validateFieldValue(def, 'about an acre');
    assert.ok('error' in out);
    assert.match(out.error, /number in sqm/);
  });

  it('refuses an enum outside its options, naming them', () => {
    const def = { key: 'x', label: 'Access', kind: 'enum' as const, options: ['public road', 'landlocked'] };
    const out = validateFieldValue(def, 'goat track');
    assert.ok('error' in out);
    assert.match(out.error, /public road, landlocked/);
  });

  it('treats empty as blank rather than zero', () => {
    const def = { key: 'x', label: 'Extent', kind: 'area' as const };
    assert.deepEqual(validateFieldValue(def, ''), { value: null });
    assert.deepEqual(validateFieldValue(def, null), { value: null });
  });

  it('writes nothing at all when one value in the set is bad', () => {
    const { project, check } = landCheck();
    const out = recordCheckFields(project, check.id, { extent_title: 1208, extent_survey: 'roughly the same' });
    assert.equal(out.rejected.length, 1);
    assert.equal(out.reading.filled, 0, 'the good value did not land either — half a record is worse than none');
  });

  it('rejects an invented field by name rather than ignoring it', () => {
    const { project, check } = landCheck();
    const out = recordCheckFields(project, check.id, { vibes: 'good' });
    assert.equal(out.rejected.length, 1);
    assert.match(out.rejected[0]!.error, /no field called "vibes"/);
  });

  it('refuses a check that records no typed fields', () => {
    const project = createProject({ name: 'P', type: 'residential', location: 'X', city: 'Y' }, 'RYT-F2');
    createAssessment(project, { ddType: 'technical', name: 'Tech DD', owner: 'Lead', targetType: 'project' });
    const check = project.assessments[0]!.scopes.flatMap((s) => s.checks).find((c) => c.definitionId === 'technical.constructability')!;
    assert.throws(() => recordCheckFields(project, check.id, { x: 1 }), /does not record typed fields/);
  });
});

describe('insights are arithmetic, and they say so', () => {
  it('says nothing at all until both numbers are in', () => {
    const { project, check } = landCheck();
    recordCheckFields(project, check.id, { extent_title: 1208 });
    assert.deepEqual(checkFieldReading(check).insights, [], 'one number is not a comparison');
  });

  it('says nothing when the two agree inside tolerance', () => {
    const { project, check } = landCheck();
    recordCheckFields(project, check.id, { extent_title: 1208, extent_survey: 1205 });
    assert.deepEqual(checkFieldReading(check).insights, [], '0.25% is inside the 1% survey tolerance');
  });

  it('names both figures, the divergence and the tolerance when they do not', () => {
    const { project, check } = landCheck();
    recordCheckFields(project, check.id, { extent_title: 1208, extent_survey: 1161 });
    const [insight] = checkFieldReading(check).insights;
    assert.ok(insight);
    assert.equal(insight.severity, 'high');
    assert.equal(insight.computed, true);
    assert.match(insight.text, /1,208 sqm/);
    assert.match(insight.text, /1,161 sqm/);
    assert.match(insight.text, /3\.9%/);
    assert.match(insight.text, /1\.0%/, 'and the tolerance it was judged against');
  });

  it('catches a window whose start is after its end', () => {
    const defs = [
      { key: 'ec_from', label: 'From', kind: 'date' as const },
      { key: 'ec_to', label: 'To', kind: 'date' as const },
    ];
    const at = '2026-09-01T00:00:00.000Z';
    const insights = checkInsights(
      defs,
      { ec_from: { value: '2020-01-01', at, by: 'x' }, ec_to: { value: '1998-01-01', at, by: 'x' } },
      [{ kind: 'before', fields: ['ec_from', 'ec_to'], severity: 'medium', say: 'runs {a} to {b}, which is backwards' }],
    );
    assert.equal(insights.length, 1);
    assert.match(insights[0]!.text, /2020-01-01 to 1998-01-01/);
  });

  it('never fires a required-field rule on a check nobody has touched', () => {
    // Work not yet done is not a finding; the progress figures already say so.
    const defs = [{ key: 'a', label: 'A', kind: 'text' as const }];
    const rules = [{ kind: 'require' as const, fields: ['a'], severity: 'medium' as const, say: 'A is missing' }];
    assert.deepEqual(checkInsights(defs, {}, rules), []);
    assert.equal(checkInsights(defs, { b: { value: 'x', at: 'now', by: 'x' } }, rules).length, 1);
  });

  it('does not divide by zero when both figures are zero', () => {
    const { project, check } = landCheck();
    recordCheckFields(project, check.id, { extent_title: 0, extent_survey: 0 });
    assert.deepEqual(checkFieldReading(check).insights, []);
  });
});

describe('recording values is not recording a result', () => {
  it('leaves the check pending however alarming the numbers are', () => {
    // What the numbers mean is arithmetic. Whether the check passes is
    // somebody's judgement, and an automated tolerance must never sign off a
    // title on its own.
    const { project, check } = landCheck();
    recordCheckFields(project, check.id, { extent_title: 1208, extent_survey: 700 });
    assert.equal(check.result, 'pending');
    assert.ok(checkFieldReading(check).insights.length > 0);
  });

  it('formats a value the way it should read in a report', () => {
    const def = { key: 'x', label: 'Extent', kind: 'area' as const, unit: 'sqm' };
    assert.equal(formatFieldValue(def, { value: 48562, at: 'now', by: 'x' }), '48,562 sqm');
    assert.equal(formatFieldValue(def, undefined), '—');
    assert.equal(formatFieldValue({ key: 'y', label: 'Fenced', kind: 'boolean' }, { value: true, at: 'now', by: 'x' }), 'yes');
  });
});

describe('proof is a property of a value, not a kind of field', () => {
  it('refuses a value that must cite something, and says where to look', () => {
    // The line between a diligence record and a form. An extent read off a
    // registered deed and an extent somebody remembered must not be able to
    // reach a report wearing the same authority.
    const project = createProject({ name: 'P', type: 'residential', location: 'X', city: 'Y' }, 'RYT-F3');
    createAssessment(project, { ddType: 'construction_progress', name: 'Progress DD', owner: 'Lead', targetType: 'project' });
    const check = project.assessments[0]!.scopes.flatMap((s) => s.checks).find((c) => c.definitionId === 'schedule_progress.baseline')!;

    const bare = recordCheckFields(project, check.id, { baseline_date: '2026-01-05' });
    assert.equal(bare.rejected.length, 1);
    assert.match(bare.rejected[0]!.error, /has to cite what it was read from/);
    assert.match(bare.rejected[0]!.error, /baseline programme/i, 'and names the document to look in');

    const cited = recordCheckFields(project, check.id, { baseline_date: '2026-01-05' }, 'Lead', 'ev-baseline-1');
    assert.equal(cited.rejected.length, 0);
    assert.equal(cited.reading.values.baseline_date!.sourceEvidenceId, 'ev-baseline-1');
  });

  it('records a value with no proof requirement, and marks it unproven', () => {
    // Not a blocker. Plenty of a diligence is recorded from a phone call
    // before the certificate arrives; it is a state a report must be able to
    // see, not a wall.
    const { project, check } = landCheck();
    recordCheckFields(project, check.id, { extent_title: 1208 });
    const reading = checkFieldReading(check);
    assert.equal(reading.filled, 1);
    assert.deepEqual(reading.unproven, [], 'this field asks for no proof, so it is not unproven');
  });
});

describe('computed fields are worked out, never stored', () => {
  it('resolves from its siblings on every read', () => {
    const project = createProject({ name: 'P', type: 'residential', location: 'X', city: 'Y' }, 'RYT-F4');
    createAssessment(project, { ddType: 'hse', name: 'HSE DD', owner: 'Lead', targetType: 'project' });
    const check = project.assessments[0]!.scopes.flatMap((s) => s.checks).find((c) => c.definitionId === 'hse.training')!;

    recordCheckFields(project, check.id, { workforce: 400 }, 'Lead', 'ev-1');
    assert.equal(checkFieldReading(check).values.inducted_pct?.value, null, 'one input is not a percentage');

    recordCheckFields(project, check.id, { inducted: 380 }, 'Lead', 'ev-1');
    assert.equal(checkFieldReading(check).values.inducted_pct?.value, 95);
  });

  it('is not counted among the fields somebody still has to answer', () => {
    const project = createProject({ name: 'P', type: 'residential', location: 'X', city: 'Y' }, 'RYT-F5');
    createAssessment(project, { ddType: 'hse', name: 'HSE DD', owner: 'Lead', targetType: 'project' });
    const check = project.assessments[0]!.scopes.flatMap((s) => s.checks).find((c) => c.definitionId === 'hse.training')!;
    const reading = checkFieldReading(check);
    assert.ok(!reading.missing.some((d) => d.kind === 'computed'), 'nobody can fill in a formula');
    assert.ok(!reading.defs.filter((d) => d.kind !== 'computed').length === false);
  });
});

describe('a table field holds rows', () => {
  it('stores a chain of title and counts it', () => {
    const project = createProject({ name: 'P', type: 'residential', location: 'X', city: 'Y' }, 'RYT-F6');
    createAssessment(project, { ddType: 'acquisition', name: 'Land DD', owner: 'Lead', targetType: 'project' });
    const check = project.assessments[0]!.scopes.flatMap((s) => s.checks).find((c) => c.definitionId === 'legal.title_chain')!;

    const out = recordCheckFields(project, check.id, {
      chain: [
        { date: '1994-06-02', instrument: 'grant', from_party: 'State of Karnataka', to_party: 'Ramaiah', registered: true },
        { date: '1998-11-14', instrument: 'gift deed', from_party: 'Ramaiah', to_party: 'Lakshmamma', registered: true },
      ],
    });
    assert.deepEqual(out.rejected, []);
    assert.equal(out.reading.values.instrument_count?.value, 2, 'the count is computed off the rows');
  });
});
