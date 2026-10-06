/**
 * The project's memory as a file, for a machine with no graph database.
 *
 * In a file of its own beside the graph's journal, so that neither rewrites
 * the other and the suite needs no database to hold memory to its rules. One
 * record a project: where its memory stands, and its entries by id.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { memFactRev, memIsNear, memPagesOf, type MemEntry, type MemFact, type MemPage, type MemWatermark } from '@realytica/shared';
import { DATA_DIR } from '../../storage/filesystem';
import { ownEntries, ownFacts, ownThought, shapeRule, type MemBatch, type MemCount, type MemoryPort, type MemWriteAnswer } from './types';

interface ProjectMemory extends MemWatermark {
  tenantId: string;
  /** Keyed by id, so an entry offered twice is held once. */
  entries: Record<string, MemEntry>;
  /** Keyed by id: a fact written again replaces what was held under its id. */
  factsById?: Record<string, MemFact>;
}

type MemoryFile = Record<string, ProjectMemory>;

const FILE = path.join(DATA_DIR, 'project-memory-journal.json');

async function readAll(): Promise<MemoryFile> {
  try {
    return JSON.parse(await readFile(FILE, 'utf8')) as MemoryFile;
  } catch {
    // A missing or unreadable file is an empty memory. Every entry is told
    // from the record, so the next write tells them again.
    return {};
  }
}

// One chain for every write, as the graph's journal has: two writes resolving
// close together would otherwise both read, both write, and lose one.
let queue: Promise<void> = Promise.resolve();
function serialise<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function writeAll(data: MemoryFile): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), 'utf8');
  await rename(tmp, FILE);
}

function watermarkOf(held: ProjectMemory): MemWatermark {
  return {
    ...(held.schema === undefined ? {} : { schema: held.schema }),
    ...(held.auditThrough === undefined ? {} : { auditThrough: held.auditThrough }),
    ...(held.turnThrough === undefined ? {} : { turnThrough: held.turnThrough }),
    ...(held.live ? { live: true } : {}),
    ...(held.factsRev ? { factsRev: held.factsRev } : {}),
  };
}

/** The assistant's own notes among a project's facts: what a start-over leaves. */
function thoughtsOf(held: ProjectMemory): Record<string, MemFact> {
  return Object.fromEntries(Object.entries(held.factsById ?? {}).filter(([, fact]) => fact.tag === 'thought'));
}

