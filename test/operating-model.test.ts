import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHECK_DEFINITIONS,
  DD_TYPE_DEFINITIONS,
  SCOPE_DEFINITIONS,
  addAction,
  addAsset,
  addDecision,
  addEvidence,
  addFinding,
  addRisk,
  assessmentProgress,
  assetTree,
  changeStage,
  changesSincePrevious,
  checksForScope,
  createAssessment,
  createProject,
  filterFindings,
  generateReport,
  isMaterialCheckResult,
  linkFindingAcross,
  recordCheckResult,
  seedDemoProject,
  toDashboard,
  toProjectSummary,
  proposeAiDrafts,
  commitAiDraft,
  buildProjectGraph,
  applyProjectChat,
  applyProjectAgentTurn,
  runProjectOrchestrator,
  clearProjectConversation,
  classifyIngestFile,
  commitChatProposal,
  screenProject,
  cockpitPath,
  paneFromProjectPath,
  PROJECT_COCKPIT_PANES,
  wantsDeterministicProjectChat,
  createChatProposal,
} from '@realytica/shared';

describe('operating model libraries', () => {
  it('ships the BRD scope set and MVP DD type presets', () => {
    assert.equal(SCOPE_DEFINITIONS.length, 14);
    assert.ok(DD_TYPE_DEFINITIONS.some((d) => d.key === 'acquisition'));
    assert.ok(DD_TYPE_DEFINITIONS.some((d) => d.key === 'construction_progress'));
    assert.ok(DD_TYPE_DEFINITIONS.some((d) => d.key === 'indicative_valuation'));
    assert.ok(CHECK_DEFINITIONS.length >= 60);
    const acquisition = DD_TYPE_DEFINITIONS.find((d) => d.key === 'acquisition')!;
    assert.ok(acquisition.defaultScopes.includes('legal'));
    assert.ok(acquisition.defaultScopes.includes('indicative_valuation'));
  });
});

