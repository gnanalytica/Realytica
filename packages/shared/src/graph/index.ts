/**
 * The title graph module: construction, chain reconstruction, contradiction
 * detection, counterfactual resolution, model-proposal validation, and the
 * summary the rest of the product reads.
 *
 * Everything here is deterministic and takes its clock as a parameter, in the
 * same style as `runScreen` — the graph feeds the engine, and an engine that
 * is the arithmetic authority cannot be fed a moving input.
 */

export * from './ontology';
export * from './build';
export * from './chain';
export * from './contradictions';
export * from './resolve';
export * from './proposals';
export * from './dd-graph';
export * from './report';

import type {
  ChainBreak,
  EdgeProposal,
  GraphContradiction,
  PropertyCase,
  ResolutionPath,
  RiskSeverity,
  TitleChain,
  TitleGraph,
  TitleGraphSummary,
} from '../types';
import { SEVERITY_WEIGHT, severityRank } from './ontology';
import { buildTitleGraph } from './build';
import { reconstructChains } from './chain';
import { detectContradictions } from './contradictions';
import { resolutionPaths } from './resolve';
import { applyEdgeProposals } from './proposals';

/* ==================================================================== */
/* Integrity score                                                       */
/* ==================================================================== */

/**
 * The hundred points, and what each of them is for.
 *
 * `integrityScore` answers one question — how much of this property's title
 * story do the documents on file actually establish — so it is built from the
 * three things that can prevent a story being established, plus the trivial
 * case of there being no story at all. Every constant below is a share of the
 * whole with a stated reason; none of them is tuned to make a demo case land
 * on a nice number.
 *
 * - **Depth, 40.** The spine. A Karnataka title is examined over thirty
 *   years, and a chain that establishes ten of them has established a third
 *   of what a purchaser's lawyer will ask for. This is the largest single
 *   component because no amount of internal consistency substitutes for it:
 *   a perfectly consistent one-deed file is still an unproved title.
 *
 * - **Unresolved breaks, 25.** Gaps *within* what the documents do cover.
 *   Weighted by severity and saturating, because past a point additional
 *   breaks stop changing the answer — a chain with a critical discontinuity
 *   and a serious one is already not a chain.
 *
 * - **Contradictions, 25.** Sources that cannot both be right. Held equal to
 *   breaks because they are equally disqualifying at the point of sale: an
 *   extent the deed and the khata disagree about will stop a registration as
 *   surely as a missing link will.
 *
 * - **Structure, 10.** Whether the graph has a parcel, a party and an
 *   instrument at all. A file with no named party anywhere has not told us
 *   who owns the property, and that deserves to cost something even when
 *   nothing contradicts anything.
 *
 * `insufficient_depth` breaks are excluded from the break component on
 * purpose: depth is already the first forty points, and counting the same
 * shortfall twice would punish a thin file for being thin in one way.
 */
const DEPTH_POINTS = 40;
const BREAK_POINTS = 25;
const CONTRADICTION_POINTS = 25;
const STRUCTURE_POINTS = 10;

/**
 * The finding weight at which a component is fully spent — one critical
 * finding plus one serious one (8 + 4). Beyond that the title is as unproved
 * as this score can express, and further findings belong in the list rather
 * than in the number.
 */
const FINDING_SATURATION_WEIGHT = 12;

/** The named components behind an `integrityScore`, so the number can be shown as arithmetic rather than asserted. */
export interface IntegrityScoreBreakdown {
  /** 0..1 — share of the expected chain span the documents establish. */
  depthEstablished: number;
  depthDeduction: number;
  /** Severity-weighted, excluding `insufficient_depth` (already priced into depth). */
  breakWeight: number;
  breakDeduction: number;
  contradictionWeight: number;
  contradictionDeduction: number;
  /** 0..1 — share of {parcel, party, instrument} the graph actually has. */
  structurePresent: number;
  structureDeduction: number;
  score: number;
}

/**
 * Computes the integrity score and every intermediate quantity behind it.
 *
 * Exported separately from `summariseTitleGraph` because a score a user
 * cannot interrogate is a score they are right not to trust, and the UI needs
 * the parts to show the arithmetic.
 */
