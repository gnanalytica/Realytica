/**
 * Meeting notes on the server: where their words are kept, how they are
 * read, and what a turn of the chat does with them.
 *
 * The shared rules (`meetings.ts` in the shared package) say what notes are
 * and what a meeting on the record holds. They cannot reach storage or a
 * model, so this file does both for them and hands them what it found.
 *
 * The words of notes are never on the project's record or in its thread.
 * Pasted notes are written to the project's storage as a text file, beside
 * its other files, and the turn keeps one line in their place. A dropped
 * file is already there, with the text read off it kept beside it
 * (`documents/page-text.ts`). Either way the meeting on the record holds
 * where the words are, and they are read back from there when somebody
 * opens them.
 */

import { randomUUID } from 'node:crypto';
import { agentCapability, readMeetingNotesByModel } from '@realytica/agents';
import {
  aboutWords,
  asksToReadMeetingNotes,
  meetingAlreadyKeptSaid,
  meetingAnswerSaid,
  meetingAskedNow,
  meetingDigest,
  meetingItemsHeld,
  meetingItemsTogether,
  meetingKeptLast,
  meetingNotesFor,
  meetingNotesPasted,
  meetingTwin,
  readMeetingNotes,
  type ChatIngestFile,
  type DdProject,
  type MeetingFile,
  type MeetingGiven,
  type MeetingReading,
  type MeetingRecord,
} from '@realytica/shared';
import { forgetPageTexts, loadPageTexts } from './documents/page-text';
import { storageAdapter } from './storage';
import { documentKey } from './storage/types';

/** The longest message the chat takes as a message. Longer is taken only as the notes of a meeting, which are kept as a file and not in the thread. */
export const CHAT_MESSAGE_AT_MOST = 4_000;

/** Keep pasted words as a text file in the project's storage, and say where. */
export async function keepPastedNotes(projectId: string, text: string, now = new Date()): Promise<MeetingFile> {
  const bytes = Buffer.from(text, 'utf8');
  const storageKey = documentKey({ id: randomUUID(), fileName: 'notes.txt' });
  await storageAdapter.putDocument(projectId, storageKey, bytes, 'text/plain; charset=utf-8');
  return { storageKey, fileName: `Meeting notes pasted ${now.toISOString().slice(0, 10)}.txt`, mimeType: 'text/plain', sizeBytes: bytes.length };
}

/**
 * The words of a meeting's notes, read back from storage: the text kept
 * beside a dropped file when it was read, or the file itself when it is
 * text. Nothing when neither can be read.
 */
