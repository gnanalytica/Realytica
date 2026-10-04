/**
 * The project graph is a graph OF THE PROPERTY, not only of the workflow.
 *
 * Before this, a file's graph could be traversed end to end without ever
 * reaching the land being bought. It held project -> assessment -> scope ->
 * check -> finding -> risk -> action and the evidence each rested on: all true,
 * none of it the property. There was no parcel node, no owner, no deed — while
 * `runScreen` was computing a full chain of title on every screen and dropping
 * everything but the summary.
 *
 * These tests pin the two claims that closed that: the property entities are
 * in the graph, and the vocabulary that describes them is closed.
 *
 * And two about its shape. The frame the records sit in is the one the menu
 * shows: four stages, five departments, and their functions, with Design one
 * function inside Engineering. And nothing floats: every node can be reached
 * from the project, because a record no walk arrives at is on the file and
 * missing from every answer the graph gives.
 *
 * They run against the seeds and a hand-built title summary rather than a
 * mock, because the property under test is what the REAL projection emits.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addAction,
  addAsset,
  addDecision,
  addEvidence,
  addFinding,
  addLink,
  addMilestones,
  addQuestionnaire,
  addRisk,
  addSheet,
  addSiteVisit,
  answerQuestion,
  applyProjectChat,
  attachEvidenceFile,
  buildProjectGraph,
  changeStage,
  commitAiDraft,
  createEngagement,
  createProject,
  ensureWorkstreamChecks,
  fileCertifiedReport,
  findProjectNodes,
  FUNCTION_SHORT,
  isProjectEdgeKind,
  isProjectNodeKind,
  logSiteEntry,
  MENU_DEPARTMENTS,
  PROJECT_EDGE_KINDS,
  PROJECT_EDGE_LABEL,
  PROJECT_EDGE_LABEL_AWAITED,
  PROJECT_NODE_KINDS,
  projectEdgeEndpointsValid,
  projectEdgePhrase,
  projectFrameLabels,
  projectLayerFor,
  projectNodeAwaited,
  proposeAiDrafts,
  seedBdaReferenceProject,
  seedDemoProject,
  setProjectDepartments,
  setTeamMember,
  STAGES,
  SUB_STAGE_LABEL,
  systemLinks,
  validateProjectGraph,
  WORKSTREAMS,
  workstreamChecks,
  type DdProject,
  type ProjectGraphEdge,
  type ProjectGraphNode,
  type TitleGraphSummary,
} from '@realytica/shared';

type Graph = { nodes: ProjectGraphNode[]; edges: ProjectGraphEdge[] };

/** A bare project with every department on, standing at the given step. */
function bareProject(stage: DdProject['currentStage'] = 'construction'): DdProject {
  return createProject({ name: 'Frame test', type: 'residential', location: 'Balagere', city: 'Bengaluru', currentStage: stage }, 'RYT-G1');
}

/**
 * A project given one of each record that names nothing else on the file: an
 * action with no finding behind it, a finding no check raised, a decision
 * resting on neither, and a document nothing cites.
 */
function looseProject() {
  const project = bareProject();
  const action = addAction(project, { title: 'Repoint the parapet', kind: 'remediation', owner: 'QS', priority: 'high' });
  const finding = addFinding(project, { title: 'Parapet is cracked', description: 'Cracks along the north parapet.', severity: 'medium', discipline: 'technical' });
  const decision = addDecision(project, { title: 'Hold the last payment', decisionType: 'hold_payment', decisionMaker: 'Board', rationale: 'Until the parapet is made good.' });
  const document = addEvidence(project, { title: 'A letter nobody has read', kind: 'document' });
  return { project, action, finding, decision, document };
}

/**
 * What a walk from the project never arrives at, crossing each edge either
 * way. `placedOnly` leaves out the edges that start at talk, the way the
 * builder does when it decides whether a record is placed: being cited in
 * the chat is not being placed.
 */
function unreached(graph: Graph, projectId: string, opts: { without?: string; placedOnly?: boolean } = {}): string[] {
  const layer = new Map(graph.nodes.map((n) => [n.id, n.layer]));
  const beside = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const edge of graph.edges) {
    if (edge.id === opts.without) continue;
    if (opts.placedOnly && layer.get(edge.from) === 'deliberation') continue;
    beside.get(edge.from)!.push(edge.to);
    beside.get(edge.to)!.push(edge.from);
  }
  const seen = new Set([projectId]);
  const queue = [projectId];
  while (queue.length > 0) {
    for (const id of beside.get(queue.pop()!) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(id);
    }
  }
  return graph.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
}

/** The relations touching one node, each with the node at its other end. */
function touching(graph: Graph, id: string): Array<[string, string]> {
  return graph.edges.filter((e) => e.from === id || e.to === id).map((e) => [e.rel, e.from === id ? e.to : e.from]);
}

/** A screen result carrying a two-link chain, one contradiction and a break. */
function titleSummary(): TitleGraphSummary {
  return {
    builtAt: '2026-08-31T00:00:00.000Z',
    nodeCount: 7,
    edgeCount: 8,
    integrityScore: 62,
    headline: 'Two conveyances on file; the 1994 schedule does not close.',
    contradictions: [
      {
        id: 'con-extent',
        kind: 'area_mismatch',
        subject: 'Extent of Sy. No. 118/2',
        statement: 'The sale deed recites 1,208 sqm; the khata records 1,161 sqm.',
        claims: [
          { sourceRef: 'doc-1', sourceLabel: 'Sale deed', fieldKey: 'extent', value: '1208', unit: 'sqm', confidence: 0.9 },
          { sourceRef: 'doc-2', sourceLabel: 'Khata extract', fieldKey: 'extent', value: '1161', unit: 'sqm', confidence: 0.8 },
        ],
        divergence: 0.039,
        severity: 'warning',
        resolvedBy: ['Obtain a fresh survey sketch from the taluk office.'],
      },
    ],
    resolutionPaths: [],
    chains: [
      {
        parcelNodeId: 'tg-parcel-118-2',
        parcelLabel: 'Sy. No. 118/2, Harohalli',
        rootAt: '1994-06-02',
        yearsEstablished: 32,
        yearsExpected: 30,
        breaks: [
          {
            id: 'brk-1',
            kind: 'missing_predecessor',
            statement: 'No registered instrument between the 1994 grant and the 1998 gift.',
            severity: 'serious',
            resolvedBy: ['Produce the mother deed.'],
          },
        ],
        links: [
          {
            id: 'lnk-1',
            instrumentNodeId: 'tg-inst-grant-1994',
            label: 'Grant, 1994',
            at: '1994-06-02T00:00:00.000Z',
            fromPartyNodeId: 'tg-party-state',
            fromPartyLabel: 'State of Karnataka',
            toPartyNodeId: 'tg-party-ramaiah',
            toPartyLabel: 'Ramaiah S/o Muniyappa',
            extentSqm: 1208,
          },
          {
            id: 'lnk-2',
            instrumentNodeId: 'tg-inst-gift-1998',
            label: 'Gift deed, 1998',
            at: '1998-11-14T00:00:00.000Z',
            fromPartyNodeId: 'tg-party-ramaiah',
            fromPartyLabel: 'Ramaiah S/o Muniyappa',
            toPartyNodeId: 'tg-party-lakshmi',
            toPartyLabel: 'Lakshmamma',
            extentSqm: 1208,
          },
        ],
      },
    ],
  };
}

