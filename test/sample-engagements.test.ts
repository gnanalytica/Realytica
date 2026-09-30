/**
 * The clean-up of what the illustrative reference tables left on stored
 * projects, and the labelled sample engagements that replace the old seed.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  REFERENCE_DATA,
  REFERENCE_DATA_CLEANUP,
  addDecision,
  addEvidence,
  addFinding,
  addRisk,
  cleanReferenceData,
  createProject,
  isSampleProject,
  projectToIdentity,
  projectToScreenDocuments,
  runScreen,
  seedDemoProject,
  type DdProject,
} from '../packages/shared/src';

/** A project as the old code left it: screened and valued on the tables. */
function legacyProject(): DdProject {
  const project = seedDemoProject();
  // The old seed did not flag its samples.
  delete project.sample;
  delete project.engagement;
  project.migrations = [];
  const identity = projectToIdentity(project);
  const screen = runScreen({
    caseId: project.id,
    reference: project.reference,
    identity,
    documents: projectToScreenDocuments(project),
    refData: REFERENCE_DATA,
    now: '2026-09-01T00:00:00.000Z',
  });
  project.lastScreenResult = screen;
  project.lastScreen = {
    generatedAt: screen.generatedAt,
    engineVersion: screen.engineVersion,
    verdict: screen.recommendation.verdict,
    headline: screen.recommendation.headline,
    reasoning: screen.recommendation.reasoning,
    indicatedMid: screen.indicativeValue.mid,
    indicatedLow: screen.indicativeValue.low,
    indicatedHigh: screen.indicativeValue.high,
    currency: 'INR',
    openCriticalRisks: 0,
  };
  project.valuationRuns.push({ ...project.valuationRuns[0]!, id: 'val-old', localityId: 'in-blr-whitefield', indicatedValue: 5e8, status: 'computed' });
  addFinding(project, { title: 'Asking price above the indicative mid', description: 'x', severity: 'high', discipline: 'commercial_market', status: 'open', screenCode: 'asking_price_above_mid' }, 'old screen');
  addRisk(project, { title: 'Thin comparables', category: 'commercial', cause: 'x', screenCode: 'thin_comparable_evidence', impactType: 'commercial', probability: 'possible', impactScore: 3, materiality: 'medium' }, 'old screen');
  addEvidence(project, { title: 'Locality pack — Whitefield', kind: 'document', source: 'locality_pack', status: 'received' }, 'old screen');
  addDecision(project, { title: 'Screen: pursue', decisionType: 'proceed', decisionMaker: 'old screen', status: 'proposed', rationale: 'Indicative value supports the ask.', screenCode: 'verdict:pursue' }, 'old screen');
  return project;
}

describe('removing what the reference tables left behind', () => {
  it('strips the stored screen, retires the runs and closes what they raised', () => {
    const project = legacyProject();
    assert.ok(project.lastScreenResult!.anchors.length > 0, 'the fixture carries a market blend');

    const report = cleanReferenceData(project, '2026-09-30T00:00:00.000Z');
    assert.equal(report.changed, true);

    const screen = project.lastScreenResult!;
    assert.equal(screen.anchors.length, 0);
    assert.equal(screen.comparables.length, 0);
    assert.equal(screen.indicativeValue.mid, 0);
    assert.equal(project.lastScreen!.indicatedMid, undefined);
    assert.equal(project.valuationRuns.some((r) => r.localityId), false);

    assert.equal(project.findings.find((f) => f.screenCode === 'asking_price_above_mid')!.status, 'rejected');
    assert.equal(project.risks.find((r) => r.screenCode === 'thin_comparable_evidence')!.status, 'closed');
    assert.equal(project.evidence.find((e) => e.source === 'locality_pack')!.status, 'rejected');
    assert.equal(project.decisions.find((d) => d.screenCode === 'verdict:pursue')!.status, 'rejected');

    assert.equal(project.sample, true, 'the old seed’s township is a labelled sample');
    assert.ok(project.migrations!.includes(REFERENCE_DATA_CLEANUP));
    assert.ok(project.audit.some((a) => a.action === 'cleanup'));
  });

  it('runs once', () => {
    const project = legacyProject();
    cleanReferenceData(project);
    assert.equal(cleanReferenceData(project).changed, false);
  });

  it('leaves a client project it has nothing to remove from alone', () => {
    const project = createProject({ name: 'Client villas', type: 'residential', location: 'Hosakote', city: 'Bengaluru' }, 'RYT-0009');
    const before = project.updatedAt;
    assert.equal(cleanReferenceData(project).changed, false);
    assert.equal(project.sample, undefined);
    assert.equal(project.updatedAt, before);
    assert.equal(isSampleProject(project), false);
  });
});

