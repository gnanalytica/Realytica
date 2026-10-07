/**
 * What typed words can do to what waits.
 *
 * Accepting changes the record without the person touching it. It was first
 * read out of any sentence that held "approve", "ok" or "skip", and a rule was
 * added for each sentence found to go wrong. Then the forms were closed, and
 * what still went wrong all came from one place: finding a card by words
 * somebody typed. "No" after "which one?" logged a risk, because a card had
 * the word in its title, and "approve the land use" recorded a date.
 *
 * So typed words do three things and no more:
 *
 *  - the last reply's: "approve" or "accept", then "all", "all of them", "all
 *    of these", "everything", "both", "both of them", "both of these",
 *    "them", "them all" or "these";
 *  - everything open, said in full: "approve" or "accept", then "all open",
 *    "every open one", "everything open" or "everything waiting";
 *  - one card by its exact title in quotes: "approve", "accept", "skip",
 *    "reject" or "set aside", then the title.
 *
 * "Please" anywhere, a leading "ok", "okay" or "yes", and "can you" (could,
 * will) in front change nothing about the first and the third form.
 * Everything open is never asked for with a question, "would you" wonders
 * about a form without asking for it, and a sentence that closes on a symbol
 * ("approve all ❌") has said something its words did not: each of those is
 * unclear. Anything else is done by pressing a choice, which carries the ids
 * of what it means.
 *
 * A sentence that only looks as if it wanted to accept or set aside ("ok",
 * "approve the land use", "just approve all", "skip") is `unclear`: it takes
 * nothing, and where the last reply left something the choices are offered.
 * What each form takes is decided where it is carried out. This file only
 * reads the words.
 */

export type InstructionVerb = 'accept' | 'aside';

export type Instruction =
  /** Everything the last reply of this chat listed or filed. */
  | { verb: 'accept'; form: 'last' }
  /** Every card open on the project. */
  | { verb: 'accept'; form: 'open' }
  /** The card with this title, word for word. */
  | { verb: InstructionVerb; form: 'titled'; title: string }
  /** No instruction, but a sentence that looks as if it wanted to be one. Nothing is taken. */
  | { verb: InstructionVerb; form: 'unclear' };

/** A name in quotes, from the first quote mark to the last: a card's title can hold quotes of its own. */
const QUOTED = /["“](.*)["”]/;

