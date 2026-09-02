import { randomUUID } from 'node:crypto';
import {
  summariseRun,
  type FlowRunRecord,
  type FlowRunResult,
  type FlowRunSummary,
  type TriggerOn,
} from '@realytica/shared';
import { store } from '../store';

/**
 * The history of what the automation actually did.
 *
 * ## Why this is kept at all
 *
 * The run route used to hand its result to whoever called it and forget. That
 * is fine for the one thing a person does while watching — press Run, read the
 * trace — and useless for every question automation actually raises, all of
 * which are asked afterwards: why did this fire at three in the morning, what
 * did it decide, when did it start failing, is it still running at all.
 *
 * Once a flow can be triggered by something other than a person, a run with no
 * record is a run nobody was present for. So the record is not a nicety
 * alongside the trigger runner; it is the half that makes the runner
 * answerable.
 *
 * ## Retention, and why it is per flow
 *
 * The store is one document, so an unbounded log would eventually be the
 * largest thing in it. Fifty runs per flow is enough to see a pattern —
 * "it started failing on Tuesday" — and small enough to be free.
 *
 * Per flow rather than a global cap, because a global one lets a flow on a
 * five-minute schedule evict the entire history of a flow that runs weekly.
 * The weekly one is exactly the one whose history you want when it breaks.
 */

/** How many runs of any one flow are kept. */
export const RUNS_KEPT_PER_FLOW = 50;

function allRuns(): FlowRunRecord[] {
  if (!store.data.flowRuns) store.data.flowRuns = [];
  return store.data.flowRuns;
}

/** Newest first, which is the only order anybody reads a run log in. */
function byNewest(a: FlowRunRecord, b: FlowRunRecord): number {
  return b.startedAt.localeCompare(a.startedAt);
}

export async function recordRun(input: {
  result: FlowRunResult;
  tenantId: string;
  projectId: string;
  dryRun: boolean;
  startedBy: string;
  trigger: TriggerOn;
}): Promise<FlowRunRecord> {
  const record: FlowRunRecord = {
    ...input.result,
    id: `run_${randomUUID()}`,
    tenantId: input.tenantId,
    projectId: input.projectId,
    dryRun: input.dryRun,
    startedBy: input.startedBy,
    trigger: input.trigger,
  };

  const runs = allRuns();
  runs.push(record);

  // Trim this flow's history only. Every other flow's is untouched, which is
  // the whole point of a per-flow rule.
  const forThisFlow = runs.filter((r) => r.flowId === record.flowId).sort(byNewest);
  if (forThisFlow.length > RUNS_KEPT_PER_FLOW) {
    const evicted = new Set(forThisFlow.slice(RUNS_KEPT_PER_FLOW).map((r) => r.id));
    store.data.flowRuns = runs.filter((r) => !evicted.has(r.id));
  }

  await store.save();
  return record;
}

/** The list for a flow: dates, outcomes and counts, without the payloads. */
export function runsFor(tenantId: string, flowId: string, limit = RUNS_KEPT_PER_FLOW): FlowRunSummary[] {
  return allRuns()
    .filter((r) => r.tenantId === tenantId && r.flowId === flowId)
    .sort(byNewest)
    .slice(0, limit)
    .map(summariseRun);
}

/** The most recent run of each of several flows, for a list screen. */
export function latestRunPerFlow(tenantId: string, flowIds: readonly string[]): Record<string, FlowRunSummary> {
  const wanted = new Set(flowIds);
  const latest: Record<string, FlowRunRecord> = {};
  for (const run of allRuns()) {
    if (run.tenantId !== tenantId || !wanted.has(run.flowId)) continue;
    const held = latest[run.flowId];
    if (!held || run.startedAt > held.startedAt) latest[run.flowId] = run;
  }
  return Object.fromEntries(Object.entries(latest).map(([id, run]) => [id, summariseRun(run)]));
}

/** One run in full, steps and all. Scoped to the workspace like everything else. */
export function runFor(tenantId: string, runId: string): FlowRunRecord | undefined {
  return allRuns().find((r) => r.tenantId === tenantId && r.id === runId);
}

/**
 * Drop the history of flows that no longer exist.
 *
 * Called when a flow is deleted. Runs of a deleted flow are unreachable —
 * every read here is keyed by flow id — so keeping them would be storing
 * something nobody can ever ask for, which is the definition of a leak.
 */
export async function forgetRuns(flowIds: readonly string[]): Promise<void> {
  const gone = new Set(flowIds);
  const runs = allRuns();
  const kept = runs.filter((r) => !gone.has(r.flowId));
  if (kept.length === runs.length) return;
  store.data.flowRuns = kept;
  await store.save();
}
