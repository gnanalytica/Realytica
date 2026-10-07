/**
 * The project's memory in Neo4j.
 *
 * In the database the graph is in, under labels of its own: one `MemProject`
 * node a project, holding where its memory stands, a `MemEntry` node an
 * event, a `MemFact` node for each value the record holds and for each note
 * of the assistant's, and a `MemPage` node for each thing a note is about.
 * No statement here names `Ryt` or `RYT_EDGE`. The one relationship made is
 * memory's own, `MEM_ON`, from a note to its page: see `types.ts` for why
 * there is no other.
 *
 * A write is one transaction. It takes the project's `MemProject` node first
 * and writes to it before it reads it, which takes the node's lock, so two
 * writes of one project's memory run one after the other and the second
 * reads what the first left. Then, only if memory stands where the writer
 * believed and in a shape the writer may write over, the entries and the
 * watermark go in together. A write that is turned away ends its transaction
 * with nothing written, not even the node it took. An entry is created and
 * never changed: every property is set when the node is made and none when
 * it is found, so an entry offered twice is one entry, and no write can give
 * a node to another project. What changes an entry is a write that starts
 * the project's memory over (`shapeRule`): it lets every entry go, and tells
 * them again, in the one transaction.
 *
 * A fact is not an event. It is what the record holds now, so a fact written
 * again replaces what its node held, property for property, and a fact the
 * record no longer gives is deleted by the write that says so. Its project
 * and workspace are set when the node is made, as an entry's are.
 *
 * A note of the assistant's is a fact under a heading of its own, written by
 * `think` and by nothing else. That write takes the project's `MemProject`
 * node as every write does, so it waits its turn and a purge of the project
 * removes what it wrote. It moves no watermark. A start-over leaves notes and
 * their pages where they are.
 */

import { memFactRev, memPageId, type MemEntry, type MemFact, type MemFactPast, type MemPage, type MemPlace, type MemWatermark } from '@realytica/shared';
import { WRITE_TIMEOUT_MS, openSession } from '../neo4j';
import { memProjectId, ownEntries, ownFacts, ownThought, shapeRule, type MemBatch, type MemCount, type MemoryPort, type MemWriteAnswer } from './types';

/**
 * How long the database gives a read of memory before it ends it. A read
 * that hung would otherwise keep open the pass that is waiting on it.
 */
export const READ_TIMEOUT_MS = 5_000;

/**
 * The memory's own constraints and index. Idempotent.
 *
 * Made by this port before its first write and not at boot, because a
 * preview deployment writes memory and does not touch the graph's schema.
 * The unique ids are what make `MERGE` find a node rather than make a second.
 */
const SCHEMA = [
  'CREATE CONSTRAINT mem_project_id IF NOT EXISTS FOR (m:MemProject) REQUIRE m.id IS UNIQUE',
  'CREATE CONSTRAINT mem_entry_id IF NOT EXISTS FOR (e:MemEntry) REQUIRE e.id IS UNIQUE',
  'CREATE INDEX mem_entry_project IF NOT EXISTS FOR (e:MemEntry) ON (e.projectId)',
  'CREATE CONSTRAINT mem_fact_id IF NOT EXISTS FOR (f:MemFact) REQUIRE f.id IS UNIQUE',
  'CREATE INDEX mem_fact_project IF NOT EXISTS FOR (f:MemFact) ON (f.projectId)',
  'CREATE CONSTRAINT mem_page_id IF NOT EXISTS FOR (p:MemPage) REQUIRE p.id IS UNIQUE',
  'CREATE INDEX mem_page_project IF NOT EXISTS FOR (p:MemPage) ON (p.projectId)',
];

let schemaReady: Promise<void> | undefined;

function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const session = openSession();
    try {
      await session.executeWrite(async (tx) => {
        for (const statement of SCHEMA) await tx.run(statement);
      }, { timeout: WRITE_TIMEOUT_MS });
    } finally {
      await session.close();
    }
  })().catch((err: unknown) => {
    // Not made this time: the next write tries again.
    schemaReady = undefined;
    throw err;
  });
  return schemaReady;
}

