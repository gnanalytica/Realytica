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
 * Five rules the builder holds to:
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
 *
 * - **Nothing floats.** Every node can be reached from the project. A record
 *   that nothing places (an action with no finding behind it, a document no
 *   check cites) is on the file all the same, and a walk that starts at the
 *   project and never arrives at it has left part of the file out. Whatever
 *   the registers leave unreached is tied to the project at the end, by the
 *   relation its kind already has or by `has_record`.
 *
 * The frame the records sit in is the one the menu shows: four stages, the
 * menu's five departments, and their functions, with Design as one function
 * inside Engineering. The names come from `departments.ts`, the same place
 * the menu reads them.
 */

import { SCOPE_LABEL } from './catalogs';
import { CAPTURE_PURPOSE_LABEL, type CapturePurpose } from './capture';
import { describeObservation, observationIsUseful } from './photo-observation';
import { readSheetFit, SHEET_KIND_LABEL } from './geo-sheet';
import { REMEDIAL_BAND_LABEL, ricsConditionRating } from './standards';
import { ensureProjectShape } from './operations';
import {
  PROJECT_EDGE_KINDS,
  PROJECT_EDGE_LABEL,
  PROJECT_NODE_KINDS,
  projectEdgeDirectionValid,
  projectEdgeEndpointsValid,
  projectLayerFor,
  type ProjectGraphEdgeKind,
  type ProjectGraphNodeKind,
} from './project-ontology';
import type { DdProject, ProjectGraphEdge, ProjectGraphNode } from './types';
import {
  DEPARTMENT_KEYS,
  DEPARTMENT_ROLE_LABEL,
  DEPARTMENT_SHORT,
  MENU_DEPARTMENTS,
  STAGES,
  SUB_STAGES,
  SUB_STAGE_LABEL,
  departmentDefinition,
  departmentHomeWorkstream,
  functionKey,
  menuDepartment,
  menuDepartmentsOf,
  menuFunctions,
  stageAt,
  stageOf,
  withDepartment,
  workstreamDefinition,
  workstreamOfCheck,
  type DepartmentKey,
  type DepartmentRole,
  type MenuFunction,
  type StageKey,
} from './departments';
import { questionStatus, questionnaireDepartment, questionnaireSummary } from './questionnaire';
import { projectDepartments } from './team';
import { quickAssessment, QUICK_VERDICT_LABEL } from './quick-assessments';
import { approvalsRegister, APPROVAL_STATUS_LABEL } from './approvals';
import { COST_DEDUCTION_LABEL, billLineStatus, billPosition, contractPosition, costRegister, costSourceSaid, moneySaid, packagePosition, type BillLine } from './cost';
import { linkEdge, projectLinks, type LinkEnd } from './links';
import { documentWorkstream } from './vault';
import type { TitleEdgeKind, TitleGraph, TitleGraphSummary, TitleNodeKind } from '../types';

