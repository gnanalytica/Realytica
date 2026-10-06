/**
 * Papers dropped together are read three at a time, and each is on the file
 * the moment it is read.
 *
 * They used to be read one after another, and nothing was written until the
 * last was done: a page closed while the ninth was being read lost all nine.
 * Invented papers only; no model, and nothing leaves this machine.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { addEvidence, applyProjectChat, attachEvidenceFile, createAssessment, createProject, landIngestFile, proposedFacts, reviewFacts, type ChatIngestFile, type DdProject } from '@realytica/shared';
import { PAPERS_AT_ONCE, together } from '../apps/api/src/documents/together';

let server: Server;
let base: string;
let dataDir: string;

/** A typed page, which this server reads in a moment with no OCR. */
async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((line, i) => page.drawText(line, { x: 40, y: 780 - i * 22, size: 11, font }));
  return Buffer.from(await doc.save());
}

const PAPERS: Array<[string, string[]]> = [
  ['deed.pdf', ['SALE DEED', 'This deed of absolute sale is made and executed at Suvarnagiri.', 'SCHEDULE: all that piece of land bearing Survey No. 73/4, measuring 2,450 square metres.']],
  ['khata.pdf', ['KHATA CERTIFICATE', 'Khata No. 112/4', 'Site area: 1,115 square metres']],
  ['receipt.pdf', ['PROPERTY TAX RECEIPT', 'SAS Application No. 2024-25-0047 for the assessment year 2024-25', 'Tax paid: Rs. 47,616 on 11-05-2024']],
  ['zoning.pdf', ['ZONING CERTIFICATE', 'The land bearing Survey No. 19/2 is classified as Residential (Mixed) in the plan in force.']],
];

async function drop(projectId: string, signal?: AbortSignal): Promise<Response> {
  const form = new FormData();
  for (const [name, lines] of PAPERS) form.append('files', new Blob([await pdfOf(lines)], { type: 'application/pdf' }), name);
  form.append('question', '');
  return fetch(`${base}/api/projects/${projectId}/chat/files`, { method: 'POST', body: form, signal });
}

async function seeded(): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  const p = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, `RYT-${Math.random().toString(36).slice(2, 8)}`);
  store.data.projects!.push(p);
  await store.save();
  return p;
}

