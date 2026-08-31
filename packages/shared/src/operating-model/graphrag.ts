/**
 * Graph retrieval over one DdProject.
 *
 * This is GraphRAG in the sense the design already named: neighbourhood
 * extraction on the file's own graph, not cosine search over PDFs. The
 * project graph is a projection of the registers. A hop from a check reaches
 * its scope, its DD, and the evidence it uses — which is what a sitting
 * needs — without dumping the library or mixing in a statute.
 *
 * Neo4j (when configured) is an index of the same projection. The algorithm
 * here is the source of truth and the journal/Cypher paths must agree with it.
 */

import { buildProjectGraph } from './capabilities';
import { sittingCheckOf, type SittingRef } from './sitting';
import type { DdProject, ProjectGraphEdge, ProjectGraphNode } from './types';

export interface ProjectGraphView {
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
}

export type ProjectGraphRagSource = 'live' | 'journal' | 'neo4j';

const MAX_HOPS = 3;
const MAX_SEEDS = 5;

/** Edges that walk a conclusion down to the papers that support it. */
const TRACE_TOWARD_EVIDENCE = new Set([
  'uses_evidence',
  'supported_by',
]);

/** Edges whose source is the support (finding → risk, check → finding). */
const TRACE_FROM_SUPPORT = new Set([
  'raises',
  'requires',
  'mitigates',
  'informs',
  'found',
  'produces',
]);

/** Structural parents, one hop of context around a traced node. */
const TRACE_CONTEXT = new Set([
  'has_check',
  'has_scope',
  'assessed_by',
  'targets',
]);

function isAlarming(node: ProjectGraphNode): boolean {
  const detail = (node.detail ?? '').toLowerCase();
  if (node.kind === 'finding' && (detail.includes('critical') || detail.includes('high'))) return true;
  if (node.kind === 'risk' && detail.includes('critical')) return true;
  if (node.kind === 'check' && (detail.includes('missing_evidence') || detail.includes('non_compliant'))) return true;
  return false;
}

export function clampGraphHops(hops: number): number {
  if (!Number.isFinite(hops)) return 1;
  return Math.max(1, Math.min(MAX_HOPS, Math.trunc(hops)));
}

/** Case-insensitive id or label search — how a question's words become seeds. */
export function findProjectNodes(graph: ProjectGraphView, query: string): ProjectGraphNode[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const exact = graph.nodes.filter((n) => n.id.toLowerCase() === needle);
  if (exact.length > 0) return exact;
  return graph.nodes.filter(
    (n) =>
      n.label.toLowerCase().includes(needle) ||
      (n.detail ?? '').toLowerCase().includes(needle) ||
      n.kind.toLowerCase() === needle,
  );
}

/**
 * k undirected hops from the seeds, then every adjacent blocker — a missing-
 * evidence check or a material finding touching the neighbourhood. A subgraph
 * that hid those would look clean and be a lie.
 */
export function extractProjectSubgraph(graph: ProjectGraphView, seedIds: string[], hops: number): ProjectGraphView {
  const present = new Set(graph.nodes.map((n) => n.id));
  const keep = new Set(seedIds.filter((id) => present.has(id)));
  let frontier = new Set(keep);
  const depth = clampGraphHops(hops);

  for (let hop = 0; hop < depth; hop += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (frontier.has(edge.from) && !keep.has(edge.to)) next.add(edge.to);
      if (frontier.has(edge.to) && !keep.has(edge.from)) next.add(edge.from);
    }
    for (const id of next) keep.add(id);
    frontier = next;
    if (frontier.size === 0) break;
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const edge of graph.edges) {
    if (!keep.has(edge.from) && !keep.has(edge.to)) continue;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from && isAlarming(from)) keep.add(from.id);
    if (to && isAlarming(to)) keep.add(to.id);
  }

  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}

/**
 * Everything a conclusion rests on, down to evidence. Structural parents are
 * included as context; they are not treated as proof.
 */
export function traceProjectNode(graph: ProjectGraphView, nodeId: string): ProjectGraphView | undefined {
  if (!graph.nodes.some((n) => n.id === nodeId)) return undefined;
  const keepNodes = new Set<string>([nodeId]);
  const keepEdges = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of graph.edges) {
      let other: string | undefined;
      if (edge.from === current && TRACE_TOWARD_EVIDENCE.has(edge.rel)) other = edge.to;
      else if (edge.to === current && TRACE_FROM_SUPPORT.has(edge.rel)) other = edge.from;
      if (!other || keepNodes.has(other)) {
        if (other && keepNodes.has(other)) keepEdges.add(edge.id);
        continue;
      }
      keepEdges.add(edge.id);
      keepNodes.add(other);
      queue.push(other);
    }
  }

  for (const edge of graph.edges) {
    if (!TRACE_CONTEXT.has(edge.rel)) continue;
    if (keepNodes.has(edge.to)) {
      keepEdges.add(edge.id);
      keepNodes.add(edge.from);
    }
  }

  return {
    nodes: graph.nodes.filter((n) => keepNodes.has(n.id)),
    edges: graph.edges.filter((e) => keepEdges.has(e.id) || (keepNodes.has(e.from) && keepNodes.has(e.to) && TRACE_TOWARD_EVIDENCE.has(e.rel))),
  };
}

export function serializeProjectSubgraph(sub: ProjectGraphView, source: ProjectGraphRagSource = 'live'): string {
  const lines: string[] = [
    'THIS FILE — register neighbourhood. Not the statute library. Do not treat a reference URL as evidence on this project.',
    `source=${source} nodes=${sub.nodes.length} edges=${sub.edges.length}`,
  ];
  for (const node of sub.nodes) {
    lines.push(`[${node.id}] ${node.kind}: ${node.label}${node.detail ? ` (${node.detail})` : ''}`);
  }
  for (const edge of sub.edges) {
    lines.push(`[${edge.from}] -${edge.rel}-> [${edge.to}]`);
  }
  return lines.join('\n');
}

export function projectGraphOf(project: DdProject): ProjectGraphView {
  return buildProjectGraph(project);
}

export function retrieveProjectNeighbourhood(project: DdProject, query: string, hops = 2): {
  seeds: ProjectGraphNode[];
  graph: ProjectGraphView;
} {
  const live = projectGraphOf(project);
  const seeds = findProjectNodes(live, query).slice(0, MAX_SEEDS);
  return { seeds, graph: extractProjectSubgraph(live, seeds.map((s) => s.id), hops) };
}

export function retrieveForSitting(project: DdProject, sitting?: SittingRef, hops = 2): ProjectGraphView {
  const live = projectGraphOf(project);
  const seated = sittingCheckOf(project, sitting);
  if (!seated) return extractProjectSubgraph(live, [project.id], hops);
  return extractProjectSubgraph(live, [seated.check.id, seated.scope.id, seated.assessment.id], hops);
}

export const PROJECT_GRAPH_SEED_CAP = MAX_SEEDS;
