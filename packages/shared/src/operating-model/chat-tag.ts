/**
 * The chat message being answered, while the rules answer it.
 *
 * Whatever a chat message raises waits as a suggestion where it would land: a
 * value on its field, a card in its register. Each carries the message it
 * came from (`ChatTag`), so a chat can list its own suggestions and its reply
 * can say where they went. The rules answer a message in one synchronous
 * call, so the message is held here for that call and read by whatever
 * offers a value or raises a card below it. Nothing is held between calls,
 * and nothing that waits for a promise reads it: a model's tools are handed
 * the message outright.
 */

import { fieldOptions, validateFieldValue, type FieldWriteContext } from './check-fields';
import { indiaToday } from './quarters';
import { dayTyped } from './said';
import type { ChatSaid, ChatTag, CheckFieldDef, CheckFieldValue } from './types';

/** The message in hand: whose it is, its words, and where it is kept. */
export interface ChatInHand {
  tag: ChatTag;
  /** Who said it, as the turns are signed. */
  by: string;
  /** What they said, whole. */
  message: string;
  at: string;
}

let held: ChatInHand | undefined;

/** Run `answer` with this message in hand. A message already in hand stays: the outer one is the one being answered. */
export function withChatInHand<T>(message: ChatInHand | undefined, answer: () => T): T {
  if (!message || held) return answer();
  held = message;
  try {
    return answer();
  } finally {
    held = undefined;
  }
}

/** The message being answered, if one is. */
export function chatInHand(): ChatInHand | undefined {
  return held;
}

/**
 * Run `make` with no message in hand. What the next-step rules raise on
 * their own while a reply is made (the next asset to add, the DD to start,
 * the paper to chase) is the rules' suggestion and not something the
 * person's message produced: it carries no message, so a chat's strip and
 * its Accept all leave it, and it waits where cards wait.
 */
export function apartFromChat<T>(make: () => T): T {
  const was = held;
  held = undefined;
  try {
    return make();
  } finally {
    held = was;
  }
}

/** The most that is kept of a person's words, as of a paper's. */
export const SAID_QUOTE_MOST = 220;

