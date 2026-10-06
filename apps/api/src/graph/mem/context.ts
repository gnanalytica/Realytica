/**
 * What of a project's memory the chat is given with a question.
 *
 * Read from the memory store, with a short time limit, and from the record
 * when the store does not answer in time. A reply never waits on the store
 * for longer than that limit, and a store that was silent is not asked again
 * for a while: a database that is paused costs one short wait, not one a
 * question. A store that answers after all, only late, as one does on the
 * first call of a new instance, is asked again by the next question.
 *
 * The store is believed only when it holds what the record now gives. Memory
 * is told after a save and after the reply, so it can be a moment behind,
 * and the question that follows a change is the one most likely to be about
 * it. With the facts, the store answers which facts it holds, as one digest.
 * Where that is the record's own digest, the lines are memory's. Where it is
 * not, the lines told from the record are the record's own, pure and current,
 * and memory still gives its notes, which the record cannot.
 *
 * Three callers. A model is shown the lines near its question
 * (`memoryContext`). An answer the chat gave by rule has the facts it is
 * about said under it (`memoryUnder`). And a question put to memory itself
 * is answered from it (`memoryAnswer`). The last two are worded by code, from
 * the facts the record gives, which are memory's own facts whenever memory is
 * not behind; what they ask of the store is the one thing only it holds, the
 * assistant's notes.
 *
 * A reader working from a grant is never shown memory itself. Memory holds
 * the whole project, and what such a reader may see is their own copy of the
 * record, which is what their lines are told from. The assistant's notes are
 * the firm's working, and are shown to the firm's own people only.
 */

import {
  MEM_UNDER_ANSWER,
  memAnswer,
  memContext,
  memFactRev,
  memFactsRev,
  memNear,
  memSeeds,
  memUnderAnswer,
  memoryFacts,
  type DdProject,
  type MemAsk,
  type MemAsked,
  type MemContext,
  type MemFact,
  type MemSaid,
} from '@realytica/shared';
import { memoryPort } from './index';
import type { MemoryPort } from './types';

/** How long a question waits for the memory store before the record answers in its place. */
export const MEMORY_CONTEXT_WAIT_MS = 400;

/** How long a store that did not answer in time is left alone before a question asks it again. */
export const MEMORY_CONTEXT_REST_MS = 60_000;

/** How long the chat waits for the store when a person asks what looks wrong in memory: longer, because that is what they asked for. */
export const MEMORY_LINT_WAIT_MS = 5_000;

/** How long a question put to memory itself waits for the store's notes: longer than a question put to the chat, and asked even of a store that is being left alone. */
export const MEMORY_ASKED_WAIT_MS = 2_000;

/** Until when the store is not asked, after it was last found silent. */
export const memoryRest = { until: 0 };

export interface MemoryContext extends MemContext {
  /** Where the lines told from the record came from: the memory store, or the record itself. */
  from: 'memory' | 'record';
}

/** The project as a reader may see it, and whether that is the whole of it. */
export interface MemoryView {
  project: DdProject;
  complete: boolean;
}

export interface MemoryAsking {
  port?: MemoryPort;
  waitMs?: number;
  now?: () => number;
}

/** The answer if it comes within `ms`, and nothing if it does not or the work fails. The work is left to end by itself. */
export function inTime<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

/**
 * What the store answers, if it does within `ms`. A store that does not is
 * left alone for a while, unless its answer then comes late. A read that
 * throws before it has begun is a read that failed, like any other.
 */
async function fromStore<T>(read: () => Promise<T>, ms: number, now: () => number): Promise<T | undefined> {
  const reading = (async () => read())();
  const answer = await inTime(reading, ms);
  if (answer !== undefined) {
    memoryRest.until = 0;
    return answer;
  }
  const until = now() + MEMORY_CONTEXT_REST_MS;
  memoryRest.until = until;
  // Late is not silent: when the answer does come, the store is no longer left alone on its account.
  reading.then(
    () => {
      if (memoryRest.until === until) memoryRest.until = 0;
    },
    () => undefined,
  );
  return undefined;
}

/**
 * The lines for one question put to a model. `view` is the project as this
 * reader may see it, and whether that is the whole of it.
 */
export async function memoryContext(view: MemoryView, ask: MemAsk, options: MemoryAsking = {}): Promise<MemoryContext> {
  const { project } = view;
  const seeds = memSeeds(project, ask);
  const given = memoryFacts(project).held;
  const fromRecord = (): MemoryContext => ({ ...memContext(project, given, ask, seeds), from: 'record' });
  if (!view.complete) return fromRecord();

  const now = options.now ?? Date.now;
  if (now() < memoryRest.until) return fromRecord();
  const port = options.port ?? memoryPort;
  const near = await fromStore(() => port.factsNear(project.id, memNear(project.id, seeds)), options.waitMs ?? MEMORY_CONTEXT_WAIT_MS, now);
  if (!near) return fromRecord();
  const notes = near.held.filter((fact) => fact.tag === 'thought');
  const current = near.stands?.factsRev === memFactsRev(new Map(given.map((fact) => [fact.id, memFactRev(fact)])));
  const told = current ? near.held.filter((fact) => fact.tag !== 'thought') : given;
  return { ...memContext(project, [...told, ...notes], ask, seeds), from: current ? 'memory' : 'record' };
}

/**
 * The assistant's notes on a project, as the store holds them, or nothing
 * when it does not answer in time. Never read for a reader working from a
 * grant. `insist` asks even a store that is being left alone.
 */
async function notesOf(view: MemoryView, options: MemoryAsking & { insist?: boolean }): Promise<MemFact[] | undefined> {
  if (!view.complete) return [];
  const now = options.now ?? Date.now;
  if (!options.insist && now() < memoryRest.until) return undefined;
  const port = options.port ?? memoryPort;
  const near = await fromStore(() => port.factsNear(view.project.id, { aboutIds: [], fns: [], departments: [], keys: ['note'] }), options.waitMs ?? MEMORY_CONTEXT_WAIT_MS, now);
  return near?.held.filter((fact) => fact.tag === 'thought');
}

/**
 * What is said under an answer the chat gave by rule: the facts memory holds
 * that the question is about, each with its tag, or nothing. `whole` says
 * the answer was one about the project as a whole.
 *
 * The store is asked for its notes only when there is room under the answer
 * for one, so most answers given by rule do not wait on it at all.
 */
export async function memoryUnder(view: MemoryView, ask: MemAsk, options: MemoryAsking & { whole?: boolean } = {}): Promise<MemSaid | undefined> {
  const given = memoryFacts(view.project).held;
  const whole = { whole: options.whole };
  const told = memUnderAnswer(view.project, given, ask, whole);
  if ((told?.rests.length ?? 0) >= MEM_UNDER_ANSWER) return told;
  const notes = await notesOf(view, options);
  return notes?.length ? memUnderAnswer(view.project, [...given, ...notes], ask, whole) : told;
}

/** The answer to a question put to memory itself. It says so when the store's notes could not be read. */
export async function memoryAnswer(view: MemoryView, asked: MemAsked, ask: MemAsk, options: MemoryAsking = {}): Promise<MemSaid> {
  const given = memoryFacts(view.project).held;
  const notes = await notesOf(view, { ...options, waitMs: options.waitMs ?? MEMORY_ASKED_WAIT_MS, insist: true });
  return memAnswer(view.project, [...given, ...(notes ?? [])], asked, ask, { notesUnread: notes === undefined });
}