const filedOn = (p: DdProject, fileName: string) => p.evidence.find((e) => e.attachments.some((a) => a.fileName === fileName));

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-together-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = createServer(app).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  const { releaseOcr } = await import('../apps/api/src/documents/read-text');
  await releaseOcr();
  // A paper whose page was closed is still read after the reply: let that end before its directory goes.
  const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
  await afterReplyWorkDone();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('papers read together', () => {
  it('are started in the order given, three at a time, and one that fails does not fail the rest', async () => {
    assert.equal(PAPERS_AT_ONCE, 3);
    let under = 0;
    let most = 0;
    const startedAt: number[] = [];
    const done = await together([40, 10, 10, 10, 10, 10], PAPERS_AT_ONCE, async (ms, index) => {
      startedAt.push(index);
      under += 1;
      most = Math.max(most, under);
      await new Promise((resolve) => setTimeout(resolve, ms));
      under -= 1;
      if (index === 1) throw new Error('this one could not be read');
      return index;
    });
    assert.equal(most, 3, 'never more than three under way');
    assert.deepEqual(startedAt, [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(done.map((d) => (d.status === 'fulfilled' ? d.value : 'failed')), [0, 'failed', 2, 3, 4, 5], 'each in its own place, whichever finished first');
  });

  it('recognises as many scanned pages at once as there are processors, and no more than three', async () => {
    const { ocrPagesAtOnce } = await import('../apps/api/src/documents/read-text');
    const asked = process.env.REALYTICA_OCR_PAGES_AT_ONCE;
    delete process.env.REALYTICA_OCR_PAGES_AT_ONCE;
    assert.ok(ocrPagesAtOnce() >= 1 && ocrPagesAtOnce() <= 3);
    process.env.REALYTICA_OCR_PAGES_AT_ONCE = '2';
    assert.equal(ocrPagesAtOnce(), 2, 'a deployment can say how many');
    if (asked === undefined) delete process.env.REALYTICA_OCR_PAGES_AT_ONCE;
    else process.env.REALYTICA_OCR_PAGES_AT_ONCE = asked;
  });

  it('are each saved as they finish, named in the order dropped, and reported in one reply', async () => {
    const p = await seeded();
    const lines = (await (await drop(p.id)).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
    const events = lines.filter((l) => l.type === 'reading');
    const names = PAPERS.map(([name]) => name);
    assert.deepEqual(events.slice(0, 4).map((e) => [e.event, e.fileName]), names.map((name) => ['queued', name]), 'every paper is named before any is read, in the order dropped');
    const filed = events.filter((e) => e.event === 'filed');
    assert.equal(filed.length, 4, 'each is said to be on the file as it finishes');
    assert.ok(filed.every((e) => e.row?.attachments?.length === 1), 'with the row it is on, as saved');
    assert.ok(events.findIndex((e) => e.event === 'filed') < lines.findIndex((l) => l.type === 'result'), 'before the reply that reports the drop');
    assert.equal(lines.filter((l) => l.type === 'step' && / is on the file/.test(l.step.label)).length, 4, 'one line a paper');

    const result = lines.find((l) => l.type === 'result')!;
    const project = result.project as DdProject;
    const rows = project.evidence.filter((e) => e.attachments.length);
    assert.deepEqual(rows.map((e) => e.attachments[0]!.fileName), names, 'the rows are in the order dropped, whichever was read first');
    assert.equal(project.conversation.filter((t) => t.role === 'assistant').length, 1, 'one reply for the drop');
    for (const row of rows) {
      assert.equal(project.audit.filter((a) => a.action === 'read' && a.entityId === row.id).length <= 1, true, 'a reading is written down once');
      assert.equal(project.chatProposals.filter((c) => c.kind === 'file_evidence' && c.payload.storageKey === row.attachments[0]!.storageKey).length, 1, 'and the paper has one card');
    }
    assert.ok(proposedFacts(filedOn(project, 'deed.pdf')!).length > 0, 'what the deed states is waiting on its row');
    assert.equal(project.chatProposals.filter((c) => c.kind === 'file_evidence' && c.status === 'proposed').length, 0, 'and none is left noted as a file not read yet');
    assert.match(String((result.assistantTurn as { metrics?: Array<{ label: string; delta?: string }> }).metrics?.find((m) => m.label === 'Evidence')?.delta), /^\+4$/, 'the reply’s receipt counts from before the drop');
  });

  it('are offered again when the request ended before they were read', async () => {
    // What a request cut short leaves: the paper stored, and noted on the record as a file not read yet.
    const p = await seeded();
    const { store } = await import('../apps/api/src/store');
    const { storageAdapter } = await import('../apps/api/src/storage');
    const { notReadYetCard, droppedUnread } = await import('../apps/api/src/documents/dropped');
    const held = store.data.projects!.find((x) => x.id === p.id)!;
    const bytes = await pdfOf(PAPERS[1]![1]);
    await storageAdapter.putDocument(p.id, 'k-cut-short.pdf', bytes, 'application/pdf');
    held.chatProposals.push(notReadYetCard({ fileName: 'khata.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, storageKey: 'k-cut-short.pdf' }, 'tester'));
    held.updatedAt = new Date().toISOString();
    await store.save();
    assert.deepEqual(droppedUnread(held).map((f) => f.fileName), ['khata.pdf']);

    const res = await fetch(`${base}/api/projects/${p.id}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Read the filed documents' }) });
    const result = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>).find((l) => l.type === 'result')!;
    const project = result.project as DdProject;
    const row = filedOn(project, 'khata.pdf');
    assert.ok(row && proposedFacts(row).length > 0, 'it is read and on a row, with what it states');
    assert.deepEqual(droppedUnread(project), [], 'and no longer noted as unread');
  });

  it('lose nothing when whoever dropped them goes away', async () => {
    const p = await seeded();
    const gone = new AbortController();
    const res = await drop(p.id, gone.signal);
    // The first line has arrived; the page is closed before any paper is read.
    await res.body!.getReader().read();
    gone.abort();
    const { store } = await import('../apps/api/src/store');
    const held = () => store.data.projects!.find((x) => x.id === p.id)!;
    const until = Date.now() + 20_000;
    while (Date.now() < until && !held().conversation.some((t) => t.role === 'assistant')) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(held().evidence.filter((e) => e.attachments.length).map((e) => e.attachments[0]!.fileName), PAPERS.map(([name]) => name), 'every paper is on the file');
    assert.equal(held().conversation.filter((t) => t.role === 'assistant').length, 1, 'and the reply that reports them is in the chat for when they come back');
  });

  it('do not put back to waiting a value a person decided before the reply came', () => {
    const p = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0042');
    const fact = (key: string, value: string | number) => ({ key, label: key, value, display: String(value), page: 1, quote: `${key}: ${value}` });
    const paper: ChatIngestFile = {
      fileName: 'khata.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k-khata',
      read: { type: 'khata', label: 'Khata certificate and extract', confidence: 0.9, method: 'text', summary: 'A khata.', facts: [fact('khata_number', '112/4'), fact('extent_khata', 1115)], flags: [], rowHints: [], scopes: [], evidenceKind: 'document' },
    };
    const rowId = landIngestFile(p, paper, 'tester')!;
    const row = p.evidence.find((e) => e.id === rowId)!;
    assert.deepEqual([row.attachments.length, proposedFacts(row).length, p.chatProposals.length], [1, 2, 0], 'on its row with what it states, and no card of its own left behind');
    // Somebody sets a value aside on the row while the other papers are still being read.
    reviewFacts(p, rowId, ['extent_khata'], 'reject', 'tester');
    applyProjectChat(p, '', { ingest: [{ ...paper, landed: true }] });
    assert.equal(row.facts!.find((f) => f.key === 'extent_khata')!.review, 'rejected', 'the reply does not bring it back');
    assert.equal(row.attachments.length, 1, 'nor file the paper twice');
    assert.equal(p.audit.filter((a) => a.action === 'read' && a.entityId === rowId).length, 1, 'nor write the reading down twice');
  });

  it('offer a paper’s checks the row as it stands when the reply is written, not the reading as it was read', () => {
    const p = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0047');
    createAssessment(p, { ddType: 'acquisition', name: 'Acquisition', owner: 'tester', targetType: 'project' });
    const fact = (key: string, value: string | number) => ({ key, label: key, value, display: String(value), page: 1, quote: `${key}: ${value}` });
    const paper: ChatIngestFile = {
      fileName: 'khata.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: 'k-khata-2',
      read: { type: 'khata', label: 'Khata certificate and extract', confidence: 0.9, method: 'text', summary: 'A khata.', facts: [fact('survey_numbers', '73/4'), fact('extent_khata', 2450)], flags: [], rowHints: [], scopes: [], evidenceKind: 'document' },
    };
    const rowId = landIngestFile(p, paper, 'tester')!;
    // While the other papers of the drop are still being read: the survey number is set aside, and the extent corrected.
    reviewFacts(p, rowId, ['survey_numbers'], 'reject', 'tester');
    reviewFacts(p, rowId, ['extent_khata'], 'accept', 'tester', { value: 2540, display: '2,540 sqm' });
    applyProjectChat(p, '', { ingest: [{ ...paper, landed: true }] });
    const offered = p.chatProposals.filter((c) => c.kind === 'record_check_fields' && c.status === 'proposed').map((c) => c.payload.values);
    assert.deepEqual(offered, [{ extent_khata: 2540 }], 'the value set aside is offered to no check, and the corrected one as it was corrected');

    // A paper whose row has gone since it landed is filed again, values and all.
    const q = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0048');
    const gone = landIngestFile(q, paper, 'tester')!;
    q.evidence = q.evidence.filter((e) => e.id !== gone);
    applyProjectChat(q, '', { ingest: [{ ...paper, landed: true }] });
    assert.equal(proposedFacts(q.evidence.find((e) => e.attachments.some((a) => a.storageKey === 'k-khata-2'))!).length, 2);
  });

  it('filed on the register are each put on their row, and saved, as they are read', async () => {
    const { readOntoRegister } = await import('../apps/api/src/documents/register-read');
    const p = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0043');
    const uploads = await Promise.all(
      PAPERS.slice(0, 3).map(async ([fileName, lines]) => {
        const buffer = await pdfOf(lines);
        const row = addEvidence(p, { title: fileName, kind: 'document', status: 'received' });
        attachEvidenceFile(p, row.id, { fileName, mimeType: 'application/pdf', sizeBytes: buffer.length, storageKey: `k-${fileName}`, capture: {} }, 'tester');
        return { evidenceId: row.id, buffer, fileName, mimeType: 'application/pdf', sizeBytes: buffer.length, storageKey: `k-${fileName}` };
      }),
    );
    const turns = p.conversation.length;
    const saved: Array<[string, number, boolean]> = [];
    const done = await readOntoRegister(p, uploads, 'tester', {
      landed: async (file) => {
        const row = p.evidence.find((e) => e.attachments.some((a) => a.storageKey === file.storageKey))!;
        saved.push([file.fileName, (row.facts ?? []).length, p.conversation.length === turns]);
      },
    });
    assert.equal(done.read, 3);
    assert.deepEqual(saved.map(([name]) => name).sort(), ['deed.pdf', 'khata.pdf', 'receipt.pdf']);
    assert.ok(saved.every(([, facts, early]) => facts > 0 && early), 'each with its values on its row, before the note that reports the three');
    assert.equal(p.conversation.length, turns + 1, 'and one note for the batch');
  });
});