/**
 * Take a project's memory and answer where it stands.
 *
 * `asked` is set before anything is read, for the lock; see the header. The
 * project and the workspace are set when the node is made and never after.
 */
const CLAIM = `
  MERGE (m:MemProject { id: $id })
    ON CREATE SET m.projectId = $projectId, m.tenantId = $tenantId
  SET m.asked = $at
  WITH m
  RETURN m.schema AS schema, m.auditThrough AS auditThrough, m.turnThrough AS turnThrough, m.live AS live, m.factsRev AS factsRev
`;

/**
 * Put a project's memory node back to what it is made with, for a write that
 * starts the project's memory over: whatever another shape kept on it goes,
 * the mark that says whose memory it is included, and the write that follows
 * sets what this one keeps. The node keeps its own id, project and
 * workspace: nothing here is taken from the writer.
 */
const RESET = 'MATCH (m:MemProject { id: $id }) SET m = { id: m.id, projectId: m.projectId, tenantId: m.tenantId }';

/**
 * Let go of the project's entries of these kinds. Run before the entries of
 * the same write, so a turn the record still holds is written again after.
 */
const FORGET = 'MATCH (e:MemEntry { projectId: $projectId }) WHERE e.kind IN $kinds DETACH DELETE e';

/**
 * Move the watermark and write the entries. With no entries the watermark
 * still moves. `$live` is true from the live site and null from every other
 * writer, which leaves the mark as it was: only the live site sets it, and
 * nothing takes it off.
 */
const WRITE = `
  MATCH (m:MemProject { id: $id })
  SET m.schema = $schema, m.auditThrough = $auditThrough, m.turnThrough = $turnThrough, m.writtenAt = $at,
      m.live = coalesce($live, m.live), m.factsRev = $factsRev
  WITH m
  UNWIND $entries AS entry
  MERGE (e:MemEntry { id: entry.id })
    ON CREATE SET e.projectId = $projectId, e.tenantId = $tenantId, e.kind = entry.kind, e.at = entry.at,
                  e.by = entry.by, e.sourceId = entry.sourceId, e.about = entry.about, e.key = entry.key,
                  e.label = entry.label, e.pane = entry.pane, e.department = entry.department, e.fn = entry.fn,
                  e.stage = entry.stage
`;

const ENTRIES = `
  MATCH (e:MemEntry { projectId: $projectId })
  RETURN e.id AS id, e.kind AS kind, e.at AS at, e.by AS by, e.sourceId AS sourceId, e.about AS about,
         e.key AS key, e.label AS label, e.pane AS pane, e.department AS department, e.fn AS fn, e.stage AS stage
  ORDER BY e.at DESC, e.id DESC
  LIMIT toInteger($limit)
`;

const WATERMARKS = `
  MATCH (m:MemProject) WHERE m.id IN $ids
  RETURN m.projectId AS projectId, m.schema AS schema, m.auditThrough AS auditThrough, m.turnThrough AS turnThrough, m.live AS live,
         m.factsRev AS factsRev
`;

/**
 * What a write that starts a project's memory over lets go of: every entry,
 * and every fact told from the record. Not the assistant's own notes, which
 * nothing can tell again.
 */
const START_OVER = [
  'MATCH (n:MemEntry { projectId: $projectId }) DETACH DELETE n',
  "MATCH (n:MemFact { projectId: $projectId }) WHERE n.tag <> 'thought' DETACH DELETE n",
];

/** Let go of the facts the record no longer gives. Never a note of the assistant's. */
const DROP_FACTS = "MATCH (f:MemFact { projectId: $projectId }) WHERE f.id IN $ids AND f.tag <> 'thought' DETACH DELETE f";

/**
 * Write facts as the record now gives them. A fact found is replaced
 * property for property: `fact` carries every property a fact can have, the
 * ones this fact lacks as null, which takes them off the node.
 */
const PUT_FACTS = `
  UNWIND $facts AS fact
  MERGE (f:MemFact { id: fact.id })
    ON CREATE SET f.projectId = $projectId, f.tenantId = $tenantId
  SET f += fact
`;

