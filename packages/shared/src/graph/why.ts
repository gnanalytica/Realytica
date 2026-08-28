/**
 * "Why do we say that?" — as a traversal.
 *
 * `trace` walks the EVIDENCE behind a conclusion: the documents, the facts,
 * the checks. This walks the DELIBERATION around it — the questions asked, the
 * answers given, what an agent looked at before answering, which gaps were
 * proposed as routes to closing it, and what external research bore on it.
 *
 * They are separate calls on purpose. Evidence is what a conclusion RESTS on
 * and belongs in a report; deliberation is how we got there and belongs in an
 * audit trail. Merging them would put a chat message and a registered deed in
 * one list, and the whole one-way rule exists to keep those distinguishable.
 *
 * A reason found here is never support. `cites` runs from deliberation to
 * fact, so this walks it BACKWARDS — from a fact to the reasoning that
 * mentioned it — which is exactly why the edge direction is enforced at
 * construction: reversed, this function would be returning things a
 * conclusion depends on rather than things that discussed it.
 */

import type { DdEdge, DdGraph, DdNode } from './dd-graph';

/** How a deliberation node came to be attached to the subject. */
export type WhyRelation =
  /** It cited the subject directly. */
  | 'cited'
  /** It cited something the subject rests on. */
  | 'cited_support'
  /** It followed from another deliberation node that did. */
  | 'followed';

export interface WhyStep {
  node: DdNode;
  relation: WhyRelation;
  /** Hops from the subject. Lower is more directly about it. */
  distance: number;
}

export interface WhyResult {
  subject: DdNode;
  /** Ordered: closest and earliest first, so a reader gets the reasoning in sequence. */
  steps: WhyStep[];
  edges: DdEdge[];
  /**
   * True when nothing in the record discusses this at all.
   *
   * Reported rather than returned as an empty list, because "nobody wrote down
   * why" and "we have not indexed it" look identical to a caller and mean
   * completely different things to a reader.
   */
  undiscussed: boolean;
}

/** Edges that carry "this rests on that", used to reach one hop of support. */
const SUPPORT_KINDS: DdEdge['kind'][] = ['evidences', 'asserts', 'derives_from', 'produces'];

/** Edges joining one deliberation node to another. */
const SEQUENCE_KINDS: DdEdge['kind'][] = ['follows', 'answered_by'];

function timeOf(node: DdNode): string {
  const at = node.attributes.at ?? node.attributes.retrievedAt ?? node.attributes.attemptedAt;
  return typeof at === 'string' ? at : '';
}

/**
 * The reasoning that bears on one node.
 *
 * `depth` is how far to follow the deliberation chain once it is reached — 1
 * is "what mentioned this", 2 also picks up the answer that followed the
 * question, and so on. It is bounded because a long conversation is a
 * connected component: without a limit, asking why about anything returns the
 * entire chat.
 */
export function why(graph: DdGraph, nodeId: string, depth = 2): WhyResult | undefined {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const subject = byId.get(nodeId);
  if (!subject) return undefined;

  const steps = new Map<string, WhyStep>();
  const edges = new Set<DdEdge>();

  const consider = (node: DdNode | undefined, relation: WhyRelation, distance: number): void => {
    if (!node || node.id === nodeId || node.layer !== 'deliberation') return;
    const existing = steps.get(node.id);
    // Keep the closest account of how it is attached: a node that both cited
    // the subject and followed something else is best described as having
    // cited it.
    if (existing && existing.distance <= distance) return;
    steps.set(node.id, { node, relation, distance });
  };

  // One hop of support first, so "why do we say the khata is clear" reaches
  // the discussion of the register search it rests on, not only the discussion
  // of the conclusion itself.
  const supports = new Set<string>([nodeId]);
  for (const edge of graph.edges) {
    if (SUPPORT_KINDS.includes(edge.kind) && edge.toNodeId === nodeId) supports.add(edge.fromNodeId);
  }

  for (const edge of graph.edges) {
    if (edge.kind !== 'cites' || !supports.has(edge.toNodeId)) continue;
    edges.add(edge);
    consider(byId.get(edge.fromNodeId), edge.toNodeId === nodeId ? 'cited' : 'cited_support', 1);
  }

  // Then the conversation around whatever was found, bounded.
  for (let distance = 2; distance <= depth; distance += 1) {
    const frontier = [...steps.values()].filter(s => s.distance === distance - 1).map(s => s.node.id);
    if (frontier.length === 0) break;
    for (const edge of graph.edges) {
      if (!SEQUENCE_KINDS.includes(edge.kind)) continue;
      if (frontier.includes(edge.fromNodeId)) {
        edges.add(edge);
        consider(byId.get(edge.toNodeId), 'followed', distance);
      }
      if (frontier.includes(edge.toNodeId)) {
        edges.add(edge);
        consider(byId.get(edge.fromNodeId), 'followed', distance);
      }
    }
  }

  const ordered = [...steps.values()].sort(
    (a, b) => a.distance - b.distance || timeOf(a.node).localeCompare(timeOf(b.node)) || a.node.id.localeCompare(b.node.id),
  );

  return { subject, steps: ordered, edges: [...edges], undiscussed: ordered.length === 0 };
}

/**
 * `why` as text for a model, in the shape the copilot's other tools use.
 *
 * Says so explicitly when nothing discussed the node. A model handed an empty
 * list will fill the silence; handed a sentence saying the record is silent,
 * it can pass that on — which is the honest answer and the one a reviewer
 * needs.
 */
export function serializeWhy(result: WhyResult): string {
  const head = `Subject: [${result.subject.id}] ${result.subject.kind} — ${result.subject.label}`;
  if (result.undiscussed) {
    return `${head}\n\nNothing in the case record discusses this. It has evidence behind it (see trace_conclusion) but no recorded reasoning — say so rather than inventing a rationale.`;
  }
  const lines = result.steps.map(s => {
    const when = timeOf(s.node);
    const relation = s.relation === 'cited' ? 'about it' : s.relation === 'cited_support' ? 'about its support' : 'in the same thread';
    return `- [${s.node.id}] ${s.node.kind} (${relation}${when ? `, ${when}` : ''}): ${s.node.label}`;
  });
  return `${head}\n\nRecorded reasoning, closest first:\n${lines.join('\n')}`;
}
