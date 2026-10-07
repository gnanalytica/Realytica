/**
 * Plans in the chat, over real HTTP.
 *
 * `plans.test.ts` proves the words. This proves they are wired: that a job
 * over many records is shown as a plan and nothing of it starts; that a step
 * is taken out and the papers narrowed by a sentence; that the plan runs
 * step by step when a person runs it, ticks each step off in the thread, and
 * accepts nothing it raises; that it is stopped part way with what it did
 * kept, is on the record through the ledger for a page that was never open,
 * and is taken up again from where it stopped; that one go at a time carries
 * a plan out, however Run is pressed, and a go whose plan was taken up by
 * another ends; that a plan a colleague laid out is the runner's from the
 * moment they run it; that a small job just runs; and that a model's
 * proposal for words the rules do not read is held to the fixed kinds and
 * still shown before it starts.
 *
 * Booted with no graph database and no model: the papers are read by rule.
 * A model is set up for the one test that needs one, and is a script. No
 * other address can be reached. Every name and paper is invented.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  acceptedFacts,
  addEvidence,
  addQuestionnaire,
  attachEvidenceFile,
  createProject,
  proposedFacts,
  questionnaireSummary,
  type ChatChoice,
  type ChatPlan,
  type DdProject,
  type ProjectChatTurn,
} from '@realytica/shared';

const MODEL_BASE = 'http://plans.test';
const LEAD = 'lead@example.com';

let server: Server;
let base: string;
let dataDir: string;
const realFetch = globalThis.fetch;

/** What the scripted model was asked for, by tool, and what it proposes as a plan. */
let asked: string[] = [];
let proposes: unknown[] = [];

function streamed(tool: string, input: unknown): Response {
  const event = (name: string, data: unknown): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const body = [
    event('message_start', { type: 'message_start', message: { id: 'msg_plan', type: 'message', role: 'assistant', model: 'vendor/basic', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 200, output_tokens: 1 } } }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_0', name: tool, input: {} } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 40 } }),
    event('message_stop', { type: 'message_stop' }),
  ].join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A typed page, which this server reads in a moment by rule, with no model. */
async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((text, i) => page.drawText(text, { x: 40, y: 780 - i * 22, size: 11, font }));
  return Buffer.from(await doc.save());
}

const PAPERS: Array<[string, string[]]> = [
  ['Khata certificate', ['KHATA CERTIFICATE', 'Khata No. 112/4', 'Site area: 1,115 square metres']],
  ['Tax receipt', ['PROPERTY TAX RECEIPT', 'SAS Application No. 2024-25-0047 for the assessment year 2024-25', 'Tax paid: Rs. 47,616 on 11-05-2024']],
  ['Zoning certificate', ['ZONING CERTIFICATE', 'The land bearing Survey No. 19/2 is classified as Residential (Mixed) in the plan in force.']],
];

