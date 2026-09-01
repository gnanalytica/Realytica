/**
 * Projecting one project file into a graph.
 *
 * This used to live at the bottom of `capabilities.ts` and it used to be a
 * workflow graph: project -> assessment -> scope -> check -> finding -> risk
 * -> action, plus the evidence each rested on. Everything in it was true and
 * none of it was the property. A diligence file's graph had no parcel in it,
 * no owner, no deed — you could traverse the whole thing and never reach the
 * land being bought.
 *
 * That was not a modelling oversight so much as an accident of where the data
 * sat. The title entities WERE being computed: `runScreen` builds a full title
 * graph on every screen and keeps its summary on `lastScreenResult.titleGraph`.
 * They were computed and then dropped, while the shallower half was the half
 * that reached Neo4j. So the fix is a fold rather than a new source: the same
 * chains, parties and instruments the screen already worked out become nodes
 * here, alongside the parcel the file's own particulars describe.
 *
 * Four rules the builder holds to:
 *
 * - **Everything is derived.** A rebuild reproduces this graph exactly from
 *   the registers, so a store holding it is an index. Authored nodes — an
 *   analyst's annotation — arrive through the adapter's `appendProject` and
 *   are never produced here.
 *
 * - **No edge outlives its endpoints.** Edges are buffered and filtered
 *   against the node set at the end, so a check naming an evidence row that
 *   has since been deleted produces no edge rather than an edge into nothing.
 *   The old builder guarded only chat citations, which is the one place a
 *   dangling reference was likely enough to have been noticed.
 *
 * - **Title ids are namespaced by project.** `buildTitleGraph` mints ids from
 *   a content digest of the parcel or party, so two files screening the same
 *   survey number mint the same id — correct in a case graph keyed by case,
 *   fatal in a store with one global uniqueness constraint on node id, where
 *   the second file's sync would silently take ownership of the first file's
 *   node. Prefixing with the project id keeps files isolated, which is the
 *   same boundary `projectId` scoping already assumes everywhere else.
 *
 * - **The vocabulary is closed.** Kinds and relations come from
 *   `project-ontology.ts` and nothing invents one inline.
 */

import { SCOPE_LABEL } from './catalogs';
import { CAPTURE_PURPOSE_LABEL, type CapturePurpose } from './capture';
import { describeObservation, observationIsUseful } from './photo-observation';
import { readSheetFit, SHEET_KIND_LABEL } from './geo-sheet';
import { REMEDIAL_BAND_LABEL, ricsConditionRating } from './standards';
import { ensureProjectShape } from './operations';
import {
  PROJECT_EDGE_KINDS,
  PROJECT_NODE_KINDS,
  projectEdgeDirectionValid,
  projectEdgeEndpointsValid,
  projectLayerFor,
  type ProjectGraphEdgeKind,
  type ProjectGraphNodeKind,
} from './project-ontology';
import type { DdProject, ProjectGraphEdge, ProjectGraphNode } from './types';
import type { TitleEdgeKind, TitleGraph, TitleGraphSummary, TitleNodeKind } from '../types';

