/**
 * Where a plan is kept: in the project's run ledger, and nowhere else.
 *
 * A plan is shown before it runs, runs step by step, and may be stopped and
 * taken up again (`plans.ts` in the shared package). All of that has to
 * outlive the request that made it and the page that showed it, so the plan
 * and how far each step has got are one record of the ledger
 * (`run-journal.json`, beside the project's files), written at every step.
 * The project's own record holds none of it: a chat turn names its plan by
 * the plan's id, and the page reads the plan from here.
 *
 * The ledger's own statuses say whether anything is expected to be writing.
 * A plan that is running is `running`, and is read as cut short when it has
 * written nothing for longer than any step may take. One that is shown, or
 * stopped, is `waiting`, and waits as long as it likes.
 */

import { randomUUID } from 'node:crypto';
import { runState, upsertRun, type ChatPlan, type DurableRun } from '@realytica/shared';
import { changeLedger, listRuns } from './journal';

/** A ledger record that is a plan. */
export type PlanRun = DurableRun & { kind: 'plan'; plan: ChatPlan };

const isPlan = (run: DurableRun | undefined): run is PlanRun => Boolean(run && run.kind === 'plan' && run.plan);

/** What the ledger says of a record whose plan stands like this. */
function ledgerStatus(plan: ChatPlan): DurableRun['status'] {
  return plan.status === 'running' ? 'running' : plan.status === 'done' || plan.status === 'cancelled' ? 'finished' : 'waiting';
}

/** Keep a new plan, shown and not started. */
export async function createPlan(projectId: string, plan: ChatPlan): Promise<PlanRun> {
  const at = new Date().toISOString();
  const run: PlanRun = { id: `run_${randomUUID()}`, projectId, kind: 'plan', status: ledgerStatus(plan), startedAt: at, updatedAt: at, question: plan.asked.slice(0, 200), actor: plan.by, steps: [], plan };
  await changeLedger(projectId, (ledger) => upsertRun(ledger, run));
  return run;
}

export async function readPlan(projectId: string, planId: string): Promise<PlanRun | undefined> {
  const run = (await listRuns(projectId)).find((row) => row.id === planId);
  return isPlan(run) ? run : undefined;
}

/** Every plan the ledger holds for a project, the newest first. */
export async function plansOf(projectId: string): Promise<PlanRun[]> {
  return (await listRuns(projectId)).filter(isPlan);
}

/**
 * Change a plan where it is kept, and give it back as it now stands. The
 * change is made to the plan as the ledger has it at that moment, so a stop
 * somebody asked for a moment ago is not written over by a runner that had
 * not heard of it, and of two changes that each look before they write, the
 * second sees what the first wrote.
 *
 * The change is handed the record as it is kept, to tell a run that has gone
 * quiet. One that returns `false` found the plan not as it needed it: the
 * plan is left exactly as it was, and its last word is not moved.
 */
export async function changePlan(projectId: string, planId: string, change: (plan: ChatPlan, kept: PlanRun) => void | false): Promise<PlanRun | undefined> {
  let changed: PlanRun | undefined;
  await changeLedger(projectId, (ledger) => {
    const held = ledger.find((row) => row.id === planId);
    if (!isPlan(held)) return ledger;
    const plan: ChatPlan = structuredClone(held.plan);
    if (change(plan, held) === false) {
      changed = held;
      return ledger;
    }
    changed = { ...held, plan, status: ledgerStatus(plan), updatedAt: new Date().toISOString() };
    return upsertRun(ledger, changed);
  });
  return changed;
}

/** Whether a plan that says it is running has gone quiet for longer than a step may take: its run was cut short. */
export function planCutShort(run: PlanRun, now = new Date()): boolean {
  return runState(run, now.toISOString()) === 'interrupted';
}

/** Whether a plan is over: done or cancelled. One that is shown, running or stopped is not. */
export function planOver(run: PlanRun): boolean {
  return run.plan.status === 'done' || run.plan.status === 'cancelled';
}
