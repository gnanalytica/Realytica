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
  DEPARTMENT_SHORT,
  FUNCTION_SHORT,
  LIFECYCLE_STAGE_LABEL,
  MENU_DEPARTMENTS,
  STAGES,
  SUB_STAGES,
  SUB_STAGE_LABEL,
  WORKSTREAMS,
  addEvidence,
  addMilestones,
  applyProjectChat,
  approvalsRegister,
  buildProjectGraph,
  certifiedReadout,
  changeStage,
  constructionGate,
  createEngagement,
  createProject,
  departmentReach,
  deriveHealth,
  departmentRole,
  documentTypeOfKind,
  documentWorkstream,
  ensureWorkstreamChecks,
  evaluateRevisits,
  fileCertifiedReport,
  functionDepartment,
  functionKey,
  graphImpact,
  interpretConversation,
  logSiteEntry,
  menuDepartment,
  menuDepartmentsOf,
  menuFunctions,
  parseDocumentText,
  progressSummary,
  quickAssessment,
  scopesOfWorkstreams,
  stageAndStep,
  setTeamMember,
  stageTimeline,
  syncAlerts,
  validateProjectGraph,
  withDepartment,
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

  it('names the stage alone for the step that is the stage itself', () => {
    assert.equal(stageAndStep('construction'), 'Under construction');
    assert.equal(stageAndStep('approvals'), 'Pre-construction · Approvals');
    assert.equal(stageAndStep('pre_construction'), 'Under construction · Mobilisation');
  });

  it('calls no step by the name of a stage, and each step by one name', () => {
    for (const step of SUB_STAGES) {
      for (const stage of STAGES) {
        assert.notEqual(SUB_STAGE_LABEL[step].toLowerCase(), stage.label.toLowerCase(), `the step ${step} carries the name of the stage ${stage.key}`);
      }
      assert.equal(LIFECYCLE_STAGE_LABEL[step], SUB_STAGE_LABEL[step], `${step} has two names`);
    }
  });

  it('reads a stage named in chat as that stage, not as the step that once had its name', () => {
    const movedTo = (said: string, from: DdProject['currentStage'] = 'feasibility') => {
      const move = interpretConversation(project(from), said).proposals.find((x) => x.kind === 'change_stage');
      return (move?.payload as { stage?: string } | undefined)?.stage;
    };
    assert.equal(movedTo('move the project to pre-construction'), 'design', 'the stage is entered by its first step');
    assert.equal(movedTo('move the project to under construction'), 'construction');
    assert.equal(movedTo('move the project to completed'), 'handover');
    assert.equal(movedTo('move the project to land', 'design'), 'opportunity_site');
    assert.equal(movedTo('move the project to mobilisation'), 'pre_construction', 'the step is reached by its own name');
    assert.equal(movedTo('move the project to construction'), 'construction');
    assert.equal(movedTo('move the project to tender & procurement'), 'procurement');
    assert.equal(movedTo('move the project to approvals'), 'approvals');
    assert.equal(movedTo('the project moved to the land registry office'), undefined, 'an ordinary word is not a stage');
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

describe('the menu', () => {
  it('shows five departments by one word, with Design inside Engineering', () => {
    assert.deepEqual([...MENU_DEPARTMENTS], ['legal', 'finance', 'construction', 'commercial', 'procurement']);
    assert.deepEqual(MENU_DEPARTMENTS.map((key) => DEPARTMENT_SHORT[key]), ['Legal', 'Finance', 'Engineering', 'Commercial', 'Procurement']);
    assert.equal(menuDepartment('design'), 'construction');
    for (const key of MENU_DEPARTMENTS) assert.equal(menuDepartment(key), key, `${key} sits under itself`);
  });

  it('lists Engineering while either it or Design is switched on', () => {
    assert.deepEqual(menuDepartmentsOf(['design']), ['construction']);
    assert.deepEqual(menuDepartmentsOf(['construction']), ['construction']);
    assert.deepEqual(menuDepartmentsOf(['finance', 'legal', 'design']), ['legal', 'finance', 'construction'], 'in menu order');
    assert.deepEqual(menuDepartmentsOf(['procurement']), ['procurement']);
  });

  it('calls a workstream a function, and Design’s four one function', () => {
    for (const w of WORKSTREAMS) assert.equal(functionKey(w.key), w.department === 'design' ? 'design' : w.key);
    const engineering = menuFunctions('construction');
    assert.deepEqual(engineering.map((f) => f.key), ['design', 'construction.progress', 'construction.quality', 'construction.site', 'construction.safety'], 'Design leads');
    assert.deepEqual(engineering.map((f) => f.label), ['Design', 'Progress', 'Technical', 'Site', 'Safety']);
    const design = engineering[0]!;
    assert.deepEqual(design.workstreams, ['design.drawings', 'design.compliance', 'design.rfis', 'design.coordination']);
    assert.equal(design.department, 'design', 'its work stays under Design on the record');
    assert.equal(design.built, false);
    assert.equal(engineering[1]!.built, true);
    assert.deepEqual(menuFunctions('design'), engineering, 'asked of Design, the menu answers for Engineering');
  });

  it('gives every workstream to exactly one function, each with one word', () => {
    const functions = MENU_DEPARTMENTS.flatMap((menu) => menuFunctions(menu));
    assert.equal(functions.length, 24);
    assert.deepEqual(functions.flatMap((f) => f.workstreams).sort(), WORKSTREAMS.map((w) => w.key).sort());
    for (const f of functions) {
      assert.match(f.label, /^[A-Za-z]+$/, `${f.key} is not one word`);
      for (const key of f.workstreams) assert.equal(functionKey(key), f.key);
      if (f.key !== 'design') assert.equal(f.label, FUNCTION_SHORT[f.key]);
    }
  });

  it('tells two functions with one word apart by their department', () => {
    // Legal and Commercial each have a Handover. Beside each other the word
    // is not a name, so a function named among others carries its department.
    const functions = MENU_DEPARTMENTS.flatMap((menu) => menuFunctions(menu).map((f) => ({ menu, ...f })));
    const handovers = functions.filter((f) => f.label === 'Handover');
    assert.deepEqual(handovers.map((f) => f.key), ['legal.handover', 'commercial.handover']);
    assert.deepEqual(handovers.map((f) => withDepartment(f.key, f.label)), ['Legal › Handover', 'Commercial › Handover']);
    for (const f of functions) assert.equal(functionDepartment(f.key), f.menu, `${f.key} is under ${f.menu}`);
    const said = functions.map((f) => withDepartment(f.key, f.label));
    assert.equal(new Set(said).size, said.length, 'with its department, every function has a name of its own');
    assert.equal(functionDepartment('design.rfis'), 'construction', 'a design workstream is under Engineering too');
    assert.equal(withDepartment('design', 'Design'), 'Engineering › Design');
    assert.equal(functionDepartment('not.a.function'), undefined);
    assert.equal(withDepartment('not.a.function', 'Something'), 'Something');
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

  it('counts each approval once, and a lapsed one puts the project at risk', () => {
    const p = project('construction');
    approval(p, 'Environmental clearance', [['issued_on', '2015-01-01'], ['valid_until', '2020-01-01']]);
    approval(p, 'Sanctioned building plan', [['sanction_date', '2024-01-10']]);
    const qa = quickAssessment(p, 'legal.approvals');
    const [inForce, due] = qa.headline.match(/^(\d+) of (\d+) in force/)!.slice(1).map(Number);
    const lapsed = Number(qa.headline.match(/(\d+) lapsed/)?.[1] ?? 0);
    const missing = Number(qa.headline.match(/(\d+) missing/)?.[1] ?? 0);
    assert.equal(lapsed, 1);
    assert.equal(inForce! + lapsed + missing, due, qa.headline);
    syncAlerts(p);
    assert.equal(deriveHealth(p), 'red', 'a lapsed clearance is an open critical alert');
  });
});

describe('the vault', () => {
  it('offers what a model took a document for in the register’s own words, and types the row only when a person confirms', () => {
    assert.equal(documentTypeOfKind('encumbrance_certificate'), 'Encumbrance certificate');
    assert.equal(documentTypeOfKind('sanctioned_plan_bbmp'), 'Sanctioned building plan');
    assert.equal(documentTypeOfKind('other'), undefined);
    const p = project('construction');
    // Read by the model, with nothing it could place on a page: no facts, but
    // the model said what the document is. The file's name says nothing of it.
    const scan = { fileName: 'scan 0042.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: 'k-ec-1', kindHint: 'encumbrance_certificate', extractionNotes: 'Form 15 and Form 16 encumbrance certificates.' };
    applyProjectChat(p, '', { ingest: [scan] });
    const row = p.evidence.find((e) => e.attachments.some((a) => a.storageKey === 'k-ec-1'))!;
    assert.equal(row.documentType, undefined, 'a model’s word for a paper types no row');
    assert.equal(row.proposedDocumentType, 'Encumbrance certificate', 'it is an offer on the row');
    assert.notEqual(documentWorkstream(p, row), 'legal.title', 'and files the paper under nothing until a person confirms it');
    assert.deepEqual(row.facts ?? [], [], 'no fact is invented for it');

    // A person says it is not; the same paper read again is not offered the same kind a second time.
    row.refusedDocumentType = row.proposedDocumentType;
    delete row.proposedDocumentType;
    applyProjectChat(p, '', { ingest: [scan] });
    assert.equal(row.proposedDocumentType, undefined);
    assert.equal(row.documentType, undefined);
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

  it('says a role in Design as one in Design, and draws it to no department', () => {
    // Design is a function of Engineering in the graph and has no department
    // node. A role in it is not a role in Engineering, so it is said on the
    // person and joins them to nothing; the project keeps them on file.
    const p = project('construction');
    setTeamMember(p, { email: 'architect@firm.in', name: 'Architect', departments: { design: 'lead' } }, 'tester');
    const graph = buildProjectGraph(p);
    assert.deepEqual(validateProjectGraph(graph), []);
    const member = graph.nodes.find((n) => n.kind === 'member')!;
    assert.equal(member.detail, 'Lead, Design');
    assert.deepEqual(graph.edges.filter((e) => e.from === member.id), [], 'no edge to Engineering, or to anything');
    assert.deepEqual(
      graph.edges.filter((e) => e.to === member.id).map((e) => [e.rel, e.from]),
      [['has_record', p.id]],
      'tied like any record nothing places',
    );
  });

  it('never names Design’s signer as answering for an Engineering function', () => {
    const p = project('construction');
    setTeamMember(p, { email: 'architect@firm.in', name: 'Architect', departments: { design: 'signer' }, signer: { profession: 'Architect' } }, 'tester');
    setTeamMember(p, { email: 'pm@firm.in', name: 'Project manager', departments: { construction: 'lead' } }, 'tester');
    // Reads Engineering, leads Design: the lead is of Design and of nothing else.
    setTeamMember(p, { email: 'both@firm.in', name: 'Both', departments: { construction: 'viewer', design: 'lead' } }, 'tester');
    const graph = buildProjectGraph(p);
    assert.deepEqual(validateProjectGraph(graph), []);
    const both = graph.nodes.find((n) => n.label === 'Both')!;
    assert.equal(both.detail, 'Viewer, Engineering · Lead, Design');
    assert.deepEqual(
      graph.edges.filter((e) => e.from === both.id).map((e) => [e.rel, e.to]),
      [['views', `${p.id}::dept::construction`]],
      'a viewer of Engineering who leads Design does not lead Engineering',
    );
    for (const fn of ['construction.progress', 'construction.site', 'design']) {
      const impact = graphImpact(graph, `${p.id}::ws::${fn}`)!;
      assert.deepEqual(impact.people.map((x) => [x.node.label, x.role]), [['Project manager', 'leads']], `${fn} is answered for by Engineering’s own lead alone`);
    }
  });
});
