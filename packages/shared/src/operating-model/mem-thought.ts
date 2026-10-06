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
 * A reply carries its note itself, as one last line in a fixed form, so
 * keeping a note costs no second call to a model. `memNoteOfReply` takes the
 * line off the reply before anybody reads it.
 *
 * What a thought is about is a record, and the page memory keeps for that
 * record is where its notes are found (`MemPage`).
 */

import { menuPlaceOfWords } from './chat-places';
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

const NOTE_LINE = /^[ \t>*_-]*note to memory\b[ \t]*(?:\[([^\]\n]{1,200})\])?[ \t*_]*:[ \t]*(.*)$/gim;

/** A mark citing a memory line, or a tag, written inside a note: neither belongs in the sentence that is kept. */
const CITED = /\s*\[(?:m\d{1,3}(?:\s*[,;]\s*m\d{1,3})*|approved|proposed|waiting(?:\s*[·,]\s*stands)?|thought)\]/gi;

/**
 * Takes the note off a reply. Every line in the note's form is removed from
 * the text, wherever it stands, and the last of them is the note: one line,
 * its spaces closed up, cut to the length a note may be.
 */
export function memNoteOfReply(text: string): MemNoteSaid {
  let note: string | undefined;
  let about: string | undefined;
  const kept = text.replace(NOTE_LINE, (_line, id: string | undefined, said: string) => {
    const sentence = said.replace(CITED, '').replace(/\s+/g, ' ').replace(/^[*_"“]+|[*_"”]+$/g, '').trim();
    if (sentence) {
      note = sentence.slice(0, MEM_NOTE_LINE);
      about = id?.trim() || undefined;
    }
    return '';
  });
  const tidy = kept.replace(/\n{3,}/g, '\n\n').trim();
  return { text: tidy, ...(note ? { note } : {}), ...(about ? { about } : {}) };
}

/**
 * What a note is about: the record it names, when that is a record this
 * reader's copy of the project holds, else the check the sitting is on, else
 * the project itself. `project` is the record as the reader may see it, so a
 * note is never filed under a record its writer could not see.
 */
export function memThoughtAbout(project: DdProject, named: string | undefined, sitting?: { checkId?: string }): string {
  const held = projectRecordIds(project);
  if (named && named !== project.id && held.has(named)) return named;
  if (sitting?.checkId && held.has(sitting.checkId)) return sitting.checkId;
  return project.id;
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
