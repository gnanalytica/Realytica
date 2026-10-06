/**
 * What of a project's memory the assistant is shown with a question.
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
 * A reader working from a grant is never shown memory itself. Memory holds
 * the whole project, and what such a reader may see is their own copy of the
 * record, which is what their lines are told from. The assistant's notes are
 * the firm's working, and are shown to the firm's own people only.
 */

import { memContext, memFactRev, memFactsRev, memNear, memSeeds, memoryFacts, type DdProject, type MemAsk, type MemContext } from '@realytica/shared';
import { memoryPort } from './index';
import type { MemoryPort } from './types';

/** How long a question waits for the memory store before the record answers in its place. */
export const MEMORY_CONTEXT_WAIT_MS = 400;

/** How long a store that did not answer in time is left alone before a question asks it again. */
export const MEMORY_CONTEXT_REST_MS = 60_000;

/** How long the chat waits for the store when a person asks what looks wrong in memory: longer, because that is what they asked for. */
export const MEMORY_LINT_WAIT_MS = 5_000;

/** Until when the store is not asked, after it was last found silent. */
export const memoryRest = { until: 0 };

export interface MemoryContext extends MemContext {
  /** Where the lines told from the record came from: the memory store, or the record itself. */
  from: 'memory' | 'record';
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
 * The lines for one question. `view` is the project as this reader may see
 * it, and whether that is the whole of it.
 */
export async function memoryContext(
  view: { project: DdProject; complete: boolean },
  ask: MemAsk,
  options: { port?: MemoryPort; waitMs?: number; now?: () => number } = {},
): Promise<MemoryContext> {
  const { project } = view;
  const seeds = memSeeds(project, ask);
  const given = memoryFacts(project).held;
  const fromRecord = (): MemoryContext => ({ ...memContext(project, given, ask, seeds), from: 'record' });
  if (!view.complete) return fromRecord();

  const now = options.now ?? Date.now;
  if (now() < memoryRest.until) return fromRecord();
  const reading = (options.port ?? memoryPort).factsNear(project.id, memNear(project.id, seeds));
  const near = await inTime(reading, options.waitMs ?? MEMORY_CONTEXT_WAIT_MS);
  if (!near) {
    const until = now() + MEMORY_CONTEXT_REST_MS;
    memoryRest.until = until;
    // Late is not silent: when the answer does come, the store is no longer left alone on its account.
    reading.then(
      () => {
        if (memoryRest.until === until) memoryRest.until = 0;
      },
      () => undefined,
    );
    return fromRecord();
  }
  memoryRest.until = 0;
  const notes = near.held.filter((fact) => fact.tag === 'thought');
  const current = near.stands?.factsRev === memFactsRev(new Map(given.map((fact) => [fact.id, memFactRev(fact)])));
  const told = current ? near.held.filter((fact) => fact.tag !== 'thought') : given;
  return { ...memContext(project, [...told, ...notes], ask, seeds), from: current ? 'memory' : 'record' };
}
