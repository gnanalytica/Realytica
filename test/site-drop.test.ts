/**
 * A voice note and a site photograph taken in through the chat.
 *
 * A voice note is put into words and proposed as a site entry on a card;
 * nothing is on the site log until a person accepts. A photograph of the site
 * is filed to Progress with its date and where the date is from. The sound in
 * these tests is invented bytes and the transcriber is a stand-in on this
 * machine: no voice, no photograph and no model.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import {
  acceptWaiting,
  audioFormat,
  createProject,
  isVoiceNote,
  noteLength,
  pictureOrPaper,
  projectToIdentity,
  readVoiceNote,
  siteEntryCardSaid,
  siteEntryProposed,
  voiceNoteHeld,
  voiceNoteSaid,
  type DdProject,
} from '@realytica/shared';
import { exifTakenAt, localDay } from '../apps/web/src/lib/taken-at';
import { DRAWN_AT, PAPER_LONG_SIDE, TooLargeToSend, mustFitOneMessage, pictureShare } from '../apps/web/src/lib/send-limits';

let server: Server;
let transcriber: Server;
let base: string;
let dataDir: string;
/** What the stand-in transcriber answers with, and what it was last asked. */
let words = '';
/** How long the stand-in keeps any other call waiting before it refuses it, and when it last did. */
let readerWaitsMs = 0;
let readerAnsweredAt = 0;
const asked: Array<{ url: string; key: string | undefined; model: string; format: string; bytes: number }> = [];

const ENGLISH = 'Good evening sir. Yesterday we finished the slab shuttering on the third floor. We had 12 masons and 8 helpers on site. The steel delivery is delayed, two tonnes not received from the supplier. It rained in the afternoon.';
const KANNADA = 'ನಮಸ್ಕಾರ ಸರ್. ಇವತ್ತು ಮೂರನೇ ಮಹಡಿಯ ಸ್ಲ್ಯಾಬ್ ಶಟರಿಂಗ್ ಮುಗಿದಿದೆ. ಸೈಟ್‌ನಲ್ಲಿ 12 ಮೇಸ್ತ್ರಿಗಳು ಇದ್ದರು. ಸ್ಟೀಲ್ ಇನ್ನೂ ಬಂದಿಲ್ಲ, ಎರಡು ಟನ್ ಬಾಕಿ ಇದೆ.';
const MIXED = 'Sir namaskara, aaj third floor ka slab shuttering complete ho gaya. ಸೈಟ್‌ನಲ್ಲಿ 12 masons ಇದ್ದರು. Steel delivery abhi tak nahi aaya, do ton pending hai.';

/** A JPEG's first bytes with the moment a camera wrote in it, and nothing else. */
function jpegTakenAt(moment: string): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4 + 2 + 12 + 4 + 20);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  // IFD0: one entry, the pointer to the Exif IFD.
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  // The Exif IFD: one entry, DateTimeOriginal, twenty characters at offset 44.
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x9003, 28);
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(20, 32);
  tiff.writeUInt32LE(44, 36);
  tiff.write(`${moment}\0`, 44, 'latin1');
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(app1.length + 2, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), head, app1, Buffer.from([0xff, 0xd9])]);
}

