/**
 * What the project's memory asks of Neo4j, and in what order.
 *
 * Memory is kept in the database the graph is in, under labels of its own.
 * The live site runs a build that knows only the graph, against the same
 * database, so the first thing pinned here is that no statement of memory's
 * names the graph's label, its relationship or its marker, and that none
 * draws a relationship at all. The rest is what makes a write safe when
 * several instances make it: the project's memory node is taken first and
 * locked before it is read, the entries and the watermark go in the same
 * transaction or not at all, nothing is written when memory stands elsewhere,
 * in a later shape, or in an earlier one this deployment may not raise, and
 * an entry found is never changed, so no write can give a node to another
 * project. The entries of chat turns are let go only by a write that says
 * so, before its own entries, in its own transaction. A database with no
 * room answers that, and is not taken for one that failed. Every read has a
 * time after which the database ends it.
 *
 * Nothing here reaches a database. The suite is forbidden one (see
 * `no-ambient-credentials.ts`), so the store is handed a driver whose
 * sessions record every statement and its parameters and answer as each test
 * says. That proves the order, the parameters and the shape of the
 * statements. It cannot prove what a statement does: that is Cypher, and only
 * a database runs it. `scripts/probe-neo4j.ts` runs the same statements
 * against one. The file store's side of the same rules is in
 * `mem-sync.test.ts`.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Driver } from 'neo4j-driver';
import { MEM_SCHEMA, type MemEntry } from '@realytica/shared';
import type { MemBatch, MemoryPort } from '../apps/api/src/graph/mem/types';

type Neo4jModule = typeof import('../apps/api/src/graph/neo4j');

const PROJECT = 'prj-memory-statements';
const TENANT = 'tnt-memory-statements';

interface Asked {
  query: string;
  params: Record<string, unknown>;
  /** Which transaction the statement ran in, counted from one. */
  transaction: number;
  kind: 'read' | 'write';
  /** What the transaction was opened with. */
  config: unknown;
}

type Row = Record<string, unknown>;

let asked: Asked[];
let transactions: number;
/** The transactions that ended with nothing written: the ones whose work threw. */
let rolledBack: number[];
/** Where the project's memory stands, as its node answers: a property never set comes back null. */
let stands: { schema: number | null; auditThrough: string | null; turnThrough: string | null };
/** What the reads answer. */
let rows: Row[];
/** Transactions still to fail before any statement of theirs runs. */
let failing: number;
/** What the database says to the statement that writes the entries, when it will not take them. */
let refusing: Error | undefined;
/** What a read answers a statement, when a test answers statements differently. */
let answering: ((query: string) => Row[]) | undefined;
let memory: MemoryPort;
let WRITE_TIMEOUT_MS: number;
let READ_TIMEOUT_MS: number;
let closeNeo4j: Neo4jModule['closeNeo4j'];

/** A driver whose every session writes down what it is asked. */
function recordingDriver(): Driver {
  const run = (kind: Asked['kind'], config: unknown) => {
    transactions += 1;
    const transaction = transactions;
    if (failing > 0) {
      failing -= 1;
      throw new Error('the database did not answer');
    }
    return {
      run: async (query: string, params: Record<string, unknown> = {}) => {
        asked.push({ query, params, transaction, kind, config });
        if (refusing && /UNWIND \$entries/.test(query)) throw refusing;
        const answers = /RETURN m\.schema AS schema/.test(query) && kind === 'write' ? [stands] : kind === 'read' ? (answering?.(query) ?? rows) : [];
        return { records: answers.map((row) => ({ get: (key: string) => (row as Row)[key] })) };
      },
    };
  };
  type Work<T> = (tx: { run: (query: string, params?: Record<string, unknown>) => Promise<unknown> }) => Promise<T>;
  const session = {
    async executeWrite<T>(work: Work<T>, config?: unknown): Promise<T> {
      const tx = run('write', config);
      const transaction = transactions;
      try {
        return await work(tx);
      } catch (err) {
        // A database ends a transaction whose work throws with nothing of it written.
        rolledBack.push(transaction);
        throw err;
      }
    },
    async executeRead<T>(work: Work<T>, config?: unknown): Promise<T> {
      return work(run('read', config));
    },
    async close(): Promise<void> {},
  };
  return { session: () => session, close: async () => {} } as unknown as Driver;
}

