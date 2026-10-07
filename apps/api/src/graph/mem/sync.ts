/**
 * Telling memory what the project store holds.
 *
 * The project store says which copies memory is owed: the ones it has
 * written and the ones it has read, as they are stored. For each, the shared
 * rule (`memoryDelta`) says what comes after the place memory stands, and
 * `writeMemory` writes it with the watermark, in one transaction. Nothing
 * waits on this. It runs once the reply has gone, for a bounded time of its
 * own, and a failure is logged and leaves the copy owed.
 *
 * It is at least once, not exactly once, and that is enough. Every entry has
 * an id that follows from the event it tells, so an entry told twice is one
 * entry. The watermark moves with the entries, so a write that fails leaves
 * memory where it stood and the next pass, after any save or any read of the
 * project on any instance, tells the same entries again.
 *
 * Several instances hold the same project, each as it last read it, and one
 * holding an old copy must not move memory back. Two things stop it. A write
 * goes through only if memory still stands where this instance believed, and
 * otherwise the store says where it stands and the copy is asked again. And
 * a copy that does not hold what memory was last told from tells nothing:
 * unless the project store still holds that very copy, in which case it is
 * the record that has lost the event (the last of two writers of one project
 * keeps its copy), and everything the record holds now is told. When it is
 * the chats the record has lost, the entries of their turns go first.
 *
 * And a conversation is told from its start only by the copy the project
 * store holds. Audit events are only ever added, so an older copy tells
 * nothing a later one would not. A conversation can be deleted: an instance
 * that read the project before that still holds the turns, and memory, which
 * has let their entries go, stands at no turn, exactly as it does for a
 * conversation never told. So before turns are told from the start, the
 * project store is asked whether it still holds this copy.
 *
 * The facts go with the entries, in the same write. An entry is an event and
 * is told once. A fact is what the record holds now, so each telling brings
 * the facts memory holds to the facts this copy gives (`memoryFacts`), by
 * the difference between the two: memory says which facts it holds as one
 * digest, and only when that is not the digest of this copy's facts is what
 * it holds read and compared. A copy whose facts differ with nothing new on
 * its trail to show for it is asked about first, as a conversation told from
 * its start is: an older copy must not take memory back.
 *
 * Which shape of memory a deployment may write over is the store's to say
 * (`shapeRule`). The pass works it out first from where it last knew memory
 * to stand, so that a deployment the rule turns away makes no call. A
 * refusal is never kept: the next pass over the project asks the store
 * again.
 *
 * Three answers from the store are not failures and are said once in the
 * log, not once a pass. A deployment that is not the live site is told that
 * the live site wrote a project's memory in an earlier shape: there is
 * nothing for it to tell until the live site has raised it. A deployment
 * that finds a later shape than its own stands down, and says so, because
 * from then on it writes nothing for that project: one preview of a later
 * branch is enough to stop an earlier one, and a live site put back to an
 * earlier build stops the same way. And a store with no room for another
 * node says so: nothing more is written until a write is taken again, and
 * the graph, which is offered apart from this, goes on being drawn.
 */

import {
  MEM_AT_MOST,
  MEM_SCHEMA,
  memFactRev,
  memFactsDiff,
  memFactsRev,
  memoryDelta,
  memoryFacts,
  memoryReplay,
  sameMemWatermark,
  type DdProject,
  type MemFactsDiff,
  type MemWatermark,
} from '@realytica/shared';
import { memoryPort } from './index';
import { shapeRule, type MemoryPort, type MemWriter } from './types';
import { memWriter, writeMemory } from './write';

/** How long one pass goes on starting calls to the memory store. */
export const MEMORY_WAIT_MS = 2_000;

/** How long an instance leaves between two looks for memory whose project is gone. */
export const MEMORY_SWEEP_MS = 60_000;

/** How many projects one look asks storage about. The next look starts where this one stopped. */
export const SWEEP_AT_MOST = 20;

/** A copy of a project as the project store holds it, and the workspace it belongs to. */
export interface OwedMemory {
  project: DdProject;
  tenantId: string;
}

export interface MemoryWork {
  /** Copies whose events memory may not hold yet. */
  owed: OwedMemory[];
  /** Projects that are gone, document and all. */
  gone: string[];
  /** Where this instance last knew each project's memory to stand. Read here, and kept up as the pass learns more. */
  known: Map<string, MemWatermark>;
  /** Whether the project store still holds the copy with this `updatedAt`. */
  stillStored(projectId: string, updatedAt: string): Promise<boolean>;
}

export interface MemoryPassed {
  /** Copies memory now holds the events of, or that stood down, by the `updatedAt` they were told at. */
  settled: Array<{ projectId: string; builtAt: string }>;
  purged: string[];
  /** Calls made to the memory store, and how many of them failed. */
  made: number;
  failed: number;
  /** True when the store answered a write that it has no room. Nothing more was written in the pass. */
  full?: true;
}

