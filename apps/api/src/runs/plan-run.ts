/**
 * A plan in the chat: what a sentence means for one, and running one.
 *
 * `planTurnFor` reads a sentence, or a pressed choice, against the plans the
 * project has. It may be a new job that is big enough to be shown as a plan
 * first; a change to a plan that is shown (a step taken out, the papers
 * narrowed); the word to run it, stop it, take it up again or cancel it; or
 * a question about how far it has got. Anything else is not about a plan and
 * is answered as it always was.
 *
 * `runPlan` carries a plan out. It runs inside the request that approved it
 * and goes on when the page is closed, as a drop of papers does: the caller
 * hands the work to `finishAfterReply`. Each step is carried out by the code
 * that carries its kind out when asked for alone (`plan-steps.ts`), is
 * ticked off in the thread with what it did, and is written to the ledger
 * before the next begins. Between steps, and between the batches of a step
 * that works through many records, the runner looks at the ledger: a person
 * who pressed Stop is heard there, from any instance. A run also stops
 * itself when its time for one go is spent. Either way what was done stays
 * done, the plan says how far it got, and it can be taken up again.
 *
 * A run that dies with its process leaves a plan that says it is running and
 * writes nothing more. The ledger reads that as cut short, and the plan is
 * taken up again from the same place: every step picks up from what the
 * record holds now, so a step half done is not done twice.
 */

import { randomUUID } from 'node:crypto';
import { proposePlanByModel } from '@realytica/agents';
import {
  PLAN_SAID,
  PLAN_STEP,
  isPlanned,
  planAct,
  planChoices,
  planCountSaid,
  planMayBeAsked,
  planMayBeMeant,
  planPlaceOf,
  planShownSaid,
  planStandsSaid,
  planStepsIn,
  planWants,
  planWantsHeld,
  type ChatChoice,
  type ChatPlan,
  type ChatTurnPlace,
  type ChoicePin,
  type DdProject,
  type PlanStep,
  type PlanWant,
  type ProjectChatTurn,
} from '@realytica/shared';
import { READ_FILED_REQUEST } from '../documents/reread';
import { store } from '../store';
import { planStepNarrowed, planStepsFor, runPlanStep, type PlanSetting } from './plan-steps';
import { changePlan, createPlan, planCutShort, planOver, plansOf, readPlan, type PlanRun } from './plans';

/** How long one go of a plan may run before it stops itself and says so. The function it runs in may run longer. */
export const PLAN_RUN_BUDGET_MS = 9 * 60_000;

/* ==================================================================== */
/* What a sentence means for a plan                                       */
/* ==================================================================== */

/** A reply about a plan, for the chat to say as its own. */
export interface PlanReply {
  text: string;
  choices?: ChatChoice[];
  /** The plan the reply shows, so the page can draw it under the reply as it stands. */
  planId?: string;
  summary: string;
}

export type PlanTurn =
  /** Say this, and nothing more is to be done. */
  | { say: PlanReply }
  /** Say this, then run the plan. */
  | { run: string; say: PlanReply }
  /** One step, too small to plan, that the chat has no sentence of its own for: do it now and say what it did. */
  | { direct: PlanStep };

export interface PlanAsk extends PlanSetting {
  question: string;
  /** What a pressed choice carries: the plan it acts on and what it does. */
  pin?: ChoicePin['plan'];
  sessionId?: string;
  turnPlace?: ChatTurnPlace;
  /** Whether a model is set up to propose a plan for words the rules do not read. */
  modelAvailable: boolean;
}

const WHAT_A_PLAN_CAN = 'A plan can read the filed papers, accept what the last reply raised, suggest answers to a questionnaire from the file, write a report or the status, keep the notes of a meeting, and run a saved playbook on papers.';

const shown = (run: PlanRun): PlanReply => ({ text: planShownSaid(run.plan), choices: planChoices(run.id, run.plan), planId: run.id, summary: `A plan of ${planStepsIn(run.plan).length} step(s), not started` });
const stands = (run: PlanRun, summary: string): PlanReply => {
  const cut = planCutShort(run);
  return { text: planStandsSaid(run.plan, cut), choices: planChoices(run.id, run.plan, cut), planId: run.id, summary };
};

