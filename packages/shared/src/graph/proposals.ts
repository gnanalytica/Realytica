/**
 * The seam between a model reading a deed and the graph asserting what it
 * read.
 *
 * A language model is very good at the thing the deterministic builder cannot
 * do — noticing that the recital on page four says Ramaiah conveyed to the
 * society in 1998 — and very capable of being confidently wrong about it. So
 * the model proposes and the builder disposes: nothing a model suggests enters
 * the graph without passing every check below, and a proposal that fails one
 * is kept with its reason rather than dropped.
 *
 * Keeping rejections is not politeness. A model that repeatedly proposes an
 * edge this validator will not accept is itself a finding — either the
 * ontology is missing something real, or the extraction prompt is producing
 * confident nonsense — and neither is visible if failures disappear.
 *
 * The checks run in a fixed order, worst-defect-first, so a proposal that
 * fails several is reported against the most fundamental one. There is no
 * point telling a model its confidence is too low for an edge kind that does
 * not exist.
 */

import type { EdgeProposal, TitleAssertion, TitleEdge, TitleGraph, TitleNode } from '../types';
import {
  TITLE_NODE_KINDS,
  assertTitleGraphIntegrity,
  compareEdges,
  edgeEndpointsValid,
  isTitleEdgeKind,
  mergeKeyFor,
  titleEdgeId,
} from './ontology';

/**
 * The floor a model-proposed edge must clear.
 *
 * Set where it is because the cost of the two errors is asymmetric. A missed
 * edge shows up as a chain break — a visible, actionable finding that sends
 * the user to look for a document. A wrong edge shows up as a chain that
 * appears to join when it does not, which is invisible and is exactly the
 * failure this product exists to prevent. Below 0.6 a proposal is a guess,
 * and a guess in a chain of title is worse than a gap.
 */
export const EDGE_PROPOSAL_CONFIDENCE_FLOOR = 0.6;

/** Indefinite article for a node kind, so a rejection reason reads as English rather than as a template. */
function article(kind: string): string {
  return `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`;
}

/** What a merge key resolved to, and why it did not resolve when it did not. */
type Resolution =
  | { status: 'resolved'; node: TitleNode }
  | { status: 'unknown' }
  | { status: 'ambiguous'; candidates: TitleNode[] };

/**
 * Resolves a proposed merge key onto a node.
 *
 * A model is given the graph's merge keys but will frequently write the
 * human-readable form instead ("Sy. No. 118/2" rather than `118/2`). Rejecting
 * that as an unknown node would be a normalisation failure dressed up as a
 * model failure, so the raw string is also pushed through every kind's
 * normaliser before the proposal is refused.
 */
function resolveMergeKey(nodes: TitleNode[], raw: string): Resolution {
  const trimmed = raw.trim();
  if (trimmed === '') return { status: 'unknown' };

  const byId = new Map<string, TitleNode>();
  for (const node of nodes) {
    if (node.mergeKey === trimmed) byId.set(node.id, node);
  }
  if (byId.size === 0) {
    for (const kind of TITLE_NODE_KINDS) {
      const normalised = mergeKeyFor(kind, trimmed);
      if (normalised === '') continue;
      for (const node of nodes) {
        if (node.kind === kind && node.mergeKey === normalised) byId.set(node.id, node);
      }
    }
  }

  const candidates = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  if (candidates.length === 0) return { status: 'unknown' };
  if (candidates.length > 1) return { status: 'ambiguous', candidates };
  return { status: 'resolved', node: candidates[0] };
}

/**
 * Validates a batch of model-proposed edges against a graph and returns the
 * graph with the accepted ones folded in.
 *
 * Neither argument is mutated: the returned graph is a new object with a new
 * edge array, and the returned proposals are copies carrying their outcome.
 * Callers frequently want to show the rejected proposals next to the graph
 * they did not change, and that is impossible if the inputs were edited in
 * place.
 *
 * The result is re-validated before it is returned. An accepted proposal that
 * somehow broke the ontology would be a bug in this file, and it should fail
 * loudly here rather than quietly downstream in a chain reconstruction.
 */
