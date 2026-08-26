import type { AgentKind, RetrievalSection, RetrievalSelection, TitleGraph } from '@realytica/shared';
import type { Segment } from './segments';
import { termsOf } from './segments';

/**
 * Budget-constrained selection over a segmented case.
 *
 * Two rules decide what survives.
 *
 * **Nothing essential is ever dropped.** A model given a risk list without the
 * verdict those risks bear on is not working with less context, it is working
 * with misleading context. Cache-stable and essential segments are admitted
 * before the budget is consulted, and if they alone exceed it the budget is
 * reported as overrun rather than quietly enforced by cutting them — an
 * overrun the caller can see beats a silent omission it cannot.
 *
 * **Every omission is recorded.** A bounded context that hides what it left
 * out is worse than an oversized one, because the model answers confidently
 * from a partial picture and nothing downstream knows. `RetrievalSelection`
 * carries `omitted` for exactly this, and the agents surface it.
 */

/**
 * Sections an agent always needs, whatever the focus says.
 *
 * Term matching alone got this wrong in a way worth recording: asked for
 * "comparable rates in Devanahalli", the market-research agent dropped the
 * `comparables` section entirely. Nothing was broken — a dozen individual
 * evidence items matched the same terms at the same score, and being ~50
 * tokens each against the section's ~450 they won the smallest-first
 * tie-break and ate the budget. Relevance scoring will always be vulnerable to
 * that, because a score cannot express "this one is the point".
 *
 * So the sections an agent is definitionally about are declared rather than
 * inferred. This is a short, explicit list per agent; everything else is still
 * ranked and still droppable.
 */
const AGENT_REQUIRED_SECTIONS: Partial<Record<AgentKind, string[]>> = {
  market_research: ['comparables'],
  proof_pathways: ['screen.completeness', 'stateCompliance'],
  diligence_planner: ['screen.actions', 'screen.completeness'],
  planner: ['screen.completeness', 'screen.confidence'],
  critic: ['titleGraph'],
  title_graph: ['titleGraph'],
  analyst_copilot: ['screen.anchors'],
  // Runs before a case exists, so there is nothing to retrieve. Present
  // because the map is exhaustive, empty because the alternative would be
  // pretending it reads a ledger it cannot reach.
  intake_concierge: [],
};

/** Per-agent focus terms, layered on top of whatever the caller asks for. */
const AGENT_FOCUS: Record<AgentKind, string[]> = {
  property_discovery: ['title', 'litigation', 'notification', 'rera', 'developer'],
  orchestrator: [],
  intake_concierge: [],
  planner: ['completeness', 'missing', 'confidence', 'risk', 'verdict'],
  critic: ['evidence', 'claim', 'source', 'citation'],
  explorer: ['locality', 'market', 'source', 'registry'],
  document_intelligence: ['document', 'extracted', 'khata', 'deed', 'survey'],
  proof_pathways: ['missing', 'document', 'authority', 'khata', 'conversion', 'certificate'],
  analyst_copilot: [],
  market_research: ['comparable', 'market', 'locality', 'price', 'trend'],
  diligence_planner: ['action', 'risk', 'owner', 'priority', 'next step'],
  title_graph: ['title', 'deed', 'owner', 'survey', 'extent', 'conveyance', 'khata'],
};

export interface SelectParams {
  segments: Segment[];
  agent: AgentKind;
  /** Free-text focus from the caller — a question, a risk code, a survey number. */
  focus?: string[];
  /** Graph node ids the caller already resolved, e.g. the parcel a question is about. */
  focusNodeIds?: string[];
  graph?: TitleGraph;
  budgetTokens: number;
}

export interface Selection {
  segments: Segment[];
  selection: RetrievalSelection;
}

/**
 * Nodes within one edge-hop of the focus.
 *
 * One hop, not transitive closure: a parcel's instruments and parties are the
 * things a question about that parcel is actually about, whereas the whole
 * connected component of a title graph is the entire case again, which is what
 * retrieval exists to avoid.
 */
function expandOneHop(graph: TitleGraph | undefined, seed: string[]): Set<string> {
  const out = new Set(seed);
  if (!graph || seed.length === 0) return out;
  for (const edge of graph.edges) {
    if (out.has(edge.fromNodeId)) out.add(edge.toNodeId);
    else if (out.has(edge.toNodeId)) out.add(edge.fromNodeId);
  }
  return out;
}

/**
 * Focus terms resolved to graph nodes.
 *
 * Matching node labels alone does not work, and the reason is structural
 * rather than a tuning problem. A khata extract does not become a node — the
 * ontology has no kind for a register record, so it enters as the authority
 * that issued it, with the document on the assertion. Ask "is the khata in
 * the seller's name?" and no node label contains the word "khata", so
 * label-only matching resolved nothing and graph adjacency contributed
 * nothing to any real question.
 *
 * So a term reaches nodes three ways: the node's own label and merge key, its
 * attributes, and — the one that actually fires on a question phrased the way
 * a user phrases it — the documents that assert it. "Khata" matches the khata
 * extract, and the khata extract asserts the parcel and the authority.
 */
