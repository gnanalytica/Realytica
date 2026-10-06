/**
 * Plans in the chat, over real HTTP.
 *
 * `plans.test.ts` proves the words. This proves they are wired: that a job
 * over many records is shown as a plan and nothing of it starts; that a step
 * is taken out and the papers narrowed by a sentence; that the plan runs
 * step by step when a person runs it, ticks each step off in the thread, and
 * accepts nothing it raises; that it is stopped part way with what it did
 * kept, is on the record through the ledger for a page that was never open,
 * and is taken up again from where it stopped; that a small job just runs;
 * and that a model's proposal for words the rules do not read is held to the
 * fixed kinds and still shown before it starts.
 *
 * Booted with no graph database and no model: the papers are read by rule.
 * A model is set up for the one test that needs one, and is a script. No
 * other address can be reached. Every name and paper is invented.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
async function say(projectId: string, question: string, sitting?: ChatChoice['sitting'], onStep?: (label: string) => void): Promise<Answered> {
  const res = await realFetch(`${base}/api/projects/${projectId}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, ...(sitting ? { sitting } : {}) }) });
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
  for (const name of ['REALYTICA_AUTH_MODE', 'REALYTICA_DATA_DIR']) delete process.env[name];
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

  it('is taken up again from where it stopped', async () => {
    const again = await say(project.id, 'Carry on with the plan');
    assert.match(again.assistantTurn.text, /^The plan is done: 1 of 1 step done\./);
    assert.equal((await stored(project.id)).evidence.filter((row) => row.facts?.length).length, 12, 'the papers left were read');
    assert.equal((await planOf(project.id, planId)).plan.steps[0]!.did, 12 - did, 'and the ones read before were not read twice');
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
});
