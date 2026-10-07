/**
 * The assistant's own notes: what it concluded in a reply, kept as a thought.
 *
 * Everything else in memory is told from the record and can be told again.
 * A thought cannot: it is the one thing memory holds that the record does
 * not. So it is kept through a start-over, which lets go only of what the
 * record can tell again, and it goes with the project when the project is
 * removed, or with the store if the store is lost.
 *
 * A thought is a fact tagged `thought`, and the tag is set here and nowhere
 * else. Nothing a model writes names a tag. A thought's id is under a
 * heading of its own (`::thought::`), which no fact told from the record can
 * have, so no telling of the record writes over one, and a store writes a
 * thought only through its own door (`think`). A thought never becomes
 * approved or proposed by itself: a person who agrees with a note records
 * the value on the record, and the record is what tells it as a fact.
 *
 * A reply carries its note itself, as its last line in a fixed form, so
 * keeping a note costs no second call to a model. `memNoteOfReply` takes the
 * line off the reply before anybody reads it. Only the last line can be the
 * note. A line in the note's form anywhere else is the reply's own text: it
 * may be a paper's words that the reply quotes, and a paper does not get to
 * write into memory.
 *
 * What a thought is about is a record, and the page memory keeps for that
 * record is where its notes are found (`MemPage`). A note is filed under a
 * record only when the reply had to do with that record (`memThoughtAbout`).
 */

import { menuPlaceOfWords } from './chat-places';
import { memTagsPrinted } from './mem-context';
import { memPointer, type MemPlace } from './mem-delta';
import { MEM_NOTE_LINE, scrubMemFact, type MemFact } from './mem-facts';
import { projectRecordIds } from './project-view';
import type { DdProject } from './types';

/** How many notes a project keeps. The oldest go as newer ones are written. */
export const MEM_THOUGHTS_KEPT = 300;

/** A reply with its note taken off it. */
export interface MemNoteSaid {
  /** The reply as a person reads it. */
  text: string;
  /** The sentence the reply asked to keep, when it asked. */
  note?: string;
  /** The id the note named as what it is about, as the reply wrote it. Nothing has checked it. */
  about?: string;
}

/**
 * The note's form, read off one line: the words "Note to memory", the id of
 * what it is about in square brackets if it names one, a colon, and the
 * sentence. Emphasis marks may stand round the words. A quote mark may not
 * stand before them, and neither may the four spaces or the tab that make a
 * line code.
 */
const NOTE = /^ {0,3}[*_]{0,3}note to memory\b[ \t]{0,3}(?:\[([^\]]{1,200})\])?[ \t*_]{0,6}:[ \t*_]{0,6}(.*)$/i;

/** How much of a line is read as a note's sentence before it is cut to a note's length. */
const NOTE_READ = 2_000;

/**
 * Takes the note off a reply. The note is the reply's last line and no
 * other, when that line has the note's form and does not stand inside a
 * block of code. What is kept of it is one sentence: its spaces closed up,
 * no mark or tag in it, cut to the length a note may be. A reply whose last
 * line is not a note is returned as it came.
 */
export function memNoteOfReply(text: string): MemNoteSaid {
  const body = text.trimEnd();
  const cut = body.lastIndexOf('\n');
  const above = cut === -1 ? '' : body.slice(0, cut);
  // An odd number of fences above the line leaves it inside a block of code.
  const fences = above.split('\n').filter((line) => line.trimStart().startsWith('```')).length;
  const said = fences % 2 === 0 ? NOTE.exec(body.slice(cut + 1)) : null;
  if (!said) return { text };
  const sentence = memTagsPrinted(said[2]!.slice(0, NOTE_READ), undefined)
    .text.replace(/\s+/g, ' ')
    .replace(/^[*_"“ ]+|[*_"” ]+$/g, '');
  const about = said[1]?.trim();
  return { text: above.trimEnd(), ...(sentence ? { note: sentence.slice(0, MEM_NOTE_LINE) } : {}), ...(sentence && about ? { about } : {}) };
}

/** What a reply had to do with: the check the sitting was on, and the records the reply cited. */
export interface MemTurnAbout {
  sitting?: { checkId?: string };
  cited?: readonly string[];
}

/**
 * What a note is filed under.
 *
 * A record the note names, when the reply had to do with that record: it is
 * the check the sitting is on, or one the reply cited. A note that names
 * any other record is filed under the project, because what a reply says a
 * note is about is a model's word, and a paper quoted in the reply can put
 * words in a model's mouth. A note that names nothing is filed under the
 * sitting's check, or the one record the reply cited, or the project.
 *
 * `project` is the record as the reader may see it, so a note is never filed
 * under a record its writer could not see.
 */
export function memThoughtAbout(project: DdProject, named: string | undefined, turn: MemTurnAbout = {}): string {
  const held = projectRecordIds(project);
  const sat = turn.sitting?.checkId && held.has(turn.sitting.checkId) ? turn.sitting.checkId : undefined;
  const cited = [...new Set(turn.cited ?? [])].filter((id) => id !== project.id && held.has(id));
  if (named) return named !== project.id && (named === sat || cited.includes(named)) ? named : project.id;
  return sat ?? (cited.length === 1 ? cited[0]! : project.id);
}

export interface MemThoughtSaid {
  /** The sentence to keep. */
  note: string;
  /** The id on the record of what it is about. */
  aboutId: string;
  /** The reply it came from. One note a reply: the same reply always makes the same thought. */
  turnId: string;
  /** When the reply was given. */
  at: string;
  /** The page the question was asked on. */
  place?: MemPlace;
}

/**
 * A note as memory keeps it, or nothing when it may not be kept.
 *
 * The tag is set here. The note is held to what any fact is: one line, no
 * longer than a note may be, with no address for mail, no permanent account
 * number and no long run of digits in it.
 */
export function memThought(projectId: string, said: MemThoughtSaid): MemFact | undefined {
  const turn = memPointer(projectId, said.turnId);
  if (!turn) return undefined;
  const at = menuPlaceOfWords(said.place);
  return scrubMemFact(projectId, {
    id: `${projectId}::thought::${turn}`,
    tag: 'thought',
    key: 'note',
    label: 'Note',
    value: said.note,
    aboutId: said.aboutId,
    ...(at.fn ? { fn: at.fn } : at.department ? { department: at.department } : {}),
    recordedAt: said.at,
    source: turn,
  });
}

/** One thing the assistant has left notes about: the page memory keeps for it. */
export interface MemPage {
  /** The project's id, `::page::`, then what the page is about. */
  id: string;
  aboutId: string;
  /** How many notes are on it, and when the newest was left. */
  notes: number;
  updatedAt: string;
}

/** The id of the page memory keeps for one thing. */
export function memPageId(projectId: string, aboutId: string): string {
  return `${projectId}::page::${aboutId}`;
}

/** The pages a set of notes makes, the one most lately written on first. A store with no page of its own to read answers with this. */
export function memPagesOf(projectId: string, held: readonly MemFact[]): MemPage[] {
  const pages = new Map<string, MemPage>();
  for (const fact of held) {
    if (fact.tag !== 'thought') continue;
    const id = memPageId(projectId, fact.aboutId);
    const page = pages.get(id) ?? { id, aboutId: fact.aboutId, notes: 0, updatedAt: fact.recordedAt };
    page.notes += 1;
    if (fact.recordedAt > page.updatedAt) page.updatedAt = fact.recordedAt;
    pages.set(id, page);
  }
  return [...pages.values()].sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? -1 : 1) : a.updatedAt < b.updatedAt ? 1 : -1));
}
