/**
 * Reading a project's memory back.
 *
 * An entry holds ids and no titles: who did it as an id that is not their
 * email, and what it is about as the ids of records. The titles are looked up
 * here, on the record as it stands when the entry is read. So a paper renamed
 * since is shown by its name now, and a record that has since been removed is
 * shown as the id it was, with no title.
 *
 * A fact is read back the same way: who approved it as the person the
 * record names, and what it is about and what states it by the titles the
 * record has now. Its value is its own.
 *
 * With them, the pages memory keeps, one for each thing the assistant has
 * left a note about, and what looks wrong in memory (`memLint`), each by
 * the title of what it is about.
 *
 * For the firm's own people. Titles are taken from the whole record, which a
 * collaborator does not see the whole of.
 */

import {
  allChecks,
  buildProjectGraph,
  chatLinkLabels,
  meetingCalled,
  meetingsHeld,
  memLint,
  memPeople,
  memPointer,
  memoryFacts,
  parcelLabels,
  revenueReads,
  type DdProject,
  type MemEntry,
  type MemEntryKind,
  type MemFact,
  type MemFactsWithheld,
  type MemLintFinding,
  type MemPlace,
} from '@realytica/shared';
import { memoryPort } from './index';
import type { MemoryPort } from './types';

/** How many entries one read answers with, at most. */
export const MEMORY_READ_AT_MOST = 200;

export interface MemoryLine {
  id: string;
  kind: MemEntryKind;
  at: string;
  /** Who did it, as the record names them. Absent when the record names nobody this id stands for. */
  by?: string;
  /** What the entry was told from: an audit event, a chat turn or a paper. */
  sourceId: string;
  /** On an entry about a value, the value's key and the name the fixed list of keys gives it. */
  key?: string;
  label?: string;
  /** The page a question was asked on. */
  place?: MemPlace;
  /** What the entry is about. `title` is absent when the record no longer holds the id. */
  about: Array<{ id: string; title?: string }>;
}

/**
 * Every id on the record an entry can point at, with the words the record
 * has for it now, keyed as memory keeps the id: a node whose id is made from
 * an email or from a name on a paper is found under the token for it.
 */
function titlesOf(project: DdProject): Map<string, string> {
  const titles = new Map<string, string>();
  const name = (id: string, title: string): void => {
    const pointer = memPointer(project.id, id);
    if (pointer) titles.set(pointer, title);
  };
  for (const node of buildProjectGraph(project).nodes) name(node.id, node.label);
  for (const { id, label } of chatLinkLabels(project)) name(id, label);
  for (const proposal of project.chatProposals ?? []) name(proposal.id, proposal.title);
  for (const [parcelRef, label] of parcelLabels(revenueReads(project))) name(parcelRef, `Sy. ${label}`);
  // What a fact can be about that the graph may not draw under its own id.
  const unnamed = (id: string, title: string): void => {
    if (!titles.has(id)) name(id, title);
  };
  unnamed(project.id, project.name);
  for (const check of allChecks(project)) unnamed(check.id, check.title);
  for (const comparable of project.comparables ?? []) unnamed(comparable.id, comparable.title);
  for (const questionnaire of project.questionnaires ?? []) for (const question of questionnaire.questions) unnamed(question.id, question.text.slice(0, 120));
  for (const meeting of meetingsHeld(project)) unnamed(meeting.id, meetingCalled(meeting));
  return titles;
}

/** A project's entries, newest first, each with what it points at resolved to its title. */
export async function readMemory(project: DdProject, limit = 50, port: MemoryPort = memoryPort): Promise<MemoryLine[]> {
  const most = Math.min(MEMORY_READ_AT_MOST, Math.max(1, Math.floor(limit) || 1));
  const entries: MemEntry[] = await port.entries(project.id, most);
  const titles = titlesOf(project);
  const people = memPeople(project);
  return entries.map((entry) => {
    const by = people.get(entry.by);
    return {
      id: entry.id,
      kind: entry.kind,
      at: entry.at,
      ...(by ? { by } : {}),
      sourceId: entry.sourceId,
      ...(entry.key ? { key: entry.key } : {}),
      ...(entry.label ? { label: entry.label } : {}),
      ...(entry.place ? { place: entry.place } : {}),
      about: entry.about.map((id) => {
        const title = titles.get(id);
        return title ? { id, title } : { id };
      }),
    };
  });
}

