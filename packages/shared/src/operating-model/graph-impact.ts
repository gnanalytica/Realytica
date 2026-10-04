/**
 * What a change to one record reaches.
 *
 * Asked of the project graph, not of the registers, because the answer is a
 * walk: a lapsed commencement certificate gates construction progress,
 * progress feeds the as-is value and the cost to complete, and each of those
 * has engagements drawing on it, a certified report standing on it and a lead
 * and a signer answering for it. Neo4j runs the same walk in Cypher; this is
 * the walk over a snapshot, for the local journal and as Neo4j's fallback.
 *
 * The walk goes by kind and relation, never by id or name, so it reads the
 * graph as it is drawn: a `workstream` node is a function of the menu, Design
 * is one of Engineering's, and the people answering for a function are those
 * who lead or sign for the department it is drawn under. A role in Design
 * joins nobody to Engineering, so Design's own signer is never named as
 * answering for Engineering's work.
 */

import type { ProjectGraphEdge, ProjectGraphEdgeKind, ProjectGraphNode } from './types';

export interface GraphImpact {
  node: ProjectGraphNode;
  /** The functions the record sits in. */
  home: ProjectGraphNode[];
  /** Functions reached through gates and feeds, nearest first. */
  downstream: Array<{ node: ProjectGraphNode; hops: number; via: ProjectGraphEdgeKind }>;
  engagements: ProjectGraphNode[];
  certified: ProjectGraphNode[];
  assessments: ProjectGraphNode[];
  people: Array<{ node: ProjectGraphNode; role: 'leads' | 'signs_for'; department: ProjectGraphNode }>;
}

/** How far a dependency is followed. Past three, everything depends on everything. */
export const IMPACT_HOPS = 3;

/** The relations a dependency travels along. */
export const IMPACT_RELATIONS: readonly ProjectGraphEdgeKind[] = ['gates', 'feeds'];

export function graphImpact(snapshot: { nodes: ProjectGraphNode[]; edges: ProjectGraphEdge[] }, nodeId: string): GraphImpact | null {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) return null;
  const open = snapshot.edges.filter((e) => !e.closedAt);
  const into = (id: string, rels: readonly string[]) => open.filter((e) => e.to === id && rels.includes(e.rel)).map((e) => byId.get(e.from)).filter((n): n is ProjectGraphNode => Boolean(n));

  // What rests on it — a check citing a document, an approval resting on its
  // certificate — sits in a function too, and the change reaches that.
  const dependents = into(node.id, ['supported_by', 'advances']);
  const seeds = [node, ...dependents];
  const home = new Map<string, ProjectGraphNode>();
  for (const seed of seeds) {
    if (seed.kind === 'workstream') home.set(seed.id, seed);
    for (const ws of into(seed.id, ['holds'])) if (ws.kind === 'workstream') home.set(ws.id, ws);
  }

  // Downstream along gates and feeds, from the home functions and from any
  // approval among the seeds (an approval gates work directly).
  const starts = [...home.values(), ...seeds.filter((s) => s.kind === 'approval')];
  const reached = new Map<string, { node: ProjectGraphNode; hops: number; via: ProjectGraphEdgeKind }>();
  let frontier = starts.map((s) => s.id);
  for (let hops = 1; hops <= IMPACT_HOPS && frontier.length; hops += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of open) {
        if (e.from !== id || !IMPACT_RELATIONS.includes(e.rel)) continue;
        const to = byId.get(e.to);
        if (!to || to.kind !== 'workstream' || home.has(to.id) || reached.has(to.id)) continue;
        reached.set(to.id, { node: to, hops, via: e.rel });
        next.push(to.id);
      }
    }
    frontier = next;
  }
  const downstream = [...reached.values()].sort((a, b) => a.hops - b.hops || a.node.label.localeCompare(b.node.label));

  const touched = [...home.values(), ...downstream.map((d) => d.node)];
  const unique = (nodes: ProjectGraphNode[]) => [...new Map(nodes.map((n) => [n.id, n])).values()];
  const engagements = unique(touched.flatMap((t) => into(t.id, ['draws_on'])));
  const certified = unique(touched.flatMap((t) => into(t.id, ['certifies']))).filter((n) => n.status !== 'superseded');
  const assessments = unique(touched.flatMap((t) => into(t.id, ['assesses'])));
  const people: GraphImpact['people'] = [];
  const seen = new Set<string>();
  for (const t of touched) {
    for (const dept of into(t.id, ['has_workstream'])) {
      for (const e of open) {
        if (e.to !== dept.id || (e.rel !== 'leads' && e.rel !== 'signs_for')) continue;
        const person = byId.get(e.from);
        const key = `${e.from}|${e.rel}|${dept.id}`;
        if (person && !seen.has(key)) {
          seen.add(key);
          people.push({ node: person, role: e.rel, department: dept });
        }
      }
    }
  }
  return { node, home: [...home.values()], downstream, engagements, certified, assessments, people };
}