function entry(sourceId: string, more: Partial<MemEntry> = {}): MemEntry {
  return { id: `${PROJECT}::mem::${sourceId}`, kind: 'finding_raised', at: '2026-10-05T10:00:00.000Z', by: 'who_0123456789abcd', sourceId, about: ['fnd_1'], ...more };
}

function batch(more: Partial<MemBatch> = {}): MemBatch {
  return {
    projectId: PROJECT,
    tenantId: TENANT,
    from: { schema: MEM_SCHEMA, auditThrough: 'aud_1' },
    through: { schema: MEM_SCHEMA, auditThrough: 'aud_3' },
    entries: [
      entry('aud_2', { kind: 'value_accepted', key: 'extent_khata', label: 'Extent per khata', about: ['ev_1'] }),
      entry('aud_3', { kind: 'chat_asked', place: { pane: 'evidence', stage: 'pre_development' }, about: [] }),
    ],
    mayRaise: true,
    ...more,
  };
}

/** The statements of the transactions that wrote data, leaving out the one that makes the constraints. */
const written = (): Asked[] => asked.filter((statement) => statement.kind === 'write' && !/^CREATE /.test(statement.query.trim()));
const schema = (): Asked[] => asked.filter((statement) => /^CREATE /.test(statement.query.trim()));

before(async () => {
  const neo4j = await import('../apps/api/src/graph/neo4j');
  ({ closeNeo4j, WRITE_TIMEOUT_MS } = neo4j);
  // No address is configured, so a store left without this driver has nowhere to dial and throws.
  neo4j.useNeo4jDriver(recordingDriver());
  ({ neo4jMemory: memory, READ_TIMEOUT_MS } = await import('../apps/api/src/graph/mem/neo4j'));
});

beforeEach(() => {
  asked = [];
  transactions = 0;
  rolledBack = [];
  failing = 0;
  refusing = undefined;
  answering = undefined;
  rows = [];
  stands = { schema: MEM_SCHEMA, auditThrough: 'aud_1', turnThrough: null };
});

after(async () => {
  await closeNeo4j();
});

// First in the file: the constraints are made once a process, before its first write.
describe('the memory’s own constraints', () => {
  it('are made before the first write and not again, and a write that could not make them leaves the next to try', async () => {
    failing = 1;
    await assert.rejects(memory.write(batch()), /did not answer/);
    assert.deepEqual(asked, [], 'nothing was written without them');

    await memory.write(batch());
    await memory.write(batch());
    const made = schema();
    assert.deepEqual(
      made.map((statement) => statement.query),
      [
        'CREATE CONSTRAINT mem_project_id IF NOT EXISTS FOR (m:MemProject) REQUIRE m.id IS UNIQUE',
        'CREATE CONSTRAINT mem_entry_id IF NOT EXISTS FOR (e:MemEntry) REQUIRE e.id IS UNIQUE',
        'CREATE INDEX mem_entry_project IF NOT EXISTS FOR (e:MemEntry) ON (e.projectId)',
      ],
      'an id is unique for its label, which is what makes a merge find a node instead of making a second',
    );
    assert.equal(new Set(made.map((statement) => statement.transaction)).size, 1, 'in a transaction of their own');
    assert.ok(made[0]!.transaction < written()[0]!.transaction, 'before the first write');
    assert.equal(new Set(written().map((statement) => statement.transaction)).size, 2, 'and the second write made none');
  });
});