/** Turns `bda_approved` into `Bda approved` for a node label. Enum keys have no label map. */
function titleCase(value: string): string {
  const words = value.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

interface Builder {
  node(kind: ProjectGraphNodeKind, id: string, label: string, detail?: string, tags?: { key?: string; status?: string }): string;
  edge(from: string, to: string, rel: ProjectGraphEdgeKind): void;
  has(id: string): boolean;
  /** The kind of the node written under an id, if one has been. */
  kindOf(id: string): ProjectGraphNodeKind | undefined;
}

export function buildProjectGraph(project: DdProject): { nodes: ProjectGraphNode[]; edges: ProjectGraphEdge[] } {
  ensureProjectShape(project);

  const nodes: ProjectGraphNode[] = [];
  const byId = new Map<string, ProjectGraphNode>();
  const pending: ProjectGraphEdge[] = [];
  const seenEdges = new Set<string>();

  const b: Builder = {
    node(kind, id, label, detail, tags) {
      const existing = byId.get(id);
      // First writer wins. The title fold can name a party the stakeholder
      // register already introduced; keeping the first keeps the label a
      // person recognises rather than the one an OCR pass produced. A later
      // writer may still add the key and status the first one did not know.
      if (existing) {
        if (tags?.key && !existing.key) existing.key = tags.key;
        if (tags?.status && !existing.status) existing.status = tags.status;
        return id;
      }
      const node: ProjectGraphNode = {
        id,
        kind,
        layer: projectLayerFor(kind),
        origin: 'derived',
        label,
        ...(detail ? { detail } : {}),
        ...(tags?.key ? { key: tags.key } : {}),
        ...(tags?.status ? { status: tags.status } : {}),
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
    has(id) {
      return byId.has(id);
    },
    kindOf(id) {
      return byId.get(id)?.kind;
    },
  };

  b.node('project', project.id, project.name, project.reference);

  addRegisters(project, b);
  addProperty(project, b);
  addStructure(project, b);
  addDeliberation(project, b);

  // The dangling guard. Buffered to here rather than checked at each call
  // site, because the registers are written in reading order and a check
  // legitimately names an evidence row several hundred lines before that row
  // becomes a node.
  const edges = pending.filter(e => byId.has(e.from) && byId.has(e.to));
  tieUnreached(project.id, nodes, edges);
  return { nodes, edges };
}

/**
 * The relation that ties each kind of record to the project when nothing
 * else places it.
 *
 * The kind's own word where it has one and the word is true of a record
 * nothing places: a risk left unplaced is the project's by `has_risk`, the
 * same edge a risk with no finding has always had. `has_record` for the
 * kinds that have no such word, and for the two whose word would claim too
 * much. The only parcel or party left unreached is one a title chain names
 * on a file with no land declared, and `sited_at` would say the project
 * stands on that parcel and `engaged_on` that it engaged that party. A kind
 * left out is one that always arrives under a parent (a check under its
 * scope, an answer under its questionnaire, a bill's line and its certificate
 * under the bill) or that points at the project itself, as every question,
 * thought and proposal does.
 */
const PROJECT_TIE: Partial<Record<ProjectGraphNodeKind, ProjectGraphEdgeKind>> = {
  department: 'has_department',
  asset: 'has_asset',
  parcel: 'has_record',
  party: 'has_record',
  authority: 'governed_by',
  assessment: 'assessed_by',
  risk: 'has_risk',
  report: 'reported_in',
  site_visit: 'has_visit',
  sheet: 'has_sheet',
  evidence: 'has_record',
  finding: 'has_record',
  action: 'has_record',
  decision: 'has_record',
  approval: 'has_record',
  milestone: 'has_record',
  site_entry: 'has_record',
  questionnaire: 'has_record',
  certified_report: 'has_record',
  engagement: 'has_record',
  member: 'has_record',
  contradiction: 'has_record',
  work_package: 'has_record',
  contract: 'has_record',
  bill: 'has_record',
};

/**
 * Ties to the project whatever cannot be reached from it.
 *
 * Run last, over the edges that survived the dangling guard, because whether
 * a record is placed is only known once every register has had its say: an
 * action is placed by a finding written before it and by a check written
 * after.
 *
 * A record with no edge at all gets one from the project. Records joined only
 * to each other (an action resting on a document that nothing else cites)
 * get one between them, on whichever was written first, and the rest are
 * reached through it. A record the project already reaches gets none, so this
 * edge is never a second way of saying what another edge says.
 *
 * Talk does not place a record. An edge that starts at a question, a thought
 * or a proposal is left out of the walk: a chat turn citing an action, or a
 * draft that became one, says the action was discussed, not where it sits.
 * Counting it would also make the tie come and go with the conversation,
 * because only the latest turns are drawn. An action nothing places would
 * lose its tie the day somebody asked about it and get it back when that turn
 * left the window, and every sync would close the edge and reopen it.
 *
 * Walked in the order the nodes were written, which is what keeps a rebuild
 * byte-identical.
 */
function tieUnreached(projectId: string, nodes: ProjectGraphNode[], edges: ProjectGraphEdge[]): void {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const beside = new Map<string, string[]>(nodes.map(n => [n.id, []]));
  for (const edge of edges) {
    if (byId.get(edge.from)?.layer === 'deliberation') continue;
    beside.get(edge.from)?.push(edge.to);
    beside.get(edge.to)?.push(edge.from);
  }
  const reached = new Set<string>();
  const walkFrom = (start: string) => {
    const queue = [start];
    reached.add(start);
    while (queue.length > 0) {
      for (const id of beside.get(queue.pop() as string) ?? []) {
        if (reached.has(id)) continue;
        reached.add(id);
        queue.push(id);
      }
    }
  };

  walkFrom(projectId);
  for (const node of nodes) {
    if (reached.has(node.id)) continue;
    const rel = PROJECT_TIE[node.kind];
    if (!rel) continue;
    edges.push({ id: `${projectId}:${rel}:${node.id}`, from: projectId, to: node.id, rel });
    walkFrom(node.id);
  }
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
    // Its standing travels as the node's status as well as in the meta line.
    // A check is joined to every paper it names, and whether "rests on" is
    // true of one depends on whether the paper has come and whether it is
    // still relied on: `projectNodeAwaited` and `projectNodeSetAside` read it
    // here.
    b.node('evidence', row.id, row.title, meta, { status: row.status });
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
      const convId = `${project.id}::approval::conversion`;
      b.node('approval', convId, 'DC conversion', 'Land converted to non-agricultural use');
      if (hasParticulars) b.edge(convId, parcelId, 'affects');
      b.edge(convId, authorityId, 'issued_by');
    }

    if (karnataka.kreraNumber) {
      const reraId = `${project.id}::approval::rera`;
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
/* ==================================================================== */
/* How the work is organised                                             */
/* ==================================================================== */

/*
 * The ids the frame is drawn under. Kept in one place because the builder is
 * not their only reader: `projectFrameLabels` hands them to the chat, which
 * has to know a stage or a function by the same id the graph gives it.
 */
const stageNodeId = (projectId: string, key: StageKey) => `${projectId}::stage::${key}`;
/** A function's node, from the key of a workstream it stands for or from its own. */
const functionNodeId = (projectId: string, workstream: string) => `${projectId}::ws::${functionKey(workstream)}`;
const departmentNodeId = (projectId: string, menu: DepartmentKey) => `${projectId}::dept::${menu}`;

/**
 * The departments drawn for a project and the functions drawn under each:
 * the menu's departments that are switched on, with the functions whose own
 * department is. Engineering is drawn while either it or Design is on, and
 * holds Design only while Design is.
 */
function drawnDepartments(project: DdProject): Array<{ menu: DepartmentKey; functions: MenuFunction[] }> {
  const enabled = projectDepartments(project);
  return menuDepartmentsOf(enabled).map((menu) => ({ menu, functions: menuFunctions(menu).filter((fn) => enabled.includes(fn.department)) }));
}

/**
 * The frame's nodes by id, each with the name a person knows it by: the four
 * stages, the departments drawn and their functions.
 *
 * For whatever has to turn one of these ids back into words without building
 * the graph. The chat does: an answer quotes `[…::ws::legal.title]` from what
 * the copilot read, and the renderer shows the name in its place. An id that
 * is not here is one the frame does not draw (a step, the Design department,
 * one of Design's workstreams, a department switched off): the renderer says
 * it in words, from `projectFrameNames`, and opens nothing.
 *
 * A function is named with its department, because Legal and Commercial each
 * have a Handover.
 */
export function projectFrameLabels(project: DdProject): Array<{ id: string; label: string }> {
  return [
    ...STAGES.map((stage) => ({ id: stageNodeId(project.id, stage.key), label: stage.label })),
    ...drawnDepartments(project).flatMap(({ menu, functions }) => [
      { id: departmentNodeId(project.id, menu), label: DEPARTMENT_SHORT[menu] },
      ...functions.map((fn) => ({ id: functionNodeId(project.id, fn.key), label: withDepartment(fn.key, fn.label) })),
    ]),
  ];
}

/**
 * An id of the frame in words, from the id alone: the names a person knows
 * the stage, step, department or function by. The first is the one to print.
 *
 * `projectFrameLabels` names what one project's frame draws now. This names
 * whatever an id of the frame's shape has stood for, drawn or not: a step,
 * which was a node while there were twelve of them; the Design department and
 * each of its four workstreams; a department the project has switched off. An
 * answer that quotes one of those has still said where it is talking about,
 * and the chat prints the name where the id stood.
 *
 * The names after the first are the other ways the same thing is said
 * ("Legal", "Legal & Compliance"). The chat uses them to tell that the
 * sentence had already named it, and so not to say it twice.
 *
 * Empty for an id of any other shape, and for a key that was never a stage, a
 * step, a department or a workstream.
 */
export function projectFrameNames(id: string): string[] {
  const match = /::(stage|dept|ws)::([^:]+)$/.exec(id);
  const kind = match?.[1];
  const key = match?.[2];
  if (!kind || !key) return [];
  if (kind === 'stage') {
    const stage = STAGES.find((s) => s.key === key);
    if (stage) return [stage.label];
    const step = SUB_STAGES.find((s) => s === key);
    return step ? [SUB_STAGE_LABEL[step]] : [];
  }
  if (kind === 'dept') {
    const department = DEPARTMENT_KEYS.find((d) => d === key);
    return department ? [DEPARTMENT_SHORT[department], departmentDefinition(department).label] : [];
  }
  const fn = MENU_DEPARTMENTS.flatMap((menu) => menuFunctions(menu)).find((f) => f.key === key);
  if (fn) return [...new Set([fn.name, fn.label])];
  const workstream = workstreamDefinition(key);
  return workstream ? [workstream.label] : [];
}

/** The node id each kind of link end is drawn as. A link names a workstream; the node is its function. */
function linkEndId(project: DdProject, end: LinkEnd): string {
  switch (end.kind) {
    case 'workstream':
      return functionNodeId(project.id, end.id);
    case 'approval':
      return `${project.id}::approval::${end.id}`;
    default:
      return end.id;
  }
}

const ROLE_EDGE: Record<DepartmentRole, ProjectGraphEdgeKind> = {
  lead: 'leads',
  contributor: 'contributes_to',
  signer: 'signs_for',
  viewer: 'views',
};

/**
 * Stages, departments, functions, engagements, people, milestones, the site
 * log, the cost register, quick assessments and certified reports, and every
 * record placed in its function and in the stage it arrived in.
 *
 * This is the frame the departments share. The registers above say what the
 * file holds; this says whose work each record is, when it happened, and how
 * one department's work reaches another's.
 *
 * It is drawn as the menu shows it. The record keeps twelve steps, six
 * departments and a workstream for each of Design's four pieces of work; the
 * graph draws the four stages, the menu's five departments and one Design
 * function, so what a person walks here is what they move between in the app.
 * `wsId` takes a workstream's key and answers with the function it is drawn
 * as.
 *
 * What the frame leaves out stays findable. People still say "Mobilisation",
 * "RFIs" and "Legal & Compliance", so each node carries in its detail the
 * names it stands for: a stage its steps, a department its name in full,
 * Design its four workstreams. `findProjectNodes` reads the detail.
 */
function addStructure(project: DdProject, b: Builder): void {
  const pid = project.id;
  const stageId = (key: StageKey) => stageNodeId(pid, key);
  const wsId = (workstream: string) => functionNodeId(pid, workstream);
  const deptId = (menu: DepartmentKey) => departmentNodeId(pid, menu);

  // Stages: the four, in order. A step is not a node. Each stage lists its
  // steps, and the stage the project is in says first which one it is at.
  const current = stageOf(project.currentStage);
  const currentIndex = STAGES.findIndex((s) => s.key === current);
  const step = SUB_STAGE_LABEL[project.currentStage];
  STAGES.forEach((stage, i) => {
    const steps = `Steps: ${stage.subStages.map((sub) => SUB_STAGE_LABEL[sub]).join(', ')}`;
    b.node('stage', stageId(stage.key), stage.label, i === currentIndex && step ? `At the ${step} step · ${steps}` : steps, {
      key: stage.key,
      status: i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'ahead',
    });
  });
  STAGES.forEach((stage, i) => {
    const next = STAGES[i + 1];
    if (next) b.edge(stageId(stage.key), stageId(next.key), 'precedes');
  });
  b.edge(pid, stageId(current), 'at_stage');
  const inStage = (id: string, at: string | undefined) => {
    if (at) b.edge(id, stageId(stageOf(stageAt(project, at))), 'in_stage');
  };

  // Departments as the menu has them, and under each the functions whose own
  // department is switched on.
  const enabled = projectDepartments(project);
  const live = new Set<string>();
  for (const { menu, functions } of drawnDepartments(project)) {
    // Described by what is drawn under it. Its own department when that is
    // on. With only Design on, Engineering here stands for Design alone: it
    // is described as Design is, and it is no more built than Design. Its
    // name in full leads, so "Legal & Compliance" and "Construction" find it.
    const said = departmentDefinition(enabled.includes(menu) ? menu : (functions[0]?.department ?? menu));
    b.node('department', deptId(menu), DEPARTMENT_SHORT[menu], `${said.label} · ${said.purpose}`, {
      key: menu,
      status: functions.some((fn) => fn.built) ? 'live' : 'coming_soon',
    });
    b.edge(pid, deptId(menu), 'has_department');
    for (const fn of functions) {
      // The one word is the label. The name in full leads the detail where
      // the two differ, and a function standing for several workstreams
      // names them, so "land records" finds Title and "RFIs" finds Design.
      const stands = fn.workstreams.length > 1 ? fn.workstreams.map((key) => workstreamDefinition(key)?.label ?? key).join(', ') : '';
      b.node('workstream', wsId(fn.key), fn.label, [fn.name === fn.label ? '' : fn.name, stands, fn.purpose].filter(Boolean).join(' · '), {
        key: fn.key,
        status: fn.built ? 'live' : 'coming_soon',
      });
      b.edge(deptId(menu), wsId(fn.key), 'has_workstream');
      for (const key of fn.workstreams) if (workstreamDefinition(key)?.status === 'live') live.add(key);
    }
  }
  const holds = (workstream: string | undefined, id: string) => {
    if (workstream && b.has(wsId(workstream))) b.edge(wsId(workstream), id, 'holds');
  };

  // Every check sits in exactly one function.
  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) {
        holds(workstreamOfCheck(check.definitionId), check.id);
        if (check.result !== 'pending') inStage(check.id, check.updatedAt);
      }
    }
  }

  // Every document belongs to the workstream that owns it, and to the stage it arrived in.
  for (const evidence of project.evidence) {
    holds(documentWorkstream(project, evidence), evidence.id);
    inStage(evidence.id, evidence.attachments[0]?.uploadedAt);
  }
  for (const finding of project.findings) inStage(finding.id, finding.createdAt);
  for (const risk of project.risks) inStage(risk.id, risk.createdAt);
  for (const decision of project.decisions) inStage(decision.id, decision.decidedAt ?? decision.createdAt);
  for (const report of project.reports) inStage(report.id, report.generatedAt);
  for (const visit of project.siteVisits ?? []) {
    holds('construction.site', visit.id);
    inStage(visit.id, visit.visitedOn ?? visit.createdAt);
  }

  // The approvals register: what the project holds, and what it still needs.
  for (const line of approvalsRegister(project)) {
    if (!line.held.length && (line.status === 'if_applicable' || line.status === 'not_yet_due')) continue;
    const id = `${pid}::approval::${line.kind.key}`;
    b.node('approval', id, line.kind.label, APPROVAL_STATUS_LABEL[line.status], { key: line.kind.key, status: line.status });
    holds('legal.approvals', id);
    for (const held of line.held) b.edge(id, held.evidenceId, 'supported_by');
  }

  // Milestones and the site log.
  for (const milestone of project.milestones ?? []) {
    b.node('milestone', milestone.id, milestone.name, `${milestone.percent}% complete`, { status: milestone.percent >= 100 ? 'complete' : milestone.percent > 0 ? 'under_way' : 'not_started' });
    holds('construction.progress', milestone.id);
  }
  for (const entry of project.siteLog ?? []) {
    const issues = entry.issues.length ? ` · ${entry.issues.length} issue${entry.issues.length === 1 ? '' : 's'}` : '';
    b.node('site_entry', entry.id, `Site log ${entry.date}`, `${entry.workDone.slice(0, 140)}${issues}`, { status: entry.issues.some((i) => i.severity === 'high') ? 'serious_issue' : 'logged' });
    holds('construction.progress', entry.id);
    inStage(entry.id, `${entry.date}T12:00:00.000Z`);
    for (const update of entry.milestoneUpdates) b.edge(entry.id, update.milestoneId, 'advances');
  }

  /*
   * The cost register: the budget's work packages, the contracts that cover
   * them, each contractor's bills with their lines, and the certificates
   * issued on them.
   *
   * Every line of a bill is a node of its own, so that a question about one
   * item finds it ("what was passed for the waterproofing in the third
   * bill"). Its detail carries its amounts and where on the paper they were
   * read, because the detail is what a search reads and what the chat is
   * handed. A line that said only "item 4.2" would be found and say nothing.
   * It also names its bill and its work package: a neighbourhood taken around
   * one line does not walk on from them to every other line they have
   * (`extractProjectSubgraph`), so the line says where it sits by itself.
   *
   * A node's detail also says what its status says. The neighbourhood handed
   * to the chat is written from the label and the detail alone, so a
   * certificate that was withdrawn has to say so in words, or it reads as one
   * that stands. For the same reason a line is "certified" only while its
   * bill's certificate stands: what was passed for it before one is issued,
   * or after it was withdrawn, is said as passed, with no certificate.
   *
   * Budget holds a package, a contract and a bill. A line and a certificate
   * arrive under their bill.
   */
  const cost = costRegister(project);
  const money = (amount: number): string => moneySaid(amount, project.currency);
  const packageNames = new Map(cost.workPackages.map((pack) => [pack.id, [pack.code, pack.name].filter(Boolean).join(' ')]));
  for (const pack of cost.workPackages) {
    const at = packagePosition(project, pack.id);
    const over = at.balance !== undefined && at.balance < 0;
    const detail = [
      at.budget === undefined ? 'No budget set' : `Budget ${money(at.budget)}`,
      `claimed ${money(at.claimed)}`,
      `certified ${money(at.certified)}`,
      at.balance === undefined ? '' : over ? `over budget by ${money(-at.balance)}` : `left of the budget ${money(at.balance)}`,
    ];
    b.node('work_package', pack.id, packageNames.get(pack.id) ?? pack.name, detail.filter(Boolean).join(' · '), {
      status: over ? 'over_budget' : at.claimed !== 0 || at.certified !== 0 ? 'under_way' : 'not_started',
    });
    holds('finance.budget', pack.id);
    if (pack.source) b.edge(pack.id, pack.source.evidenceId, 'supported_by');
    if (pack.milestoneId) b.edge(pack.id, pack.milestoneId, 'measured_against');
  }
  for (const contract of cost.contracts) {
    const at = contractPosition(project, contract.id);
    const detail = [
      `Contract value ${money(at.value)}`,
      `certified ${money(at.certified)}`,
      `paid ${money(at.paid)}`,
      at.balance < 0 ? `certified beyond the contract value by ${money(-at.balance)}` : `left to certify ${money(at.balance)}`,
      contract.reference ? `ref. ${contract.reference}` : '',
    ];
    b.node('contract', contract.id, `${contract.contractor}: ${contract.title}`, detail.filter(Boolean).join(' · '));
    holds('finance.budget', contract.id);
    for (const packageId of contract.workPackageIds) b.edge(contract.id, packageId, 'covers');
    if (contract.source) b.edge(contract.id, contract.source.evidenceId, 'supported_by');
  }
  for (const bill of cost.bills) {
    const at = billPosition(bill);
    const contractor = cost.contracts.find((contract) => contract.id === bill.contractId)?.contractor;
    const label = contractor ? `${contractor} bill ${bill.number}` : `Bill ${bill.number}`;
    const detail = [
      bill.date,
      `claimed ${money(at.claimed)}`,
      at.gross !== undefined && at.net !== undefined ? `certified ${money(at.gross)} gross, ${money(at.net)} net` : 'not certified',
      `paid ${money(at.paid)}`,
      at.overpaid ? `overpaid by ${money(at.overpaid)}` : '',
    ];
    b.node('bill', bill.id, label, detail.filter(Boolean).join(' · '), { key: bill.number, status: at.status });
    holds('finance.budget', bill.id);
    b.edge(bill.id, bill.contractId, 'billed_under');
    if (bill.evidenceId) b.edge(bill.id, bill.evidenceId, 'supported_by');
    inStage(bill.id, `${bill.date}T12:00:00.000Z`);
    for (const line of bill.lines) {
      const status = billLineStatus(line, bill);
      const sits = { bill: label, workPackage: line.workPackageId ? packageNames.get(line.workPackageId) : undefined, certified: status === 'certified' || status === 'adjusted' };
      b.node('bill_line', line.id, [line.item, line.description].filter(Boolean).join(' ').slice(0, 120), billLineDetail(line, sits, money), { status });
      b.edge(bill.id, line.id, 'has_line');
      if (line.workPackageId) b.edge(line.id, line.workPackageId, 'prices');
      if (line.source) b.edge(line.id, line.source.evidenceId, 'supported_by');
    }
    for (const certificate of bill.certifications) {
      const less = certificate.deductions.map((deduction) => `${deduction.label ?? COST_DEDUCTION_LABEL[deduction.kind].toLowerCase()} ${money(deduction.amount)}`).join(', ');
      const detail = [
        certificate.withdrawn ? `Withdrawn ${certificate.withdrawn.at.slice(0, 10)}${certificate.withdrawn.reason ? `: ${certificate.withdrawn.reason.slice(0, 160)}` : ''}` : '',
        `${certificate.signer.name ?? certificate.signer.email}, ${certificate.signer.profession}`,
        `gross ${money(certificate.gross)}`,
        less ? `less ${less}` : 'no deductions',
        `net ${money(certificate.net)}`,
        certificate.certifiedOn,
      ];
      // Named by its bill's own label, contractor and all: two contractors each have a bill RA-1.
      b.node('certification', certificate.id, `Certificate for ${label}`, detail.filter(Boolean).join(' · '), { status: certificate.withdrawn ? 'withdrawn' : 'current' });
      b.edge(certificate.id, bill.id, 'certifies_bill');
      if (certificate.evidenceId) b.edge(certificate.id, certificate.evidenceId, 'supported_by');
      inStage(certificate.id, `${certificate.certifiedOn}T12:00:00.000Z`);
    }
  }

  // A questionnaire sits in its department's work. Each question that has an
  // answer is a node of its own, joined to what proves it, so "what does this
  // answer rest on" and "which answers cite this photograph" are both one hop.
  for (const sheet of project.questionnaires ?? []) {
    const summary = questionnaireSummary(sheet);
    b.node('questionnaire', sheet.id, sheet.title, `${summary.answered} of ${summary.total} answered`, { key: questionnaireDepartment(sheet), status: summary.unanswered ? 'open' : 'answered' });
    holds(departmentHomeWorkstream(questionnaireDepartment(sheet)), sheet.id);
    inStage(sheet.id, sheet.createdAt);
    for (const question of sheet.questions) {
      const status = questionStatus(question);
      if (status === 'unanswered') continue;
      b.node('answer', question.id, question.text.slice(0, 120), (question.answer ?? '').slice(0, 160), { key: question.source, status: status === 'suggested' ? 'suggested' : question.proof.length ? 'proven' : 'unproven' });
      b.edge(question.id, sheet.id, 'answers');
      for (const proof of question.proof) b.edge(question.id, proof.evidenceId, 'supported_by');
    }
  }

  // A living estimate on every live workstream, and the certified reports beside it.
  for (const key of live) {
    const qa = quickAssessment(project, key);
    const id = `${pid}::qa::${key}`;
    b.node('quick_assessment', id, qa.headline, `${QUICK_VERDICT_LABEL[qa.verdict]}${qa.rough ? ' · rough' : ''}`, { key, status: qa.verdict });
    b.edge(id, wsId(key), 'assesses');
  }
  for (const report of project.certifiedReports ?? []) {
    const status = report.status === 'superseded' ? 'superseded' : report.revisit && !report.revisit.acknowledgedAt ? 'revisit' : 'current';
    b.node('certified_report', report.id, report.title, `${report.signer.name}, ${report.signer.profession}`, { key: report.workstream, status });
    b.edge(report.id, report.evidenceId, 'supported_by');
    inStage(report.id, report.issuedOn ? `${report.issuedOn}T12:00:00.000Z` : report.createdAt);
  }

  // Engagements draw on workstreams and deliver reports.
  for (const engagement of project.engagements ?? []) {
    b.node('engagement', engagement.id, engagement.title, engagement.client ? `For ${engagement.client}` : undefined, { key: engagement.kind, status: engagement.stage });
    inStage(engagement.id, engagement.createdAt);
    for (const reportId of engagement.reportIds) b.edge(engagement.id, reportId, 'delivers');
  }

  /*
   * People, by the role they hold in each department.
   *
   * A role is said by its own department ("Signer, Design") and joins the
   * person to that department's node. Design has no node of its own: its
   * work is drawn as a function of Engineering, and a role in Design is not
   * a role in Engineering. Drawing it as one would name Design's signer as
   * answering for the site record, and make a person who only reads
   * Engineering its lead. So a role in Design draws no edge, as a role in a
   * department that is switched off draws none. A person left with no edge
   * is tied to the project at the end, like any record nothing places.
   */
  for (const member of project.team ?? []) {
    const id = `${pid}::member::${member.email.toLowerCase()}`;
    const roles = Object.entries(member.departments) as Array<[DepartmentKey, DepartmentRole]>;
    b.node('member', id, member.name || member.email, roles.map(([d, r]) => `${DEPARTMENT_ROLE_LABEL[r]}, ${DEPARTMENT_SHORT[d] ?? d}`).join(' · ') || undefined, member.signer ? { status: 'signer' } : undefined);
    for (const [dept, role] of roles) {
      if (enabled.includes(dept) && menuDepartment(dept) === dept) b.edge(id, deptId(dept), ROLE_EDGE[role]);
    }
  }

  /*
   * The links between departments: the system's own and those people drew.
   * `linkEdge` says which way round each is drawn and by which relation.
   *
   * A link is drawn only when both its ends are nodes and the relation may
   * join the kinds those nodes really are. `addLink` refuses a link that
   * could not be, but a link is a stored record and the refusal is newer
   * than some of them: one taken before it existed, or one whose end was a
   * document's id sent as a certified report's, is still on the file. It is
   * left out here, so nothing stored can put an edge in the graph that the
   * ontology forbids. Every node a link can name has been written by now.
   */
  for (const link of projectLinks(project)) {
    const edge = linkEdge(link);
    const from = linkEndId(project, edge.from);
    const to = linkEndId(project, edge.to);
    const fromKind = b.kindOf(from);
    const toKind = b.kindOf(to);
    if (fromKind && toKind && projectEdgeEndpointsValid(edge.rel, fromKind, toKind)) b.edge(from, to, edge.rel);
  }
}

/**
 * One line of a bill, as its node says it: the bill it is on and the work
 * package it prices, what it claims, with the quantity and the rate where the
 * bill gives them, what was passed for it, by whom and why, and the page or
 * the cell it was read from.
 *
 * What was passed is said as certified only where the bill's certificate
 * stands. Before one is issued, and after it was withdrawn, the same decision
 * is passed and no more, and the line says there is no certificate.
 *
 * Each person keeps the verb that is theirs. Whoever decided the line passed
 * it; the certificate was signed by its signer, who is named on the
 * certificate and may be somebody else. So a certified line reads "certified
 * ₹2,00,000, passed by junior@firm.in", never "certified by" the person who
 * only passed it.
 *
 * A model's reading of a page says that it is one, as a model's reading of a
 * photograph does: the figures are what the model made of the page until a
 * certifier has been through them.
 */
function billLineDetail(line: BillLine, sits: { bill: string; workPackage?: string; certified: boolean }, money: (amount: number) => string): string {
  const unit = line.unit ? ` ${line.unit}` : '';
  const rate = line.rate === undefined ? '' : `${money(line.rate)}${line.unit ? ` per ${line.unit}` : ''}`;
  const quantity = line.quantityToDate === undefined ? '' : `${line.quantityToDate.toLocaleString('en-IN')}${unit} to date`;
  const passed = line.certified;
  const decision = !passed
    ? 'not yet decided'
    : [
        `${sits.certified ? 'certified' : 'passed'} ${money(passed.amount)}`,
        passed.quantity === undefined ? '' : ` for ${passed.quantity.toLocaleString('en-IN')}${unit}`,
        sits.certified ? `, passed by ${passed.by}` : ` by ${passed.by}, no certificate`,
        passed.note ? `: ${passed.note.slice(0, 160)}` : '',
      ].join('');
  return [
    sits.bill,
    sits.workPackage ? `work package ${sits.workPackage}` : '',
    `claimed ${money(line.amount)}`,
    quantity && rate ? `${quantity} at ${rate}` : quantity || (rate ? `rate ${rate}` : ''),
    line.amountToDate === undefined ? '' : `amount to date ${money(line.amountToDate)}`,
    line.previousAmount === undefined ? '' : `previously ${money(line.previousAmount)}`,
    decision,
    [line.source ? costSourceSaid(line.source) : '', line.readBy === 'model' ? 'read by a model' : ''].filter(Boolean).join(', '),
    line.variation ? 'variation' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

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
        // What the diagram shows when a line is pointed at. The relation in
        // plain words, said of the end the line leaves: "passed the land to",
        // not the key with its underscores taken out.
        label: PROJECT_EDGE_LABEL[e.rel].forward,
        // Every edge here came out of the projection rather than a document
        // read, so there is nothing to cite and nothing to be less than sure
        // about. Claiming a confidence below 1 would invent a doubt.
        assertedBy: [],
        confidence: 1,
      })),
  };
}