/** Act on a plan that exists: what a pressed choice or a typed sentence asked of it. */
async function actOn(ask: PlanAsk, run: PlanRun, act: NonNullable<ReturnType<typeof planAct>>): Promise<PlanTurn> {
  const { project } = ask;
  const cut = planCutShort(run);
  if (act.act === 'progress') return { say: stands(run, planCountSaid(run.plan)) };
  if (act.act === 'run' || act.act === 'carry_on') {
    const left = planStepsIn(run.plan).filter((step) => step.state !== 'done');
    if (run.plan.status === 'running' && !cut) return { say: { text: `The plan is already running: ${planCountSaid(run.plan)}.`, choices: planChoices(run.id, run.plan), planId: run.id, summary: 'Plan already running' } };
    if (planOver(run) || !left.length) return { say: stands(run, 'Nothing is left of the plan') };
    const again = run.plan.status !== 'shown';
    return {
      run: run.id,
      say: {
        text: again ? `Taking the plan up again: ${left.length === 1 ? '1 step is' : `${left.length} steps are`} left. Each is ticked off here as it is done.` : `Running the plan: ${left.length === 1 ? '1 step' : `${left.length} steps`}. Each is ticked off here as it is done, and you can stop it.`,
        planId: run.id,
        summary: again ? 'Plan taken up again' : 'Plan started',
      },
    };
  }
  if (act.act === 'cancel') {
    if (run.plan.status === 'running' && !cut) return { say: { text: 'The plan is running. Stop it first; what is done stays done.', choices: planChoices(run.id, run.plan), planId: run.id, summary: 'Plan is running' } };
    const next = await changePlan(project.id, run.id, (plan) => {
      plan.status = 'cancelled';
    });
    return { say: stands(next ?? run, 'Plan cancelled') };
  }
  if (act.act === 'stop') {
    if (run.plan.status !== 'running' || cut) return { say: stands(run, 'Plan is not running') };
    await changePlan(project.id, run.id, (plan) => {
      plan.stopAsked = true;
    });
    return { say: { text: 'Stopping the plan once what it has in hand is done. What is done stays done, and the rest can be taken up again.', planId: run.id, summary: 'Plan asked to stop' } };
  }
  // The two that change a plan are for one that is shown and has not started.
  if (run.plan.status !== 'shown') return { say: stands(run, 'The plan has started') };
  if (act.act === 'take_out') {
    const step = planStepsIn(run.plan)[act.step - 1];
    if (!step) return { say: { ...shown(run), text: `The plan has no step ${act.step}.\n${planShownSaid(run.plan)}` } };
    const next = await changePlan(project.id, run.id, (plan) => {
      const held = plan.steps.find((other) => other.id === step.id);
      if (held) held.state = 'out';
      if (!planStepsIn(plan).length) plan.status = 'cancelled';
    });
    if (!next) return { say: shown(run) };
    return next.plan.status === 'cancelled' ? { say: { text: 'That was its only step, so the plan is cancelled. Nothing was done.', planId: next.id, summary: 'Plan cancelled' } } : { say: shown(next) };
  }
  if (act.act !== 'narrow') return { say: shown(run) };
  const place = planPlaceOf(act.only);
  const narrowed: Array<{ id: string; step: PlanStep }> = [];
  const empty: string[] = [];
  for (const step of planStepsIn(run.plan)) {
    const next = place ? await planStepNarrowed(ask, step, place) : undefined;
    if (!next) continue;
    if (next.count > 0) narrowed.push({ id: step.id, step: next });
    else empty.push(step.label);
  }
  if (!narrowed.length) {
    const why = empty.length ? `No paper of that page is there for “${empty[0]}”, so the plan is as it was.` : 'No step of this plan works through papers, so there is nothing to narrow.';
    return { say: { ...shown(run), text: `${why}\n${planShownSaid(run.plan)}` } };
  }
  const next = await changePlan(project.id, run.id, (plan) => {
    plan.steps = plan.steps.map((step) => narrowed.find((changed) => changed.id === step.id)?.step ?? step);
  });
  return { say: shown(next ?? run) };
}

/**
 * What a sentence, or a pressed choice, means for plans on this project, or
 * nothing when it means nothing for them.
 */