/** A seeded file with particulars and a screened title chain on it. */
function screenedProject(): DdProject {
  const project = seedDemoProject();
  project.parcelId = 'Sy. No. 118/2';
  project.tenure = 'freehold';
  project.landAreaSqm = 1208;
  project.karnataka = {
    jurisdiction: 'BBMP',
    khataType: 'a_khata',
    eKhataIssued: true,
    landConversionStatus: 'converted',
    areaBasis: 'super_built_up',
    kreraNumber: 'PRM/KA/RERA/1251/446/PR/2026/001',
  };
  project.plot = { facing: 'east', layoutApproval: 'bda_approved', cornerSite: true };
  project.stakeholders = [
    { id: 'stk-1', name: 'Sundaram & Co', role: 'Title counsel', organisation: 'Sundaram & Co LLP' },
    { id: 'stk-2', name: 'HDFC', role: 'Lender' },
  ];
  project.lastScreenResult = { titleGraph: titleSummary() } as DdProject['lastScreenResult'];
  return project;
}

/**
 * The screened file with every other register in use as well, so that each
 * relation the builder draws is drawn on it at least once: a site visit that
 * names an asset and raised a finding, a photograph taken on it, a sheet, a
 * risk no finding raised, a milestone a site entry moved, an answered
 * questionnaire, a certified report, an engagement and the report it
 * delivers, a person holding every role, links drawn by hand (one of each
 * relation a person may draw between these kinds), and talk that cites a
 * record and commits a draft.
 */
function filledProject(): DdProject {
  const project = screenedProject();
  const tower = project.assets[0]!;

  const visit = addSiteVisit(project, { title: 'Condition walk', purpose: 'diligence_inspection', visitedOn: '2026-08-12', surveyor: 'R. Iyer', assetIds: [tower.id] });
  const photo = addEvidence(project, { title: 'Site photographs', kind: 'photograph' });
  attachEvidenceFile(project, photo.id, { fileName: 'podium.jpg', mimeType: 'image/jpeg', sizeBytes: 1024, storageKey: 'k', capture: { visitId: visit.id } });
  const finding = addFinding(project, { title: 'Crack in the podium slab', description: 'Seen on the walk.', severity: 'high', discipline: 'technical', evidenceIds: [photo.id] });
  visit.findingIds.push(finding.id);
  const plan = addEvidence(project, { title: 'RMP 2015 sheet 12', kind: 'gis' });
  addSheet(project, { title: 'RMP 2015 sheet 12', kind: 'master_plan', evidenceId: plan.id });
  addRisk(project, { title: 'Access road is disputed', category: 'legal', cause: 'A neighbour claims the track.', impactType: 'time', probability: 'possible', impactScore: 3, materiality: 'medium' });

  const [milestone] = addMilestones(project, [{ name: 'Frame', weight: 1 }], 'tester');
  logSiteEntry(project, { clientId: 'phone-1', date: '2026-10-01', workDone: 'Raft poured', milestoneUpdates: [{ milestoneId: milestone!.id, percent: 50 }] }, 'site');
  const sheet = addQuestionnaire(project, { title: 'Building sheet', parsed: { header: [], questions: [{ text: 'How many chillers?' }] } }, 'engineer');
  answerQuestion(project, sheet.id, sheet.questions[0]!.id, { answer: 'Three', source: 'site', proof: [{ evidenceId: photo.id }] }, 'engineer');
  const opinion = addEvidence(project, { title: 'Legal opinion', kind: 'certificate', status: 'received' });
  fileCertifiedReport(project, { workstream: 'legal.title', title: 'Legal opinion', evidenceId: opinion.id, signer: { name: 'S. Example', profession: 'Advocate' }, verdict: 'clear' }, 'tester');
  const engagement = createEngagement(project, { kind: 'technical_dd' }, 'tester');
  engagement.reportIds.push(project.reports[0]!.id);
  setTeamMember(project, { email: 'all@firm.in', name: 'Every role', departments: { legal: 'lead', finance: 'contributor', construction: 'viewer', commercial: 'signer' }, signer: { profession: 'Registered Valuer' } }, 'tester');
  addLink(project, { from: { kind: 'finding', id: finding.id }, to: { kind: 'milestone', id: milestone!.id }, type: 'relates' }, 'tester');
  addLink(project, { from: { kind: 'workstream', id: 'legal.title' }, to: { kind: 'workstream', id: 'commercial.market' }, type: 'feeds' }, 'tester');
  addLink(project, { from: { kind: 'approval', id: 'environment' }, to: { kind: 'workstream', id: 'construction.safety' }, type: 'gates' }, 'tester');
  addLink(project, { from: { kind: 'document', id: plan.id }, to: { kind: 'finding', id: finding.id }, type: 'cites' }, 'tester');
  addLink(project, { from: { kind: 'engagement', id: engagement.id }, to: { kind: 'workstream', id: 'procurement.vendors' }, type: 'draws_on' }, 'tester');

  applyProjectChat(project, 'Give me a briefing');
  project.conversation.at(-1)!.citedNodeIds = [finding.id];
  commitAiDraft(project, proposeAiDrafts(project).find((d) => d.kind === 'action')!.id);
  return project;
}