const FACT_INDEX = "MATCH (f:MemFact { projectId: $projectId }) WHERE f.tag <> 'thought' RETURN f.id AS id, f.rev AS rev";

const FACTS = 'MATCH (f:MemFact { projectId: $projectId }) RETURN f { .* } AS fact';

/** The facts a question's seeds can bring: about one of these records, filed under one of these places, or under one of these keys. */
const FACTS_NEAR = `
  MATCH (f:MemFact { projectId: $projectId })
  WHERE f.aboutId IN $aboutIds OR f.fn IN $fns OR f.department IN $departments OR f.key IN $keys
  RETURN f { .* } AS fact
`;

/** A note written again is put on its page afresh: whatever page it was on before is let go of first. */
const OFF_ITS_PAGE = 'MATCH (f:MemFact { id: $id })-[r:MEM_ON]->(:MemPage) DELETE r';

/**
 * Keep a note, on the page of what it is about. The page is made when its
 * first note is, with its project, its workspace and what it is about set
 * then and never after, as the note's project and workspace are. A page
 * holds nothing else: how many notes are on it and when the newest was left
 * are counted from the notes when it is read.
 */
const PUT_THOUGHT = `
  MERGE (p:MemPage { id: $pageId })
    ON CREATE SET p.projectId = $projectId, p.tenantId = $tenantId, p.aboutId = $aboutId
  MERGE (f:MemFact { id: $id })
    ON CREATE SET f.projectId = $projectId, f.tenantId = $tenantId
  SET f += $thought
  MERGE (f)-[:MEM_ON]->(p)
`;

/** Let go of the oldest notes beyond what a project keeps. */
const TRIM_THOUGHTS = `
  MATCH (t:MemFact { projectId: $projectId })
  WHERE t.tag = 'thought'
  WITH t ORDER BY t.recordedAt DESC, t.id DESC
  SKIP toInteger($keep)
  DETACH DELETE t
`;

/** A page with no note left on it goes. */
const EMPTY_PAGES = `
  MATCH (p:MemPage { projectId: $projectId })
  WHERE NOT EXISTS { MATCH (p)<-[:MEM_ON]-(:MemFact) }
  DETACH DELETE p
`;

const PAGES = `
  MATCH (p:MemPage { projectId: $projectId })<-[:MEM_ON]-(t:MemFact)
  RETURN p.id AS id, p.aboutId AS aboutId, max(t.recordedAt) AS updatedAt, count(t) AS notes
  ORDER BY updatedAt DESC, id
`;

const PROJECTS = 'MATCH (m:MemProject) RETURN m.projectId AS projectId, m.tenantId AS tenantId';

/** Every node in the database, whatever it is: the number the database's allowance is counted in. */
const EVERY_NODE = 'MATCH (n) RETURN count(n) AS nodes';

/**
 * Thrown inside a write's transaction to end it with nothing written. The
 * database is given no other way to be told a transaction is not wanted
 * after all, and what it carries is the answer the writer gets.
 */
class TurnedAway extends Error {
  constructor(readonly answer: MemWriteAnswer) {
    super('the write was turned away');
  }
}

/**
 * Whether the database turned a write away for want of room. One with an
 * allowance of nodes refuses the write that would pass it, in words that
 * name the limit.
 */
function outOfRoom(err: unknown): boolean {
  return /logical size limit|limit of \d+ nodes/i.test(err instanceof Error ? err.message : '');
}

/**
 * Every label memory has or is to have. A purge by this build removes what a
 * later build wrote under the two that are not written yet.
 */
const MEM_LABELS = ['MemProject', 'MemEntry', 'MemFact', 'MemPage'];

interface Row {
  get(key: string): unknown;
}

function watermarkOf(row: Row): MemWatermark {
  const schema = row.get('schema');
  const auditThrough = row.get('auditThrough');
  const turnThrough = row.get('turnThrough');
  return {
    ...(schema === null || schema === undefined ? {} : { schema: Number(schema) }),
    ...(typeof auditThrough === 'string' ? { auditThrough } : {}),
    ...(typeof turnThrough === 'string' ? { turnThrough } : {}),
    ...(row.get('live') === true ? { live: true } : {}),
    ...(typeof row.get('factsRev') === 'string' ? { factsRev: row.get('factsRev') as string } : {}),
  };
}