/** A small grey picture with nothing written on it. */
function blankPng(side = 64): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    let crc = ~0;
    for (const byte of out.subarray(4, 8 + data.length)) {
      crc ^= byte;
      for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    out.writeUInt32BE(~crc >>> 0, 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  const rows = Buffer.alloc(side * (side + 1), 0x90);
  for (let y = 0; y < side; y += 1) rows[y * (side + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

async function drop(projectId: string, files: Array<[string, Buffer, string]>, captured?: unknown[]): Promise<Array<Record<string, any>>> {
  const form = new FormData();
  for (const [name, bytes, type] of files) form.append('files', new Blob([bytes], { type }), name);
  form.append('question', '');
  if (captured) form.append('captured', JSON.stringify(captured));
  const res = await fetch(`${base}/api/projects/${projectId}/chat/files`, { method: 'POST', body: form });
  return (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
}

async function seeded(): Promise<DdProject> {
  const { store } = await import('../apps/api/src/store');
  const p = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, `RYT-${Math.random().toString(36).slice(2, 8)}`);
  store.data.projects!.push(p);
  await store.save();
  return p;
}

/** The gateway settings as they are while a test runs with or without a transcriber. Put back afterwards. */
function gateway(on: boolean): () => void {
  const keys = ['REALYTICA_BASE_URL', 'REALYTICA_API_KEY', 'REALYTICA_MODEL_TRANSCRIPTION', 'REALYTICA_AGENTS_DISABLED'] as const;
  const was = keys.map((k) => process.env[k]);
  for (const k of keys) delete process.env[k];
  if (on) {
    process.env.REALYTICA_BASE_URL = `http://127.0.0.1:${(transcriber.address() as AddressInfo).port}`;
    process.env.REALYTICA_API_KEY = 'test-key';
    process.env.REALYTICA_MODEL_TRANSCRIPTION = 'stand-in/transcriber';
  }
  return () => keys.forEach((k, i) => (was[i] === undefined ? delete process.env[k] : (process.env[k] = was[i])));
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'realytica-site-drop-'));
  process.env.REALYTICA_DATA_DIR = dataDir;
  process.env.REALYTICA_AUTH_MODE = 'off';
  transcriber = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      // Only the transcription is answered: anything else a model would be asked gets nothing from this machine, at once or after a wait.
      if (!req.url?.endsWith('/v1/audio/transcriptions')) {
        setTimeout(() => {
          readerAnsweredAt = Date.now();
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'a stand-in reads nothing' } }));
        }, readerWaitsMs);
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model: string; input_audio: { data: string; format: string } };
      asked.push({ url: req.url, key: req.headers.authorization, model: body.model, format: body.input_audio.format, bytes: Buffer.from(body.input_audio.data, 'base64').length });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: words, usage: { seconds: 48 } }));
    });
  }).listen(0);
  await new Promise<void>((resolve) => transcriber.once('listening', () => resolve()));
  const { app, initApp } = await import('../apps/api/src/app');
  await initApp();
  server = createServer(app).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  transcriber?.close();
  const { releaseOcr } = await import('../apps/api/src/documents/read-text');
  await releaseOcr();
  // A drop is still the request's work after its reply: let that end before its directory goes.
  const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
  await afterReplyWorkDone();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('what kind of file a note or a picture is', () => {
  it('takes sound for a voice note by what it says it is or by its name, and names its format for the transcriber', () => {
    assert.equal(isVoiceNote({ fileName: 'PTT-20261006-WA0007.opus' }), true, 'as a phone forwards one');
    assert.equal(isVoiceNote({ fileName: 'note', mimeType: 'audio/mp4' }), true);
    assert.equal(isVoiceNote({ fileName: 'clip.webm', mimeType: 'video/webm' }), false, 'a video is not a voice note');
    assert.equal(isVoiceNote({ fileName: 'deed.pdf', mimeType: 'application/pdf' }), false);
    assert.deepEqual(
      [audioFormat({ fileName: 'a.opus' }), audioFormat({ fileName: 'a', mimeType: 'audio/mp4' }), audioFormat({ fileName: 'a.mp3' }), audioFormat({ fileName: 'a.webm', mimeType: 'audio/webm' }), audioFormat({ fileName: 'a.amr' })],
      ['ogg', 'm4a', 'mp3', 'webm', undefined],
    );
  });

  it('tells a picture of the site from a paper that was photographed by the words on it, and asks in between', () => {
    const page = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    assert.equal(pictureOrPaper({ recognised: false, words: '', view: 0.2 }), 'photo', 'no words on it, and plainly a view: not mostly one flat tone');
    assert.equal(pictureOrPaper({ recognised: false, words: 'SITE OFFICE Navilugudda Builders', view: 0.2 }), 'photo', 'a signboard is still the site');
    assert.equal(pictureOrPaper({ recognised: false, words: '', view: 0.9 }), 'unsure', 'no words and mostly one tone: a page OCR could not read looks like this, so it is asked about');
    assert.equal(pictureOrPaper({ recognised: false, words: '' }), 'unsure', 'and so is a picture nobody measured');
    assert.equal(pictureOrPaper({ recognised: false, words: page }), 'paper', 'a page of text photographed is a paper');
    assert.equal(pictureOrPaper({ recognised: true, words: '' }), 'paper', 'and so is one the reader recognises');
    assert.equal(pictureOrPaper({ recognised: false, words: page.split(' ').slice(0, 20).join(' ') }), 'unsure');
  });
});

