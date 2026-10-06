/**
 * Undo on every message, over real HTTP.
 *
 * `turn-changes.test.ts` proves the rules. This proves they are wired: that
 * a reply which changed the record lists what it changed and one that did
 * not lists nothing; that a message is undone on its own after other things
 * have happened, and later work is not taken back; that what was changed
 * again since is left and said with why; that a dropped paper is taken off
 * the register with its file, and one decided since stays with its file;
 * that the words of a pasted meeting go with the meeting; that "undo" typed
 * alone means the last thing this chat changed; that an undo is told to the
 * trail with the records it put something back on; that a step of a plan is
 * undone from the line that ticked it off; and that a message is its
 * author's to undo.
 *
 * Booted with no graph database and no model: papers are read by rule. No
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
import { addEvidence, addQuestionnaire, attachEvidenceFile, createProject, proposedFacts, type ChoicePin, type DdProject, type ProjectChatTurn } from '@realytica/shared';

const LEAD = 'lead@example.com';

let server: Server;
let base: string;
let dataDir: string;
const realFetch = globalThis.fetch;

/** A typed page, which this server reads in a moment by rule, with no model. */
async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((text, i) => page.drawText(text, { x: 40, y: 780 - i * 22, size: 11, font }));
  return Buffer.from(await doc.save());
}

const KHATA = ['KHATA CERTIFICATE', 'Khata No. 112/4', 'Site area: 1,115 square metres'];
const TAX = ['PROPERTY TAX RECEIPT', 'SAS Application No. 2024-25-0047 for the assessment year 2024-25', 'Tax paid: Rs. 47,616 on 11-05-2024'];

async function seeded(): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  const project = createProject({ name: 'Northfield corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, `RYT-${Math.random().toString(36).slice(2, 8)}`);
  store.data.projects!.push(project);
  await store.save();
  return project;
}

const stored = async (id: string): Promise<DdProject> => (await import('../apps/api/src/store')).store.data.projects!.find((held) => held.id === id)!;
const inStorage = async (projectId: string, key: string): Promise<boolean> => Boolean(await (await import('../apps/api/src/storage')).storageAdapter.getDocument(projectId, key));

interface Answered {
  userTurn: ProjectChatTurn;
  assistantTurn: ProjectChatTurn;
  project: DdProject;
}

async function resultOf(res: Response): Promise<Answered> {
  assert.equal(res.status, 200);
  const lines = (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string });
  const result = lines.find((line) => line.type === 'result');
  assert.ok(result, 'the chat answered');
  return result as unknown as Answered;
}