describe('the property is in the graph', () => {
  it('has a parcel, and the file and its buildings stand on it', () => {
    const graph = buildProjectGraph(screenedProject());
    const parcel = graph.nodes.find((n) => n.kind === 'parcel' && n.label === 'Sy. No. 118/2');
    assert.ok(parcel, 'the land the file is about is a node');
    assert.match(parcel.detail ?? '', /1,208 sqm/);
    assert.match(parcel.detail ?? '', /freehold/);
    assert.ok(
      graph.edges.some((e) => e.rel === 'sited_at' && e.to === parcel.id),
      'and something stands on it',
    );
  });

  it('carries the chain of title the screen worked out and then used to drop', () => {
    const graph = buildProjectGraph(screenedProject());
    const instruments = graph.nodes.filter((n) => n.kind === 'instrument');
    assert.equal(instruments.length, 2, 'both conveyances');
    assert.ok(instruments.some((n) => n.label === 'Gift deed, 1998'));

    const parties = graph.nodes.filter((n) => n.kind === 'party').map((n) => n.label);
    assert.ok(parties.includes('Ramaiah S/o Muniyappa'), 'the vendor is a node, not a string on a card');
    assert.ok(parties.includes('Lakshmamma'));

    // The chain itself: the 1998 gift takes title from the 1994 grant.
    const gift = instruments.find((n) => n.label === 'Gift deed, 1998');
    const grant = instruments.find((n) => n.label === 'Grant, 1994');
    assert.ok(
      graph.edges.some((e) => e.rel === 'derives_from' && e.from === gift?.id && e.to === grant?.id),
      'the chain is traversable, not just listed',
    );
    assert.ok(graph.edges.some((e) => e.rel === 'conveyed_by' && e.from === gift?.id));
    assert.ok(graph.edges.some((e) => e.rel === 'conveyed_to' && e.from === gift?.id));
  });

  it('keeps the deed parcel and the declared parcel as two nodes, joined', () => {
    // Merging them would erase the ability to say the deed and the khata
    // describe the site differently, which is the finding this product exists
    // to surface.
    const graph = buildProjectGraph(screenedProject());
    const parcels = graph.nodes.filter((n) => n.kind === 'parcel');
    assert.equal(parcels.length, 2);
    assert.ok(graph.edges.some((e) => e.rel === 'derives_from' && parcels.some((p) => p.id === e.from)));
  });

  it('projects the stakeholder register, which reached the graph nowhere before', () => {
    const graph = buildProjectGraph(screenedProject());
    const counsel = graph.nodes.find((n) => n.label === 'Sundaram & Co');
    assert.ok(counsel, 'a person engaged on the file is a node');
    assert.equal(counsel.kind, 'party');
    assert.ok(graph.edges.some((e) => e.rel === 'engaged_on' && e.to === counsel.id));
  });

  it('turns the particulars into approvals and the authority that issued them', () => {
    const graph = buildProjectGraph(screenedProject());
    const approvals = graph.nodes.filter((n) => n.kind === 'approval').map((n) => n.label);
    assert.ok(approvals.some((l) => /khata/i.test(l)));
    assert.ok(approvals.some((l) => /DC conversion/i.test(l)));
    assert.ok(approvals.some((l) => /K-RERA/i.test(l)));
    assert.ok(approvals.some((l) => /layout/i.test(l)));

    const bbmp = graph.nodes.find((n) => n.kind === 'authority' && n.label === 'BBMP');
    assert.ok(bbmp, 'the jurisdiction is a body you can traverse to, not a tag');
    assert.ok(graph.edges.some((e) => e.rel === 'governed_by' && e.to === bbmp.id));
    assert.ok(graph.edges.some((e) => e.rel === 'issued_by' && e.to === bbmp.id));
  });

  it('carries a title contradiction as its own node', () => {
    const graph = buildProjectGraph(screenedProject());
    const conflict = graph.nodes.find((n) => n.kind === 'contradiction');
    assert.ok(conflict);
    assert.equal(conflict.label, 'Extent of Sy. No. 118/2');
    assert.equal(conflict.layer, 'claim');
    assert.ok(graph.edges.some((e) => e.rel === 'contradicts' && e.from === conflict.id));
  });

  it('gives an unscreened file a parcel anyway, from its own particulars', () => {
    // A file that has never been screened still knows what land it is about.
    const project = screenedProject();
    delete project.lastScreenResult;
    const graph = buildProjectGraph(project);
    assert.equal(graph.nodes.filter((n) => n.kind === 'parcel').length, 1);
    assert.equal(graph.nodes.filter((n) => n.kind === 'instrument').length, 0);
  });
});

