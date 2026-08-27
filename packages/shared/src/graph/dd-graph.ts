/**
 * The DD evidence graph: four layers over the title graph.
 *
 * The title graph answers one domain's question — who owns this parcel and
 * how do we know. This module widens the same machinery to the whole
 * engagement: entities (what exists), evidence (what we hold), claims (what
 * the evidence says) and judgements (what we conclude), with a closed edge
 * vocabulary joining them. It is the FigJam evidence-graph board —
 * Document -> Fact -> Check -> Finding -> Risk -> Action — as a data
 * structure the copilot can traverse instead of being fed everything.
 *
 * Three decisions carry the design:
 *
 * - **It is a projection, never a second store.** `buildDdGraph` derives the
 *   whole graph from the case's existing stores on every call, exactly as
 *   `buildTitleGraph` does — same inputs, byte-identical graph. Nothing is
 *   persisted, so nothing can drift out of sync with the stores it reads.
 *
 * - **Claim nodes ARE the evidence ledger.** A fact node's id is the ledger
 *   item's own id, so the copilot's existing `[ev:...]` citations are
 *   already graph node ids. One citation currency, not two.
 *
 * - **Only accepted judgements enter the graph.** A proposed technical
 *   finding is a draft awaiting review, and a graph that carried it would
 *   present an unreviewed model claim as case truth — the exact thing the
 *   review discipline exists to prevent. Rejected findings likewise stay
 *   out.
 */

import type { EvidenceItem, PropertyCase, TitleEdgeKind, TitleGraph, TitleNodeKind } from '../types';
import { buildTitleGraph } from './build';
import { detectContradictions } from './contradictions';
import { stableDigest } from './ontology';
import { domainForCheck, domainForRiskCategory, domainForSystem, domainsForDocumentKind } from '../dd-domains';
import type { DdDomain } from '../dd-domains';

/* ==================================================================== */
/* The closed vocabulary                                                 */
/* ==================================================================== */

export type DdLayer = 'entity' | 'evidence' | 'claim' | 'judgement';

export type DdNodeKind =
  | TitleNodeKind // party | parcel | instrument | authority | encumbrance | approval — all entities
  | 'zone'
  | 'asset_system'
  | 'document'
  | 'photo'
  | 'fact'
  | 'contradiction'
  | 'check'
  | 'finding'
  | 'risk'
  | 'action';

export type DdEdgeKind =
  | TitleEdgeKind // carried through verbatim from the title graph
  /** evidence -> claim: the document/photo that says so. */
  | 'asserts'
  /** claim | judgement | photo -> entity: what it is about. */
  | 'about'
  /** evidence | claim -> judgement: what supports the conclusion. */
  | 'evidences'
  /** finding | photo -> zone: where on the property. */
  | 'located_in'
  /** check -> judgement it produced (risks, via the pack's own relatedRiskIds). */
  | 'produces'
  /** action -> risk it mitigates. */
  | 'mitigates'
  /** contradiction -> each node involved in the disagreement. */
  | 'contradicts'
  /** finding -> approval/document it departs from (approved vs as-built). */
  | 'deviates_from';

const LAYER_BY_KIND: Record<DdNodeKind, DdLayer> = {
  party: 'entity',
  parcel: 'entity',
  instrument: 'entity',
  authority: 'entity',
  encumbrance: 'entity',
  approval: 'entity',
  zone: 'entity',
  asset_system: 'entity',
  document: 'evidence',
  photo: 'evidence',
  fact: 'claim',
  contradiction: 'claim',
  check: 'judgement',
  finding: 'judgement',
  risk: 'judgement',
  action: 'judgement',
};

export function ddLayerFor(kind: DdNodeKind): DdLayer {
  return LAYER_BY_KIND[kind];
}

export interface DdNode {
  id: string;
  kind: DdNodeKind;
  layer: DdLayer;
  label: string;
  domain?: DdDomain;
  attributes: Record<string, string | number | boolean>;
}

