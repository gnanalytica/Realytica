/**
 * Meeting notes pasted into the chat, over real HTTP, with a model that is a
 * script.
 *
 * `meetings.test.ts` proves the rules. This proves they are wired: that
 * notes pasted as a message are kept as a meeting; that the thread keeps one
 * line in their place and the project's record none of their words but the
 * lines it quotes, while the words themselves are a file in the project's
 * storage and are read back when the notes are opened; that a model's
 * reading reaches the cards only as far as the notes' own words bear it out;
 * that a long paste which is not notes is refused; that words it cannot tell
 * about are asked about and let go when a person says they are no meeting;
 * and that memory is told the meeting was kept.
 *
 * Booted with no graph database, so memory is the file beside the project
 * store. The only address the app can reach is the scripted model's. Every
 * name and line of notes is invented.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MEETING_IS_NEITHER, createProject, meetingsHeld, type ChatChoice, type ChatProposal, type DdProject, type MeetingShown, type ProjectChatTurn } from '@realytica/shared';

const MODEL_BASE = 'http://meeting-notes.test';

const NOTES = [
  'Minutes of the meeting, Northfield corner plot',
  'Date: 3 October 2026',
  'Present: Asha Rao, Vikram Shetty',
  '',
  'The broker left early and the tea was cold.',
  'It was agreed that the boundary wall will be built before the monsoon.',
  '',
  'Decision: Go ahead with the resurvey of the plot before the sale agreement.',
  'Action: Vikram to get the encumbrance certificate by Friday.',
].join('\n');

let server: Server;
let base: string;
let dataDir: string;
let project: DdProject;
let stored: () => DdProject;
let caughtUp: () => Promise<void>;
const realFetch = globalThis.fetch;

/** How often the model was asked, and what it says it read. */
let asked = 0;
let reads: Array<Record<string, unknown>> = [];