/** Say something to the chat, or press a choice. */
const say = async (projectId: string, question: string, sitting?: ChoicePin, sessionId?: string): Promise<Answered> =>
  resultOf(await realFetch(`${base}/api/projects/${projectId}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, ...(sitting ? { sitting } : {}), ...(sessionId ? { sessionId } : {}) }) }));

/** Press Undo under a reply. */
const undo = (projectId: string, turn: Pick<ProjectChatTurn, 'id'>): Promise<Answered> => say(projectId, 'Undo that message', { undo: { turnId: turn.id } });

async function drop(projectId: string, files: Array<[string, Buffer]>): Promise<Answered> {
  const form = new FormData();
  for (const [name, bytes] of files) form.append('files', new Blob([bytes], { type: 'application/pdf' }), name);
  form.append('question', '');
  return resultOf(await realFetch(`${base}/api/projects/${projectId}/chat/files`, { method: 'POST', body: form }));
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-undo-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('http://127.0.0.1')) throw new Error('this test has no network');
    return realFetch(input as Parameters<typeof fetch>[0], init);
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
  // A drop and a plan go on after their reply: let that end before the directory goes.
  const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
  await afterReplyWorkDone();
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of ['REALYTICA_AUTH_MODE', 'REALYTICA_DATA_DIR']) delete process.env[name];
});

describe('what a reply changed', () => {
  it('is listed under a reply that changed the record, and under no other', async () => {
    const project = await seeded();
    // A record from an earlier build: one whole copy of the file kept for the last instruction.
    const { storageAdapter } = await import('../apps/api/src/storage');
    await storageAdapter.putDocument(project.id, 'undo-old-token.json', Buffer.from('{}'), 'application/json');
    (await stored(project.id)).lastUndo = { token: 'old-token', label: 'the last change', state: 'x', at: '2026-09-01T00:00:00.000Z' };
    const set = await say(project.id, 'Set owner to Asha Rao');
    assert.deepEqual([set.project.lastUndo, await inStorage(project.id, 'undo-old-token.json')], [undefined, false], 'the whole copy an earlier build kept is let go');
    assert.deepEqual(set.assistantTurn.changed, { lines: ['Set the owner to Asha Rao'], kept: true });
    assert.equal((await say(project.id, 'what is the budget?')).assistantTurn.changed, undefined, 'a question changed nothing');
    // What it takes to put it back is a small file of its own, named by the reply, and the record holds none of it.
    assert.ok(await inStorage(project.id, `changes-${set.assistantTurn.id}.json`));
    assert.ok(!JSON.stringify((await stored(project.id)).conversation).includes('"before"'));
  });
});

describe('undoing a message', () => {
  it('is done on its own, later, after other things have happened, and takes back no later work', async () => {
    const project = await seeded();
    const owner = await say(project.id, 'Set owner to Asha Rao');
    await say(project.id, 'Set the budget to 5000000');
    await say(project.id, 'Add an action: get the tax receipt');
    const back = await undo(project.id, owner.assistantTurn);
    // The undo is itself a message, and says what it put back.
    assert.deepEqual([back.userTurn.text, back.assistantTurn.text.split('\n')], ['Undo that message', ['Undone:', '- Set the owner to Asha Rao.']]);
    assert.deepEqual([back.project.owner, back.project.budget, back.project.actions.map((action) => action.title)], [undefined, 5_000_000, ['get the tax receipt']], 'the budget and the action came later and stay');
    const undone = back.project.conversation.find((turn) => turn.id === owner.assistantTurn.id)!.changed!.undone!;
    assert.deepEqual([undone.back, undone.of], [1, 1]);
    assert.equal(back.assistantTurn.changed, undefined, 'an undo is not itself undone');
    assert.ok(!(await inStorage(project.id, `changes-${owner.assistantTurn.id}.json`)), 'what was kept to undo it has gone');

    // Once, and no more.
    const twice = await undo(project.id, owner.assistantTurn);
    assert.equal(twice.assistantTurn.text, 'That message was already undone. Nothing more was changed.');
    assert.equal(twice.project.budget, 5_000_000);
  });

  it('leaves what was changed again since, and says which and why', async () => {
    const project = await seeded();
    const first = await say(project.id, 'Set the budget to 5000000');
    await say(project.id, 'Set the budget to 6000000');
    const back = await undo(project.id, first.assistantTurn);
    assert.deepEqual(back.assistantTurn.text.split('\n'), ['Nothing was undone.', 'Left as it is:', '- Set the budget to 50,00,000: it was changed again since.']);
    assert.equal(back.project.budget, 6_000_000);
    assert.equal(back.project.conversation.find((turn) => turn.id === first.assistantTurn.id)!.changed!.undone, undefined, 'nothing went back, so it is not marked undone');
  });

  it('means the last thing this chat changed when it is typed alone', async () => {
    const project = await seeded();
    await say(project.id, 'Set owner to Asha Rao', undefined, 'sit_one');
    await say(project.id, 'what is the budget?', undefined, 'sit_one');
    const back = await say(project.id, 'undo', undefined, 'sit_one');
    assert.deepEqual([back.assistantTurn.text.split('\n')[0], back.project.owner], ['Undone:', undefined]);
    assert.equal((await say(project.id, 'Undo that.', undefined, 'sit_one')).assistantTurn.text, 'Nothing this chat changed is there to undo.');
  });

  it('is told to the trail with the records it put something back on', async () => {
    const project = await seeded();
    const added = await say(project.id, 'Add an action: get the tax receipt');
    const actionId = added.project.actions[0]!.id;
    const back = await undo(project.id, added.assistantTurn);
    assert.deepEqual(back.project.actions, []);
    const event = (await stored(project.id)).audit.at(-1)!;
    assert.deepEqual([event.action, event.entityType, event.about], ['undo', 'project', [actionId]]);
  });

  it('is the author’s to do, and nobody else’s', async () => {
    const project = await seeded();
    const set = await say(project.id, 'Set owner to Asha Rao');
    const { undoTurn } = await import('../apps/api/src/chat-changes');
    const refused = await undoTurn(await stored(project.id), set.assistantTurn.id, 'somebody.else@example.com');
    assert.deepEqual([refused.done, (await stored(project.id)).owner], [false, 'Asha Rao']);
  });
});

describe('a dropped paper', () => {
  it('is taken off the register with its file, and one decided since stays with its file', async () => {
    const project = await seeded();
    const dropped = await drop(project.id, [['khata.pdf', await pdfOf(KHATA)], ['tax-receipt.pdf', await pdfOf(TAX)]]);
    assert.equal(dropped.assistantTurn.changed?.lines.filter((line) => line.startsWith('Filed “')).length, 2, JSON.stringify(dropped.assistantTurn.changed));
    const [khata, tax] = dropped.project.evidence;
    const keyOf = (row: DdProject['evidence'][number]): string => row.attachments[0]!.storageKey;
    assert.ok((await inStorage(project.id, keyOf(khata!))) && (await inStorage(project.id, keyOf(tax!))));
    // A person accepts a value on the first paper, on its page and not in the chat.
    const waiting = proposedFacts(khata!)[0]!;
    const decided = await realFetch(`${base}/api/projects/${project.id}/evidence/${khata!.id}/facts/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: [waiting.key], decision: 'accept' }) });
    assert.equal(decided.status, 200);

    const back = await undo(project.id, dropped.assistantTurn);
    assert.deepEqual(back.project.evidence.map((row) => row.id), [khata!.id], 'the paper nobody touched is gone, and the one with a decision on it stays');
    assert.match(back.assistantTurn.text, /^Undone, \d+ of \d+:\n- Filed “[^”]+”\.\nThe file it added is removed from storage\.\nLeft as it is:\n- Filed “[^”]+”: it was changed again since\.$/);
    assert.deepEqual([await inStorage(project.id, keyOf(khata!)), await inStorage(project.id, keyOf(tax!))], [true, false]);
  });
});

