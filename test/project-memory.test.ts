import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractFactsFromProject } from '@realytica/agents';
import { seedDemoProject } from '@realytica/shared';

describe('project memory facts', () => {
  it('teaches stage, health, and pack as context — never findings as evidence', () => {
    const project = seedDemoProject();
    const facts = extractFactsFromProject(project, { now: '2026-08-31T10:00:00.000Z' });
    assert.ok(facts.some((f) => f.predicate === 'at_stage'));
    assert.ok(facts.some((f) => f.predicate === 'case_health'));
    assert.ok(facts.some((f) => f.predicate === 'pack_progress'));
    assert.ok(facts.some((f) => f.predicate === 'working_next'));
    const localityFacts = facts.filter((f) => f.scope === 'locality');
    for (const finding of project.findings) {
      assert.ok(
        !localityFacts.some((f) => f.object.includes(finding.title) || f.object.includes(finding.description.slice(0, 24))),
        `finding “${finding.title}” must not be copied into locality memory`,
      );
    }
  });
});
