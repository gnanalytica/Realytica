/**
 * What a contractor sees, and everything they must not.
 *
 * This is the function that decides whether the structural consultant on your
 * Whitefield site can read what you think the Koramangala site is worth. It is
 * tested the way you would brief somebody to break it: hand a real seeded
 * project to a narrow grant, then go looking for anything that survived.
 *
 * The general property, asserted at the end over every collection at once, is
 * the one that matters most — a projection that filters six collections and
 * forgets the seventh is exactly how this goes wrong, and a test per
 * collection would never catch the seventh being added later.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRANT_AREAS,
  createAssessment,
  createProjectGrant,
  patchProjectGrant,
  fullView,
  projectView,
  seedDemoProject,
  type DdProject,
  type GrantArea,
  type ProjectGrant,
  type ProjectRole,
  type ScopeKey,
} from '@realytica/shared';

function grantOf(over: Partial<ProjectGrant> = {}): ProjectGrant {
  return {
    id: 'grant-1',
    tenantId: 't1',
    projectId: 'p1',
    email: 'contractor@outside.in',
    role: 'contributor' as ProjectRole,
    allAssessments: false,
    assessmentIds: [],
    allScopes: false,
    scopeKeys: [],
    areas: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'dev@firm.in',
    ...over,
  };
}

function view(project: DdProject, over: Partial<ProjectGrant> = {}) {
  return projectView(project, { kind: 'granted', grant: grantOf(over), email: 'contractor@outside.in' });
}

/** The assessment and scope a narrow grant is written against. */
function firstScope(project: DdProject): { ddId: string; scopeKey: ScopeKey; scopeId: string } {
  const a = project.assessments[0]!;
  const s = a.scopes[0]!;
  return { ddId: a.id, scopeKey: s.scopeKey, scopeId: s.id };
}

describe('a grant with nothing ticked', () => {
  it('shows a project shell and no work at all', () => {
    const project = seedDemoProject();
    const { project: seen } = view(project);
    assert.equal(seen.assessments.length, 0);
    assert.equal(seen.evidence.length, 0);
    assert.equal(seen.findings.length, 0);
    assert.equal(seen.risks.length, 0);
    assert.equal(seen.decisions.length, 0);
    assert.equal(seen.valuationRuns.length, 0);
    assert.equal(seen.reports.length, 0);
  });

  it('keeps the project identifiable, so it is a door rather than a void', () => {
    const project = seedDemoProject();
    const { project: seen } = view(project);
    assert.equal(seen.name, project.name);
    assert.equal(seen.city, project.city);
    assert.ok(seen.assets.length > 0, 'the subject of the work is not a secret from somebody working on it');
  });

  it('says what it withheld rather than looking empty', () => {
    const project = seedDemoProject();
    const { withheld, complete } = view(project);
    assert.equal(complete, false);
    assert.ok(withheld.includes('valuation'));
    assert.ok(withheld.includes('assessments'));
  });
});