const plain = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The fewest words and letters a part of a message may be, where the part is
 * not the whole message. One word cut out of a sentence ("yes" out of "yes,
 * but not freehold") does not show what the person said.
 */
const PART_WORDS_FEWEST = 2;
const PART_CHARS_FEWEST = 5;

/**
 * How a sentence opens when it asks: a question word before a verb ("what
 * is", "how much", "what's"), or a verb before its subject ("is it", "was
 * the plan", "do we"). "Was approved on 3 Oct" is a statement with its
 * subject left out, and is not taken for a question.
 */
const ASKS_OPENING = /^(?:(?:what|where|why|how|who|whom|which|whose|when)(?:'s|’s|\s+(?:is|are|was|were|do|does|did|can|could|would|should|will|has|have|had|about|much|many|long|far|one|of)\b)|(?:is|are|was|were|am|do|does|did|can|could|would|should|will|shall|has|have|had)\s+(?:it|this|that|these|those|there|the|a|an|we|you|they|he|she|i|its|our|their|my|your|any)\b)/i;

/** A message's sentences, each by where it starts and ends in the message as `plain` keeps it. A point between digits ("4.5") ends nothing. */
function sentencesOf(whole: string): Array<{ from: number; to: number; text: string }> {
  const out: Array<{ from: number; to: number; text: string }> = [];
  let from = 0;
  for (let at = 0; at < whole.length; at += 1) {
    if (!'.!?'.includes(whole[at]!) || (at + 1 < whole.length && whole[at + 1] !== ' ')) continue;
    out.push({ from, to: at + 1, text: whole.slice(from, at + 1).trim() });
    from = at + 1;
  }
  if (from < whole.length && whole.slice(from).trim()) out.push({ from, to: whole.length, text: whole.slice(from).trim() });
  return out;
}

/** Whether a sentence asks something: it ends on a question mark, or opens as a question does. */
export function sentenceAsks(sentence: string): boolean {
  const text = sentence.trim();
  return /\?\s*$/.test(text) || ASKS_OPENING.test(text);
}

/**
 * Why a part of the person's message cannot stand as the source of a value,
 * or undefined where it can. It has to be in what they said, as they said
 * it; it cannot be a word or two cut out of a longer message; and it cannot
 * be taken from a question they asked ("is it freehold or leasehold?"),
 * which states nothing. With no part, the whole message is the part.
 */
export function saidRefused(message: ChatInHand | undefined, part?: string): string | undefined {
  if (!message) return 'nothing was said in a chat here to quote.';
  const whole = plain(message.message);
  const words = part === undefined ? whole : plain(part);
  const at = words ? whole.toLowerCase().indexOf(words.toLowerCase()) : -1;
  if (!words || at < 0) return 'those words are not in what the person said. Quote their message exactly.';
  if (words.length < whole.length && (words.split(' ').length < PART_WORDS_FEWEST || words.length < PART_CHARS_FEWEST)) return `“${words}” is too little of what the person said to show it. Quote the words that state the value, as they said them.`;
  const asked = sentencesOf(whole).some((sentence) => sentence.from < at + words.length && sentence.to > at && sentenceAsks(sentence.text));
  if (asked || /\?/.test(words)) return 'those words are from a question the person asked, which states nothing. Only what they said as a fact is a value.';
  return undefined;
}

/**
 * The person's words as a value's source: what they said, or the part of it
 * that is given, cut to a bound. Undefined where the part given is not in
 * what they said: a model may quote the person, and may not put words in
 * their mouth. A value's source is held to more (`strict`): see
 * `saidRefused`.
 */
export function saidInChat(message: ChatInHand | undefined, part?: string, opts: { strict?: boolean } = {}): ChatSaid | undefined {
  if (!message) return undefined;
  const whole = plain(message.message);
  const words = part === undefined ? whole : plain(part);
  if (!words || !whole.toLowerCase().includes(words.toLowerCase())) return undefined;
  if (opts.strict && saidRefused(message, part)) return undefined;
  return {
    kind: 'chat',
    by: message.by,
    quote: words.slice(0, SAID_QUOTE_MOST),
    turnId: message.tag.turnId,
    ...(message.tag.sessionId ? { sessionId: message.tag.sessionId } : {}),
    at: message.at,
  };
}

/* ==================================================================== */
/* The value, read off the words                                         */
/* ==================================================================== */

/** Words that say no, or that something is not so. */
const SAYS_NO = /\b(?:no|not|nope|never|none|nil|false|without|absent|pending|nor)\b|n['’]t\b/i;

const sameNumber = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 1e-6);

/** Whether `text` names `name` as a whole word or words, whatever the case. An option's key is read with its underscores as spaces. */
function names(text: string, name: string): boolean {
  const wanted = plain(name.replace(/_/g, ' ')).toLowerCase();
  if (!wanted) return false;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(text.toLowerCase());
}

/**
 * Why the person's words do not give the value offered for this field, or
 * undefined where they do. The value is read back off the words with the
 * field's own reader: a choice has to be named, a figure has to be there
 * with its unit and come to the value, a yes is a sentence with no no in it
 * and a no is one with one, a day has to be a day the words say. Words that
 * give some other value, or none, are no source for this one.
 */
export function saidValueRefused(
  def: CheckFieldDef,
  value: CheckFieldValue['value'],
  quote: string,
  ctx: FieldWriteContext & { now?: Date } = {},
): string | undefined {
  const words = plain(quote);
  const not = `“${words}” does not say ${def.label}`;
  const read = (typed: string) => validateFieldValue(def, typed, { ...ctx, proposer: 'parser' });
  switch (def.kind) {
    case 'enum':
    case 'multi_enum': {
      const options = fieldOptions(def, ctx.optionSet);
      const offered = (Array.isArray(value) ? value : [value]).map(String);
      const named = offered.every((key) => {
        const option = options.find((held) => held.key === key);
        return Boolean(option && (names(words, option.label) || names(words, option.key)));
      });
      return named ? undefined : `${not} is ${offered.join(', ')}: name the choice as they said it.`;
    }
    case 'boolean':
      return typeof value === 'boolean' && value === SAYS_NO.test(words) ? `${not} is ${value ? 'yes' : 'no'}.` : undefined;
    case 'number':
    case 'money':
    case 'area':
    case 'percent':
    case 'duration': {
      if (typeof value !== 'number') return `${not}.`;
      const tokens = words.split(' ');
      for (let from = 0; from < tokens.length; from += 1) {
        if (!/^(?:₹|rs\.?|inr)?-?\.?\d/i.test(tokens[from]!) && !/^(?:₹|rs\.?|inr)$/i.test(tokens[from]!)) continue;
        // The figure and up to four words after it, longest first: "1 acre 20 guntas", "45 lakh", "2,450 sqft". The longest
        // that reads is what the words say there: "50000 sqft" is not also 50000 of the field's own unit.
        for (let to = Math.min(tokens.length, from + 5); to > from; to -= 1) {
          let typed = tokens.slice(from, to).join(' ').replace(/[,.;:)]+$/, '');
          if (def.kind === 'percent') typed = typed.replace(/\s*(?:%|percent|per\s+cent)$/i, '');
          const got = read(typed);
          if ('error' in got || typeof got.value !== 'number') continue;
          if (sameNumber(got.value, value)) return undefined;
          break;
        }
      }
      return `${not} is ${value}: give the figure with its unit as they said it.`;
    }
    case 'date': {
      if (typeof value !== 'string') return `${not}.`;
      const tokens = words.replace(/[,.;:]+(?=\s|$)/g, '').split(' ');
      for (let from = 0; from < tokens.length; from += 1) {
        if (/^today$/i.test(tokens[from]!) && value === indiaToday(ctx.now ?? new Date())) return undefined;
        for (let to = Math.min(tokens.length, from + 3); to > from; to -= 1) if (dayTyped(tokens.slice(from, to).join(' ')) === value) return undefined;
      }
      return `${not} is ${value}: give the day as they said it.`;
    }
    case 'text':
      return typeof value === 'string' && plain(words).toLowerCase().includes(plain(value).toLowerCase()) ? undefined : `${not} is “${String(value)}”: the words have to hold the value.`;
    default:
      return `${def.label} is filled on its sheet. It is not read off a chat message.`;
  }
}
