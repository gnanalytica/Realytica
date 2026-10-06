/**
 * A voice note and a photograph from site, taken in through the chat.
 *
 * Site staff do not fill forms. They send a voice note at the end of the day
 * and a few photographs. A voice note put into words becomes a PROPOSED site
 * entry on a card: the day, the work done, the issues, each line beside the
 * words of the note it came from. Nothing is on the site log until a person
 * accepts the card. A photograph of the site is the person's own file and is
 * filed to Progress at once, with its date and where the date came from.
 *
 * Nothing is guessed. The day is the day the note says, else the day it was
 * recorded, and the card says which. A count is kept only where the note's
 * own words carry the number. A line whose words are not in the note is not
 * a line of the note, whoever wrote it.
 */

import { datesIn } from './document-parse';
import { normalizeDigits } from '../script';
import type { ChatProposal } from './types';

/* ==================================================================== */
/* What kind of file it is                                               */
/* ==================================================================== */

/** The audio files a voice note arrives as: recorded here, or forwarded from a phone. */
const AUDIO_NAME = /\.(?:ogg|oga|opus|m4a|mp3|wav|webm|aac|flac|amr|3gp)$/i;

/** Whether a dropped file is a voice note: sound, by what it says it is or by its name. A `.webm` that says it is video is not. */
export function isVoiceNote(file: { fileName: string; mimeType?: string }): boolean {
  const type = (file.mimeType ?? '').toLowerCase();
  if (type.startsWith('audio/')) return true;
  if (type.startsWith('video/') || type.startsWith('image/')) return false;
  return AUDIO_NAME.test(file.fileName);
}

/**
 * The format a transcriber is told the sound is in, from the file's own type
 * and name. WhatsApp's `.opus` and `.oga` are Ogg; a phone's `.m4a` says
 * `audio/mp4`. Undefined for a format no transcriber here is documented to
 * take (`.amr`, `.3gp`).
 */
export function audioFormat(file: { fileName: string; mimeType?: string }): 'wav' | 'mp3' | 'flac' | 'm4a' | 'ogg' | 'webm' | 'aac' | undefined {
  const type = (file.mimeType ?? '').toLowerCase();
  const name = file.fileName.toLowerCase();
  if (/ogg|opus/.test(type) || /\.(?:ogg|oga|opus)$/.test(name)) return 'ogg';
  if (/mp4|m4a/.test(type) || name.endsWith('.m4a')) return 'm4a';
  if (/mpeg|mp3/.test(type) || name.endsWith('.mp3')) return 'mp3';
  if (/wav/.test(type) || name.endsWith('.wav')) return 'wav';
  if (/webm/.test(type) || name.endsWith('.webm')) return 'webm';
  if (/flac/.test(type) || name.endsWith('.flac')) return 'flac';
  if (/aac/.test(type) || name.endsWith('.aac')) return 'aac';
  return undefined;
}

/** A picture this much one flat tone is not plainly a view of anything: a sheet of paper is mostly its paper. */
export const FLAT_TONE_OF_A_PAGE = 0.6;

/**
 * Whether an image is a picture of the site or a paper that was photographed.
 *
 * A paper the reader recognises is a paper, and so is a picture with words by
 * the dozen on it. A picture with few words or none is a photograph of the
 * site only where it plainly is a view: `view` is how much of it is one flat
 * tone, measured by the page that sent it, and a view is not mostly one tone.
 * Without that it is not decided here, and the person is asked once. A page
 * photographed in poor light gives OCR no words at all, and taken for a view
 * it would never reach a reader that could read it.
 */
export function pictureOrPaper(input: { recognised: boolean; words: string; view?: number }): 'photo' | 'paper' | 'unsure' {
  if (input.recognised) return 'paper';
  const words = (input.words.match(/[\p{L}\p{M}]{3,}/gu) ?? []).length;
  if (words >= 40) return 'paper';
  if (words > 8) return 'unsure';
  return input.view !== undefined && input.view < FLAT_TONE_OF_A_PAGE ? 'photo' : 'unsure';
}

/* ==================================================================== */
/* A voice note's words, read as a site entry                            */
/* ==================================================================== */