export async function planTurnFor(ask: PlanAsk): Promise<PlanTurn | undefined> {
  const { project, question, actor } = ask;
  // A pressed choice names its plan. Its sentence is not read.
  if (ask.pin) {
    const run = await readPlan(project.id, ask.pin.id);
    if (!run) return { say: { text: 'That plan is no longer kept, so nothing was done.', summary: 'Plan not found' } };
    return actOn(ask, run, ask.pin.act === 'take_out' ? { act: 'take_out', step: ask.pin.step ?? 0 } : { act: ask.pin.act });
  }
  // A typed sentence is about this person's newest plan that is not over, when it reads as one of the few things said of a plan.
  const mine = planMayBeMeant(question) ? (await plansOf(project.id)).find((run) => !planOver(run) && run.plan.by === actor) : undefined;
  const said = mine ? planAct(question, mine.plan, planCutShort(mine)) : undefined;
  if (mine && said) return actOn(ask, mine, said);

  // A new job. The rules read its steps; where they read none and it may still be one, a model may propose them, held to the list.
  const { wants, unread, asksForPlan } = planWants(question);
  let chosen: PlanWant[] = wants;
  let byModel = false;
  if (!wants.length && ask.modelAvailable && (asksForPlan || planMayBeAsked(question))) {
    chosen = planWantsHeld(await proposePlanByModel({ instruction: question, caseId: project.id }));
    byModel = chosen.length > 0;
  }
  // What the rules could make no step of. Where a model laid the steps out it read the whole instruction, and nothing is left over.
  const over = byModel ? [] : unread;
  if (!chosen.length) return asksForPlan ? { say: { text: `I could not make a plan of that. ${WHAT_A_PLAN_CAN}`, summary: 'No plan made' } } : undefined;

  const { steps, nothing } = await planStepsFor(ask, chosen);
  const asked = asksForPlan || byModel || chosen.length > 1 || over.length > 0;
  if (!steps.length) return asked ? { say: { text: [`There is nothing for a plan to do: ${nothing.join(' ')}`, ...(over.length ? [`No step was made of: ${over.map((words) => `“${words}”`).join(', ')}.`] : [])].join('\n'), summary: 'Nothing to plan' } } : undefined;

  if (isPlanned(steps, asksForPlan || byModel || over.length > 0)) {
    const plan: ChatPlan = {
      asked: question.slice(0, 300),
      status: 'shown',
      steps,
      ...(over.length ? { unread: over.slice(0, 6) } : {}),
      ...(nothing.length ? { nothing: nothing.slice(0, 6) } : {}),
      by: actor,
      ...(ask.sessionId ? { sessionId: ask.sessionId } : {}),
      ...(ask.turnPlace ? { place: ask.turnPlace } : {}),
      ...(byModel ? { byModel: true } : {}),
    };
    return { say: shown(await createPlan(project.id, plan)) };
  }

  // One step, small enough to just run. Where the chat has a sentence of its own for it, that sentence does it, as it always has.
  const step = steps[0]!;
  if (step.kind === 'accept_raised' || step.kind === 'write_report' || step.kind === 'keep_meeting') return undefined;
  if (step.kind === 'read_filed' && READ_FILED_REQUEST.test(question)) return undefined;
  return { direct: step };
}

/* ==================================================================== */
/* Running one                                                            */
/* ==================================================================== */

/** A line the plan leaves in the thread: said by the chat, in the chat the plan was asked in. */
export function planSays(project: DdProject, plan: Pick<ChatPlan, 'by' | 'sessionId' | 'place'>, text: string, more: { tool: string; summary: string; planId?: string; choices?: ChatChoice[] }): ProjectChatTurn {
  const turn: ProjectChatTurn = {
    id: `cht_${randomUUID()}`,
    role: 'assistant',
    text,
    at: new Date().toISOString(),
    actor: plan.by,
    citedEvidenceIds: [],
    toolCalls: [{ name: more.tool, summary: more.summary }],
    ...(plan.sessionId ? { sessionId: plan.sessionId } : {}),
    ...(plan.place ? { place: plan.place } : {}),
    ...(more.planId ? { planId: more.planId } : {}),
    ...(more.choices?.length ? { choices: more.choices } : {}),
  };
  project.conversation.push(turn);
  return turn;
}

export interface PlanRunInput extends PlanSetting {
  planId: string;
  /** Called as each step begins, for whoever is listening. */
  onStep?: (label: string) => void;
  budgetMs?: number;
}