describe('the sample engagements', () => {
  const TENANT = 'tnt_samples';
  let dataDir = '';
  let demo: typeof import('../apps/api/src/routes/demo');
  let store: (typeof import('../apps/api/src/store'))['store'];

  before(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-samples-'));
    process.env.REALYTICA_DATA_DIR = dataDir;
    const storeModule = await import('../apps/api/src/store');
    await storeModule.initStore();
    store = storeModule.store;
    demo = await import('../apps/api/src/routes/demo');
  });

  after(() => rmSync(dataDir, { recursive: true, force: true }));

  it('replaces old samples and never touches a client project', async () => {
    const client = createProject({ name: 'Client villas', type: 'residential', location: 'Hosakote', city: 'Bengaluru' }, 'RYT-0004');
    client.tenantId = TENANT;
    const oldSample = legacyProject();
    oldSample.tenantId = TENANT;
    store.data.projects = [client, oldSample];

    const out = await demo.refreshSampleProjects(TENANT);
    assert.deepEqual(out, { removed: 1, created: 3 });

    const projects = store.data.projects!;
    assert.ok(projects.some((p) => p.id === client.id), 'the client project is still there');
    assert.equal(projects.some((p) => p.id === oldSample.id), false);
    assert.deepEqual(projects.filter(isSampleProject).map((p) => p.reference).sort(), ['SAMPLE-1', 'SAMPLE-2', 'SAMPLE-3']);
  });

  it('arrives with its documents read, a valued run, requests and a report under review', () => {
    const whitefield = store.data.projects!.find((p) => p.reference === 'SAMPLE-1')!;
    const read = whitefield.evidence.filter((e) => (e.facts ?? []).length > 0);
    assert.ok(read.length >= 8, `documents with facts: ${read.length}`);
    const cited = whitefield.assessments
      .flatMap((a) => a.scopes.flatMap((s) => s.checks))
      .flatMap((c) => Object.values(c.fields ?? {}))
      .filter((v) => v.page && v.quote);
    assert.ok(cited.length > 0, 'check values carry the page and words they were read from');

    const run = whitefield.valuationRuns.at(-1)!;
    assert.equal(run.indicatedValue, 12_000 * 45_000);
    assert.equal(run.localityId, undefined);

    assert.equal(whitefield.requests!.length, 3);
    assert.ok(whitefield.requests!.some((r) => r.status === 'answered' && r.answeredByEvidenceId));
    assert.ok(whitefield.reports.some((r) => r.body.blocks.some((b) => b.state === 'approved')));
    assert.equal(whitefield.engagement!.stage, 'analysis');
  });

  it('issues the township’s red flag report with a named sign-off', () => {
    const township = store.data.projects!.find((p) => p.reference === 'SAMPLE-2')!;
    const redFlag = township.reports.find((r) => r.kind === 'red_flag')!;
    assert.equal(redFlag.status, 'issued');
    assert.equal(redFlag.signedBy, 'Asha Menon');
    assert.ok(township.requests!.some((r) => r.status === 'sent' && r.dueAt! < new Date().toISOString().slice(0, 10)), 'one request is overdue');
  });

  it('adds nothing when every sample is already there', async () => {
    assert.equal(await demo.seedDemoProjects(TENANT), 0);
  });
});
