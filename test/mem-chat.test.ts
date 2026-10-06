/**
 * Memory in the chat, over real HTTP, with a model that is a script.
 *
 * The parts are proved one by one elsewhere (`mem-context`, `mem-thought`,
 * `mem-lint`). This proves they are wired: that a question put to the chat
 * reaches the model with the lines memory holds near it, each marked and
 * tagged; that the tag beside a statement in the stored answer was printed
 * by code from the fact the answer cited, whatever the model wrote; that the
 * note the answer left is taken off it and kept as a thought, after the
 * reply, and shown, tagged, with the next question; and that asking what
 * looks wrong in memory is answered in one line with no model asked.
 *
 * Booted with no graph database, so memory is the file beside the project
 * store. The only address the app can reach is the scripted model's.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { addEvidence, createAssessment, createProject, patchProject, reviewFacts, wantsDeterministicProjectChat, type DdProject, type DocumentFact, type MemFact, type ProjectChatTurn } from '@realytica/shared';
import type { MemoryPort } from '../apps/api/src/graph/mem/types';

const MODEL_BASE = 'http://memory-chat.test';
const SENIOR = 'senior/model';
const LEAD = 'lead@example.com';
const VALUER = 'valuer@example.com';

let server: Server;
let base: string;
let dataDir: string;
let project: DdProject;
let khataId: string;
let memory: MemoryPort;
let caughtUp: () => Promise<void>;
const realFetch = globalThis.fetch;

/** What the model was last sent, as one text, and how often it has been asked. */
let sent = '';
let asked = 0;
/** What the model answers, given what it was sent. */
let script: (sent: string) => string;

/** The mark memory gave the line that says this, in what the model was sent. */
function markOf(words: string): string {
  const line = sent.split('\n').find((held) => /^\[m\d+\] /.test(held) && held.includes(words));
  assert.ok(line, `the model was given a memory line that says “${words}”`);
  return line.slice(1, line.indexOf(']'));
}