describe('the frame is the one the menu shows', () => {
  it('has exactly four stages, chained in order, with the project at its current one', () => {
    // Mobilisation is a step of Under construction. The step is said on the
    // stage and is not a node, so the graph has four stages whatever the
    // twelve steps are doing.
    const project = bareProject('pre_construction');
    const graph = buildProjectGraph(project);
    const stageId = (key: string) => `${project.id}::stage::${key}`;
    const stages = graph.nodes.filter((n) => n.kind === 'stage');
    assert.deepEqual(stages.map((n) => n.id), STAGES.map((s) => stageId(s.key)));
    assert.deepEqual(stages.map((n) => n.label), ['Land', 'Pre-construction', 'Under construction', 'Completed']);
    assert.deepEqual(stages.map((n) => n.key), STAGES.map((s) => s.key));
    assert.deepEqual(stages.map((n) => n.status), ['done', 'done', 'current', 'ahead']);
    assert.deepEqual(
      stages.map((n) => n.detail),
      [
        'Steps: Opportunity, Feasibility, Acquisition',
        'Steps: Design, Approvals, Tender & procurement',
        'At the Mobilisation step · Steps: Mobilisation, Construction, Testing & commissioning, Completion',
        'Steps: Handover, Operations',
      ],
      'each lists its steps, and the one the project is in says first which it is at',
    );

    assert.deepEqual(
      graph.edges.filter((e) => e.rel === 'precedes').map((e) => [e.from, e.to]),
      [
        [stageId('pre_development'), stageId('design_tender')],
        [stageId('design_tender'), stageId('construction')],
        [stageId('construction'), stageId('operations')],
      ],
    );
    assert.deepEqual(
      graph.edges.filter((e) => e.rel === 'at_stage').map((e) => [e.from, e.to]),
      [[project.id, stageId('construction')]],
    );
  });

  it('places a record in the stage it arrived in, not the one the project is at now', () => {
    const project = bareProject('feasibility');
    project.stageHistory[0]!.effectiveAt = '2026-01-01T09:00:00.000Z';
    const moved = changeStage(project, { subject: 'project', stage: 'pre_construction', reason: 'Contractor appointed' }, 'tester');
    moved.effectiveAt = '2026-03-01T09:00:00.000Z';
    const early = addFinding(project, { title: 'Access is by a cart track', description: 'No motorable road.', severity: 'medium', discipline: 'technical' });
    early.createdAt = '2026-02-01T09:00:00.000Z';
    const late = addFinding(project, { title: 'Hoarding is incomplete', description: 'North side open.', severity: 'low', discipline: 'technical' });
    late.createdAt = '2026-04-01T09:00:00.000Z';

    const graph = buildProjectGraph(project);
    const arrivedIn = (id: string) => graph.edges.filter((e) => e.rel === 'in_stage' && e.from === id).map((e) => e.to);
    assert.deepEqual(arrivedIn(early.id), [`${project.id}::stage::pre_development`], 'filed while the project was at Feasibility, a step of Land');
    assert.deepEqual(arrivedIn(late.id), [`${project.id}::stage::construction`], 'filed at Mobilisation, a step of Under construction');
    assert.equal(graph.nodes.filter((n) => n.kind === 'stage').length, 4, 'and neither step became a node');
  });

  it('draws the menu’s five departments by one word, and none for Design', () => {
    const project = bareProject();
    const graph = buildProjectGraph(project);
    const departments = graph.nodes.filter((n) => n.kind === 'department');
    assert.deepEqual(departments.map((n) => n.id), MENU_DEPARTMENTS.map((key) => `${project.id}::dept::${key}`));
    assert.deepEqual(departments.map((n) => n.label), ['Legal', 'Finance', 'Engineering', 'Commercial', 'Procurement']);
    assert.deepEqual(
      departments.map((n) => (n.detail ?? '').split(' · ')[0]),
      ['Legal & Compliance', 'Finance & Investment', 'Engineering & Construction', 'Commercial & Operations', 'Procurement & Supply Chain'],
      'the name in full leads the detail',
    );
    assert.ok(departments.every((n) => (n.detail ?? '').split(' · ').length === 2), 'and the purpose is kept after it');
    assert.deepEqual(departments.map((n) => n.status), ['live', 'live', 'live', 'coming_soon', 'coming_soon']);
    assert.ok(!graph.nodes.some((n) => n.id === `${project.id}::dept::design`), 'Design is not a department here');
    assert.equal(graph.edges.filter((e) => e.rel === 'has_department' && e.from === project.id).length, 5);
  });

  it('keeps Engineering while only Design is switched on', () => {
    const project = bareProject();
    setProjectDepartments(project, ['design'], 'tester');
    const graph = buildProjectGraph(project);
    assert.deepEqual(validateProjectGraph(graph), []);
    const engineering = graph.nodes.filter((n) => n.kind === 'department');
    assert.deepEqual(engineering.map((n) => [n.id, n.label]), [[`${project.id}::dept::construction`, 'Engineering']]);
    assert.deepEqual(
      graph.nodes.filter((n) => n.kind === 'workstream').map((n) => n.id),
      [`${project.id}::ws::design`],
      'and under it Design alone: Engineering’s own functions are switched off',
    );
    // It stands for Design alone here, so it is described as Design is and is
    // no more built than Design: not `live`, and not "the technical work".
    assert.equal(engineering[0]!.status, 'coming_soon');
    assert.match(engineering[0]!.detail ?? '', /^Design & Architecture · What will be built/);
  });

  it('draws Design as one function of Engineering, holding a check from a design workstream', () => {
    const project = bareProject();
    ensureWorkstreamChecks(project, ['design.drawings'], 'tester');
    const check = workstreamChecks(project, 'design.drawings')[0]!;
    const graph = buildProjectGraph(project);
    const designId = `${project.id}::ws::design`;
    const design = graph.nodes.filter((n) => n.kind === 'workstream' && (n.key ?? '').startsWith('design'));
    assert.deepEqual(design.map((n) => [n.id, n.label, n.key]), [[designId, 'Design', 'design']], 'four workstreams, one node');
    assert.match(design[0]!.detail ?? '', /^Design & Architecture · Drawings & versions, Design compliance, RFIs, Coordination · /, 'the name in full leads the detail, then the four it stands for');
    assert.deepEqual(
      graph.edges.filter((e) => e.rel === 'has_workstream' && e.to === designId).map((e) => e.from),
      [`${project.id}::dept::construction`],
    );
    assert.ok(graph.edges.some((e) => e.rel === 'holds' && e.from === designId && e.to === check.id), 'a drawings check is held by Design');
  });

  it('keeps the id of every other function, and its name in full where the one word differs', () => {
    const project = bareProject();
    const graph = buildProjectGraph(project);
    const own = WORKSTREAMS.filter((w) => w.department !== 'design');
    assert.equal(own.length, 23);
    for (const w of own) {
      const node = graph.nodes.find((n) => n.id === `${project.id}::ws::${w.key}`);
      assert.ok(node, `${w.key} lost its node`);
      assert.equal(node.kind, 'workstream');
      assert.equal(node.key, w.key);
      assert.equal(node.label, FUNCTION_SHORT[w.key], `${w.key} is not named by its one word`);
      if (w.label !== node.label) assert.ok((node.detail ?? '').startsWith(`${w.label} · `), `${w.label} is no longer findable`);
    }
    assert.equal(graph.nodes.filter((n) => n.kind === 'workstream').length, 24, '23 of their own, and Design');
  });

  it('joins what pointed at a design workstream to Design once, and drops a link between two of them', () => {
    const project = bareProject();
    const ws = (id: string) => ({ kind: 'workstream' as const, id });
    addLink(project, { from: ws('design.drawings'), to: ws('design.rfis'), type: 'feeds' }, 'tester');
    addLink(project, { from: ws('design.drawings'), to: ws('construction.progress'), type: 'feeds' }, 'tester');
    addLink(project, { from: ws('design.coordination'), to: ws('construction.progress'), type: 'feeds' }, 'tester');
    const graph = buildProjectGraph(project);
    assert.deepEqual(validateProjectGraph(graph), []);
    const ids = graph.edges.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, 'no edge is drawn twice');
    assert.ok(!graph.edges.some((e) => e.from === e.to), 'and none runs from a node to itself');
    const designId = `${project.id}::ws::design`;
    assert.deepEqual(
      graph.edges.filter((e) => e.rel === 'feeds' && e.from === designId).map((e) => e.to),
      [`${project.id}::ws::construction.progress`],
      'two links into Progress are one, and the link inside Design is gone',
    );
  });
});

describe('the names people still use find something', () => {
  // The frame draws less than the record keeps: four stages for twelve steps,
  // five departments by one word, one Design for four workstreams. People go
  // on saying the names that are no longer drawn, so each is carried in the
  // detail of the node that stands for it, which is what a search reads.
  const found = (query: string) => findProjectNodes(buildProjectGraph(bareProject('pre_construction')), query).map((n) => `${n.kind}: ${n.label}`);

  it('finds a step on the stage it belongs to, whether or not the project is at it', () => {
    for (const [step, stage] of [
      ['Opportunity', 'Land'],
      ['Acquisition', 'Land'],
      ['Tender & procurement', 'Pre-construction'],
      ['Mobilisation', 'Under construction'],
      ['Testing & commissioning', 'Under construction'],
      ['Completion', 'Under construction'],
      ['Operations', 'Completed'],
    ] as const) {
      assert.ok(found(step).includes(`stage: ${stage}`), `"${step}" does not find ${stage}`);
    }
    // Every step of every stage, so one added to the record is findable too.
    for (const stage of STAGES) {
      for (const step of stage.subStages) assert.ok(found(SUB_STAGE_LABEL[step]).includes(`stage: ${stage.label}`), `"${SUB_STAGE_LABEL[step]}" does not find ${stage.label}`);
    }
  });

  it('finds each of Design’s four workstreams on Design', () => {
    for (const name of ['Drawings & versions', 'Design compliance', 'RFIs', 'Coordination']) {
      assert.deepEqual(found(name), ['workstream: Design'], `"${name}"`);
    }
  });

  it('finds a department by its name in full, and Engineering by "Construction"', () => {
    for (const [name, word] of [
      ['Legal & Compliance', 'Legal'],
      ['Finance & Investment', 'Finance'],
      ['Engineering & Construction', 'Engineering'],
      ['Commercial & Operations', 'Commercial'],
      ['Procurement & Supply Chain', 'Procurement'],
    ] as const) {
      assert.deepEqual(found(name), [`department: ${word}`], `"${name}"`);
    }
    assert.ok(found('Construction').includes('department: Engineering'));
    // With only Design on, Engineering stands for Design and answers to its name.
    const designOnly = bareProject();
    setProjectDepartments(designOnly, ['design'], 'tester');
    assert.deepEqual(
      findProjectNodes(buildProjectGraph(designOnly), 'Design & Architecture').map((n) => `${n.kind}: ${n.label}`),
      ['department: Engineering', 'workstream: Design'],
    );
  });

  it('finds the functions by the word the menu uses, one or many', () => {
    // The kind keeps the record's word; a search answers to the reader's too.
    for (const word of ['function', 'functions', 'Functions', 'workstream']) {
      const hits = findProjectNodes(buildProjectGraph(bareProject()), word);
      assert.equal(hits.length, 24, `"${word}"`);
      assert.ok(hits.every((n) => n.kind === 'workstream'));
    }
  });
});