describe('manual DD operating model', () => {
  it('creates a project, nested assets, and preserves stage history', () => {
    const project = createProject({
      name: 'Test township',
      type: 'residential',
      location: 'Harohalli',
      city: 'Bengaluru',
      currentStage: 'design',
    }, 'RYT-TEST');
    const tower = addAsset(project, { name: 'Tower A', assetType: 'Residential tower' });
    addAsset(project, { name: 'Podium', assetType: 'Podium', parentId: tower.id });
    changeStage(project, { subject: 'project', stage: 'construction', reason: 'Contract awarded' });
    changeStage(project, { subject: 'asset', assetId: tower.id, stage: 'construction', reason: 'Structure started' });

    assert.equal(project.currentStage, 'construction');
    assert.equal(project.stageHistory.length, 2);
    assert.equal(project.stageHistory[0].stage, 'design');
    assert.equal(project.stageHistory[1].previousStage, 'design');
    assert.equal(tower.stageHistory.length, 2);
    const tree = assetTree(project);
    assert.equal(tree[0].name, 'Tower A');
    assert.equal(tree[1].parentId, tower.id);
    assert.equal(tree[1].depth, 1);
    assert.ok(project.audit.some((e) => e.action === 'stage_change'));
  });

  it('runs concurrent DDs against different targets from the same libraries', () => {
    const project = createProject({
      name: 'Concurrent',
      type: 'residential',
      location: 'X',
      city: 'Bengaluru',
      currentStage: 'construction',
    }, 'RYT-2');
    const a = addAsset(project, { name: 'Tower A', assetType: 'Tower' });
    const b = addAsset(project, { name: 'Tower B', assetType: 'Tower' });
    const construction = createAssessment(project, {
      ddType: 'construction_progress',
      owner: 'PMC',
      targetType: 'assets',
      targetAssetIds: [a.id],
    });
    const design = createAssessment(project, {
      ddType: 'design',
      owner: 'Architect',
      targetType: 'assets',
      targetAssetIds: [b.id],
    });
    assert.equal(project.assessments.length, 2);
    assert.ok(construction.scopes.some((s) => s.scopeKey === 'quality'));
    assert.ok(design.scopes.some((s) => s.scopeKey === 'technical'));
    assert.equal(construction.targetAssetIds[0], a.id);
    assert.ok(construction.scopes[0].checks.length === checksForScope(construction.scopes[0].scopeKey).length);
    assert.ok(project.evidence.some((e) => e.status === 'expected'));
  });

  it('records a check without inventing a finding on a clean pass', () => {
    const project = createProject({ name: 'P', type: 'residential', location: 'X', city: 'Y' }, 'RYT-3');
    const dd = createAssessment(project, { ddType: 'acquisition', owner: 'Lead', targetType: 'project' });
    const pass = dd.scopes.flatMap((s) => s.checks).find((c) => c.definitionId.endsWith('encumbrances'))!;
    recordCheckResult(project, pass.id, { result: 'compliant', comments: 'EC clear' });
    assert.equal(project.findings.length, 0);
  });

  it('creates a finding only for material check results', () => {
    assert.equal(isMaterialCheckResult('compliant'), false);
    assert.equal(isMaterialCheckResult('not_applicable'), false);
    assert.equal(isMaterialCheckResult('non_compliant'), true);

    const project = createProject({ name: 'P', type: 'residential', location: 'X', city: 'Y' }, 'RYT-4');
    const dd = createAssessment(project, { ddType: 'acquisition', owner: 'Lead', targetType: 'project' });
    const pass = dd.scopes.flatMap((s) => s.checks).find((c) => c.definitionId.endsWith('encumbrances'))!;
    const fail = dd.scopes.flatMap((s) => s.checks).find((c) => c.definitionId.endsWith('title_chain'))!;

    recordCheckResult(project, pass.id, { result: 'compliant', comments: 'EC clear', createFinding: false });
    recordCheckResult(project, fail.id, { result: 'non_compliant', comments: 'Break in 2004' });

    assert.equal(project.findings.length, 1);
    assert.equal(project.findings[0].sourceCheckId, fail.id);
    assert.equal(fail.findingIds.length, 1);
    assert.equal(pass.findingIds.length, 0);
  });

  it('keeps findings, risks, actions and decisions as project-level registers', () => {
    const project = createProject({ name: 'P', type: 'residential', location: 'X', city: 'Y' }, 'RYT-5');
    const tower = addAsset(project, { name: 'Tower A', assetType: 'Tower' });
    const dd1 = createAssessment(project, { ddType: 'construction_progress', owner: 'PMC', targetType: 'assets', targetAssetIds: [tower.id] });
    const dd2 = createAssessment(project, { ddType: 'approval_compliance', owner: 'Legal', targetType: 'project' });
    const ev = addEvidence(project, { title: 'DR-018', kind: 'drawing', status: 'validated' });
    const finding = addFinding(project, {
      title: 'Fire escape width',
      description: 'Built 1050 vs 1200',
      severity: 'critical',
      discipline: 'technical',
      sourceAssessmentId: dd1.id,
      assetIds: [tower.id],
      evidenceIds: [ev.id],
    });
    linkFindingAcross(project, finding.id, { assessmentIds: [dd2.id] });
    addRisk(project, {
      title: 'Approval risk',
      category: 'compliance',
      cause: finding.title,
      impactType: 'compliance',
      probability: 'likely',
      impactScore: 5,
      materiality: 'critical',
      findingIds: [finding.id],
      assessmentIds: [dd1.id, dd2.id],
    });
    addAction(project, {
      title: 'Rectify and reinspect',
      kind: 'remediation',
      owner: 'Contractor',
      priority: 'critical',
      findingIds: [finding.id],
    });
    addDecision(project, {
      title: 'Hold payment',
      decisionType: 'hold_payment',
      decisionMaker: 'Owner',
      rationale: 'Until escape width matches the sanctioned drawing.',
      findingIds: [finding.id],
    });

    assert.equal(project.findings.length, 1);
    assert.ok(project.findings[0].assessmentIds.includes(dd1.id));
    assert.ok(project.findings[0].assessmentIds.includes(dd2.id));
    assert.equal(filterFindings(project, { assessmentId: dd2.id }).length, 1);
    assert.equal(project.risks[0].findingIds[0], finding.id);
    assert.equal(project.findings[0].riskIds.length, 1);
    assert.equal(project.findings[0].actionIds.length, 1);
    assert.equal(project.findings[0].decisionIds.length, 1);
  });

  it('generates reports as views of the registers', () => {
    const project = createProject({ name: 'P', type: 'residential', location: 'X', city: 'Y' }, 'RYT-6');
    const dd = createAssessment(project, { ddType: 'acquisition', owner: 'Lead', targetType: 'project' });
    addFinding(project, {
      title: 'Broken chain',
      description: 'Gap in 1991',
      severity: 'high',
      discipline: 'legal',
      sourceAssessmentId: dd.id,
    });
    const report = generateReport(project, { kind: 'red_flag', assessmentIds: [dd.id], generatedBy: 'Lead' });
    assert.equal(report.status, 'generated');
    assert.ok(report.body.summary.includes('findings') || report.body.sections.length > 0);
    assert.ok(report.body.sections.some((s) => s.paragraphs.some((p) => p.includes('Broken chain'))));
    assert.equal(project.reports.length, 1);
  });

  it('compares a DD with its prior run', () => {
    const project = createProject({ name: 'P', type: 'residential', location: 'X', city: 'Y' }, 'RYT-7');
    const first = createAssessment(project, { ddType: 'construction_progress', name: 'DD #03', owner: 'PMC', targetType: 'project' });
    addFinding(project, {
      title: 'Open NCR on waterproofing',
      description: 'Terrace leak',
      severity: 'medium',
      discipline: 'quality',
      sourceAssessmentId: first.id,
    });
    const second = createAssessment(project, {
      ddType: 'construction_progress',
      name: 'DD #04',
      owner: 'PMC',
      targetType: 'project',
      priorAssessmentId: first.id,
    });
    addFinding(project, {
      title: 'Open NCR on waterproofing',
      description: 'Still open',
      severity: 'medium',
      discipline: 'quality',
      sourceAssessmentId: second.id,
    });
    addFinding(project, {
      title: 'New fire-escape deviation',
      description: 'Width short',
      severity: 'critical',
      discipline: 'technical',
      sourceAssessmentId: second.id,
    });
    const diff = changesSincePrevious(project, second.id);
    assert.ok(diff);
    assert.equal(diff!.newFindings.length, 1);
    assert.equal(diff!.newFindings[0].title, 'New fire-escape deviation');
    assert.ok(diff!.repeatedTitles.includes('open ncr on waterproofing'));
  });
});

