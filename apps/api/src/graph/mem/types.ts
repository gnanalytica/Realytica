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

import { MEM_SCHEMA_FIRST, type MemEntry, type MemEntryKind, type MemWatermark } from '@realytica/shared';

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
  /** Whether this deployment may raise the schema a project's memory holds. Only the live site may; see `shapeRefused`. */
  mayRaise: boolean;
}

/** What became of a write. Only the first has written anything. */
export type MemWriteAnswer =
  /** The entries are in memory, each once however often it was offered, and the watermark has moved. */
  | { written: number }
  /** Memory does not stand where the writer believed. Here is where it stands. */
  | { moved: MemWatermark }
  /** Memory was last written by a build with a higher schema. This one stands down. */
  | { newer: number }
  /** Memory holds a lower schema, and this deployment is not the one that may raise it. */
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
   * event, and an event does not change. Nothing is written when the batch's
   * schema may not be written over the one memory holds (`shapeRefused`),
   * when memory stands somewhere other than `from`, or when the store has no
   * room. The entries of the kinds in `forget` go first, in the same write.
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

/**
 * What a store answers a write whose shape it will not take over the one a
 * project's memory holds, or nothing when it may be written.
 *
 * Never a lower shape over a higher: an older build stands down. And only
 * the live site raises the shape a project's memory holds. A preview runs a
 * branch against the live site's database, and a branch with a later shape
 * that told a project first would leave the live site, which has the earlier
 * one, telling that project nothing from then on. So a deployment that may
 * not raise writes a shape only where memory already holds it, or where it
 * is the first shape there ever was, which shuts no build out.
 */
export function shapeRefused(held: number, schema: number, mayRaise: boolean): { newer: number } | { lower: number } | undefined {
  if (held > schema) return { newer: held };
  if (!mayRaise && schema > Math.max(held, MEM_SCHEMA_FIRST)) return { lower: held };
  return undefined;
}

/**
 * Where memory stands for a writer of this schema.
 *
 * Memory written in a lower schema stands nowhere for a higher one: the
 * higher one tells the whole record again, in its own shape.
 */
export function standsFor(held: MemWatermark, schema: number): MemWatermark {
  return (held.schema ?? 0) < schema ? {} : held;
}