describe('nothing floats', () => {
  it('reaches every node from the project, on the seeded file and on one with loose records', () => {
    for (const project of [seedDemoProject(), seedBdaReferenceProject(), looseProject().project]) {
      const graph = buildProjectGraph(project);
      assert.equal(graph.nodes[0]!.id, project.id);
      assert.deepEqual(unreached(graph, project.id), [], `${project.name} has records no walk arrives at`);
    }
  });

  it('keeps to the ontology while it does, and builds the same graph twice', () => {
    for (const project of [seedDemoProject(), looseProject().project]) {
      const graph = buildProjectGraph(project);
      assert.deepEqual(validateProjectGraph(graph), []);
      assert.equal(JSON.stringify(buildProjectGraph(project)), JSON.stringify(graph), `${project.name} is not byte-identical on a rebuild`);
    }
  });

  it('ties a record nothing places to the project, and leaves alone one that is placed', () => {
    const { project, action, finding, decision, document } = looseProject();
    const graph = buildProjectGraph(project);
    // Nothing names the action or the document, so the project has them on file.
    assert.deepEqual(touching(graph, action.id), [['has_record', project.id]]);
    assert.deepEqual(touching(graph, document.id), [['has_record', project.id]]);
    // The finding and the decision carry a date, which places them in a stage.
    // That is an edge, so they get no second one.
    assert.deepEqual(touching(graph, finding.id), [['in_stage', `${project.id}::stage::construction`]]);
    assert.deepEqual(touching(graph, decision.id), [['in_stage', `${project.id}::stage::construction`]]);
  });

  it('ties a finding and a decision too, once they have no date to place them by', () => {
    const { project, action, finding, decision, document } = looseProject();
    finding.createdAt = '';
    decision.createdAt = '';
    const graph = buildProjectGraph(project);
    assert.deepEqual(validateProjectGraph(graph), []);
    assert.deepEqual(unreached(graph, project.id), []);
    assert.deepEqual(
      graph.edges.filter((e) => e.rel === 'has_record').map((e) => e.to).sort(),
      [action.id, finding.id, decision.id, document.id].sort(),
    );
  });

  it('gives records joined only to each other one tie between them', () => {
    // An action resting on a document that nothing else cites: neither reaches
    // the project. One edge does it, on the document, which was written first.
    const project = bareProject();
    const document = addEvidence(project, { title: 'Contractor’s quote', kind: 'document' });
    const action = addAction(project, { title: 'Repoint the parapet', kind: 'remediation', owner: 'QS', priority: 'high', evidenceIds: [document.id] });
    const graph = buildProjectGraph(project);
    assert.deepEqual(unreached(graph, project.id), []);
    assert.deepEqual(touching(graph, action.id), [['supported_by', document.id]]);
    assert.deepEqual(graph.edges.filter((e) => e.rel === 'has_record').map((e) => e.to), [document.id]);
  });

  it('never draws the tie as a second way to a record', () => {
    // Take any one away and nothing else places its record: a record
    // something already places is never given one.
    for (const project of [seedDemoProject(), looseProject().project, filledProject()]) {
      const graph = buildProjectGraph(project);
      for (const tie of graph.edges.filter((e) => e.rel === 'has_record')) {
        assert.equal(tie.from, project.id);
        assert.ok(unreached(graph, project.id, { without: tie.id, placedOnly: true }).includes(tie.to), `${tie.to} was placed without it`);
      }
    }
  });

  it('keeps the tie on a record the chat cites, because talk places nothing', () => {
    // Only the latest turns are drawn. If a citation counted as placing the
    // action, its tie would go the day somebody asked about it and come back
    // when that turn left the window, and the store would close and reopen
    // the edge each time.
    const { project, action } = looseProject();
    const quiet = buildProjectGraph(project);
    applyProjectChat(project, 'Give me a briefing');
    project.conversation.at(-1)!.citedNodeIds = [action.id];
    const cited = buildProjectGraph(project);
    assert.ok(cited.edges.some((e) => e.rel === 'cites' && e.to === action.id), 'the turn does cite it');
    const tie = (graph: Graph) => graph.edges.filter((e) => e.rel === 'has_record' && e.to === action.id).map((e) => e.id);
    assert.deepEqual(tie(quiet), [`${project.id}:has_record:${action.id}`]);
    assert.deepEqual(tie(cited), tie(quiet), 'the same edge, cited or not');
    assert.deepEqual(validateProjectGraph(cited), []);
    assert.deepEqual(unreached(cited, project.id), []);

    // A draft that became a record is talk too: it says where the record
    // came from, not where it sits.
    const drafted = bareProject();
    const made = addAction(drafted, { title: 'Chase the commencement certificate', kind: 'evidence_request', owner: 'Liaison', priority: 'medium' });
    drafted.chatProposals.push({
      id: 'prp_test',
      kind: 'add_action',
      title: 'Chase the certificate',
      rationale: 'It is not on file.',
      impact: 'Adds one action.',
      status: 'committed',
      payload: {},
      createdAt: drafted.createdAt,
      createdBy: 'tester',
      committedRecordId: made.id,
    });
    const graph = buildProjectGraph(drafted);
    assert.ok(graph.edges.some((e) => e.rel === 'became' && e.to === made.id));
    assert.ok(graph.edges.some((e) => e.rel === 'has_record' && e.to === made.id));
  });

  it('reaches what belongs to a department that is switched off', () => {
    // With only Finance on there is no Approvals function to hold the
    // approvals register, no Progress to hold a milestone, and no Legal for
    // its lead to lead. All three are still on the file.
    const project = bareProject();
    setProjectDepartments(project, ['finance'], 'tester');
    addMilestones(project, [{ name: 'Frame', weight: 1 }], 'tester');
    setTeamMember(project, { email: 'counsel@firm.in', name: 'Counsel', departments: { legal: 'lead' } }, 'tester');
    const graph = buildProjectGraph(project);
    assert.deepEqual(validateProjectGraph(graph), []);
    assert.deepEqual(unreached(graph, project.id), []);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const tied = new Set(graph.edges.filter((e) => e.rel === 'has_record').map((e) => byId.get(e.to)!.kind));
    assert.deepEqual([...tied].sort(), ['approval', 'member', 'milestone']);
  });

  it('ties a parcel only a title chain names as a record, not as land the project stands on', () => {
    // A screen read two chains of title on a file that declares no land of
    // its own. `addTitleChain` joins a chain's parcel to the declared one and
    // makes no other claim about it, so here the chains reach nothing. The
    // tie must not make the claim for it: `sited_at` would say the project
    // stands on both parcels.
    const summary = titleSummary();
    const first = summary.chains[0]!;
    const second = {
      ...first,
      parcelNodeId: 'tg-parcel-119-1',
      parcelLabel: 'Sy. No. 119/1, Harohalli',
      breaks: [],
      links: [
        {
          id: 'lnk-3',
          instrumentNodeId: 'tg-inst-sale-2004',
          label: 'Sale deed, 2004',
          at: '2004-03-09T00:00:00.000Z',
          fromPartyNodeId: 'tg-party-gowda',
          fromPartyLabel: 'Gowda S/o Thimmaiah',
          toPartyNodeId: 'tg-party-reddy',
          toPartyLabel: 'Reddy',
          extentSqm: 800,
        },
      ],
    };
    const screened = (title: TitleGraphSummary) => {
      const project = bareProject();
      project.lastScreenResult = { titleGraph: title } as DdProject['lastScreenResult'];
      return project;
    };

    const apart = screened({ ...summary, contradictions: [], chains: [first, second] });
    const graph = buildProjectGraph(apart);
    assert.deepEqual(validateProjectGraph(graph), []);
    assert.deepEqual(unreached(graph, apart.id), []);
    const parcels = graph.nodes.filter((n) => n.kind === 'parcel');
    assert.deepEqual(parcels.map((n) => n.label), ['Sy. No. 118/2, Harohalli', 'Sy. No. 119/1, Harohalli']);
    assert.deepEqual(
      graph.edges.filter((e) => e.from === apart.id && parcels.some((p) => p.id === e.to)).map((e) => [e.rel, e.to]),
      parcels.map((p) => ['has_record', p.id]),
      'each chain is on file, by its parcel',
    );
    assert.ok(!graph.edges.some((e) => e.rel === 'sited_at'), 'nothing says the project stands on either');
    assert.ok(!graph.edges.some((e) => e.rel === 'engaged_on'), 'or that it engaged a party to an old deed');

    // A contradiction about both joins the two chains, and one tie does.
    const joined = buildProjectGraph(screened({ ...summary, chains: [first, second] }));
    assert.deepEqual(validateProjectGraph(joined), []);
    assert.deepEqual(joined.edges.filter((e) => e.rel === 'has_record').map((e) => joined.nodes.find((n) => n.id === e.to)!.label), ['Sy. No. 118/2, Harohalli']);
    assert.ok(!joined.edges.some((e) => e.rel === 'sited_at'));
  });
});

