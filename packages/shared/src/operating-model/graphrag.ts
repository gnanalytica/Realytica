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

import { buildProjectGraph } from './project-graph';
import { PROJECT_EDGE_LABEL, isProjectEdgeKind, projectEdgePhrase, type ProjectGraphEdgeKind } from './project-ontology';
import type { DdProject, ProjectGraphEdge, ProjectGraphNode } from './types';

export interface ProjectGraphView {
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
}

export type ProjectGraphRagSource = 'live' | 'journal' | 'neo4j';

/** How many records a search matched, and how many of them were taken as seeds. */
export interface ProjectSeedCount {
  seeds: number;
  matches: number;
}

const MAX_HOPS = 3;
const MAX_SEEDS = 5;

/**
 * Edges that walk a conclusion down to what it rests on.
 *
 * `uses_evidence` used to sit beside `supported_by` here, which is how the
 * duplication was visible before it was fixed: two names for one relation
 * meant every traversal had to remember both or silently miss half the
 * proof. `about` joined the set when the parcel became a node — what a
 * finding is about is part of what it rests on.
 *
 * `certifies_bill` and `has_line` joined it with the cost register. A
 * certificate rests on the bill it was issued on, and the bill on its lines:
 * the certified figure is the sum of what was passed line by line. So a trace
 * from a certificate goes down to each line and the page it was read from.
 */
const TRACE_TOWARD_EVIDENCE = new Set<ProjectGraphEdgeKind>(['supported_by', 'about', 'certifies_bill', 'has_line']);

/**
 * Edges whose SOURCE is the support (finding → risk, check → finding).
 * Walked backwards, so reaching a parcel pulls in the instruments that
 * convey it — the chain of title is support in exactly this sense.
 */
const TRACE_FROM_SUPPORT = new Set<ProjectGraphEdgeKind>([
  'raises',
  'requires',
  'informs',
  'found',
  'produces',
  'affects',
  'encumbers',
]);

/** Structural parents, one hop of context around a traced node. */
const TRACE_CONTEXT = new Set<ProjectGraphEdgeKind>([
  'has_check',
  'has_scope',
  'assessed_by',
  'targets',
  'has_asset',
  'sited_at',
]);

function isAlarming(node: ProjectGraphNode): boolean {
  const detail = (node.detail ?? '').toLowerCase();
  // "Immediate action" is alarming at ANY severity — it is the separate RICS
  // question of whether somebody could be hurt today, and a medium-severity
  // defect that had to be escalated is exactly the row a pruned subgraph must
  // not drop.
  if (node.kind === 'finding' && detail.includes('immediate action')) return true;
  if (node.kind === 'finding' && (detail.includes('critical') || detail.includes('high'))) return true;
  if (node.kind === 'risk' && detail.includes('critical')) return true;
  if (node.kind === 'check' && (detail.includes('missing_evidence') || detail.includes('non_compliant'))) return true;
  return false;
}

export function clampGraphHops(hops: number): number {
  if (!Number.isFinite(hops)) return 1;
  return Math.max(1, Math.min(MAX_HOPS, Math.trunc(hops)));
}

/**
 * The words that find every node of a kind in the frame, besides the kind's
 * own name: one or many, and for a function the reader's word as well as the
 * record's. The menu calls a workstream a function and the graph keeps the
 * kind `workstream`.
 *
 * The cost register's kinds are here for the same reason. They are asked for
 * in the plural ("the bills"), two of them are two words where the kind is
 * one with an underscore, and a cost consultant says "running bills" and
 * "certificates" for what the record keeps as `bill` and `certification`.
 */
const FRAME_KIND_WORDS: Partial<Record<ProjectGraphNode['kind'], readonly string[]>> = {
  stage: ['stages'],
  department: ['departments'],
  workstream: ['workstreams', 'function', 'functions'],
  work_package: ['work package', 'work packages'],
  contract: ['contracts'],
  bill: ['bills', 'running bill', 'running bills'],
  bill_line: ['bill line', 'bill lines'],
  certification: ['certifications', 'certificates'],
};

/**
 * Case-insensitive id or label search — how a question's words become seeds.
 *
 * A kind's name finds every node of that kind. For the frame, which a person
 * asks for by the words on the page ("stages", "departments", "functions"),
 * and for the cost register ("bills", "work packages"), so do the words in
 * `FRAME_KIND_WORDS`.
 *
 * The names the frame no longer draws are found through the detail of what
 * stands for them: a step on its stage, a department's name in full on the
 * department, Design's workstreams on Design.
 *
 * What is called by the word comes before what only mentions it. A node
 * whose label or kind matches is one the word names; a node matched in its
 * detail alone says the word in passing, as every undecided line of a bill
 * says "no certificate". Only the first few matches are taken as seeds, so
 * in the graph's own order those lines would crowd out the certificate
 * somebody asked for. Each group keeps the order the graph gives it.
 */
export function findProjectNodes(graph: ProjectGraphView, query: string): ProjectGraphNode[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const exact = graph.nodes.filter((n) => n.id.toLowerCase() === needle);
  if (exact.length > 0) return exact;
  const named: ProjectGraphNode[] = [];
  const mentioned: ProjectGraphNode[] = [];
  for (const n of graph.nodes) {
    if (n.label.toLowerCase().includes(needle) || n.kind.toLowerCase() === needle || (FRAME_KIND_WORDS[n.kind]?.includes(needle) ?? false)) named.push(n);
    else if ((n.detail ?? '').toLowerCase().includes(needle)) mentioned.push(n);
  }
  return [...named, ...mentioned];
}