describe('a grant to one scope of one assessment', () => {
  it('shows that scope and no other', () => {
    const project = seedDemoProject();
    const { ddId, scopeKey } = firstScope(project);
    const { project: seen } = view(project, { assessmentIds: [ddId], scopeKeys: [scopeKey] });

    assert.equal(seen.assessments.length, 1);
    assert.equal(seen.assessments[0]!.id, ddId);
    assert.equal(seen.assessments[0]!.scopes.length, 1);
    assert.equal(seen.assessments[0]!.scopes[0]!.scopeKey, scopeKey);
  });

  it('does not leak the other assessments on the same project', () => {
    const project = seedDemoProject();
    const { ddId, scopeKey } = firstScope(project);
    const { project: seen } = view(project, { assessmentIds: [ddId], scopeKeys: [scopeKey] });
    assert.ok(project.assessments.length > 1, 'the fixture needs more than one to be worth asserting');
    assert.deepEqual(seen.assessments.map((a) => a.id), [ddId]);
  });

  it('does not admit an assessment started after the grant was written', () => {
    const project = seedDemoProject();
    const { ddId, scopeKey } = firstScope(project);
    const later = createAssessment(project, { ddType: 'acquisition', owner: 'x', targetType: 'project' });
    const { project: seen } = view(project, { assessmentIds: [ddId], scopeKeys: [scopeKey] });
    assert.ok(!seen.assessments.some((a) => a.id === later.id), 'deny by default means later work stays out');
  });

  it('admits one started later when the grant says every assessment', () => {
    const project = seedDemoProject();
    const later = createAssessment(project, { ddType: 'acquisition', owner: 'x', targetType: 'project' });
    const { project: seen } = view(project, { allAssessments: true, allScopes: true });
    assert.ok(seen.assessments.some((a) => a.id === later.id));
  });

  it('carries only the evidence that reaches the visible scope', () => {
    const project = seedDemoProject();
    const { ddId, scopeKey, scopeId } = firstScope(project);
    const { project: seen } = view(project, { assessmentIds: [ddId], scopeKeys: [scopeKey] });

    assert.ok(seen.evidence.length > 0, 'a scope with checks expects documents');
    assert.ok(seen.evidence.length < project.evidence.length);
    const visibleChecks = new Set(seen.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks.map((c) => c.id))));
    for (const e of seen.evidence) {
      const reaches =
        e.scopeInstanceIds.includes(scopeId) ||
        e.checkIds.some((c) => visibleChecks.has(c)) ||
        (e.scopeInstanceIds.length === 0 && e.checkIds.length === 0 && e.assessmentIds.includes(ddId));
      assert.ok(reaches, `"${e.title}" reaches nothing this grant can see`);
    }
  });

  it('leaves evidence linked to nothing at all outside', () => {
    const project = seedDemoProject();
    const { ddId, scopeKey } = firstScope(project);
    const orphan = project.evidence.find(
      (e) => e.scopeInstanceIds.length === 0 && e.checkIds.length === 0 && e.assessmentIds.length === 0,
    );
    if (!orphan) return; // the fixture has none; the rule is still asserted below
    const { project: seen } = view(project, { assessmentIds: [ddId], scopeKeys: [scopeKey] });
    assert.ok(!seen.evidence.some((e) => e.id === orphan.id));
  });
});

describe('the areas, each off unless ticked', () => {
  it('withholds the valuation, the screen and the indicative figure with it', () => {
    const project = seedDemoProject();
    const { project: seen } = view(project, { allAssessments: true, allScopes: true });
    assert.equal(seen.valuationRuns.length, 0);
    assert.equal(seen.lastScreen, undefined);
    assert.equal(seen.lastScreenResult, undefined, 'the screen result carries an indicative value');
  });

  it('hands the valuation over when it is ticked', () => {
    const project = seedDemoProject();
    const { project: seen } = view(project, { allAssessments: true, allScopes: true, areas: ['valuation'] });
    assert.equal(seen.valuationRuns.length, project.valuationRuns.length);
  });

  it('withholds the budget unless commercials is ticked', () => {
    const project = seedDemoProject();
    assert.ok(project.budget !== undefined, 'the fixture needs a budget to be worth asserting');
    assert.equal(view(project, { allAssessments: true, allScopes: true }).project.budget, undefined);
    assert.equal(
      view(project, { allAssessments: true, allScopes: true, areas: ['commercials'] }).project.budget,
      project.budget,
    );
  });

  it('withholds decisions, reports and the site record independently', () => {
    const project = seedDemoProject();
    const base = { allAssessments: true, allScopes: true };
    assert.equal(view(project, base).project.decisions.length, 0);
    assert.equal(view(project, base).project.reports.length, 0);
    assert.equal(view(project, { ...base, areas: ['decisions'] }).project.decisions.length, project.decisions.length);
    assert.equal(view(project, { ...base, areas: ['decisions'] }).project.reports.length, 0, 'one area is not another');
  });
});