export interface DdEdge {
  id: string;
  kind: DdEdgeKind;
  fromNodeId: string;
  toNodeId: string;
  label: string;
}

export interface DdGraph {
  caseId: string;
  builtAt: string;
  nodes: DdNode[];
  edges: DdEdge[];
}

/* ==================================================================== */
/* Construction                                                          */
/* ==================================================================== */

function mintId(kind: DdNodeKind, discriminator: string): string {
  return `dd-${kind}-${stableDigest(`${kind}|${discriminator}`, 8)}`;
}

function mintEdgeId(kind: DdEdgeKind, from: string, to: string): string {
  return `dde-${kind}-${stableDigest(`${kind}|${from}|${to}`, 10)}`;
}

/** "Basement 2, DG room" and "basement 2 dg room" are one zone. */
function zoneMergeKey(zone: string): string {
  return zone.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function buildDdGraph(propertyCase: PropertyCase, now: string): DdGraph {
  const nodes = new Map<string, DdNode>();
  const edges = new Map<string, DdEdge>();

  const addNode = (node: DdNode): DdNode => {
    const existing = nodes.get(node.id);
    if (existing) return existing;
    nodes.set(node.id, node);
    return node;
  };
  const addEdge = (kind: DdEdgeKind, fromNodeId: string, toNodeId: string, label: string): void => {
    // An edge naming a node the graph does not hold is a fabricated
    // connection — dropped rather than stored, same rule as the title
    // graph's proposal validator.
    if (!nodes.has(fromNodeId) || !nodes.has(toNodeId)) return;
    const id = mintEdgeId(kind, fromNodeId, toNodeId);
    if (!edges.has(id)) edges.set(id, { id, kind, fromNodeId, toNodeId, label });
  };

  /* -- Layer 1: the title graph, carried through whole ----------------- */

  const titleGraph: TitleGraph = buildTitleGraph(propertyCase, now);
  for (const node of titleGraph.nodes) {
    addNode({
      id: node.id,
      kind: node.kind,
      layer: 'entity',
      label: node.label,
      attributes: { ...node.attributes },
    });
  }

  /* -- Layer 2: evidence — documents and photos ------------------------ */

  const documentNodeId = new Map<string, string>();
  for (const doc of propertyCase.documents) {
    const kind: DdNodeKind = doc.kind === 'photograph' ? 'photo' : 'document';
    const id = mintId(kind, doc.id);
    documentNodeId.set(doc.id, id);
    const domains = domainsForDocumentKind(doc.kind);
    // A photo captured against an asset system belongs to that system's
    // domain, not to the generic photograph bucket — the capture statement
    // is more specific than the file kind.
    const domain = doc.captureSystem ? domainForSystem(doc.captureSystem) : domains[0];
    addNode({
      id,
      kind,
      layer: 'evidence',
      label: doc.fileName,
      domain,
      attributes: {
        documentId: doc.id,
        documentKind: doc.kind,
        uploadedAt: doc.uploadedAt,
        domains: domains.join(','),
        ...(doc.captureZone ? { captureZone: doc.captureZone } : {}),
        ...(doc.captureSystem ? { captureSystem: doc.captureSystem } : {}),
      },
    });
    // Capture-time mapping: the photo arrives already connected to where it
    // was taken and what it looks at — the design doc's "capture at the
    // point of truth". Zone nodes merge on the same normalised key the
    // findings use, so "Basement 2, DG room" said twice is one place.
    if (doc.captureZone) {
      const zoneKey = zoneMergeKey(doc.captureZone);
      const zoneId = mintId('zone', zoneKey);
      addNode({ id: zoneId, kind: 'zone', layer: 'entity', label: doc.captureZone, attributes: { mergeKey: zoneKey } });
      addEdge('located_in', id, zoneId, 'captured in');
    }
    if (doc.captureSystem) {
      const systemId = mintId('asset_system', doc.captureSystem);
      addNode({ id: systemId, kind: 'asset_system', layer: 'entity', label: doc.captureSystem, attributes: { system: doc.captureSystem } });
      addEdge('about', id, systemId, 'shows');
    }
  }

  // Title edges only after evidence exists, because instrument nodes carry
  // their documentId and the `evidences` join below reads the same map.
  for (const edge of titleGraph.edges) {
    addEdge(edge.kind, edge.fromNodeId, edge.toNodeId, edge.label);
  }
  for (const node of titleGraph.nodes) {
    const docId = node.attributes.documentId;
    if (typeof docId === 'string') {
      const evidenceId = documentNodeId.get(docId);
      if (evidenceId) addEdge('evidences', evidenceId, node.id, 'source file of');
    }
  }

  /* -- Layer 3: claims — the evidence ledger, plus contradictions ------ */

  // The primary land parcel, for `about` edges. Linked only when the graph
  // holds exactly one — guessing which of two parcels a ledger line is
  // about would be inventing a connection.
  const landParcels = titleGraph.nodes.filter(n => n.kind === 'parcel' && n.attributes.subject === 'land');
  const primaryParcelId = landParcels.length === 1 ? landParcels[0].id : undefined;

  const ledger: EvidenceItem[] = propertyCase.result?.evidence ?? [];
  for (const item of ledger) {
    addNode({
      id: item.id, // the ledger id IS the node id — one citation currency
      kind: 'fact',
      layer: 'claim',
      label: item.statement,
      attributes: {
        sourceType: item.sourceType,
        sourceRef: item.sourceRef,
        sourceLabel: item.sourceLabel,
        confidence: item.confidence,
        capturedAt: item.capturedAt,
      },
    });
    const evidenceId = documentNodeId.get(item.sourceRef);
    if (evidenceId) addEdge('asserts', evidenceId, item.id, 'asserts');
    if (primaryParcelId) addEdge('about', item.id, primaryParcelId, 'about');
  }

  for (const contradiction of detectContradictions(titleGraph, propertyCase)) {
    addNode({
      id: contradiction.id,
      kind: 'contradiction',
      layer: 'claim',
      label: contradiction.statement,
      attributes: { subject: contradiction.subject, severity: contradiction.severity, contradictionKind: contradiction.kind },
    });
    for (const claim of contradiction.claims) {
      const evidenceId = documentNodeId.get(claim.sourceRef);
      if (evidenceId) addEdge('contradicts', contradiction.id, evidenceId, `disagrees: ${claim.value}${claim.unit ? ` ${claim.unit}` : ''}`);
    }
    if (primaryParcelId) addEdge('about', contradiction.id, primaryParcelId, 'about');
  }

  /* -- Layer 4: judgements — checks, findings, risks, actions ---------- */

  for (const check of propertyCase.result?.stateCompliance?.checks ?? []) {
    const id = mintId('check', check.key);
    addNode({
      id,
      kind: 'check',
      layer: 'judgement',
      label: check.label,
      domain: domainForCheck(check.key),
      attributes: { checkKey: check.key, verdict: check.verdict, headline: check.headline },
    });
    for (const evId of check.evidenceIds) addEdge('evidences', evId, id, 'evidences');
    if (primaryParcelId) addEdge('about', id, primaryParcelId, 'about');
  }

  for (const risk of propertyCase.result?.risks ?? []) {
    addNode({
      id: risk.id,
      kind: 'risk',
      layer: 'judgement',
      label: risk.title,
      domain: domainForRiskCategory(risk.category),
      attributes: { severity: risk.severity, status: risk.status, category: risk.category },
    });
    for (const evId of risk.evidenceIds) addEdge('evidences', evId, risk.id, 'evidences');
  }
  // The pack's own check->risk links, addable only once both ends exist.
  for (const check of propertyCase.result?.stateCompliance?.checks ?? []) {
    for (const riskId of check.relatedRiskIds) addEdge('produces', mintId('check', check.key), riskId, 'produces');
  }

  for (const action of propertyCase.result?.actions ?? []) {
    addNode({
      id: action.id,
      kind: 'action',
      layer: 'judgement',
      label: action.title,
      domain: 'risk',
      attributes: { priority: action.priority, owner: action.owner, done: action.done },
    });
    for (const riskId of action.relatedRiskIds) addEdge('mitigates', action.id, riskId, 'mitigates');
  }

  // Technical findings: accepted only — a proposal is not case truth yet.
  const approvalNodes = titleGraph.nodes.filter(n => n.kind === 'approval');
  for (const finding of (propertyCase.technicalFindings ?? []).filter(f => f.reviewState === 'accepted')) {
    const id = mintId('finding', finding.id);
    const zoneKey = zoneMergeKey(finding.zone);
    const zoneId = mintId('zone', zoneKey);
    addNode({ id: zoneId, kind: 'zone', layer: 'entity', label: finding.zone, attributes: { mergeKey: zoneKey } });
    const systemId = mintId('asset_system', finding.system);
    addNode({ id: systemId, kind: 'asset_system', layer: 'entity', label: finding.system, attributes: { system: finding.system } });
    addNode({
      id,
      kind: 'finding',
      layer: 'judgement',
      label: finding.observation,
      domain: domainForSystem(finding.system),
      attributes: {
        findingId: finding.id,
        severity: finding.severity,
        status: finding.status,
        recommendation: finding.recommendation,
        ...(finding.codeCitation ? { codeCitation: finding.codeCitation } : {}),
        ...(finding.estimatedCost !== undefined ? { estimatedCost: finding.estimatedCost } : {}),
        ...(finding.owner ? { owner: finding.owner } : {}),
      },
    });
    addEdge('located_in', id, zoneId, 'located in');
    addEdge('about', id, systemId, 'about');
    for (const docId of finding.evidenceDocumentIds) {
      const evidenceId = documentNodeId.get(docId);
      if (evidenceId) addEdge('evidences', evidenceId, id, 'evidences');
    }
    if (finding.deviatesFromApproved) {
      // The approved-vs-as-built edge: to the approval node when the title
      // graph holds one, else to the sanctioned-plan document if on file.
      const target =
        approvalNodes[0]?.id ??
        propertyCase.documents
          .filter(d => d.kind === 'approved_building_plan' || d.kind === 'sanctioned_plan_bbmp')
          .map(d => documentNodeId.get(d.id))
          .find((n): n is string => n !== undefined);
      if (target) addEdge('deviates_from', id, target, 'deviates from');
    }
  }

  return { caseId: propertyCase.id, builtAt: now, nodes: [...nodes.values()], edges: [...edges.values()] };
}

/* ==================================================================== */
/* Traversal — trace and subgraph                                        */
/* ==================================================================== */

export interface DdSubgraph {
  nodes: DdNode[];
  edges: DdEdge[];
}

/** The edge kinds that carry "how do we know this", walked backward from a conclusion. */
const DERIVATION_KINDS: DdEdgeKind[] = ['evidences', 'asserts', 'produces'];

/**
 * The derivation cone of one node: everything that supports it, down to the
 * evidence files — the RISK domain's own rule ("every conclusion must trace
 * back to evidence and check") as a query. Includes one hop of `about` and
 * `located_in` context so the trace names what and where, and any
 * contradiction touching a node in the cone, because a trace that hides a
 * live disagreement would be a clean-looking lie.
 */
export function trace(graph: DdGraph, nodeId: string): DdSubgraph | undefined {
  if (!graph.nodes.some(n => n.id === nodeId)) return undefined;
  const keepNodes = new Set<string>([nodeId]);
  const keepEdges = new Set<string>();

  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of graph.edges) {
      if (edge.toNodeId !== current || !DERIVATION_KINDS.includes(edge.kind)) continue;
      keepEdges.add(edge.id);
      if (!keepNodes.has(edge.fromNodeId)) {
        keepNodes.add(edge.fromNodeId);
        queue.push(edge.fromNodeId);
      }
    }
  }

  for (const edge of graph.edges) {
    if ((edge.kind === 'about' || edge.kind === 'located_in' || edge.kind === 'deviates_from') && keepNodes.has(edge.fromNodeId)) {
      keepEdges.add(edge.id);
      keepNodes.add(edge.toNodeId);
    }
    if (edge.kind === 'contradicts' && keepNodes.has(edge.toNodeId)) {
      keepEdges.add(edge.id);
      keepNodes.add(edge.fromNodeId);
    }
  }

  return {
    nodes: graph.nodes.filter(n => keepNodes.has(n.id)),
    edges: graph.edges.filter(e => keepEdges.has(e.id)),
  };
}