/** Whether the log has been told, since the last write that was taken, that the store has no room. */
let saidFull = false;

/** What the log has been told of the shapes this deployment may not write over. Each line is said once, however many projects and passes it is true of. */
const saidOfShapes = new Set<string>();

function sayOnce(line: string): void {
  if (saidOfShapes.has(line)) return;
  saidOfShapes.add(line);
  console.warn(line);
}

/**
 * One pass over what memory is owed.
 *
 * `port` is this deployment's store, and `live` whether this deployment is
 * the live site, unless a caller says otherwise, which is how the pass is
 * tested.
 */
export async function syncMemory(work: MemoryWork, port: MemoryPort = memoryPort, live: boolean = memWriter().live): Promise<MemoryPassed> {
  const passed: MemoryPassed = { settled: [], purged: [], made: 0, failed: 0 };
  if (work.owed.length === 0 && work.gone.length === 0) return passed;
  const writer: MemWriter = { schema: MEM_SCHEMA, live };

  let waiting = true;
  const timer = setTimeout(() => {
    waiting = false;
  }, MEMORY_WAIT_MS);
  let said = false;
  const failed = (what: string, err: unknown): void => {
    passed.failed += 1;
    // Said once a pass: a store that is down fails every call the same way.
    if (!said) console.warn(`[memory] could not ${what}: ${(err as Error).message}`);
    said = true;
  };

  /**
   * This deployment may not write over what the project's memory holds. The
   * copy has nothing to tell, which settles it. Where memory stood is not
   * kept: the rule's answer changes when the live site writes, so the store
   * is asked again the next time the project is told.
   */
  const refused = (projectId: string, ruling: { newer: number } | { lower: number }): true => {
    work.known.delete(projectId);
    if ('lower' in ruling) {
      // Not this deployment's to tell until the live site has raised the shape: not an error.
      sayOnce(
        `[memory] this deployment writes memory in a later shape (${MEM_SCHEMA}) than the live site wrote a project's memory in (${ruling.lower}), and only the live site raises its own: nothing is written for such projects`,
      );
    } else {
      // Not an error either, and nothing puts it right but a deployment in that shape: the live site stands down only to what a later build of itself wrote.
      sayOnce(
        `[memory] this deployment writes memory in an earlier shape (${MEM_SCHEMA}) than a project's memory holds (${ruling.newer}), and stands down: nothing is written for such projects${
          live ? '. This is the live site, so a later build of it wrote them: it has been put back to an earlier one' : ''
        }`,
      );
    }
    return true;
  };

  /** True when memory holds what this copy tells, or the copy has nothing to tell. */
  const tell = async ({ project, tenantId }: OwedMemory, builtAt: string): Promise<boolean> => {
    // Turned away twice at most: as this instance believed memory stood, then as the store says it stands.
    let turnedAway = 0;
    // Whether the project store has said, in this telling, that it still holds this very copy.
    let stored = false;
    // The facts this copy gives, and the one digest of them all. The copy does not change under a telling: one that does is left.
    const given = memoryFacts(project).held;
    const factsRev = memFactsRev(new Map(given.map((fact) => [fact.id, memFactRev(fact)])));
    while (turnedAway < 2) {
      // Changed in memory since it was chosen: what it holds now is not in the project store yet.
      if (project.updatedAt !== builtAt) return false;
      const held = work.known.get(project.id) ?? {};
      const ruling = shapeRule(held, writer);
      if (typeof ruling === 'object') return refused(project.id, ruling);
      // Carrying on, memory stands where it holds. Starting over it stands nowhere, and the whole record is told.
      const stands = ruling === 'carry-on' ? held : {};
      const now = Date.now();
      let delta = memoryDelta(project, stands, { now });
      const behind = delta.standsDown === 'behind';
      const factsDiffer = (stands.factsRev ?? '') !== (factsRev ?? '');
      const trailMoves = delta.entries.length > 0 || !sameMemWatermark(delta.through, stands);
      // Only the copy the project store holds tells everything again, tells a conversation from its start, or changes facts with nothing new on its trail.
      if (!stored && (behind || (stands.turnThrough === undefined && delta.through.turnThrough !== undefined) || (factsDiffer && !trailMoves))) {
        if (!(await work.stillStored(project.id, builtAt))) return true;
        if (project.updatedAt !== builtAt) return false;
        stored = true;
      }
      if (behind) delta = memoryReplay(project, stands, { now });
      if (delta.entries.length === 0 && !delta.more && sameMemWatermark(delta.through, stands) && !factsDiffer) return true;
      // What memory holds is read only when it holds some and they are not this copy's.
      let diff: MemFactsDiff | undefined;
      if (factsDiffer) {
        let index = new Map<string, string>();
        if (stands.factsRev) {
          passed.made += 1;
          index = await port.factIndex(project.id);
        }
        diff = memFactsDiff(given, index, MEM_AT_MOST);
      }
      const nowHeld = diff ? memFactsRev(diff.index) : stands.factsRev;
      const through: MemWatermark = { ...delta.through, ...(nowHeld ? { factsRev: nowHeld } : {}) };
      passed.made += 1;
      const answer = await writeMemory(port, tenantId, stands, { ...delta, through, ...(diff ? { factChanges: { put: diff.put, drop: diff.drop } } : {}) }, live);
      if ('newer' in answer || 'lower' in answer) return refused(project.id, answer);
      if ('full' in answer) {
        // Said once, until a write is taken again: every write would be turned away the same way.
        if (!saidFull) console.warn(`[memory] the graph database has no room for more nodes, so memory is not being written: ${answer.full}`);
        saidFull = true;
        passed.full = true;
        return false;
      }
      if ('moved' in answer) {
        work.known.set(project.id, answer.moved);
        turnedAway += 1;
        continue;
      }
      saidFull = false;
      // The live site's mark is set by its own write and stays under anybody else's.
      work.known.set(project.id, { ...through, ...(live || held.live ? { live: true } : {}) });
      if (!delta.more && !diff?.more) return true;
      // A long record is told a write at a time. What this pass has no time left for, the next one tells.
      if (!waiting) return false;
    }
    return false;
  };

  try {
    // Where memory stands for the projects this instance has not asked about yet, in one read.
    const unknown = work.owed.map(({ project }) => project.id).filter((id) => !work.known.has(id));
    if (unknown.length > 0) {
      passed.made += 1;
      try {
        const found = await port.watermarks(unknown);
        for (const id of unknown) work.known.set(id, found.get(id) ?? {});
      } catch (err) {
        failed('read where memory stands', err);
        return passed;
      }
    }
    for (const owed of work.owed) {
      // Out of time, or out of room: what is left stays owed.
      if (!waiting || passed.full) break;
      const builtAt = owed.project.updatedAt;
      try {
        if (await tell(owed, builtAt)) passed.settled.push({ projectId: owed.project.id, builtAt });
      } catch (err) {
        failed(`write the memory of ${owed.project.id}`, err);
      }
    }
    for (const projectId of work.gone) {
      if (!waiting) break;
      passed.made += 1;
      try {
        await port.purge(projectId);
        work.known.delete(projectId);
        passed.purged.push(projectId);
      } catch (err) {
        failed(`remove the memory of ${projectId}`, err);
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return passed;
}

/** What an instance carries from one look for memory left behind to the next. */
export interface MemoryLooks {
  /** The projects a look has seen gone and no later look has seen back. */
  seenGone: Set<string>;
  /** Where in the list the next look starts, so that a long list is gone round and none of it is passed over. */
  from: number;
}

export interface MemorySweep {
  /** The workspaces this project store holds. Memory written under any other is not this store's to remove. */
  tenantIds: ReadonlySet<string>;
  /** The projects this instance holds, which are not gone and need no asking about. */
  held: ReadonlySet<string>;
  /** Whether a project's document is gone from storage. False when storage cannot say. */
  gone(projectId: string): Promise<boolean>;
  /** Kept by the caller from one look to the next, and changed here. */
  looks: MemoryLooks;
}

/**
 * Remove the memory of projects that are gone.
 *
 * A project deleted by this build takes its memory with it. One deleted by a
 * build that knows only the graph leaves its memory behind, and the live
 * site runs such a build. So memory is looked through for projects whose
 * document is no longer in storage, and the memory of one seen gone on two
 * looks is removed. Two, because one look is one answer from storage, and
 * what follows from it is not undone.
 *
 * Only for the workspaces this project store holds. A machine pointed at
 * another deployment's graph database holds none of its projects, and
 * without this would take every one of them for gone.
 */
export async function sweepMemory(sweep: MemorySweep, port: MemoryPort = memoryPort): Promise<string[]> {
  const { looks } = sweep;
  const mine = (await port.projects())
    .filter(({ projectId, tenantId }) => tenantId && sweep.tenantIds.has(tenantId) && !sweep.held.has(projectId))
    .map(({ projectId }) => projectId)
    .sort();
  // No longer asked about: its memory is gone, or the project is this instance's again.
  for (const projectId of [...looks.seenGone]) if (!mine.includes(projectId)) looks.seenGone.delete(projectId);

  const start = mine.length ? looks.from % mine.length : 0;
  const asked = [...mine.slice(start), ...mine.slice(0, start)].slice(0, SWEEP_AT_MOST);
  looks.from = start + asked.length;
  const purged: string[] = [];
  for (const projectId of asked) {
    if (!(await sweep.gone(projectId))) {
      looks.seenGone.delete(projectId);
    } else if (!looks.seenGone.has(projectId)) {
      looks.seenGone.add(projectId);
    } else {
      await port.purge(projectId);
      looks.seenGone.delete(projectId);
      purged.push(projectId);
    }
  }
  return purged;
}
