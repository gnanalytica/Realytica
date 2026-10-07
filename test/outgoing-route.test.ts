/**
 * What goes out, over real HTTP, with a stand-in for the model.
 *
 * `outgoing.test.ts` holds the rules. This holds the wiring: that a reply
 * asked for in the chat is made by the chat's rules and written by a model
 * that is sent the record's words and nothing else; that what the model
 * writes is held to those words before it is kept; that an approval is of
 * the draft the approver was shown, and one changed since answers 409; that
 * a named approval, a change after it and an export each leave their line in
 * the trail; and that the Word file says what the draft says, with DRAFT,
 * NOT APPROVED in its header until somebody has approved it.
 *
 * The letter, the parties and the numbers are invented.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { OUTGOING_NOT_APPROVED, addEvidence, attachEvidenceFile, createProject, outgoingDocument, outgoingSeen, proposeFacts, type DdProject, type EvidenceRecord, type OutgoingDraft } from '@realytica/shared';
import { outgoingDocx } from '../apps/web/src/lib/outgoing-docx';

const LETTER = [
  'Tamarind Ladder Constructions LLP\nTo the Project Office, Navilugudda land.\nWe write about the delay to the podium slab. Completion will move from 14 March 2027 to 30 April 2027.\nThe delay follows the late issue of the revised structural drawings.',
  'We claim an extension of 47 days and no additional cost at this stage.\nPlease confirm the revised date in writing.',
];

let server: Server;
let model: Server;
let base: string;
let dataDir: string;
const asked: Array<{ tool: string; text: string; parts: string[] }> = [];

function streamMessage(res: ServerResponse, input: unknown, tool: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model: 'stand-in', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 120, output_tokens: 1 } } });
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_0', name: tool, input: {} } });
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 60 } });
  send('message_stop', { type: 'message_stop' });
  res.end();
}

async function bodyOf(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Record<string, any> }> {
  const res = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('application/json') && text ? JSON.parse(text) : {} };
}

/** A project in the store with a contractor's letter on it, read, with the words of its two pages kept beside its file. */
async function seeded(): Promise<{ project: DdProject; letter: EvidenceRecord }> {
  const { store } = await import('../apps/api/src/store');
  const { storageAdapter } = await import('../apps/api/src/storage');
  const { pageTextKey } = await import('../apps/api/src/documents/page-text');
  const project = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, `RYT-${Math.floor(Math.random() * 9000) + 1000}`);
  const letter = addEvidence(project, { title: 'Contractor’s letter on the delay', kind: 'document', status: 'received' }, 'tester');
  const storageKey = `letter-${project.id}.pdf`;
  attachEvidenceFile(project, letter.id, { fileName: 'letter.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey, capture: {} }, 'tester');
  letter.documentType = 'Correspondence';
  letter.readMethod = 'text';
  // One value the rules read surely, which stands, and a model's, which waits and is no source.
  letter.facts = proposeFacts(
    [],
    [
      { key: 'extension_days', label: 'Extension claimed', value: 47, display: '47 days', page: 2, quote: 'We claim an extension of 47 days' },
      { key: 'claim_amount', label: 'Amount claimed', value: 9100000, display: 'Rs. 91,00,000', page: 2, quote: 'no additional cost at this stage', source: 'model', proof: 'second_reader' },
    ],
  );
  const kept = { v: 1, fileName: 'letter.pdf', readAt: new Date().toISOString(), pagesInFile: 2, pagesRead: 2, pages: LETTER.map((text, i) => ({ page: i + 1, reader: 'text', text })) };
  await storageAdapter.putDocument(project.id, pageTextKey(storageKey), Buffer.from(JSON.stringify(kept)), 'application/json');
  store.data.projects!.push(project);
  await store.save();
  return { project, letter };
}

/** The parts of a Word file, by name. */
async function partsOf(bytes: Uint8Array): Promise<Record<string, string>> {
  // The Word library is the web app's own, and it brings the zip reader a .docx is read back with.
  const web = createRequire(path.resolve('apps/web/package.json'));
  const JSZip = createRequire(web.resolve('docx'))('jszip') as { loadAsync(data: Uint8Array): Promise<{ files: Record<string, { async(kind: 'string'): Promise<string> }> }> };
  const zip = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  for (const [name, file] of Object.entries(zip.files)) if (name.endsWith('.xml')) out[name] = await file.async('string');
  return out;
}

/** The words of one part, without their markup. */
const wordsOf = (xml: string): string => xml.replace(/<w:p[ >]/g, '\n<w:p>').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-outgoing-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  model = createServer(async (req, res) => {
    const sent = await bodyOf(req);
    const content = (sent.messages?.[0]?.content ?? []) as Array<{ type: string; text?: string }> | string;
    const text = typeof content === 'string' ? content : content.map((part) => part.text ?? '').join('\n');
    const tool = String(sent.tools?.[0]?.name ?? '');
    asked.push({ tool, text, parts: typeof content === 'string' ? ['text'] : content.map((part) => part.type) });
    // The sources as they were numbered for it: the one that gives the days claimed, and the one with the dates.
    const numbered = [...text.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({ n: Number(m[1]), line: m[2]! }));
    const days = numbered.find((source) => source.line.includes('Extension claimed'))?.n ?? 0;
    const dates = numbered.find((source) => source.line.includes('14 March 2027'))?.n ?? 0;
    streamMessage(
      res,
      {
        paragraphs: [
          {
            sentences: [
              { text: 'You write that completion will move from 14 March 2027 to 30 April 2027.', sources: [dates] },
              { text: 'You claim an extension of 47 days. [9]', sources: [days] },
              // A figure the source does not write: the number comes off it.
              { text: 'You claim an extension of 74 days.', sources: [days] },
              // A source that is not on the list.
              { text: 'The slab was inspected on 2 February 2027.', sources: [99] },
            ],
          },
          { sentences: [{ text: 'Please send the revised programme.', sources: [] }] },
        ],
      },
      tool,
    );
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', () => resolve()));
  process.env.REALYTICA_BASE_URL = `http://127.0.0.1:${(model.address() as AddressInfo).port}`;
  process.env.REALYTICA_API_KEY = 'a-key-for-nobody';
  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await call('GET', '/api/projects')).status, 200);
});