/** A project with papers filed on the register and not read, the first `title` of them on the Title page, and a questionnaire of three open questions. */
async function filed(papers: number, title = 0): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  const { storageAdapter } = await import('../apps/api/src/storage');
  const project = createProject({ name: 'Northfield corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, `RYT-${Math.random().toString(36).slice(2, 8)}`);
  for (let n = 0; n < papers; n += 1) {
    const [name, lines] = PAPERS[n % PAPERS.length]!;
    const row = addEvidence(project, { title: `${name} ${n + 1}`, kind: 'document' }, LEAD);
    if (n < title) row.workstream = 'legal.title';
    const bytes = await pdfOf(lines);
    const storageKey = `paper-${project.id}-${n}.pdf`;
    await storageAdapter.putDocument(project.id, storageKey, bytes, 'application/pdf');
    attachEvidenceFile(project, row.id, { fileName: `${name.toLowerCase().replace(/ /g, '-')}-${n + 1}.pdf`, mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey }, LEAD);
  }
  addQuestionnaire(project, { title: 'Lender’s questions', parsed: { header: [], questions: [{ text: 'What is the khata number?' }, { text: 'Has the property tax been paid, and for which year?' }, { text: 'Who is the architect?' }] } }, LEAD);
  store.data.projects!.push(project);
  await store.save();
  return project;
}

const stored = async (id: string): Promise<DdProject> => (await import('../apps/api/src/store')).store.data.projects!.find((held) => held.id === id)!;

interface Answered {
  userTurn: ProjectChatTurn;
  assistantTurn: ProjectChatTurn & { choices?: ChatChoice[] };
  steps: string[];
}

/** Say something to the chat, or press a choice: the reply, and the lines it sent as it worked. `onStep` is told each line as it arrives. */
async function say(projectId: string, question: string, sitting?: ChatChoice['sitting'], onStep?: (label: string) => void, sessionId?: string): Promise<Answered> {
  const res = await realFetch(`${base}/api/projects/${projectId}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, ...(sitting ? { sitting } : {}), ...(sessionId ? { sessionId } : {}) }) });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const steps: string[] = [];
  let result: Answered | undefined;
  let kept = '';
  for (;;) {
    const { value, done } = await reader.read();
    kept += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = kept.split('\n');
    kept = lines.pop() ?? '';
    for (const line of lines.filter(Boolean)) {
      const read = JSON.parse(line) as { type: string; step?: { label: string } };
      if (read.type === 'step' && read.step) {
        steps.push(read.step.label);
        onStep?.(read.step.label);
      }
      if (read.type === 'result') result = read as unknown as Answered;
    }
    if (done) break;
  }
  assert.ok(result, 'the chat answered');
  return { ...result, steps };
}

const planOf = async (projectId: string, planId: string): Promise<{ plan: ChatPlan; cutShort: boolean; over: boolean }> =>
  (await (await realFetch(`${base}/api/projects/${projectId}/plans/${planId}`)).json()) as { plan: ChatPlan; cutShort: boolean; over: boolean };

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-plans-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  // Every case here speaks to the chat, and together they are more than one person sends in a minute.
  process.env.REALYTICA_RATE_LIMIT_MODEL = '500';
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(MODEL_BASE)) throw new Error('this test has no network');
    const raw = input instanceof Request ? await input.text() : String(init?.body ?? '{}');
    const tool = (JSON.parse(raw) as { tool_choice?: { name?: string } }).tool_choice?.name ?? 'none';
    asked.push(tool);
    if (tool === 'propose_plan') return streamed(tool, { steps: proposes });
    if (tool === 'reword_status_lines') return streamed(tool, { lines: [] });
    return new Response('{"type":"error","error":{"message":"not scripted"}}', { status: 500, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  globalThis.fetch = realFetch;
  const { releaseOcr } = await import('../apps/api/src/documents/read-text');
  await releaseOcr();
  // A plan goes on after its reply: let that end before its directory goes.
  const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
  await afterReplyWorkDone();
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_AUTH_MODE', 'REALYTICA_DATA_DIR', 'REALYTICA_RATE_LIMIT_MODEL']) delete process.env[name];
});

describe('a job over many records', () => {
  let project: DdProject;
  let planId: string;

  it('is shown as a plan, and nothing of it starts', async () => {
    project = await filed(12, 5);
    const shown = await say(project.id, 'Read the filed papers, then suggest answers to the questionnaire and write the status for September 2026');
    planId = shown.assistantTurn.planId!;
    assert.ok(planId, 'the reply names its plan');
    assert.deepEqual(shown.assistantTurn.text.split('\n').slice(0, 4), ['That is 3 steps, so nothing has started. The plan:', '1. Read 12 filed papers.', '2. Suggest answers to 3 questions from the file.', '3. Write the status for September 2026.']);
    assert.deepEqual(shown.assistantTurn.choices?.map((choice) => [choice.label, choice.sitting?.plan?.act]), [['Run the plan', 'run'], ['Cancel', 'cancel']]);
    const now = await stored(project.id);
    assert.ok(now.evidence.every((row) => !row.facts?.length), 'no paper was read');
    assert.equal(questionnaireSummary(now.questionnaires![0]!).suggested, 0);
    assert.deepEqual([(await planOf(project.id, planId)).plan.status, now.reports.length], ['shown', 0]);
  });

  it('has a step taken out and its papers narrowed by a sentence, and is counted again', async () => {
    const without = await say(project.id, 'Take step 3 out');
    assert.deepEqual(without.assistantTurn.text.split('\n').slice(0, 3), ['That is 2 steps, so nothing has started. The plan:', '1. Read 12 filed papers.', '2. Suggest answers to 3 questions from the file.']);
    const narrowed = await say(project.id, 'Only the title papers');
    assert.equal(narrowed.assistantTurn.text.split('\n')[1], '1. Read 5 filed papers, only Title.');
    assert.equal(narrowed.assistantTurn.planId, planId, 'the same plan, changed');
    const vague = await say(project.id, 'Only the finance papers');
    assert.match(vague.assistantTurn.text, /^No paper of that page is there for “Read 5 filed papers, only Title”, so the plan is as it was\./);
    assert.deepEqual((await planOf(project.id, planId)).plan.steps.map((step) => [step.kind, step.state, step.count]), [['read_filed', 'to_do', 5], ['suggest_answers', 'to_do', 3], ['write_report', 'out', 1]]);
  });

  it('runs step by step when a person runs it, ticks each off in the thread, and accepts nothing it raises', async () => {
    const before = (await stored(project.id)).conversation.length;
    const ran = await say(project.id, 'Run the plan', { plan: { id: planId, act: 'run' } });
    assert.deepEqual(ran.steps, ['Step 1 of 2: Read 5 filed papers, only Title', 'Step 2 of 2: Suggest answers to 3 questions from the file']);
    assert.match(ran.assistantTurn.text, /^The plan is done: 2 of 2 steps done\./);

    const now = await stored(project.id);
    const said = now.conversation.slice(before).filter((turn) => turn.role === 'assistant').map((turn) => turn.text.split('\n')[0]);
    assert.equal(said[0], 'Running the plan: 2 steps. Each is ticked off here as it is done, and you can stop it.');
    assert.ok(said.some((line) => /^Step 1 of 2 done\. Read 5 filed papers, only Title: Read 5 filed papers\. \d+ values wait on them to be accepted\.$/.test(line!)), said.join(' | '));
    assert.ok(said.some((line) => /^Step 2 of 2 done\. Suggest answers to 3 questions from the file: Suggested answers to 0 questions from what stands on the file\. 3 questions are still open\.$/.test(line!)), said.join(' | '));

    // Five papers were read and seven were not; what the five state waits on their rows, and nothing was accepted or answered.
    const read = now.evidence.filter((row) => row.facts?.length);
    assert.deepEqual([read.length, read.every((row) => row.workstream === 'legal.title')], [5, true]);
    assert.ok(read.every((row) => proposedFacts(row).length > 0 && acceptedFacts(row).length === 0), 'every value still waits for a person');
    assert.ok(now.chatProposals.every((card) => card.status !== 'committed'), 'no card was accepted');
    assert.equal(questionnaireSummary(now.questionnaires![0]!).answered, 0, 'what only waits on a paper answers no question');
    assert.deepEqual([(await planOf(project.id, planId)).plan.status, (await planOf(project.id, planId)).over], ['done', true]);
  });
});

describe('a plan that is stopped', () => {
  let project: DdProject;
  let planId: string;
  /** How many papers it had read when it stopped. */
  let did: number;

  it('ends after what it has in hand, keeps what it did, and says what is left', async () => {
    project = await filed(12);
    planId = (await say(project.id, 'Read the filed documents')).assistantTurn.planId!;
    assert.ok(planId, 'twelve papers is more than one reading turn takes, so it is planned');
    // Stop is pressed as the first step begins: the step ends after the papers it has in hand.
    let stop: Promise<Response> | undefined;
    const ran = await say(project.id, 'Run the plan', { plan: { id: planId, act: 'run' } }, () => {
      stop ??= realFetch(`${base}/api/projects/${project.id}/plans/${planId}/stop`, { method: 'POST' });
    });
    assert.equal((await stop!).status, 200);
    // It is heard between one go of five papers and the next: before the first, or after it. Never part way through one, and never after the last.
    did = (await planOf(project.id, planId)).plan.steps[0]!.did ?? 0;
    assert.ok(did === 0 || did === 5, `it stopped at the edge of a go, with ${did} read`);
    const lines = ran.assistantTurn.text.split('\n');
    assert.equal(lines[0], 'The plan is stopped: 0 of 1 step done. What was done stays done.');
    assert.ok(lines[1]!.startsWith(`1. Read 12 filed papers. Part done: Read ${did} filed papers`), lines[1]);
    assert.deepEqual(ran.assistantTurn.choices?.map((choice) => choice.sitting?.plan?.act), ['carry_on', 'cancel']);
    assert.equal((await stored(project.id)).evidence.filter((row) => row.facts?.length).length, did, 'what it read stays read, and nothing else was');
  });

  it('is on the record for a page that was never open, with how far it got', async () => {
    const open = (await (await realFetch(`${base}/api/projects/${project.id}/plans`)).json()) as { plans: Array<{ id: string; plan: ChatPlan; over: boolean }> };
    assert.deepEqual(open.plans.map((held) => [held.id, held.plan.status, held.plan.steps[0]!.did ?? 0, held.over]), [[planId, 'stopped', did, false]]);
    const runs = (await (await realFetch(`${base}/api/projects/${project.id}/runs`)).json()) as { runs: Array<{ id: string; state: string; line: string }> };
    assert.deepEqual(runs.runs.filter((run) => run.id === planId).map((run) => [run.state, run.line]), [['waiting', 'Plan — 0 of 1 step(s) done, stopped. It can be taken up again from the chat.']]);
  });

  it('is taken up again from where it stopped, and ticked off in the chat that took it up', async () => {
    // Taken up from a chat opened later: the page was closed and opened again.
    const again = await say(project.id, 'Carry on with the plan', undefined, undefined, 'sit_later');
    assert.match(again.assistantTurn.text, /^The plan is done: 1 of 1 step done\./);
    const ticks = (await stored(project.id)).conversation.filter((turn) => turn.toolCalls?.some((call) => call.name === 'plan_step'));
    assert.deepEqual([ticks.at(-1)!.sessionId, again.assistantTurn.sessionId], ['sit_later', 'sit_later'], 'this go is said where the person is, not in the chat the plan was first asked in');
    assert.equal((await stored(project.id)).evidence.filter((row) => row.facts?.length).length, 12, 'the papers left were read');
    const step = (await planOf(project.id, planId)).plan.steps[0]!;
    assert.deepEqual([step.did, new Set(step.readIds).size, step.said?.split('.')[0]], [12, 12, 'Read 12 filed papers'], 'the step says what it read in all');
    // The reader leaves a note in the thread for each go, with how many papers it was handed. Over both goes that is each paper once.
    const handed = (await stored(project.id)).conversation.flatMap((turn) => (turn.toolCalls ?? []).map((call) => /^Read (\d+) documents? filed on the register/.exec(call.summary)?.[1])).filter(Boolean);
    assert.equal(handed.reduce((sum, n) => sum + Number(n), 0), 12, 'and the ones read before were not read twice');
  });
});

describe('one go at a time', () => {
  /** How often each paper's file is fetched to be read, while `work` runs. `held` is called with each fetch, and may make it wait. */
  async function fetches<T>(work: (counts: Map<string, number>) => Promise<T>, held: (nth: number) => Promise<void> = async () => undefined): Promise<{ counts: Map<string, number>; out: T }> {
    const { storageAdapter } = await import('../apps/api/src/storage');
    const get = storageAdapter.getDocument.bind(storageAdapter);
    const counts = new Map<string, number>();
    let nth = 0;
    storageAdapter.getDocument = (async (...given: Parameters<typeof get>) => {
      if (given[1].startsWith('paper-')) {
        counts.set(given[1], (counts.get(given[1]) ?? 0) + 1);
        await held((nth += 1));
      }
      return get(...given);
    }) as typeof get;
    try {
      return { counts, out: await work(counts) };
    } finally {
      storageAdapter.getDocument = get;
    }
  }
  const total = (counts: Map<string, number>): number => [...counts.values()].reduce((sum, n) => sum + n, 0);

  it('carries a plan out once when Run is pressed twice at once', async () => {
    const project = await filed(12);
    const planId = (await say(project.id, 'Read the filed documents')).assistantTurn.planId!;
    const press = (): Promise<Answered> => say(project.id, 'Run the plan', { plan: { id: planId, act: 'run' } });
    // Each fetch takes a moment, so the go is still under way when the second press lands.
    const { counts, out } = await fetches(() => Promise.all([press(), press()]), () => new Promise((resolve) => setTimeout(resolve, 25)));
    assert.deepEqual([counts.size, total(counts)], [12, 12], 'each paper was fetched to be read once');
    assert.deepEqual(out.map((reply) => reply.assistantTurn.text.split(/[.:]/)[0]).sort(), ['The plan is already running', 'The plan is done']);
    const said = (await stored(project.id)).conversation.filter((turn) => turn.role === 'assistant').map((turn) => turn.text);
    assert.deepEqual([said.filter((text) => text.startsWith('Step 1 of 1 done.')).length, said.filter((text) => text.startsWith('Running the plan:')).length], [1, 1], 'one go ran it and ticked it off');
    assert.deepEqual([(await planOf(project.id, planId)).plan.status, 'runToken' in (await planOf(project.id, planId)).plan], ['done', false]);
  });

  it('ends a go whose plan was taken up by another, having read no more than it had in hand', async () => {
    const { changeLedger } = await import('../apps/api/src/runs/journal');
    const project = await filed(12);
    const planId = (await say(project.id, 'Read the filed documents')).assistantTurn.planId!;
    // The first go is held as it fetches its first paper, and meanwhile the ledger is made to say nothing has been written for six minutes:
    // the plan reads as cut short, and Carry on is offered while the first go is still there.
    let reached = (): void => undefined;
    let letGo = (): void => undefined;
    const fetching = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (letGo = resolve));
    const { counts, out } = await fetches(
      async () => {
        const first = say(project.id, 'Run the plan', { plan: { id: planId, act: 'run' } });
        await fetching;
        await changeLedger(project.id, (ledger) => ledger.map((row) => (row.id === planId ? { ...row, updatedAt: new Date(Date.now() - 6 * 60_000).toISOString() } : row)));
        assert.equal((await planOf(project.id, planId)).cutShort, true);
        const second = await say(project.id, 'Carry on', { plan: { id: planId, act: 'carry_on' } });
        letGo();
        return { first: await first, second };
      },
      async (nth) => {
        if (nth !== 1) return;
        reached();
        await gate;
      },
    );
    assert.match(out.second.assistantTurn.text, /^The plan is done: 1 of 1 step done\./);
    // The go that lost the plan finished the five papers it had in hand and no more: twenty-four fetches for twelve papers is what two goes side by side came to.
    assert.ok(total(counts) <= 12 + 5 && Math.max(...counts.values()) <= 2, JSON.stringify([...counts.values()]));
    const closing = (await stored(project.id)).conversation.filter((turn) => turn.text.startsWith('The plan is done'));
    assert.equal(closing.length, 1, 'and only the go that has the plan says how it ended');
    assert.equal(out.first.assistantTurn.text.startsWith('The plan is done'), false);
    assert.equal((await planOf(project.id, planId)).plan.status, 'done');
  });

  it('makes a plan a colleague laid out the runner’s own: its lines are theirs, and theirs to undo', async () => {
    const { changePlan } = await import('../apps/api/src/runs/plans');
    const project = await filed(11);
    const planId = (await say(project.id, 'Read the filed documents')).assistantTurn.planId!;
    // Laid out by somebody else in the workspace.
    await changePlan(project.id, planId, (plan) => {
      plan.by = 'colleague@example.com';
    });
    const ran = await say(project.id, 'Run the plan', { plan: { id: planId, act: 'run' } });
    const now = await stored(project.id);
    const me = ran.userTurn.actor;
    const started = now.conversation.find((turn) => turn.text.startsWith('Running the plan'))!;
    assert.equal(started.text, 'Running the plan a colleague laid out: 1 step. It is yours from here. Each is ticked off here as it is done, and you can stop it.');
    const tick = now.conversation.find((turn) => turn.text.startsWith('Step 1 of 1 done.'))!;
    assert.ok(me && tick.actor === me && (await planOf(project.id, planId)).plan.by === me, 'the plan and what it says are the runner’s');
    assert.ok(tick.changed?.kept, 'and what the step changed is kept with its line');
    const back = await say(project.id, 'Undo that message', { undo: { turnId: tick.id } });
    assert.match(back.assistantTurn.text, /^Undone:/);
    assert.ok((await stored(project.id)).evidence.every((row) => !row.facts?.length), 'the runner’s undo took the readings back');
  });
});

describe('a small job', () => {
  it('just runs: ten papers or fewer are read as they always were, and one small step is done at once', async () => {
    const project = await filed(2);
    const read = await say(project.id, 'Read the filed documents');
    assert.equal(read.assistantTurn.planId, undefined, 'no plan');
    assert.deepEqual(read.assistantTurn.toolCalls?.map((call) => call.name), ['ingest'], 'the reading turn it has always been, started at once');
    assert.ok((await stored(project.id)).evidence.every((row) => row.facts?.length), 'and both are read');

    const suggested = await say(project.id, 'Suggest answers to the questionnaire');
    assert.equal(suggested.assistantTurn.planId, undefined);
    assert.match(suggested.assistantTurn.text, /^Suggested answers to \d+ questions? from what stands on the file\./);
    assert.deepEqual(((await (await realFetch(`${base}/api/projects/${project.id}/plans`)).json()) as { plans: unknown[] }).plans, []);
  });

  it('says back what its sentence asked for beside the one step', async () => {
    const project = await filed(1);
    const done = await say(project.id, 'Suggest answers to the questionnaire and tell the owner we are done');
    assert.equal(done.assistantTurn.planId, undefined, 'one small step: no plan');
    assert.deepEqual(done.assistantTurn.text.split('\n').slice(1), ['Nothing was done about: “tell the owner we are done”.']);
  });
});

describe('a yes that names no plan', () => {
  it('runs a plan only in the chat that showed it, while the plan is the last thing that chat said', async () => {
    const project = await filed(11);
    const shown = await say(project.id, 'Read the filed documents', undefined, undefined, 'sit_plan');
    const planId = shown.assistantTurn.planId!;
    assert.ok(planId, 'eleven papers are shown as a plan');
    const stands = async (): Promise<string> => (await planOf(project.id, planId)).plan.status;

    // Typed in another chat, it is an answer to whatever that chat said, and not to a plan it never showed.
    const elsewhere = await say(project.id, 'go ahead', undefined, undefined, 'sit_other');
    assert.deepEqual([elsewhere.assistantTurn.planId, elsewhere.steps, await stands()], [undefined, [], 'shown']);

    // In the plan's own chat, once it has said something else, the plan is no longer what a yes answers.
    await say(project.id, 'What documents are on file?', undefined, undefined, 'sit_plan');
    const later = await say(project.id, 'do it', undefined, undefined, 'sit_plan');
    assert.deepEqual([later.assistantTurn.planId, later.steps, await stands()], [undefined, [], 'shown']);
    assert.ok((await stored(project.id)).evidence.every((row) => !row.facts?.length), 'and no paper was read');

    // Asked how far it has got, the plan is the last thing said again, and a yes under it runs it.
    assert.equal((await say(project.id, 'How far has the plan got?', undefined, undefined, 'sit_plan')).assistantTurn.planId, planId);
    const ran = await say(project.id, 'go ahead', undefined, undefined, 'sit_plan');
    assert.deepEqual(ran.steps, ['Step 1 of 1: Read 11 filed papers']);
    assert.equal(await stands(), 'done');
  });

  /**
   * Run a plan in the chat `sit_plan` and cut its go short as it fetches its `at`th paper: the go is held there, and the ledger is
   * made to say nothing has been written for six minutes, as when the server that ran it was stopped. `then` is what the person
   * does next; the held go is let go after it.
   */
  async function cutShortAt<T>(project: DdProject, planId: string, at: number, then: () => Promise<T>): Promise<T> {
    const { changeLedger } = await import('../apps/api/src/runs/journal');
    const { storageAdapter } = await import('../apps/api/src/storage');
    const get = storageAdapter.getDocument.bind(storageAdapter);
    let reached = (): void => undefined;
    let letGo = (): void => undefined;
    const fetching = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (letGo = resolve));
    let nth = 0;
    storageAdapter.getDocument = (async (...given: Parameters<typeof get>) => {
      if (given[1].startsWith('paper-') && (nth += 1) === at) {
        reached();
        await gate;
      }
      return get(...given);
    }) as typeof get;
    try {
      const first = say(project.id, 'Run the plan', { plan: { id: planId, act: 'run' } }, undefined, 'sit_plan');
      await fetching;
      await changeLedger(project.id, (ledger) => ledger.map((row) => (row.id === planId ? { ...row, updatedAt: new Date(Date.now() - 6 * 60_000).toISOString() } : row)));
      assert.equal((await planOf(project.id, planId)).cutShort, true);
      const out = await then();
      letGo();
      await first;
      return out;
    } finally {
      letGo();
      storageAdapter.getDocument = get;
    }
  }
  const lastSaid = async (projectId: string): Promise<ProjectChatTurn> => (await stored(projectId)).conversation.filter((turn) => turn.role === 'assistant' && turn.sessionId === 'sit_plan').at(-1)!;

  it('takes up a plan cut short after a step, typed straight under the line that ticked the step off', async () => {
    const project = await filed(3);
    const planId = (await say(project.id, 'Write the red flag report, then read the filed documents', undefined, undefined, 'sit_plan')).assistantTurn.planId!;
    assert.ok(planId, 'two steps are shown as a plan');
    // Was: nothing was taken up, and the reply was the next step of the file.
    const typed = await cutShortAt(project, planId, 1, async () => {
      assert.match((await lastSaid(project.id)).text, /^Step 1 of 2 done\./, 'the last thing this chat said is the step ticked off');
      return say(project.id, 'carry on', undefined, undefined, 'sit_plan');
    });
    assert.match(typed.assistantTurn.text, /^The plan is done: 2 of 2 steps done\./);
    assert.deepEqual(typed.steps, ['Step 2 of 2: Read 3 filed papers']);
    assert.ok((await stored(project.id)).conversation.some((turn) => turn.text.startsWith('Taking the plan up again: 1 step is left.')));
  });

  it('takes up a plan cut short part way through a step, under what the step last said', async () => {
    const project = await filed(12);
    const planId = (await say(project.id, 'Read the filed documents', undefined, undefined, 'sit_plan')).assistantTurn.planId!;
    // Held at the sixth paper: the first five are read, and the reader has said so in the thread. No step is ticked off yet.
    const typed = await cutShortAt(project, planId, 6, async () => {
      const last = await lastSaid(project.id);
      assert.ok(!/^(?:Step \d|Running the plan)/.test(last.text), `the last thing this chat said is the reader’s own line: ${last.text.slice(0, 80)}`);
      return say(project.id, 'carry on', undefined, undefined, 'sit_plan');
    });
    assert.match(typed.assistantTurn.text, /^The plan is done: 1 of 1 step done\./);
  });

  it('does not take a cut-short plan up once the chat has said something else', async () => {
    const project = await filed(3);
    const planId = (await say(project.id, 'Write the red flag report, then read the filed documents', undefined, undefined, 'sit_plan')).assistantTurn.planId!;
    const { typed, then } = await cutShortAt(project, planId, 1, async () => {
      await say(project.id, 'What documents are on file?', undefined, undefined, 'sit_plan');
      const typed = await say(project.id, 'carry on', undefined, undefined, 'sit_plan');
      return { typed, then: await planOf(project.id, planId) };
    });
    assert.deepEqual([typed.assistantTurn.planId, typed.steps], [undefined, []]);
    assert.deepEqual([then.cutShort, then.plan.steps.filter((step) => step.state === 'done').length], [true, 1], 'the plan stands where it was cut short');
  });
});

describe('a draft to send, asked for with a questionnaire on file', () => {
  it('is drafted, and suggests no answer to the questionnaire', async () => {
    const project = await filed(1);
    // Was: "Suggested answers to 3 questions from what stands on the file." and no draft.
    const reply = await say(project.id, 'Draft a reply to the lender’s questions');
    assert.match(reply.assistantTurn.text, /^A reply answers a paper on the file, and none on this file matches that\. Which paper is it to\?$/);
    const letter = await say(project.id, 'Draft a letter to the lender about the open questions');
    assert.match(letter.assistantTurn.text, /^Drafted a letter to the lender as .+\/OUT\/1\. It is open in Outgoing\./);
    const now = await stored(project.id);
    assert.equal(questionnaireSummary(now.questionnaires![0]!).suggested, 0, 'no answer was suggested');
    assert.equal(now.outgoing?.length, 1, 'and the letter is a draft to send');
  });

  it('is drafted the same with a word that describes it, or a please in front', async () => {
    const project = await filed(1);
    // Each was: "Suggested answers to 0 questions from what stands on the file. 3 questions are still open." and no draft.
    for (const said of ['Draft a short reply to the lender’s questions', 'Draft a formal reply to the lender on the questionnaire']) {
      const reply = await say(project.id, said);
      assert.match(reply.assistantTurn.text, /^A reply answers a paper on the file, and none on this file matches that\. Which paper is it to\?$/, said);
    }
    for (const said of ['Draft a quick email to the lender answering their questions', 'Please draft a brief letter to the bank about the open questions']) {
      const letter = await say(project.id, said);
      assert.match(letter.assistantTurn.text, /^Drafted a letter to the (?:lender|bank)\b.* as .+\/OUT\/\d\. It is open in Outgoing\./, said);
    }
    const now = await stored(project.id);
    assert.equal(questionnaireSummary(now.questionnaires![0]!).suggested, 0, 'no answer was suggested');
    assert.equal(now.outgoing?.length, 2, 'and each letter is a draft to send');
  });
});

describe('reading the filed papers again from a plan', () => {
  it('raises no card that a card already waiting says: one card a value', async () => {
    const { store } = await import('../apps/api/src/store');
    const { storageAdapter } = await import('../apps/api/src/storage');
    // A deed that states where the land is: reading it raises a card to record the address.
    const project = await filed(1);
    const deed = addEvidence(project, { title: 'Sale deed', kind: 'document' }, LEAD);
    const bytes = readFileSync(path.resolve('test/fixtures/documents/Sale_Deed_2019_Sy_118-2_Whitefield.pdf'));
    await storageAdapter.putDocument(project.id, `paper-${project.id}-deed.pdf`, bytes, 'application/pdf');
    attachEvidenceFile(project, deed.id, { fileName: 'sale-deed.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: `paper-${project.id}-deed.pdf` }, LEAD);
    await store.save();
    const run = async (): Promise<void> => {
      const shown = await say(project.id, 'Read the filed papers again, then write the status for September 2026');
      assert.ok(shown.assistantTurn.planId, 'two steps are shown as a plan');
      await say(project.id, 'Run the plan', { plan: { id: shown.assistantTurn.planId!, act: 'run' } });
    };
    const waiting = async (): Promise<string[]> => (await stored(project.id)).chatProposals.filter((card) => card.status === 'proposed').map((card) => card.title);
    await run();
    const first = await waiting();
    assert.ok(first.some((title) => title.startsWith('Record the address as ')), `the deed raises a card for the address: ${first.join(' | ')}`);
    await run();
    // Was: every card the first reading raised, raised again beside it.
    assert.deepEqual(await waiting(), first);
    // The reading still says which cards are its own: the ones that wait.
    const now = await stored(project.id);
    const read = now.conversation.filter((turn) => turn.toolCalls?.some((call) => /^Read \d+ documents? filed on the register/.test(call.summary))).at(-1)!;
    assert.ok((read.proposalIds ?? []).length > 0 && read.proposalIds!.every((id) => now.chatProposals.some((card) => card.id === id && card.status === 'proposed')), 'and its reply lists only cards that are there');
  });
});

describe('a saved playbook', () => {
  it('is run on the papers as a step, by the review table’s own code, and its answers are on no paper’s row', async () => {
    const saved = await realFetch(`${base}/api/libraries/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'playbook', name: 'Khata check', columns: [{ kind: 'question', question: 'What is the khata number?' }] }) });
    assert.ok(saved.ok, 'the playbook is saved in the workspace’s library');
    const project = await filed(3);
    const shown = await say(project.id, 'Read the filed papers, then run the khata check playbook on the papers');
    assert.deepEqual(shown.assistantTurn.text.split('\n').slice(1, 3), ['1. Read 3 filed papers.', '2. Run the playbook “Khata check” on 3 papers.']);
    const ran = await say(project.id, 'Run the plan', { plan: { id: shown.assistantTurn.planId!, act: 'run' } });
    assert.match(ran.assistantTurn.text, /^The plan is done: 2 of 2 steps done\.\n.*\n2\. Run the playbook “Khata check” on 3 papers\. Done: Asked the playbook “Khata check” of 3 papers\. The answers are in the review table and on no paper’s own row\./s);
    const now = await stored(project.id);
    assert.equal(now.reviewTable?.columns?.filter((column) => column.kind === 'question').length, 1, 'its column is on the table');
    const kept = Object.values(now.reviewTable?.answers ?? {})[0] ?? {};
    assert.deepEqual(Object.keys(kept).sort(), now.evidence.map((row) => row.id).sort(), 'an answer for each paper is kept in the table, under the question');
    assert.ok(Object.values(kept).every((answer) => answer.by === 'search'), 'found by a search of its pages, with no model set up');
    assert.ok(now.evidence.every((row) => acceptedFacts(row).length === 0), 'and nothing on a row was accepted by it');
  });
});

