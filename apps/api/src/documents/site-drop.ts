/**
 * A voice note and a photograph from site, as they come in through the chat.
 *
 * A voice note is kept as a file, put into words by the transcriber, and what
 * it says is proposed as a site entry on a card (`site-notes.ts` in the shared
 * package). Its words are kept as a file beside it. The sound goes to the
 * transcriber and nowhere else; what is kept on the record and told to the
 * project's memory is that a note came, how long it ran, and what became of
 * it, never what it said.
 *
 * A photograph of the site is filed to Progress at once, with its date: the
 * date the camera wrote in the file, else the day it was dropped, and the row
 * says which. What it shows is read by the project's own photo reader and
 * kept as that reader's suggestion, with anything it would raise as a draft.
 */
import { agentCapability, readVoiceNoteByModel, runPhotoIntelligence, transcribeAudio } from '@realytica/agents';
import {
  addEvidence,
  attachEvidenceFile,
  audioFormat,
  createChatProposal,
  projectToIdentity,
  readVoiceNote,
  recordAuditEvent,
  recordPhotoObservation,
  siteEntryCardSaid,
  siteEntryProposed,
  sitePhotoSaid,
  voiceNoteHeld,
  voiceNoteSaid,
  type ChatProposal,
  type DdProject,
  type EvidenceRecord,
  type VoiceNoteFile,
} from '@realytica/shared';
import { readExifCapture } from '../exif';
import { storageAdapter } from '../storage';

/** What came with a dropped file from the page that sent it: what the browser knew and the bytes may no longer say. */
export interface DropCaptured {
  /** The day on the file, as the person's own clock has it: YYYY-MM-DD. */
  day?: string;
  /** For a photograph the browser made smaller: the moment the camera wrote in the original. */
  takenAt?: string;
  /** For sound: how long it runs. */
  seconds?: number;
  /** For a picture: how much of it is one flat tone, 0 to 1, as the browser measured it. A page is mostly its paper; a site is not. */
  view?: number;
  /** For a picture the browser made smaller before sending: its long side now, in pixels. */
  shrunkTo?: number;
}

/** What the page sent with its files, in the order of the files. Anything that is not what it should be is left out. */
export function capturedFrom(raw: unknown, count: number): DropCaptured[] {
  let list: unknown;
  try {
    list = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    list = undefined;
  }
  return Array.from({ length: count }, (_, i): DropCaptured => {
    const one = (Array.isArray(list) ? list[i] : undefined) as Record<string, unknown> | undefined;
    if (!one || typeof one !== 'object') return {};
    const day = typeof one.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(one.day) ? one.day : undefined;
    const takenAt = typeof one.takenAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(one.takenAt) ? one.takenAt.slice(0, 19) : undefined;
    const seconds = typeof one.seconds === 'number' && Number.isFinite(one.seconds) && one.seconds > 0 && one.seconds < 86_400 ? one.seconds : undefined;
    const view = typeof one.view === 'number' && one.view >= 0 && one.view <= 1 ? one.view : undefined;
    const shrunkTo = typeof one.shrunkTo === 'number' && Number.isInteger(one.shrunkTo) && one.shrunkTo > 0 && one.shrunkTo < 100_000 ? one.shrunkTo : undefined;
    return { ...(day ? { day } : {}), ...(takenAt ? { takenAt } : {}), ...(seconds ? { seconds } : {}), ...(view !== undefined ? { view } : {}), ...(shrunkTo ? { shrunkTo } : {}) };
  });
}

const today = (): string => new Date().toISOString().slice(0, 10);

export interface VoiceNoteTaken {
  /** The one line the thread keeps. */
  said: string;
  /** The proposed site entry, where the note had something to enter. Not yet on the project. */
  card?: ChatProposal;
  /** Put into words or not: a note that was not is left noted as a file not read, to be tried again. */
  transcribed: boolean;
}

/**
 * A voice note put into words and read as a site entry.
 *
 * The words are kept as a file beside the note. They are read by rule, and by
 * a model where one is set up, which is given the words and never the sound;
 * every line of the model's is held to the words (`voiceNoteHeld`).
 */