after(async () => {
  for (const name of ['REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_DATA_DIR', 'REALYTICA_AUTH_MODE']) delete process.env[name];
  model?.closeAllConnections();
  model?.close();
  server?.closeAllConnections();
  server?.close();
  // A chat's reply may leave work running: let that end before its directory goes.
  const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
  await afterReplyWorkDone();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('a reply asked for in the chat', () => {
  it('is made by the rules, written by a model held to the record, approved by name, put back by a change, and leaves as a Word file', async () => {
    const { project, letter } = await seeded();
    const { store } = await import('../apps/api/src/store');
    const held = JSON.stringify(letter.facts);
    const at = `/api/projects/${project.id}/outgoing`;

    const res = await fetch(`${base}/api/projects/${project.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Draft a reply to the contractor’s letter on the delay' }) });
    const lines = (await res.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, any>);
    const result = lines.find((line) => line.type === 'result')!;
    const draftId = result.navigations.find((go: { target: string }) => go.target === 'outgoing')?.item as string;
    const made = (result.project.outgoing as OutgoingDraft[]).find((draft) => draft.id === draftId)!;
    assert.match(result.assistantTurn.text, new RegExp(`^Drafted a reply to “Contractor’s letter on the delay” as ${project.reference}/OUT/1\\. It is open in Outgoing\\. 2 statements rest on the record, and 3 are the drafter’s own to check\\.`));
    assert.match(result.assistantTurn.text, /nothing goes out until a lead or a signer approves it\.$/);
    assert.deepEqual([made.kind, made.to, made.status, made.written], ['reply', 'The contractor', 'draft', 'model']);

    // The model was sent words and nothing else: the value that stands and the letter's own lines, never the value that waits.
    const sent = asked.filter((one) => one.tool === 'record_outgoing_draft');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.parts, ['text']);
    assert.match(sent[0]!.text, /Extension claimed: 47 days/);
    assert.match(sent[0]!.text, /page 1: “.*14 March 2027 to 30 April 2027/);
    assert.doesNotMatch(sent[0]!.text, /91,00,000|Amount claimed/);

    // A number is kept where the sentence holds to its source, and comes off where it does not. A mark the model typed is not one.
    const dates = made.sources.find((source) => source.passage && source.says.includes('14 March 2027'))!.n;
    const days = made.sources.find((source) => source.says === 'Extension claimed: 47 days')!.n;
    assert.equal(
      made.body,
      [`You write that completion will move from 14 March 2027 to 30 April 2027. [${dates}]`, `You claim an extension of 47 days. [${days}]`, 'You claim an extension of 74 days.', 'The slab was inspected on 2 February 2027.', '', 'Please send the revised programme.'].join('\n'),
    );

    // Nothing on the record moved: the paper's values are as they were and no card was raised.
    const kept = store.data.projects!.find((one) => one.id === project.id)!;
    assert.equal(JSON.stringify(kept.evidence.find((row) => row.id === letter.id)!.facts), held);
    assert.equal(kept.chatProposals.length, 0);

    // The file of a draft says so in its header, which is on every page, and lists the sources it uses with paper and page.
    const draftFile = await partsOf(await outgoingDocx(outgoingDocument(kept, made)));
    const header = Object.entries(draftFile).find(([name]) => /^word\/header\d*\.xml$/.test(name));
    assert.ok(header && wordsOf(header[1]).includes(OUTGOING_NOT_APPROVED), 'the header of a draft says it is not approved');
    const page = wordsOf(draftFile['word/document.xml']!);
    assert.match(page, /You write that completion will move from 14 March 2027 to 30 April 2027\. \[1\] You claim an extension of 47 days\. \[2\]/);
    assert.match(page, /Sources\s+1\. Contractor’s letter on the delay, page 1: “.*14 March 2027.*”\s+2\. Contractor’s letter on the delay, page 2: Extension claimed: 47 days/);
    assert.doesNotMatch(page, /Approved for sending/);

    // An approval is of the words the approver was shown. She read the draft above, it was changed to say something else, and then she pressed approve.
    await call('PUT', `${at}/${draftId}`, { body: 'We accept that the delay is ours and waive any claim over it.' });
    for (const sent of [{ seen: outgoingSeen(made) }, {}]) {
      const stale = await call('POST', `${at}/${draftId}/approve`, sent);
      assert.deepEqual([stale.status, stale.body.error], [409, 'This draft was changed after you opened it. Read it again before you approve.']);
    }
    assert.equal(kept.outgoing![0]!.status, 'draft', 'nothing she did not read was approved');
    const again = ((await call('PUT', `${at}/${draftId}`, { body: made.body })).body.drafts as OutgoingDraft[])[0]!;

    // Approved by name, with the time: the draft as she reads it now.
    const approved = await call('POST', `${at}/${draftId}/approve`, { seen: outgoingSeen(again) });
    const one = (approved.body.drafts as OutgoingDraft[])[0]!;
    assert.deepEqual([approved.status, one.status, Boolean(one.approvedBy), Boolean(one.approvedAt), approved.body.mayApprove], [200, 'approved', true, true, true]);
    const approvedFile = await partsOf(await outgoingDocx(outgoingDocument(kept, one)));
    assert.ok(!Object.values(approvedFile).some((xml) => xml.includes(OUTGOING_NOT_APPROVED)), 'an approved file does not say it is a draft');
    assert.match(wordsOf(approvedFile['word/document.xml']!), new RegExp(`Approved for sending by ${(one.approvedName ?? one.approvedBy)!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} on `));
    // A file is handed over only for the draft it was made from: a copy read before the approval makes none, and its approval is not that copy's to take back.
    assert.equal((await call('POST', `${at}/${draftId}/exported`, { seen: outgoingSeen(again) })).status, 409);
    assert.equal((await call('POST', `${at}/${draftId}/reopen`, { seen: outgoingSeen(again) })).status, 409);
    assert.equal((await call('POST', `${at}/${draftId}/exported`, { seen: outgoingSeen(one) })).status, 200);

    // A change after approval puts it back to draft.
    const changed = await call('PUT', `${at}/${draftId}`, { body: `${one.body}\nWe will answer the claim once it is received.` });
    const back = (changed.body.drafts as OutgoingDraft[])[0]!;
    assert.deepEqual([changed.status, back.status, back.approvedBy, back.approvedAt], [200, 'draft', undefined, undefined]);

    // A figure typed against a source that does not give it stops the approval, and says why.
    const wrong = ((await call('PUT', `${at}/${draftId}`, { body: `You claim an extension of 74 days. [${days}]` })).body.drafts as OutgoingDraft[])[0]!;
    const refused = await call('POST', `${at}/${draftId}/approve`, { seen: outgoingSeen(wrong) });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /writes a figure its source does not/);

    assert.deepEqual(
      kept.audit.filter((event) => event.entityType === 'outgoing').map((event) => event.action),
      ['outgoing_drafted', 'outgoing_approved', 'outgoing_exported', 'outgoing_reopened'],
    );
  });
});
