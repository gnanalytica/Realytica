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
 *
 * One go at a time carries a plan out. A go is opened in one change of the
 * ledger, which is where "is it running already?" is asked, and is given a
 * mark of its own (`runToken`). It reads that mark again whenever it looks at
 * the ledger, and writes to the ledger as each paper of a step is done. A go
 * that finds the mark gone or changed is no longer the plan's: it was
 * stopped where it stood, or another go took the plan up. It ends after what
 * it has in hand and writes nothing more to the plan.
 *
 * Any of the workspace's own people may run or take up a plan a colleague
 * laid out. From that moment the plan is theirs: what the go says in the
 * thread is said as theirs, and what each step changed is theirs to undo.
 */

import { randomUUID } from 'node:crypto';
import { proposePlanByModel } from '@realytica/agents';
import {
  PLAN_SAID,
  PLAN_STEP,
  chatSessions,
  isPlanned,
  liveTurns,
  planAct,
  planChoices,
  planCountSaid,
  planIsNamed,
  planMayBeAsked,
  planMayBeMeant,
  planPlaceOf,
  planShownSaid,
  planStandsSaid,
  planStepsIn,
  planWants,
  planWantsHeld,
  splitThread,
  type ChatChoice,
  type ChatPlan,
  type ChatSitting,
  type ChatTurnPlace,
  type ChoicePin,
  type DdProject,
  type PlanStep,
  type PlanWant,
  type ProjectChatTurn,
} from '@realytica/shared';
import { keepTurnChanges, recordBefore } from '../chat-changes';
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
  /** Say this, then run the plan: the go is opened already, and `token` is its mark. */
  | { run: string; token: string; say: PlanReply }
  /** One step, too small to plan, that the chat has no sentence of its own for: do it now and say what it did, and what of the sentence was no step. */
  | { direct: PlanStep; unread?: string[] };

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

const shown = (run: PlanRun): PlanReply => ({ text: planShownSaid(run.plan), choices: planChoices(run.id, run.plan), planId: run.id, summary: `A plan of ${planStepsIn(run.plan).length === 1 ? '1 step' : `${planStepsIn(run.plan).length} steps`}, not started` });
const stands = (run: PlanRun, summary: string): PlanReply => {
  const cut = planCutShort(run);
  return { text: planStandsSaid(run.plan, cut), choices: planChoices(run.id, run.plan, cut), planId: run.id, summary };
};

/**
 * Open a go of a plan as this person's: mark it running, with a mark of the
 * go's own, in one change of the ledger. That change is where "is it running
 * already?" is asked, so of two presses at once the second finds it running
 * and opens nothing. The plan is this person's from here.
 */
async function openRun(ask: PlanAsk, planId: string): Promise<string | undefined> {
  const token = randomUUID();
  let opened = false;
  await changePlan(ask.project.id, planId, (plan, kept) => {
    if (plan.status === 'done' || plan.status === 'cancelled' || (plan.status === 'running' && !planCutShort(kept))) return false;
    opened = true;
    plan.status = 'running';
    plan.runToken = token;
    plan.by = ask.actor;
    delete plan.stopAsked;
    delete plan.stoppedBecause;
    // A step a run that died left as running, or one that failed, is to do again: it picks up from what the record holds now.
    for (const step of plan.steps) if (step.state === 'running' || step.state === 'failed') step.state = 'to_do';
    // This go is ticked off in the chat that started it, on the page it was started from. That need not be where the plan was first asked for.
    if (ask.chat?.sessionId) plan.sessionId = ask.chat.sessionId;
    if (ask.place) plan.place = ask.place;
    return undefined;
  });
  return opened ? token : undefined;
}

/**
 * Stop a plan that is running. A go that is there hears it at its next look
 * at the ledger, ends after what it has in hand, and says so. One that has
 * gone quiet for longer than any step may take is taken for dead: the plan
 * is stopped where it stands and is no longer that go's, so that if it is
 * there after all it ends too, and writes nothing more to the plan.
 */
