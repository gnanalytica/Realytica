/**
 * The run graph: an orchestration as the directed graph a canvas can draw.
 *
 * `buildRunGraph(caseData, now)` is the whole surface anyone outside this
 * folder needs. It takes a `PropertyCase` whose `intelligence` holds a
 * completed orchestration and returns the frozen `RunGraph` from
 * `@realytica/shared` — lanes, nodes, edges and totals — with no clock read, no
 * randomness, and node ids stable enough that a selection survives a refresh.
 *
 * The rest is exported because the parts are individually useful to whoever
 * wires this up and to a harness exercising it:
 *
 *   - `selectOrchestration` cuts one orchestration out of a case's accumulated
 *     run history, which is not a trivial operation — `intelligence.runs`
 *     accumulates across every orchestration, copilot turn and exploration the
 *     case has ever had.
 *   - `readFeedbackLoop` recovers whether the deterministic screen was re-run
 *     and what that changed, from the only place it is recorded: the steps on
 *     the orchestrator's own `AgentRun`.
 *   - `assignLanes` mirrors the orchestrator's real phase structure, which is
 *     not the same as the plan's nominal `order` — document intelligence is
 *     guaranteed first and the critic guaranteed last however the plan
 *     numbered them.
 *
 * This module is not re-exported from `src/index.ts`. That file is the API
 * wiring change's to make, in the same way `./telemetry` deliberately left it
 * alone.
 */

export { buildRunGraph } from './build';

export {
  AGENT_LABEL,
  RESCREEN_NODE_ID,
  SCHEDULED_AGENTS,
  SCREEN_NODE_ID,
  assignLanes,
  feedbackClosedTheLoop,
  nodeIdForRun,
  readFeedbackLoop,
  selectOrchestration,
} from './lanes';
export type {
  FeedbackLoopReading,
  LaneInput,
  LaneLayout,
  OrchestrationSlice,
  RunPhase,
  RunPlacement,
} from './lanes';

export {
  describeOutcome,
  documentIdForRun,
  fileNameFromSteps,
  outputsForRescreen,
  outputsForRun,
  outputsForScreen,
  pairExplorations,
  wasRefused,
} from './outputs';
export type { OutputContext } from './outputs';