/** How many facts one read answers with, at most. */
export const MEMORY_FACTS_AT_MOST = 500;

/** A fact as it is read back: who approved it and what it points at as the record names them now. */
export interface MemoryFactLine extends Omit<MemFact, 'by' | 'aboutId' | 'source' | 'was'> {
  /** Who approved it, as the record names them. Absent when the record names nobody the id stands for. */
  by?: string;
  about: { id: string; title?: string };
  source: { id: string; title?: string };
  was?: Array<{ at: string; what: string; by?: string; said?: string }>;
}

export interface MemoryFacts {
  /** The facts memory holds, the newest first. */
  lines: MemoryFactLine[];
  /** How many memory holds in all, when that is more than are answered. */
  of: number;
  /** What the record holds that was not made a fact, and why: counted on the record as it stands. */
  withheld: MemFactsWithheld;
}

/** A project's facts as memory holds them, each with what it points at resolved to its title. */
export async function readFacts(project: DdProject, limit = MEMORY_FACTS_AT_MOST, port: MemoryPort = memoryPort): Promise<MemoryFacts> {
  const most = Math.min(MEMORY_FACTS_AT_MOST, Math.max(1, Math.floor(limit) || 1));
  const held = await port.factsOf(project.id);
  const titles = titlesOf(project);
  const people = memPeople(project);
  const titled = (id: string): { id: string; title?: string } => {
    const title = titles.get(id);
    return title ? { id, title } : { id };
  };
  const lines = [...held]
    .sort((a, b) => (a.recordedAt === b.recordedAt ? (a.id < b.id ? -1 : 1) : a.recordedAt < b.recordedAt ? 1 : -1))
    .slice(0, most)
    .map(({ by, aboutId, source, was, ...fact }): MemoryFactLine => {
      const person = by ? people.get(by) : undefined;
      return {
        ...fact,
        ...(person ? { by: person } : {}),
        about: titled(aboutId),
        source: titled(source),
        ...(was?.length
          ? {
              was: was.map((past) => {
                const whose = people.get(past.by);
                return { at: past.at, what: past.what, ...(whose ? { by: whose } : {}), ...(past.said ? { said: past.said } : {}) };
              }),
            }
          : {}),
      };
    });
  return { lines, of: held.length, withheld: memoryFacts(project).withheld };
}

/** A page of memory as it is read back: what it is about by its title now, how many notes are on it, and when the newest was left. */
export interface MemoryPageLine {
  about: { id: string; title?: string };
  notes: number;
  updatedAt: string;
}

/** The pages a project's memory keeps, the one most lately written on first. */
export async function readPages(project: DdProject, port: MemoryPort = memoryPort): Promise<MemoryPageLine[]> {
  const pages = await port.pagesOf(project.id);
  const titles = titlesOf(project);
  return pages.map((page) => {
    const title = titles.get(page.aboutId);
    return { about: title ? { id: page.aboutId, title } : { id: page.aboutId }, notes: page.notes, updatedAt: page.updatedAt };
  });
}

/** A finding as it is read back: what looks wrong, and what it is about by its title now. */
export interface MemoryLintLine extends Omit<MemLintFinding, 'aboutId'> {
  about?: { id: string; title?: string };
}

/**
 * What looks wrong in a project's memory, read against the record as it
 * stands. Nothing is changed by asking.
 */
export async function readLint(project: DdProject, port: MemoryPort = memoryPort, now: string = new Date().toISOString()): Promise<MemoryLintLine[]> {
  const [held, stands] = await Promise.all([port.factsOf(project.id), port.watermarks([project.id])]);
  const titles = titlesOf(project);
  return memLint(project, { held, stands: stands.get(project.id) }, now).map(({ aboutId, ...finding }) => {
    if (!aboutId) return finding;
    const title = titles.get(aboutId);
    return { ...finding, about: title ? { id: aboutId, title } : { id: aboutId } };
  });
}
