/**
 * The index behind ⌘K.
 *
 * Before it existed, "where is the flood check" was Assess → pick the DD →
 * pick the scope → read six titles. The tests below are the properties that
 * make two keystrokes a safe replacement for that: the right record comes
 * first, extra words narrow rather than widen, and every hit knows where it
 * lives so opening it lands on the record and not merely on its register.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEARCH_KIND_LABEL,
  addFinding,
  recordCheckResult,
  createAssessment,
  searchProject,
  seedDemoProject,
} from '@realytica/shared';

function checkTitled(project: ReturnType<typeof seedDemoProject>, match: string) {
  for (const a of project.assessments) {
    for (const s of a.scopes) {
      const hit = s.checks.find((c) => c.title.toLowerCase().includes(match.toLowerCase()));
      if (hit) return { assessment: a, scope: s, check: hit };
    }
  }
  throw new Error(`No check matching "${match}"`);
}

describe('searching a project', () => {
  it('finds a check by a word in its title', () => {
    const project = seedDemoProject();
    const wanted = checkTitled(project, 'Flood');
    const hits = searchProject(project, 'flood');
    assert.ok(hits.length > 0, 'expected at least one hit');
    assert.equal(hits[0]!.id, wanted.check.id);
    assert.equal(hits[0]!.kind, 'check');
  });

  it('carries the assessment and scope so opening it lands on the check', () => {
    const project = seedDemoProject();
    const wanted = checkTitled(project, 'Flood');
    const hit = searchProject(project, 'flood')[0]!;
    assert.equal(hit.extra.ddId, wanted.assessment.id);
    assert.equal(hit.extra.scopeId, wanted.scope.id);
    assert.equal(hit.extra.checkId, wanted.check.id);
  });

  it('says where the record lives, not just what it is called', () => {
    const project = seedDemoProject();
    const hit = searchProject(project, 'flood')[0]!;
    assert.match(hit.detail, /Land & Site/);
    assert.equal(SEARCH_KIND_LABEL[hit.kind], 'Check');
  });

  it('narrows on a second word rather than widening', () => {
    const project = seedDemoProject();
    const one = searchProject(project, 'plan', 50);
    const two = searchProject(project, 'plan boundaries', 50);
    assert.ok(one.length > two.length, `expected narrowing, got ${one.length} then ${two.length}`);
    for (const hit of two) {
      const hay = `${hit.label} ${hit.detail}`.toLowerCase();
      assert.ok(hay.includes('plan'));
      assert.ok(hay.includes('boundaries'));
    }
  });

  it('lets a word in the scope name reach a check that does not use it', () => {
    const project = seedDemoProject();
    // "Utility availability is confirmed" says nothing about land or site; the
    // scope it sits in does.
    const hits = searchProject(project, 'land utility', 20);
    assert.ok(hits.some((h) => h.label.startsWith('Utility availability')));
  });

  it('returns nothing for a query that matches nothing', () => {
    const project = seedDemoProject();
    assert.deepEqual(searchProject(project, 'zzzquux'), []);
  });

  it('puts an exact title above a partial one', () => {
    const project = seedDemoProject();
    const wanted = checkTitled(project, 'Flood');
    const hits = searchProject(project, wanted.check.title);
    assert.equal(hits[0]!.id, wanted.check.id);
  });

  it('ranks a check still pending above the same check once recorded', () => {
    const a = seedDemoProject();
    const b = seedDemoProject();
    const target = checkTitled(a, 'Flood');
    const beforeScore = searchProject(a, 'flood')[0]!.score;

    recordCheckResult(b, checkTitled(b, 'Flood').check.id, { result: 'compliant' });
    const after = searchProject(b, 'flood').find((h) => h.kind === 'check')!;

    assert.ok(after.score < beforeScore, `${after.score} should be below ${beforeScore}`);
    assert.equal(after.id, checkTitled(b, 'Flood').check.id);
    assert.ok(target.check.id.length > 0);
  });

  it('finds a finding somebody just wrote', () => {
    const project = seedDemoProject();
    const finding = addFinding(project, {
      title: 'Rajakaluve crosses the north-east corner',
      severity: 'critical',
      discipline: 'regulatory',
      description: 'Drain alignment on the survey sketch.',
    });
    const hits = searchProject(project, 'rajakaluve');
    assert.equal(hits[0]!.id, finding.id);
    assert.equal(hits[0]!.kind, 'finding');
    assert.match(hits[0]!.detail, /critical/);
  });

  it('finds an evidence row by the document it expects', () => {
    const project = seedDemoProject();
    const hits = searchProject(project, 'encumbrance', 20);
    assert.ok(hits.some((h) => h.kind === 'evidence'), 'expected an evidence hit');
    const hit = hits.find((h) => h.kind === 'evidence')!;
    assert.ok(hit.extra.evidenceId);
  });

  it('reaches a check inside an assessment started after the seed', () => {
    const project = seedDemoProject();
    const created = createAssessment(project, { ddType: 'acquisition', owner: 'A. Rao', targetType: 'project' });
    const hits = searchProject(project, 'geotechnical', 20);
    assert.ok(
      hits.some((h) => h.extra.ddId === created.id),
      'a new assessment should be searchable immediately',
    );
  });

  it('honours the limit', () => {
    const project = seedDemoProject();
    assert.ok(searchProject(project, 'a', 3).length <= 3);
  });

  it('ignores punctuation and case', () => {
    const project = seedDemoProject();
    const plain = searchProject(project, 'land site', 5).map((h) => h.id);
    const noisy = searchProject(project, 'LAND & SITE', 5).map((h) => h.id);
    assert.deepEqual(noisy, plain);
  });
});