/**
 * Carry a plan out from where it stands: every step still to do, in order,
 * until it is done, a person stops it, a step cannot be done, or its time
 * for one go is spent. Returns the plan as it stands at the end, with the
 * turn that says so. Never throws: a step that fails is said to have failed.
 */
export async function runPlan(input: PlanRunInput): Promise<{ run: PlanRun; closing: ProjectChatTurn } | undefined> {
  const { project, planId } = input;
  const began = Date.now();
  const budget = input.budgetMs ?? PLAN_RUN_BUDGET_MS;
  const opened = await changePlan(project.id, planId, (plan) => {
    plan.status = 'running';
    delete plan.stopAsked;
    delete plan.stoppedBecause;
    // A step a run that died left as running, or one that failed, is to do again: it picks up from what the record holds now.
    for (const step of plan.steps) if (step.state === 'running' || step.state === 'failed') step.state = 'to_do';
  });
  if (!opened) return undefined;
  const plan = opened.plan;
  let outOfTime = false;
  const mustEnd = async (): Promise<boolean> => {
    if (Date.now() - began > budget) {
      outOfTime = true;
      return true;
    }
    return Boolean((await readPlan(project.id, planId))?.plan.stopAsked);
  };
  /** Write the plan as this run has it. A stop somebody asked for meanwhile is kept, until the run has ended. */
  const keep = async (): Promise<void> => {
    await changePlan(project.id, planId, (stored) => {
      stored.steps = structuredClone(plan.steps);
      stored.status = plan.status;
      if (plan.stoppedBecause) stored.stoppedBecause = plan.stoppedBecause;
      else delete stored.stoppedBecause;
      if (plan.status !== 'running') delete stored.stopAsked;
    });
  };
  /** The turns a step leaves are the plan's: in its chat, on its page. */
  const mark = (turns: readonly ProjectChatTurn[]): void => {
    for (const turn of turns) {
      if (!turn.sessionId && plan.sessionId) turn.sessionId = plan.sessionId;
      if (!turn.place && plan.place) turn.place = plan.place;
      turn.actor ??= plan.by;
    }
  };
  const saved = async (): Promise<void> => {
    project.updatedAt = new Date().toISOString();
    await store.save();
  };

  const inPlan = planStepsIn(plan);
  for (const step of inPlan) {
    if (step.state === 'done') continue;
    const n = inPlan.indexOf(step) + 1;
    if (await mustEnd()) break;
    step.state = 'running';
    await keep();
    input.onStep?.(`Step ${n} of ${inPlan.length}: ${step.label}`);
    try {
      const done = await runPlanStep({
        ...input,
        step,
        mustEnd,
        progress: async (did) => {
          step.did = did;
          await keep();
        },
        wrote: mark,
      });
      step.did = done.did;
      step.said = done.said;
      step.state = done.complete ? 'done' : 'to_do';
      if (done.complete) step.endedAt = new Date().toISOString();
      planSays(project, plan, `Step ${n} of ${inPlan.length} ${done.complete ? 'done' : 'stopped part way'}. ${step.label}: ${done.said}`, { tool: PLAN_STEP, summary: `${done.complete ? 'Done' : 'Part done'}: ${step.label}` });
      await saved();
      await keep();
      if (!done.complete) break;
    } catch (err) {
      step.state = 'failed';
      step.said = err instanceof Error ? err.message : 'It could not be done.';
      plan.stoppedBecause = `Step ${n} could not be done: ${step.said}`;
      planSays(project, plan, `Step ${n} of ${inPlan.length} could not be done. ${step.label}: ${step.said}`, { tool: PLAN_STEP, summary: `Not done: ${step.label}` });
      await saved();
      break;
    }
  }

  const left = planStepsIn(plan).filter((step) => step.state !== 'done');
  plan.status = left.length ? 'stopped' : 'done';
  if (left.length && outOfTime && !plan.stoppedBecause) plan.stoppedBecause = 'It ran for as long as one go may.';
  await keep();
  const ended = (await readPlan(project.id, planId)) ?? { ...opened, plan };
  const closing = planSays(project, ended.plan, planStandsSaid(ended.plan), { tool: PLAN_SAID, summary: planCountSaid(ended.plan), planId, choices: planChoices(planId, ended.plan) });
  await saved();
  return { run: ended, closing };
}