/** Every property a fact's node can have, the ones this fact lacks as null. Its past is kept as one line of text an item. */
function factProperties(fact: MemFact): Record<string, unknown> {
  return {
    id: fact.id,
    tag: fact.tag,
    key: fact.key,
    label: fact.label,
    value: fact.value,
    unit: fact.unit ?? null,
    display: fact.display ?? null,
    aboutId: fact.aboutId,
    department: fact.department ?? null,
    fn: fact.fn ?? null,
    validFrom: fact.validFrom ?? null,
    validTo: fact.validTo ?? null,
    recordedAt: fact.recordedAt,
    by: fact.by ?? null,
    at: fact.at ?? null,
    readBy: fact.readBy ?? null,
    proof: fact.proof ?? null,
    stands: fact.stands ?? null,
    source: fact.source,
    page: fact.page ?? null,
    quote: fact.quote ?? null,
    contests: fact.contests ?? null,
    was: fact.was?.length ? fact.was.map((past) => JSON.stringify(past)) : null,
    rev: memFactRev(fact),
  };
}

const FACT_TEXT = ['unit', 'display', 'department', 'fn', 'validFrom', 'validTo', 'by', 'at', 'readBy', 'proof', 'quote', 'contests'] as const;

function factOf(held: Record<string, unknown>): MemFact {
  const past = Array.isArray(held.was) ? held.was.flatMap((line): MemFactPast[] => (typeof line === 'string' ? [JSON.parse(line) as MemFactPast] : [])) : [];
  const text = Object.fromEntries(FACT_TEXT.flatMap((name) => (typeof held[name] === 'string' ? [[name, held[name]]] : [])));
  return {
    id: String(held.id),
    tag: String(held.tag) as MemFact['tag'],
    key: String(held.key),
    label: String(held.label),
    value: held.value as MemFact['value'],
    aboutId: String(held.aboutId),
    recordedAt: String(held.recordedAt),
    source: String(held.source),
    ...text,
    ...(typeof held.stands === 'boolean' ? { stands: held.stands } : {}),
    ...(held.page === null || held.page === undefined ? {} : { page: Number(held.page) }),
    ...(past.length ? { was: past } : {}),
  };
}

function entryOf(row: Row): MemEntry {
  const text = (key: string): string | undefined => {
    const value = row.get(key);
    return typeof value === 'string' && value ? value : undefined;
  };
  const place: MemPlace = {};
  for (const key of ['pane', 'department', 'fn', 'stage'] as const) {
    const word = text(key);
    if (word) place[key] = word;
  }
  const key = text('key');
  const label = text('label');
  const about = row.get('about');
  return {
    id: String(row.get('id')),
    kind: String(row.get('kind')) as MemEntry['kind'],
    at: String(row.get('at')),
    by: String(row.get('by')),
    sourceId: String(row.get('sourceId')),
    about: Array.isArray(about) ? about.map(String) : [],
    ...(key ? { key } : {}),
    ...(label ? { label } : {}),
    ...(Object.keys(place).length ? { place } : {}),
  };
}