async function ask(question: string, more: Record<string, unknown> = {}): Promise<{ assistantTurn: ProjectChatTurn }> {
  const res = await realFetch(`${base}/api/projects/${project.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, ...more }) });
  assert.equal(res.status, 200);
  const lines = (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string });
  const result = lines.find((line) => line.type === 'result');
  assert.ok(result, 'the chat answered');
  return result as unknown as { assistantTurn: ProjectChatTurn };
}

/** The notes memory holds, once one has been kept: a note is written after the reply and nothing waits on it. */
async function notes(atLeast: number): Promise<MemFact[]> {
  for (let tries = 0; tries < 100; tries += 1) {
    const held = (await memory.factsOf(project.id)).filter((fact) => fact.tag === 'thought');
    if (held.length >= atLeast) return held;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return [];
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-mem-chat-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  process.env.REALYTICA_BASE_URL = MODEL_BASE;
  process.env.REALYTICA_API_KEY = 'test-key';
  process.env.REALYTICA_MODEL_JUDGMENT = SENIOR;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(MODEL_BASE)) throw new Error('this test has no network');
    const raw = input instanceof Request ? await input.text() : String(init?.body ?? '{}');
    const body = JSON.parse(raw) as { model: string; messages: Array<{ content: unknown }> };
    asked += 1;
    sent = body.messages.flatMap((message) => (Array.isArray(message.content) ? (message.content as Array<{ text?: string }>).map((block) => block.text ?? '') : [String(message.content)])).join('\n');
    const reply = { id: `msg_${asked}`, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: script(sent) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 60 } };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  const { store } = await import('../apps/api/src/store');
  ({ memoryPort: memory } = await import('../apps/api/src/graph/mem'));
  caughtUp = () => store.graphCaughtUp();

  project = createProject({ name: 'Chat memory plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-MC1');
  createAssessment(project, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
  const value = (key: string, held: DocumentFact['value'], display = String(held)): DocumentFact => ({ key, label: key, value: held, display, page: 1, quote: `${key}: ${display}`, review: 'proposed' });
  const khata = addEvidence(project, { title: 'Municipal certificate of the plot', kind: 'document' }, LEAD);
  khata.documentType = 'Khata certificate and extract';
  khata.facts = [value('extent_khata', 1100.9, '11,850 sq ft'), value('khata_number', '1234/56')];
  reviewFacts(project, khata.id, ['extent_khata'], 'accept', VALUER);
  patchProject(project, { landAreaSqm: 1210 }, LEAD);
  khataId = khata.id;
  store.data.projects!.push(project);
  await store.save();
  await caughtUp();

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  globalThis.fetch = realFetch;
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_AUTH_MODE', 'REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_MODEL_JUDGMENT', 'REALYTICA_DATA_DIR']) delete process.env[name];
});

describe('a question put to the chat', () => {
  // Worded for the model: no rule of the chat's own answers it, and the paper's title is one no public portal answers to.
  const QUESTION = 'Why would the Municipal certificate of the plot matter to a lender?';

  it('reaches the model with the lines memory holds near it, and the answer’s tags are printed by code from the facts it cited', async () => {
    assert.equal(wantsDeterministicProjectChat(project, QUESTION), false, 'a question for the model, not one the file answers by rule');
    script = () =>
      [
        `The certificate gives the extent as 11,850 sq ft [${markOf('Extent per khata')}].`,
        // The model calls a value nobody has accepted approved, in its own words, and cites it as well.
        `Its number is 1234/56 [approved] [${markOf('Khata number')}].`,
        `Note to memory [${khataId}]: The certificate is in the seller's own name.`,
      ].join('\n');
    const { assistantTurn } = await ask(QUESTION);

    assert.match(sent, /^Memory lines for this question \(each marked, and tagged by the system\):$/m);
    assert.match(sent, /^\[m\d+\] approved · Extent per khata: 11,850 sq ft \(1100\.9\) · source: Municipal certificate of the plot, p\.1 · \d{4}-\d{2}-\d{2}$/m);
    assert.match(sent, /^\[m\d+\] waiting · stands · Khata number: 1234\/56 · source: Municipal certificate of the plot, p\.1 · read by the rules · \d{4}-\d{2}-\d{2}$/m);

    assert.equal(assistantTurn.text, 'The certificate gives the extent as 11,850 sq ft [approved].\nIts number is 1234/56 [waiting · stands].', 'the tags are the facts’ own, the model’s is gone, and the note is not said to the person');
    assert.deepEqual(assistantTurn.restsOn?.map((rest) => [rest.id.split('::fact::')[1], rest.tag, rest.stands]), [
      [`${khataId}::extent_khata::a`, 'approved', undefined],
      [`${khataId}::khata_number::r`, 'proposed', true],
    ]);
    // The stored turn is the same turn.
    const { store } = await import('../apps/api/src/store');
    const stored = store.data.projects!.find((held) => held.id === project.id)!.conversation.find((turn) => turn.id === assistantTurn.id)!;
    assert.deepEqual([stored.text, stored.restsOn], [assistantTurn.text, assistantTurn.restsOn]);
  });

  it('leaves its note in memory as a thought, kept after the reply, on the page of what it is about', async () => {
    const [note] = await notes(1);
    assert.ok(note, 'the note was kept');
    const turn = project.conversation.filter((held) => held.role === 'assistant').at(-1)!;
    assert.deepEqual(
      { tag: note.tag, key: note.key, value: note.value, aboutId: note.aboutId, source: note.source },
      { tag: 'thought', key: 'note', value: "The certificate is in the seller's own name.", aboutId: khataId, source: turn.id },
    );
    await caughtUp();
    const res = await realFetch(`${base}/api/projects/${project.id}/memory`);
    const body = (await res.json()) as { facts: Array<{ tag: string; value: unknown }>; pages: Array<{ about: { id: string; title?: string }; notes: number }> };
    assert.ok(body.facts.some((fact) => fact.tag === 'thought' && fact.value === note.value), 'the read route shows it, tagged');
    assert.deepEqual(body.pages.map((page) => [page.about.id, page.about.title, page.notes]), [[khataId, 'Municipal certificate of the plot', 1]]);
  });

  it('is shown that thought with the next question about the same thing, and a statement resting on it is tagged a thought', async () => {
    script = () => `The seller holds the certificate in their own name [${markOf("The certificate is in the seller's own name.")}].`;
    const { assistantTurn } = await ask(QUESTION);
    assert.match(sent, /^\[m\d+\] thought · The certificate is in the seller's own name\. · about: Municipal certificate of the plot · source: a reply in chat · \d{4}-\d{2}-\d{2}$/m);
    assert.equal(assistantTurn.text, 'The seller holds the certificate in their own name [thought].');
    assert.deepEqual(assistantTurn.restsOn?.map((rest) => rest.tag), ['thought']);
    assert.equal((await notes(1)).length, 1, 'a reply that leaves no note keeps none');
  });
});

describe('asking the chat what looks wrong in memory', () => {
  it('is answered in one line from a reading of memory, with no model asked, and the list is on its own route', async () => {
    await caughtUp();
    const before = asked;
    const { assistantTurn } = await ask('What looks wrong in memory?');
    assert.equal(asked, before, 'no model was asked');
    assert.equal(assistantTurn.text, 'In this project’s memory, one thing looks wrong: 1 approved value with no paper behind it. The first: Land area (1210) is approved with no paper behind it.');
    assert.deepEqual(assistantTurn.toolCalls?.map((call) => call.name), ['memory_lint']);

    // Memory is told the question and its answer after the reply: once it has been, the list is the same one.
    await caughtUp();
    const res = await realFetch(`${base}/api/projects/${project.id}/memory/lint`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { findings: Array<{ kind: string; says: string; about?: { id: string; title?: string } }> };
    assert.deepEqual(body.findings.map((finding) => [finding.kind, finding.about?.id]), [['no_source', project.id]]);
  });
});