export const journalMemory: MemoryPort = {
  kind: 'journal',

  async watermarks(projectIds): Promise<Map<string, MemWatermark>> {
    const all = await readAll();
    const found = new Map<string, MemWatermark>();
    for (const id of projectIds) if (all[id]) found.set(id, watermarkOf(all[id]));
    return found;
  },

  async write(batch: MemBatch): Promise<MemWriteAnswer> {
    return serialise<MemWriteAnswer>(async () => {
      const all = await readAll();
      const found = all[batch.projectId] ?? { tenantId: batch.tenantId, entries: {} };
      const schema = batch.through.schema ?? 0;
      const ruling = shapeRule(watermarkOf(found), { schema, live: batch.live });
      if (typeof ruling === 'object') return ruling;
      const stands = ruling === 'carry-on' ? watermarkOf(found) : {};
      if (
        (stands.auditThrough ?? '') !== (batch.from.auditThrough ?? '') ||
        (stands.turnThrough ?? '') !== (batch.from.turnThrough ?? '') ||
        (stands.factsRev ?? '') !== (batch.from.factsRev ?? '')
      ) {
        return { moved: watermarkOf(found) };
      }
      // Starting over, the record is made again: every entry, every fact told from the record and everything said about where memory stood goes. Otherwise only the kinds the write names.
      const held: ProjectMemory = ruling === 'start-over' ? { tenantId: found.tenantId, entries: {}, factsById: thoughtsOf(found) } : found;
      for (const [id, entry] of Object.entries(held.entries)) if (batch.forget?.includes(entry.kind)) delete held.entries[id];
      // An entry already held is the event as it was first told. It stays.
      const entries = ownEntries(batch);
      for (const entry of entries) if (!(entry.id in held.entries)) held.entries[entry.id] = entry;
      // A fact is what the record holds now: one written again replaces the one held under its id.
      const changes = ownFacts(batch);
      const factsById = { ...(held.factsById ?? {}) };
      for (const id of changes.drop) if (factsById[id]?.tag !== 'thought') delete factsById[id];
      for (const fact of changes.put) factsById[fact.id] = fact;
      held.factsById = factsById;
      held.schema = schema;
      held.auditThrough = batch.through.auditThrough;
      held.turnThrough = batch.through.turnThrough;
      held.factsRev = batch.through.factsRev;
      // Set by the live site and by no other writer, and never taken off.
      if (batch.live) held.live = true;
      all[batch.projectId] = held;
      await writeAll(all);
      return { written: entries.length };
    });
  },

  async entries(projectId, limit): Promise<MemEntry[]> {
    const held = (await readAll())[projectId];
    if (!held) return [];
    return Object.values(held.entries)
      .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1))
      .slice(0, limit);
  },

  async count(projectId): Promise<MemCount> {
    const all = await readAll();
    const nodes = (held: ProjectMemory | undefined): number => (held ? 1 + Object.keys(held.entries).length + Object.keys(held.factsById ?? {}).length : 0);
    // This file is all of the store there is: the graph's journal is another, and has no allowance to count against.
    return { project: nodes(all[projectId]), database: Object.values(all).reduce((sum, held) => sum + nodes(held), 0) };
  },

  async factIndex(projectId): Promise<Map<string, string>> {
    const held = (await readAll())[projectId];
    return new Map(Object.values(held?.factsById ?? {}).flatMap((fact) => (fact.tag === 'thought' ? [] : [[fact.id, memFactRev(fact)] as [string, string]])));
  },

  async factsOf(projectId): Promise<MemFact[]> {
    return Object.values((await readAll())[projectId]?.factsById ?? {});
  },

  async factsNear(projectId, near): Promise<{ held: MemFact[]; stands?: MemWatermark }> {
    const found = (await readAll())[projectId];
    if (!found) return { held: [] };
    return { held: Object.values(found.factsById ?? {}).filter((fact) => memIsNear(fact, near)), stands: watermarkOf(found) };
  },

  async think(batch): Promise<MemWriteAnswer> {
    return serialise<MemWriteAnswer>(async () => {
      const all = await readAll();
      const found = all[batch.projectId] ?? { tenantId: batch.tenantId, entries: {} };
      const ruling = shapeRule(watermarkOf(found), { schema: batch.schema, live: batch.live });
      if (typeof ruling === 'object') return ruling;
      const thought = ownThought(batch);
      if (!thought) return { written: 0 };
      const factsById = { ...(found.factsById ?? {}), [thought.id]: thought };
      // The oldest notes beyond what a project keeps go.
      const notes = Object.values(factsById)
        .filter((fact) => fact.tag === 'thought')
        .sort((a, b) => (a.recordedAt === b.recordedAt ? (a.id < b.id ? 1 : -1) : a.recordedAt < b.recordedAt ? 1 : -1));
      for (const old of notes.slice(Math.max(1, batch.keep))) delete factsById[old.id];
      found.factsById = factsById;
      all[batch.projectId] = found;
      await writeAll(all);
      return { written: 1 };
    });
  },

  async pagesOf(projectId): Promise<MemPage[]> {
    return memPagesOf(projectId, Object.values((await readAll())[projectId]?.factsById ?? {}));
  },

  async purge(projectId): Promise<void> {
    await serialise(async () => {
      const all = await readAll();
      if (!(projectId in all)) return;
      delete all[projectId];
      await writeAll(all);
    });
  },

  async projects(): Promise<Array<{ projectId: string; tenantId: string }>> {
    return Object.entries(await readAll()).map(([projectId, held]) => ({ projectId, tenantId: held.tenantId }));
  },
};
