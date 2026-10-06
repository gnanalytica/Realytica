/**
 * The durable run ledger: what a model run did, checkpointed as it does it.
 *
 * Every long operation in this product lives inside one HTTP request. The
 * steps stream to whoever is watching and are gone: if the function dies —
 * a timeout, a deploy, a closed laptop — the run vanishes without a record
 * that it ever started, and "the copilot never answered" is indistinguishable
 * from "nobody asked". That is the gap every durable-execution system fixes
 * the same way (Temporal's event history, LangGraph's checkpointer, Vercel's
 * workflow event log): an append-only step log written at step boundaries,
 * owned by the application, so the log survives the process.
 *
 * This module is the pure half — the record shape and the reading of it. The
 * API layer owns persistence, through the same storage adapter as everything
 * else, so the ledger is durable exactly where the case data is.
 *
 * Two readings are derived rather than stored, because a stored status lies
 * the moment the writer dies:
 *
 * **Interrupted is an inference, not a state.** Nothing that crashes gets to
 * record that it crashed. A run still marked `running` whose last checkpoint
 * is older than any step has a right to take IS the crash record — which is
 * why checkpoints carry timestamps and why "running" is only believed fresh.
 *
 * **Stalling is measured against progress, not time alone.** Magentic-One's
 * progress ledger asks "are we making progress?" as first-class state; the
 * equivalent here is the gap since the last checkpoint, visible per run, so
 * a run that is alive but looping shows as exactly that.
 *
 * What this is NOT, stated so nobody extends it wrong: it is not a second
 * store. Registers, turns and proposals land in the project as they always
 * did; the ledger records THAT work happened and how far it got, never the
 * work's content — a ledger that duplicated results would disagree with the
 * registers eventually, and the registers win.
 */

export type DurableRunKind = 'chat_model' | 'orchestrate' | 'screen' | 'plan';

/**
 * `waiting` is a plan's alone: shown and not yet approved, or stopped part
 * way. Nothing is running and nothing is expected to checkpoint, so it is
 * never read as interrupted however long it waits.
 */
export type DurableRunStatus = 'running' | 'finished' | 'failed' | 'waiting';

/** Derived on read. `interrupted` is a `running` record nobody has touched for too long. */
export type DurableRunState = DurableRunStatus | 'interrupted';

export interface DurableRunStep {
  at: string;
  kind: string;
  label: string;
}

export interface DurableRun {
  id: string;
  projectId: string;
  kind: DurableRunKind;
  status: DurableRunStatus;
  startedAt: string;
  /** Last checkpoint. The liveness signal — see `runState`. */
  updatedAt: string;
  /** What the person asked, when the run began with a question. */
  question?: string;
  actor?: string;
  steps: DurableRunStep[];
  /** One line on how it ended. Set for finished and failed, never for running. */
  outcome?: string;
  /**
   * For a plan (`kind: 'plan'`): its steps and how far each has got. The one
   * place a plan is kept. See `plans.ts`.
   */
  plan?: import('./plans').ChatPlan;
}

/**
 * How stale a `running` record may be before it is read as interrupted.
 *
 * Generous on purpose: the longest legitimate silence is a judgment-tier
 * model call, which runs a minute or two — five minutes of no checkpoint
 * from a process that checkpoints every step means the process is gone.
 * A false "interrupted" on a live run costs a moment of confusion; a false
 * "running" on a dead one costs someone waiting on it indefinitely.
 */
export const RUN_STALL_MS = 5 * 60 * 1000;

export function runState(run: DurableRun, now: string, stallMs = RUN_STALL_MS): DurableRunState {
  if (run.status !== 'running') return run.status;
  const last = Date.parse(run.updatedAt);
  const at = Date.parse(now);
  if (!Number.isFinite(last) || !Number.isFinite(at)) return 'running';
  return at - last > stallMs ? 'interrupted' : 'running';
}

/** The ledger line for one run, for a pane or a log. */
export function describeRun(run: DurableRun, now: string): string {
  const state = runState(run, now);
  const steps = run.steps.length;
  const outcome = run.outcome?.replace(/\.$/, '');
  const head =
    run.kind === 'chat_model'
      ? `Chat${run.question ? `: “${run.question.slice(0, 60)}${run.question.length > 60 ? '…' : ''}”` : ''}`
      : run.kind === 'orchestrate'
        ? 'Orchestrator pass'
        : run.kind === 'plan'
          ? 'Plan'
          : 'Property screen';
  // A plan is said by its steps: how many are done, and whether it is waiting to be run or taken up again.
  if (run.kind === 'plan' && run.plan) {
    const all = run.plan.steps.filter((step) => step.state !== 'out');
    const done = all.filter((step) => step.state === 'done').length;
    const stands =
      state === 'interrupted'
        ? 'cut short. What was done stays done. It can be taken up again from the chat'
        : run.plan.status === 'shown'
          ? 'shown, not started'
          : run.plan.status === 'cancelled'
            ? 'cancelled'
            : run.plan.status === 'stopped'
              ? 'stopped. It can be taken up again from the chat'
              : run.plan.status;
    return `${head} — ${done} of ${all.length} step(s) done, ${stands}.`;
  }
  if (state === 'interrupted') {
    const lastStep = run.steps[run.steps.length - 1];
    return `${head} — interrupted after ${steps} step(s)${lastStep ? `, last at “${lastStep.label}”` : ''}. The process died without finishing; re-issue the request — the registers hold everything committed before the cut.`;
  }
  if (state === 'failed') return `${head} — failed after ${steps} step(s)${outcome ? `: ${outcome}` : ''}.`;
  if (state === 'finished') return `${head} — ${steps} step(s)${outcome ? `: ${outcome}` : ''}.`;
  return `${head} — running, ${steps} step(s) so far.`;
}

/**
 * Append a run to a ledger, newest first, bounded.
 *
 * The bound is behavioural, not just spatial: the ledger answers "what
 * happened recently and did it finish", and a thousand-entry history answers
 * neither better while making every checkpoint write heavier.
 */
export const RUN_LEDGER_LIMIT = 20;

/** How many plans that are not over are kept past the limit. */
export const RUN_LEDGER_OPEN_PLANS = 5;

/** A plan somebody has still to approve, is running, or stopped and may take up again. */
function openPlan(run: DurableRun): boolean {
  return run.kind === 'plan' && run.plan !== undefined && run.status !== 'finished' && run.status !== 'failed';
}

/**
 * The newest runs, and past them the plans that are not over: the ledger is
 * the only record of where such a plan stands, and twenty questions asked of
 * the chat since must not be what loses it.
 */
export function upsertRun(ledger: DurableRun[], run: DurableRun, limit = RUN_LEDGER_LIMIT): DurableRun[] {
  const all = [run, ...ledger.filter((row) => row.id !== run.id)];
  return [...all.slice(0, limit), ...all.slice(limit).filter(openPlan).slice(0, RUN_LEDGER_OPEN_PLANS)];
}
