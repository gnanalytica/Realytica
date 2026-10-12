/**
 * Asking by voice and hearing the answer: the parts with no browser in them.
 *
 * Both halves belong to the browser. Speech becomes text through its speech
 * recognition, which Chrome, Edge and Safari have (under a `webkit` name) and
 * Firefox does not, and which in Chrome sends the sound to a service of the
 * browser's maker. An answer is read by its speech synthesis, with whatever
 * voices the device holds. Nothing here reaches this product's server, and
 * nothing here speaks or listens: these are the choices made around that.
 */

import type { MemTagWords } from '@realytica/shared';
import { parseAnswer, type Block, type Inline, type TagPlaces } from './answer-blocks';

/* ------------------------------------------------------------------ */
/* Whether the browser can                                              */
/* ------------------------------------------------------------------ */

/** One thing heard, as the browser reports it. */
export interface HeardResult {
  transcript: string;
  final: boolean;
}

/** The part of the browser's recogniser this chat uses. */
export interface Recogniser {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** The browser's recogniser, under either of its names, or nothing where it has none. */
export function recogniserOf(scope: unknown): (new () => Recogniser) | undefined {
  const held = scope as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown } | undefined;
  const found = held?.SpeechRecognition ?? held?.webkitSpeechRecognition;
  return typeof found === 'function' ? (found as new () => Recogniser) : undefined;
}

/** Whether the browser can read text aloud: it needs both the speaker and the thing it is handed. */
export function canReadAloud(scope: unknown): boolean {
  const held = scope as { speechSynthesis?: { speak?: unknown; cancel?: unknown }; SpeechSynthesisUtterance?: unknown } | undefined;
  return typeof held?.speechSynthesis?.speak === 'function' && typeof held.speechSynthesis.cancel === 'function' && typeof held.SpeechSynthesisUtterance === 'function';
}

/** Said once, the first time the microphone is used to ask. */
export const SPEECH_NOTICE = 'Speech is turned into text by your browser, which may send the sound to its maker.';

/* ------------------------------------------------------------------ */
/* The language spoken                                                  */
/* ------------------------------------------------------------------ */

export interface SpeechLanguage {
  tag: string;
  label: string;
}

/** The languages always offered, English as it is spoken in India first. */
export const SPEECH_LANGUAGES: readonly SpeechLanguage[] = [
  { tag: 'en-IN', label: 'English (India)' },
  { tag: 'hi-IN', label: 'Hindi' },
  { tag: 'kn-IN', label: 'Kannada' },
  { tag: 'ta-IN', label: 'Tamil' },
  { tag: 'te-IN', label: 'Telugu' },
];

const TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;
const primary = (tag: string): string => tag.toLowerCase().replace(/_/g, '-').split('-')[0]!;
const same = (a: string, b: string): boolean => a.toLowerCase().replace(/_/g, '-') === b.toLowerCase().replace(/_/g, '-');