export async function stopPlan(projectId: string, planId: string): Promise<PlanRun | undefined> {
  return changePlan(projectId, planId, (plan, kept) => {
    if (plan.status !== 'running') return false;
    if (!planCutShort(kept)) {
      plan.stopAsked = true;
      return undefined;
    }
    plan.status = 'stopped';
    delete plan.runToken;
    delete plan.stopAsked;
    return undefined;
  });
}

/** Act on a plan that exists: what a pressed choice or a typed sentence asked of it. */
async function actOn(ask: PlanAsk, run: PlanRun, act: NonNullable<ReturnType<typeof planAct>>): Promise<PlanTurn> {
  const { project } = ask;
  const cut = planCutShort(run);
  if (act.act === 'progress') return { say: stands(run, planCountSaid(run.plan)) };
  if (act.act === 'run' || act.act === 'carry_on') {
    const left = planStepsIn(run.plan).filter((step) => step.state !== 'done');
    const running = (now: PlanRun): PlanTurn => ({ say: { text: `The plan is already running: ${planCountSaid(now.plan)}.`, choices: planChoices(now.id, now.plan), planId: now.id, summary: 'Plan already running' } });
    if (run.plan.status === 'running' && !cut) return running(run);
    if (planOver(run) || !left.length) return { say: stands(run, 'Nothing is left of the plan') };
    const token = await openRun(ask, run.id);
    if (!token) {
      // Another press got there first, or the plan was cancelled in the moment between.
      const now = (await readPlan(project.id, run.id)) ?? run;
      return now.plan.status === 'running' ? running(now) : { say: stands(now, 'Nothing is left of the plan') };
    }
    const again = run.plan.status !== 'shown';
    const steps = left.length === 1 ? '1 step' : `${left.length} steps`;
    // Somebody else laid it out: said, since from here it is this person's.
    const whose = run.plan.by === ask.actor ? '' : ' It is yours from here.';
    const text = again
      ? `Taking ${whose ? 'up the plan a colleague started' : 'the plan up again'}: ${left.length === 1 ? '1 step is' : `${left.length} steps are`} left.${whose} Each is ticked off here as it is done.`
      : `Running the plan${whose ? ' a colleague laid out' : ''}: ${steps}.${whose} Each is ticked off here as it is done, and you can stop it.`;
    return { run: run.id, token, say: { text, planId: run.id, summary: again ? 'Plan taken up again' : 'Plan started' } };
  }
  if (act.act === 'cancel') {
    const running: PlanTurn = { say: { text: 'The plan is running. Stop it first; what is done stays done.', choices: planChoices(run.id, run.plan), planId: run.id, summary: 'Plan is running' } };
    if (run.plan.status === 'running' && !cut) return running;
    const next = await changePlan(project.id, run.id, (plan, kept) => {
      if (plan.status === 'running' && !planCutShort(kept)) return false;
      plan.status = 'cancelled';
      // A go that had gone quiet, if it is there after all, ends when it finds its mark gone.
      delete plan.runToken;
      return undefined;
    });
    return next?.plan.status === 'running' ? running : { say: stands(next ?? run, 'Plan cancelled') };
  }
  if (act.act === 'stop') {
    if (run.plan.status !== 'running') return { say: stands(run, 'Plan is not running') };
    const next = await stopPlan(project.id, run.id);
    if (next?.plan.status !== 'running') return { say: stands(next ?? run, 'Plan stopped') };
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

/** The last thing a chat said to its person: this sitting's turns, and those of the earlier chat it carries on. */
function lastSaidIn(project: DdProject, chat: ChatSitting = {}): ProjectChatTurn | undefined {
  return liveTurns(splitThread(project.conversation).conversation, chatSessions(project.conversation), chat).reverse().find((turn) => turn.role === 'assistant');
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
  // "Go ahead", "do it", "carry on": a yes that names no plan answers whatever this chat said last. It runs the plan
  // only where that was the plan's: the plan shown or how it stands, a step ticked off, or what a step of it said.
  // Typed in another chat, or after another reply, it is answered as it always was.
  const assent = said !== undefined && (said.act === 'run' || said.act === 'carry_on') && !planIsNamed(question);
  if (mine && said && !(assent && lastSaidIn(project, ask.chat)?.planId !== mine.id)) return actOn(ask, mine, said);

  // A new job. The rules read its steps. Where they read none and it may still be one, or read some and could place only part of
  // the sentence, a model may lay the whole of it out, held to the list.
  const { wants, unread, asksForPlan } = planWants(question);
  let chosen: PlanWant[] = wants;
  let byModel = false;
  if (ask.modelAvailable && (wants.length ? unread.length > 0 : asksForPlan || planMayBeAsked(question))) {
    const proposed = planWantsHeld(await proposePlanByModel({ instruction: question, caseId: project.id }));
    // Its plan is taken only where it places more of the sentence than the rules did and leaves out no kind of step they read.
    // A step the rules read keeps what they read beside it (which papers, which report): the model only adds what they could not place.
    const kinds = new Set(proposed.map((want) => want.kind));
    if (proposed.length > wants.length && wants.every((want) => kinds.has(want.kind))) {
      const read = [...wants];
      chosen = proposed.map((want) => {
        const at = read.findIndex((held) => held.kind === want.kind);
        return at === -1 ? want : read.splice(at, 1)[0]!;
      });
      byModel = true;
    }
  }
  // What the rules could make no step of. Where a model laid the steps out it read the whole instruction, and nothing is left over.
  const over = byModel ? [] : unread;
  if (!chosen.length) return asksForPlan ? { say: { text: `I could not make a plan of that. ${WHAT_A_PLAN_CAN}`, summary: 'No plan made' } } : undefined;

  const { steps, nothing } = await planStepsFor(ask, chosen);
  const asked = asksForPlan || byModel || chosen.length > 1;
  if (!steps.length) return asked ? { say: { text: [`There is nothing for a plan to do: ${nothing.join(' ')}`, ...(over.length ? [`No step was made of: ${over.map((words) => `“${words}”`).join(', ')}.`] : [])].join('\n'), summary: 'Nothing to plan' } } : undefined;

  if (isPlanned(steps, asksForPlan || byModel)) {
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
    // A plan this person was shown and never ran gives way to the new one. One that was started and stopped has work done, and stays to be taken up.
    for (const old of await plansOf(project.id)) {
      if (old.plan.by === actor && old.plan.status === 'shown') {
        await changePlan(project.id, old.id, (held) => {
          held.status = 'cancelled';
        });
      }
    }
    return { say: shown(await createPlan(project.id, plan)) };
  }

  // One step, small enough to just run. Where the chat has a sentence of its own for it, that sentence does it, as it always has.
  const step = steps[0]!;
  if (step.kind === 'accept_raised' || step.kind === 'write_report' || step.kind === 'keep_meeting') return undefined;
  if (step.kind === 'read_filed' && READ_FILED_REQUEST.test(question)) return undefined;
  return { direct: step, ...(over.length ? { unread: over.slice(0, 6) } : {}) };
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
  /** The mark of the go that was opened for this run (`PlanTurn`). A run with any other mark does nothing. */
  token: string;
  /** Called as each step begins, for whoever is listening. */
  onStep?: (label: string) => void;
  budgetMs?: number;
}

/**
 * Carry a plan out from where it stands, as the go that was opened for it
 * (`token`): every step still to do, in order, until it is done, a person
 * stops it, a step cannot be done, its time for one go is spent, or the plan
 * is found to be no longer this go's. Returns the plan as it stands at the
 * end, with the turn that says so; nothing when the plan was never this
 * go's, or stopped being it. Never throws: a step that fails is said to have
 * failed.
 */
export async function runPlan(input: PlanRunInput): Promise<{ run: PlanRun; closing: ProjectChatTurn } | undefined> {
  const { project, planId, token } = input;
  const began = Date.now();
  const budget = input.budgetMs ?? PLAN_RUN_BUDGET_MS;
  const opened = await readPlan(project.id, planId);
  if (!opened || opened.plan.runToken !== token) return undefined;
  const plan = opened.plan;
  let outOfTime = false;
  /** Set once the plan is found to be no longer this go's: it was stopped where it stood, or another go took it up. */
  let lost = false;
  const mustEnd = async (): Promise<boolean> => {
    if (lost) return true;
    if (Date.now() - began > budget) {
      outOfTime = true;
      return true;
    }
    const now = await readPlan(project.id, planId);
    if (now?.plan.runToken !== token) {
      lost = true;
      return true;
    }
    return Boolean(now.plan.stopAsked);
  };
  /** Write the plan as this go has it, while it is this go's. A stop somebody asked for meanwhile is kept, until the go has ended. */
  const keep = async (): Promise<void> => {
    if (lost) return;
    await changePlan(project.id, planId, (stored) => {
      if (stored.runToken !== token) {
        lost = true;
        return false;
      }
      stored.steps = structuredClone(plan.steps);
      stored.status = plan.status;
      if (plan.stoppedBecause) stored.stoppedBecause = plan.stoppedBecause;
      else delete stored.stoppedBecause;
      if (plan.status !== 'running') {
        delete stored.stopAsked;
        delete stored.runToken;
      }
      return undefined;
    });
  };
  /** The turns a step leaves are the plan's: in its chat, on its page, and what the chat says in them names the plan. */
  const mark = (turns: readonly ProjectChatTurn[]): void => {
    for (const turn of turns) {
      if (!turn.sessionId && plan.sessionId) turn.sessionId = plan.sessionId;
      if (!turn.place && plan.place) turn.place = plan.place;
      turn.actor ??= plan.by;
      if (turn.role === 'assistant') turn.planId ??= planId;
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
    // The record as it stood before the step: what the step changed is kept with the line that ticks it off, and is undone on its own.
    const stood = recordBefore(project);
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
      const tick = planSays(project, plan, `Step ${n} of ${inPlan.length} ${done.complete ? 'done' : 'stopped part way'}. ${step.label}: ${done.said}`, { tool: PLAN_STEP, summary: `${done.complete ? 'Done' : 'Part done'}: ${step.label}`, planId });
      await keepTurnChanges(project, stood, tick);
      await saved();
      await keep();
      if (!done.complete) break;
    } catch (err) {
      step.state = 'failed';
      step.said = err instanceof Error ? err.message : 'It could not be done.';
      plan.stoppedBecause = `Step ${n} could not be done: ${step.said}`;
      const tick = planSays(project, plan, `Step ${n} of ${inPlan.length} could not be done. ${step.label}: ${step.said}`, { tool: PLAN_STEP, summary: `Not done: ${step.label}`, planId });
      // A step that failed part way may have changed something before it did.
      await keepTurnChanges(project, stood, tick);
      await saved();
      break;
    }
  }

  const left = planStepsIn(plan).filter((step) => step.state !== 'done');
  plan.status = left.length ? 'stopped' : 'done';
  if (left.length && outOfTime && !plan.stoppedBecause) plan.stoppedBecause = 'It ran for as long as one go may.';
  await keep();
  // No longer this go's plan: how it stands is not this go's to say. What its steps did is ticked off above, and stays.
  if (lost) return undefined;
  const ended = (await readPlan(project.id, planId)) ?? { ...opened, plan };
  const closing = planSays(project, ended.plan, planStandsSaid(ended.plan), { tool: PLAN_SAID, summary: planCountSaid(ended.plan), planId, choices: planChoices(planId, ended.plan) });
  await saved();
  return { run: ended, closing };
}