/** One thing a voice note says, and the words of the note it is from. */
export interface NoteLine {
  kind: 'work' | 'issue' | 'manpower' | 'weather';
  /** The line as it goes on the entry. */
  text: string;
  /** The note's own words, as the transcriber wrote them. */
  quote: string;
  /** On a manpower line: the trade and how many, where the quoted words carry the number. */
  trade?: string;
  count?: number;
}

export interface VoiceNoteReading {
  /** The day the note says, with the words that say it. Absent when it names none. */
  day?: { date: string; quote: string };
  lines: NoteLine[];
  /** False where the note's words could not be told apart into work and issues, and are kept whole. */
  sorted: boolean;
  /** A model read the words as well as the rules. */
  byModel?: boolean;
}

/** What a model says a note holds, before any of it is held to the note's words. */
export interface VoiceNoteSaidByModel {
  day?: { said: 'today' | 'yesterday' | 'date' | null; date?: string | null; quote?: string | null } | null;
  items: Array<{ kind: string; text: string; quote: string; trade?: string | null; count?: number | null }>;
}

const ISSUE = /\b(?:issue|problem|delay(?:ed|s)?|leak(?:age|ing|s)?|crack(?:s|ed)?|shortage|short of|not (?:received|delivered|available|working|come|arrived)|stopped|stuck|damage[ds]?|broken?|accident|injur(?:y|ed)|honeycomb(?:ing)?|seepage|defect(?:s|ive)?|rework|held up|waiting for|complain(?:t|ed)?|breakdown|unsafe)\b/i;
const WEATHER = /\b(?:rain(?:ed|ing|y|s)?|drizzl\w*|sunny|clear sky|cloudy|storm\w*|heavy wind|very hot)\b/i;
const TRADE = String.raw`masons?|carpenters?|helpers?|labou?rers?|bar\s?benders?|fitters?|electricians?|plumbers?|painters?|welders?|tile layers?|workers?|men`;
const MANPOWER = new RegExp(String.raw`\b(\d{1,3})\s+(${TRADE})\b`, 'gi');

