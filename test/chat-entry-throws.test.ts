/**
 * A throw in the chat's rules, at each way into them, over real HTTP.
 *
 * The rules are plain functions that change the project they are handed, and
 * one of them can throw: the code has a fault. The routes are async handlers
 * of Express 4, where a throw nobody catches is an unhandled rejection and
 * ends the process, and with it every other person's request. So each way in
 * answers for itself: the accept and the set-aside under a card with a status
 * and a sentence, as the page's own accept does, and a line in the server's
 * log; a message, an undo and a plan with the stream's error line; and a step
 * of a running plan by being ticked off as not done. In none of them is
 * anything saved for the message that threw, and the server goes on to answer
 * the next one.
 *
 * A card that cannot be taken (it names a paper that has since gone) is no
 * throw of the rules: they leave it waiting and say why, take the cards beside
 * it, and the reply that says so is saved with what it took.
 *
 * Booted with no graph database and no model, and no address but its own
 * can be reached. Every name is invented.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { addEvidence, attachEvidenceFile, createProject, refreshProjectDerived, type ChatProposal, type DdProject, type ProjectChatTurn } from '@realytica/shared';

const LEAD = 'lead@example.com';
const TURN_FAILED = 'That message could not be carried out. Say it another way, or do it on the page.';

let server: Server;
let base: string;
let dataDir: string;
const realFetch = globalThis.fetch;

const card = (id: string, more: Partial<ChatProposal> = {}): ChatProposal => ({ id, kind: 'patch_project', title: `Update the record (${id})`, rationale: '', impact: '', status: 'proposed', payload: { landAreaSqm: 1300 }, createdAt: '2026-10-06T08:00:00.000Z', createdBy: 'assistant', ...more });

/** A project on the store with two cards waiting, and one that asks for a paper no longer on the register. */
async function plot(): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  const project = createProject({ name: 'Northfield corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, `RYT-${Math.random().toString(36).slice(2, 8)}`);
  project.chatProposals.push(card('prop_a'), card('prop_b', { payload: { builtUpAreaSqm: 900 } }), card('prop_gone', { kind: 'request_documents', title: 'Ask the seller for the khata', payload: { evidenceIds: ['ev_gone'], recipient: 'The seller' } }));
  store.data.projects!.push(project);
  await store.save();
  // Read once, so that what the server writes on a project the first time it serves it is there before anything is compared.
  await realFetch(`${base}/api/projects/${project.id}`);
  return project;
}

/** The project's document as storage holds it: what a save wrote last. */
async function saved(project: DdProject): Promise<string> {
  const { storageAdapter } = await import('../apps/api/src/storage');
  return (await storageAdapter.getDocument(project.id, 'project.json'))!.toString('utf8');
}

/** The project as the server holds it, once what it derives from the rest is worked out, as every route works it out before the rules run. */
function held(project: DdProject): string {
  refreshProjectDerived(project);
  return JSON.stringify(project);
}

/**
 * Make the rules throw on this project: reading its meetings, which they do
 * before they change anything, throws while the named function is running
 * and at no other time. Returns what puts the project back.
 */
function rulesThrow(project: DdProject, error: Error = new Error('The rules threw.'), within = 'applyProjectChat'): () => void {
  const meetings = project.meetings;
  Object.defineProperty(project, 'meetings', {
    configurable: true,
    enumerable: true,
    get: () => {
      if (new Error().stack?.includes(within)) throw error;
      return meetings;
    },
    set: () => undefined,
  });
  return () => {
    Object.defineProperty(project, 'meetings', { configurable: true, enumerable: true, writable: true, value: meetings });
  };
}

interface Streamed {
  status: number;
  error?: string;
  result?: { assistantTurn: ProjectChatTurn; commands?: string[] };
}

async function say(project: DdProject, body: Record<string, unknown>): Promise<Streamed> {
  const res = await realFetch(`${base}/api/projects/${project.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const lines = (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; error?: string });
  return { status: res.status, error: lines.find((line) => line.type === 'error')?.error, result: lines.find((line) => line.type === 'result') as Streamed['result'] };
}

async function press(project: DdProject, id: string, what: 'commit' | 'reject'): Promise<{ status: number; body: { error?: string; assistantTurn?: ProjectChatTurn } }> {
  const res = await realFetch(`${base}/api/projects/${project.id}/chat/proposals/${id}/${what}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return { status: res.status, body: (await res.json()) as { error?: string; assistantTurn?: ProjectChatTurn } };
}

const alive = async (): Promise<number> => (await realFetch(`${base}/api/health`)).status;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-chat-entry-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  process.env.REALYTICA_RATE_LIMIT_MODEL = '500';
  globalThis.fetch = (async () => {
    throw new Error('this test has no network');
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
  // A plan goes on after its reply: let that end before its directory goes.
  const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
  await afterReplyWorkDone();
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_AUTH_MODE', 'REALYTICA_DATA_DIR', 'REALYTICA_RATE_LIMIT_MODEL']) delete process.env[name];
});

describe('a throw in the chat’s rules', () => {
  const STAYS = '“Ask the seller for the khata” stays waiting. None of those documents is still waiting to be asked for.';
  const stands = (project: DdProject): string[] => ['prop_a', 'prop_gone', 'prop_b'].map((id) => project.chatProposals.find((held) => held.id === id)!.status);

  it('is not what a card that cannot be taken does: under its accept the card still waits, and the reply says why', async () => {
    const project = await plot();
    // The card asks for a paper that is no longer on the register. Was a 400 with the sentence alone: the rules threw on it.
    const gone = await press(project, 'prop_gone', 'commit');
    assert.deepEqual([gone.status, gone.body.error, gone.body.assistantTurn?.text], [200, undefined, `Nothing was accepted. ${STAYS}`]);
    assert.deepEqual(stands(project), ['proposed', 'proposed', 'proposed'], 'the card still waits, and so do the others');
    const kept = JSON.parse(await saved(project)) as DdProject;
    assert.deepEqual([stands(kept), kept.landAreaSqm, kept.conversation.at(-1)?.text], [stands(project), undefined, `Nothing was accepted. ${STAYS}`], 'what is saved is the reply that says so, and nothing it does not tell of');
    assert.equal(await alive(), 200, 'and the server goes on');
    // A card that can be carried out still is.
    const taken = await press(project, 'prop_a', 'commit');
    assert.equal(taken.status, 200);
    assert.equal(project.chatProposals.find((held) => held.id === 'prop_a')?.status, 'committed');
  });

  it('is not what one card of several that cannot be taken does: the others are taken and told of, it stays waiting with why, and undo covers what was taken', async () => {
    const project = await plot();
    // Three cards taken in one message, the second of them the one that cannot be.
    project.chatProposals.splice(1, 0, project.chatProposals.pop()!);
    assert.deepEqual(project.chatProposals.map((held) => held.id), ['prop_a', 'prop_gone', 'prop_b']);
    // Was: "That message could not be carried out." with the first card already taken, saved by the next message of anybody, told of by no turn and out of undo's reach.
    const reply = await say(project, { question: 'Take these', sitting: { decision: 'accept', proposalIds: ['prop_a', 'prop_gone', 'prop_b'] }, sessionId: 'sit_part' });
    assert.equal(reply.error, undefined);
    const text = reply.result?.assistantTurn.text ?? '';
    assert.equal(text, `Updated the project record. ${STAYS} 1 more is waiting: 1 on the documents.`, 'what was taken is told of, and the one that could not be stays waiting, with why');
    assert.ok(reply.result?.commands?.includes('Accepted 2 suggestions'));
    assert.deepEqual([stands(project), project.landAreaSqm, project.builtUpAreaSqm], [['committed', 'proposed', 'committed'], 1300, 900]);
    // Saved with the reply that tells of it, so nothing is on the record that no turn says.
    const kept = JSON.parse(await saved(project)) as DdProject;
    assert.deepEqual([stands(kept), kept.landAreaSqm, kept.conversation.at(-1)?.text], [stands(project), 1300, text]);
    // And undo takes back what this message took.
    const undone = await say(project, { question: 'undo', sessionId: 'sit_part' });
    assert.equal(undone.error, undefined);
    assert.deepEqual([stands(project), project.landAreaSqm, project.builtUpAreaSqm], [['proposed', 'proposed', 'proposed'], undefined, undefined], undone.result?.assistantTurn.text);
  });

  it('under a card’s accept or set-aside is answered, a refusal as a 403, and nothing is saved', async () => {
    const project = await plot();
    const [stood, was] = [await saved(project), held(project)];
    let lift = rulesThrow(project);
    // What the server writes to its log. Was nothing: a fault in the code under a card left no trace.
    const logged: unknown[][] = [];
    const log = console.error;
    console.error = (...said: unknown[]) => void logged.push(said);
    try {
      for (const what of ['commit', 'reject'] as const) {
        const pressed = await press(project, 'prop_a', what);
        assert.deepEqual([pressed.status, pressed.body.error], [400, 'The rules threw.'], what);
      }
    } finally {
      console.error = log;
      lift();
    }
    assert.deepEqual(logged.map(([said, err]) => [said, (err as Error).message]), [['[chat] the rules threw on a card', 'The rules threw.'], ['[chat] the rules threw on a card', 'The rules threw.']]);
    // Not a lead or signer where the value belongs: the refusal reaches the person as a 403 that says so.
    const { DecisionRefused } = await import('@realytica/shared');
    const refusal = new DecisionRefused('Deciding what was read on this paper needs a lead or signer in Legal.', 'legal');
    lift = rulesThrow(project, refusal);
    try {
      for (const what of ['commit', 'reject'] as const) {
        const pressed = await press(project, 'prop_a', what);
        assert.deepEqual([pressed.status, pressed.body.error], [403, refusal.message], what);
      }
    } finally {
      lift();
    }
    assert.deepEqual([await saved(project), held(project)], [stood, was], 'nothing was saved, and nothing changed');
    assert.equal(await alive(), 200);
    const aside = await press(project, 'prop_a', 'reject');
    assert.deepEqual([aside.status, project.chatProposals.find((held) => held.id === 'prop_a')?.status], [200, 'rejected'], 'and the same card is set aside once the rules run');
  });

  it('on a message, an undo or a plan ends the reply with the stream’s error line, and nothing is saved', async () => {
    const { store } = await import('../apps/api/src/store');
    const { storageAdapter } = await import('../apps/api/src/storage');
    const project = await plot();
    // A paper filed and not read, so that two kinds of step make a plan.
    const row = addEvidence(project, { title: 'Khata certificate', kind: 'document' }, LEAD);
    await storageAdapter.putDocument(project.id, 'khata.txt', Buffer.from('KHATA CERTIFICATE\nKhata No. 112/4'), 'text/plain');
    attachEvidenceFile(project, row.id, { fileName: 'khata.txt', mimeType: 'text/plain', sizeBytes: 34, storageKey: 'khata.txt' }, LEAD);
    project.updatedAt = new Date().toISOString();
    await store.save();
    const [stood, was] = [await saved(project), held(project)];
    const said: Array<[string, Record<string, unknown>]> = [
      ['a message', { question: 'Take these', sitting: { decision: 'accept', proposalIds: ['prop_a', 'prop_b'] } }],
      ['a question', { question: 'What is the land area?' }],
      ['an undo', { question: 'undo' }],
      ['a plan', { question: 'Write the red flag report, then read the filed documents' }],
    ];
    const lift = rulesThrow(project);
    try {
      for (const [what, body] of said) {
        const reply = await say(project, { ...body, sessionId: 'sit_throws' });
        assert.deepEqual([reply.status, reply.error, reply.result], [200, TURN_FAILED, undefined], what);
        assert.equal(await alive(), 200, what);
      }
    } finally {
      lift();
    }
    assert.deepEqual([await saved(project), held(project)], [stood, was], 'nothing was saved, and nothing changed');
    // The same plan is shown once the rules run, and the same message is carried out.
    const shown = await say(project, { question: 'Write the red flag report, then read the filed documents', sessionId: 'sit_throws' });
    assert.ok(shown.result?.assistantTurn.planId, 'two steps are shown as a plan');
    const taken = await say(project, { question: 'Take these', sitting: { decision: 'accept', proposalIds: ['prop_a', 'prop_b'] }, sessionId: 'sit_throws' });
    assert.deepEqual(['prop_a', 'prop_b'].map((id) => project.chatProposals.find((held) => held.id === id)?.status), ['committed', 'committed']);
    assert.equal(taken.error, undefined);
  });

  it('in a step of a running plan ticks the step off as not done, with why, and the plan stops there', async () => {
    const { store } = await import('../apps/api/src/store');
    const { storageAdapter } = await import('../apps/api/src/storage');
    const project = await plot();
    const row = addEvidence(project, { title: 'Khata certificate', kind: 'document' }, LEAD);
    await storageAdapter.putDocument(project.id, 'khata.txt', Buffer.from('KHATA CERTIFICATE\nKhata No. 112/4'), 'text/plain');
    attachEvidenceFile(project, row.id, { fileName: 'khata.txt', mimeType: 'text/plain', sizeBytes: 34, storageKey: 'khata.txt' }, LEAD);
    project.updatedAt = new Date().toISOString();
    await store.save();
    const planId = (await say(project, { question: 'Write the red flag report, then read the filed documents', sessionId: 'sit_plan' })).result?.assistantTurn.planId;
    assert.ok(planId, 'two steps are shown as a plan');
    // The step that writes the report says its sentence to the rules, and they throw on it.
    const lift = rulesThrow(project, new Error('The rules threw.'), 'bySentence');
    let ran: Streamed;
    try {
      ran = await say(project, { question: 'Run the plan', sitting: { plan: { id: planId, act: 'run' } }, sessionId: 'sit_plan' });
    } finally {
      lift();
    }
    assert.equal(ran.error, undefined, 'the run itself is answered');
    assert.match(ran.result?.assistantTurn.text ?? '', /Step 1 could not be done: The rules threw\./, 'and its last word says which step, and why');
    const ticked = project.conversation.filter((turn) => turn.role === 'assistant' && turn.planId === planId).map((turn) => turn.text);
    assert.ok(ticked.some((text) => /^Step 1 of 2 could not be done\..+The rules threw\.$/.test(text)), 'the step is ticked off as not done, with why');
    assert.ok(!ticked.some((text) => text.startsWith('Step 2 of 2')), 'and the step after it was not begun');
    assert.equal(await alive(), 200);
  });
});