/** Turns `bda_approved` into `Bda approved` for a node label. Enum keys have no label map. */
function titleCase(value: string): string {
  const words = value.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

interface Builder {
  node(kind: ProjectGraphNodeKind, id: string, label: string, detail?: string): string;
  edge(from: string, to: string, rel: ProjectGraphEdgeKind): void;
}

export function buildProjectGraph(project: DdProject): { nodes: ProjectGraphNode[]; edges: ProjectGraphEdge[] } {
  ensureProjectShape(project);

  const nodes: ProjectGraphNode[] = [];
  const byId = new Map<string, ProjectGraphNode>();
  const pending: ProjectGraphEdge[] = [];
  const seenEdges = new Set<string>();

  const b: Builder = {
    node(kind, id, label, detail) {
      const existing = byId.get(id);
      // First writer wins. The title fold can name a party the stakeholder
      // register already introduced; keeping the first keeps the label a
      // person recognises rather than the one an OCR pass produced.
      if (existing) return id;
      const node: ProjectGraphNode = {
        id,
        kind,
        layer: projectLayerFor(kind),
        origin: 'derived',
        label,
        ...(detail ? { detail } : {}),
      };
      nodes.push(node);
      byId.set(id, node);
      return id;
    },
    edge(from, to, rel) {
      if (from === to) return;
      const id = `${from}:${rel}:${to}`;
      if (seenEdges.has(id)) return;
      seenEdges.add(id);
      pending.push({ id, from, to, rel });
    },
  };

  b.node('project', project.id, project.name, project.reference);

  addRegisters(project, b);
  addProperty(project, b);
  addDeliberation(project, b);

  // The dangling guard. Buffered to here rather than checked at each call
  // site, because the registers are written in reading order and a check
  // legitimately names an evidence row several hundred lines before that row
  // becomes a node.
  const edges = pending.filter(e => byId.has(e.from) && byId.has(e.to));
  return { nodes, edges };
}

/* ==================================================================== */
/* The registers — what the file records                                 */
/* ==================================================================== */

function addRegisters(project: DdProject, b: Builder): void {
  for (const asset of project.assets) {
    b.node('asset', asset.id, asset.name, asset.assetType);
    if (asset.parentId) b.edge(asset.parentId, asset.id, 'contains');
    else b.edge(project.id, asset.id, 'has_asset');
  }

  for (const assessment of project.assessments) {
    b.node('assessment', assessment.id, assessment.name, assessment.status);
    b.edge(project.id, assessment.id, 'assessed_by');
    for (const assetId of assessment.targetAssetIds) b.edge(assessment.id, assetId, 'targets');
    for (const scope of assessment.scopes) {
      b.node('scope', scope.id, SCOPE_LABEL[scope.scopeKey], `${scope.checks.length} checks · ${scope.status}`);
      b.edge(assessment.id, scope.id, 'has_scope');
      for (const check of scope.checks) {
        b.node('check', check.id, check.title, check.result);
        b.edge(scope.id, check.id, 'has_check');
        for (const evidenceId of check.evidenceIds) b.edge(check.id, evidenceId, 'supported_by');
        for (const findingId of check.findingIds) b.edge(check.id, findingId, 'produces');
      }
    }
  }

  for (const row of project.evidence) {
    // A photograph's purpose belongs in the meta line, because it is what
    // decides whether the row answers the question being traversed for: a
    // valuation inspection shot and a progress shot are the same `evidence`
    // node with completely different standing.
    const purposes = [...new Set(row.attachments.map((a) => a.capture?.purpose).filter(Boolean) as CapturePurpose[])];
    /*
     * A model's reading of a photograph goes in the node's detail, which is
     * what `findProjectNodes` searches. That is the whole reason to read four
     * hundred photographs: "the photos of the north boundary" has to find them,
     * and a title of "Site photographs, tower A" never will.
     *
     * Attributed, and truncated. The detail line is a label, not a report —
     * and it must never read as the file's own voice, which is why
     * `describeObservation` puts the model's name in front of it.
     */
    const read = row.attachments.map((a) => a.observation).find((o) => observationIsUseful(o));
    const meta = [
      row.status,
      purposes.length ? purposes.map((x) => CAPTURE_PURPOSE_LABEL[x]).join(', ') : '',
      read ? describeObservation(read).slice(0, 160) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    b.node('evidence', row.id, row.title, meta);
    for (const assessmentId of row.assessmentIds) b.edge(assessmentId, row.id, 'supported_by');
    for (const checkId of row.checkIds) b.edge(checkId, row.id, 'supported_by');
    // Every visit a file on this row was taken on. The edge is what makes a
    // visit's limitations reachable from anything resting on the photograph.
    for (const visitId of new Set(row.attachments.map((a) => a.capture?.visitId).filter(Boolean) as string[])) {
      b.edge(row.id, visitId, 'observed_on');
    }
  }

  /*
   * The occasions of looking, and the sheets placed on the ground.
   *
   * Both were registers the graph could not see, which meant `get_subgraph`
   * and `trace_conclusion` answered "what is this finding resting on" without
   * ever reaching the visit that says the roof was never inspected. A
   * traversal that cannot reach the limitation has answered a different
   * question from the one asked.
   */
  for (const visit of project.siteVisits ?? []) {
    const limits = visit.limitations.length ? `${visit.limitations.length} limitation(s)` : 'no limitation recorded';
    b.node('site_visit', visit.id, visit.title, `${visit.visitedOn} · ${visit.surveyor} · ${limits}`);
    b.edge(project.id, visit.id, 'has_visit');
    for (const assetId of visit.assetIds) b.edge(visit.id, assetId, 'targets');
    for (const findingId of visit.findingIds) b.edge(findingId, visit.id, 'observed_on');
  }

  for (const sheet of project.sheets ?? []) {
    // The verdict travels with the node. A sheet nobody has placed and one
    // placed from two points look identical without it, and they are worth
    // very different amounts to anything reading a boundary off them.
    const reading = readSheetFit(sheet.controlPoints);
    b.node('sheet', sheet.id, sheet.title, `${SHEET_KIND_LABEL[sheet.kind]} · ${reading.verdict}`);
    b.edge(project.id, sheet.id, 'has_sheet');
  }

  for (const finding of project.findings) {
    /*
     * Three facts in the meta line, because "critical" says none of them.
     *
     * The RICS rating is derived here exactly as it is everywhere else. The
     * escalation is the separate question of whether somebody had to be told
     * today, which no severity scale can express — and it is precisely what a
     * reader traversing for "what is urgent" is looking for.
     */
    const parts = [`RICS ${ricsConditionRating(finding.severity)}`, finding.severity, SCOPE_LABEL[finding.discipline]];
    if (finding.escalation?.immediateAction) parts.push('immediate action');
    if (finding.environmentalCondition) parts.push(finding.environmentalCondition.toUpperCase());
    b.node('finding', finding.id, finding.title, parts.join(' · '));
    for (const assessmentId of finding.assessmentIds) b.edge(assessmentId, finding.id, 'found');
    for (const evidenceId of finding.evidenceIds) b.edge(finding.id, evidenceId, 'supported_by');
    if (finding.sourceCheckId) b.edge(finding.sourceCheckId, finding.id, 'produces');
  }

  for (const risk of project.risks) {
    b.node('risk', risk.id, risk.title, risk.materiality);
    for (const findingId of risk.findingIds) b.edge(findingId, risk.id, 'raises');
    for (const evidenceId of risk.evidenceIds) b.edge(risk.id, evidenceId, 'supported_by');
    if (!risk.findingIds.length) b.edge(project.id, risk.id, 'has_risk');
  }

  for (const action of project.actions) {
    // The band, because "when does this money fall" is the question a
    // traversal over actions is usually serving.
    const meta = action.costBand ? `${action.status} · ${REMEDIAL_BAND_LABEL[action.costBand].split(' — ')[0]}` : action.status;
    b.node('action', action.id, action.title, meta);
    for (const findingId of action.findingIds) b.edge(findingId, action.id, 'requires');
    // Was `mitigates` pointing this way, which read backwards and disagreed
    // with the case graph's own `mitigates`. Same edge, correct word.
    for (const riskId of action.riskIds) b.edge(riskId, action.id, 'requires');
    for (const evidenceId of action.evidenceIds) b.edge(action.id, evidenceId, 'supported_by');
    for (const checkId of action.checkIds) b.edge(checkId, action.id, 'requires');
  }

  for (const decision of project.decisions) {
    b.node('decision', decision.id, decision.title, decision.status);
    for (const findingId of decision.findingIds) b.edge(findingId, decision.id, 'informs');
    for (const riskId of decision.riskIds) b.edge(riskId, decision.id, 'informs');
  }

  for (const report of project.reports) {
    b.node('report', report.id, report.title, report.kind);
    b.edge(project.id, report.id, 'reported_in');
  }
}

/* ==================================================================== */
/* The property — what is actually being bought                          */
/* ==================================================================== */

/**
 * The parcel, the people, the paper and the permissions.
 *
 * Three sources, in increasing order of how much they know:
 *
 * 1. The file's own particulars — `parcelId`, `tenure`, `plot`, `karnataka`.
 *    Present from the moment somebody types an address, so a file that has
 *    never been screened still has a parcel in its graph.
 * 2. `stakeholders` — the people engaged on the file. A register that has
 *    existed all along and was projected nowhere.
 * 3. `lastScreenResult.titleGraph` — the chain of title, once a screen has
 *    run. This is the half that was being computed and discarded.
 */
function addProperty(project: DdProject, b: Builder): void {
  const parcelId = `${project.id}::parcel`;
  const hasParticulars =
    Boolean(project.parcelId) ||
    Boolean(project.karnataka) ||
    Boolean(project.plot) ||
    Boolean(project.landAreaSqm) ||
    Boolean(project.siteAddress);

  if (hasParticulars) {
    const label = project.parcelId?.trim() || project.siteAddress?.trim() || project.location || project.name;
    const detail = [
      project.landAreaSqm ? `${Math.round(project.landAreaSqm).toLocaleString('en-IN')} sqm` : null,
      project.tenure && project.tenure !== 'unknown' ? project.tenure : null,
      project.karnataka?.areaBasis && project.karnataka.areaBasis !== 'unknown'
        ? `${titleCase(project.karnataka.areaBasis)} basis`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    b.node('parcel', parcelId, label, detail || undefined);
    b.edge(project.id, parcelId, 'sited_at');
    // Top-level assets only. A tower's every floor standing on the parcel is
    // true and says nothing; the building standing on it is the fact.
    for (const asset of project.assets) {
      if (!asset.parentId) b.edge(asset.id, parcelId, 'sited_at');
    }
  }

  const karnataka = project.karnataka;
  if (karnataka) {
    const authorityId = `${project.id}::authority::${karnataka.jurisdiction}`;
    b.node('authority', authorityId, karnataka.jurisdiction.toUpperCase(), 'Planning and revenue jurisdiction');
    if (hasParticulars) b.edge(parcelId, authorityId, 'governed_by');
    else b.edge(project.id, authorityId, 'governed_by');

    // `unknown` is the absence of a record, not a record. An approval node
    // labelled "Unknown khata" would render as a permission the file holds.
    if (karnataka.khataType && karnataka.khataType !== 'none' && karnataka.khataType !== 'unknown') {
      const khataId = `${project.id}::approval::khata`;
      b.node(
        'approval',
        khataId,
        `${titleCase(karnataka.khataType.replace(/_khata$/, ''))} khata`.replace(/^A /, 'A-').replace(/^B /, 'B-').replace(/^E /, 'e-'),
        karnataka.eKhataIssued ? 'e-khata issued' : 'e-khata not issued',
      );
      if (hasParticulars) b.edge(khataId, parcelId, 'affects');
      b.edge(khataId, authorityId, 'issued_by');
    }

    if (karnataka.landConversionStatus === 'converted') {
      const convId = `${project.id}::approval::dc-conversion`;
      b.node('approval', convId, 'DC conversion', 'Land converted to non-agricultural use');
      if (hasParticulars) b.edge(convId, parcelId, 'affects');
      b.edge(convId, authorityId, 'issued_by');
    }

    if (karnataka.kreraNumber) {
      const reraId = `${project.id}::approval::krera`;
      const reraAuthority = `${project.id}::authority::krera`;
      b.node('approval', reraId, `K-RERA ${karnataka.kreraNumber}`, 'Project registration');
      b.node('authority', reraAuthority, 'K-RERA', 'Karnataka Real Estate Regulatory Authority');
      if (hasParticulars) b.edge(reraId, parcelId, 'affects');
      b.edge(reraId, reraAuthority, 'issued_by');
    }
  }

  const layout = project.plot?.layoutApproval;
  if (layout && layout !== 'unknown' && layout !== 'unapproved') {
    const layoutId = `${project.id}::approval::layout`;
    b.node('approval', layoutId, `${titleCase(layout)} layout`, 'Layout sanction');
    if (hasParticulars) b.edge(layoutId, parcelId, 'affects');
  }

  for (const person of project.stakeholders) {
    b.node('party', person.id, person.name, [person.role, person.organisation].filter(Boolean).join(' · '));
    b.edge(project.id, person.id, 'engaged_on');
  }

  const title = project.lastScreenResult?.titleGraph;
  if (title) addTitleChain(project, title, b, hasParticulars ? parcelId : undefined);
}

/**
 * The chain of title, folded in from the last screen.
 *
 * `runScreen` computes this and keeps only the summary; the summary is enough
 * to rebuild the entities, because `TitleChain` carries the node ids and
 * labels for every parcel, instrument and party it walked. What it does not
 * carry — attributes, boundaries, extents beyond the link's own — stays in
 * the `ScreenResult`, which is where a reader who wants the arithmetic goes.
 *
 * The screen's own parcel node and the file's declared parcel are joined with
 * `derives_from` rather than merged. They are two claims about the same land
 * from different sources, and merging them would erase the ability to say
 * that the deed and the khata describe the site differently — which is
 * precisely the finding this product exists to surface.
 */
function addTitleChain(
  project: DdProject,
  title: TitleGraphSummary,
  b: Builder,
  declaredParcelId: string | undefined,
): void {
  const ns = (nodeId: string): string => `${project.id}::title::${nodeId}`;

  for (const chain of title.chains) {
    const chainParcel = b.node(
      'parcel',
      ns(chain.parcelNodeId),
      chain.parcelLabel,
      [
        chain.links.length ? `${chain.links.length} instrument(s)` : null,
        chain.yearsEstablished ? `${chain.yearsEstablished}y established` : null,
        chain.breaks.length ? `${chain.breaks.length} break(s)` : null,
      ]
        .filter(Boolean)
        .join(' · ') || undefined,
    );
    if (declaredParcelId) b.edge(chainParcel, declaredParcelId, 'derives_from');

    let previousInstrument: string | undefined;
    for (const link of chain.links) {
      const instrument = b.node(
        'instrument',
        ns(link.instrumentNodeId),
        link.label,
        [link.at ? link.at.slice(0, 10) : 'undated', link.extentSqm ? `${Math.round(link.extentSqm)} sqm` : null]
          .filter(Boolean)
          .join(' · '),
      );
      b.edge(instrument, chainParcel, 'affects');
      if (previousInstrument) b.edge(instrument, previousInstrument, 'derives_from');
      previousInstrument = instrument;

      if (link.fromPartyNodeId) {
        b.node('party', ns(link.fromPartyNodeId), link.fromPartyLabel ?? 'Vendor', 'Title party');
        b.edge(instrument, ns(link.fromPartyNodeId), 'conveyed_by');
      }
      if (link.toPartyNodeId) {
        b.node('party', ns(link.toPartyNodeId), link.toPartyLabel ?? 'Purchaser', 'Title party');
        b.edge(instrument, ns(link.toPartyNodeId), 'conveyed_to');
      }
    }
  }

  for (const row of title.contradictions) {
    const id = b.node('contradiction', ns(row.id), row.subject, `${row.severity} · ${row.statement.slice(0, 96)}`);
    // A contradiction's claims name their SOURCE, not a graph node — so the
    // edge that can be drawn honestly is to the parcel the disagreement is
    // about, not to two nodes the summary never identified.
    for (const chain of title.chains) b.edge(id, ns(chain.parcelNodeId), 'contradicts');
    if (declaredParcelId) b.edge(id, declaredParcelId, 'contradicts');
  }
}

/* ==================================================================== */
/* Deliberation — how we got here                                        */
/* ==================================================================== */

/**
 * Chat turns and proposals, pointing one way.
 *
 * Every edge here runs FROM the deliberation node, never to it. That is what
 * makes the one-way rule enforceable: a finding can never be reached by
 * walking out of a thought, so no traversal that gathers what a conclusion
 * rests on can pick up a model's musing on the way.
 */
function addDeliberation(project: DdProject, b: Builder): void {
  for (const turn of project.conversation.slice(-24)) {
    const nodeId = `chat:${turn.id}`;
    b.node(
      turn.role === 'user' ? 'question' : 'thought',
      nodeId,
      turn.role === 'user' ? 'Ask' : 'Insight',
      turn.text.replace(/\s+/g, ' ').slice(0, 88),
    );
    b.edge(nodeId, project.id, 'raised_on');
    for (const cited of turn.citedNodeIds ?? []) b.edge(nodeId, cited, 'cites');
    for (const evidenceId of turn.citedEvidenceIds) b.edge(nodeId, evidenceId, 'cites');
  }

  for (const row of project.chatProposals.filter(p => p.status !== 'rejected').slice(-16)) {
    b.node('proposal', row.id, row.title, row.status);
    b.edge(row.id, project.id, 'raised_on');
    if (row.committedRecordId) b.edge(row.id, row.committedRecordId, 'became');
  }

  // The agent-side twin of a chat proposal, and projected nowhere until now.
  // A draft awaiting review and a chat proposal awaiting review are the same
  // thing arriving through different doors; a graph that showed one and not
  // the other made the review queue look half its actual size.
  for (const draft of project.aiDrafts.filter(d => d.status !== 'rejected').slice(-16)) {
    b.node('proposal', draft.id, draft.title, `${draft.kind} · ${draft.status}`);
    b.edge(draft.id, project.id, 'raised_on');
    if (draft.committedRecordId) b.edge(draft.id, draft.committedRecordId, 'became');
  }
}

/* ==================================================================== */
/* Validation                                                            */
/* ==================================================================== */

export interface ProjectGraphProblem {
  edgeId?: string;
  nodeId?: string;
  reason: string;
}

/**
 * Every way this graph could be malformed, as a list rather than a throw.
 *
 * Used two ways, and the difference matters. Against the builder's own output
 * it is a test assertion — the builder is meant to be correct by construction
 * and this proves it stays that way. Against an authored annotation arriving
 * over HTTP it is a real gate, because a person drawing a link by hand is
 * exactly the case a closed ontology exists to constrain.
 */
export function validateProjectGraph(graph: {
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
}): ProjectGraphProblem[] {
  const problems: ProjectGraphProblem[] = [];
  const byId = new Map(graph.nodes.map(n => [n.id, n]));

  for (const node of graph.nodes) {
    if (!(PROJECT_NODE_KINDS as readonly string[]).includes(node.kind)) {
      problems.push({ nodeId: node.id, reason: `unknown node kind "${node.kind}"` });
      continue;
    }
    if (node.layer !== projectLayerFor(node.kind)) {
      problems.push({ nodeId: node.id, reason: `layer "${node.layer}" does not match kind "${node.kind}"` });
    }
  }

  for (const edge of graph.edges) {
    if (!(PROJECT_EDGE_KINDS as readonly string[]).includes(edge.rel)) {
      problems.push({ edgeId: edge.id, reason: `unknown relation "${edge.rel}"` });
      continue;
    }
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      problems.push({ edgeId: edge.id, reason: `edge names a node the graph does not have` });
      continue;
    }
    if (!projectEdgeEndpointsValid(edge.rel, from.kind, to.kind)) {
      problems.push({ edgeId: edge.id, reason: `"${edge.rel}" may not join ${from.kind} to ${to.kind}` });
    }
    if (!projectEdgeDirectionValid(from.layer, to.layer)) {
      problems.push({
        edgeId: edge.id,
        reason: `${from.layer} may not rest on ${to.layer} — deliberation is cited, never relied on`,
      });
    }
  }

  return problems;
}

/* ==================================================================== */
/* The title half, in the shape the diagram already speaks               */
/* ==================================================================== */

/**
 * The property entities of the project graph, as a `TitleGraph`.
 *
 * `TitleChainDiagram` has existed and been orphaned since it was written,
 * because it takes the full `TitleGraph` that `runScreen` builds and then
 * throws away — only the summary survived onto the result. Rather than start
 * storing a second copy of the graph, this reads the one that IS stored: the
 * project graph now carries `parcel`, `party`, `instrument`, `authority`,
 * `encumbrance` and `approval`, which are precisely the six columns the
 * diagram draws.
 *
 * The vocabularies line up because they were deliberately aligned — the
 * project ontology mirrors the case ontology's relation names wherever the two
 * describe the same thing, which is what makes this an id-and-key rename
 * rather than a translation.
 *
 * `attributes` comes back as the node's detail line rather than the original
 * bag. The diagram renders a label and a subtitle; nothing downstream reads
 * individual attribute keys, and inventing typed attributes we no longer hold
 * would be worse than saying plainly what we have.
 */
export function titleGraphFromProject(project: DdProject): TitleGraph {
  const { nodes, edges } = buildProjectGraph(project);
  const KINDS = new Set<ProjectGraphNodeKind>(['parcel', 'party', 'instrument', 'authority', 'encumbrance', 'approval']);
  const kept = nodes.filter(n => KINDS.has(n.kind));
  const ids = new Set(kept.map(n => n.id));

  const REL: Partial<Record<ProjectGraphEdgeKind, TitleEdgeKind>> = {
    conveyed_by: 'conveyed_by',
    conveyed_to: 'conveyed_to',
    affects: 'affects',
    derives_from: 'derives_from',
    encumbers: 'encumbers',
    issued_by: 'issued_by',
  };

  return {
    caseId: project.id,
    builtAt: project.updatedAt,
    nodes: kept.map(n => ({
      id: n.id,
      kind: n.kind as TitleNodeKind,
      label: n.label,
      // The merge key the case builder computes is not reconstructable from a
      // projected node, and the id already carries identity here — so it is
      // the id rather than a normalisation invented after the fact.
      mergeKey: n.id,
      assertedBy: [],
      attributes: (n.detail ? { detail: n.detail } : {}) as Record<string, string>,
    })),
    edges: edges
      .filter(e => ids.has(e.from) && ids.has(e.to) && REL[e.rel])
      .map(e => ({
        id: e.id,
        kind: REL[e.rel]!,
        fromNodeId: e.from,
        toNodeId: e.to,
        label: e.rel.replace(/_/g, ' '),
        // Every edge here came out of the projection rather than a document
        // read, so there is nothing to cite and nothing to be less than sure
        // about. Claiming a confidence below 1 would invent a doubt.
        assertedBy: [],
        confidence: 1,
      })),
  };
}
