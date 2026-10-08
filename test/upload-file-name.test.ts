/**
 * A file keeps the name it was sent under.
 *
 * A browser writes a file's name into an upload as UTF-8, and multer reads it
 * as Latin-1. A name in plain English comes through either way. Any other
 * letter came through as two or three wrong ones, and that is what the reply,
 * the register and the stored row then showed: "Contractor’s letter" with its
 * apostrophe broken, a Kannada or a Hindi name as nothing a person could read.
 *
 * The name is read again as UTF-8 once, as the file is taken in, and only
 * where that is sound. The first block asks the rule itself. The second sends
 * real uploads to each route that takes files, with the name written the way
 * a browser writes it. Nothing in this file may reach the network.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { addEvidence, createProject, type DdProject } from '@realytica/shared';
import { sentFileName } from '../apps/api/src/uploads';

const CURLY = 'Contractor’s letter on the delay.pdf';
const KANNADA = 'ಗುತ್ತಿಗೆದಾರರ ಪತ್ರ.pdf';
const HINDI = 'बैठक का विवरण.pdf';
const PLAIN = 'Plain covering note.pdf';

/** A name as multer hands it on: its UTF-8 bytes, each read as one Latin-1 letter. */
const asMulterReads = (name: string) => Buffer.from(name, 'utf8').toString('latin1');

describe('the name of an uploaded file', () => {
  it('is read back from the Latin-1 that multer made of it: a curly apostrophe, Kannada and Hindi', () => {
    assert.notEqual(asMulterReads(CURLY), CURLY, 'the fault this is for: the apostrophe arrives as three wrong letters');
    for (const name of [CURLY, KANNADA, HINDI]) assert.equal(sentFileName(asMulterReads(name)), name);
  });

  it('leaves a plain English name as it is', () => {
    assert.equal(asMulterReads(PLAIN), PLAIN);
    assert.equal(sentFileName(PLAIN), PLAIN);
    assert.equal(sentFileName(''), '');
  });

  it('leaves a name that is already beyond Latin-1, which was read right the first time', () => {
    for (const name of [CURLY, KANNADA, HINDI]) assert.equal(sentFileName(name), name);
    // Twice is the same as once: a name put right is not read again into something else.
    assert.equal(sentFileName(sentFileName(asMulterReads(KANNADA))), KANNADA);
  });

  it('leaves a name whose bytes are not UTF-8, which was Latin-1 all along', () => {
    // "é" sent as the one Latin-1 byte E9, by a client that does not write UTF-8.
    assert.equal(sentFileName('Relev\xe9 cadastral.pdf'), 'Relev\xe9 cadastral.pdf');
    // And the same letter as a browser sends it comes back as itself.
    assert.equal(sentFileName(asMulterReads('Relev\xe9 cadastral.pdf')), 'Relev\xe9 cadastral.pdf');
    // A stray high byte in an otherwise plain name.
    assert.equal(sentFileName('scan\xa0001.pdf'), 'scan\xa0001.pdf');
  });
});

let server: Server;
let base: string;
let dataDir: string;

async function pdfOf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((line, i) => page.drawText(line, { x: 40, y: 780 - i * 22, size: 11, font }));
  return Buffer.from(await doc.save());
}

/** A letter the reader knows no kind for, so its row is titled by the file's name. */
const letter = (about: string) => pdfOf(['Shree Constructions, 14 Lalbagh Road', 'Dear Sir,', `We write about ${about}.`, 'Yours faithfully,']);

