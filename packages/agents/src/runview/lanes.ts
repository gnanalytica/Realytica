/**
 * Lanes: recovering the schedule an orchestration actually ran.
 *
 * An orchestration is already a graph. `./orchestrator.ts` plans a case, runs
 * the plan in `order` groups, fans document intelligence out per document,
 * fans proof pathways out per gap, closes a feedback loop back into the
 * deterministic screen, and finishes with the critic. Nothing here invents a
 * layout for that — it reads the structure back out of what the run left
 * behind, so the picture a user sees is the schedule rather than a diagram
 * somebody drew.
 *
 * Three things make that reading harder than it sounds, and this file exists
 * for all three.
 *
 * 1. **The plan's `order` is not the whole truth.** `runOrchestration` treats
 *    document intelligence as a guaranteed-FIRST phase and the critic as a
 *    guaranteed-LAST one, whatever order the planner assigned them — the
 *    critic checks the combined output of everything that ran, so it cannot
 *    run in the middle, and the feedback loop's re-screen has to happen before
 *    any downstream agent reads a screen result. Only the four agents in
 *    `SCHEDULED_AGENTS` are actually placed by `groupTasksByOrder`. A lane
 *    assignment that trusted the plan's nominal ordering would draw a critic
 *    in lane 1 on a plan that asked for one, and that drawing would be a lie
 *    about what happened.
 *
 * 2. **`intelligence.runs` accumulates.** `apps/api/src/routes/agents.ts`
 *    appends each orchestration's runs to the history (`[...prev.runs,
 *    ...result.runs]`) and the copilot and /explore endpoints append their own
 *    runs on top. A graph built from every run a case has ever recorded would
 *    show three months of work as one impossible schedule. `selectOrchestration`
 *    therefore cuts the history down to the most recent orchestration and
 *    nothing else.
 *
 * 3. **The feedback loop leaves no flag, only a step log.** Whether the
 *    re-screen fired, whether it changed anything, and what it changed are
 *    recorded exactly once: as steps the orchestrator emits onto its own
 *    `AgentRun`. `readFeedbackLoop` reads them. That couples this file to those
 *    label strings, and the coupling is deliberate rather than accidental —
 *    the alternative is a second, drifting reimplementation of the loop's
 *    guard. The failure mode is chosen too: if those labels change, the reading
 *    degrades to "no feedback loop" and the graph loses an edge, rather than
 *    reporting a re-screen that did not happen.
 */

import type {
  AgentKind,
  AgentPlan,
  AgentRun,
  CaseIntelligence,
  PlannedTask,
} from '@realytica/shared';

/* ==================================================================== */
/* Vocabulary                                                            */
/* ==================================================================== */

/**
 * Human names for the roster, sentence case.
 *
 * Mirrors `AGENT_LABEL` in `apps/web/src/components/CostBreakdown.tsx` rather
 * than inventing a second spelling: an agent that reads "Document
 * intelligence" in the cost table and "Doc intel" on the canvas looks like two
 * different things to the person comparing them.
 */
export const AGENT_LABEL: Record<AgentKind, string> = {
  orchestrator: 'Orchestrator',
  planner: 'Planner',
  critic: 'Critic',
  explorer: 'Explorer',
  document_intelligence: 'Document intelligence',
  proof_pathways: 'Proof pathways',
  analyst_copilot: 'Analyst copilot',
  market_research: 'Market research',
  diligence_planner: 'Diligence planner',
  title_graph: 'Title graph',
  intake_concierge: 'Intake concierge',
};

/**
 * The agents whose position on the canvas comes from the plan's `order`.
 *
 * Mirrors `SCHEDULABLE_AGENTS` in `./orchestrator.ts`, and the mirror is the
 * point: document intelligence and the critic are absent from this list in
 * both files for the same reason — the orchestrator schedules them itself, as
 * its own phases, and their lanes are fixed here for the same reason.
 */
export const SCHEDULED_AGENTS: AgentKind[] = ['proof_pathways', 'market_research', 'diligence_planner', 'explorer'];

/**
 * Where a scheduled agent lands when the plan does not place it.
 *
 * This is the static fallback pipeline from `./agents/planner.ts` with the
 * explorer appended (the fallback plan never schedules the explorer, so it has
 * no position there to copy). It applies to a run whose plan was never
 * persisted — an older case, or the immediate no-credentials return — where
 * the only ordering evidence left is which agents ran at all.
 */
const FALLBACK_PIPELINE: AgentKind[] = ['proof_pathways', 'market_research', 'diligence_planner', 'explorer'];