describe('demo township seed', () => {
  it('is operable without AI and has concurrent DDs plus shared registers', () => {
    const project = seedDemoProject();
    const summary = toProjectSummary(project);
    assert.equal(project.assets.length >= 8, true);
    assert.ok(project.assessments.length >= 4);
    assert.ok(project.assessments.some((a) => a.status === 'completed'));
    assert.ok(project.assessments.filter((a) => a.status === 'active').length >= 2);
    const fire = project.findings.find((f) => f.title.includes('Fire escape'));
    assert.ok(fire);
    assert.ok(fire!.assessmentIds.length >= 2);
    assert.ok(project.risks.length >= 2);
    assert.ok(project.actions.length >= 2);
    assert.ok(project.decisions.length >= 1);
    assert.ok(project.reports.length >= 1);
    assert.ok(project.audit.length > 0);
    assert.equal(summary.health, 'red');
    const construction = project.assessments.find((a) => a.ddType === 'construction_progress')!;
    assert.ok(assessmentProgress(construction).percent > 0);
  });
});

describe('BRD later phases on the same project', () => {
  it('computes an IBBI-structured indicative valuation and dashboard', () => {
    const project = seedDemoProject();
    assert.ok(project.portfolio);
    assert.ok(project.valuationRuns.length >= 1);
    const run = project.valuationRuns[0];
    assert.ok(run.indicatedValue > 0);
    assert.ok(run.ibbi.approaches.length >= 1);
    assert.equal(run.signOff, 'unsigned');
    assert.ok(run.ibbi.caveats.some((c) => /certified/i.test(c)));
    const dash = toDashboard(project);
    assert.ok(dash.evidenceCompleteness.expected > 0);
    assert.ok(dash.ddProgress.length >= 4);
    assert.ok(dash.capabilities.some((c) => c.kind === 'valuation' && c.status === 'computed'));
  });

  it('proposes AI drafts that only write registers after commit', () => {
    const project = createProject({
      name: 'Drafts',
      type: 'residential',
      location: 'Whitefield',
      city: 'Bengaluru',
    }, 'RYT-AI');
    addEvidence(project, { title: 'Mother deed', kind: 'document', status: 'missing' });
    const drafts = proposeAiDrafts(project);
    assert.ok(drafts.some((d) => d.kind === 'orchestrator_plan'));
    assert.ok(drafts.some((d) => d.kind === 'action'));
    const action = drafts.find((d) => d.kind === 'action')!;
    const before = project.actions.length;
    commitAiDraft(project, action.id);
    assert.equal(project.actions.length, before + 1);
    assert.equal(action.status, 'committed');
  });

  it('builds a project graph from register links', () => {
    const project = seedDemoProject();
    const graph = buildProjectGraph(project);
    assert.ok(graph.nodes.some((n) => n.kind === 'finding'));
    assert.ok(graph.edges.some((e) => e.rel === 'found' || e.rel === 'raises'));
  });
});