/** A sentence that only greets or signs off: it says nothing for the entry. */
const GREETING = /^(?:good\s+(?:morning|afternoon|evening|night)|hello|hi|namaste|namaskara?|thank\s*you|thanks|over)(?:[\s,]+(?:sir|madam|ma'?am|boss|all|everyone))?[\s.!,]*$/i;

const isoDay = (day: Date): string => day.toISOString().slice(0, 10);

function dayBefore(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return isoDay(day);
}

/** The sentences of a note, as spoken: cut at a full stop, a question mark, a danda or a new line. */
function sentences(words: string): string[] {
  return words
    .split(/(?<=[.!?।])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** Letters and digits only, in one case and one set of digits: what a quote and the note have in common. */
function plain(text: string): string {
  return normalizeDigits(text.normalize('NFKC')).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

/** Whether some words are the note's own: found in it, as a run, whatever the spacing and the marks between them. */
export function noteSays(words: string, quote: string): boolean {
  const q = plain(quote);
  return q.length > 0 && ` ${plain(words)} `.includes(` ${q} `);
}

/**
 * A note's words read by rule.
 *
 * English, and nothing clever: a sentence that names a problem is an issue,
 * one about the rain is the weather, "12 masons" is manpower, and the rest is
 * the work done. "Today" and "yesterday" are counted from the day the note
 * was recorded, and a date written out whole is read as written.
 *
 * Words in another script are not sorted by these rules. They are kept whole
 * as the work done, in the note's own words, and the reading says so.
 */
export function readVoiceNote(words: string, recordedOn: string): VoiceNoteReading {
  const said = sentences(words);
  if (!said.length) return { lines: [], sorted: true };
  const letters = (words.match(/\p{L}/gu) ?? []).length;
  const latin = (words.match(/\p{Script=Latin}/gu) ?? []).length;
  if (letters && latin / letters < 0.6) {
    const whole = words.replace(/\s+/g, ' ').trim();
    return { lines: [{ kind: 'work', text: whole, quote: whole }], sorted: false };
  }
  let day: VoiceNoteReading['day'];
  const lines: NoteLine[] = [];
  for (const sentence of said) {
    if (GREETING.test(sentence)) continue;
    if (!day) {
      const written = datesIn(normalizeDigits(sentence))[0];
      if (written) day = { date: written, quote: sentence };
      else if (/\byesterday\b/i.test(sentence)) day = { date: dayBefore(recordedOn), quote: sentence };
      else if (/\btoday\b/i.test(sentence)) day = { date: recordedOn, quote: sentence };
    }
    const crews = [...sentence.matchAll(MANPOWER)];
    for (const crew of crews) lines.push({ kind: 'manpower', text: `${crew[1]} ${crew[2]!.toLowerCase()}`, quote: sentence, trade: crew[2]!.toLowerCase(), count: Number(crew[1]) });
    if (ISSUE.test(sentence)) lines.push({ kind: 'issue', text: sentence.replace(/[.!]+$/, '').slice(0, 160), quote: sentence });
    else if (WEATHER.test(sentence) && sentence.length < 120) lines.push({ kind: 'weather', text: sentence.replace(/[.!]+$/, ''), quote: sentence });
    // A sentence that only counts the crew is not also the work done.
    else if (!(crews.length && sentence.replace(MANPOWER, '').replace(/\b(?:and|with|we had|there were|on site|today|working)\b/gi, '').replace(/[^\p{L}]/gu, '').length < 4)) lines.push({ kind: 'work', text: sentence, quote: sentence });
  }
  return { ...(day ? { day } : {}), lines, sorted: true };
}

/**
 * What a model said a note holds, held to the note.
 *
 * Each line needs its words in the note (`noteSays`), or it is no line of the
 * note. A count is kept only where the quoted words carry that number; where
 * they do not, the line stays as work done, in its words, with no number
 * taken from it. A day written out is kept only where the quoted words state
 * that date; "today" and "yesterday" are counted from the day of recording.
 */
export function voiceNoteHeld(words: string, said: VoiceNoteSaidByModel, recordedOn: string): VoiceNoteReading {
  const lines: NoteLine[] = [];
  for (const item of said.items ?? []) {
    const text = String(item.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const quote = String(item.quote ?? '').replace(/\s+/g, ' ').trim();
    if (!text || !quote || !noteSays(words, quote)) continue;
    const kind = item.kind === 'issue' || item.kind === 'weather' || item.kind === 'manpower' ? item.kind : 'work';
    if (kind === 'manpower') {
      const count = Number(item.count);
      const trade = String(item.trade ?? '').trim().toLowerCase();
      const numbers: string[] = normalizeDigits(quote).match(/\d+/g) ?? [];
      const stated = Number.isInteger(count) && count > 0 && numbers.includes(String(count));
      lines.push(stated && trade ? { kind, text, quote, trade, count } : { kind: 'work', text, quote });
      continue;
    }
    lines.push({ kind, text, quote });
  }
  let day: VoiceNoteReading['day'];
  const named = said.day;
  const quote = String(named?.quote ?? '').replace(/\s+/g, ' ').trim();
  if (named && quote && noteSays(words, quote)) {
    if (named.said === 'today') day = { date: recordedOn, quote };
    else if (named.said === 'yesterday') day = { date: dayBefore(recordedOn), quote };
    else if (named.said === 'date' && typeof named.date === 'string' && datesIn(normalizeDigits(quote)).includes(named.date)) day = { date: named.date, quote };
  }
  return { ...(day ? { day } : {}), lines, sorted: true, byModel: true };
}

/* ==================================================================== */
/* The card                                                              */
/* ==================================================================== */

/** The file a voice note is kept as, and the file its words are kept as beside it. */
export interface VoiceNoteFile {
  storageKey: string;
  fileName: string;
  mimeType: string;
  /** How long it runs, where that is known. */
  seconds?: number;
  /** Its words, kept as a file of their own. */
  wordsKey?: string;
}

/** What a proposed site entry carries on its card. */
export interface SiteEntryProposal {
  clientId: string;
  date: string;
  /** Where the day is from: the note's own words, or the day it was recorded. */
  dateFrom: 'said' | 'recorded';
  dateQuote?: string;
  lines: NoteLine[];
  sorted: boolean;
  note: VoiceNoteFile;
}

const showDay = (date: string): string => new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** How long a note runs, in words: "48 seconds", "2 minutes 5 seconds". Empty when it is not known. */
export function noteLength(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const whole = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  return minutes ? `${part(minutes, 'minute')}${rest ? ` ${part(rest, 'second')}` : ''}` : part(whole, 'second');
}

/** What is proposed from a note that was put into words. Undefined when the note says nothing to enter. */
export function siteEntryProposed(reading: VoiceNoteReading, note: VoiceNoteFile, recordedOn: string): SiteEntryProposal | undefined {
  if (!reading.lines.length) return undefined;
  return {
    clientId: `voice:${note.storageKey}`,
    date: reading.day?.date ?? recordedOn,
    dateFrom: reading.day ? 'said' : 'recorded',
    ...(reading.day ? { dateQuote: reading.day.quote } : {}),
    lines: reading.lines,
    sorted: reading.sorted,
    note,
  };
}

/** The card's title and body for a proposed site entry: the day and where it is from, then each line with the note's words. */
export function siteEntryCardSaid(entry: SiteEntryProposal): Pick<ChatProposal, 'title' | 'rationale' | 'impact'> {
  const day = showDay(entry.date);
  const from = entry.dateFrom === 'said' ? `the day the note says (“${entry.dateQuote}”)` : 'the day the note was recorded: it names no day';
  const label: Record<NoteLine['kind'], string> = { work: 'Work done', issue: 'Issue', manpower: 'On site', weather: 'Weather' };
  const lines = entry.lines.map((line) => (line.text === line.quote ? `${label[line.kind]}: “${line.quote}”` : `${label[line.kind]}: ${line.text} (“${line.quote}”)`));
  return {
    title: `Site entry for ${day}, from a voice note`,
    rationale: [`${day} is ${from}.`, ...(entry.sorted ? [] : ['Its words are kept whole as the work done: they were not sorted into work and issues.']), ...lines].join(' '),
    impact: 'Adds the entry to the site log, with the voice note beside it. Nothing is on the record until you accept.',
  };
}

/** The entry a card files when a person accepts it, as the site log takes one. */
export function siteEntryInput(entry: SiteEntryProposal): {
  clientId: string;
  date: string;
  workDone: string;
  weather?: string;
  manpower: Array<{ trade: string; count: number }>;
  issues: Array<{ title: string; note?: string }>;
  voiceNote: VoiceNoteFile;
} {
  const of = (kind: NoteLine['kind']) => entry.lines.filter((line) => line.kind === kind);
  const weather = of('weather')[0]?.text;
  return {
    clientId: entry.clientId,
    date: entry.date,
    workDone: of('work').map((line) => line.text).join('\n'),
    ...(weather ? { weather } : {}),
    manpower: of('manpower').flatMap((line) => (line.trade && line.count ? [{ trade: line.trade, count: line.count }] : [])),
    issues: of('issue').map((line) => ({ title: line.text.slice(0, 160), note: `From the voice note: “${line.quote}”` })),
    voiceNote: entry.note,
  };
}

/** The one line the thread keeps for a voice note: how long it runs, and what became of it. */
export function voiceNoteSaid(input: { seconds?: number; outcome: 'proposed' | 'nothing' | 'no_transcriber' | 'failed' | 'too_long'; date?: string; why?: string }): string {
  const length = noteLength(input.seconds);
  const head = `A voice note${length ? `, ${length}` : ''}`;
  if (input.outcome === 'proposed') return `${head}: a site entry is proposed${input.date ? ` for ${showDay(input.date)}` : ''}.`;
  if (input.outcome === 'nothing') return `${head}: put into words, and nothing in it to enter on the site log.`;
  if (input.outcome === 'no_transcriber') return `${head}: kept, not put into words: no transcriber is set up here.`;
  if (input.outcome === 'too_long') return `${head}: kept, not put into words: it is too long to send in one piece. Record it in shorter notes.`;
  return `${head}: kept, not put into words: ${input.why ?? 'the transcriber did not answer'}.`;
}

/** What is said of a photograph filed to Progress: its day, and where the day is from. */
export function sitePhotoSaid(input: { takenOn?: string; droppedOn: string }): { title: string; description: string; line: string } {
  if (input.takenOn) {
    const day = showDay(input.takenOn);
    return { title: `Site photograph, ${day}`, description: `Taken ${day}: the date the camera wrote in the file.`, line: `A site photograph, taken ${day}: filed to Progress` };
  }
  const day = showDay(input.droppedOn);
  return {
    title: `Site photograph, ${day}`,
    description: `Filed ${day}, the day it was dropped: the file carries no date of its own.`,
    line: `A site photograph, filed under ${day}, the day it was dropped: its file carries no date`,
  };
}