export const neo4jMemory: MemoryPort = {
  kind: 'neo4j',

  async watermarks(projectIds): Promise<Map<string, MemWatermark>> {
    const found = new Map<string, MemWatermark>();
    if (projectIds.length === 0) return found;
    const session = openSession();
    try {
      const result = await session.executeRead((tx) => tx.run(WATERMARKS, { ids: projectIds.map(memProjectId) }), { timeout: READ_TIMEOUT_MS });
      for (const row of result.records) found.set(String(row.get('projectId')), watermarkOf(row));
      return found;
    } finally {
      await session.close();
    }
  },

  async write(batch: MemBatch): Promise<MemWriteAnswer> {
    await ensureSchema();
    const session = openSession();
    try {
      return await session.executeWrite(async (tx): Promise<MemWriteAnswer> => {
        const id = memProjectId(batch.projectId);
        const at = new Date().toISOString();
        const claim = await tx.run(CLAIM, { id, projectId: batch.projectId, tenantId: batch.tenantId, at });
        const row = claim.records[0];
        if (!row) throw new Error(`the memory of ${batch.projectId} did not answer`);
        const held = watermarkOf(row);
        const schema = batch.through.schema ?? 0;
        const ruling = shapeRule(held, { schema, live: batch.live });
        if (typeof ruling === 'object') throw new TurnedAway(ruling);
        const stands = ruling === 'carry-on' ? held : {};
        if (
          (stands.auditThrough ?? '') !== (batch.from.auditThrough ?? '') ||
          (stands.turnThrough ?? '') !== (batch.from.turnThrough ?? '') ||
          (stands.factsRev ?? '') !== (batch.from.factsRev ?? '')
        ) {
          throw new TurnedAway({ moved: held });
        }
        // Starting over: what memory was told from the record goes, whichever shape made it, and the project's own node is made again.
        if (ruling === 'start-over') {
          for (const statement of START_OVER) await tx.run(statement, { projectId: batch.projectId });
          await tx.run(RESET, { id });
        }
        if (batch.forget?.length) await tx.run(FORGET, { projectId: batch.projectId, kinds: batch.forget });
        const changes = ownFacts(batch);
        if (changes.drop.length) await tx.run(DROP_FACTS, { projectId: batch.projectId, ids: changes.drop });
        const entries = ownEntries(batch);
        await tx.run(WRITE, {
          id,
          projectId: batch.projectId,
          tenantId: batch.tenantId,
          at,
          schema,
          live: batch.live ? true : null,
          auditThrough: batch.through.auditThrough ?? null,
          turnThrough: batch.through.turnThrough ?? null,
          factsRev: batch.through.factsRev ?? null,
          entries: entries.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            at: entry.at,
            by: entry.by,
            sourceId: entry.sourceId,
            about: entry.about,
            key: entry.key ?? null,
            label: entry.label ?? null,
            pane: entry.place?.pane ?? null,
            department: entry.place?.department ?? null,
            fn: entry.place?.fn ?? null,
            stage: entry.place?.stage ?? null,
          })),
        });
        if (changes.put.length) {
          await tx.run(PUT_FACTS, { projectId: batch.projectId, tenantId: batch.tenantId, facts: changes.put.map(factProperties) });
        }
        return { written: entries.length };
      }, { timeout: WRITE_TIMEOUT_MS });
    } catch (err) {
      if (err instanceof TurnedAway) return err.answer;
      // Not a failure of the store: it answered, and the answer is that it is full.
      if (outOfRoom(err)) return { full: (err as Error).message };
      throw err;
    } finally {
      await session.close();
    }
  },

  async entries(projectId, limit): Promise<MemEntry[]> {
    const session = openSession();
    try {
      const result = await session.executeRead((tx) => tx.run(ENTRIES, { projectId, limit }), { timeout: READ_TIMEOUT_MS });
      return result.records.map(entryOf);
    } finally {
      await session.close();
    }
  },

  async count(projectId): Promise<MemCount> {
    const session = openSession();
    try {
      return await session.executeRead(async (tx) => {
        const nodes = async (query: string): Promise<number> => Number((await tx.run(query, { projectId })).records[0]?.get('nodes') ?? 0);
        let project = 0;
        for (const label of MEM_LABELS) project += await nodes(`MATCH (n:${label} { projectId: $projectId }) RETURN count(n) AS nodes`);
        return { project, database: await nodes(EVERY_NODE) };
      }, { timeout: READ_TIMEOUT_MS });
    } finally {
      await session.close();
    }
  },

  async factIndex(projectId): Promise<Map<string, string>> {
    const session = openSession();
    try {
      const result = await session.executeRead((tx) => tx.run(FACT_INDEX, { projectId }), { timeout: READ_TIMEOUT_MS });
      return new Map(result.records.map((row) => [String(row.get('id')), String(row.get('rev') ?? '')]));
    } finally {
      await session.close();
    }
  },

  async factsOf(projectId): Promise<MemFact[]> {
    const session = openSession();
    try {
      const result = await session.executeRead((tx) => tx.run(FACTS, { projectId }), { timeout: READ_TIMEOUT_MS });
      return result.records.map((row) => factOf(row.get('fact') as Record<string, unknown>));
    } finally {
      await session.close();
    }
  },

  async factsNear(projectId, near): Promise<{ held: MemFact[]; stands?: MemWatermark }> {
    const session = openSession();
    try {
      return await session.executeRead(async (tx) => {
        const stands = (await tx.run(WATERMARKS, { ids: [memProjectId(projectId)] })).records[0];
        const found = await tx.run(FACTS_NEAR, { projectId, aboutIds: near.aboutIds, fns: near.fns, departments: near.departments, keys: near.keys });
        return { held: found.records.map((row) => factOf(row.get('fact') as Record<string, unknown>)), ...(stands ? { stands: watermarkOf(stands) } : {}) };
      }, { timeout: READ_TIMEOUT_MS });
    } finally {
      await session.close();
    }
  },

  async think(batch): Promise<MemWriteAnswer> {
    await ensureSchema();
    const session = openSession();
    try {
      return await session.executeWrite(async (tx): Promise<MemWriteAnswer> => {
        const at = new Date().toISOString();
        const claim = await tx.run(CLAIM, { id: memProjectId(batch.projectId), projectId: batch.projectId, tenantId: batch.tenantId, at });
        const row = claim.records[0];
        if (!row) throw new Error(`the memory of ${batch.projectId} did not answer`);
        // A writer that may not write this memory adds no note to it. One that would start it over may: a start-over leaves notes.
        const ruling = shapeRule(watermarkOf(row), { schema: batch.schema, live: batch.live });
        if (typeof ruling === 'object') throw new TurnedAway(ruling);
        const thought = ownThought(batch);
        if (!thought) throw new TurnedAway({ written: 0 });
        await tx.run(OFF_ITS_PAGE, { id: thought.id });
        await tx.run(PUT_THOUGHT, {
          projectId: batch.projectId,
          tenantId: batch.tenantId,
          pageId: memPageId(batch.projectId, thought.aboutId),
          aboutId: thought.aboutId,
          id: thought.id,
          thought: factProperties(thought),
        });
        await tx.run(TRIM_THOUGHTS, { projectId: batch.projectId, keep: Math.max(1, batch.keep) });
        await tx.run(EMPTY_PAGES, { projectId: batch.projectId });
        return { written: 1 };
      }, { timeout: WRITE_TIMEOUT_MS });
    } catch (err) {
      if (err instanceof TurnedAway) return err.answer;
      if (outOfRoom(err)) return { full: (err as Error).message };
      throw err;
    } finally {
      await session.close();
    }
  },

  async pagesOf(projectId): Promise<MemPage[]> {
    const session = openSession();
    try {
      const result = await session.executeRead((tx) => tx.run(PAGES, { projectId }), { timeout: READ_TIMEOUT_MS });
      return result.records.map((row) => ({ id: String(row.get('id')), aboutId: String(row.get('aboutId')), updatedAt: String(row.get('updatedAt')), notes: Number(row.get('notes') ?? 0) }));
    } finally {
      await session.close();
    }
  },

  async purge(projectId): Promise<void> {
    const session = openSession();
    try {
      await session.executeWrite(async (tx) => {
        // The project's own node first: deleting it waits for a write of this
        // project's memory that is still open, and then removes what it wrote.
        for (const label of MEM_LABELS) await tx.run(`MATCH (n:${label} { projectId: $projectId }) DETACH DELETE n`, { projectId });
      }, { timeout: WRITE_TIMEOUT_MS });
    } finally {
      await session.close();
    }
  },

  async projects(): Promise<Array<{ projectId: string; tenantId: string }>> {
    const session = openSession();
    try {
      const result = await session.executeRead((tx) => tx.run(PROJECTS), { timeout: READ_TIMEOUT_MS });
      return result.records.map((row) => ({ projectId: String(row.get('projectId')), tenantId: String(row.get('tenantId') ?? '') }));
    } finally {
      await session.close();
    }
  },
};