describe('a link drawn by hand', () => {
  const ws = (id: string) => ({ kind: 'workstream' as const, id });

  it('is refused when the graph could not draw it, and told the way that can', () => {
    // Only `relates` joins any two things. Every other relation says
    // something particular, and the ontology says of what: a check cannot
    // gate a function. Taken as it came, such a link would sit on the file
    // and fail the validator at every build.
    const project = seedDemoProject();
    const check = { kind: 'check' as const, id: project.assessments[0]!.scopes[0]!.checks[0]!.id };
    const document = { kind: 'document' as const, id: project.evidence[0]!.id };
    for (const type of ['gates', 'feeds', 'certifies', 'draws_on'] as const) {
      assert.throws(() => addLink(project, { from: check, to: ws('legal.title'), type }, 'tester'), /cannot join a check to a function\. To say two things belong together, link them with “relates”\./, type);
    }
    assert.throws(() => addLink(project, { from: document, to: ws('legal.title'), type: 'cites' }, 'tester'), /“cites” cannot join a document to a function.*“relates”/);
    assert.throws(() => addLink(project, { from: { kind: 'approval', id: 'fire' }, to: { kind: 'engagement', id: 'eng_1' }, type: 'feeds' }, 'tester'), /an approval to an engagement/);
    assert.deepEqual(project.links ?? [], [], 'none of them is on the file');

    addLink(project, { from: check, to: ws('legal.title'), type: 'relates' }, 'tester');
    const graph = buildProjectGraph(project);
    assert.deepEqual(validateProjectGraph(graph), []);
    assert.ok(graph.edges.some((e) => e.rel === 'relates' && e.from === check.id && e.to === `${project.id}::ws::legal.title`));
  });

  it('is drawn when the ontology allows it, by each relation a person may use', () => {
    const project = filledProject();
    const drawn = (project.links ?? []).map((l) => l.type).sort();
    assert.deepEqual(drawn, ['cites', 'draws_on', 'feeds', 'gates', 'relates']);
    const graph = buildProjectGraph(project);
    assert.deepEqual(validateProjectGraph(graph), []);
    const has = (rel: string, from: string, to: string) => graph.edges.some((e) => e.rel === rel && e.from.endsWith(from) && e.to.endsWith(to));
    assert.ok(has('feeds', '::ws::legal.title', '::ws::commercial.market'));
    assert.ok(has('gates', '::approval::environment', '::ws::construction.safety'));
    assert.ok(has('draws_on', project.engagements!.at(-1)!.id, '::ws::procurement.vendors'));
    // "This document cites that finding" is drawn as the finding resting on the document.
    const cites = project.links!.find((l) => l.type === 'cites')!;
    assert.ok(has('supported_by', cites.to.id, cites.from.id));
  });

  it('never refuses one of the system’s own', () => {
    // The system draws gates, feeds, cites, certifies and draws_on itself.
    // Each of its links, drawn by hand, is one the refusal lets through.
    const project = filledProject();
    const own = systemLinks(project);
    assert.deepEqual([...new Set(own.map((l) => l.type))].sort(), ['certifies', 'cites', 'draws_on', 'feeds', 'gates', 'relates']);
    const scratch = bareProject();
    for (const link of own) {
      assert.doesNotThrow(() => addLink(scratch, { from: link.from, to: link.to, type: link.type }, 'tester'), `${link.id} would be refused`);
    }
  });
});