describe('project cockpit chat', () => {
  it('answers from registers with no model and records the thread', () => {
    const project = seedDemoProject();
    const before = project.conversation.length;
    const result = applyProjectChat(project, 'Give me a briefing');
    assert.equal(project.conversation.length, before + 2);
    assert.match(result.assistantTurn.text, /Harohalli/i);
    assert.match(result.assistantTurn.text, /finding/i);
    assert.equal(result.commands.length, 0);
  });

  it('opens the knowledge graph from a command', () => {
    const project = seedDemoProject();
    const result = applyProjectChat(project, 'Open the knowledge graph');
    assert.equal(result.navigations[0]?.target, 'graph');
    assert.ok(result.commands.some((c) => /graph/i.test(c)));
  });

  it('orchestrates into drafts without writing registers', () => {
    const project = seedDemoProject();
    const actionsBefore = project.actions.length;
    const result = applyProjectChat(project, 'Orchestrate the next DD plan');
    assert.ok(project.orchestratorRuns.length >= 1);
    assert.ok(project.aiDrafts.length >= 1);
    assert.equal(project.actions.length, actionsBefore);
    assert.ok(result.navigations.some((n) => n.target === 'orchestrate' || n.target === 'drafts'));
    assert.match(result.assistantTurn.text, /draft/i);
  });

  it('runs an indicative valuation from chat', () => {
    const project = seedDemoProject();
    const before = project.valuationRuns.length;
    const result = applyProjectChat(project, 'Run valuation');
    assert.equal(project.valuationRuns.length, before + 1);
    assert.equal(result.navigations[0]?.target, 'valuation');
    assert.match(result.assistantTurn.text, /indicative/i);
  });

  it('closes a named action from chat', () => {
    const project = seedDemoProject();
    const open = project.actions.find((a) => a.status !== 'closed');
    assert.ok(open);
    const result = applyProjectChat(project, `Close action "${open!.title}"`);
    assert.equal(project.actions.find((a) => a.id === open!.id)?.status, 'closed');
    assert.equal(result.navigations[0]?.target, 'actions');
  });

  it('runProjectOrchestrator snapshots capabilities and does not auto-commit', () => {
    const project = createProject({
      name: 'Orch',
      type: 'residential',
      location: 'Whitefield',
      city: 'Bengaluru',
    }, 'RYT-ORC');
    addEvidence(project, { title: 'Mother deed', kind: 'document', status: 'missing' });
    const run = runProjectOrchestrator(project);
    assert.ok(run.draftIds.length >= 1);
    assert.ok(project.capabilityRuns.length >= 1);
    assert.equal(project.actions.length, 0);
    clearProjectConversation(project);
    applyProjectChat(project, 'hello');
    clearProjectConversation(project);
    assert.equal(project.conversation.length, 0);
  });

  it('treats the cockpit as the project home with register and DD panes', () => {
    const id = 'prj_demo';
    assert.ok(PROJECT_COCKPIT_PANES.includes('overview'));
    assert.ok(PROJECT_COCKPIT_PANES.includes('dd'));
    assert.ok(PROJECT_COCKPIT_PANES.includes('evidence'));
    assert.equal(cockpitPath(id, 'overview'), `/projects/${id}`);
    assert.equal(cockpitPath(id, 'dd'), `/projects/${id}/dd`);
    assert.equal(cockpitPath(id, 'scope', { ddId: 'dd_1', scopeId: 'scp_1' }), `/projects/${id}/dd/dd_1/scopes/scp_1`);
    assert.equal(cockpitPath(id, 'drafts'), `/projects/${id}/ai`);
    assert.equal(cockpitPath(id, 'actions'), `/projects/${id}/risks`);
    assert.equal(paneFromProjectPath(`/projects/${id}`), 'overview');
    assert.equal(paneFromProjectPath(`/projects/${id}/cockpit`), 'overview');
    assert.equal(paneFromProjectPath(`/projects/${id}/dd/dd_1/scopes/scp_1`), 'scope');
    assert.equal(paneFromProjectPath(`/projects/${id}/ai`), 'drafts');
  });

  it('sends questions to the agent path and keeps person commands deterministic', () => {
    const project = createProject(
      { name: 'Agent split', type: 'residential', location: 'Whitefield', city: 'Bengaluru' },
      'RYT-AG',
    );
    assert.equal(wantsDeterministicProjectChat(project, 'What should we do next?'), false);
    assert.equal(wantsDeterministicProjectChat(project, 'Guide me'), false);
    assert.equal(wantsDeterministicProjectChat(project, 'Set owner to Priya Shah'), true);
    assert.equal(wantsDeterministicProjectChat(project, 'Approve all'), true);
    assert.equal(wantsDeterministicProjectChat(project, 'Open the knowledge graph'), true);
    const agent = applyProjectAgentTurn(project, 'What is open?', {
      text: 'Two findings need evidence.',
      proposals: [
        createChatProposal(
          'request_evidence',
          'Request mother deed',
          'Gap on title.',
          'Adds an evidence-request action.',
          { title: 'Request mother deed', kind: 'evidence_request', owner: 'operator', priority: 'high' },
          'operator',
        ),
      ],
      navigations: [{ target: 'actions' }],
      toolCalls: [{ name: 'project_copilot', summary: 'Proposed an evidence request' }],
    });
    assert.equal(project.actions.length, 0);
    assert.equal(agent.proposals.length, 1);
    assert.equal(project.chatProposals[0]?.status, 'proposed');
    assert.match(project.conversation.at(-1)?.text ?? '', /two findings/i);
  });
});

