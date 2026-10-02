/**
 * How a project is organised, and what follows from it.
 *
 * Stages, departments and workstreams are the frame; approvals, milestones,
 * the site log, quick assessments and certified reports are the work inside
 * it; alerts and the graph are what connect the two. Each piece here is a
 * pure function of the project, so each is tested on a project built in the
 * test rather than through the API.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEPARTMENTS,
  WORKSTREAMS,
  addEvidence,
  addMilestones,
  approvalsRegister,
  buildProjectGraph,
  certifiedReadout,
  changeStage,
  constructionGate,
  createEngagement,
  createProject,
  departmentReach,
  departmentRole,
  documentWorkstream,
  ensureWorkstreamChecks,
  evaluateRevisits,
  fileCertifiedReport,
  graphImpact,
  logSiteEntry,
  parseDocumentText,
  progressSummary,
  quickAssessment,
  scopesOfWorkstreams,
  setTeamMember,
  stageTimeline,
  syncAlerts,
  validateProjectGraph,
  workstreamChecks,
  workstreamOfCheck,
  type DdProject,
} from '@realytica/shared';

function project(stage: DdProject['currentStage'] = 'construction'): DdProject {
  return createProject({ name: 'Frame test', type: 'residential', location: 'Balagere', city: 'Bengaluru', currentStage: stage }, 'RYT-F1');
}

function approval(p: DdProject, documentType: string, facts: Array<[string, string]>) {
  const row = addEvidence(p, { title: documentType, kind: 'approval', status: 'received' }, 'tester');
  row.documentType = documentType;
  row.attachments.push({ id: `att_${row.id}`, fileName: `${documentType}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, storageKey: `${row.id}.pdf`, uploadedAt: new Date().toISOString() });
  row.facts = facts.map(([key, value]) => ({ key, label: key, value, display: value, page: 1, quote: value }));
  return row;
}

describe('the frame', () => {
  it('puts every check in exactly one live or coming workstream', () => {
    const keys = new Set(WORKSTREAMS.map((w) => w.key));
    for (const w of WORKSTREAMS) assert.ok(DEPARTMENTS.some((d) => d.key === w.department));
    assert.equal(workstreamOfCheck('indicative_valuation.market_value'), 'finance.valuation');
    assert.ok(keys.has(workstreamOfCheck('legal.title_chain')));
    assert.deepEqual(scopesOfWorkstreams(['legal.title']).includes('legal'), true);
  });

  it('reads the timeline from the project and its phases', () => {
    const p = project('construction');
    const t = stageTimeline(p);
    assert.equal(t.currentStage, 'construction');
    assert.equal(t.stages.find((s) => s.key === 'pre_development')!.status, 'done');
    assert.equal(t.stages.find((s) => s.key === 'operations')!.status, 'ahead');
    changeStage(p, { subject: 'project', stage: 'testing_commissioning', reason: 'Structure done' }, 'tester');
    assert.equal(stageTimeline(p).current, 'testing_commissioning');
  });

  it('adds only the checks a workstream needs, once', () => {
    const p = project();
    ensureWorkstreamChecks(p, ['legal.title'], 'tester');
    const first = workstreamChecks(p, 'legal.title').length;
    assert.ok(first > 0);
    ensureWorkstreamChecks(p, ['legal.title'], 'tester');
    assert.equal(workstreamChecks(p, 'legal.title').length, first, 'asking again adds nothing');
    assert.equal(p.assessments.length, 1, 'one project record');
  });

  it('opens an engagement on the workstreams it draws on', () => {
    const p = project();
    const e = createEngagement(p, { kind: 'lender_monitoring', client: 'A bank' }, 'tester');
    assert.deepEqual(e.workstreams, ['construction.progress', 'construction.quality', 'legal.approvals', 'finance.budget']);
    assert.ok(workstreamChecks(p, 'construction.progress').length > 0);
  });
});

describe('approvals and the construction gate', () => {
  it('reads what is held from the documents, and what is missing from the stage', () => {
    const p = project('construction');
    const before = approvalsRegister(p);
    assert.equal(before.find((l) => l.kind.key === 'commencement')!.status, 'missing');
    assert.deepEqual(constructionGate(p).open, false);
    approval(p, 'Sanctioned building plan', [['sanction_date', '2024-01-10'], ['sanction_number', 'BBMP/123']]);
    approval(p, 'Commencement certificate', [['issued_on', '2024-02-01']]);
    assert.equal(approvalsRegister(p).find((l) => l.kind.key === 'plan_sanction')!.status, 'in_force');
    assert.equal(constructionGate(p).open, true);
  });

  it('flags an approval that has lapsed', () => {
    const p = project('construction');
    approval(p, 'Environmental clearance', [['issued_on', '2015-01-01'], ['valid_until', '2020-01-01']]);
    assert.equal(approvalsRegister(p).find((l) => l.kind.key === 'environment')!.status, 'expired');
  });
});

describe('progress and the site log', () => {
  it('weights milestones, files an entry once, and raises what site reports', () => {
    const p = project('construction');
    const [m] = addMilestones(p, [{ name: 'Foundation', weight: 20 }, { name: 'Frame', weight: 80 }], 'tester');
    const input = { clientId: 'phone-1', date: '2026-10-01', workDone: 'Raft poured', milestoneUpdates: [{ milestoneId: m!.id, percent: 50 }], issues: [{ title: 'Honeycombing', severity: 'high' as const }] };
    assert.equal(logSiteEntry(p, input, 'site').duplicate, false);
    assert.equal(logSiteEntry(p, input, 'site').duplicate, true, 'the same phone entry twice files once');
    assert.equal(progressSummary(p).percent, 10);
    const raised = syncAlerts(p).map((a) => a.title);
    assert.ok(raised.includes('Work logged without the approvals that allow it'));
    assert.ok(raised.some((t) => t.startsWith('From site:')));
    assert.equal(syncAlerts(p).length, 0, 'an alert is raised once');
  });
});

describe('certified reports', () => {
  it('reads a legal opinion out of its words and flags it when the estimate moves', () => {
    const text = [
      'LEGAL OPINION\n\nDate: 12 March 2024\n\nTo,\nThe Directors, Example Developers\n\nSub: Title of Sy. Nos. 12/1 and 12/2\n\nWe have perused the documents listed below.',
      'On the basis of the documents perused, the owners have clear and marketable title to the property.\n\nEnrolment No. KAR/1234/2005\n\n(S. Example)\nAdvocate',
    ];
    const parsed = parseDocumentText(text, 'Legal opinion.pdf');
    assert.equal(parsed.type, 'legal_opinion');
    const p = project('approvals');
    const row = addEvidence(p, { title: 'Legal opinion', kind: 'certificate', status: 'received' }, 'tester');
    row.documentType = parsed.label;
    row.facts = parsed.facts;
    assert.equal(documentWorkstream(p, row), 'legal.title');
    const readout = certifiedReadout(p, row.id);
    assert.equal(readout.workstream, 'legal.title');
    assert.equal(readout.verdict, 'clear');
    assert.equal(readout.signer.registration, 'KAR/1234/2005');
    const report = fileCertifiedReport(p, { workstream: 'legal.title', title: 'Legal opinion', evidenceId: row.id, signer: { name: 'S. Example', profession: 'Advocate' }, verdict: 'clear' }, 'tester');
    assert.equal(report.status, 'current');
    // A blocker on the title after the opinion: a contradiction recorded as a critical finding.
    p.findings.push({ ...p.findings[0]!, id: 'f1', title: 'Unreleased mortgage', description: 'EC shows a subsisting mortgage', severity: 'critical', discipline: 'legal', status: 'open', evidenceIds: [], riskIds: [], assetIds: [], assessmentIds: [], scopeInstanceIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as DdProject['findings'][number]);
    const verdict = quickAssessment(p, 'legal.title').verdict;
    const flagged = evaluateRevisits(p);
    if (verdict === 'blockers' || verdict === 'conditions') assert.equal(flagged.length, 1, 'a new blocker flags the opinion for revisiting');
  });
});

describe('people', () => {
  it('lets the team list override the firm role, department by department', () => {
    const p = project();
    assert.equal(departmentRole(p, { email: 'staff@firm.in', workspaceRole: 'staff' }, 'legal'), 'contributor');
    setTeamMember(p, { email: 'staff@firm.in', departments: { legal: 'lead' } }, 'tester');
    assert.equal(departmentRole(p, { email: 'staff@firm.in', workspaceRole: 'staff' }, 'legal'), 'lead');
    assert.equal(departmentRole(p, { email: 'staff@firm.in', workspaceRole: 'staff' }, 'finance'), 'contributor', 'the rest stays the firm default');
    assert.equal(departmentRole(p, { email: 'outside@law.in', workspaceRole: 'collaborator' }, 'legal'), undefined);
    const reach = departmentReach({ legal: 'signer' });
    assert.equal(reach.role, 'contributor');
    assert.ok(reach.scopeKeys.includes('legal'));
    assert.ok(reach.areas.includes('reports'));
    assert.ok(!reach.areas.includes('valuation'), 'Legal alone does not open the valuation');
  });
});

describe('the graph', () => {
  it('draws the frame, keeps to the ontology, and walks what a missing approval reaches', () => {
    const p = project('construction');
    createEngagement(p, { kind: 'technical_dd' }, 'tester');
    addMilestones(p, [{ name: 'Frame', weight: 1 }], 'tester');
    const graph = buildProjectGraph(p);
    assert.deepEqual(validateProjectGraph(graph), []);
    const kinds = new Set(graph.nodes.map((n) => n.kind));
    for (const k of ['stage', 'department', 'workstream', 'engagement', 'milestone', 'quick_assessment', 'approval'] as const) assert.ok(kinds.has(k), `has ${k}`);
    const impact = graphImpact(graph, `${p.id}::approval::commencement`)!;
    assert.ok(impact.home.some((n) => n.key === 'legal.approvals'));
    assert.ok(impact.downstream.some((d) => d.node.key === 'construction.progress' && d.via === 'gates'));
    assert.ok(impact.downstream.some((d) => d.node.key === 'finance.valuation'));
    assert.ok(impact.engagements.length === 1);
  });
});