export function applyEdgeProposals(
  graph: TitleGraph,
  proposals: EdgeProposal[],
  options?: { confidenceFloor?: number },
): { graph: TitleGraph; proposals: EdgeProposal[] } {
  const floor = options?.confidenceFloor ?? EDGE_PROPOSAL_CONFIDENCE_FLOOR;

  // Every source the graph already knows about, so a citation can be checked
  // against reality and an accepted edge can carry a readable source label.
  const sourceLabels = new Map<string, string>();
  for (const node of graph.nodes) for (const a of node.assertedBy) sourceLabels.set(a.sourceRef, a.sourceLabel);
  for (const edge of graph.edges) for (const a of edge.assertedBy) sourceLabels.set(a.sourceRef, a.sourceLabel);

  const accepted: TitleEdge[] = [];
  // Keyed on (kind, from, to) rather than on edge id, because an
  // `asserts_area` edge the builder discriminated by field key would
  // otherwise slip past as a new edge when it is the same assertion again.
  const existingPairs = new Set(graph.edges.map(e => `${e.kind}|${e.fromNodeId}|${e.toNodeId}`));

  const reviewed: EdgeProposal[] = proposals.map(proposal => {
    const reject = (outcome: EdgeProposal['outcome'], rejectionReason: string): EdgeProposal => ({
      ...proposal,
      outcome,
      rejectionReason,
    });

    /* 1. Is this an edge kind the ontology has at all? */
    if (!isTitleEdgeKind(proposal.kind)) {
      return reject(
        'rejected_invalid_kind',
        `'${String(proposal.kind)}' is not one of the closed set of title edge kinds. The ontology is fixed; a relationship it cannot express is not stored under a nearby kind.`,
      );
    }

    /* 2. Does it cite a document this case actually holds? */
    if (proposal.citedDocumentIds.length === 0) {
      return reject(
        'rejected_uncited',
        'The proposal cites no document. Every edge in a chain of title has to be traceable to something a reader can open.',
      );
    }
    const knownCitations = proposal.citedDocumentIds.filter(id => sourceLabels.has(id));
    if (knownCitations.length === 0) {
      return reject(
        'rejected_uncited',
        `None of the cited documents (${proposal.citedDocumentIds.join(', ')}) is on this case, so the citation cannot be followed.`,
      );
    }

    /* 3. Is the model confident enough for this to be worth more than a gap? */
    if (!Number.isFinite(proposal.confidence) || proposal.confidence > 1 || proposal.confidence < 0) {
      return reject('rejected_low_confidence', `Confidence ${proposal.confidence} is outside the 0..1 range this contract requires.`);
    }
    if (proposal.confidence < floor) {
      return reject(
        'rejected_low_confidence',
        `Confidence ${proposal.confidence} is below the ${floor} floor for a model-proposed edge. A guess in a chain of title is worse than an admitted gap.`,
      );
    }

    /* 4. Do both ends name nodes this graph has? */
    const from = resolveMergeKey(graph.nodes, proposal.fromMergeKey);
    const to = resolveMergeKey(graph.nodes, proposal.toMergeKey);
    if (from.status !== 'resolved' || to.status !== 'resolved') {
      const describe = (side: string, key: string, resolution: Resolution): string | undefined => {
        if (resolution.status === 'unknown') return `${side} merge key '${key}' does not resolve to any node in this graph`;
        if (resolution.status === 'ambiguous') {
          return `${side} merge key '${key}' is ambiguous — it matches ${resolution.candidates.map(c => `${c.kind} '${c.label}'`).join(' and ')}`;
        }
        return undefined;
      };
      const reasons = [describe('From', proposal.fromMergeKey, from), describe('To', proposal.toMergeKey, to)].filter(Boolean);
      return reject('rejected_unknown_node', `${reasons.join('; ')}. An edge may only join nodes the builder has already established.`);
    }

    /* 5. Is that a relationship these two kinds of thing can have? */
    if (from.node.id === to.node.id) {
      return reject(
        'rejected_invalid_kind',
        `Both merge keys resolve to the same node ('${from.node.label}'), so the proposed ${proposal.kind} edge would assert a relationship between a thing and itself.`,
      );
    }
    if (!edgeEndpointsValid(proposal.kind, from.node.kind, to.node.kind)) {
      return reject(
        'rejected_invalid_kind',
        `'${proposal.kind}' cannot join ${article(from.node.kind)} to ${article(to.node.kind)}. The kind exists, but not between these two things.`,
      );
    }

    /* 6. Does the graph already say this? */
    const pairKey = `${proposal.kind}|${from.node.id}|${to.node.id}`;
    if (existingPairs.has(pairKey)) {
      return { ...proposal, outcome: 'duplicate', rejectionReason: `The graph already asserts ${proposal.kind} from '${from.node.label}' to '${to.node.label}'.` };
    }

    /* 7. Accepted. */
    const citation = knownCitations[0];
    const assertion: TitleAssertion = {
      sourceRef: citation,
      sourceLabel: sourceLabels.get(citation) ?? citation,
      // The document is real and cited, but the *relationship* is the model's
      // reading of it, so the assertion says so.
      sourceType: 'model_inference',
      // Knowledge time is this build: the graph learned it now, whatever the
      // document's own date.
      assertedAt: graph.builtAt,
      confidence: proposal.confidence,
    };
    accepted.push({
      id: titleEdgeId(proposal.kind, from.node.id, to.node.id),
      kind: proposal.kind,
      fromNodeId: from.node.id,
      toNodeId: to.node.id,
      label: `${from.node.label} → ${to.node.label}`,
      validFrom: proposal.validFrom,
      validTo: proposal.validTo,
      assertedBy: [assertion],
      confidence: proposal.confidence,
      attributes: {
        origin: 'model_proposal',
        proposalId: proposal.id,
        rationale: proposal.rationale,
        citedDocumentIds: proposal.citedDocumentIds.join(','),
      },
    });
    existingPairs.add(pairKey);
    return { ...proposal, outcome: 'accepted', rejectionReason: undefined };
  });

  const nextGraph: TitleGraph = {
    ...graph,
    nodes: graph.nodes,
    edges: [...graph.edges, ...accepted].sort(compareEdges),
  };
  assertTitleGraphIntegrity(nextGraph);

  return { graph: nextGraph, proposals: reviewed };
}
