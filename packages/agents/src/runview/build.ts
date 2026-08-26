/**
 * `buildRunGraph` — an orchestration, read back as the directed graph it
 * already was.
 *
 * ## Why this is a reader and not a layout engine
 *
 * `./orchestrator.ts` does not run a pipeline; it runs a schedule. The planner
 * assigns each agent an `order`, `groupTasksByOrder` turns those into
 * concurrent groups, document intelligence fans out one run per unprocessed
 * document, proof pathways fans out per gap, a feedback loop can re-run the
 * deterministic screen mid-flight, and the critic closes over whatever
 * actually produced anything. Every one of those facts is already in the data
 * the run left behind. Nothing here decides where a box goes — `./lanes.ts`
 * recovers the schedule and this file draws it, so a lane is a statement about
 * what ran concurrently rather than a column somebody found visually pleasing.
 *
 * ## The three claims this file is careful about
 *
 * **Cost.** A node's `costUsd` is re-derived through `telemetry/pricing.ts`
 * rather than read off `run.usage.estimatedCostUsd`, and it is **absent, not
 * zero**, when the route has no rate on file. This is the mistake this
 * codebase has already made once and written a module against: a route priced
 * at $0 wins every cheap/expensive comparison outright, so the answer is not
 * imprecise but inverted. The same rule governs the total — if any node on the
 * graph is unpriced, `totals.costUsd` is absent, because a partial sum
 * presented as a whole is exactly the lie the number would tell.
 *
 * **The feedback edge.** It is drawn only when the re-screen actually ran,
 * produced a result, and had a prior screen to correct. A re-screen that threw
 * corrected nothing; a re-screen that produced the case's first result had
 * nothing to correct. Drawing the edge anyway would put this product's most
 * interesting claim — a document changed the verdict — on a run where it did
 * not happen.
 *
 * **Duration.** `totals.durationMs` is the orchestration's wall clock, not the
 * sum of its nodes. Lanes overlap by construction, so a sum would report three
 * concurrent document scans as three times the wait a user actually had.
 *
 * ## Determinism
 *
 * The same case builds the same graph, byte for byte. Time enters only as the
 * injected `now`; every id is derived from a persisted run id or is a fixed
 * string, so a UI's selection survives a refresh; every sort is total, with
 * ties broken on id, because runs that started in the same millisecond are
 * routine on a fan-out and must not swap places between two renders.
 *
 * One thing deliberately absent: `RunGraphNodeKind` includes `'output'`, and
 * this builder never emits one. Every artefact the run produced belongs to
 * exactly one node and rides on it as a `RunGraphOutput`; promoting those to
 * nodes of their own would double them into the lane picture and make the
 * schedule harder to read, not easier.
 */

import type {
  AgentPlan,
  AgentRun,
  CaseIntelligence,
  PropertyCase,
  RunGraph,
  RunGraphEdge,
  RunGraphEdgeKind,
  RunGraphNode,
  RunGraphNodeKind,
} from '@realytica/shared';
import { formatRoute } from '../routing';
import { priceTokens, type TokenCounts } from '../telemetry/pricing';
import {
  AGENT_LABEL,
  RESCREEN_NODE_ID,
  SCREEN_NODE_ID,
  assignLanes,
  feedbackClosedTheLoop,
  readFeedbackLoop,
  selectOrchestration,
  type FeedbackLoopReading,
  type RunPlacement,
} from './lanes';
import {
  describeOutcome,
  documentIdForRun,
  fileNameFromSteps,
  outputsForRescreen,
  outputsForRun,
  outputsForScreen,
  pairExplorations,
  type OutputContext,
} from './outputs';

/* ==================================================================== */
/* Cost                                                                  */
/* ==================================================================== */

