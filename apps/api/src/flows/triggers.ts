import {
  MAX_SCHEDULED_PROJECTS,
  flowCanRun,
  runFlow,
  type DdProject,
  type Flow,
  type FlowNode,
  type TriggerNodeConfig,
  type TriggerOn,
} from '@realytica/shared';
import { store } from '../store';
import { handlersFor } from './handlers';
import { recordRun, runsFor } from './runs';

/**
 * What actually fires a flow.
 *
 * ## The gap this closes
 *
 * `flow.enabled` was stored, badged on the list and toggled in the studio, and
 * nothing anywhere read it. The trigger kinds were the same: an operator could
 * pick `evidence_uploaded`, save, switch the flow on, and wait forever. The UI
 * promised automation and delivered a button. This is the half that was
 * missing.
 *
 * ## What a triggered run may do
 *
 * The same as any other run, which is to say: read, decide, and *propose*. An
 * output node produces a draft and a person accepts it; nothing a flow does
 * reaches a register on its own. That rule was already in the engine and it is
 * what makes automatic firing safe to build at all — the worst a runaway
 * trigger can do is spend money and fill somebody's drafts, not sign off a
 * finding nobody read.
 *
 * A triggered run is **not** a rehearsal. A schedule that rehearsed would be
 * an expensive way to produce nothing.
 *
 * ## Why failures are swallowed
 *
 * A flow is a thing an operator drew. It must never be able to fail somebody
 * else's upload: an evidence file that would not save because a badly drawn
 * automation threw would be the automation making the product worse. So an
 * event is fired and forgotten, and every outcome — including the failure —
 * lands in the run history, which is the place to look for it.
 */

/** The trigger node of a flow, if it has one. */
function triggerOf(flow: Flow): (FlowNode & { config: { kind: 'trigger' } & TriggerNodeConfig }) | undefined {
  const node = flow.nodes.find((n) => n.kind === 'trigger' && !n.disabled);
  if (!node || node.config.kind !== 'trigger') return undefined;
  return node as FlowNode & { config: { kind: 'trigger' } & TriggerNodeConfig };
}

/** Enabled, runnable, and listening for this event. */
export function flowsListeningFor(tenantId: string, on: TriggerOn): Flow[] {
  return (store.data.flows ?? []).filter((flow) => {
    if (flow.tenantId !== tenantId) return false;
    // Three separate refusals rather than one: a flow that is off is a
    // decision, a flow with errors is a mistake, and confusing them in the
    // history would send somebody looking in the wrong place.
    if (!flow.enabled) return false;
    if (!flowCanRun(flow)) return false;
    return triggerOf(flow)?.config.on === on;
  });
}

export interface FlowEvent {
  tenantId: string;
  /** The project the event is about. Every kind but `schedule` has one. */
  project: DdProject;
  /** Who caused it. `schedule` names the mechanism, because no person did. */
  actor: string;
  /** Extra facts about the event, put on the run payload for conditions to test. */
  detail?: Record<string, unknown>;
  /**
   * When this happened, in milliseconds.
   *
   * Threaded through rather than left to `Date.now()` inside the engine so a
   * tick and the runs it records agree about the time. They have to: `dueNow`
   * reads the last run's `startedAt` back out of the history and compares it
   * to the tick's clock, so a run stamped from a different clock makes a
   * schedule either never due or always due.
   */
  at?: number;
}

/**
 * Run every flow listening for this event, and write down what happened.
 *
 * Returns the runs it started, which is what makes it testable; callers in
 * request handlers ignore the promise entirely — see `fireAndForget`.
 */
export async function fireTrigger(on: TriggerOn, event: FlowEvent): Promise<string[]> {
  const listening = flowsListeningFor(event.tenantId, on);
  const started: string[] = [];

  const at = new Date(event.at ?? Date.now()).toISOString();

  for (const flow of listening) {
    try {
      const result = await runFlow(flow, {
        handler: handlersFor({ tenantId: event.tenantId, project: event.project, actor: event.actor }),
        input: {
          project: { id: event.project.id, name: event.project.name, reference: event.project.reference },
          trigger: { on, at, ...(event.detail ?? {}) },
        },
        dryRun: false,
        ...(event.at === undefined ? {} : { now: () => at }),
      });
      const record = await recordRun({
        result,
        tenantId: event.tenantId,
        projectId: event.project.id,
        dryRun: false,
        startedBy: event.actor,
        trigger: on,
      });
      started.push(record.id);
    } catch (err) {
      // The run itself throwing — as opposed to a node failing, which the
      // engine records — is a bug here rather than in the drawn flow. Record it
      // as a failed run anyway: an operator asking "did my flow fire" deserves
      // "yes, and it broke" rather than silence.
      const record = await recordRun({
        result: {
          flowId: flow.id,
          flowVersion: flow.version,
          startedAt: at,
          finishedAt: at,
          status: 'failed',
          steps: [],
          payload: {},
          proposals: [],
          stoppedBecause: err instanceof Error ? err.message : 'The run could not be started.',
        },
        tenantId: event.tenantId,
        projectId: event.project.id,
        dryRun: false,
        startedBy: event.actor,
        trigger: on,
      });
      started.push(record.id);
      console.error(`[flows] ${flow.id} failed to run on ${on}:`, err);
    }
  }

  return started;
}