export async function takeVoiceNote(input: {
  project: DdProject;
  file: { fileName: string; mimeType: string; sizeBytes: number; storageKey: string };
  bytes: Buffer;
  actor: string;
  captured?: DropCaptured;
}): Promise<VoiceNoteTaken> {
  const { project, file } = input;
  // A note read once is not sent again: its entry is on a card or on the site log already.
  const known =
    (project.chatProposals ?? []).some((card) => card.kind === 'log_site_entry' && card.payload.storageKey === file.storageKey)
    || (project.siteLog ?? []).some((entry) => entry.clientId === `voice:${file.storageKey}`);
  if (known) return { said: 'A voice note already put into words: its site entry is waiting or on the site log.', transcribed: true };
  const recordedOn = input.captured?.day ?? today();
  const heard = await transcribeAudio({ bytes: input.bytes, format: audioFormat(file) });
  const seconds = (heard.ok ? heard.seconds : undefined) ?? input.captured?.seconds;
  const kept = (outcome: string) =>
    recordAuditEvent(project, { actor: input.actor, action: 'voice_note', entityType: 'voice_note', entityId: file.storageKey, newValue: outcome });
  if (!heard.ok) {
    const said = voiceNoteSaid({ seconds, outcome: heard.why === 'no_transcriber' ? 'no_transcriber' : heard.why === 'too_long' ? 'too_long' : 'failed', why: heard.said });
    kept('Kept, not put into words');
    return { said, transcribed: false };
  }
  const wordsKey = `${file.storageKey}.words.txt`;
  await storageAdapter.putDocument(project.id, wordsKey, Buffer.from(heard.text, 'utf8'), 'text/plain; charset=utf-8');
  const byRule = readVoiceNote(heard.text, recordedOn);
  const byModel = agentCapability().available ? await readVoiceNoteByModel({ words: heard.text, caseId: project.id }) : null;
  const held = byModel ? voiceNoteHeld(heard.text, byModel, recordedOn) : undefined;
  // The model's lines where it gave any that the words bear out: they are in plain English whatever the note was spoken in.
  const reading = held?.lines.length ? { ...held, ...(held.day ?? byRule.day ? { day: held.day ?? byRule.day } : {}) } : byRule;
  const note: VoiceNoteFile = { storageKey: file.storageKey, fileName: file.fileName, mimeType: file.mimeType, ...(seconds ? { seconds } : {}), wordsKey };
  const entry = siteEntryProposed(reading, note, recordedOn);
  if (!entry) {
    kept('Put into words; nothing to enter');
    return { said: voiceNoteSaid({ seconds, outcome: 'nothing' }), transcribed: true };
  }
  const { title, rationale, impact } = siteEntryCardSaid(entry);
  kept('Put into words; a site entry proposed');
  return {
    said: voiceNoteSaid({ seconds, outcome: 'proposed', date: entry.date }),
    // The note's file is named at the top as well, where the route that serves a card's file looks for it: the card can play the note.
    card: createChatProposal('log_site_entry', title, rationale, impact, { ...entry, storageKey: file.storageKey, fileName: file.fileName, mimeType: file.mimeType } as unknown as Record<string, unknown>, input.actor),
    transcribed: true,
  };
}

/**
 * A photograph of the site put on the register under Progress, with its date
 * and where the date is from. The camera's date is read from the bytes; for a
 * photograph the browser made smaller before sending, from what the browser
 * read off the original.
 */
export function fileSitePhoto(input: {
  project: DdProject;
  file: { fileName: string; mimeType: string; sizeBytes: number; storageKey: string };
  bytes: Buffer;
  actor: string;
  captured?: DropCaptured;
}): { row: EvidenceRecord; said: string } {
  const exif = readExifCapture(input.bytes);
  const takenAt = exif.takenAt ?? input.captured?.takenAt;
  const said = sitePhotoSaid({ takenOn: takenAt?.slice(0, 10), droppedOn: input.captured?.day ?? today() });
  const row = addEvidence(input.project, { title: said.title, kind: 'photograph', status: 'received', source: 'chat_upload', description: said.description }, input.actor);
  attachEvidenceFile(
    input.project,
    row.id,
    {
      ...input.file,
      capture: {
        purpose: 'progress',
        ...(takenAt ? { takenAt, takenAtSource: 'exif' as const } : {}),
        ...(exif.lat !== undefined && exif.lng !== undefined ? { lat: exif.lat, lng: exif.lng, latLngSource: 'exif' as const } : {}),
      },
    },
    input.actor,
  );
  row.workstream = 'construction.progress';
  return { row, said: said.line };
}

/**
 * What a filed photograph shows, read by the project's photo reader. Returns
 * a function that writes the reading onto the photograph as the reader's
 * suggestion: the reading takes seconds and can run beside others, and the
 * writing is done one photograph at a time. Null where there is no reader.
 */
export async function readSitePhoto(input: { project: DdProject; row: EvidenceRecord; bytes: Buffer; actor: string }): Promise<(() => number) | null> {
  if (!agentCapability().available) return null;
  const attachment = input.row.attachments[input.row.attachments.length - 1]!;
  const outcome = await runPhotoIntelligence({
    projectId: input.project.id,
    evidenceId: input.row.id,
    attachmentId: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileBytes: input.bytes,
    identity: projectToIdentity(input.project),
    purposeLabel: 'Progress',
    takenAt: attachment.capture?.takenAt,
  });
  return () => recordPhotoObservation(input.project, input.row.id, attachment.id, outcome.observation, input.actor).drafts.length;
}
