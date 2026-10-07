/**
 * What the project's memory asks of Neo4j, and in what order.
 *
 * Memory is kept in the database the graph is in, under labels of its own.
 * The live site runs a build that knows only the graph, against the same
 * database, so the first thing pinned here is that no statement of memory's
 * names the graph's label, its relationship or its marker, and that the one
 * relationship drawn is memory's own, from a note of the assistant's to the
 * page it is on. The rest is what makes a write safe when
 * several instances make it: the project's memory node is taken first and
 * locked before it is read, the entries and the watermark go in the same
 * transaction or not at all, nothing is written when memory stands elsewhere
 * or in a shape the writer may not write over, and an entry found is never
 * changed, so no write can give a node to another project. A write that
 * starts a project's memory over lets go of every node memory keeps for it
 * and makes its own node again, before its entries and in its transaction.
 * The mark that says the live site wrote a project's memory is set by the
 * live site's write and by no other. The entries of chat turns are let go
 * only by a write that says so, before its own entries, in its own
 * transaction. A database with no room answers that, and is not taken for
 * one that failed. Every read has a time after which the database ends it.
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
import { MEM_SCHEMA, memFactRev, type MemEntry, type MemFact } from '@realytica/shared';
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
let stands: { schema: number | null; auditThrough: string | null; turnThrough: string | null; live?: boolean | null; factsRev?: string | null };
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
    live: false,
    ...more,
  };
}

/** What a write that starts a project's memory over asks, after it has taken the node and before it writes: the entries, and the facts told from the record. */
const LET_GO = ['MATCH (n:MemEntry { projectId: $projectId }) DETACH DELETE n', "MATCH (n:MemFact { projectId: $projectId }) WHERE n.tag <> 'thought' DETACH DELETE n"];
const MADE_AGAIN = 'MATCH (m:MemProject { id: $id }) SET m = { id: m.id, projectId: m.projectId, tenantId: m.tenantId }';

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
        'CREATE CONSTRAINT mem_fact_id IF NOT EXISTS FOR (f:MemFact) REQUIRE f.id IS UNIQUE',
        'CREATE INDEX mem_fact_project IF NOT EXISTS FOR (f:MemFact) ON (f.projectId)',
        'CREATE CONSTRAINT mem_page_id IF NOT EXISTS FOR (p:MemPage) REQUIRE p.id IS UNIQUE',
        'CREATE INDEX mem_page_project IF NOT EXISTS FOR (p:MemPage) ON (p.projectId)',
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

    assert.match(claim!.query, /RETURN m\.schema AS schema, m\.auditThrough AS auditThrough, m\.turnThrough AS turnThrough, m\.live AS live/, 'it reads the shape, the place and whose memory it is');
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
      live: null,
      auditThrough: 'aud_3',
      turnThrough: null,
      factsRev: null,
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

    // Nor does the live site over a later shape it wrote itself: that is a later live build's.
    asked = [];
    stands = { schema: MEM_SCHEMA + 1, auditThrough: 'aud_1', turnThrough: null, live: true };
    assert.deepEqual(await memory.write(batch({ live: true })), { newer: MEM_SCHEMA + 1 });
    assert.equal(written().length, 1);
  });

  it('writes nothing in a later shape over what the live site wrote, unless the writer is the live site', async () => {
    const later = { schema: MEM_SCHEMA + 1, auditThrough: 'aud_3' };
    stands = { schema: MEM_SCHEMA, auditThrough: 'aud_1', turnThrough: null, live: true };
    assert.deepEqual(await memory.write(batch({ from: {}, through: later, forget: ['chat_asked'] })), { lower: MEM_SCHEMA });
    assert.equal(written().length, 1, 'a preview takes the node, reads the shape it holds, and writes nothing');
    assert.equal(rolledBack.length, 1, 'nothing at all: the transaction is ended unwritten');

    asked = [];
    assert.deepEqual(await memory.write(batch({ from: {}, through: later, live: true })), { written: 2 }, 'the live site raises its own');
    assert.equal(written().at(-1)!.params.schema, MEM_SCHEMA + 1);
    assert.deepEqual(rolledBack.length, 1, 'and nothing more was turned away');
  });

  it('starts a memory over by letting go of every node kept for the project and making its own again, before it writes', async () => {
    // Written by a preview in an earlier shape. Another preview raises it.
    stands = { schema: MEM_SCHEMA - 1, auditThrough: 'aud_7', turnThrough: 'cht_2' };
    assert.deepEqual(await memory.write(batch({ from: {}, forget: ['chat_asked'] })), { written: 2 }, 'the whole record is told again in this shape');
    assert.deepEqual(rolledBack, []);

    const statements = written();
    assert.deepEqual(
      statements.slice(1, -1).map((statement) => statement.query),
      [...LET_GO, MADE_AGAIN, 'MATCH (e:MemEntry { projectId: $projectId }) WHERE e.kind IN $kinds DETACH DELETE e'],
      'every label memory has or is to have but the project’s own node, then that node as it was made',
    );
    assert.equal(new Set(statements.map((statement) => statement.transaction)).size, 1, 'in the transaction that writes the entries, so memory is never seen empty');
    for (const statement of statements.slice(1, 3)) assert.deepEqual(statement.params, { projectId: PROJECT }, 'this project’s and no other’s');
    assert.deepEqual(statements[3]!.params, { id: `${PROJECT}::mem` });
    assert.ok(statements.slice(1, 3).every((statement) => !/MemPage/.test(statement.query)) && /tag <> 'thought'/.test(statements[2]!.query), 'the assistant’s own notes, which nothing can tell again, are left');
    assert.doesNotMatch(MADE_AGAIN, /\$projectId|\$tenantId/, 'the node keeps the project and the workspace it was made with: no write gives it another');
    assert.match(statements.at(-1)!.query, /MERGE \(e:MemEntry \{ id: entry\.id \}\)/, 'an entry the record still tells is made again after, as this build tells it');
    assert.equal(statements.at(-1)!.params.schema, MEM_SCHEMA);
  });

  it('starts over a memory never written, which stands nowhere', async () => {
    stands = { schema: null, auditThrough: null, turnThrough: null, live: null };
    assert.deepEqual(await memory.write(batch({ from: {} })), { written: 2 });
    assert.deepEqual(written().slice(1, -1).map((statement) => statement.query), [...LET_GO, MADE_AGAIN]);
  });

  it('lets go of nothing when the writer that is to start over believed memory stood somewhere', async () => {
    stands = { schema: MEM_SCHEMA - 1, auditThrough: 'aud_7', turnThrough: null };
    assert.deepEqual(await memory.write(batch()), { moved: { schema: MEM_SCHEMA - 1, auditThrough: 'aud_7' } }, 'for a writer that starts over, memory stands nowhere');
    assert.equal(written().length, 1);
    assert.equal(rolledBack.length, 1);
  });

  it('starts over, as the live site, whatever another deployment left: its own shape or a later one', async () => {
    for (const left of [MEM_SCHEMA, MEM_SCHEMA + 1]) {
      asked = [];
      stands = { schema: left, auditThrough: 'aud_1', turnThrough: null, live: null };
      assert.deepEqual(await memory.write(batch({ from: {}, live: true })), { written: 2 }, `the live site does not stand down for shape ${left} written by a preview`);
      const statements = written();
      assert.deepEqual(statements.slice(1, -1).map((statement) => statement.query), [...LET_GO, MADE_AGAIN], 'what the preview left is let go');
      assert.equal(statements.at(-1)!.params.schema, MEM_SCHEMA);
      assert.equal(statements.at(-1)!.params.live, true, 'and the memory is marked the live site’s');
    }
    assert.deepEqual(rolledBack, []);

    // Its own memory in its own shape it carries on, from where it stands.
    asked = [];
    stands = { schema: MEM_SCHEMA, auditThrough: 'aud_1', turnThrough: null, live: true };
    assert.deepEqual(await memory.write(batch({ live: true })), { written: 2 });
    assert.equal(written().length, 2, 'nothing is let go');
  });

  it('marks a memory the live site’s only by the live site’s write, and no write takes the mark off', async () => {
    stands = { schema: MEM_SCHEMA, auditThrough: 'aud_1', turnThrough: null, live: true };
    await memory.write(batch());
    const carried = written().at(-1)!;
    assert.match(carried.query, /m\.live = coalesce\(\$live, m\.live\)/, 'a writer that is not the live site leaves the mark as it finds it');
    assert.equal(carried.params.live, null);
    assert.deepEqual([...carried.query.matchAll(/m\.live\b/g)].length, 2, 'and the mark is set nowhere else in the statement');

    asked = [];
    await memory.write(batch({ live: true }));
    assert.equal(written().at(-1)!.params.live, true);
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

describe('the facts of a write', () => {
  const fact = (slot: string, more: Partial<MemFact> = {}): MemFact => ({
    id: `${PROJECT}::fact::${slot}`,
    tag: 'approved',
    key: 'extent_khata',
    label: 'Extent per khata',
    value: 1100.9,
    unit: 'sqm',
    aboutId: 'ev_1',
    recordedAt: '2026-10-05T10:00:00.000Z',
    source: 'ev_1',
    ...more,
  });

  it('are let go and written in the write’s own transaction, a fact found being replaced property for property', async () => {
    const kept = fact('ev_1::extent_khata::a', { by: 'who_0123456789abcd', at: '2026-10-05T10:00:00.000Z', page: 2, was: [{ at: '2026-10-05T09:00:00.000Z', what: 'accepted', by: 'who_0123456789abcd', said: '11,850 sq ft' }] });
    const foreign = fact('x', { id: 'prj-another::fact::x' });
    const thought = fact('t', { id: `${PROJECT}::thought::t`, tag: 'thought', key: 'note', label: 'Note', value: 'a note' });
    const through = { schema: MEM_SCHEMA, auditThrough: 'aud_3', factsRev: 'rev_after' };
    stands = { schema: MEM_SCHEMA, auditThrough: 'aud_1', turnThrough: null, factsRev: 'rev_before' };
    const facts = { put: [kept, foreign, thought], drop: [`${PROJECT}::fact::gone`, 'prj-another::fact::theirs'] };
    assert.deepEqual(await memory.write(batch({ from: { auditThrough: 'aud_1', factsRev: 'rev_before' }, through, factChanges: facts })), { written: 2 });

    const [claim, drop, write, put, ...rest] = written();
    assert.deepEqual(rest, []);
    assert.equal(new Set([claim!.transaction, drop!.transaction, write!.transaction, put!.transaction]).size, 1);
    assert.match(claim!.query, /m\.factsRev AS factsRev/);
    assert.equal(drop!.query, "MATCH (f:MemFact { projectId: $projectId }) WHERE f.id IN $ids AND f.tag <> 'thought' DETACH DELETE f");
    assert.deepEqual(drop!.params, { projectId: PROJECT, ids: [`${PROJECT}::fact::gone`] }, 'this project’s facts and no other’s');
    assert.match(write!.query, /m\.factsRev = \$factsRev/);
    assert.equal(write!.params.factsRev, 'rev_after', 'which facts memory holds moves with them');
    assert.match(put!.query, /UNWIND \$facts AS fact\s+MERGE \(f:MemFact \{ id: fact\.id \}\)\s+ON CREATE SET f\.projectId = \$projectId, f\.tenantId = \$tenantId\s+SET f \+= fact/);
    const rows = put!.params.facts as Array<Record<string, unknown>>;
    assert.deepEqual(rows.map((row) => row.id), [kept.id], 'a fact of another project is not written, and a note of the assistant’s has a way in of its own');
    assert.deepEqual(rows[0], {
      id: kept.id,
      tag: 'approved',
      key: 'extent_khata',
      label: 'Extent per khata',
      value: 1100.9,
      unit: 'sqm',
      display: null,
      aboutId: 'ev_1',
      department: null,
      fn: null,
      validFrom: null,
      validTo: null,
      recordedAt: '2026-10-05T10:00:00.000Z',
      by: 'who_0123456789abcd',
      at: '2026-10-05T10:00:00.000Z',
      readBy: null,
      proof: null,
      stands: null,
      source: 'ev_1',
      page: 2,
      quote: null,
      contests: null,
      was: ['{"at":"2026-10-05T09:00:00.000Z","what":"accepted","by":"who_0123456789abcd","said":"11,850 sq ft"}'],
      rev: memFactRev(kept),
    }, 'every property a fact can have, the ones it lacks as null so that a fact found loses them');
  });

  it('are not written when memory holds other facts than the writer believed', async () => {
    stands = { schema: MEM_SCHEMA, auditThrough: 'aud_1', turnThrough: null, factsRev: 'rev_somebody_else_wrote' };
    const answer = await memory.write(batch({ from: { auditThrough: 'aud_1', factsRev: 'rev_before' }, factChanges: { put: [fact('a')], drop: [] } }));
    assert.deepEqual(answer, { moved: { schema: MEM_SCHEMA, auditThrough: 'aud_1', factsRev: 'rev_somebody_else_wrote' } });
    assert.equal(written().length, 1);
  });

  it('are read back as they were written, and listed by id with each one’s digest, the assistant’s notes left out', async () => {
    const kept = fact('ev_1::extent_khata::a', { tag: 'proposed', readBy: 'model', proof: 'page_text', stands: false, page: 3, was: [{ at: '2026-10-05T09:00:00.000Z', what: 'reopened', by: 'who_0123456789abcd' }] });
    answering = (query) =>
      /RETURN f \{ \.\* \} AS fact/.test(query)
        ? [{ fact: { projectId: PROJECT, tenantId: TENANT, id: kept.id, tag: 'proposed', key: 'extent_khata', label: 'Extent per khata', value: 1100.9, unit: 'sqm', aboutId: 'ev_1', recordedAt: kept.recordedAt, readBy: 'model', proof: 'page_text', stands: false, source: 'ev_1', page: 3, was: ['{"at":"2026-10-05T09:00:00.000Z","what":"reopened","by":"who_0123456789abcd"}'], rev: 'r1' } }]
        : [{ id: kept.id, rev: 'r1' }];
    assert.deepEqual(await memory.factsOf(PROJECT), [kept]);
    assert.deepEqual([...(await memory.factIndex(PROJECT))], [[kept.id, 'r1']]);
    assert.equal(asked[1]!.query, "MATCH (f:MemFact { projectId: $projectId }) WHERE f.tag <> 'thought' RETURN f.id AS id, f.rev AS rev");
    assert.ok(asked.every((statement) => statement.kind === 'read' && statement.params.projectId === PROJECT));
  });
});

describe('a note of the assistant’s', () => {
  const thought: MemFact = { id: `${PROJECT}::thought::cht_1`, tag: 'thought', key: 'note', label: 'Note', value: 'The deed names two sellers.', aboutId: 'ev_1', recordedAt: '2026-10-05T10:00:00.000Z', source: 'cht_1' };
  const think = (more: Partial<Parameters<MemoryPort['think']>[0]> = {}) => memory.think({ projectId: PROJECT, tenantId: TENANT, thought, schema: MEM_SCHEMA, live: false, keep: 300, ...more });

  it('is written with its page in one transaction that takes the project’s node first, and the oldest beyond what is kept go with it', async () => {
    assert.deepEqual(await think(), { written: 1 });
    const [claim, off, put, trim, empty, ...rest] = written();
    assert.deepEqual(rest, []);
    assert.equal(new Set([claim, off, put, trim, empty].map((statement) => statement!.transaction)).size, 1);
    assert.match(claim!.query, /MERGE \(m:MemProject \{ id: \$id \}\)[\s\S]*SET m\.asked = \$at/, 'the node is taken, so a purge of the project waits for the note and removes it');
    assert.equal(off!.query, 'MATCH (f:MemFact { id: $id })-[r:MEM_ON]->(:MemPage) DELETE r');
    assert.match(put!.query, /MERGE \(p:MemPage \{ id: \$pageId \}\)\s+ON CREATE SET p\.projectId = \$projectId, p\.tenantId = \$tenantId, p\.aboutId = \$aboutId/);
    assert.match(put!.query, /MERGE \(f:MemFact \{ id: \$id \}\)\s+ON CREATE SET f\.projectId = \$projectId, f\.tenantId = \$tenantId\s+SET f \+= \$thought\s+MERGE \(f\)-\[:MEM_ON\]->\(p\)/);
    const { thought: stored, ...params } = put!.params as { thought: Record<string, unknown> } & Record<string, unknown>;
    assert.deepEqual(params, { projectId: PROJECT, tenantId: TENANT, pageId: `${PROJECT}::page::ev_1`, aboutId: 'ev_1', id: thought.id });
    assert.deepEqual([stored.id, stored.tag, stored.key, stored.value, stored.by, stored.stands], [thought.id, 'thought', 'note', thought.value, null, null]);
    assert.match(trim!.query, /WHERE t\.tag = 'thought'\s+WITH t ORDER BY t\.recordedAt DESC, t\.id DESC\s+SKIP toInteger\(\$keep\)\s+DETACH DELETE t/);
    assert.deepEqual(trim!.params, { projectId: PROJECT, keep: 300 });
    assert.match(empty!.query, /MATCH \(p:MemPage \{ projectId: \$projectId \}\)\s+WHERE NOT EXISTS \{ MATCH \(p\)<-\[:MEM_ON\]-\(:MemFact\) \}\s+DETACH DELETE p/);
  });

  it('is not written by a writer the shape rule turns away, nor when what is offered is no note of this project’s', async () => {
    stands = { schema: MEM_SCHEMA + 1, auditThrough: 'aud_1', turnThrough: null };
    assert.deepEqual(await think(), { newer: MEM_SCHEMA + 1 });
    stands = { schema: MEM_SCHEMA - 1, auditThrough: 'aud_1', turnThrough: null, live: true };
    assert.deepEqual(await think(), { lower: MEM_SCHEMA - 1 });
    stands = { schema: MEM_SCHEMA, auditThrough: 'aud_1', turnThrough: null };
    for (const offered of [{ ...thought, tag: 'approved' as const }, { ...thought, id: `${PROJECT}::fact::ev_1::note` }, { ...thought, id: 'prj-another::thought::cht_1' }]) {
      assert.deepEqual(await think({ thought: offered }), { written: 0 });
    }
    assert.equal(written().length, 5, 'each took the node and asked nothing more');
    assert.deepEqual(rolledBack, [...new Set(written().map((statement) => statement.transaction))], 'and ended with nothing written, not even the node it took');
  });

  it('is found by what a question is about, with where memory stands, in one read; and its pages are counted', async () => {
    answering = (query) =>
      /RETURN f \{ \.\* \} AS fact/.test(query)
        ? [{ fact: { ...thought, projectId: PROJECT, tenantId: TENANT, rev: 'r1' } }]
        : /count\(t\) AS notes/.test(query)
          ? [{ id: `${PROJECT}::page::ev_1`, aboutId: 'ev_1', updatedAt: thought.recordedAt, notes: 2 }]
          : [{ projectId: PROJECT, schema: MEM_SCHEMA, auditThrough: 'aud_3', turnThrough: null, live: null, factsRev: 'rev_1' }];
    const near = { aboutIds: ['ev_1'], fns: ['legal.title'], departments: [], keys: ['extent_khata'] };
    assert.deepEqual(await memory.factsNear(PROJECT, near), { held: [thought], stands: { schema: MEM_SCHEMA, auditThrough: 'aud_3', factsRev: 'rev_1' } });
    assert.equal(transactions, 1, 'the facts and where memory stands are one read, so they are of one moment');
    assert.match(asked[1]!.query, /WHERE f\.aboutId IN \$aboutIds OR f\.fn IN \$fns OR f\.department IN \$departments OR f\.key IN \$keys/);
    assert.deepEqual(asked[1]!.params, { projectId: PROJECT, ...near });
    assert.deepEqual(await memory.pagesOf(PROJECT), [{ id: `${PROJECT}::page::ev_1`, aboutId: 'ev_1', updatedAt: thought.recordedAt, notes: 2 }]);
    assert.ok(asked.every((statement) => statement.kind === 'read'));
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
    rows = [
      { projectId: PROJECT, schema: MEM_SCHEMA, auditThrough: 'aud_3', turnThrough: null, live: null },
      { projectId: 'prj-live-wrote', schema: MEM_SCHEMA, auditThrough: null, turnThrough: 'cht_1', live: true },
    ];
    const found = await memory.watermarks([PROJECT, 'prj-live-wrote', 'prj-never-told']);
    assert.deepEqual(
      [...found],
      [
        [PROJECT, { schema: MEM_SCHEMA, auditThrough: 'aud_3' }],
        ['prj-live-wrote', { schema: MEM_SCHEMA, turnThrough: 'cht_1', live: true }],
      ],
      'with whether the live site wrote it',
    );
    assert.equal(asked.length, 1);
    assert.match(asked[0]!.query, /m\.live AS live/);
    assert.deepEqual(asked[0]!.params, { ids: [`${PROJECT}::mem`, 'prj-live-wrote::mem', 'prj-never-told::mem'] });

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
  it('names neither the graph’s label, its relationship nor its marker, and draws no relationship but memory’s own', async () => {
    await memory.write(batch({ forget: ['chat_asked', 'chat_answered'], factChanges: { put: [], drop: [`${PROJECT}::fact::gone`] } }));
    // And a write that starts the project's memory over.
    stands = { schema: MEM_SCHEMA - 1, auditThrough: null, turnThrough: null };
    await memory.write(batch({ from: {} }));
    await memory.think({ projectId: PROJECT, tenantId: TENANT, thought: { id: `${PROJECT}::thought::cht_1`, tag: 'thought', key: 'note', label: 'Note', value: 'A note.', aboutId: 'ev_1', recordedAt: '2026-10-05T10:00:00.000Z', source: 'cht_1' }, schema: MEM_SCHEMA, live: false, keep: 300 });
    await memory.purge(PROJECT);
    await memory.entries(PROJECT, 10);
    await memory.watermarks([PROJECT]);
    await memory.projects();
    await memory.count(PROJECT);
    await memory.factIndex(PROJECT);
    await memory.factsOf(PROJECT);
    await memory.factsNear(PROJECT, { aboutIds: ['ev_1'], fns: [], departments: [], keys: [] });
    await memory.pagesOf(PROJECT);
    assert.ok(asked.length >= 30);
    for (const { query, kind } of asked) {
      assert.doesNotMatch(query, /Ryt|RYT_EDGE|GraphSync/, 'the graph is not memory’s to touch');
      // The one relationship there is joins a note to its page, and both ends are memory's.
      const joins = [...query.matchAll(/<?-\[[^\]]*\]->?/g)].map((match) => match[0]);
      for (const join of joins) assert.match(join, /^<?-\[r?:MEM_ON\]->?$/, 'an entry and a fact point at the record by ids they hold, not by a relationship a redraw could take away');
      assert.doesNotMatch(query, /-->|<--|--\(/);
      // Every node a statement matches or makes is one of memory's own.
      const labels = [...query.matchAll(/\((?:[a-z]+)?:([A-Za-z]+)/g)].map((match) => match[1]!);
      for (const label of labels) assert.match(label, /^Mem(Project|Entry|Fact|Page)$/);
      // But for one, which names no node and changes none: the count of every node there is.
      if (labels.length === 0) assert.deepEqual([query, kind], ['MATCH (n) RETURN count(n) AS nodes', 'read']);
    }
  });
});