describe('a voice note’s words read as a site entry', () => {
  it('sorts English by rule, counts a day from when it was recorded, and guesses nothing', () => {
    const read = readVoiceNote(ENGLISH, '2026-10-06');
    assert.deepEqual(read.day, { date: '2026-10-05', quote: 'Yesterday we finished the slab shuttering on the third floor.' });
    assert.deepEqual(read.lines.map((l) => [l.kind, l.text]), [
      // "Good evening sir." greets, and says nothing for the entry.
      ['work', 'Yesterday we finished the slab shuttering on the third floor.'],
      ['manpower', '12 masons'],
      ['manpower', '8 helpers'],
      ['issue', 'The steel delivery is delayed, two tonnes not received from the supplier'],
      ['weather', 'It rained in the afternoon'],
    ]);
    assert.ok(read.lines.every((l) => ENGLISH.includes(l.quote)), 'each line with the words of the note it came from');

    const entry = siteEntryProposed(readVoiceNote('The plastering on the second floor is going on.', '2026-10-06'), { storageKey: 'k', fileName: 'n.ogg', mimeType: 'audio/ogg' }, '2026-10-06')!;
    assert.deepEqual([entry.date, entry.dateFrom], ['2026-10-06', 'recorded'], 'a note that names no day is entered under the day it was recorded');
    assert.match(siteEntryCardSaid(entry).rationale, /^6 Oct 2026 is the day the note was recorded: it names no day\./, 'and the card says which');
    assert.equal(siteEntryProposed(readVoiceNote('', '2026-10-06'), entry.note, '2026-10-06'), undefined, 'nothing said, nothing proposed');
  });

  it('keeps a note in another script whole, in its own words, and says it was not sorted', () => {
    const read = readVoiceNote(KANNADA, '2026-10-06');
    assert.deepEqual([read.sorted, read.lines.length, read.lines[0]!.kind, read.lines[0]!.quote, read.day], [false, 1, 'work', KANNADA, undefined]);
  });

  it('holds a model’s lines to the note’s own words, in Kannada, Hindi and English alike', () => {
    const held = voiceNoteHeld(
      MIXED,
      {
        day: { said: 'today', date: null, quote: 'aaj third floor ka slab shuttering complete ho gaya' },
        items: [
          { kind: 'work', text: 'Third floor slab shuttering is complete.', quote: 'aaj third floor ka slab shuttering complete ho gaya' },
          { kind: 'manpower', text: '12 masons on site.', quote: 'ಸೈಟ್‌ನಲ್ಲಿ 12 masons ಇದ್ದರು', trade: 'masons', count: 12 },
          { kind: 'manpower', text: '20 helpers on site.', quote: 'ಸೈಟ್‌ನಲ್ಲಿ 12 masons ಇದ್ದರು', trade: 'helpers', count: 20 },
          { kind: 'issue', text: 'Steel delivery has not come; two tonnes pending.', quote: 'Steel delivery abhi tak nahi aaya, do ton pending hai' },
          { kind: 'issue', text: 'A crack in the east column.', quote: 'east column mein crack hai' },
        ],
      },
      '2026-10-06',
    );
    assert.deepEqual(held.lines.map((l) => [l.kind, l.text, l.count ?? null]), [
      ['work', 'Third floor slab shuttering is complete.', null],
      ['manpower', '12 masons on site.', 12],
      ['work', '20 helpers on site.', null],
      ['issue', 'Steel delivery has not come; two tonnes pending.', null],
    ]);
    assert.equal(held.day?.date, '2026-10-06');
    // A date is kept only where the quoted words state it.
    const dated = voiceNoteHeld(ENGLISH, { day: { said: 'date', date: '2026-10-01', quote: 'It rained in the afternoon' }, items: [] }, '2026-10-06');
    assert.equal(dated.day, undefined);
  });

  it('says in one line how long the note runs and what became of it', () => {
    assert.deepEqual([noteLength(48), noteLength(125), noteLength(undefined)], ['48 seconds', '2 minutes 5 seconds', '']);
    assert.equal(voiceNoteSaid({ seconds: 48, outcome: 'proposed', date: '2026-10-05' }), 'A voice note, 48 seconds: a site entry is proposed for 5 Oct 2026.');
    assert.equal(voiceNoteSaid({ seconds: 48, outcome: 'no_transcriber' }), 'A voice note, 48 seconds: kept, not put into words: no transcriber is set up here.');
  });
});