/* ==================================================================== */
/* Selecting one orchestration out of the run history                    */
/* ==================================================================== */

/** The runs belonging to one orchestration, cut out of a case's accumulated history. */
export interface OrchestrationSlice {
  /**
   * The orchestration's own run. Absent when the case has runs but no
   * orchestrator run at all — a copilot-only case, or one whose intelligence
   * was assembled by hand.
   */
  orchestrator?: AgentRun;
  /** Every phase run that orchestration recorded, in the order it recorded them. */
  runs: AgentRun[];
}

function parseTime(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

/**
 * The most recent orchestration, and only that one.
 *
 * `runOrchestration` returns `[orchestratorRun, ...allRuns]`, so within one
 * orchestration's contribution the orchestrator run always comes first and its
 * phase runs follow. The last orchestrator run in the history therefore opens
 * the last orchestration, and everything after it in the array is a candidate
 * member.
 *
 * Position alone is not enough, because /copilot and /explore append their own
 * runs after an orchestration has finished. So candidates are also filtered by
 * the orchestrator's own wall clock: its `startedAt` precedes every phase it
 * ran and its `finishedAt` is stamped after the last of them, which makes the
 * window exact. A run carrying an unparseable timestamp is kept rather than
 * dropped — losing a node is worse than including one, and a malformed
 * timestamp is already visible as a missing duration on the node itself.
 */
export function selectOrchestration(intelligence: CaseIntelligence | undefined): OrchestrationSlice {
  const all = intelligence?.runs ?? [];
  let openedAt = -1;
  for (let i = 0; i < all.length; i++) {
    if (all[i].agent === 'orchestrator') openedAt = i;
  }

  if (openedAt < 0) {
    // No orchestration on file. Everything present is the best available
    // reading of "what ran" — a hand-assembled case, or a history that only
    // ever held copilot turns.
    return { runs: all.filter(r => r.agent !== 'orchestrator') };
  }

  const orchestrator = all[openedAt];
  const from = parseTime(orchestrator.startedAt);
  const to = parseTime(orchestrator.finishedAt);
  const runs = all.slice(openedAt + 1).filter(run => {
    if (run.agent === 'orchestrator') return false;
    if (from === undefined || to === undefined) return true;
    const started = parseTime(run.startedAt);
    if (started === undefined) return true;
    return started >= from && started <= to;
  });

  return { orchestrator, runs };
}

/* ==================================================================== */
/* The feedback loop, read off the orchestrator's step log               */
/* ==================================================================== */

/**
 * What the orchestrator's own steps say the feedback loop did.
 *
 * Every field here corresponds to exactly one label `runOrchestration` emits.
 * Nothing is inferred from the case's current state, because the case's
 * current state cannot answer these questions: after the API has written
 * `result.screenResult` onto `case.result`, the re-screened result and a
 * result that was never re-screened look identical.
 */
export interface FeedbackLoopReading {
  /** The re-screen was attempted: document intelligence produced at least one new field. */
  fired: boolean;
  /** The re-screen threw, and the orchestration continued on the prior screen result. */
  failed: boolean;
  /** The re-screen produced this case's FIRST screen result — there is no prior screen to feed back into. */
  firstResult: boolean;
  /** The re-screen ran and verdict, confidence band and gap count all held. */
  heldSteady: boolean;
  /** Material changes, verbatim: e.g. `verdict pursue -> investigate_further`. Empty unless something moved. */
  changes: string[];
  /** The verdict as it stood before the re-screen, when the re-screen moved it. */
  priorVerdict?: string;
  /** The confidence band as it stood before the re-screen, when the re-screen moved it. */
  priorBand?: string;
  /** The gap count as it stood before the re-screen, when the re-screen moved it. */
  priorGapCount?: number;
  /** Why the loop did not fire, in the orchestrator's own words. Absent when it did fire. */
  skippedBecause?: string;
}

const NO_FEEDBACK: FeedbackLoopReading = {
  fired: false,
  failed: false,
  firstResult: false,
  heldSteady: false,
  changes: [],
};

/**
 * Parses one `verdict A -> B` / `confidence band A -> B` / `gap count N -> M`
 * clause into the value that stood BEFORE.
 *
 * Reconstructing the prior side matters more than it looks: once the API has
 * overwritten `case.result` with the re-screened one, this clause is the only
 * surviving record of what the deterministic screen said when the planner read
 * it. Without it the pre-run engine node would have to display the post-run
 * verdict, which would make the feedback edge point at a node already showing
 * the answer the edge claims to have changed.
 */
function priorSideOf(changes: string[], prefix: string): string | undefined {
  for (const change of changes) {
    if (!change.startsWith(`${prefix} `)) continue;
    const [before] = change.slice(prefix.length + 1).split(' -> ');
    const trimmed = before?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * Reads the feedback loop out of the orchestrator run's steps.
 *
 * Matching is by prefix, not equality, so a trailing detail added to one of
 * these labels does not silently switch the loop off. The labels matched are
 * the five `runOrchestration` emits around the re-screen; anything it stops
 * emitting simply reads as "did not happen", which costs the graph an edge and
 * never invents one.
 */
export function readFeedbackLoop(orchestrator: AgentRun | undefined): FeedbackLoopReading {
  if (!orchestrator) return NO_FEEDBACK;

  let fired = false;
  let failed = false;
  let firstResult = false;
  let heldSteady = false;
  let changes: string[] = [];
  let skippedBecause: string | undefined;

  for (const step of orchestrator.steps) {
    const label = step.label;
    if (label.startsWith('Feedback loop: no new fields extracted')) {
      skippedBecause = label;
      continue;
    }
    if (label.startsWith('Feedback loop: re-running the deterministic screen')) {
      fired = true;
      continue;
    }
    if (label.startsWith('Re-screen failed')) {
      fired = true;
      failed = true;
      continue;
    }
    if (label.startsWith("Re-screen produced this case's first screen result")) {
      fired = true;
      firstResult = true;
      continue;
    }
    if (label.startsWith('Re-screen changed something material:')) {
      fired = true;
      changes = label
        .slice('Re-screen changed something material:'.length)
        .replace(/\.$/, '')
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      continue;
    }
    if (label.startsWith('Re-screen ran but nothing material changed')) {
      fired = true;
      heldSteady = true;
    }
  }

  const gapClause = priorSideOf(changes, 'gap count');
  const priorGapCount = gapClause !== undefined && /^\d+$/.test(gapClause) ? Number(gapClause) : undefined;

  return {
    fired,
    failed,
    firstResult,
    heldSteady,
    changes,
    priorVerdict: priorSideOf(changes, 'verdict'),
    priorBand: priorSideOf(changes, 'confidence band'),
    priorGapCount,
    skippedBecause: fired ? undefined : skippedBecause,
  };
}

/** True when this reading justifies a `feedback` edge back into the deterministic screen. */
export function feedbackClosedTheLoop(reading: FeedbackLoopReading, hasPriorScreen: boolean): boolean {
  // A re-screen that threw produced no result, so nothing flowed back; a
  // re-screen that produced the case's first result has no prior screen to
  // flow back INTO. Either way the edge would assert a correction that never
  // reached anything.
  return reading.fired && !reading.failed && !reading.firstResult && hasPriorScreen;
}

/* ==================================================================== */
/* Placement                                                             */
/* ==================================================================== */

/** Which of the orchestrator's phases a node belongs to. Drives both lane order and edge rules. */
export type RunPhase =
  /** The deterministic screen as it stood when the planner read it. */
  | 'screen'
  /** The planner run. */
  | 'plan'
  /** One document intelligence run — the guaranteed-first phase, one node per document. */
  | 'document_intelligence'
  /** The feedback loop's re-screen. */
  | 'rescreen'
  /** An agent placed by the plan's `order`. */
  | 'scheduled'
  /** The critic — the guaranteed-last phase. */
  | 'critic'
  /** A run inside the orchestration's window that belongs to none of the above. */
  | 'other'
  /** The orchestration itself, surfaced only when it ran no phases at all. */
  | 'orchestrator';

export interface RunPlacement {
  /** Stable node id — derived from the run id, or fixed for the synthetic engine nodes. */
  id: string;
  laneIndex: number;
  phase: RunPhase;
  /** Absent on the two synthetic engine nodes, which have no `AgentRun` behind them. */
  run?: AgentRun;
  /** The plan task that scheduled this run, when one did. Carries depth and focus to the inspector. */
  task?: PlannedTask;
  /** For a document intelligence node: the document it read, when it can be resolved. */
  documentId?: string;
}

export interface LaneLayout {
  lanes: { index: number; label: string }[];
  placements: RunPlacement[];
}

/** Node id for a run. Run ids are persisted with the case, so a UI's selection survives a refresh. */
export function nodeIdForRun(run: AgentRun): string {
  return `run:${run.id}`;
}

/** The deterministic screen the plan was made against. */
export const SCREEN_NODE_ID = 'engine:screen';
/** The feedback loop's re-screen. */
export const RESCREEN_NODE_ID = 'engine:rescreen';

/** The runnable task for an agent — `skip` is not a task, it is the absence of one. */
function runnableTask(plan: AgentPlan | undefined, agent: AgentKind): PlannedTask | undefined {
  const task = plan?.tasks.find(t => t.agent === agent);
  return task && task.depth !== 'skip' ? task : undefined;
}

/**
 * Total order within a lane.
 *
 * Ties break on run id so two runs that started in the same millisecond —
 * routine, since document intelligence fans out three at a time — cannot swap
 * places between two builds of the same case.
 */
function byStartThenId(a: AgentRun, b: AgentRun): number {
  const at = parseTime(a.startedAt) ?? 0;
  const bt = parseTime(b.startedAt) ?? 0;
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface LaneInput {
  slice: OrchestrationSlice;
  plan: AgentPlan | undefined;
  feedback: FeedbackLoopReading;
  /** True when a screen result existed BEFORE this orchestration ran. */
  hasPriorScreen: boolean;
  /**
   * Document ids in the case's own order, used to order the document
   * intelligence fan-out left to right the way the orchestrator queued it
   * (`caseData.documents.filter(isUnprocessed)` preserves document order;
   * completion order does not).
   */
  documentOrder: string[];
  /** Resolves a document intelligence run to the document it read. */
  documentIdFor: (run: AgentRun) => string | undefined;
}

/**
 * Assigns every node to an execution lane, mirroring what `runOrchestration`
 * really does rather than what the plan nominally says.
 *
 * The fixed spine is: the deterministic screen the plan was made against, the
 * plan, the guaranteed-first document intelligence phase, the feedback
 * re-screen, then one lane per `order` group, then the guaranteed-last critic.
 * Lanes with no nodes are dropped and the survivors renumbered from zero, so a
 * case that skipped document intelligence does not draw an empty column — the
 * canvas shows the run that happened, not the run that could have.
 *
 * Two placements are deliberately NOT taken from the plan:
 *
 *   - document intelligence, whatever `order` it carries, is always the lane
 *     immediately after the plan, because Phase A runs before the scheduling
 *     loop is even entered;
 *   - the critic, whatever `order` it carries, is always last, because Phase C
 *     runs after the loop has drained and checks its combined output.
 *
 * An agent that ran without a runnable plan task — the plan-less fallback path,
 * or a plan that was never persisted — is placed by `FALLBACK_PIPELINE` in a
 * lane after every plan-derived one, so its position is still the pipeline's
 * real dependency order rather than array order.
 */
export function assignLanes(input: LaneInput): LaneLayout {
  const { slice, plan, feedback, hasPriorScreen } = input;

  const byAgent = (agent: AgentKind): AgentRun[] => slice.runs.filter(r => r.agent === agent);

  /** Lanes under construction, keyed by insertion order; emptied ones are dropped at the end. */
  const draft: { label: string; placements: Omit<RunPlacement, 'laneIndex'>[] }[] = [];
  const push = (label: string, placements: Omit<RunPlacement, 'laneIndex'>[]): void => {
    if (placements.length > 0) draft.push({ label, placements });
  };

  /* Lane: the deterministic screen the plan was made against. */
  if (hasPriorScreen) {
    push('Deterministic screen', [{ id: SCREEN_NODE_ID, phase: 'screen' }]);
  }

  /* Lane: the plan. */
  const plannerRuns = byAgent('planner').sort(byStartThenId);
  push(
    'Plan',
    plannerRuns.map(run => ({ id: nodeIdForRun(run), phase: 'plan' as const, run })),
  );

  /* Lane: document intelligence — guaranteed first, one node per document. */
  const documentIndex = new Map(input.documentOrder.map((id, i) => [id, i]));
  const diTask = runnableTask(plan, 'document_intelligence');
  const diPlacements = byAgent('document_intelligence')
    .map(run => ({ run, documentId: input.documentIdFor(run) }))
    .sort((a, b) => {
      const ai = a.documentId !== undefined ? documentIndex.get(a.documentId) : undefined;
      const bi = b.documentId !== undefined ? documentIndex.get(b.documentId) : undefined;
      // Unresolvable documents sort last rather than to the front, where they
      // would push the case's first document out of the first position.
      const an = ai ?? Number.MAX_SAFE_INTEGER;
      const bn = bi ?? Number.MAX_SAFE_INTEGER;
      if (an !== bn) return an - bn;
      return byStartThenId(a.run, b.run);
    })
    .map(({ run, documentId }) => ({
      id: nodeIdForRun(run),
      phase: 'document_intelligence' as const,
      run,
      task: diTask,
      documentId,
    }));
  push('Document intelligence', diPlacements);

  /* Lane: the feedback loop's re-screen. */
  if (feedback.fired) {
    push('Feedback re-screen', [{ id: RESCREEN_NODE_ID, phase: 'rescreen' }]);
  }

  /* Lanes: the plan's own `order` groups, over the schedulable agents only. */
  const scheduledOrders = SCHEDULED_AGENTS.map(a => runnableTask(plan, a)?.order).filter(
    (o): o is number => o !== undefined,
  );
  const maxPlanOrder = scheduledOrders.length > 0 ? Math.max(...scheduledOrders) : 0;

  interface Grouped {
    key: number;
    fromPlan: boolean;
    entries: { agent: AgentKind; run: AgentRun; task?: PlannedTask }[];
  }
  const groups = new Map<number, Grouped>();
  for (const agent of SCHEDULED_AGENTS) {
    const runs = byAgent(agent);
    if (runs.length === 0) continue;
    const task = runnableTask(plan, agent);
    const fallbackIndex = FALLBACK_PIPELINE.indexOf(agent);
    const key = task ? task.order : maxPlanOrder + 1 + (fallbackIndex < 0 ? FALLBACK_PIPELINE.length : fallbackIndex);
    const group = groups.get(key) ?? { key, fromPlan: task !== undefined, entries: [] };
    // A group that mixes a planned agent with an unplanned one is still a
    // planned lane: the order value came from the plan.
    group.fromPlan = group.fromPlan || task !== undefined;
    for (const run of runs.sort(byStartThenId)) group.entries.push({ agent, run, task });
    groups.set(key, group);
  }

  for (const key of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(key);
    if (!group) continue;
    // Within a lane, agents sit in `SCHEDULED_AGENTS` order — the same order
    // the orchestrator builds its concurrent group in — so the canvas reads
    // the way the code does.
    group.entries.sort((a, b) => {
      const ai = SCHEDULED_AGENTS.indexOf(a.agent);
      const bi = SCHEDULED_AGENTS.indexOf(b.agent);
      if (ai !== bi) return ai - bi;
      return byStartThenId(a.run, b.run);
    });
    const names = [...new Set(group.entries.map(e => AGENT_LABEL[e.agent]))].join(', ');
    push(
      group.fromPlan ? `Order ${key} — ${names}` : names,
      group.entries.map(e => ({ id: nodeIdForRun(e.run), phase: 'scheduled' as const, run: e.run, task: e.task })),
    );
  }

  /* Lane: anything else that ran inside the window. */
  const accountedFor = new Set<AgentKind>([
    'planner',
    'document_intelligence',
    'critic',
    ...SCHEDULED_AGENTS,
  ]);
  const others = slice.runs.filter(r => !accountedFor.has(r.agent)).sort(byStartThenId);
  push(
    [...new Set(others.map(r => AGENT_LABEL[r.agent]))].join(', '),
    others.map(run => ({ id: nodeIdForRun(run), phase: 'other' as const, run })),
  );

  /* Lane: the critic — guaranteed last. */
  const criticTask = runnableTask(plan, 'critic');
  push(
    'Critic',
    byAgent('critic')
      .sort(byStartThenId)
      .map(run => ({ id: nodeIdForRun(run), phase: 'critic' as const, run, task: criticTask })),
  );

  /*
   * An orchestration that ran no phases at all still has something to say.
   * The no-credentials early return produces exactly one run — the failed
   * orchestrator — and rendering that as a canvas holding only the old screen
   * would tell a user nothing about why nothing ran. Everywhere else the
   * orchestrator run is the container rather than a node in it, and is
   * deliberately left off: it is the graph, not a step in it.
   */
  if (slice.runs.length === 0 && slice.orchestrator) {
    push('Orchestration', [
      { id: nodeIdForRun(slice.orchestrator), phase: 'orchestrator' as const, run: slice.orchestrator },
    ]);
  }

  const lanes = draft.map((lane, index) => ({ index, label: lane.label }));
  const placements = draft.flatMap((lane, index) =>
    lane.placements.map(p => ({ ...p, laneIndex: index })),
  );
  return { lanes, placements };
}
