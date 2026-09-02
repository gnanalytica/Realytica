import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemoryMemoryStore, extractFactsFromProject, recallForProject } from '@realytica/agents';
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

describe('one workspace’s memory, and another’s prompt', () => {
  /*
   * Memory is cross-project on purpose — that is the entire feature — and was
   * cross-workspace by accident, which is a different thing: a rate one firm
   * observed on its own site, recalled into another firm's prompt.
   * `sourceCaseId` names the project but not who owns it, so it could never
   * answer this.
   *
   * The failure is invisible, which is why it is worth a test rather than a
   * review. A prompt carrying one extra locality observation looks exactly
   * like a prompt without one — and so does a recall that returns nothing
   * because the facts went stale, which is why every case below also proves
   * the facts would have come back under a wider filter.
   */
  const LEARNED = new Date().toISOString();
  const ASKED = new Date(Date.now() + 60_000).toISOString();

  function projectIn(tenantId: string | undefined, suffix: string) {
    const project = seedDemoProject();
    project.tenantId = tenantId;
    project.id = `${project.id}-${suffix}`;
    return project;
  }

  async function storeWith(...projects: ReturnType<typeof projectIn>[]) {
    const store = new InMemoryMemoryStore();
    for (const p of projects) await store.assertMany(extractFactsFromProject(p, { now: LEARNED }));
    return store;
  }

  it('stamps the workspace that learned it', () => {
    const facts = extractFactsFromProject(projectIn('tnt_one', 'a'), { now: LEARNED });
    assert.ok(facts.length > 0);
    assert.ok(facts.every((f) => f.tenantId === 'tnt_one'));
  });

  it('leaves it off a project that has no workspace, rather than guessing one', () => {
    const facts = extractFactsFromProject(projectIn(undefined, 'b'), { now: LEARNED });
    assert.ok(facts.every((f) => f.tenantId === undefined));
  });

  it('still recalls what this workspace learned on an earlier file', async () => {
    const store = await storeWith(projectIn('tnt_one', 'earlier'));
    const recall = await recallForProject(store, projectIn('tnt_one', 'now'), { now: ASKED });
    assert.ok(recall.facts.length > 0, 'the feature itself must survive the fix');
    assert.ok(recall.facts.every((f) => f.tenantId === 'tnt_one'));
  });

  it('does not recall what another workspace learned about the same locality', async () => {
    const store = await storeWith(projectIn('tnt_two', 'theirs'));
    const mine = projectIn('tnt_one', 'mine');

    const recall = await recallForProject(store, mine, { now: ASKED });
    assert.equal(recall.facts.length, 0, 'another firm’s knowledge reached this prompt');
    assert.ok(recall.consultedSubjects.length > 0, 'and it looked, so “no history” is a real answer');

    // And the facts were there to be found. Without this, a recall emptied by
    // staleness would pass this test while the leak stayed open.
    const wider = await recallForProject(store, mine, { now: ASKED, tenants: ['tnt_one', 'tnt_two'] });
    assert.ok(wider.facts.length > 0, 'the filter is what excluded them, not their age');
  });

  it('lets a caller who knows better say so, and never assumes it', async () => {
    // Facts learned before the field existed carry no workspace. Who they
    // belong to is the app's call — the API gives them to the first workspace
    // on the deployment — and this layer refuses to decide it.
    const store = await storeWith(projectIn(undefined, 'old'));
    const mine = projectIn('tnt_one', 'mine');

    assert.equal((await recallForProject(store, mine, { now: ASKED })).facts.length, 0);
    assert.ok((await recallForProject(store, mine, { now: ASKED, tenants: ['tnt_one', null] })).facts.length > 0);
  });
});