/** The smallest picture a phone could send. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function seeded(): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  const p = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, `RYT-${Math.random().toString(36).slice(2, 8)}`);
  store.data.projects!.push(p);
  await store.save();
  return p;
}

/** One upload, its files named as a browser names them: fetch writes a name as UTF-8, as a browser does. */
async function send(url: string, field: string, files: Array<[string, Buffer, string]>, more: Record<string, string> = {}): Promise<Response> {
  const form = new FormData();
  for (const [name, bytes, type] of files) form.append(field, new Blob([bytes], { type }), name);
  for (const [key, value] of Object.entries(more)) form.append(key, value);
  return fetch(`${base}${url}`, { method: 'POST', body: form });
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-file-name-'));
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
  // A drop is still the request's work after its reply: let that end before its directory goes.
  const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
  await afterReplyWorkDone();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('a file sent to each route that takes files', () => {
  it('dropped in the chat: the reply, the row’s title and the stored file all carry the name as sent', async () => {
    const p = await seeded();
    const names = [CURLY, KANNADA, HINDI, PLAIN];
    const files = await Promise.all(names.map(async (name, i): Promise<[string, Buffer, string]> => [name, await letter(['the delay', 'the retention money', 'the meeting', 'the covering note'][i]!), 'application/pdf']));
    const res = await send(`/api/projects/${p.id}/chat/files`, 'files', files, { question: '' });
    const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
    const result = lines.find((l) => l.type === 'result')!;
    const project = result.project as DdProject;
    const kept = project.evidence.flatMap((e) => e.attachments.map((a) => a.fileName));
    assert.deepEqual([...kept].sort(), [...names].sort());
    for (const name of names) {
      const stem = name.replace(/\.pdf$/, '');
      assert.ok(project.evidence.some((e) => e.title === stem), `a row is titled “${stem}”`);
      assert.ok((result.assistantTurn.text as string).includes(name), `the reply names ${name}`);
    }
  });

  it('attached to a row, alone and with a whole pack: the stored file carries the name as sent', async () => {
    const p = await seeded();
    const row = addEvidence(p, { title: 'Sale deed', kind: 'document', status: 'expected' });
    const other = addEvidence(p, { title: 'Khata', kind: 'document', status: 'expected' });
    const { store } = await import('../apps/api/src/store');
    await store.save();
    const one = await send(`/api/projects/${p.id}/evidence/${row.id}/files`, 'files', [[KANNADA, await letter('the deed'), 'application/pdf']]);
    assert.equal(one.status, 201);
    assert.deepEqual(((await one.json()) as Array<{ fileName: string }>).map((a) => a.fileName), [KANNADA]);
    const pack = await send(`/api/projects/${p.id}/evidence/files`, 'files', [[HINDI, await letter('the khata'), 'application/pdf'], [CURLY, await letter('the delay'), 'application/pdf']], { targets: JSON.stringify([other.id, other.id]) });
    assert.equal(pack.status, 201);
    assert.deepEqual(((await pack.json()) as Array<{ fileName: string }>).map((a) => a.fileName), [HINDI, CURLY]);
    const now = store.data.projects!.find((x) => x.id === p.id)!;
    assert.deepEqual(now.evidence.find((e) => e.id === row.id)!.attachments.map((a) => a.fileName), [KANNADA]);
    assert.deepEqual(now.evidence.find((e) => e.id === other.id)!.attachments.map((a) => a.fileName), [HINDI, CURLY]);
  });

  it('a site photograph: kept under its name, and a file refused is named as it was sent', async () => {
    const p = await seeded();
    const photo = HINDI.replace(/\.pdf$/, '.png');
    const taken = await send(`/api/projects/${p.id}/site-log/photos`, 'photos', [[photo, PNG, 'image/png']]);
    assert.equal(taken.status, 201);
    assert.deepEqual(((await taken.json()) as { photos: Array<{ fileName: string }> }).photos.map((f) => f.fileName), [photo]);
    const refused = await send(`/api/projects/${p.id}/site-log/photos`, 'photos', [[KANNADA, await letter('the site'), 'application/pdf']]);
    assert.equal(refused.status, 400);
    const said = (await refused.json()) as { error: string; refused: string[] };
    assert.deepEqual(said.refused, [KANNADA]);
    assert.ok(said.error.includes(KANNADA));
  });

  it('a questionnaire: titled by its file’s name, which is kept with it', async () => {
    const p = await seeded();
    const name = 'ಪ್ರಶ್ನಾವಳಿ – ಹಕ್ಕು.csv';
    const csv = Buffer.from('Sl. No.,Question,Response\n1,What is the survey number of the land?,\n2,Who is the architect of record?,\n', 'utf8');
    const res = await send(`/api/projects/${p.id}/questionnaires`, 'file', [[name, csv, 'text/csv']], { department: 'legal' });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { project: DdProject; questionnaireId: string };
    const sheet = body.project.questionnaires!.find((q) => q.id === body.questionnaireId)!;
    assert.equal(sheet.fileName, name);
    assert.equal(sheet.title, name.replace(/\.csv$/, ''));
  });
});