/**
 * Fire without making the caller wait or care.
 *
 * The shape every request handler uses. A route that awaited this would make
 * an upload as slow as the slowest automation somebody hung off it, and a
 * route that let it reject would let a drawn flow fail a real write.
 */
export function fireAndForget(on: TriggerOn, event: FlowEvent): void {
  void fireTrigger(on, event).catch((err: unknown) => {
    console.error(`[flows] trigger ${on} threw outside the run loop:`, err);
  });
}

/* ==================================================================== */
/* The clock                                                             */
/* ==================================================================== */

/**
 * Which projects a scheduled flow covers this tick.
 *
 * Capped, and the cap is reported rather than applied quietly — see
 * `MAX_SCHEDULED_PROJECTS`.
 */
function projectsForSchedule(flow: Flow, tenantId: string): { projects: DdProject[]; overflowed: boolean } {
  const config = triggerOf(flow)?.config;
  const bootstrap = store.data.tenants?.[0]?.id;
  const inWorkspace = (store.data.projects ?? []).filter((p) => (p.tenantId ?? bootstrap) === tenantId);

  if (config?.scope === 'named') {
    const named = inWorkspace.find((p) => p.id === config.projectId);
    return { projects: named ? [named] : [], overflowed: false };
  }

  // `open` — the default. A closed project has been signed off; re-deciding it
  // on a timer would be spending money to reopen a settled question.
  const open = inWorkspace.filter((p) => p.status !== 'closed');
  return { projects: open.slice(0, MAX_SCHEDULED_PROJECTS), overflowed: open.length > MAX_SCHEDULED_PROJECTS };
}

/**
 * Whether enough time has passed since this flow's last scheduled run.
 *
 * Read from the run history rather than from a `lastFiredAt` field on the
 * flow. One source of truth: a separate field could disagree with the history,
 * and then "when did this last run" would have two answers. It also means a
 * process restart cannot re-fire everything — the history survives, the
 * in-memory timer does not.
 */
function dueNow(flow: Flow, tenantId: string, now: number): boolean {
  const config = triggerOf(flow)?.config;
  const everyMinutes = config?.everyMinutes;
  // No interval is not "every tick" — it is an unfinished flow, and firing it
  // as fast as the clock allows is the worst possible reading of the omission.
  if (!everyMinutes || everyMinutes <= 0) return false;

  const lastScheduled = runsFor(tenantId, flow.id).find((r) => r.trigger === 'schedule');
  if (!lastScheduled) return true;
  return now - new Date(lastScheduled.startedAt).getTime() >= everyMinutes * 60_000;
}

/**
 * One pass of the clock across every workspace.
 *
 * Exported so it can be driven three ways: the interval below on a
 * long-running server, an operator route, and a platform cron on a deployment
 * that has no long-running process at all. All three call the same function,
 * so a serverless deployment is not running different code.
 */
export async function tickSchedules(now = Date.now()): Promise<{ fired: number; flows: number }> {
  const flows = store.data.flows ?? [];
  let fired = 0;
  let considered = 0;

  for (const flow of flows) {
    if (!flow.enabled || !flowCanRun(flow)) continue;
    if (triggerOf(flow)?.config.on !== 'schedule') continue;
    considered += 1;
    if (!dueNow(flow, flow.tenantId, now)) continue;

    const { projects, overflowed } = projectsForSchedule(flow, flow.tenantId);
    if (overflowed) {
      console.warn(
        `[flows] ${flow.id} is scheduled over more than ${MAX_SCHEDULED_PROJECTS} open projects; running the first ${MAX_SCHEDULED_PROJECTS}.`,
      );
    }
    for (const project of projects) {
      await fireTrigger('schedule', { tenantId: flow.tenantId, project, actor: 'schedule', at: now });
      fired += 1;
    }
  }

  return { fired, flows: considered };
}

/** How often the clock is checked. Not how often a flow runs — that is its own interval. */
export const TICK_INTERVAL_MS = 60_000;

let ticker: ReturnType<typeof setInterval> | null = null;
let ticking = false;

/**
 * Start the clock on a long-running server.
 *
 * **Not started on serverless.** A `setInterval` in a function that is frozen
 * between requests does not fire, and pretending otherwise would give an
 * operator a schedule that runs only when somebody happens to be using the
 * app. `apps/api/src/index.ts` — the long-running entry — starts this; the
 * Vercel function entry deliberately does not, and `POST /api/flows/tick` is
 * there so a platform cron can drive the same code.
 *
 * A tick that is still running when the next one is due is skipped rather than
 * overlapped: flows can take minutes, and two passes at once would double-fire
 * everything that was due.
 */
export function startScheduler(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void tickSchedules()
      .then(({ fired }) => {
        if (fired > 0) console.log(`[flows] schedule fired ${fired} run(s)`);
      })
      .catch((err: unknown) => console.error('[flows] schedule tick failed:', err))
      .finally(() => {
        ticking = false;
      });
  }, TICK_INTERVAL_MS);
  // The clock must never be the reason a process refuses to exit.
  ticker.unref?.();
  console.log(`[flows] schedule clock started, checking every ${TICK_INTERVAL_MS / 1000}s`);
}

export function stopScheduler(): void {
  if (!ticker) return;
  clearInterval(ticker);
  ticker = null;
}
