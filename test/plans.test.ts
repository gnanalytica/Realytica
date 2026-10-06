/**
 * A plan: the steps of a job, shown before any of it starts.
 *
 * One test for each rule of the words. That an instruction is read as steps
 * of the fixed kinds, in order, and what is none of them is given back in
 * its own words. Where the line is between a job that just runs and one
 * that is planned. What a sentence does to a plan, by where the plan stands.
 * That a model's proposal is held to the list. That the ledger keeps a plan
 * that is not over, says how far it has got, and never reads one that waits
 * as cut short. Running a plan is proved over HTTP in
 * `plans-route.test.ts`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_ABOVE,
  PLAN_STEP_KINDS,
  RUN_LEDGER_LIMIT,
  describeRun,
  isPlanned,
  planAct,
  planChoices,
  planListedIn,
  planMayBeAsked,
  planPlaceOf,
  planShownSaid,
  planStandsSaid,
  planStepLabel,
  planWants,
  planWantsHeld,
  runState,
  upsertRun,
  type ChatPlan,
  type DurableRun,
  type PlanStep,
} from '@realytica/shared';

const step = (more: Partial<PlanStep> & Pick<PlanStep, 'kind' | 'count'>): PlanStep => ({ id: `stp_${more.kind}`, state: 'to_do', label: planStepLabel(more), ...more });

const plan = (steps: PlanStep[], more: Partial<ChatPlan> = {}): ChatPlan => ({ asked: 'the instruction', status: 'shown', steps, by: 'lead@example.com', ...more });

describe('an instruction read as steps', () => {
  it('is the fixed kinds in the order given, each with what narrows it', () => {
    const read = planWants('Read the filed papers, then suggest answers to the questionnaire and write this week’s status for the owner');
    assert.deepEqual(read.wants.map((want) => [want.kind, want.report]), [['read_filed', undefined], ['suggest_answers', undefined], ['write_report', 'status']]);
    assert.deepEqual([read.unread, read.asksForPlan], [[], false]);

    assert.deepEqual(planWants('Read the title papers again').wants, [{ kind: 'read_filed', said: 'Read the title papers again', again: true, only: 'title' }]);
    assert.deepEqual(planWants('Approve all and generate the red flag report').wants.map((want) => [want.kind, want.form, want.report]), [['accept_raised', 'last', undefined], ['write_report', undefined, 'red_flag']]);
    assert.deepEqual(planWants('Run the title playbook on the legal papers').wants, [{ kind: 'run_playbook', said: 'Run the title playbook on the legal papers', playbook: 'title', only: 'legal' }]);
    assert.deepEqual(planWants('1. Read the filed documents\n2. Keep the notes as a meeting').wants.map((want) => want.kind), ['read_filed', 'keep_meeting']);
    assert.equal(planWants('Plan: read the filed papers').asksForPlan, true);
  });

  it('gives back, in its own words, what is none of them', () => {
    const read = planWants('Read the filed papers and then tell the owner a joke');
    assert.deepEqual([read.wants.map((want) => want.kind), read.unread], [['read_filed'], ['tell the owner a joke']]);
    for (const asked of ['What is the status of the khata?', 'How far along is the work?', 'Summarise this file']) assert.deepEqual(planWants(asked).wants, [], asked);
  });

  it('reads on its own what is asked in the same breath, so a step never swallows it', () => {
    const read = planWants('Go through everything on file, fill what you can in the lender’s questionnaire and tell the owner where we are. Thanks!');
    assert.deepEqual(read.wants, [{ kind: 'suggest_answers', said: 'fill what you can in the lender’s questionnaire' }]);
    assert.deepEqual(read.unread, ['Go through everything on file', 'tell the owner where we are'], 'and a word of thanks is no part of the job');
    assert.deepEqual(planWants('Generate the open risk and action report').wants.map((want) => want.report), ['open_risk_action'], 'an “and” inside the name of a thing splits nothing');
  });

  it('names a page of the menu only by its own word, and never by a guess', () => {
    assert.deepEqual(planPlaceOf('title'), { fn: 'legal.title' });
    assert.deepEqual(planPlaceOf('the legal'), { department: 'legal' });
    assert.equal(planPlaceOf('important'), undefined);
    assert.equal(planPlaceOf('title see what the lender can take'), undefined, 'words that say more than the page name none');
    assert.deepEqual(planWants('Read the title papers again, see what the questionnaire can take from them'), { wants: [{ kind: 'read_filed', said: 'Read the title papers again', again: true, only: 'title' }], unread: ['see what the questionnaire can take from them'], asksForPlan: false });
  });

  it('may be a job for a model to lay out only when it is an instruction that names two kinds of thing', () => {
    assert.equal(planMayBeAsked('Go through everything on file, fill what you can in the lender’s questionnaire and tell the owner where we are with a status'), true);
    assert.equal(planMayBeAsked('What do the papers say about the questionnaire?'), false, 'a question');
    assert.equal(planMayBeAsked('Tell me about the papers on this file please'), false, 'one kind of thing');
  });
});

describe('where the line is', () => {
  it('plans a job of more than one step, or one step over more than ten records, or a plan asked for', () => {
    assert.equal(PLAN_ABOVE, 10);
    assert.equal(isPlanned([step({ kind: 'read_filed', count: 10 })]), false, 'ten papers is one reading turn, and just runs');
    assert.equal(isPlanned([step({ kind: 'read_filed', count: 11 })]), true);
    assert.equal(isPlanned([step({ kind: 'suggest_answers', count: 60 })]), true);
    assert.equal(isPlanned([step({ kind: 'read_filed', count: 2 }), step({ kind: 'write_report', count: 1, report: 'red_flag' })]), true, 'two kinds of step');
    assert.equal(isPlanned([step({ kind: 'read_filed', count: 2 })], true), true, 'asked for by name');
    assert.equal(isPlanned([]), false);
  });

  it('never plans an instruction to accept by its size alone', () => {
    assert.equal(isPlanned([step({ kind: 'accept_raised', count: 40, form: 'last' })]), false, 'it is already the approval of each thing it names');
  });
});

describe('a plan as it is said', () => {
  const shown = plan([step({ kind: 'read_filed', count: 14 }), step({ kind: 'suggest_answers', count: 60 }), step({ kind: 'write_report', count: 1, report: 'status', period: { from: '2026-09-28T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z' }, audience: 'the owner' })]);

  it('names each step with what it will touch and how many, and says running it accepts nothing', () => {
    assert.deepEqual(planShownSaid(shown).split('\n'), [
      'That is 3 steps, so nothing has started. The plan:',
      '1. Read 14 filed papers.',
      '2. Suggest answers to 60 questions from the file.',
      '3. Write the status for 28 Sep to 4 Oct 2026, for the owner.',
      'Run it, take a step out (“take step 2 out”), narrow the papers (“only the title papers”), or cancel. Running it accepts nothing it raises: every value still waits for you.',
    ]);
    assert.deepEqual(planChoices('run_1', shown).map((choice) => [choice.label, choice.sitting?.plan]), [['Run the plan', { id: 'run_1', act: 'run' }], ['Cancel', { id: 'run_1', act: 'cancel' }]]);
    assert.equal(planStepLabel({ kind: 'read_filed', count: 1, fn: 'legal.title', again: true }), 'Read 1 filed paper again, only Title');
    assert.equal(planStepLabel({ kind: 'write_report', count: 1, report: 'red_flag' }), 'Put the red flag report on a card, to be generated when you accept it');
  });

  it('says how far it got when it is stopped, with what is done and what is left', () => {
    const stopped = plan(
      [
        { ...shown.steps[0]!, state: 'done', said: 'Read 14 filed papers. 31 values wait on the papers to be accepted.' },
        { ...shown.steps[1]!, state: 'out' },
        shown.steps[2]!,
      ],
      { status: 'stopped' },
    );
    assert.deepEqual(planStandsSaid(stopped).split('\n'), [
      'The plan is stopped: 1 of 2 steps done. What was done stays done.',
      '1. Read 14 filed papers. Done: Read 14 filed papers. 31 values wait on the papers to be accepted.',
      '2. Write the status for 28 Sep to 4 Oct 2026, for the owner. Left.',
      'Say “carry on with the plan” to take up what is left.',
    ]);
    assert.deepEqual(planChoices('run_1', stopped).map((choice) => choice.sitting?.plan?.act), ['carry_on', 'cancel']);
    // A page that draws the plan under these words lists its steps again only once the plan has moved on from them.
    assert.equal(planListedIn(planStandsSaid(stopped), stopped), true);
    assert.equal(planListedIn(planShownSaid(shown), stopped), false, 'said before it ran');
  });

  it('says a cancelled plan in a line when nothing of it ran, and what was not run when some did', () => {
    assert.equal(planStandsSaid(plan(shown.steps, { status: 'cancelled' })), 'The plan is cancelled. Nothing was done.');
    const part = plan([{ ...shown.steps[0]!, state: 'done', said: 'Read 14 filed papers. Nothing they state is waiting.' }, shown.steps[1]!], { status: 'cancelled' });
    assert.deepEqual(planStandsSaid(part).split('\n'), [
      'The plan was cancelled: 1 of 2 steps done. What was done stays done.',
      '1. Read 14 filed papers. Done: Read 14 filed papers. Nothing they state is waiting.',
      '2. Suggest answers to 60 questions from the file. Not run.',
    ]);
  });
});

describe('what a sentence does to a plan', () => {
  it('is read by where the plan stands, and only in full', () => {
    const at = (status: ChatPlan['status'], sentence: string, cut = false) => planAct(sentence, { status }, cut);
    assert.deepEqual(at('shown', 'Run it.'), { act: 'run' });
    assert.deepEqual(at('shown', 'go ahead'), { act: 'run' });
    assert.deepEqual(at('shown', 'Take step 2 out'), { act: 'take_out', step: 2 });
    assert.deepEqual(at('shown', 'only the title papers'), { act: 'narrow', only: 'title' });
    assert.deepEqual(at('shown', 'cancel the plan'), { act: 'cancel' });
    assert.equal(at('shown', 'only the important papers'), undefined, 'not a page of the menu');
    assert.equal(at('shown', 'run the valuation'), undefined, 'a sentence about something else');
    assert.deepEqual(at('running', 'Stop'), { act: 'stop' });
    assert.equal(at('running', 'run it'), undefined, 'a plan that is running is not run again');
    assert.deepEqual(at('stopped', 'carry on with the plan'), { act: 'carry_on' });
    assert.deepEqual(at('running', 'carry on', true), { act: 'carry_on' }, 'one whose run was cut short is taken up again');
    assert.deepEqual(at('stopped', 'how is the plan going'), { act: 'progress' });
    assert.equal(at('done', 'run it'), undefined);
  });
});

describe('a model’s proposal for a plan', () => {
  it('is held to the fixed kinds, and to short plain words beside them', () => {
    const held = planWantsHeld([
      { kind: 'read_filed', only: 'Title', again: null, form: null, report: null, period: null, playbook: null },
      // Not a kind a plan has.
      { kind: 'email_the_owner', only: null },
      // A kind it has, with words that are not plain: dropped from the step, which stays.
      { kind: 'run_playbook', playbook: 'x'.repeat(200), only: 'legal\nand everything else' },
      { kind: 'write_report', report: 'status', period: 'for September' },
      { kind: 'write_report', report: 'a report of my own' },
      'not a step',
    ]);
    assert.deepEqual(held, [
      { kind: 'read_filed', said: 'read filed', only: 'title' },
      { kind: 'run_playbook', said: 'run playbook' },
      { kind: 'write_report', said: 'write the status for September', report: 'status' },
      { kind: 'write_report', said: 'write report', report: 'executive_dd' },
    ]);
    assert.ok(held.every((want) => (PLAN_STEP_KINDS as readonly string[]).includes(want.kind)));
    assert.deepEqual(planWantsHeld('a sentence'), []);
  });
});

describe('a plan in the run ledger', () => {
  const record = (id: string, more: Partial<DurableRun> = {}): DurableRun => ({ id, projectId: 'prj_1', kind: 'chat_model', status: 'finished', startedAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z', steps: [], ...more });
  const stopped = record('run_plan', { kind: 'plan', status: 'waiting', plan: plan([step({ kind: 'read_filed', count: 14 }), { ...step({ kind: 'suggest_answers', count: 60 }), state: 'done' }], { status: 'stopped' }) });

  it('is kept past the limit while it is not over, and let go once it is', () => {
    let ledger: DurableRun[] = [stopped];
    for (let i = 0; i < RUN_LEDGER_LIMIT + 3; i += 1) ledger = upsertRun(ledger, record(`run_${i}`));
    assert.equal(ledger.length, RUN_LEDGER_LIMIT + 1);
    assert.ok(ledger.some((run) => run.id === 'run_plan'), 'twenty questions since have not lost it');
    let over: DurableRun[] = [{ ...stopped, status: 'finished', plan: { ...stopped.plan!, status: 'done' } }];
    for (let i = 0; i < RUN_LEDGER_LIMIT + 3; i += 1) over = upsertRun(over, record(`run_${i}`));
    assert.ok(!over.some((run) => run.id === 'run_plan'));
  });

  it('is never read as cut short while it waits, and says how far it got', () => {
    assert.equal(runState(stopped, '2026-10-09T09:00:00.000Z'), 'waiting');
    assert.equal(describeRun(stopped, '2026-10-09T09:00:00.000Z'), 'Plan — 1 of 2 step(s) done, stopped. It can be taken up again from the chat.');
    const died = { ...stopped, status: 'running' as const, plan: { ...stopped.plan!, status: 'running' as const } };
    assert.equal(runState(died, '2026-10-01T09:10:00.000Z'), 'interrupted');
    assert.match(describeRun(died, '2026-10-01T09:10:00.000Z'), /1 of 2 step\(s\) done, cut short\. What was done stays done\./);
  });
});