describe('a write to the project’s memory', () => {
  it('takes the project’s memory node first and writes the entries and the watermark in the same transaction', async () => {
    assert.deepEqual(await memory.write(batch()), { written: 2 });
    assert.deepEqual(rolledBack, []);

    const [claim, write, ...rest] = written();
    assert.deepEqual(rest, [], 'two statements');
    assert.equal(claim!.transaction, write!.transaction, 'in one transaction, so the watermark never moves without its entries');
    assert.deepEqual(claim!.config, { timeout: WRITE_TIMEOUT_MS });
    assert.match(claim!.query, /MERGE \(m:MemProject \{ id: \$id \}\)/);
    assert.equal(claim!.params.id, `${PROJECT}::mem`, 'an id that begins with the project’s');
    assert.equal(claim!.params.projectId, PROJECT);
    assert.equal(claim!.params.tenantId, TENANT);

    assert.match(write!.query, /MATCH \(m:MemProject \{ id: \$id \}\)\s+SET m\.schema = \$schema, m\.auditThrough = \$auditThrough, m\.turnThrough = \$turnThrough/);
    assert.match(write!.query, /UNWIND \$entries AS entry\s+MERGE \(e:MemEntry \{ id: entry\.id \}\)/);
    assert.ok(write!.query.indexOf('SET m.schema') < write!.query.indexOf('UNWIND'), 'the watermark moves even when there is no entry to write');
    for (const property of Object.keys((write!.params.entries as Array<Record<string, unknown>>)[0]!).filter((name) => name !== 'id')) {
      assert.ok(write!.query.includes(`e.${property} = entry.${property}`), `an entry’s ${property} is stored`);
    }
    const { at, ...params } = write!.params;
    assert.equal(typeof at, 'string');
    assert.deepEqual(params, {
      id: `${PROJECT}::mem`,
      projectId: PROJECT,
      tenantId: TENANT,
      schema: MEM_SCHEMA,
      auditThrough: 'aud_3',
      turnThrough: null,
      entries: [
        { id: `${PROJECT}::mem::aud_2`, kind: 'value_accepted', at: '2026-10-05T10:00:00.000Z', by: 'who_0123456789abcd', sourceId: 'aud_2', about: ['ev_1'], key: 'extent_khata', label: 'Extent per khata', pane: null, department: null, fn: null, stage: null },
        { id: `${PROJECT}::mem::aud_3`, kind: 'chat_asked', at: '2026-10-05T10:00:00.000Z', by: 'who_0123456789abcd', sourceId: 'aud_3', about: [], key: null, label: null, pane: 'evidence', department: null, fn: null, stage: 'pre_development' },
      ],
    });
  });

  it('lets go of the entries of the kinds a write names, before its own entries and in the same transaction', async () => {
    assert.deepEqual(await memory.write(batch({ forget: ['chat_asked', 'chat_answered'] })), { written: 2 });
    const [claim, forget, write, ...rest] = written();
    assert.deepEqual(rest, []);
    assert.equal(forget!.query, 'MATCH (e:MemEntry { projectId: $projectId }) WHERE e.kind IN $kinds DETACH DELETE e');
    assert.deepEqual(forget!.params, { projectId: PROJECT, kinds: ['chat_asked', 'chat_answered'] }, 'this project’s, of those kinds, and no other entry');
    assert.match(write!.query, /MERGE \(e:MemEntry \{ id: entry\.id \}\)/, 'a turn the record still holds is written again after');
    assert.equal(new Set([claim!.transaction, forget!.transaction, write!.transaction]).size, 1);

    asked = [];
    await memory.write(batch({ forget: [] }));
    assert.equal(written().length, 2, 'a write that names none lets go of nothing');
  });

  it('locks the node before it reads where memory stands', async () => {
    await memory.write(batch());
    // A write takes the node's lock; a read does not. Two writers of one
    // project's memory that both read first would both find it where they believed.
    const claim = written()[0]!.query;
    const locks = claim.indexOf('SET m.asked = $at');
    const reads = claim.indexOf('RETURN m.schema AS schema');
    assert.ok(locks > 0 && reads > locks, 'the write comes first in the statement');
  });

  it('sets a node’s project and workspace when it makes the node and never when it finds one', async () => {
    await memory.write(batch());
    const [claim, write] = written();
    for (const { query } of [claim!, write!]) {
      assert.doesNotMatch(query, /ON MATCH/, 'nothing is set because a node was found');
      // Every place a node's project or workspace is assigned is inside an ON CREATE clause.
      const assigned = [...query.matchAll(/\b[me]\.(?:projectId|tenantId) = /g)].map((match) => match.index!);
      assert.ok(assigned.length > 0);
      for (const at of assigned) {
        const clause = query.lastIndexOf('SET', at);
        assert.equal(query.slice(clause - 'ON CREATE '.length, clause), 'ON CREATE ', 'a write cannot move a node to another project');
      }
    }
    // And an entry is an event: every property it has is set when it is made, and none after.
    const entrySets = [...write!.query.matchAll(/\be\.[a-zA-Z]+ = /g)].map((match) => match.index!);
    assert.ok(entrySets.every((at) => at > write!.query.indexOf('ON CREATE SET e.projectId')), 'an entry found is left as it was first told');
    assert.equal(write!.query.indexOf('SET', write!.query.indexOf('ON CREATE SET e.projectId') + 'ON CREATE SET'.length), -1, 'and no SET follows the one that makes it');
  });

  it('writes nothing when memory stands somewhere other than the writer believed, and says where', async () => {
    stands = { schema: MEM_SCHEMA, auditThrough: 'aud_9', turnThrough: 'cht_4' };
    assert.deepEqual(await memory.write(batch({ forget: ['chat_asked'] })), { moved: { schema: MEM_SCHEMA, auditThrough: 'aud_9', turnThrough: 'cht_4' } });
    assert.equal(written().length, 1, 'the node was taken and nothing was written or let go of');
    assert.deepEqual(rolledBack, [written()[0]!.transaction], 'and the transaction was ended with nothing of it kept, not even a node it made to take');

    asked = [];
    stands = { schema: MEM_SCHEMA, auditThrough: 'aud_1', turnThrough: 'cht_4' };
    assert.deepEqual(await memory.write(batch()), { moved: { schema: MEM_SCHEMA, auditThrough: 'aud_1', turnThrough: 'cht_4' } }, 'the chat’s watermark counts as the audit’s does');
    assert.equal(written().length, 1);
  });

  it('writes nothing over a memory in a later shape, and says which', async () => {
    stands = { schema: MEM_SCHEMA + 1, auditThrough: 'aud_1', turnThrough: null };
    assert.deepEqual(await memory.write(batch()), { newer: MEM_SCHEMA + 1 });
    assert.equal(written().length, 1);
    assert.equal(rolledBack.length, 1);
  });

  it('writes nothing in a later shape over an earlier one, unless the deployment is one that may raise it', async () => {
    const later = { schema: MEM_SCHEMA + 1, auditThrough: 'aud_3' };
    stands = { schema: MEM_SCHEMA, auditThrough: 'aud_1', turnThrough: null };
    assert.deepEqual(await memory.write(batch({ from: {}, through: later, mayRaise: false, forget: ['chat_asked'] })), { lower: MEM_SCHEMA });
    assert.equal(written().length, 1, 'a preview takes the node, reads the shape it holds, and writes nothing');
    assert.equal(rolledBack.length, 1, 'nothing at all: the transaction is ended unwritten');

    asked = [];
    stands = { schema: null, auditThrough: null, turnThrough: null };
    assert.deepEqual(await memory.write(batch({ from: {}, through: later, mayRaise: false })), { lower: 0 }, 'nor does it write a later shape where nothing is written yet');
    assert.equal(written().length, 1);

    asked = [];
    assert.deepEqual(await memory.write(batch({ from: {}, mayRaise: false })), { written: 2 }, 'the first shape it may write first');

    asked = [];
    stands = { schema: MEM_SCHEMA, auditThrough: 'aud_1', turnThrough: null };
    assert.deepEqual(await memory.write(batch({ from: {}, through: later, mayRaise: true })), { written: 2 }, 'the live site raises');
    assert.equal(written()[1]!.params.schema, MEM_SCHEMA + 1);
  });

  it('takes a memory never written, or written in an earlier shape, as standing nowhere', async () => {
    stands = { schema: null, auditThrough: null, turnThrough: null };
    assert.deepEqual(await memory.write(batch({ from: {} })), { written: 2 });

    asked = [];
    stands = { schema: MEM_SCHEMA - 1, auditThrough: 'aud_7', turnThrough: null };
    assert.deepEqual(await memory.write(batch({ from: {} })), { written: 2 }, 'the whole record is told again in this shape');
    assert.equal(written()[1]!.params.schema, MEM_SCHEMA);
  });

  it('writes no entry under an id that begins with another project’s', async () => {
    const foreign = { ...entry('aud_9'), id: 'prj-another::mem::aud_9' };
    assert.deepEqual(await memory.write(batch({ entries: [entry('aud_2'), foreign] })), { written: 1 });
    assert.deepEqual((written()[1]!.params.entries as Array<{ id: string }>).map((row) => row.id), [`${PROJECT}::mem::aud_2`]);
  });

  it('fails as a whole when the database fails, and leaves nothing half done to the caller', async () => {
    failing = 1;
    await assert.rejects(memory.write(batch()), /did not answer/);
    assert.deepEqual(written(), []);
  });

  it('answers that the database has no room, in its words, and does not take that for a failure', async () => {
    refusing = new Error('You have exceeded the logical size limit of 200000 nodes in your database (attempt to add 2 nodes would reach 200001 nodes). Please consider upgrading to the next tier.');
    assert.deepEqual(await memory.write(batch()), { full: refusing.message });

    // Anything else the database says to the same statement is a failure, as before.
    refusing = new Error('The transaction has been terminated.');
    await assert.rejects(memory.write(batch()), /terminated/);
  });
});