describe('a pasted meeting', () => {
  it('goes with its words and the cards it raised', async () => {
    const project = await seeded();
    const notes = ['Minutes of the site meeting', 'Date: 3 October 2026', 'Present: Asha Rao, Vikram Nair', 'Decision: The compound wall will be rebuilt on the north side.', 'Action: Vikram to get the tax receipt by 20 October 2026.'].join('\n');
    const kept = await say(project.id, notes);
    assert.deepEqual(kept.assistantTurn.changed?.lines, ['Kept the notes of a meeting of 3 Oct 2026']);
    const meeting = kept.project.meetings![0]!;
    assert.ok(await inStorage(project.id, meeting.file.storageKey));
    assert.ok(kept.project.chatProposals.some((card) => card.status === 'proposed'), 'what the notes say waits on cards');

    const back = await undo(project.id, kept.assistantTurn);
    assert.deepEqual([back.project.meetings ?? [], back.project.chatProposals.filter((card) => card.status === 'proposed')], [[], []]);
    assert.deepEqual(back.assistantTurn.text.split('\n'), ['Undone:', '- Kept the notes of a meeting of 3 Oct 2026.', 'The file it added is removed from storage.']);
    assert.ok(!(await inStorage(project.id, meeting.file.storageKey)), 'the words are not left in storage with nothing pointing at them');
  });
});

describe('a step of a plan', () => {
  it('is undone from the line that ticked it off', async () => {
    const { store } = await import('../apps/api/src/store');
    const { storageAdapter } = await import('../apps/api/src/storage');
    const project = createProject({ name: 'Northfield corner plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, `RYT-${Math.random().toString(36).slice(2, 8)}`);
    for (const [n, lines] of [KHATA, TAX].entries()) {
      const row = addEvidence(project, { title: `Paper ${n + 1}`, kind: 'document' }, LEAD);
      const bytes = await pdfOf(lines);
      await storageAdapter.putDocument(project.id, `paper-${project.id}-${n}.pdf`, bytes, 'application/pdf');
      attachEvidenceFile(project, row.id, { fileName: `paper-${n + 1}.pdf`, mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: `paper-${project.id}-${n}.pdf` }, LEAD);
    }
    addQuestionnaire(project, { title: 'Lender’s questions', parsed: { header: [], questions: [{ text: 'What is the khata number?' }] } }, LEAD);
    store.data.projects!.push(project);
    await store.save();

    const shown = await say(project.id, 'Read the filed papers, then suggest answers to the questionnaire');
    const ran = await say(project.id, 'Run the plan', { plan: { id: shown.assistantTurn.planId!, act: 'run' } });
    const tick = ran.project.conversation.find((turn) => turn.text.startsWith('Step 1 of 2 done.'))!;
    assert.ok(tick.changed?.kept && tick.changed.lines.every((line) => line.startsWith('Read “')), JSON.stringify(tick.changed));
    assert.ok(ran.project.evidence.every((row) => row.facts?.length), 'the step read both papers');

    const back = await undo(project.id, tick);
    assert.match(back.assistantTurn.text, /^Undone:\n- Read “Paper 1”\.\n- Read “Paper 2”\.$/);
    assert.ok(back.project.evidence.every((row) => !row.facts?.length && row.attachments.length === 1), 'the readings are gone, and the papers and their files are as they were');
  });
});
