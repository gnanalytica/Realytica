/**
 * Where the project's memory is kept.
 *
 * Memory sits in the graph store, beside the project graph and apart from
 * it. The graph is a drawing of the record as it stands now: rebuilt on every
 * change, and what it no longer draws it deletes. Memory is what the project
 * has been told, event by event, and nothing a redraw may touch. So it has
 * labels of its own, `MemProject` and `MemEntry`, and never the graph's
 * `Ryt` label or its `RYT_EDGE` relationship. A build that knows only the
 * graph, and the live site runs one against this same database, reads,
 * rebuilds and purges the graph without meeting a memory node.
 *
 * For the same reason no relationship joins memory to the graph. An entry
 * points at the record by ids held as properties and they are looked up when
 * it is read. A relationship to a graph node would go the first time a build
 * redrew the project and stopped drawing that node.
 *
 * Every memory node carries the project's id, the workspace's, and an id of
 * its own that begins with the project's and is unique for its label. A
 * write sets them when it creates a node and never on one it finds, so no
 * write can move a node from one project to another.
 *
 * Writing goes through `writeMemory` in `write.ts` and through nothing else.
 */

import type { MemEntry, MemEntryKind, MemWatermark } from '@realytica/shared';

/** Who is writing: the shape its build writes memory in, and whether it is the live site. */
export interface MemWriter {
  schema: number;
  /** True on the live site and nowhere else: not on a preview, a laptop, a test or a probe. */
  live: boolean;
}

/** One write to a project's memory: its entries, and the watermark that moves with them. */
export interface MemBatch {
  projectId: string;
  tenantId: string;
  /** Where the writer believes memory stands. The write goes through only if it does. */
  from: MemWatermark;
  /** Where it stands once written, with the schema the entries are written in. */
  through: MemWatermark;
  entries: MemEntry[];
  /** Kinds of entry the project's memory lets go of before these are written, in the same write. */
  forget?: MemEntryKind[];
  /** Whether the writer is the live site. What it may write over depends on it; see `shapeRule`. */
  live: boolean;
}

/** What became of a write. Only the first has written anything. */
export type MemWriteAnswer =
  /** The entries are in memory, each once however often it was offered, and the watermark has moved. */
  | { written: number }
  /** Memory does not stand where the writer believed. Here is where it stands. */
  | { moved: MemWatermark }
  /** Memory was last written by a build with a higher schema. This one stands down. */
  | { newer: number }
  /** The live site wrote this memory in a lower schema, and only the live site raises its own. */
  | { lower: number }
  /** The store has no room for another node. Its own words for it. */
  | { full: string };

/** How many nodes a store holds: a project's memory, and everything in the database it is kept in. */
export interface MemCount {
  /** The project's memory: its entries and the node that says where it stands. */
  project: number;
  /** Every node in the database, the graph's and every other project's included: what the database's allowance counts. */
  database: number;
}

export interface MemoryPort {
  /** Human name for the boot log, so it is obvious which backend is live. */
  readonly kind: 'journal' | 'neo4j';

  /** Where the memory of each of these projects stands. A project nothing has been written for is not in the answer. */
  watermarks(projectIds: string[]): Promise<Map<string, MemWatermark>>;

  /**
   * Write the entries and move the watermark, together or not at all.
   *
   * An entry already in memory is left exactly as it is: an entry is an
   * event, and an event does not change. Nothing is written when the writer
   * may not write over what memory holds (`shapeRule`), when memory stands
   * somewhere other than `from`, or when the store has no room. Where the
   * rule says to start over, everything the project's memory holds goes
   * first, and the entries of the kinds in `forget` go first in any case, in
   * the same write.
   */
  write(batch: MemBatch): Promise<MemWriteAnswer>;

  /** How many nodes the project's memory is, and how many the whole database holds. */
  count(projectId: string): Promise<MemCount>;

  /** A project's entries, newest first. */
  entries(projectId: string, limit: number): Promise<MemEntry[]>;

  /** Remove every memory node of a project. */
  purge(projectId: string): Promise<void>;

  /** Every project that has memory, and the workspace it was written under. */
  projects(): Promise<Array<{ projectId: string; tenantId: string }>>;
}

/** The id of the node that holds a project's watermark. */
export function memProjectId(projectId: string): string {
  return `${projectId}::mem`;
}

/**
 * The entries of a batch a store writes: the ones whose id begins with the
 * batch's own project. `writeMemory` hands over no other. A store holds to
 * it all the same, because an entry made under another project's id would
 * be found, and left as it was, when that project came to tell the event.
 */
export function ownEntries(batch: MemBatch): MemEntry[] {
  return batch.entries.filter((entry) => entry.id.startsWith(`${batch.projectId}::mem::`));
}

/** What a store does with a write, given what the project's memory holds and who is writing. */
export type ShapeRuling =
  /** Memory is in the writer's shape, and the writer adds to it from where it stands. */
  | 'carry-on'
  /** Everything the project's memory holds is let go, and the whole record is told again in the writer's shape. */
  | 'start-over'
  /** Memory is in a later shape. The writer stands down. */
  | { newer: number }
  /** The live site wrote this memory in an earlier shape. The writer is turned away. */
  | { lower: number };

/**
 * Which writer may write what over a project's memory.
 *
 * A project's memory says which shape it is in and whether the live site
 * wrote it. The live site is the deployment people use. Every other writer
 * is a preview of a branch, a laptop, a test or a probe, and may share the
 * live site's database.
 *
 * 1. The live site, over memory it did not write, starts it over: whatever
 *    another writer left, in whatever shape, is let go, and the live site
 *    tells the record again. So nothing a preview writes makes the live
 *    site stand down.
 * 2. The live site, over memory it wrote: a later shape is a later live
 *    build's, and this one stands down; an earlier shape it raises, by
 *    starting over; the same shape it carries on.
 * 3. Any other writer, over memory the live site wrote: it carries on in
 *    the same shape, stands down to a later one, and is turned away from an
 *    earlier one. Only the live site raises what the live site wrote.
 * 4. Any other writer, over memory the live site has not written: it raises
 *    an earlier shape by starting over, carries on in the same, and stands
 *    down to a later. Until the live site writes a project's memory, that
 *    memory is the previews'.
 *
 * Starting over is what keeps an entry from staying as an earlier rule wrote
 * it: an entry is never rewritten, so a new shape lets the old entries go
 * and tells every event again.
 */
export function shapeRule(held: MemWatermark, writer: MemWriter): ShapeRuling {
  const shape = held.schema ?? 0;
  if (writer.live && !held.live) return 'start-over';
  if (shape > writer.schema) return { newer: shape };
  if (shape === writer.schema) return 'carry-on';
  return held.live && !writer.live ? { lower: shape } : 'start-over';
}