describe('a model’s proposal for words the rules do not read', () => {
  it('is held to the fixed kinds, counted from the record, and shown before anything starts', async (t) => {
    // A model is set up for this test alone.
    const env = { REALYTICA_BASE_URL: MODEL_BASE, REALYTICA_API_KEY: 'test-key', REALYTICA_MODEL_JUDGMENT: 'vendor/senior' };
    Object.assign(process.env, env);
    t.after(() => {
      for (const name of Object.keys(env)) delete process.env[name];
    });
    const project = await filed(3);
    asked = [];
    proposes = [
      { kind: 'read_filed', only: null, again: null, form: null, report: null, period: null, playbook: null },
      { kind: 'suggest_answers', only: null, again: null, form: null, report: null, period: null, playbook: null },
      // Not a kind a plan has, and one the instruction never asked for.
      { kind: 'email_the_owner', only: null, again: null, form: null, report: null, period: null, playbook: null },
      { kind: 'accept_raised', only: null, again: null, form: 'open', report: null, period: null, playbook: null },
      { kind: 'write_report', only: null, again: null, form: null, report: 'status', period: 'for September 2026 for the owner', playbook: null },
    ];
    const shown = await say(project.id, 'Go through all the papers, see what the lender’s questionnaire can take from them, and tell the owner where we stand in a status update for September 2026');
    assert.deepEqual(asked, ['propose_plan'], 'a model was asked once, for a plan and nothing else');
    assert.deepEqual(shown.assistantTurn.text.split('\n').slice(0, 4), [
      'That is 3 steps, so nothing has started. The plan:',
      '1. Read 3 filed papers.',
      '2. Suggest answers to 3 questions from the file.',
      '3. Write the status for September 2026, for the owner.',
    ]);
    assert.match(shown.assistantTurn.text, /^Left out, with nothing to do: Nothing is waiting on a card\.$/m, 'a step that would touch nothing is no step, and the plan says so');
    assert.ok(!shown.assistantTurn.text.includes('No step was made of'), 'the model read the whole instruction');
    const plan = (await planOf(project.id, shown.assistantTurn.planId!)).plan;
    assert.deepEqual([plan.status, plan.byModel, plan.steps.map((step) => step.kind)], ['shown', true, ['read_filed', 'suggest_answers', 'write_report']]);
    assert.ok((await stored(project.id)).evidence.every((row) => !row.facts?.length), 'and nothing has started');
  });

  it('places what the rules could not, keeps what they read, and is not taken where it leaves out a step they read', async (t) => {
    const env = { REALYTICA_BASE_URL: MODEL_BASE, REALYTICA_API_KEY: 'test-key', REALYTICA_MODEL_JUDGMENT: 'vendor/senior' };
    Object.assign(process.env, env);
    t.after(() => {
      for (const name of Object.keys(env)) delete process.env[name];
    });
    const none = { only: null, again: null, form: null, report: null, period: null, playbook: null };
    const project = await filed(12, 12);
    const instruction = 'Read the title papers again, see what the lender’s questionnaire can take from them and tell the owner where we stand';

    // The rules read the first clause and no more. A model lays out all three, and says nothing of which papers.
    proposes = [{ ...none, kind: 'read_filed' }, { ...none, kind: 'suggest_answers' }, { ...none, kind: 'write_report', report: 'status', period: 'for September 2026' }];
    const placed = await say(project.id, instruction);
    assert.deepEqual(placed.assistantTurn.text.split('\n').slice(1, 4), ['1. Read 12 filed papers again, only Title.', '2. Suggest answers to 3 questions from the file.', '3. Write the status for September 2026.']);
    assert.ok(!placed.assistantTurn.text.includes('No step was made of'));

    // A proposal that drops the reading the rules read is not taken: their reading stands, and the rest is said back.
    proposes = [{ ...none, kind: 'suggest_answers' }, { ...none, kind: 'write_report', report: 'status', period: 'for September 2026' }];
    const kept = await say(project.id, instruction);
    assert.deepEqual(kept.assistantTurn.text.split('\n').slice(0, 3), [
      'That touches a lot, so nothing has started. The plan:',
      '1. Read 12 filed papers again, only Title.',
      'No step was made of: “see what the lender’s questionnaire can take from them”, “tell the owner where we stand”.',
    ]);
    assert.equal((await planOf(project.id, kept.assistantTurn.planId!)).plan.byModel, undefined);
    // The plan shown before it was never run: it gave way to this one, so one plan waits and not two.
    assert.equal((await planOf(project.id, placed.assistantTurn.planId!)).plan.status, 'cancelled');
  });
});