export function explainIntegrityScore(graph: TitleGraph, chains: TitleChain[], contradictions: GraphContradiction[]): IntegrityScoreBreakdown {
  /* --- Depth --------------------------------------------------------- */

  // Averaged across parcels rather than summed: a case covering two parcels
  // is not twice as unproved as one covering a single parcel.
  const depthFractions = chains.map(chain => {
    if (chain.yearsExpected !== undefined && chain.yearsExpected > 0) {
      return Math.min(1, (chain.yearsEstablished ?? 0) / chain.yearsExpected);
    }
    // Outside a jurisdiction that names an expected span, the honest test is
    // binary: is there a conveyance on file at all?
    return chain.links.length > 0 ? 1 : 0;
  });
  const depthEstablished = depthFractions.length > 0 ? depthFractions.reduce((a, b) => a + b, 0) / depthFractions.length : 0;
  const depthDeduction = DEPTH_POINTS * (1 - depthEstablished);

  /* --- Breaks and contradictions ------------------------------------- */

  const allBreaks: ChainBreak[] = chains.flatMap(chain => chain.breaks);
  const breakWeight = allBreaks
    .filter(gap => gap.kind !== 'insufficient_depth')
    .reduce((sum, gap) => sum + SEVERITY_WEIGHT[gap.severity], 0);
  const breakDeduction = BREAK_POINTS * Math.min(1, breakWeight / FINDING_SATURATION_WEIGHT);

  const contradictionWeight = contradictions.reduce((sum, c) => sum + SEVERITY_WEIGHT[c.severity], 0);
  const contradictionDeduction = CONTRADICTION_POINTS * Math.min(1, contradictionWeight / FINDING_SATURATION_WEIGHT);

  /* --- Structure ------------------------------------------------------ */

  const hasParcel = graph.nodes.some(n => n.kind === 'parcel');
  const hasParty = graph.nodes.some(n => n.kind === 'party');
  const hasInstrument = graph.nodes.some(n => n.kind === 'instrument');
  const structurePresent = [hasParcel, hasParty, hasInstrument].filter(Boolean).length / 3;
  const structureDeduction = STRUCTURE_POINTS * (1 - structurePresent);

  const raw = 100 - depthDeduction - breakDeduction - contradictionDeduction - structureDeduction;

  return {
    depthEstablished: Math.round(depthEstablished * 100) / 100,
    depthDeduction: Math.round(depthDeduction * 10) / 10,
    breakWeight,
    breakDeduction: Math.round(breakDeduction * 10) / 10,
    contradictionWeight,
    contradictionDeduction: Math.round(contradictionDeduction * 10) / 10,
    structurePresent: Math.round(structurePresent * 100) / 100,
    structureDeduction: Math.round(structureDeduction * 10) / 10,
    score: Math.max(0, Math.min(100, Math.round(raw))),
  };
}

/* ==================================================================== */
/* Headline                                                              */
/* ==================================================================== */

/**
 * When two findings are equally severe, which one a user should be told
 * about. Ordered by how specifically actionable the finding is: a named break
 * between two people beats a generic shortfall against an expected span,
 * because the first tells the reader what to go and find.
 */
const HEADLINE_PRIORITY = [
  'party_discontinuity',
  'no_root',
  'date_impossible',
  'area_mismatch',
  'party_mismatch',
  'missing_predecessor',
  'boundary_mismatch',
  'identifier_mismatch',
  'status_conflict',
  'undated_instrument',
  'insufficient_depth',
];

interface HeadlineCandidate {
  kind: string;
  severity: RiskSeverity;
  statement: string;
  id: string;
}

/**
 * The one sentence a user reads first.
 *
 * A clean title says so plainly. A compromised one names its single worst
 * finding, in that finding's own words — the parties, the dates, the figures —
 * because "issues found" is the sentence that makes a user close the tab. The
 * count of everything else is available from the arrays alongside; the
 * headline's job is to be specific, not comprehensive.
 */