interface NodeCost {
  /** Absent when the route could not be priced. Never zero as a stand-in for unknown. */
  costUsd?: number;
  /** True when this node's spend is missing from the graph total, and the total must therefore be withheld. */
  unpriced: boolean;
  /** A sentence for the node's `detail` when the figure needs a caveat. */
  note?: string;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * What one run cost, priced through the current rate table.
 *
 * Recomputed rather than read off `run.usage.estimatedCostUsd` for the reason
 * `telemetry/aggregate.ts` states at length: the token counts are the
 * provider's facts and are true forever, while a stored cost is an estimate
 * made with whatever table was loaded at the time — including, for a route
 * whose rate had not been declared yet, a `0` that means "not counted" and
 * reads as "free".
 *
 * Two edges worth naming:
 *
 *   - **No usage, or zero tokens.** The cost is `0` and that zero is exact:
 *     nothing was spent that anything recorded, and zero tokens cost zero at
 *     any rate, known or not. So a failed run on an unpriced route does not
 *     withhold the graph's total — there is nothing about it to withhold.
 *   - **No provider on the run.** `AgentRun.provider` is optional because runs
 *     predate the provider port, and everything before it was Anthropic. That
 *     is the same convention `parseRoute` uses for a bare model id, so an
 *     absent provider is read as `anthropic` rather than as unpriceable.
 */
function costForRun(run: AgentRun): NodeCost {
  const usage = run.usage;
  const tokens: TokenCounts = {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
  };
  if (tokens.inputTokens + tokens.outputTokens + tokens.cacheReadTokens === 0) {
    return { costUsd: 0, unpriced: false };
  }

  const provider = run.provider ?? 'anthropic';
  const price = priceTokens(provider, run.model, tokens);
  const route = formatRoute(provider, run.model);

  if (price.confidence === 'unavailable') {
    return {
      unpriced: true,
      note: `Cost unknown: no rate on file for "${route}", so this node is excluded from the graph total rather than counted as $0.`,
    };
  }
  if (price.confidence === 'upper_bound') {
    return {
      costUsd: price.costUsd,
      unpriced: false,
      note: `Cost is a ceiling: no published rate for "${route}", so it is priced at the most expensive rate its own vendor charges.`,
    };
  }
  return { costUsd: price.costUsd, unpriced: false };
}

/* ==================================================================== */
/* Nodes                                                                 */
/* ==================================================================== */

function durationOf(run: AgentRun): number | undefined {
  const from = Date.parse(run.startedAt);
  const to = run.finishedAt ? Date.parse(run.finishedAt) : Number.NaN;
  if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
  return Math.max(0, to - from);
}

function kindFor(placement: RunPlacement): RunGraphNodeKind {
  if (placement.phase === 'screen' || placement.phase === 'rescreen') return 'engine';
  if (placement.phase === 'plan') return 'plan';
  return 'agent';
}

/**
 * The node's label.
 *
 * Document intelligence is labelled by the document rather than by the agent,
 * because its lane is already called "Document intelligence" and a fan-out of
 * five identically-labelled boxes tells a user nothing about which scan
 * failed.
 */
function labelFor(placement: RunPlacement, caseData: PropertyCase): string {
  switch (placement.phase) {
    case 'screen':
      return 'Deterministic screen';
    case 'rescreen':
      return 'Feedback re-screen';
    case 'document_intelligence': {
      const document = caseData.documents.find(d => d.id === placement.documentId);
      const name = document?.fileName ?? (placement.run ? fileNameFromSteps(placement.run) : undefined);
      return name ?? AGENT_LABEL.document_intelligence;
    }
    default:
      return placement.run ? AGENT_LABEL[placement.run.agent] : 'Unknown';
  }
}

/** Everything the inspector should be able to read without a second fetch, assembled into one sentence. */
function detailFor(placement: RunPlacement, feedback: FeedbackLoopReading, caseData: PropertyCase, cost: NodeCost): string | undefined {
  const parts: string[] = [];

  if (placement.phase === 'screen') {
    const result = caseData.result;
    if (feedback.fired && !feedback.failed) {
      parts.push(
        'Superseded by the feedback re-screen in this run. Only the verdict, confidence band and gap count as they stood before are recorded, so the prior indicative range is not shown rather than shown stale.',
      );
    } else if (result) {
      parts.push(`Deterministic engine ${result.engineVersion}, generated ${result.generatedAt}. The arithmetic authority — no agent may overwrite it.`);
    }
    return parts.join(' ') || undefined;
  }

  if (placement.phase === 'rescreen') {
    parts.push(
      'The deterministic engine re-run against the fields document intelligence extracted. Every downstream agent in this run reasoned over this result rather than the stale one.',
    );
    return parts.join(' ');
  }

  const run = placement.run;
  if (!run) return undefined;

  const outcome = describeOutcome(run);
  const body = run.status === 'succeeded' ? run.summary : (run.error ?? run.summary);
  if (outcome && body) parts.push(`${outcome} ${body}`);
  else if (outcome) parts.push(outcome.replace(/ —$/, '.'));
  else if (body) parts.push(body);

  const task = placement.task;
  if (task) {
    parts.push(
      `Planned at ${task.depth} depth${task.focus.length > 0 ? `, focused on: ${task.focus.join('; ')}` : ''}. ${task.rationale}`,
    );
  }

  if (cost.note) parts.push(cost.note);

  return parts.join(' ') || undefined;
}

function buildNode(
  placement: RunPlacement,
  ctx: OutputContext,
  feedback: FeedbackLoopReading,
): { node: RunGraphNode; unpriced: boolean } {
  const { caseData } = ctx;

  if (placement.phase === 'screen' || placement.phase === 'rescreen') {
    const isRescreen = placement.phase === 'rescreen';
    // Deterministic, so it costs nothing in model spend — and that zero is a
    // measurement, not a missing rate. It is the product's own point: the
    // arithmetic authority is the free part.
    const cost: NodeCost = { costUsd: 0, unpriced: false };
    const node: RunGraphNode = {
      id: placement.id,
      kind: 'engine',
      label: labelFor(placement, caseData),
      status: isRescreen && feedback.failed ? 'failed' : 'ok',
      lane: placement.laneIndex,
      costUsd: 0,
      outputs: isRescreen ? outputsForRescreen(ctx) : outputsForScreen(ctx),
      detail: detailFor(placement, feedback, caseData, cost),
    };
    return { node, unpriced: false };
  }

  const run = placement.run;
  /* istanbul ignore next — every non-engine placement carries a run by construction. */
  if (!run) throw new Error(`Run graph placement "${placement.id}" has no run and is not an engine node.`);

  const cost = costForRun(run);
  const node: RunGraphNode = {
    id: placement.id,
    kind: kindFor(placement),
    label: labelFor(placement, caseData),
    agent: run.agent,
    status: run.status,
    lane: placement.laneIndex,
    provider: run.provider,
    model: run.model,
    tier: run.tier,
    durationMs: durationOf(run),
    costUsd: cost.costUsd,
    capabilityGaps: run.capabilityGaps,
    prompts: run.prompts,
    outputs: outputsForRun(placement, ctx),
    runId: run.id,
    detail: detailFor(placement, feedback, caseData, cost),
  };
  return { node, unpriced: cost.unpriced };
}

/* ==================================================================== */
/* Edges                                                                 */
/* ==================================================================== */

/**
 * A pair of nodes carries at most one edge, and the most specific kind wins.
 *
 * Every data dependency in an orchestration is also a sequence — the
 * orchestrator awaits each group before starting the next — so drawing both
 * would double every interesting arrow with a redundant one. `feedback`
 * outranks `data`, which outranks `sequence`, so an upgrade never loses
 * meaning and the graph never says "B merely ran after A" about a pair where
 * A's output was A's whole contribution to B.
 */
const EDGE_RANK: Record<RunGraphEdgeKind, number> = { sequence: 0, data: 1, feedback: 2 };

class EdgeSet {
  private readonly edges = new Map<string, RunGraphEdge>();