/** A model's answer as the endpoint streams it: one call of the tool it was told to use. */
function streamed(tool: string, input: unknown): Response {
  const event = (name: string, data: unknown): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const body = [
    event('message_start', { type: 'message_start', message: { id: 'msg_notes', type: 'message', role: 'assistant', model: 'vendor/reader', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 300, output_tokens: 1 } } }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_0', name: tool, input: {} } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 80 } }),
    event('message_stop', { type: 'message_stop' }),
  ].join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

interface Answered {
  userTurn: ProjectChatTurn;
  assistantTurn: ProjectChatTurn & { choices?: ChatChoice[] };
  proposals: ChatProposal[];
}

async function say(question: string): Promise<Answered> {
  const res = await realFetch(`${base}/api/projects/${project.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
  assert.equal(res.status, 200);
  const lines = (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string });
  const result = lines.find((line) => line.type === 'result');
  assert.ok(result, 'the chat answered');
  return result as unknown as Answered;
}

/** Every file under the test's data directory that holds these words. */
function filesWith(words: string, dir = dataDir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const at = path.join(dir, name);
    if (statSync(at).isDirectory()) return filesWith(words, at);
    return readFileSync(at, 'utf8').includes(words) ? [at] : [];
  });
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-meetings-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  process.env.REALYTICA_BASE_URL = MODEL_BASE;
  process.env.REALYTICA_API_KEY = 'test-key';
  process.env.REALYTICA_MODEL_EXTRACTION = 'vendor/reader';
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(MODEL_BASE)) throw new Error('this test has no network');
    const raw = input instanceof Request ? await input.text() : String(init?.body ?? '{}');
    const sent = JSON.parse(raw) as { tool_choice?: { name?: string } };
    asked += 1;
    assert.equal(sent.tool_choice?.name, 'record_meeting_notes', 'the only thing a model is asked for here is a reading of notes');
    return streamed('record_meeting_notes', { items: reads });
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  const { store } = await import('../apps/api/src/store');
  caughtUp = () => store.graphCaughtUp();
  project = createProject({ name: 'Northfield corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-MN1');
  store.data.projects!.push(project);
  await store.save();
  stored = () => store.data.projects!.find((held) => held.id === project.id)!;

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_AUTH_MODE', 'REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_MODEL_EXTRACTION', 'REALYTICA_DATA_DIR']) delete process.env[name];
});

describe('notes of a meeting pasted into the chat', () => {
  it('are kept as a meeting, with one line in the thread and their words in storage, not on the record', async () => {
    reads = [
      { kind: 'decision', text: 'Build the boundary wall before the monsoon', owner: null, quote: 'It was agreed that the boundary wall will be built before the monsoon.' },
      // Words the notes do not have: a model's own.
      { kind: 'action', text: 'File the conversion application', owner: 'Vikram', quote: 'The conversion application is to be filed next week by the team.' },
    ];
    const answer = await say(NOTES);

    assert.match(answer.userTurn.text, /^Notes of a meeting pasted, about \d+ words$/, 'one line stands in the thread for the paste');
    assert.match(answer.assistantTurn.text, /^Kept the notes as a meeting: Minutes of the meeting, Northfield corner plot, 3 Oct 2026 \[notes:/);
    assert.equal(asked, 1, 'a model read the notes once, and no model worded the reply');
    assert.deepEqual(
      answer.proposals.map((card) => card.title),
      ['Decision: Go ahead with the resurvey of the plot before the sale agreement.', 'Action: Vikram to get the encumbrance certificate by Friday.', 'Decision: Build the boundary wall before the monsoon'],
      'two lines the rules read, one sentence only a model read, and nothing the notes do not say',
    );

    const meeting = meetingsHeld(stored())[0]!;
    assert.deepEqual([meeting.heldOn, meeting.attendees, meeting.came, meeting.file.mimeType], ['2026-10-03', ['Asha Rao', 'Vikram Shetty'], 'pasted', 'text/plain']);
    assert.ok(!JSON.stringify(stored()).includes('the tea was cold'), 'the record holds no word of the notes beyond the lines it quotes');
    const holding = filesWith('the tea was cold');
    assert.equal(holding.length, 1, 'the words are in one place');
    assert.ok(holding[0]!.endsWith(meeting.file.storageKey), 'the file the meeting says they are kept in');
  });

  it('are opened from where they are kept, with where each thing they say stands', async () => {
    const meeting = meetingsHeld(stored())[0]!;
    const res = await realFetch(`${base}/api/projects/${project.id}/meetings/${meeting.id}/notes`);
    assert.equal(res.status, 200);
    const opened = (await res.json()) as { meeting: MeetingShown; text: string };
    assert.equal(opened.text, NOTES);
    assert.deepEqual(opened.meeting.items.map((item) => [item.kind, item.standing, item.readBy]), [['decision', 'waiting', 'rules'], ['action', 'waiting', 'rules'], ['decision', 'waiting', 'model']]);
    assert.equal((await realFetch(`${base}/api/projects/${project.id}/meetings/mtg_none/notes`)).status, 404);
  });

  it('are told to memory as a meeting kept', async () => {
    await caughtUp();
    const meeting = meetingsHeld(stored())[0]!;
    const res = await realFetch(`${base}/api/projects/${project.id}/memory`);
    const entries = ((await res.json()) as { entries: Array<{ kind: string; about: Array<{ id: string; title?: string }> }> }).entries;
    assert.deepEqual(entries.filter((entry) => entry.kind === 'meeting_kept').map((entry) => entry.about), [[{ id: meeting.id, title: 'the meeting of 3 Oct 2026' }]]);
  });
});

describe('a long message that is not the notes of a meeting', () => {
  it('is refused, and nothing is kept of it', async () => {
    const res = await realFetch(`${base}/api/projects/${project.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'What does the deed say about the access road? '.repeat(100) }) });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /^A message can be 4,000 characters\./);
    assert.equal(meetingsHeld(stored()).length, 1);
  });
});

describe('words the chat cannot tell are notes of a meeting', () => {
  it('are asked about, and let go when a person says they are not', async () => {
    const before = asked;
    const words = 'Decision: keep the old gate where it stands today.\nAction: paint it before the visit.\nOpen: who pays for the paint.';
    const unsure = await say(words);
    assert.match(unsure.userTurn.text, /^Text pasted, about \d+ words$/);
    assert.match(unsure.assistantTurn.text, /^Are these the notes of a meeting\? Nothing is kept as one until you say\.$/);
    assert.deepEqual(unsure.assistantTurn.choices?.map((choice) => choice.label), ['Notes of a meeting', 'Not a meeting']);
    assert.equal(asked, before, 'nothing is read until a person says');
    assert.equal(filesWith('keep the old gate').length, 1, 'held, in storage only');

    const no = await say(MEETING_IS_NEITHER);
    assert.equal(no.assistantTurn.text, 'Not kept as a meeting, and nothing was filed.');
    assert.equal(filesWith('keep the old gate').length, 0, 'and let go');
    assert.equal(stored().meetings!.length, 1, 'the one meeting kept is all the record holds');
  });
});