export function titleGraphHeadline(chains: TitleChain[], contradictions: GraphContradiction[]): string {
  const candidates: HeadlineCandidate[] = [
    ...chains.flatMap(chain => chain.breaks.map(gap => ({ kind: gap.kind as string, severity: gap.severity, statement: gap.statement, id: gap.id }))),
    ...contradictions.map(c => ({ kind: c.kind as string, severity: c.severity, statement: c.statement, id: c.id })),
  ];

  if (candidates.length === 0) {
    const established = chains.find(chain => chain.links.length > 0);
    if (established) {
      const years = established.yearsEstablished ?? 0;
      return (
        `The documents on file reconstruct a continuous ${years}-year chain of title for ${established.parcelLabel} ` +
        `across ${established.links.length} instrument${established.links.length === 1 ? '' : 's'}, and no two sources contradict each other.`
      );
    }
    return 'No title findings: the documents on file are internally consistent, though none of them conveys title.';
  }

  const worst = [...candidates].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    const aPriority = HEADLINE_PRIORITY.indexOf(a.kind);
    const bPriority = HEADLINE_PRIORITY.indexOf(b.kind);
    if (aPriority !== bPriority) return (aPriority === -1 ? 99 : aPriority) - (bPriority === -1 ? 99 : bPriority);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];

  return worst.statement;
}

/* ==================================================================== */
/* Summary                                                               */
/* ==================================================================== */

/**
 * Reduces a built graph and its analysis to the shape a screen carries.
 *
 * `TitleGraphSummary` deliberately drops the nodes and edges themselves — a
 * `ScreenResult` is already large, and the graph is only ever rendered from a
 * dedicated endpoint. What survives is what a reader acts on: the chains, the
 * disagreements, what to obtain next, one number and one sentence.
 */
export function summariseTitleGraph(input: {
  graph: TitleGraph;
  chains: TitleChain[];
  contradictions: GraphContradiction[];
  resolutionPaths: ResolutionPath[];
  /** Set only when a model contributed edges to this build. */
  proposals?: EdgeProposal[];
}): TitleGraphSummary {
  const { graph, chains, contradictions } = input;
  return {
    builtAt: graph.builtAt,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    chains,
    contradictions,
    resolutionPaths: input.resolutionPaths,
    integrityScore: explainIntegrityScore(graph, chains, contradictions).score,
    headline: titleGraphHeadline(chains, contradictions),
    ...(input.proposals && input.proposals.length > 0 ? { proposals: input.proposals } : {}),
  };
}

/* ==================================================================== */
/* One-call pipeline                                                     */
/* ==================================================================== */

/** Everything the title-graph module produces for one case, in one object. */
export interface TitleGraphAnalysis {
  graph: TitleGraph;
  chains: TitleChain[];
  contradictions: GraphContradiction[];
  resolutionPaths: ResolutionPath[];
  /** Present only when proposals were supplied — accepted and rejected alike. */
  proposals?: EdgeProposal[];
  summary: TitleGraphSummary;
  breakdown: IntegrityScoreBreakdown;
}

/**
 * Builds, analyses and summarises a case's title graph in the fixed order the
 * stages depend on: proposals are validated against the built graph before
 * chains are walked, so a model-contributed conveyance can close a break
 * rather than being reported alongside one it already answered.
 *
 * `now` is the only clock in the module and it is the caller's, exactly as in
 * `runScreen`.
 */
export function analyseTitleGraph(propertyCase: PropertyCase, now: string, options?: { proposals?: EdgeProposal[] }): TitleGraphAnalysis {
  const built = buildTitleGraph(propertyCase, now);
  const applied = options?.proposals?.length ? applyEdgeProposals(built, options.proposals) : undefined;
  const graph = applied?.graph ?? built;

  const chains = reconstructChains(graph);
  const contradictions = detectContradictions(graph, propertyCase);
  const paths = resolutionPaths(chains, contradictions);
  const breakdown = explainIntegrityScore(graph, chains, contradictions);

  return {
    graph,
    chains,
    contradictions,
    resolutionPaths: paths,
    proposals: applied?.proposals,
    summary: summariseTitleGraph({ graph, chains, contradictions, resolutionPaths: paths, proposals: applied?.proposals }),
    breakdown,
  };
}