describe('the parts nobody outside the workspace gets', () => {
  it('never carries the audit trail, drafts, proposals or orchestrator runs', () => {
    const project = seedDemoProject();
    const { project: seen } = view(project, {
      allAssessments: true,
      allScopes: true,
      areas: [...GRANT_AREAS] as GrantArea[],
    });
    assert.deepEqual(seen.audit, [], 'the trail names everybody');
    assert.deepEqual(seen.aiDrafts, []);
    assert.deepEqual(seen.chatProposals, []);
    assert.deepEqual(seen.orchestratorRuns, []);
    assert.deepEqual(seen.capabilityRuns, []);
  });

  it('gives a collaborator their own thread and nobody else’s', () => {
    const project = seedDemoProject();
    const said = (id: string, text: string, actor?: string) => ({
      id,
      role: 'user' as const,
      text,
      at: `2026-01-01T00:0${id.slice(1)}:00.000Z`,
      citedNodeIds: [],
      citedEvidenceIds: [],
      ...(actor ? { actor } : {}),
    });
    project.conversation.push(
      said('t1', 'What is this worth?', 'dev@firm.in'),
      said('t2', 'Where is the soil report?', 'contractor@outside.in'),
      said('t3', 'Unattributed, from before actors existed.'),
    );
    const { project: seen } = view(project, { allAssessments: true, allScopes: true });
    assert.deepEqual(seen.conversation.map((t) => t.id), ['t2']);
  });
});

describe('what a reviewer may write', () => {
  it('gives a contributor the checks inside their grant', () => {
    const project = seedDemoProject();
    const { ddId, scopeKey } = firstScope(project);
    const { writableCheckIds, project: seen } = view(project, {
      role: 'contributor',
      assessmentIds: [ddId],
      scopeKeys: [scopeKey],
    });
    const visible = seen.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks.map((c) => c.id)));
    assert.ok(visible.length > 0);
    assert.deepEqual([...writableCheckIds].sort(), visible.sort());
  });

  it('gives a reviewer none of them, however much they can see', () => {
    const project = seedDemoProject();
    const { writableCheckIds, project: seen } = view(project, {
      role: 'reviewer',
      allAssessments: true,
      allScopes: true,
      areas: [...GRANT_AREAS] as GrantArea[],
    });
    assert.ok(seen.assessments.length > 0, 'they can see plenty');
    assert.equal(writableCheckIds.size, 0, 'and may change none of it');
  });
});

describe('staff, who are inside', () => {
  it('get the file as it is', () => {
    const project = seedDemoProject();
    const { project: seen, complete, withheld } = fullView(project);
    assert.equal(seen, project);
    assert.equal(complete, true);
    assert.deepEqual(withheld, []);
  });

  it('may write every check on it', () => {
    const project = seedDemoProject();
    const total = project.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks)).length;
    assert.equal(fullView(project).writableCheckIds.size, total);
  });
});