/**
 * The neighbourhood of a set of seed nodes: k undirected hops, then every
 * contradiction and every open blocker/critical judgement adjacent to what
 * was collected — the two kinds of node a question's context must never
 * silently omit, whatever the question was.
 */
export function subgraph(graph: DdGraph, seedIds: string[], hops: number): DdSubgraph {
  const keepNodes = new Set<string>(seedIds.filter(id => graph.nodes.some(n => n.id === id)));
  let frontier = new Set(keepNodes);

  for (let hop = 0; hop < hops; hop += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (frontier.has(edge.fromNodeId) && !keepNodes.has(edge.toNodeId)) next.add(edge.toNodeId);
      if (frontier.has(edge.toNodeId) && !keepNodes.has(edge.fromNodeId)) next.add(edge.fromNodeId);
    }
    for (const id of next) keepNodes.add(id);
    frontier = next;
    if (frontier.size === 0) break;
  }

  const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
  for (const edge of graph.edges) {
    const from = nodeById.get(edge.fromNodeId);
    const to = nodeById.get(edge.toNodeId);
    if (!from || !to) continue;
    const touching = keepNodes.has(edge.fromNodeId) || keepNodes.has(edge.toNodeId);
    if (!touching) continue;
    const alarming = (n: DdNode): boolean =>
      n.kind === 'contradiction' ||
      (n.layer === 'judgement' && (n.attributes.verdict === 'blocker' || (n.attributes.severity === 'critical' && n.attributes.status === 'open')));
    if (alarming(from)) keepNodes.add(from.id);
    if (alarming(to)) keepNodes.add(to.id);
  }

  return {
    nodes: graph.nodes.filter(n => keepNodes.has(n.id)),
    edges: graph.edges.filter(e => keepNodes.has(e.fromNodeId) && keepNodes.has(e.toNodeId)),
  };
}

/** Case-insensitive label/id search — how a question's words become seed nodes. */
export function findNodes(graph: DdGraph, query: string): DdNode[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  return graph.nodes.filter(n => n.id.toLowerCase() === needle || n.label.toLowerCase().includes(needle));
}

/**
 * A subgraph as compact prompt text: one line per node, one per edge, every
 * line carrying the id the model must cite. This is the "graph as context"
 * serialisation — triples, not documents.
 */
export function serializeSubgraph(sub: DdSubgraph): string {
  const lines: string[] = [];
  for (const node of sub.nodes) {
    const domain = node.domain ? ` domain=${node.domain}` : '';
    const extras = ['severity', 'verdict', 'status', 'confidence', 'estimatedCost']
      .filter(key => node.attributes[key] !== undefined)
      .map(key => `${key}=${node.attributes[key]}`)
      .join(' ');
    lines.push(`[${node.id}] ${node.kind}${domain}: ${node.label}${extras ? ` (${extras})` : ''}`);
  }
  for (const edge of sub.edges) {
    lines.push(`[${edge.fromNodeId}] -${edge.kind}-> [${edge.toNodeId}]`);
  }
  return lines.join('\n');
}