  link(from: string, to: string, kind: RunGraphEdgeKind, label?: string): void {
    if (from === to) return;
    const key = `${from}~>${to}`;
    const existing = this.edges.get(key);
    if (existing && EDGE_RANK[existing.kind] >= EDGE_RANK[kind]) return;
    this.edges.set(key, { id: `edge:${key}`, from, to, kind, label });
  }

  /**
   * Sorted by source lane, then target lane, then id — the order a reader
   * walks the canvas in, and a total order, so two builds of the same case
   * emit the same array rather than whatever order the rules happened to fire
   * in.
   */
  toArray(laneOf: Map<string, number>): RunGraphEdge[] {
    return [...this.edges.values()].sort((a, b) => {
      const al = laneOf.get(a.from) ?? -1;
      const bl = laneOf.get(b.from) ?? -1;
      if (al !== bl) return al - bl;
      const at = laneOf.get(a.to) ?? -1;
      const bt = laneOf.get(b.to) ?? -1;
      if (at !== bt) return at - bt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
}

/* ==================================================================== */
/* The build                                                             */
/* ==================================================================== */

/**
 * Turns a completed orchestration into the graph a canvas can draw.
 *
 * `now` is the injected clock and is used for exactly one thing —
 * `RunGraph.builtAt`. Nothing else in this file reads a clock, which is what
 * makes two builds of the same case comparable byte for byte.
 *
 * Only the case's MOST RECENT orchestration is graphed.
 * `apps/api/src/routes/agents.ts` appends every run to
 * `intelligence.runs` and the copilot and /explore endpoints append theirs on
 * top, so a graph over the whole history would draw months of separate work as
 * one impossible schedule. See `selectOrchestration`.
 */
export function buildRunGraph(caseData: PropertyCase, now: string): RunGraph {
  const intelligence: CaseIntelligence | undefined = caseData.intelligence;
  const slice = selectOrchestration(intelligence);
  const feedback = readFeedbackLoop(slice.orchestrator);
  const plan: AgentPlan | undefined = intelligence?.plan;

  // A screen the plan could have been made against. When the feedback loop
  // produced this case's FIRST result, `case.result` exists but nothing
  // preceded it, and drawing a "before" node would invent a screen that never
  // ran.
  const hasPriorScreen = caseData.result !== undefined && !feedback.firstResult;

  const layout = assignLanes({
    slice,
    plan,
    feedback,
    hasPriorScreen,
    documentOrder: caseData.documents.map(d => d.id),
    documentIdFor: run => documentIdForRun(run, caseData.documents),
  });

  const ctx: OutputContext = {
    caseData,
    intelligence,
    feedback,
    explorationByRunId: pairExplorations(
      slice.runs.filter(r => r.agent === 'explorer'),
      intelligence?.explorations ?? [],
    ),
  };

  const nodes: RunGraphNode[] = [];
  let anyUnpriced = false;
  let costTotal = 0;
  for (const placement of layout.placements) {
    const { node, unpriced } = buildNode(placement, ctx, feedback);
    nodes.push(node);
    if (unpriced) anyUnpriced = true;
    else costTotal += node.costUsd ?? 0;
  }

  const laneOf = new Map(nodes.map(n => [n.id, n.lane]));
  const byLane: RunGraphNode[][] = layout.lanes.map(() => []);
  for (const node of nodes) byLane[node.lane]?.push(node);

  const edges = new EdgeSet();

  /* ---- Sequence: the schedule itself. --------------------------------- */
  // Lane i+1 could not start until lane i had drained: `runOrchestration`
  // awaits `Promise.all` on each group, and its Phase A/B/C boundaries are
  // plain `await`s. That is what a `sequence` edge asserts, and it is true
  // between every adjacent pair of lanes on this canvas.
  for (let i = 0; i + 1 < byLane.length; i++) {
    for (const from of byLane[i]) {
      for (const to of byLane[i + 1]) edges.link(from.id, to.id, 'sequence');
    }
  }

  /* ---- Data: where one phase's output was another's input. ------------ */
  const placementById = new Map(layout.placements.map(p => [p.id, p]));
  const nodeFor = (predicate: (p: RunPlacement) => boolean): RunGraphNode[] =>
    nodes.filter(n => {
      const p = placementById.get(n.id);
      return p !== undefined && predicate(p);
    });

  const documentNodes = nodeFor(p => p.phase === 'document_intelligence');
  const productiveDocumentNodes = documentNodes.filter(n => n.status === 'succeeded');
  const scheduledNodes = nodeFor(p => p.phase === 'scheduled');
  const criticNodes = nodeFor(p => p.phase === 'critic');
  const rescreenNode = nodes.find(n => n.id === RESCREEN_NODE_ID);

  if (rescreenNode) {
    // The extraction is what made the loop fire at all — the guard in
    // `runOrchestration` is "did any document intelligence run produce a new
    // field".
    for (const from of productiveDocumentNodes) {
      edges.link(from.id, rescreenNode.id, 'data', 'extracted fields');
    }
  }

  if (rescreenNode && !feedback.failed) {
    // `effectiveCaseData.result` is the fresh screen, and every scheduled
    // agent this run received it. That is the loop's downstream half and the
    // reason it is worth paying for.
    for (const to of scheduledNodes) edges.link(rescreenNode.id, to.id, 'data', 'fresh screen result');
  } else {
    // No usable re-screen, but the merged documents still travelled:
    // `effectiveCaseData.documents` is `finalDocuments` whether or not the
    // screen was re-run. Drawn to the first scheduled lane only — the data
    // reaches the later ones transitively, and fanning every document into
    // every agent would bury the schedule under its own arrows.
    const firstScheduledLane = scheduledNodes.length > 0 ? Math.min(...scheduledNodes.map(n => n.lane)) : undefined;
    if (firstScheduledLane !== undefined) {
      for (const from of productiveDocumentNodes) {
        for (const to of scheduledNodes.filter(n => n.lane === firstScheduledLane)) {
          edges.link(from.id, to.id, 'data', 'merged documents');
        }
      }
    }
  }

  const scheduledNodeFor = (agent: AgentRun['agent']): RunGraphNode | undefined =>
    scheduledNodes.find(n => n.agent === agent);
  const pathwaysNode = scheduledNodeFor('proof_pathways');
  const researchNode = scheduledNodeFor('market_research');
  const diligenceNode = scheduledNodeFor('diligence_planner');

  if (diligenceNode) {
    // `runDiligencePlanner` is handed `pathways` and `findings` — but those
    // are variables the scheduling loop fills in as groups complete. An agent
    // scheduled in the SAME order group as its producer therefore reads an
    // empty list, so the edge is drawn only when the lanes actually say the
    // producer finished first. A plan that runs these concurrently has quietly
    // starved the diligence planner, and this graph is where that becomes
    // visible.
    if (pathwaysNode && pathwaysNode.status === 'succeeded' && pathwaysNode.lane < diligenceNode.lane) {
      edges.link(pathwaysNode.id, diligenceNode.id, 'data', 'pathways');
    }
    if (researchNode && researchNode.status === 'succeeded' && researchNode.lane < diligenceNode.lane) {
      edges.link(researchNode.id, diligenceNode.id, 'data', 'research findings');
    }
  }

  for (const critic of criticNodes) {
    // Phase C checks the combined generative output of everything that ran:
    // `runCritic` receives `pathways`, `insights` and `research` directly, and
    // an `evidenceIds` superset that includes whatever document intelligence
    // contributed to the ledger. The explorer is absent from that list in the
    // orchestrator, so it is absent here — an edge would claim a check nobody
    // performed.
    if (pathwaysNode?.status === 'succeeded') edges.link(pathwaysNode.id, critic.id, 'data', 'pathways');
    if (researchNode?.status === 'succeeded') edges.link(researchNode.id, critic.id, 'data', 'research findings');
    if (diligenceNode?.status === 'succeeded') edges.link(diligenceNode.id, critic.id, 'data', 'insights');
    for (const document of productiveDocumentNodes) {
      const run = placementById.get(document.id)?.run;
      if (run && run.producedEvidenceIds.length > 0) {
        edges.link(document.id, critic.id, 'data', 'evidence ids');
      }
    }
  }

  /* ---- Feedback: the loop closing. ------------------------------------ */
  if (rescreenNode && feedbackClosedTheLoop(feedback, hasPriorScreen)) {
    edges.link(
      rescreenNode.id,
      SCREEN_NODE_ID,
      'feedback',
      feedback.changes.length > 0 ? feedback.changes.join(', ') : 'no material change',
    );
  }

  return {
    caseId: caseData.id,
    builtAt: now,
    lanes: layout.lanes.map(l => ({ index: l.index, label: l.label })),
    nodes,
    edges: edges.toArray(laneOf),
    totals: {
      durationMs: totalDuration(slice.orchestrator, slice.runs),
      // Withheld outright when anything is unpriced. A total that silently
      // omits one route is not an approximation of the truth — it is a
      // different, smaller number wearing the truth's label.
      costUsd: anyUnpriced ? undefined : round4(costTotal),
      degradedNodes: nodes.filter(n => (n.capabilityGaps?.length ?? 0) > 0).length,
      // `cancelled` is "deliberately not attempted" in this package, not a
      // breakage, so it is not counted as a failure.
      failedNodes: nodes.filter(n => n.status === 'failed').length,
    },
  };
}

/**
 * Wall clock for the whole orchestration.
 *
 * The orchestrator's own run brackets everything it scheduled — it stamps
 * `startedAt` before planning and `finishedAt` after the critic — so its span
 * is precisely what a user waited. Falling back to the widest span across the
 * phase runs covers a history with no orchestrator run at all, and understates
 * only by the orchestration's own bookkeeping.
 */
function totalDuration(orchestrator: AgentRun | undefined, runs: readonly AgentRun[]): number {
  if (orchestrator) {
    const span = durationOf(orchestrator);
    if (span !== undefined) return span;
  }
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    const from = Date.parse(run.startedAt);
    if (!Number.isNaN(from)) earliest = Math.min(earliest, from);
    const to = run.finishedAt ? Date.parse(run.finishedAt) : Number.NaN;
    if (!Number.isNaN(to)) latest = Math.max(latest, to);
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return 0;
  return Math.max(0, latest - earliest);
}