describe('the transcriber', () => {
  it('is the gateway’s own speech-to-text address with the same key, named by one setting, and nothing where there is no gateway', async () => {
    const { transcribeAudio, transcriptionCapability } = await import('../packages/agents/src/transcribe');
    const sent: Array<{ url: string; auth: string | undefined; body: { model: string; input_audio: { data: string; format: string } } }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      sent.push({ url, auth: (init.headers as Record<string, string>).authorization, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ text: ' the words ', usage: { seconds: 9.2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const off = gateway(false);
    try {
      assert.equal(transcriptionCapability().available, false);
      assert.deepEqual(await transcribeAudio({ bytes: Buffer.from('sound'), format: 'ogg', fetcher }), { ok: false, why: 'no_transcriber', said: 'no transcriber is set up here' });
      assert.equal(sent.length, 0, 'the sound is sent nowhere');

      process.env.REALYTICA_BASE_URL = 'https://openrouter.ai/api';
      process.env.REALYTICA_API_KEY = 'the-key';
      assert.deepEqual(transcriptionCapability(), { available: true, model: 'openai/whisper-1', host: 'openrouter.ai' }, 'the gateway’s documented example, where the gateway is that one');
      process.env.REALYTICA_MODEL_TRANSCRIPTION = 'openai/gpt-4o-transcribe';
      const heard = await transcribeAudio({ bytes: Buffer.from('sound'), format: 'ogg', fetcher });
      assert.deepEqual(heard, { ok: true, text: 'the words', seconds: 9.2, model: 'openai/gpt-4o-transcribe' });
      assert.deepEqual(sent, [{ url: 'https://openrouter.ai/api/v1/audio/transcriptions', auth: 'Bearer the-key', body: { model: 'openai/gpt-4o-transcribe', input_audio: { data: Buffer.from('sound').toString('base64'), format: 'ogg' } } }]);
      assert.equal(JSON.stringify(sent[0]!.body).includes('language'), false, 'no language is named: mixed speech is taken as it is spoken');

      process.env.REALYTICA_BASE_URL = 'https://gateway.example.test';
      delete process.env.REALYTICA_MODEL_TRANSCRIPTION;
      assert.equal(transcriptionCapability().available, false, 'another gateway has no default: its model has to be named');
    } finally {
      off();
    }
  });
});

describe('a voice note dropped in the chat', () => {
  it('is put into words, kept with its words beside it, and proposed as a site entry that is not on the log until accepted', async () => {
    const off = gateway(true);
    try {
      words = ENGLISH;
      asked.length = 0;
      const p = await seeded();
      const sound = Buffer.from('invented bytes standing for a voice note');
      const lines = await drop(p.id, [['PTT-20261006-WA0007.opus', sound, 'audio/ogg']], [{ day: '2026-10-06', seconds: 48 }]);
      const result = lines.find((l) => l.type === 'result')!;
      const project = result.project as DdProject;
      assert.deepEqual(asked, [{ url: '/v1/audio/transcriptions', key: 'Bearer test-key', model: 'stand-in/transcriber', format: 'ogg', bytes: sound.length }], 'sent to the transcriber, once');
      assert.equal(result.assistantTurn.text, 'A voice note, 48 seconds: a site entry is proposed for 5 Oct 2026.');
      const told = (await (await fetch(`${base}/api/projects/${p.id}/chat/voice`)).json()) as { available: boolean; reads?: boolean };
      assert.deepEqual([told.available, told.reads], [true, true], 'the chat is told a reading model is then given the words, to say so beside the microphone');
      const card = project.chatProposals.find((c) => c.kind === 'log_site_entry')!;
      assert.deepEqual([card.status, card.title, result.assistantTurn.proposalIds.includes(card.id)], ['proposed', 'Site entry for 5 Oct 2026, from a voice note', true]);
      assert.equal(project.siteLog?.length ?? 0, 0, 'nothing is on the site log');
      assert.equal(project.evidence.filter((e) => e.attachments.length).length, 0, 'and the note is filed as no paper');
      assert.equal(project.chatProposals.filter((c) => c.kind === 'file_evidence').length, 0);
      const { storageAdapter } = await import('../apps/api/src/storage');
      const key = String(card.payload.storageKey);
      assert.equal(Buffer.from((await storageAdapter.getDocument(p.id, `${key}.words.txt`))!).toString('utf8'), ENGLISH, 'its words are kept as a file beside it');
      const audit = project.audit.filter((a) => a.action === 'voice_note');
      assert.deepEqual(audit.map((a) => [a.entityType, a.entityId, a.newValue]), [['voice_note', key, 'Put into words; a site entry proposed']], 'the record says a note came and what became of it, and none of what it said');
      const taken = lines.find((l) => l.type === 'reading' && l.event === 'taken')!;
      assert.deepEqual([taken.as, taken.said], ['voice', 'A voice note, 48 seconds: a site entry is proposed for 5 Oct 2026']);

      // A person accepts: the entry is on the site log, with its note beside it, once.
      const { store } = await import('../apps/api/src/store');
      const held = store.data.projects!.find((x) => x.id === p.id)!;
      acceptWaiting(held, card.id, 'tester');
      acceptWaiting(held, card.id, 'tester');
      assert.equal(held.siteLog?.length, 1);
      const entry = held.siteLog![0]!;
      assert.deepEqual([entry.date, entry.weather, entry.manpower, entry.issues.map((i) => i.title)], ['2026-10-05', 'It rained in the afternoon', [{ trade: 'masons', count: 12 }, { trade: 'helpers', count: 8 }], ['The steel delivery is delayed, two tonnes not received from the supplier']]);
      assert.deepEqual([entry.voiceNote?.storageKey, entry.voiceNote?.seconds, entry.voiceNote?.wordsKey], [key, 48, `${key}.words.txt`]);
    } finally {
      off();
    }
  });

  it('is kept and says so plainly where no transcriber is set up, and is sent nowhere', async () => {
    const off = gateway(false);
    try {
      asked.length = 0;
      const p = await seeded();
      const lines = await drop(p.id, [['voice-note-20261006-1810.webm', Buffer.from('invented bytes'), 'audio/webm']], [{ day: '2026-10-06', seconds: 31 }]);
      const result = lines.find((l) => l.type === 'result')!;
      const project = result.project as DdProject;
      assert.equal(result.assistantTurn.text, 'A voice note, 31 seconds: kept, not put into words: no transcriber is set up here.');
      assert.equal(asked.length, 0);
      assert.equal(project.chatProposals.filter((c) => c.kind === 'log_site_entry').length, 0);
      assert.deepEqual(project.chatProposals.filter((c) => c.kind === 'file_evidence' && c.status === 'proposed').map((c) => c.title), ['voice-note-20261006-1810.webm'], 'it stays noted as a file, to be put into words when there is a transcriber');
      const voice = (await (await fetch(`${base}/api/projects/${p.id}/chat/voice`)).json()) as { available: boolean; host?: string };
      assert.deepEqual([voice.available, voice.host], [false, undefined], 'and the chat is told there is none, to say so beside the microphone');
    } finally {
      off();
    }
  });
});

describe('a drop that something goes wrong in', () => {
  it('has its reply without waiting for the photo reader, whose suggestion is written when it comes', async () => {
    const off = gateway(true);
    readerWaitsMs = 1500;
    readerAnsweredAt = 0;
    try {
      const p = await seeded();
      const lines = await drop(p.id, [['site-north-face.png', blankPng(), 'image/png']], [{ day: '2026-10-06', view: 0.2 }]);
      const repliedAt = Date.now();
      assert.match(lines.find((l) => l.type === 'result')!.assistantTurn.text, /^A site photograph, filed under 6 Oct 2026/);
      const { afterReplyWorkDone } = await import('../apps/api/src/runs/background');
      await afterReplyWorkDone();
      assert.ok(readerAnsweredAt > repliedAt, 'the reply was written while the reader was still being waited for');
      const { store } = await import('../apps/api/src/store');
      const row = store.data.projects!.find((x) => x.id === p.id)!.evidence.find((e) => e.attachments.some((a) => a.fileName === 'site-north-face.png'))!;
      assert.ok(row.attachments[0]!.observation, 'and what the reader said, here that it read nothing, is on the photograph afterwards');
      // The reader has a limit of its own: one that does not answer is given up, and the photograph says why it was not read.
      const { PHOTO_READ_LIMIT_MS, runPhotoIntelligence } = await import('../packages/agents/src/agents/photo-intelligence');
      assert.equal(PHOTO_READ_LIMIT_MS, 60_000);
      const gaveUp = await runPhotoIntelligence({ projectId: p.id, evidenceId: row.id, attachmentId: row.attachments[0]!.id, fileName: 'site-north-face.png', mimeType: 'image/png', fileBytes: blankPng(), identity: projectToIdentity(p), timeoutMs: 200 });
      assert.deepEqual([gaveUp.run.status, /did not answer within/.test(gaveUp.run.error ?? '')], ['failed', true], 'given up at its limit, before the reader answered');
    } finally {
      readerWaitsMs = 0;
      off();
    }
  });

  it('still lands the rest, and ends its reply saying what happened, when one file fails as it lands', async () => {
    const off = gateway(false);
    const { store } = await import('../apps/api/src/store');
    const save = store.save.bind(store);
    const p = await seeded();
    /** Which saves fail: the first one that would write a photograph of this project, then every one, then none. */
    let failing: 'first photograph' | 'all' | 'none' = 'first photograph';
    store.save = async () => {
      const photographs = store.data.projects!.find((x) => x.id === p.id)!.evidence.filter((e) => e.kind === 'photograph').length;
      if (failing === 'all' || (failing === 'first photograph' && photographs === 1)) {
        if (failing === 'first photograph') failing = 'none';
        throw new Error('the disk said no');
      }
      return save();
    };
    try {
      const lines = await drop(p.id, [['a.png', blankPng(), 'image/png'], ['b.png', blankPng(48), 'image/png']], [{ day: '2026-10-06', view: 0.2 }, { day: '2026-10-06', view: 0.2 }]);
      const result = lines.find((l) => l.type === 'result');
      assert.ok(result, 'the reply ends');
      const text = String(result!.assistantTurn.text);
      assert.equal((text.match(/something went wrong as it was put on the file/g) ?? []).length, 1, 'the file that failed is named');
      assert.equal((text.match(/A site photograph, filed under 6 Oct 2026/g) ?? []).length, 1, 'and the one behind it landed all the same');

      // Nothing can be saved at all: the reply still ends, and says so.
      failing = 'all';
      const none = await drop(p.id, [['c.png', blankPng(), 'image/png']], [{ day: '2026-10-06', view: 0.2 }]);
      assert.deepEqual(none.filter((l) => l.type === 'error' || l.type === 'result').map((l) => [l.type, l.error]), [['error', 'These files could not be taken in just now. Drop them again.']]);
    } finally {
      store.save = save;
      off();
    }
  });
});

describe('a photograph of the site', () => {
  it('reads the moment the camera wrote in the file, in the browser as on the server', async () => {
    const { readExifCapture } = await import('../apps/api/src/exif');
    const bytes = jpegTakenAt('2026:10:03 16:42:10');
    assert.equal(readExifCapture(bytes).takenAt?.slice(0, 19), '2026-10-03T16:42:10');
    assert.equal(exifTakenAt(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), '2026-10-03T16:42:10');
    assert.equal(exifTakenAt(blankPng().buffer as ArrayBuffer), undefined, 'a picture with no such date has none');
    assert.equal(localDay(new Date(2026, 9, 6, 23, 50).getTime()), '2026-10-06', 'a day is the day on the person’s own clock');
  });

  it('is made small enough for all sent together to go in one message, and a batch that still will not is refused in words', () => {
    const MB = 1024 * 1024;
    const deployed = { maxFileBytes: 4 * MB, maxRequestBytes: 4 * MB };
    assert.equal(pictureShare(deployed, 1, 0), 1.5 * MB, 'one photograph: no larger than it is worth sending at');
    assert.ok(PAPER_LONG_SIDE === 2000 && DRAWN_AT.every(([side]) => side >= PAPER_LONG_SIDE), 'and none is drawn under what a reader needs of a photographed page, however many go together');
    assert.equal(Math.round(pictureShare(deployed, 3, 0) / 1024), Math.round((3.6 * MB) / 3 / 1024), 'three share the room three ways');
    assert.ok(pictureShare(deployed, 6, 1 * MB) * 6 + 1 * MB <= 4 * MB, 'beside a voice note, six still fit');
    assert.equal(pictureShare(deployed, 0, 0), 0);
    assert.doesNotThrow(() => mustFitOneMessage([{ size: 1.2 * MB }, { size: 1.2 * MB }, { size: 1.2 * MB }], deployed, 3.5 * MB));
    assert.throws(() => mustFitOneMessage([{ size: 2 * MB }, { size: 2.2 * MB }], deployed, 3.5 * MB), (e: Error) => e instanceof TooLargeToSend && e.message === 'These files are 4.2 MB together, and one message takes 4.0 MB here. Send them in smaller groups.');
    assert.doesNotThrow(() => mustFitOneMessage([{ size: 3.6 * MB }, { size: 3.9 * MB }], deployed, 3.5 * MB), 'a file past the large-file mark goes by its own road and is not counted');
  });

  it('is filed to Progress with its date, and the row says where the date is from', async () => {
    const { fileSitePhoto } = await import('../apps/api/src/documents/site-drop');
    const p = createProject({ name: 'Navilugudda land', type: 'residential', location: 'Suvarnagiri', city: 'Kadamba' }, 'RYT-0051');
    const bytes = jpegTakenAt('2026:10:03 16:42:10');
    const file = { fileName: 'IMG_2041.jpg', mimeType: 'image/jpeg', sizeBytes: bytes.length, storageKey: 'k-photo-1' };
    const dated = fileSitePhoto({ project: p, file, bytes, actor: 'tester', captured: { day: '2026-10-06' } });
    assert.deepEqual([dated.row.kind, dated.row.workstream, dated.row.title, dated.row.description], ['photograph', 'construction.progress', 'Site photograph, 3 Oct 2026', 'Taken 3 Oct 2026: the date the camera wrote in the file.']);
    assert.deepEqual([dated.row.attachments[0]!.capture?.purpose, dated.row.attachments[0]!.capture?.takenAtSource], ['progress', 'exif']);
    assert.equal(dated.said, 'A site photograph, taken 3 Oct 2026: filed to Progress');

    const bare = fileSitePhoto({ project: p, file: { ...file, fileName: 'forwarded.png', mimeType: 'image/png', storageKey: 'k-photo-2' }, bytes: blankPng(), actor: 'tester', captured: { day: '2026-10-06' } });
    assert.deepEqual([bare.row.title, bare.row.description, bare.row.attachments[0]!.capture?.takenAt], ['Site photograph, 6 Oct 2026', 'Filed 6 Oct 2026, the day it was dropped: the file carries no date of its own.', undefined]);

    // Made smaller in the browser, the copy carries no date: the one the browser read off the original is used.
    const shrunk = fileSitePhoto({ project: p, file: { ...file, storageKey: 'k-photo-3' }, bytes: blankPng(), actor: 'tester', captured: { day: '2026-10-06', takenAt: '2026-10-02T09:15:00' } });
    assert.equal(shrunk.row.title, 'Site photograph, 2 Oct 2026');
  });

  it('dropped in the chat is filed as a photograph under Progress and not read as a paper, and one it cannot tell is asked about once', async () => {
    const off = gateway(false);
    try {
      const p = await seeded();
      // Nobody measured it and no words were read off it: asked about, not taken for a view. A page too dark for OCR looks the same.
      const unmeasured = (await drop(p.id, [['IMG_0001.png', blankPng(), 'image/png']], [{ day: '2026-10-06' }])).find((l) => l.type === 'result')!;
      assert.equal(unmeasured.assistantTurn.text, 'I could not tell whether IMG_0001.png is a photograph of the site or a paper to file. Which is it?');
      assert.equal((unmeasured.project as DdProject).evidence.filter((e) => e.attachments.length).length, 0);

      const lines = await drop(p.id, [['site-east-face.png', blankPng(), 'image/png']], [{ day: '2026-10-06', view: 0.2, shrunkTo: 2400 }]);
      const result = lines.find((l) => l.type === 'result')!;
      const project = result.project as DdProject;
      const row = project.evidence.find((e) => e.attachments.some((a) => a.fileName === 'site-east-face.png'))!;
      assert.deepEqual([row.kind, row.workstream, row.title, (row.facts ?? []).length], ['photograph', 'construction.progress', 'Site photograph, 6 Oct 2026', 0]);
      assert.equal(
        result.assistantTurn.text,
        'A site photograph, filed under 6 Oct 2026, the day it was dropped: its file carries no date.\n\nOne picture was made smaller before it was sent, to 2,400 pixels on the long side. The smaller copy is what is kept here.',
        'and the person is told when the copy kept is a smaller one',
      );
      assert.deepEqual(lines.filter((l) => l.type === 'reading' && l.event === 'taken').map((l) => l.as), ['photo']);
      assert.deepEqual(
        project.chatProposals.filter((c) => c.kind === 'file_evidence').map((c) => c.payload.fileName),
        ['IMG_0001.png'],
        'no card files it a second time: the only file card is the note that holds the picture still asked about',
      );

      const { whatWasDropped, droppedAnswer, droppedChoices, unsureSaid } = await import('../apps/api/src/documents/questionnaire-drop');
      const some = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
      const asked = await whatWasDropped({ project: p, paper: { fileName: 'IMG_7.jpg', mimeType: 'image/jpeg', sizeBytes: 1, storageKey: 'k', excerpt: some }, file: { originalname: 'IMG_7.jpg', buffer: Buffer.alloc(1) }, fresh: true, whole: true });
      assert.deepEqual([asked.as, asked.as === 'unsure' && asked.between], ['unsure', 'photo']);
      assert.equal(unsureSaid('IMG_7.jpg', 'photo'), 'I could not tell whether IMG_7.jpg is a photograph of the site or a paper to file. Which is it?');
      assert.deepEqual(droppedChoices('IMG_7.jpg', 0, 'photo').map((c) => droppedAnswer(c.send)), [{ fileName: 'IMG_7.jpg', as: 'photo' }, { fileName: 'IMG_7.jpg', as: 'paper' }]);
      assert.equal((await whatWasDropped({ project: p, paper: { fileName: 'IMG_7.jpg', mimeType: 'image/jpeg', sizeBytes: 1, storageKey: 'k', excerpt: some }, file: { originalname: 'IMG_7.jpg', buffer: Buffer.alloc(1) }, fresh: false, whole: true })).as, 'paper', 'a filed picture read again stays what it was filed as');
    } finally {
      off();
    }
  });
});