describe('removing a project’s memory', () => {
  it('removes every node memory has or is to have, by the project’s id, in one transaction', async () => {
    await memory.purge(PROJECT);
    assert.deepEqual(
      asked.map((statement) => statement.query),
      ['MemProject', 'MemEntry', 'MemFact', 'MemPage'].map((label) => `MATCH (n:${label} { projectId: $projectId }) DETACH DELETE n`),
      'the project’s own node first, so a write still open is waited for and what it wrote goes too',
    );
    assert.ok(asked.every((statement) => statement.transaction === 1 && statement.kind === 'write'));
    assert.ok(asked.every((statement) => statement.params.projectId === PROJECT));
    assert.deepEqual(asked[0]!.config, { timeout: WRITE_TIMEOUT_MS });
  });
});

describe('reading memory', () => {
  it('reads a project’s entries newest first, as many as were asked for', async () => {
    rows = [
      { id: `${PROJECT}::mem::aud_3`, kind: 'chat_asked', at: '2026-10-05T11:00:00.000Z', by: 'who_0123456789abcd', sourceId: 'aud_3', about: [], label: null, pane: 'evidence', department: null, fn: null, stage: 'pre_development' },
      { id: `${PROJECT}::mem::aud_2`, kind: 'value_accepted', at: '2026-10-05T10:00:00.000Z', by: 'who_0123456789abcd', sourceId: 'aud_2', about: ['ev_1'], key: 'extent_khata', label: 'Extent per khata', pane: null, department: null, fn: null, stage: null },
    ];
    assert.deepEqual(await memory.entries(PROJECT, 25), [
      { id: `${PROJECT}::mem::aud_3`, kind: 'chat_asked', at: '2026-10-05T11:00:00.000Z', by: 'who_0123456789abcd', sourceId: 'aud_3', about: [], place: { pane: 'evidence', stage: 'pre_development' } },
      { id: `${PROJECT}::mem::aud_2`, kind: 'value_accepted', at: '2026-10-05T10:00:00.000Z', by: 'who_0123456789abcd', sourceId: 'aud_2', about: ['ev_1'], key: 'extent_khata', label: 'Extent per khata' },
    ]);
    const [read] = asked;
    assert.equal(read!.kind, 'read');
    assert.match(read!.query, /MATCH \(e:MemEntry \{ projectId: \$projectId \}\)/);
    assert.match(read!.query, /ORDER BY e\.at DESC, e\.id DESC\s+LIMIT toInteger\(\$limit\)/);
    assert.deepEqual(read!.params, { projectId: PROJECT, limit: 25 });
  });

  it('reads where the memory of several projects stands in one statement, and leaves out one never written', async () => {
    rows = [{ projectId: PROJECT, schema: MEM_SCHEMA, auditThrough: 'aud_3', turnThrough: null }];
    const found = await memory.watermarks([PROJECT, 'prj-never-told']);
    assert.deepEqual([...found], [[PROJECT, { schema: MEM_SCHEMA, auditThrough: 'aud_3' }]]);
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0]!.params, { ids: [`${PROJECT}::mem`, 'prj-never-told::mem'] });

    asked = [];
    assert.deepEqual([...(await memory.watermarks([]))], []);
    assert.deepEqual(asked, [], 'and asks nothing about no projects');
  });

  it('lists every project that has memory, with the workspace it was written under', async () => {
    rows = [{ projectId: PROJECT, tenantId: TENANT }, { projectId: 'prj-old', tenantId: null }];
    assert.deepEqual(await memory.projects(), [{ projectId: PROJECT, tenantId: TENANT }, { projectId: 'prj-old', tenantId: '' }]);
  });

  it('counts the nodes of a project’s memory, and every node the database holds', async () => {
    answering = (query) => [{ nodes: /MemProject/.test(query) ? 1 : /MemEntry/.test(query) ? 41 : /^MATCH \(n\) /.test(query) ? 9000 : 0 }];
    assert.deepEqual(await memory.count(PROJECT), { project: 42, database: 9000 });
    assert.deepEqual(
      asked.map((statement) => statement.query),
      [
        ...['MemProject', 'MemEntry', 'MemFact', 'MemPage'].map((label) => `MATCH (n:${label} { projectId: $projectId }) RETURN count(n) AS nodes`),
        'MATCH (n) RETURN count(n) AS nodes',
      ],
      'every label memory has or is to have, and then every node there is: the graph’s count against the same allowance',
    );
    assert.ok(asked.every((statement) => statement.kind === 'read' && statement.transaction === 1));
  });

  it('gives every read a time after which the database ends it', async () => {
    await memory.entries(PROJECT, 10);
    await memory.watermarks([PROJECT]);
    await memory.projects();
    await memory.count(PROJECT);
    assert.equal(transactions, 4);
    assert.ok(asked.every((statement) => statement.kind === 'read'));
    for (const statement of asked) assert.deepEqual(statement.config, { timeout: READ_TIMEOUT_MS });
    assert.ok(READ_TIMEOUT_MS > 0 && READ_TIMEOUT_MS <= WRITE_TIMEOUT_MS);
  });
});

describe('every statement memory asks', () => {
  it('names neither the graph’s label, its relationship nor its marker, and draws no relationship', async () => {
    await memory.write(batch({ forget: ['chat_asked', 'chat_answered'] }));
    await memory.purge(PROJECT);
    await memory.entries(PROJECT, 10);
    await memory.watermarks([PROJECT]);
    await memory.projects();
    await memory.count(PROJECT);
    assert.ok(asked.length >= 14);
    for (const { query, kind } of asked) {
      assert.doesNotMatch(query, /Ryt|RYT_EDGE|GraphSync/, 'the graph is not memory’s to touch');
      assert.doesNotMatch(query, /-\[|\]-|-->|<--|--\(/, 'an entry points at the record by ids it holds, not by a relationship a redraw could take away');
      // Every node a statement matches or makes is one of memory's own.
      const labels = [...query.matchAll(/\((?:[a-z]+)?:([A-Za-z]+)/g)].map((match) => match[1]!);
      for (const label of labels) assert.match(label, /^Mem(Project|Entry|Fact|Page)$/);
      // But for one, which names no node and changes none: the count of every node there is.
      if (labels.length === 0) assert.deepEqual([query, kind], ['MATCH (n) RETURN count(n) AS nodes', 'read']);
    }
  });
});