describe('the vocabulary is closed', () => {
  it('emits nothing outside the ontology, on either seed', () => {
    for (const seed of [seedDemoProject, seedBdaReferenceProject, screenedProject]) {
      const graph = buildProjectGraph(seed());
      for (const node of graph.nodes) {
        assert.ok(isProjectNodeKind(node.kind), `unknown node kind "${node.kind}"`);
        assert.equal(node.layer, projectLayerFor(node.kind), `${node.id} carries the wrong layer`);
        assert.equal(node.origin, 'derived', 'the projection produces nothing authored');
      }
      for (const edge of graph.edges) {
        assert.ok(isProjectEdgeKind(edge.rel), `unknown relation "${edge.rel}"`);
      }
    }
  });

  it('passes its own validator — endpoints, layers and all', () => {
    for (const seed of [seedDemoProject, seedBdaReferenceProject, screenedProject]) {
      const problems = validateProjectGraph(buildProjectGraph(seed()));
      assert.deepEqual(problems, [], problems.map((p) => p.reason).join('\n'));
    }
  });

  it('lets a site visit be about particular assets, as an assessment is', () => {
    // The builder always drew this edge and the ontology allowed `targets`
    // only from an assessment, so any file whose visit named an asset failed
    // its own validator. No test had a visit that named one.
    const project = bareProject();
    const tower = addAsset(project, { name: 'Tower A', assetType: 'Residential tower' }, 'tester');
    const visit = addSiteVisit(project, { title: 'Condition walk', purpose: 'diligence_inspection', visitedOn: '2026-08-12', surveyor: 'R. Iyer', assetIds: [tower.id] });
    const graph = buildProjectGraph(project);
    assert.deepEqual(validateProjectGraph(graph), []);
    assert.ok(graph.edges.some((e) => e.rel === 'targets' && e.from === visit.id && e.to === tower.id), 'the visit is joined to the tower it walked');
    assert.equal(projectEdgeEndpointsValid('targets', 'site_visit', 'asset'), true);
    assert.equal(projectEdgeEndpointsValid('targets', 'assessment', 'asset'), true);
    assert.equal(projectEdgeEndpointsValid('targets', 'site_visit', 'parcel'), false, 'and to nothing but an asset');
    // Said so that it is true of a visit that was planned or had to be
    // abandoned as well: such a visit was about the tower and covered nothing.
    assert.deepEqual(PROJECT_EDGE_LABEL.targets, { forward: 'is about', backward: 'is the subject of' });
  });

  it('draws no relation its own rules forbid, with every register in use', () => {
    // That fault hid because no test built a file with a visit that named an
    // asset: the validator only speaks about the edges it is shown. This file
    // shows it every relation the builder draws. The two it does not draw at
    // all are named, so a relation added to the builder and not to this file
    // fails here until it is.
    const graph = buildProjectGraph(filledProject());
    assert.deepEqual(validateProjectGraph(graph), []);
    const drawn = new Set(graph.edges.map((e) => e.rel));
    assert.deepEqual(PROJECT_EDGE_KINDS.filter((kind) => !drawn.has(kind)), ['encumbers', 'about']);
  });

  it('never leaves an edge pointing at a node it does not hold', () => {
    // The old builder guarded only chat citations, so a check naming a deleted
    // evidence row produced an edge into nothing. `/projects/:id/graph` serves
    // the raw projection, so that edge reached a renderer.
    const project = screenedProject();
    project.assessments[0]!.scopes[0]!.checks[0]!.evidenceIds.push('ev-that-was-deleted');
    const graph = buildProjectGraph(project);
    const ids = new Set(graph.nodes.map((n) => n.id));
    const dangling = graph.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
    assert.deepEqual(dangling, []);
  });

  it('refuses an edge whose endpoints the ontology forbids', () => {
    const problems = validateProjectGraph({
      nodes: [
        { id: 'r1', kind: 'report', layer: 'judgement', origin: 'derived', label: 'Red flag' },
        { id: 'p1', kind: 'party', layer: 'entity', origin: 'derived', label: 'Ramaiah' },
      ],
      edges: [{ id: 'bad', from: 'r1', to: 'p1', rel: 'has_check' }],
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0]!.reason, /may not join report to party/);
  });

  it('refuses a judgement resting on deliberation, in that direction only', () => {
    // The one-way rule. A thought may cite a finding; a finding may never be
    // reached by walking out of a thought, or an unreviewed model musing
    // becomes the support under a conclusion that reaches a bank.
    const nodes = [
      { id: 'f1', kind: 'finding' as const, layer: 'judgement' as const, origin: 'derived' as const, label: 'Gap' },
      { id: 't1', kind: 'thought' as const, layer: 'deliberation' as const, origin: 'derived' as const, label: 'Maybe' },
    ];
    const bad = validateProjectGraph({ nodes, edges: [{ id: 'x', from: 'f1', to: 't1', rel: 'cites' }] });
    assert.equal(bad.length, 2, 'wrong endpoints AND wrong direction');
    assert.ok(bad.some((p) => /deliberation is cited, never relied on/.test(p.reason)));

    const good = validateProjectGraph({ nodes, edges: [{ id: 'y', from: 't1', to: 'f1', rel: 'cites' }] });
    assert.deepEqual(good, []);
  });

  it('has no relation that is a second word for another', () => {
    // `uses_evidence`/`supported_by` and `mitigates`/`requires` were exactly
    // that, and each one meant every traversal had to remember both or
    // silently miss half of what it was walking.
    assert.ok(!(PROJECT_EDGE_KINDS as readonly string[]).includes('uses_evidence'));
    assert.ok(!(PROJECT_EDGE_KINDS as readonly string[]).includes('mitigates'));
    assert.equal(new Set(PROJECT_EDGE_KINDS).size, PROJECT_EDGE_KINDS.length);
    assert.equal(new Set(PROJECT_NODE_KINDS).size, PROJECT_NODE_KINDS.length);
  });

  it('names an endpoint rule for every relation it declares', () => {
    // The way a vocabulary rots is a kind added to the union and nowhere else.
    for (const kind of PROJECT_EDGE_KINDS) {
      assert.doesNotThrow(() => projectEdgeEndpointsValid(kind, 'project', 'asset'), `${kind} has no rule`);
    }
    for (const kind of PROJECT_NODE_KINDS) {
      assert.ok(projectLayerFor(kind), `${kind} has no layer`);
    }
  });

  it('says every relation in plain words, from both ends', () => {
    // A key is written for Cypher. What a person reads is a phrase, said of
    // whichever node they are looking at: lower-case words and nothing else.
    for (const kind of PROJECT_EDGE_KINDS) {
      const words = PROJECT_EDGE_LABEL[kind];
      assert.ok(words, `${kind} has no words`);
      for (const phrase of [words.forward, words.backward]) {
        assert.match(phrase, /^[a-z]+( [a-z]+)*$/, `${kind} reads "${phrase}"`);
      }
    }
    assert.deepEqual(Object.keys(PROJECT_EDGE_LABEL).sort(), [...PROJECT_EDGE_KINDS].sort(), 'and no words for a relation that is not one');
    assert.deepEqual(PROJECT_EDGE_LABEL.supported_by, { forward: 'rests on', backward: 'supports' });
    assert.deepEqual(PROJECT_EDGE_LABEL.holds, { forward: 'holds', backward: 'is held by' });
    assert.deepEqual(PROJECT_EDGE_LABEL.in_stage, { forward: 'arrived in', backward: 'took in' });
    assert.deepEqual(PROJECT_EDGE_LABEL.has_workstream, { forward: 'has the function', backward: 'is a function of' });
    // An approval that is missing is still joined to the work it gates, so
    // the words cannot be "allows".
    assert.deepEqual(PROJECT_EDGE_LABEL.gates, { forward: 'is needed before', backward: 'cannot go ahead without' });
    // The same care for each edge drawn to a record that may be superseded,
    // only suggested, archived, lapsed or abandoned: the words claim no more
    // than the edge does. A superseded report no longer "certifies", a
    // suggested answer has not "answered", an archived assessment is not
    // "assessing", a lapsed registration does not "apply", a released charge
    // is not "a charge", and an entry that corrects a milestone downward did
    // not move it "forward".
    assert.deepEqual(PROJECT_EDGE_LABEL.certifies, { forward: 'is a certified report on', backward: 'has the certified report' });
    assert.deepEqual(PROJECT_EDGE_LABEL.answers, { forward: 'is asked on', backward: 'asks' });
    assert.deepEqual(PROJECT_EDGE_LABEL.assessed_by, { forward: 'has the assessment', backward: 'is an assessment of' });
    assert.deepEqual(PROJECT_EDGE_LABEL.affects, { forward: 'deals with', backward: 'is dealt with by' });
    assert.deepEqual(PROJECT_EDGE_LABEL.encumbers, { forward: 'is recorded against', backward: 'has recorded against it' });
    assert.deepEqual(PROJECT_EDGE_LABEL.advances, { forward: 'updated', backward: 'was updated by' });
    for (const [kind, words] of Object.entries(PROJECT_EDGE_LABEL_AWAITED)) {
      assert.ok((PROJECT_EDGE_KINDS as readonly string[]).includes(kind), `${kind} is not a relation`);
      for (const phrase of [words.forward, words.backward]) assert.match(phrase, /^[a-z]+( [a-z]+)*$/, `${kind} reads "${phrase}"`);
    }
  });

  it('says a paper is still needed while it has not come, and rested on once it has', () => {
    // A check is joined to every document it expects and Approvals to every
    // approval the project needs, in hand or not. On this file almost every
    // such edge ends at a paper nobody has filed, and "rests on" or "holds"
    // would be said of each.
    const project = seedDemoProject();
    const graph = buildProjectGraph(project);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const expected = byId.get(project.evidence.find((e) => e.status === 'expected' && e.checkIds.length > 0)!.id)!;
    const filed = byId.get(project.evidence.find((e) => e.status === 'used' && e.checkIds.length > 0)!.id)!;
    assert.equal(expected.status, 'expected', 'a document’s standing travels on its node');
    assert.deepEqual([projectNodeAwaited(expected), projectNodeAwaited(filed)], [true, false]);
    assert.deepEqual([projectEdgePhrase('supported_by', 'forward', expected), projectEdgePhrase('supported_by', 'backward', expected)], ['still needs', 'is still needed by']);
    assert.deepEqual([projectEdgePhrase('supported_by', 'forward', filed), projectEdgePhrase('supported_by', 'backward', filed)], ['rests on', 'supports']);

    const missing = graph.nodes.find((n) => n.kind === 'approval' && n.status === 'missing')!;
    assert.deepEqual([projectEdgePhrase('holds', 'forward', missing), projectEdgePhrase('holds', 'backward', missing)], ['still needs', 'is still needed by']);
    assert.equal(projectEdgePhrase('has_record', 'forward', missing), 'still needs');
    assert.equal(projectEdgePhrase('has_record', 'forward', filed), 'has on file');
    assert.equal(projectEdgePhrase('holds', 'forward', filed), 'holds');
    // Refused is not in hand either; lapsed is on file, and held.
    assert.equal(projectNodeAwaited({ kind: 'evidence', status: 'rejected' }), true);
    assert.equal(projectNodeAwaited({ kind: 'approval', status: 'expired' }), false);
    // A relation with one pair of words says them whatever it reaches.
    assert.equal(projectEdgePhrase('cites', 'forward', expected), 'refers to');

    const claims = new Set(['rests on', 'supports', 'holds', 'is held by', 'has on file', 'is on file with']);
    let awaited = 0;
    for (const edge of graph.edges) {
      const to = byId.get(edge.to)!;
      if (!projectNodeAwaited(to)) continue;
      awaited += 1;
      for (const direction of ['forward', 'backward'] as const) {
        const said = projectEdgePhrase(edge.rel, direction, to);
        assert.ok(!claims.has(said), `${edge.rel} says "${said}" of ${to.label}, which is ${to.status}`);
      }
    }
    assert.ok(awaited > 700, 'and that is most of the edges to a paper on this file');
  });

  it('names the frame for the chat by the ids the graph draws it under', () => {
    // The chat shows a stage, a department or a function by name where an
    // answer quotes its id, and drops an id the frame no longer has. Both
    // depend on this list being the frame exactly.
    const designOnly = bareProject();
    setProjectDepartments(designOnly, ['design'], 'tester');
    for (const project of [bareProject(), designOnly, seedDemoProject()]) {
      const frame = buildProjectGraph(project).nodes.filter((n) => n.kind === 'stage' || n.kind === 'department' || n.kind === 'workstream');
      assert.deepEqual(projectFrameLabels(project).map((x) => x.id), frame.map((n) => n.id));
    }
    const project = bareProject();
    const names = new Map(projectFrameLabels(project).map((x) => [x.id, x.label]));
    assert.equal(names.get(`${project.id}::stage::construction`), 'Under construction');
    assert.equal(names.get(`${project.id}::dept::construction`), 'Engineering');
    assert.equal(names.get(`${project.id}::ws::legal.handover`), 'Legal › Handover');
    assert.equal(names.get(`${project.id}::ws::commercial.handover`), 'Commercial › Handover');
    assert.equal(names.get(`${project.id}::ws::design`), 'Engineering › Design');
    for (const gone of ['::stage::acquisition', '::stage::pre_construction', '::dept::design', '::ws::design.drawings']) {
      assert.equal(names.has(`${project.id}${gone}`), false, `${gone} is not drawn any more`);
    }
  });
});