/**
 * The relations a walk crosses only out of a seed.
 *
 * A bill has its lines by the hundred, and a work package is priced by every
 * line of every bill. Crossed freely, two hops from one line reach its bill
 * and then every other line of it, and its package and then every line that
 * prices it: most of the register, to answer a question about one item.
 */
const FROM_A_SEED_ONLY = new Set<ProjectGraphEdgeKind>(['has_line', 'prices']);

/**
 * k undirected hops from the seeds, then every adjacent blocker — a missing-
 * evidence check or a material finding touching the neighbourhood. A subgraph
 * that hid those would look clean and be a lie.
 *
 * A bill's lines come into a neighbourhood as seeds, or straight from a seed:
 * a bill that was asked about brings its own lines, and so does a work
 * package or the paper they were read from. A node the walk only reached on
 * the way brings none. From there `has_line` and `prices` are not crossed,
 * and no relation is crossed into a line, which is how a paper would
 * otherwise hand over every line read from it. A line names its bill and its
 * work package in its own detail, so it says where it sits without them.
 */
export function extractProjectSubgraph(graph: ProjectGraphView, seedIds: string[], hops: number): ProjectGraphView {
  const present = new Set(graph.nodes.map((n) => n.id));
  const keep = new Set(seedIds.filter((id) => present.has(id)));
  let frontier = new Set(keep);
  const depth = clampGraphHops(hops);
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));

  for (let hop = 0; hop < depth; hop += 1) {
    // Only the first step leaves a seed.
    const crossed = (edge: ProjectGraphEdge, far: string): boolean => hop === 0 || (!FROM_A_SEED_ONLY.has(edge.rel) && kindOf.get(far) !== 'bill_line');
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (frontier.has(edge.from) && !keep.has(edge.to) && crossed(edge, edge.to)) next.add(edge.to);
      if (frontier.has(edge.to) && !keep.has(edge.from) && crossed(edge, edge.from)) next.add(edge.from);
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

/**
 * A neighbourhood as the copilot reads it: one line a node, one line a link.
 *
 * A link is written in the relation's plain words, never its key. What the
 * copilot reads it repeats, and "`[chk_1] -supported_by-> [ev_9]`" comes back
 * to a person as "supported_by". The words also carry what a key cannot: a
 * check "still needs" a deed the file is waiting for and "rests on" one it
 * holds, where the key is `supported_by` both times and the copilot would
 * have to work out from a status which it meant.
 *
 * A stored graph can hold a relation this build does not know, written by
 * other code against the same store. It is said as a link and no more.
 *
 * `found` is how the seeds were come by, when a word was searched for. A
 * search takes the first few records that match and no more, and the
 * neighbourhood reads the same whether those were all of them or five of
 * eighty. So where matches were left out the header says how many, and the
 * copilot can narrow the search (a bill's number, a contractor) instead of
 * answering from the five as though they were everything.
 */
export function serializeProjectSubgraph(sub: ProjectGraphView, source: ProjectGraphRagSource = 'live', found?: ProjectSeedCount): string {
  const left = found ? found.matches - found.seeds : 0;
  const cut = found && left > 0 ? ` seeds=${found.seeds} of ${found.matches} matches (${left} more matched and ${left === 1 ? 'is' : 'are'} not here: narrow the search)` : '';
  const lines: string[] = [
    'THIS FILE — register neighbourhood. Not the statute library. Do not treat a reference URL as evidence on this project.',
    `source=${source} nodes=${sub.nodes.length} edges=${sub.edges.length}${cut}`,
  ];
  const byId = new Map(sub.nodes.map((n) => [n.id, n]));
  for (const node of sub.nodes) {
    lines.push(`[${node.id}] ${node.kind}: ${node.label}${node.detail ? ` (${node.detail})` : ''}`);
  }
  for (const edge of sub.edges) {
    const to = byId.get(edge.to);
    const says = isProjectEdgeKind(edge.rel) ? (to ? projectEdgePhrase(edge.rel, 'forward', to) : PROJECT_EDGE_LABEL[edge.rel].forward) : 'is linked to';
    lines.push(`[${edge.from}] ${says} [${edge.to}]`);
  }
  return lines.join('\n');
}

export function projectGraphOf(project: DdProject): ProjectGraphView {
  return buildProjectGraph(project);
}

/**
 * The neighbourhood of what a word finds. `matches` is how many records the
 * word found in all; `seeds` are the first few of them, which is all the
 * neighbourhood was taken around.
 */
export function retrieveProjectNeighbourhood(project: DdProject, query: string, hops = 2): {
  seeds: ProjectGraphNode[];
  matches: number;
  graph: ProjectGraphView;
} {
  const live = projectGraphOf(project);
  const found = findProjectNodes(live, query);
  const seeds = found.slice(0, MAX_SEEDS);
  return { seeds, matches: found.length, graph: extractProjectSubgraph(live, seeds.map((s) => s.id), hops) };
}