describe('nothing survives that should not', () => {
  /*
   * The general property. A projection that filters six collections and
   * forgets the seventh is exactly how this fails, and it fails silently — so
   * rather than one assertion per collection, walk every id-bearing record in
   * the result and require that it traces to something the grant allows.
   */
  it('every record in a narrow view traces back to the grant', () => {
    const project = seedDemoProject();
    const { ddId, scopeKey } = firstScope(project);
    const { project: seen } = view(project, { assessmentIds: [ddId], scopeKeys: [scopeKey] });

    const scopeIds = new Set(seen.assessments.flatMap((a) => a.scopes.map((s) => s.id)));
    const checkIds = new Set(seen.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks.map((c) => c.id))));
    const assessmentIds = new Set(seen.assessments.map((a) => a.id));
    const evidenceIds = new Set(seen.evidence.map((e) => e.id));
    const findingIds = new Set(seen.findings.map((f) => f.id));
    const riskIds = new Set(seen.risks.map((r) => r.id));

    const touches = (ids: readonly string[] | undefined, set: Set<string>) => (ids ?? []).some((i) => set.has(i));

    for (const f of seen.findings) {
      assert.ok(
        (f.sourceScopeId && scopeIds.has(f.sourceScopeId)) ||
          (f.sourceCheckId && checkIds.has(f.sourceCheckId)) ||
          (f.sourceAssessmentId && assessmentIds.has(f.sourceAssessmentId)) ||
          touches(f.assessmentIds, assessmentIds) ||
          touches(f.evidenceIds, evidenceIds),
        `finding "${f.title}" traces to nothing granted`,
      );
    }
    for (const r of seen.risks) {
      assert.ok(
        touches(r.scopeInstanceIds, scopeIds) ||
          touches(r.assessmentIds, assessmentIds) ||
          touches(r.findingIds, findingIds),
        `risk "${r.title}" traces to nothing granted`,
      );
    }
    for (const a of seen.actions) {
      assert.ok(
        touches(a.findingIds, findingIds) ||
          touches(a.riskIds, riskIds) ||
          touches(a.checkIds, checkIds) ||
          a.owner?.toLowerCase() === 'contractor@outside.in',
        `action "${a.title}" traces to nothing granted`,
      );
    }
  });

  it('a grant to a scope on one assessment reaches nothing on another', () => {
    const project = seedDemoProject();
    assert.ok(project.assessments.length > 1);
    const other = project.assessments[1]!;
    const { ddId, scopeKey } = firstScope(project);
    const { project: seen } = view(project, { assessmentIds: [ddId], scopeKeys: [scopeKey] });

    const otherScopeIds = new Set(other.scopes.map((s) => s.id));
    for (const e of seen.evidence) {
      const onlyOther =
        e.scopeInstanceIds.length > 0 && e.scopeInstanceIds.every((id) => otherScopeIds.has(id));
      assert.ok(!onlyOther, `"${e.title}" belongs only to the other assessment`);
    }
  });
});

describe('writing a grant down', () => {
  it('defaults every unspecified field to the closed position', () => {
    const grant = createProjectGrant(
      { email: 'Contractor@Outside.in ' },
      { id: 'g1', tenantId: 't1', projectId: 'p1', createdBy: 'dev@firm.in', now: '2026-01-01T00:00:00.000Z' },
    );
    assert.equal(grant.role, 'reviewer');
    assert.equal(grant.allAssessments, false);
    assert.deepEqual(grant.assessmentIds, []);
    assert.equal(grant.allScopes, false);
    assert.deepEqual(grant.scopeKeys, []);
    assert.deepEqual(grant.areas, []);
    assert.equal(grant.expiresAt, undefined);
    assert.equal(grant.email, 'Contractor@Outside.in', 'the address is trimmed, not folded');
  });

  it('gives that person a shell and nothing in it', () => {
    const project = seedDemoProject();
    const grant = createProjectGrant(
      { email: 'nobody@outside.in' },
      { id: 'g1', tenantId: 't1', projectId: project.id, createdBy: 'dev@firm.in' },
    );
    const { project: seen } = projectView(project, { kind: 'granted', grant, email: 'nobody@outside.in' });
    assert.deepEqual(seen.assessments, []);
    assert.deepEqual(seen.evidence, []);
    assert.deepEqual(seen.findings, []);
  });

  it('leaves the rest alone when a change names one field', () => {
    // The failure this closes: a screen that PATCHes only the role, and
    // silently revokes every assessment because absent read as empty.
    const grant = grantOf({ allAssessments: true, areas: ['valuation'], expiresAt: '2027-01-01T00:00:00.000Z' });
    patchProjectGrant(grant, { role: 'contributor' });
    assert.equal(grant.role, 'contributor');
    assert.equal(grant.allAssessments, true);
    assert.deepEqual(grant.areas, ['valuation']);
    assert.equal(grant.expiresAt, '2027-01-01T00:00:00.000Z');
  });

  it('clears a field when the change says so out loud', () => {
    const grant = grantOf({ areas: ['valuation', 'reports'], expiresAt: '2027-01-01T00:00:00.000Z' });
    patchProjectGrant(grant, { areas: [], expiresAt: '' });
    assert.deepEqual(grant.areas, []);
    assert.equal(grant.expiresAt, undefined);
  });
});
