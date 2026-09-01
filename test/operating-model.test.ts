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
  resolveReportBlock,
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
  packCompleteness,
  sittingChatHistory,
  citeLabel,
  currentTurnProposals,
  wantsCritic,
  talkSittingFromText,
  sittingFromCitedId,
  sittingFromTurn,
  sittingWithField,
  sittingCheckOf,
  checkAdvise,
  noteProjectEdit,
  quotesForCheck,
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
    assert.equal(project.reports.length, 1);
    // The body is a document of blocks now, most of them reading the
    // registers rather than holding a copy of them — so the finding is
    // reachable through the resolver, not stored in the report.
    const findings = report.body.blocks.find((b) => b.source?.kind === 'findings');
    assert.ok(findings, 'a red-flag pack opens with a findings block');
    assert.equal(findings.origin, 'derived');
    assert.ok(resolveReportBlock(project, findings).lines.some((l) => l.includes('Broken chain')));
    // And the scope the caller asked for is pushed onto the block, so it can
    // be widened later without regenerating the document.
    assert.deepEqual(findings.source?.assessmentIds, [dd.id]);
    assert.ok(report.body.blocks.some((b) => b.origin === 'authored'), 'and leaves room for somebody to write');
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
    assert.ok(dash.packCompleteness.total > 0);
    assert.ok(dash.packCompleteness.total < dash.evidenceCompleteness.expected);
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
    assert.ok(graph.nodes.some((n) => n.kind === 'check'));
    assert.ok(graph.edges.some((e) => e.rel === 'has_check'));
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
    assert.equal(
      cockpitPath(id, 'scope', { ddId: 'dd_1', scopeId: 'scp_1', checkId: 'chk_1' }),
      `/projects/${id}/dd/dd_1/scopes/scp_1?check=chk_1`,
    );
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
    assert.equal(wantsDeterministicProjectChat(project, 'What should we do next?'), true);
    assert.equal(wantsDeterministicProjectChat(project, 'Guide me'), true);
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
    assert.match(result.assistantTurn.text, /Today on Greenfield/i);
    assert.doesNotMatch(result.assistantTurn.text, /Wizard for/i);
    assert.ok(result.proposals.some((p) => p.kind === 'add_asset'));
    assert.equal(result.proposals.filter((p) => p.kind === 'start_dd').length, 0);
    assert.ok(result.assistantTurn.proposalIds?.length);
    assert.equal(result.navigations[0]?.target, 'assets');
    const asset = result.proposals.find((p) => p.kind === 'add_asset')!;
    commitChatProposal(project, asset.id);
    assert.ok(project.assets.some((a) => a.name === String(asset.payload.name)));
  });

  it('names one next check on Harohalli and does not dump the library', () => {
    const project = seedDemoProject();
    const pack = packCompleteness(project);
    assert.ok(pack.total < project.evidence.length);
    assert.equal(typeof pack.percent, 'number');
    const result = applyProjectChat(project, 'Guide me');
    assert.match(result.assistantTurn.text, /Today on/i);
    assert.doesNotMatch(result.assistantTurn.text, /Wizard for/i);
    assert.doesNotMatch(result.assistantTurn.text, /292/);
    assert.ok(result.proposals.length <= 3);
    const nav = result.navigations.at(-1);
    assert.equal(nav?.target, 'scope');
    assert.ok(nav?.ddId && nav?.scopeId && nav?.checkId);
    assert.match(result.assistantTurn.text, /pending/i);
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
          quotes: [{ text: 'No objection for occupancy of Tower A subject to hydrant coverage.', page: 1 }],
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
    assert.equal(after.quotes?.[0]?.text, 'No objection for occupancy of Tower A subject to hydrant coverage.');
    const checkId = (card!.payload.checkIds as string[] | undefined)?.[0] ?? after.checkIds[0];
    if (checkId) {
      assert.ok(quotesForCheck(project, checkId).some((q) => /hydrant coverage/i.test(q.text)));
    }
  });

  it('puts scopes, chat thinking, and proposals on the knowledge graph', () => {
    const project = seedDemoProject();
    applyProjectChat(project, 'Guide me');
    const graph = buildProjectGraph(project);
    assert.ok(graph.nodes.some((n) => n.kind === 'scope'));
    assert.ok(graph.nodes.some((n) => n.kind === 'question'));
    assert.ok(graph.nodes.some((n) => n.kind === 'thought'));
    if (project.chatProposals.length) {
      assert.ok(graph.nodes.some((n) => n.kind === 'proposal'));
    }
    assert.ok(graph.edges.some((e) => e.rel === 'has_scope'));
    // `asked` and `thought` used to attach these from the project. They now
    // point the other way as one `raised_on`, which is what makes the one-way
    // rule enforceable: nothing can be reached by walking OUT of a thought.
    assert.ok(graph.edges.some((e) => e.rel === 'raised_on'));
    assert.ok(
      !graph.edges.some((e) => e.from === project.id && graph.nodes.find((n) => n.id === e.to)?.layer === 'deliberation'),
      'no edge runs from the file into deliberation',
    );
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

describe('sitting', () => {
  it('drops wizard and library-dump turns from model history', () => {
    const kept = sittingChatHistory([
      {
        id: 'cht_dump',
        role: 'assistant',
        text: 'Wizard for Harohalli\nEvidence gaps (292 outstanding items). Request 292 outstanding.',
        at: '2026-01-01T00:00:00.000Z',
        citedEvidenceIds: [],
      },
      {
        id: 'cht_guide',
        role: 'assistant',
        text: 'Today on Harohalli.\nRegulatory & Planning · Approval conditions — pending.',
        at: '2026-01-01T00:01:00.000Z',
        citedEvidenceIds: [],
      },
    ]);
    assert.equal(kept.length, 1);
    assert.match(kept[0]!.text, /Today on Harohalli/);
  });

  it('approve all commits this turn, not stale open cards, unless they said every open', () => {
    const project = createProject(
      { name: 'Approve turn', type: 'residential', location: 'Whitefield', city: 'Bengaluru' },
      'RYT-AP',
    );
    applyProjectChat(project, 'Guide me');
    const current = currentTurnProposals(project);
    assert.ok(current.length >= 1);
    const stale = createChatProposal(
      'request_evidence',
      'Stale leftover request',
      'Left over from a library dump.',
      'Would write a collection action.',
      { title: 'Stale leftover request', kind: 'evidence_request', owner: 'operator', priority: 'low' },
      'operator',
    );
    project.chatProposals.push(stale);
    applyProjectChat(project, 'Approve all');
    assert.equal(project.chatProposals.find((p) => p.id === stale.id)?.status, 'proposed');
    assert.ok(current.every((p) => project.chatProposals.find((x) => x.id === p.id)?.status === 'committed'));
    applyProjectChat(project, 'Approve all open');
    assert.equal(project.chatProposals.find((p) => p.id === stale.id)?.status, 'committed');
  });

  it('citeLabel returns titles instead of raw ids', () => {
    const project = seedDemoProject();
    const check = project.assessments[0]?.scopes[0]?.checks[0];
    assert.ok(check);
    const label = citeLabel(project, check!.id);
    assert.ok(label.length > 3);
    assert.doesNotMatch(label, /^chk_/);
  });

  it('critic is deterministic and does not record checks', () => {
    const project = seedDemoProject();
    assert.equal(wantsDeterministicProjectChat(project, 'Review findings'), true);
    assert.equal(wantsCritic('unevidenced findings'), true);
    const before = project.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks.map((c) => `${c.id}:${c.result}`)));
    const result = applyProjectChat(project, 'Review findings');
    assert.match(result.assistantTurn.text, /Critic|unevidenced|no proof|No unevidenced/i);
    const after = project.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks.map((c) => `${c.id}:${c.result}`)));
    assert.deepEqual(after, before);
  });

  it('collection cards carry assessment owner and a due date', () => {
    const project = seedDemoProject();
    const result = applyProjectChat(project, 'Guide me');
    const card = result.proposals.find((p) => p.kind === 'request_evidence');
    if (!card) return;
    assert.equal(typeof card.payload.owner, 'string');
    assert.ok(String(card.payload.owner).length > 0);
    assert.match(String(card.payload.dueDate ?? ''), /^\d{4}-\d{2}-\d{2}$/);
  });

  it('opens the named DD, scope, or check field when chat talks about it', () => {
    const project = seedDemoProject();
    const fire = talkSittingFromText(project, 'Tell me about Fire NOC');
    assert.equal(fire?.kind, 'check');
    assert.ok(fire?.extra.checkId);
    assert.match(fire?.label ?? '', /NOC|Fire/i);

    const dd = talkSittingFromText(project, 'Open Land Acquisition DD');
    assert.equal(dd?.kind, 'dd');
    assert.ok(dd?.extra.ddId);
    assert.match(dd?.label ?? '', /Land Acquisition/i);

    const scope = talkSittingFromText(project, 'open the legal scope');
    assert.equal(scope?.kind, 'scope');
    assert.ok(scope?.extra.ddId && scope?.extra.scopeId);

    const guide = talkSittingFromText(project, 'Guide me');
    assert.equal(guide, null);

    const fireChat = applyProjectChat(project, 'Tell me about Fire NOC');
    const fireNav = fireChat.navigations.at(-1);
    assert.equal(fireNav?.target, 'scope');
    assert.ok(fireNav?.checkId);
    assert.ok(fireNav?.ddId && fireNav?.scopeId);

    const legalChat = applyProjectChat(project, 'open the legal scope');
    const legalNav = legalChat.navigations.at(-1);
    assert.equal(legalNav?.target, 'scope');
    assert.ok(legalNav?.scopeId);
    assert.ok(legalNav?.checkId);
    const legalScope = project.assessments
      .flatMap((a) => a.scopes.map((s) => ({ a, s })))
      .find(({ s }) => s.id === legalNav?.scopeId);
    assert.equal(legalScope?.s.scopeKey, 'legal');
    assert.ok(legalScope?.s.checks.some((c) => c.id === legalNav?.checkId));

    const landProject = seedDemoProject();
    const landTalk = talkSittingFromText(landProject, 'Show Land Acquisition');
    assert.equal(landTalk?.kind, 'dd');
    const landField = sittingWithField(landProject, landTalk);
    assert.equal(landField?.kind, 'check');
    assert.equal(landField?.extra.ddId, landTalk?.extra.ddId);
    const land = applyProjectChat(landProject, 'Show Land Acquisition');
    const landNav = land.navigations.at(-1);
    assert.equal(landNav?.target, 'scope');
    assert.ok(landNav?.checkId);
    assert.equal(landNav?.ddId, landTalk?.extra.ddId);
    const landDd = landProject.assessments.find((a) => a.id === landNav?.ddId);
    assert.match(landDd?.name ?? '', /Land Acquisition/i);
    assert.ok(landDd?.scopes.some((s) => s.checks.some((c) => c.id === landNav?.checkId)));

    const fireHit = sittingCheckOf(project, fire?.extra ?? {});
    assert.ok(fireHit);
    const fireAdvise = checkAdvise(project, fireHit.check);
    assert.ok(fireAdvise.lean === 'tick' || fireAdvise.lean === 'cross');
    assert.match(fireAdvise.why, /evidence|proof|quotes|file|missing/i);

    const next = applyProjectChat(seedDemoProject(), 'Guide me');
    const nextNav = next.navigations.at(-1);
    assert.equal(nextNav?.target, 'scope');
    assert.ok(nextNav?.checkId);
    assert.notEqual(nextNav?.checkId, fireNav?.checkId);
  });

  it('cockpitPath carries evidence and finding query params', () => {
    const id = 'prj_demo';
    assert.equal(cockpitPath(id, 'evidence', { evidenceId: 'evd_1' }), `/projects/${id}/evidence?evidence=evd_1`);
    assert.equal(cockpitPath(id, 'findings', { findingId: 'fnd_1' }), `/projects/${id}/findings?finding=fnd_1`);
    assert.equal(cockpitPath(id, 'assets', { assetId: 'ast_1' }), `/projects/${id}/assets?asset=ast_1`);
  });

  it('fills copilot navigation from a cited check when the model forgot navigate_pane', () => {
    const project = seedDemoProject();
    let checkId = '';
    let ddId = '';
    let scopeId = '';
    for (const a of project.assessments) {
      for (const s of a.scopes) {
        const c = s.checks[0];
        if (c) {
          checkId = c.id;
          ddId = a.id;
          scopeId = s.id;
          break;
        }
      }
      if (checkId) break;
    }
    assert.ok(checkId);
    const fromId = sittingFromCitedId(project, checkId);
    assert.equal(fromId?.kind, 'check');
    const agent = applyProjectAgentTurn(project, `What is the status of ${fromId?.label}?`, {
      text: `The check “${fromId?.label}” is still pending.`,
      proposals: [],
      navigations: [],
      citedNodeIds: [checkId],
    });
    const nav = agent.navigations.at(-1);
    assert.equal(nav?.target, 'scope');
    assert.equal(nav?.checkId, checkId);
    assert.equal(nav?.ddId, ddId);
    assert.equal(nav?.scopeId, scopeId);
    assert.ok(agent.highlightIds.includes(checkId));
    const last = project.conversation.at(-1)!;
    const talk = sittingFromTurn(project, last);
    assert.equal(talk?.kind, 'check');
    assert.equal(talk?.extra.checkId, checkId);
  });

  it('appends a pane write to the conversation thread', () => {
    const project = seedDemoProject();
    const before = project.conversation.length;
    let checkId = '';
    let title = '';
    for (const a of project.assessments) {
      for (const s of a.scopes) {
        const pending = s.checks.find((c) => c.result === 'pending');
        if (pending) {
          checkId = pending.id;
          title = pending.title;
          break;
        }
      }
      if (checkId) break;
    }
    assert.ok(checkId);
    recordCheckResult(project, checkId, { result: 'compliant', comments: 'From the work pane.' });
    noteProjectEdit(project, `Recorded “${title}” as Compliant.`, { citedNodeIds: [checkId] });
    assert.equal(project.conversation.length, before + 2);
    assert.match(project.conversation.at(-2)!.text, new RegExp(title));
    assert.match(project.conversation.at(-1)!.text, /work pane/i);
    assert.ok(sittingFromCitedId(project, checkId)?.kind === 'check');
  });
});