/** A language's name in English, as the browser knows it; its tag where it does not. */
function nameOf(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/**
 * The languages offered: the five, then the browser's own.
 *
 * A browser lists no languages its recogniser takes, so its own list is the
 * one the person set it to read in. One of those that only repeats a language
 * already offered ("hi" beside Hindi) is left out; "en-GB" beside English
 * (India) is a different way of speaking and stays.
 */
export function speechLanguages(browser: readonly string[] = []): SpeechLanguage[] {
  const out: SpeechLanguage[] = [...SPEECH_LANGUAGES];
  for (const raw of browser.slice(0, 12)) {
    const tag = String(raw ?? '').trim();
    if (!TAG.test(tag)) continue;
    if (out.some((have) => same(have.tag, tag))) continue;
    if (!tag.includes('-') && out.some((have) => primary(have.tag) === primary(tag))) continue;
    out.push({ tag, label: nameOf(tag) });
  }
  return out;
}

/** Where one person's choice is kept on this device. Someone not yet known shares one. */
export function speechLanguageKey(person: string | undefined): string {
  return `speech.language.${person?.trim() || 'anyone'}`;
}

/** The language to listen in: what this person chose here before, while it is still offered; else English (India). */
export function chosenLanguage(kept: string | null | undefined, offered: readonly SpeechLanguage[]): string {
  const found = kept ? offered.find((language) => same(language.tag, kept)) : undefined;
  return found?.tag ?? SPEECH_LANGUAGES[0]!.tag;
}

/* ------------------------------------------------------------------ */
/* Words into the message box                                           */
/* ------------------------------------------------------------------ */

/** What is being dictated: the words that were in the box, the first result that is ours to write, and what was last written. */
export interface Dictation {
  base: string;
  from: number;
  wrote: string;
}

export const dictationFrom = (inBox: string): Dictation => ({ base: inBox, from: 0, wrote: inBox });

/**
 * The box after something more is heard.
 *
 * The words heard follow what was in the box. If the person has changed the
 * box since the last write, their words are kept as they are and only what is
 * still being heard is added: a correction is never typed over.
 */
export function dictationStep(held: Dictation, inBox: string, results: readonly HeardResult[]): Dictation {
  let { base, from } = held;
  if (inBox !== held.wrote) {
    base = inBox;
    const open = results.findIndex((result, i) => i >= held.from && !result.final);
    from = open === -1 ? results.length : open;
  }
  const said = results
    .slice(from)
    .map((result) => result.transcript.trim())
    .filter(Boolean)
    .join(' ');
  const wrote = !said ? base : !base || /\s$/.test(base) ? base + said : `${base} ${said}`;
  return { base, from, wrote };
}

/** What to say when the browser would not listen. Nothing, where the person simply said nothing or stopped. */
export function speechRefused(code: string, language: string): string | null {
  switch (code) {
    case 'no-speech':
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'The microphone was not allowed. Allow it for this site, or type the question.';
    case 'audio-capture':
      return 'No microphone was found. Type the question.';
    case 'language-not-supported':
      return `This browser does not take ${language} by voice. Pick another language, or type the question.`;
    case 'network':
      return 'The browser could not reach its speech service. Type the question.';
    default:
      return 'The browser could not turn that into text. Try again, or type the question.';
  }
}

/* ------------------------------------------------------------------ */
/* What is read aloud                                                   */
/* ------------------------------------------------------------------ */

/** The scripts told apart, each with the language its voice is asked for in. */
const SCRIPTS: ReadonlyArray<[from: number, to: number, tag: string]> = [
  [0x0900, 0x097f, 'hi-IN'],
  [0x0980, 0x09ff, 'bn-IN'],
  [0x0a00, 0x0a7f, 'pa-IN'],
  [0x0a80, 0x0aff, 'gu-IN'],
  [0x0b00, 0x0b7f, 'or-IN'],
  [0x0b80, 0x0bff, 'ta-IN'],
  [0x0c00, 0x0c7f, 'te-IN'],
  [0x0c80, 0x0cff, 'kn-IN'],
  [0x0d00, 0x0d7f, 'ml-IN'],
];

/**
 * The language an answer is written in, by its script.
 *
 * An answer in Kannada still carries names, figures and document numbers in
 * Latin letters, so the script need not be most of it: a fifth of the letters
 * is enough to say the sentences are in that language. Otherwise it is read
 * as English.
 */
export function languageOfText(text: string): string {
  const counts = new Map<string, number>();
  let letters = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const script = SCRIPTS.find(([from, to]) => code >= from && code <= to);
    if (script) {
      counts.set(script[2], (counts.get(script[2]) ?? 0) + 1);
      letters += 1;
    } else if (/[A-Za-z]/.test(ch)) letters += 1;
  }
  let best: [string, number] | undefined;
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry;
  return best && best[1] >= letters / 5 ? best[0] : 'en-IN';
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** "Sources" in the languages offered, said after the count as a figure, which each voice reads in its own words. */
const SOURCES_IN: Record<string, string> = { hi: 'स्रोत', kn: 'ಮೂಲಗಳು', ta: 'ஆதாரங்கள்', te: 'ఆధారాలు' };

/** How many sources an answer cites, as it is said: "Three sources." Nothing for none. */
export function sourcesSaid(count: number, language = 'en-IN'): string {
  if (count <= 0) return '';
  const word = SOURCES_IN[primary(language)];
  if (word) return `${count} ${word}.`;
  const n = NUMBER_WORDS[count] ?? String(count);
  return `${n[0]!.toUpperCase()}${n.slice(1)} ${count === 1 ? 'source' : 'sources'}.`;
}

const TAG_SAID: Record<MemTagWords, string> = {
  approved: 'approved',
  waiting: 'waiting',
  'waiting · stands': 'waiting, stands',
  thought: 'a thought',
};

export interface SpokenAnswer {
  /** The answer a line at a time, the count of sources last. */
  lines: string[];
  /** The papers and meeting notes it cites, each once. */
  sources: number;
  /** The language its voice is asked for in. */
  language: string;
}

/**
 * An answer as it is read aloud.
 *
 * The words, without the marks that are for the eye: a citation is not read
 * out, and neither is an id. The citations are counted instead and the count
 * is said at the end, so a listener knows the answer rests on something and
 * how much. Where a statement stood (approved, waiting) is said, because that
 * is part of what the sentence claims. A table is read a row at a time, each
 * cell after its column's name.
 */
export function spokenAnswer(text: string, opts: { nodeName?: (id: string) => string | undefined; places?: TagPlaces } = {}): SpokenAnswer {
  const cited = new Set<string>();
  const say = (spans: Inline[]): string =>
    tidy(
      spans
        .map((span) => {
          switch (span.kind) {
            case 'text':
            case 'bold':
            case 'code':
              return span.text;
            case 'evidence':
              cited.add(`ev:${span.id}`);
              return '';
            case 'notes':
              cited.add(`notes:${span.meetingId}`);
              return '';
            case 'node':
              return opts.nodeName?.(span.id) ?? '';
            case 'memory':
              return ` (${TAG_SAID[span.tag]}) `;
            case 'dangling':
              return '';
          }
        })
        .join(''),
    );
  const lines: string[] = [];
  const add = (line: string): void => {
    if (/[\p{L}\p{N}]/u.test(line)) lines.push(/[.!?:;।]$/.test(line) ? line : `${line}.`);
  };
  const blocks: Block[] = parseAnswer(text, (id) => opts.nodeName?.(id) !== undefined, opts.places);
  for (const block of blocks) {
    if (block.kind === 'paragraph' || block.kind === 'heading' || block.kind === 'flag') add(say(block.spans));
    else if (block.kind === 'bullets') block.items.forEach((item) => add(say(item)));
    else if (block.kind === 'numbers')
      block.items.forEach((item, i) => {
        add(say(item));
        block.details?.[i]?.forEach((detail) => add(say(detail)));
      });
    else if (block.kind === 'table') {
      const head = block.head.map(say);
      for (const row of block.rows) add(row.map((cell, i) => [head[i], say(cell)].filter(Boolean).join(': ')).filter(Boolean).join(', '));
    }
  }
  const language = languageOfText(lines.join(' '));
  const sources = sourcesSaid(cited.size, language);
  if (sources && lines.length) lines.push(sources);
  return { lines, sources: cited.size, language };
}

/** A line with its chips taken out, closed up: no brackets left around nothing, no space before a full stop. */
function tidy(line: string): string {
  return line
    .replace(/[�]/g, '')
    .replace(/\(\s*[,;]?\s*\)|\[\s*\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?।)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/[,;:]\s*\./g, '.')
    .trim();
}

/**
 * The lines cut to pieces a browser will read to the end.
 *
 * Chrome stops a long utterance part-way with some voices, so nothing longer
 * than a few sentences is handed over at once: a line is cut at its sentence
 * ends, then at its commas, then between words.
 */
export function speechChunks(lines: readonly string[], atMost = 220): string[] {
  const out: string[] = [];
  const cut = (piece: string, marks: RegExp[]): void => {
    if (piece.length <= atMost) {
      if (piece) out.push(piece);
      return;
    }
    const [mark, ...rest] = marks;
    if (!mark) {
      let held = '';
      for (const word of piece.split(' ')) {
        if (held && held.length + 1 + word.length > atMost) {
          out.push(held);
          held = word;
        } else held = held ? `${held} ${word}` : word;
      }
      if (held) out.push(held);
      return;
    }
    let held = '';
    for (const part of piece.split(mark)) {
      if (held && held.length + 1 + part.length > atMost) {
        cut(held, rest);
        held = part;
      } else held = held ? `${held} ${part}` : part;
    }
    cut(held, rest);
  };
  for (const line of lines) cut(line.trim(), [/(?<=[.!?।])\s+/, /(?<=[,;:])\s+/]);
  return out;
}

/** A voice as the browser lists it. */
export interface VoiceHeld {
  lang: string;
  name: string;
  default?: boolean;
  localService?: boolean;
}

/**
 * The voice for a language, when the device has one.
 *
 * One for the language as spoken in that country first, then any for the
 * language. Among equals, one on the device before one that sends the text
 * away to be spoken. No voice of another language is ever picked: Tamil read
 * by an English voice is noise.
 */
export function pickVoice<V extends VoiceHeld>(voices: readonly V[], language: string): V | undefined {
  const rank = (voice: V): number => (same(voice.lang, language) ? 0 : 2) + (voice.localService ? 0 : 1);
  return voices
    .filter((voice) => primary(voice.lang) === primary(language))
    .map((voice, i) => ({ voice, i }))
    .sort((a, b) => rank(a.voice) - rank(b.voice) || a.i - b.i)[0]?.voice;
}

/** What to say when the device lists voices and none is for the answer's language. */
export function noVoiceSaid(language: string): string {
  return `This device has no ${nameOf(primary(language))} voice to read this.`;
}