describe('project chat wizard', () => {
  it('guides an empty project with asset and DD cards', () => {
    const project = createProject(
      { name: 'Greenfield', type: 'residential', location: 'Whitefield', city: 'Bengaluru' },
      'RYT-WZ',
    );
    const result = applyProjectChat(project, 'Guide me');
    assert.match(result.assistantTurn.text, /Wizard for RYT-WZ/i);
    assert.ok(result.proposals.some((p) => p.kind === 'add_asset'));
    assert.ok(result.proposals.some((p) => p.kind === 'start_dd'));
    assert.ok(result.assistantTurn.proposalIds?.length);
    const asset = result.proposals.find((p) => p.kind === 'add_asset')!;
    commitChatProposal(project, asset.id);
    assert.ok(project.assets.some((a) => a.name === String(asset.payload.name)));
  });

  it('recommends remaining construction DD types on Harohalli', () => {
    const project = seedDemoProject();
    const result = applyProjectChat(project, 'Which DD types should I start?');
    assert.ok(result.proposals.some((p) => p.kind === 'start_dd'));
    assert.ok(
      result.proposals.some((p) => /quality|hse|technical|contractor|procurement/i.test(p.title)),
      result.proposals.map((p) => p.title).join(', '),
    );
  });

  it('classifies Fire_NOC.pdf against the expected Fire NOC gap', () => {
    const project = seedDemoProject();
    const classified = classifyIngestFile(project, {
      fileName: 'Fire_NOC.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 12,
      storageKey: 'docs/fire.pdf',
    });
    assert.equal(classified.hint.kind, 'approval');
    assert.match(classified.evidence?.title ?? '', /fire noc/i);
  });

  it('files an attached document only after approve', () => {
    const project = seedDemoProject();
    const gap = project.evidence.find((e) => e.title === 'Fire NOC');
    assert.ok(gap);
    assert.notEqual(gap!.status, 'received');
    const result = applyProjectChat(project, '', {
      ingest: [
        {
          fileName: 'Fire_NOC.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4,
          storageKey: 'docs/fire.pdf',
          excerpt: 'Fire NOC issued for Tower A',
        },
      ],
    });
    const card = result.proposals.find((p) => p.kind === 'file_evidence');
    assert.ok(card);
    assert.equal(project.evidence.find((e) => e.id === gap!.id)?.status, gap!.status);
    const committed = commitChatProposal(project, card!.id);
    assert.equal(committed.recordId, gap!.id);
    const after = project.evidence.find((e) => e.id === gap!.id)!;
    assert.equal(after.status, 'received');
    assert.equal(after.attachments.length, 1);
  });

  it('puts scopes, chat thinking, and proposals on the knowledge graph', () => {
    const project = seedDemoProject();
    applyProjectChat(project, 'Guide me');
    const graph = buildProjectGraph(project);
    assert.ok(graph.nodes.some((n) => n.kind === 'scope'));
    assert.ok(graph.nodes.some((n) => n.kind === 'question'));
    assert.ok(graph.nodes.some((n) => n.kind === 'thought'));
    assert.ok(graph.nodes.some((n) => n.kind === 'proposal'));
    assert.ok(graph.edges.some((e) => e.rel === 'has_scope'));
    assert.ok(graph.edges.some((e) => e.rel === 'asked' || e.rel === 'thought'));
  });

  it('offers a report card that cites findings and commits into the register', () => {
    const project = createProject(
      { name: 'Report me', type: 'residential', location: 'Whitefield', city: 'Bengaluru' },
      'RYT-RPT',
    );
    addFinding(project, {
      title: 'Unregistered partition',
      description: 'Title chain gap.',
      severity: 'critical',
      discipline: 'legal',
    });
    const result = applyProjectChat(project, 'Generate a red flag report');
    const card = result.proposals.find((p) => p.kind === 'generate_report');
    assert.ok(card);
    const committed = commitChatProposal(project, card!.id);
    assert.equal(project.reports.length, 1);
    assert.equal(project.reports[0].id, committed.recordId);
    assert.equal(project.reports[0].kind, 'red_flag');
  });

  it('starts a named DD from imperative chat as a person command', () => {
    const project = createProject(
      { name: 'Start dd', type: 'residential', location: 'Whitefield', city: 'Bengaluru', currentStage: 'construction' },
      'RYT-DD',
    );
    const result = applyProjectChat(project, 'Start Construction Progress DD');
    assert.ok(result.commands.some((c) => /Construction Progress/i.test(c)));
    assert.ok(project.assessments.some((a) => a.ddType === 'construction_progress'));
    assert.ok(project.assessments[0].scopes.length > 0);
  });

  it('applies an imperative project edit from chat and highlights the record', () => {
    const project = createProject(
      { name: 'Edit me', type: 'residential', location: 'Whitefield', city: 'Bengaluru' },
      'RYT-ED',
    );
    const result = applyProjectChat(project, 'Set owner to Priya Shah');
    assert.equal(project.owner, 'Priya Shah');
    assert.ok(result.commands.some((c) => /applied/i.test(c)));
    assert.ok(result.highlightIds.includes(project.id));
    assert.equal(result.navigations.at(-1)?.target, 'overview');
  });

  it('advises a land-area update from a statement and writes it only on approve', () => {
    const project = createProject(
      { name: 'Acres', type: 'residential', location: 'Whitefield', city: 'Bengaluru' },
      'RYT-AC',
    );
    const result = applyProjectChat(project, 'Land area is 12 acres');
    assert.equal(project.landAreaSqm, undefined);
    const card = result.proposals.find((p) => p.kind === 'patch_project');
    assert.ok(card);
    assert.equal(card!.payload.landAreaSqm, 48562);
    const committed = applyProjectChat(project, 'Approve all');
    assert.equal(project.landAreaSqm, 48562);
    assert.ok(committed.highlightIds.includes(project.id));
  });

  it('adds a named asset from chat immediately when asked to add it', () => {
    const project = createProject(
      { name: 'Towers', type: 'residential', location: 'Whitefield', city: 'Bengaluru' },
      'RYT-TW',
    );
    const result = applyProjectChat(project, 'Add Tower D as a residential tower');
    assert.ok(project.assets.some((a) => a.name === 'Tower D'));
    assert.ok(result.highlightIds.length >= 1);
    assert.equal(result.navigations.at(-1)?.target, 'assets');
  });

  it('offers Kaveri portal cards and files a collection action on approve', () => {
    const project = createProject(
      { name: 'Portals', type: 'residential', location: 'Whitefield', city: 'Bengaluru' },
      'RYT-PT',
    );
    const result = applyProjectChat(project, 'How do I get the EC from Kaveri?');
    assert.ok(result.proposals.some((p) => p.kind === 'open_connector'));
    assert.match(result.assistantTurn.text, /does not log in|do not scrape/i);
    applyProjectChat(project, 'Approve all');
    assert.ok(project.actions.some((a) => /Kaveri/i.test(a.title)));
    assert.ok(project.evidence.some((e) => e.status === 'requested' && /Kaveri/i.test(e.title)));
  });

  it('files Maps context from a places pull only after approve', () => {
    const project = createProject(
      { name: 'Maps', type: 'residential', location: 'Whitefield', city: 'Bengaluru' },
      'RYT-MP',
    );
    const result = applyProjectChat(project, "What's nearby?", {
      sides: {
        places: {
          provider: 'google',
          configured: true,
          query: 'Whitefield, Bengaluru',
          resolvedAddress: 'Whitefield, Bengaluru, Karnataka',
          precision: 'locality_centre',
          caveat: 'Neighbourhood pin, not a boundary.',
          amenities: [{ kind: 'school', name: 'Test School', metres: 800 }],
          gaps: [],
        },
      },
    });
    assert.equal(project.evidence.filter((e) => e.kind === 'gis').length, 0);
    assert.ok(result.proposals.some((p) => p.kind === 'file_evidence'));
    applyProjectChat(project, 'Approve all');
    const row = project.evidence.find((e) => e.source === 'google' && e.kind === 'gis');
    assert.ok(row);
    assert.match(row!.description ?? '', /Test School/);
  });

  it('proposes web findings from sourced hits and not from an empty search', () => {
    const project = createProject(
      { name: 'Web', type: 'residential', location: 'Whitefield', city: 'Bengaluru' },
      'RYT-WB',
    );
    const empty = applyProjectChat(project, 'Search the web for this locality', {
      sides: { web: { enabled: false, query: 'Whitefield', hits: [], note: 'Web search is disabled.' } },
    });
    assert.equal(empty.proposals.filter((p) => p.kind === 'add_finding').length, 0);
    assert.match(empty.assistantTurn.text, /disabled/i);
    const result = applyProjectChat(project, 'Search the web for this locality', {
      sides: {
        web: {
          enabled: true,
          query: 'Whitefield market',
          hits: [{ title: 'Corridor listing note', claim: 'Asking prices moved this quarter.', url: 'https://example.com/note' }],
        },
      },
    });
    assert.ok(result.proposals.some((p) => p.kind === 'add_finding'));
  });

  it('files the locality pack as evidence on approve', () => {
    const project = createProject(
      { name: 'Locality', type: 'residential', location: 'Whitefield', city: 'Bengaluru' },
      'RYT-LC',
    );
    const result = applyProjectChat(project, "What's the locality market?");
    const card = result.proposals.find((p) => p.kind === 'file_evidence');
    assert.ok(card);
    applyProjectChat(project, `Approve "${card!.title}"`);
    assert.ok(project.evidence.some((e) => e.source === 'locality_pack'));
  });

  it('commits an imperative risk from chat onto the work register', () => {
    const project = createProject(
      { name: 'Risks', type: 'residential', location: 'Whitefield', city: 'Bengaluru' },
      'RYT-RK',
    );
    const result = applyProjectChat(project, 'Add risk: Access road not adopted');
    assert.ok(project.risks.some((r) => /Access road/i.test(r.title)));
    assert.equal(project.assets.some((a) => a.name.toLowerCase() === 'risk'), false);
    assert.ok(result.highlightIds.length >= 1);
  });

  it('proposes a property screen from chat and writes registers on approve', () => {
    const project = seedDemoProject();
    const offered = applyProjectChat(project, 'Should we pursue this?');
    const card = offered.proposals.find((p) => p.kind === 'run_screen');
    assert.ok(card);
    const beforeFindings = project.findings.length;
    const beforeRisks = project.risks.length;
    applyProjectChat(project, `Approve "${card!.title}"`);
    assert.ok(project.lastScreen);
    assert.ok(project.valuationRuns.some((v) => v.status === 'computed'));
    assert.ok(project.findings.length >= beforeFindings);
    assert.ok(project.risks.length >= beforeRisks);
    assert.ok(project.decisions.some((d) => /Screen:/i.test(d.title) && d.status === 'proposed'));
    const again = screenProject(project, 'operator');
    assert.equal(again.findingIds.length, 0);
  });
});