export async function meetingWords(projectId: string, file: MeetingFile): Promise<string | undefined> {
  const pages = await loadPageTexts(projectId, file.storageKey);
  if (pages?.pages.length) return pages.pages.map((page) => page.text).join('\n\n');
  if (!/^text\//.test(file.mimeType) && !/\.(?:txt|md)$/i.test(file.fileName)) return undefined;
  try {
    const bytes = await storageAdapter.getDocument(projectId, file.storageKey);
    return bytes ? bytes.toString('utf8') : undefined;
  } catch {
    return undefined;
  }
}

/** Let go of a file that turned out to be nobody's: not a meeting's notes and not a paper. Never throws. */
async function forgetFile(projectId: string, file: MeetingFile): Promise<void> {
  await storageAdapter.deleteDocument(projectId, file.storageKey).catch(() => undefined);
  await forgetPageTexts(projectId, file.storageKey).catch(() => undefined);
}

/**
 * What some notes say: read by rule, and by a model where one is set up,
 * whose reading is held to the notes' own words before any of it is kept.
 */
export async function readNotes(projectId: string, words: string): Promise<MeetingReading> {
  const byRule = readMeetingNotes(words);
  if (!agentCapability().available) return byRule;
  const said = await readMeetingNotesByModel({ notes: words, caseId: projectId });
  if (!said) return byRule;
  return { ...byRule, items: meetingItemsTogether(byRule.items, meetingItemsHeld(words, said, byRule.heldOn)), byModel: true };
}

/**
 * The readings of the dropped files that are notes of a meeting, by each
 * file's storage key, for the turn that takes the files in. A file that is a
 * paper, or that the chat will ask about, is left alone.
 */
export async function readDroppedNotes(project: DdProject, files: readonly ChatIngestFile[]): Promise<Record<string, MeetingReading>> {
  const out: Record<string, MeetingReading> = {};
  for (const file of files) {
    if (meetingNotesFor(project, file) === 'yes') out[file.storageKey] = await readNotes(project.id, file.excerpt ?? '');
  }
  return out;
}

/** What a question means for meeting notes, told from its words alone. */
export type MeetingAsk =
  /** An answer to the chat's own question about some words it holds. */
  | { kind: 'answer'; said: 'notes' | 'paper' | 'neither'; asked: MeetingRecord }
  /** The notes of the meeting kept last are to be read through. */
  | { kind: 'read' }
  /** The question is itself notes of a meeting, pasted, or words that may be. */
  | { kind: 'pasted'; seen: 'yes' | 'maybe' };

/** What a question means for meeting notes, or nothing when it means nothing. Reads nothing and keeps nothing. */
export function meetingAsk(project: DdProject, question: string): MeetingAsk | undefined {
  const asked = meetingAskedNow(project);
  const said = asked ? meetingAnswerSaid(question) : undefined;
  if (asked && said) return { kind: 'answer', said, asked };
  if (asksToReadMeetingNotes(question)) return { kind: 'read' };
  const seen = meetingNotesPasted(question);
  return seen === 'no' ? undefined : { kind: 'pasted', seen };
}

/**
 * A dropped file the chat held and asked about, as the bytes it was given,
 * for when a person says it is a document: it then goes down the path every
 * dropped document takes. Nothing when the file can no longer be read.
 */
export async function heldFile(projectId: string, file: MeetingFile): Promise<{ originalname: string; mimetype: string; size: number; buffer: Buffer; storageKey: string } | undefined> {
  const buffer = await storageAdapter.getDocument(projectId, file.storageKey).catch(() => null);
  return buffer ? { originalname: file.fileName, mimetype: file.mimeType, size: buffer.length, buffer, storageKey: file.storageKey } : undefined;
}

/**
 * Do what a question means for meeting notes, and say what the chat's rules
 * are to be handed: `given`, and `question`, the line the thread keeps of
 * what was asked. For pasted notes that line stands in place of the paste,
 * whose words are written to storage here.
 *
 * Never throws: words that could not be kept or read back are said so in
 * one line, and nothing is kept.
 */
export async function meetingTurn(project: DdProject, question: string, ask: MeetingAsk): Promise<{ question: string; given: MeetingGiven }> {
  const pasted = `${ask.kind === 'pasted' && ask.seen === 'yes' ? 'Notes of a meeting pasted' : 'Text pasted'}, ${aboutWords(question)}`;
  try {
    if (ask.kind === 'answer') {
      const { asked } = ask;
      if (ask.said !== 'notes') {
        await forgetFile(project.id, asked.file);
        return { question, given: { not: asked.id } };
      }
      const words = await meetingWords(project.id, asked.file);
      if (!words?.trim()) return { question, given: { say: 'The words of those notes could not be read back, so nothing was kept. Give them again.' } };
      return { question, given: { keep: { file: asked.file, came: asked.came, reading: await readNotes(project.id, words), digest: meetingDigest(words), ...(asked.place ? { place: asked.place } : {}) }, askedId: asked.id } };
    }
    if (ask.kind === 'read') {
      const meeting = meetingKeptLast(project);
      if (!meeting) return { question, given: { say: 'No meeting is kept on this file yet.' } };
      const words = await meetingWords(project.id, meeting.file);
      if (!words?.trim()) return { question, given: { say: 'The words of those notes could not be read back from where they are kept.' } };
      const reading = await readNotes(project.id, words);
      return { question, given: { more: { meetingId: meeting.id, items: reading.items, ...(reading.byModel ? { byModel: true } : {}) } } };
    }
    // The same words given twice are one meeting: nothing is written for the second.
    const digest = meetingDigest(question);
    const twin = meetingTwin(project, digest);
    if (twin) return { question: pasted, given: { say: meetingAlreadyKeptSaid(twin) } };
    const file = await keepPastedNotes(project.id, question);
    if (ask.seen === 'maybe') return { question: pasted, given: { ask: { file, came: 'pasted' } } };
    return { question: pasted, given: { keep: { file, came: 'pasted', reading: await readNotes(project.id, question), digest } } };
  } catch (err) {
    console.warn(`[meetings] the notes could not be kept: ${err instanceof Error ? err.name : 'error'}`);
    return { question: ask.kind === 'pasted' ? pasted : question, given: { say: 'The notes could not be kept just now, so nothing was kept. Give them again.' } };
  }
}