/** A sentence as its words: lower case, apostrophes closed up, and the letters and digits of every script kept. */
export function wordsOf(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Whether two titles are the same title: the same words in the same order, whatever the case and the punctuation. */
export function sameTitle(a: string, b: string): boolean {
  const words = wordsOf(a).join(' ');
  return Boolean(words) && words === wordsOf(b).join(' ');
}

/**
 * The marks that end a question, in the scripts people type here and the
 * forms a keyboard gives them: the plain one, the full-width one, the Arabic,
 * Armenian, Ethiopic and Greek ones, the doubled and combined ones, and the
 * two a phone’s picture keyboard gives.
 */
const QUESTION_MARK = /[?？؟⸮՞፧;᥅꘏⁇⁈⁉‽﹖︖❓❔]/;

/** Whether a sentence closes on a question: a question mark anywhere in the punctuation it ends with ("approve all?!"). */
export function asksAQuestion(frame: string): boolean {
  return QUESTION_MARK.test(closingOf(frame));
}

/** What a sentence ends with, after its last letter or digit. */
function closingOf(frame: string): string {
  return /[^\p{L}\p{M}\p{N}]*$/u.exec(frame.trimEnd())?.[0] ?? '';
}

/** Whether a sentence closes on a symbol or a picture and not on ordinary punctuation: "approve all ❌", "approve all 👎". */
function closesOnASign(frame: string): boolean {
  return /[\p{S}\p{Extended_Pictographic}]/u.test(closingOf(frame).replace(new RegExp(QUESTION_MARK.source, 'gu'), ''));
}

/**
 * Words that make a sentence something other than an instruction, whatever
 * verb it holds: a no, a condition, a time other than now, or a person
 * talking about what they will do or asking whether to.
 */
const NEVER =
  /\b(?:not|never|cannot|without|before|after|later|until|if|when|whether)\b|\b\w+n't\b|\b(?:dont|cant|wont|doesnt|didnt|isnt|arent|wasnt|werent|shouldnt|wouldnt|couldnt|mustnt|havent|hasnt|hadnt)\b|\b(?:i|we) (?:will|would)\b|\b(?:i|we)'(?:ll|d)\b|\b(?:should|do|can|could|shall|may|must) (?:i|we)\b/;

/** Whether a sentence holds a no, a condition, another time, or somebody's own plans. */
function neverAnInstruction(frame: string): boolean {
  return NEVER.test(frame.toLowerCase().replace(/[’‘]/g, "'"));
}

/** What stands for "all" after the verb, where the last reply's are what is meant. */
const THE_LAST_REPLYS = new Set(['all', 'all of them', 'all of these', 'everything', 'both', 'both of them', 'both of these', 'them', 'them all', 'these']);

/** Every open card on the project is said in full, in these words only. */
const EVERYTHING_OPEN = new Set(['all open', 'every open one', 'everything open', 'everything waiting']);

/** Words that may lead into a form and change nothing about it. */
const LEADS_IN = new Set(['ok', 'okay', 'yes']);

const ASSENT = '(?:yes|ok|okay|go ahead|do it|do that|record it|thats right|that is right)';
/** Nothing but words that say yes: "ok", "yes go ahead", "go ahead and record it". They accept nothing. */
const ONLY_ASSENT = new RegExp(`^${ASSENT}(?: (?:and )?${ASSENT})*$`);

/** A refusal with nothing named. It sets nothing aside. */
const ONLY_REFUSAL = /^(?:no thanks|no thank you|set (?:it|this|that) aside)$/;

/** How many words may come before a form for the sentence still to look like one: "go ahead and approve all", "I think we can approve all". */
const WORDS_BEFORE_A_FORM = 4;

/** The verb a run of words opens with, and how many words it is. */
function verbAt(words: readonly string[], at: number): { verb: InstructionVerb; length: number } | undefined {
  if (words[at] === 'approve' || words[at] === 'accept') return { verb: 'accept', length: 1 };
  if (words[at] === 'skip' || words[at] === 'reject') return { verb: 'aside', length: 1 };
  if (words[at] === 'set' && words[at + 1] === 'aside') return { verb: 'aside', length: 2 };
  return undefined;
}

/**
 * The form a run of words is, when the whole run is one: the verb, then one
 * of the fixed objects, or nothing but a title in quotes.
 */
function formOf(words: readonly string[], title: string | undefined): Instruction | undefined {
  const opens = verbAt(words, 0);
  if (!opens) return undefined;
  const object = words.slice(opens.length).join(' ');
  if (title) return object ? undefined : { verb: opens.verb, form: 'titled', title };
  if (opens.verb !== 'accept') return undefined;
  if (THE_LAST_REPLYS.has(object)) return { verb: 'accept', form: 'last' };
  if (EVERYTHING_OPEN.has(object)) return { verb: 'accept', form: 'open' };
  return undefined;
}

/**
 * Read a sentence as one of the three typed forms, as a sentence that looks
 * as if it wanted to be one, or as neither.
 */
export function readInstruction(sentence: string): Instruction | undefined {
  const quoted = QUOTED.exec(sentence);
  const title = quoted?.[1]?.trim() || undefined;
  const frame = quoted ? sentence.replace(QUOTED, ' ') : sentence;
  const asks = asksAQuestion(frame);
  let words = wordsOf(frame).filter((word) => word !== 'please');
  const opener = words[1] === 'you' ? words[0] : undefined;
  // "Can you", "could you" and "will you" ask for the thing. "Would you" asks about it.
  const polite = opener === 'can' || opener === 'could' || opener === 'will';
  const wonders = opener === 'would';
  if (polite || wonders) words = words.slice(2);
  // A question is a question. Asked for politely, a form is still a form.
  if (asks && !polite && !wonders) return undefined;

  let at = 0;
  while (LEADS_IN.has(words[at] ?? '')) at += 1;
  const head = words.slice(at);
  const form = formOf(head, title);
  if (form) {
    // Said plainly, a form is carried out. Wondered about, closed on a symbol, or everything open put as a question, it is only offered.
    const plain = !wonders && !closesOnASign(frame) && !(asks && form.form === 'open');
    return plain ? form : { verb: form.verb, form: 'unclear' };
  }

  // Not a form. What is left is whether it looks like one, and a question, a no or a later does not.
  if (asks || neverAnInstruction(frame)) return undefined;
  const opens = verbAt(head, 0);
  if (opens) return { verb: opens.verb, form: 'unclear' };
  if (!title && ONLY_ASSENT.test(words.join(' '))) return { verb: 'accept', form: 'unclear' };
  if (!title && ONLY_REFUSAL.test(head.join(' '))) return { verb: 'aside', form: 'unclear' };
  // A form with a few words in front of it: "just approve all", "go ahead and approve all".
  for (let skip = 1; skip <= WORDS_BEFORE_A_FORM && skip < head.length; skip += 1) {
    const ending = formOf(head.slice(skip), title);
    if (ending) return { verb: ending.verb, form: 'unclear' };
  }
  return undefined;
}