function resolveFocusNodes(
  graph: TitleGraph | undefined,
  terms: string[],
  segments: Segment[],
): string[] {
  if (!graph || terms.length === 0) return [];
  const matches = (haystack: string): boolean =>
    terms.some(t => t.length > 2 && haystack.includes(t));

  const hits = new Set<string>();
  for (const node of graph.nodes) {
    const haystack = [node.label, node.mergeKey, ...Object.values(node.attributes).map(String)]
      .join(' ')
      .toLowerCase();
    if (matches(haystack)) hits.add(node.id);
  }

  // Via the documents that assert them. A document segment already carries the
  // node ids its source asserts, and its terms cover the filename, the
  // document kind and every extracted field — which is where the domain
  // vocabulary of a user's question actually lives.
  for (const seg of segments) {
    if (seg.nodeIds.length === 0) continue;
    if (matches(seg.terms.join(' '))) {
      for (const id of seg.nodeIds) hits.add(id);
    }
  }
  return [...hits];
}

/**
 * How well a segment answers the focus, 0..1.
 *
 * Graph adjacency outranks term matching because it is a structural fact
 * rather than a string coincidence: a document that asserts the parcel under
 * discussion is relevant even when it shares no vocabulary with the question.
 * Term matching is the fallback for a case with no graph built yet, and for
 * the sections (costs, planning) that no graph node covers.
 */
function score(segment: Segment, focusNodes: Set<string>, terms: string[]): number {
  let s = 0;
  if (focusNodes.size > 0 && segment.nodeIds.some(id => focusNodes.has(id))) s += 0.7;
  if (terms.length > 0 && segment.terms.length > 0) {
    const matched = terms.filter(t => segment.terms.some(st => st.includes(t) || t.includes(st))).length;
    if (matched > 0) s += Math.min(0.3, 0.1 * matched);
  }
  return Math.min(1, s);
}

function toSection(segment: Segment, reason: string): RetrievalSection {
  return { key: segment.key, label: segment.label, approxTokens: segment.approxTokens, reason };
}

export function selectSegments(params: SelectParams): Selection {
  const { segments, agent, graph, budgetTokens } = params;
  const callerTerms = termsOf(...(params.focus ?? []));
  const terms = [...new Set([...callerTerms, ...AGENT_FOCUS[agent]])].filter(Boolean);

  const seedNodes = [...(params.focusNodeIds ?? []), ...resolveFocusNodes(graph, callerTerms, segments)];
  const focusNodes = expandOneHop(graph, seedNodes);

  const kept: Segment[] = [];
  const included: RetrievalSection[] = [];
  const omitted: RetrievalSection[] = [];
  let spent = 0;

  // Admitted unconditionally, in the order that keeps the prompt-cache prefix
  // byte-identical between calls.
  for (const cls of ['cache_stable', 'essential'] as const) {
    for (const seg of segments.filter(s => s.segmentClass === cls)) {
      kept.push(seg);
      spent += seg.approxTokens;
      included.push(toSection(seg, cls === 'cache_stable' ? 'cache-stable prefix' : 'required by every agent'));
    }
  }

  const required = new Set(AGENT_REQUIRED_SECTIONS[agent] ?? []);
  for (const seg of segments.filter(s => s.segmentClass === 'variable' && required.has(s.key))) {
    kept.push(seg);
    spent += seg.approxTokens;
    included.push(toSection(seg, `required by ${agent}`));
  }

  const ranked = segments
    .filter(s => s.segmentClass === 'variable' && !required.has(s.key))
    .map(s => ({ seg: s, score: score(s, focusNodes, terms) }))
    // Ties broken by size, smallest first: at equal relevance, two cheap
    // segments carry more of the case than one expensive one.
    .sort((a, b) => (b.score - a.score) || (a.seg.approxTokens - b.seg.approxTokens));

  for (const { seg, score: relevance } of ranked) {
    if (spent + seg.approxTokens <= budgetTokens) {
      kept.push(seg);
      spent += seg.approxTokens;
      included.push(toSection(seg, relevance > 0 ? `matched focus (${relevance.toFixed(2)})` : 'included within budget'));
    } else {
      omitted.push(toSection(seg, relevance > 0
        ? `dropped for budget despite matching focus (${relevance.toFixed(2)})`
        : 'dropped for budget'));
    }
  }

  return {
    segments: kept,
    selection: {
      focusNodeIds: [...focusNodes],
      focusLabels: graph
        ? graph.nodes.filter(n => focusNodes.has(n.id)).map(n => n.label)
        : [],
      included,
      omitted,
      approxTokens: spent,
      budgetTokens,
    },
  };
}
