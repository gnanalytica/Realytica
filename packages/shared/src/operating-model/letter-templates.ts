/**
 * The firm's templates for what it sends: letters, replies, requests.
 *
 * What goes out is the one place in the product where prose is the thing
 * made, so it is kept, and held to this: a body is a template's fixed
 * sentences with slots, and every slot is filled with a numbered source,
 * which is a line of the record as the record writes it. A model is allowed
 * two things only. It chooses which template fits, and it says which
 * sources fill the slots. It writes no sentence. A person then reads the
 * draft, changes it in their own words and approves it by name before
 * anything is sent, as before.
 *
 * `letterBody` makes the body in the shape the draft's holding already
 * reads (`outgoingBodyHeld`): paragraphs of sentences, each with the numbers
 * of the sources it rests on. A template's own sentence carries no number.
 * A source's sentence is the source's words, so every figure and date in it
 * is one its source writes.
 *
 * Pure.
 */

export type LetterKind = 'letter' | 'reply' | 'request';

export interface LetterTemplate {
  id: string;
  kind: LetterKind;
  /** What it is for, as a person choosing one reads it. */
  label: string;
  /** Said before the paper or matter it refers to, where one is named: "We refer to" + the source's line. */
  refers?: string;
  /** Said before the facts from the record. */
  lead: string;
  /** Said after them: what the reader is asked to do. */
  close: string;
}

/** The templates every firm starts with. Fixed sentences only: no fact about any project is in one. */
export const LETTER_TEMPLATES: readonly LetterTemplate[] = [
  { id: 'reply_from_record', kind: 'reply', label: 'A reply that answers from the record', refers: 'We refer to the following.', lead: 'On this, our record shows the following.', close: 'Please let us know if anything further is needed.' },
  { id: 'reply_asking_back', kind: 'reply', label: 'A reply that asks for a paper in return', refers: 'We refer to the following.', lead: 'Our record shows the following.', close: 'To answer in full we need the paper that states otherwise, with its date and reference. Please send it to us.' },
  { id: 'request_for_information', kind: 'request', label: 'A request for information', refers: 'We are writing about the following.', lead: 'Our record shows the following.', close: 'Please send us the information or the paper that confirms this, with its date and reference.' },
  { id: 'request_for_a_paper', kind: 'request', label: 'A request for a paper that is owed', refers: 'We are writing about the following.', lead: 'The following is not yet with us.', close: 'Please send it to us, and tell us the day we may expect it.' },
  { id: 'letter_on_record', kind: 'letter', label: 'A letter that places facts on record', refers: 'We refer to the following.', lead: 'We write to place the following on record.', close: 'Please confirm receipt of this letter.' },
  { id: 'letter_following_up', kind: 'letter', label: 'A letter that follows up something open', refers: 'We refer to the following.', lead: 'The following remains open on our record.', close: 'Please let us know when it will be done.' },
];

export const LETTER_FACTS_AT_MOST = 8;

/** What a model chose: a template, the source the letter refers to, and the sources that are its facts. Numbers and an id, and nothing else. */
export interface LetterChoice {
  template: string;
  refersTo?: number;
  /** The numbers of the sources it states, in order. */
  states: number[];
}

/** The kind a draft is, from the words its frame uses for it. */
export function letterKindOf(words: string): LetterKind {
  return /repl/i.test(words) ? 'reply' : /request|information|rfi/i.test(words) ? 'request' : 'letter';
}

/** The templates a draft of a kind may use. */
export function letterTemplatesFor(kind: LetterKind): LetterTemplate[] {
  return LETTER_TEMPLATES.filter((template) => template.kind === kind);
}

/** What of a model's answer is read: a template on the list for this kind, and numbers that are sources. */
export function letterChoiceFrom(said: unknown, kind: LetterKind, sources: ReadonlyArray<{ n: number }>): LetterChoice | undefined {
  const given = (said && typeof said === 'object' ? said : {}) as Record<string, unknown>;
  const template = letterTemplatesFor(kind).find((known) => known.id === given.template);
  if (!template) return undefined;
  const known = new Set(sources.map((source) => source.n));
  const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && known.has(value) ? value : undefined);
  const refersTo = number(given.refers_to);
  const sent = given['facts'];
  const states = [...new Set((Array.isArray(sent) ? sent : []).flatMap((value) => number(value) ?? []))].filter((n) => n !== refersTo).slice(0, LETTER_FACTS_AT_MOST);
  return { template: template.id, ...(refersTo !== undefined ? { refersTo } : {}), states };
}

const sentence = (says: string): string => {
  const flat = says.replace(/\s+/g, ' ').trim();
  // A passage quoted from a paper ends inside its quote marks.
  return /[.!?][”"’']?$/.test(flat) ? flat : `${flat}.`;
};

/**
 * The body a choice makes: the template's sentences, and between them the
 * chosen sources, each as its own sentence in the record's words with its
 * number. A choice with no facts and nothing referred to makes no body: a
 * template alone says nothing about the project.
 */
export function letterBody(choice: LetterChoice, sources: ReadonlyArray<{ n: number; says: string }>): Array<{ sentences: Array<{ text: string; sources: number[] }> }> {
  const template = LETTER_TEMPLATES.find((known) => known.id === choice.template);
  const byNumber = new Map(sources.map((source) => [source.n, source]));
  const referred = choice.refersTo !== undefined ? byNumber.get(choice.refersTo) : undefined;
  const stated = choice.states.flatMap((n) => byNumber.get(n) ?? []);
  if (!template || (!referred && !stated.length)) return [];
  const paragraphs: Array<{ sentences: Array<{ text: string; sources: number[] }> }> = [];
  if (referred) paragraphs.push({ sentences: [...(template.refers ? [{ text: template.refers, sources: [] }] : []), { text: sentence(referred.says), sources: [referred.n] }] });
  if (stated.length) paragraphs.push({ sentences: [{ text: template.lead, sources: [] }, ...stated.map((source) => ({ text: sentence(source.says), sources: [source.n] }))] });
  paragraphs.push({ sentences: [{ text: template.close, sources: [] }] });
  return paragraphs;
}
