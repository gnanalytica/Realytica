/**
 * Does the Neo4j adapter's Cypher do what the adapter is written to ask for,
 * and how long does a sync take from here?
 *
 * The unit suite never talks to a graph store (`test/no-ambient-credentials.ts`
 * scrubs the address before every file), so what it proves about Neo4j is the
 * order, the number and the parameters of the adapter's statements, against a
 * driver that only records them. What the statements do is Cypher, and only a
 * database runs it: that a lower revision leaves the marker and the graph
 * alone, that a copy already drawn writes nothing, that two syncs of one
 * project wait for each other, that every node ends up with the labels of its
 * kind and no others, that a purge takes the marker with the graph.
 *
 * It is a CLI and not a test because it needs a live database, and it drives
 * the production adapter rather than statements of its own: a probe that
 * exercises its own Cypher proves nothing about the Cypher the app runs. Its
 * own statements are three reads, of the labels the adapter left, of how
 * many memory nodes a project has and of the properties its memory's own
 * node holds, one write of a property onto that node of its own project, and
 * the older build's statements below.
 *
 * It then does the same for the project's memory, which is kept in the same
 * database under labels of its own (`apps/api/src/graph/mem/`): that entries
 * written twice are there once and as first told, that the watermark moves
 * with them, that a write from where memory no longer stands is turned away,
 * that a value is kept under its key with the fixed list's name for it, that
 * a write which lets go of the turns of a conversation takes those entries
 * and no other, that the nodes of a project's memory and of the whole
 * database are counted, that two writers of one project's memory at once
 * leave one write, and that a write cannot move a node to another project.
 * Then which writer may write what over a project's memory (`shapeRule`):
 * that a later shape starts memory over, every entry gone and the node made
 * again, where the live site has not written, that an earlier shape then
 * stands down, that the live site starts over what it did not write and
 * marks the memory its own, that only the live site raises from then on,
 * and that the mark stays under another deployment's write. And it runs the
 * statements of the build the live site runs, which knows only the graph,
 * against the same project: its sync and its purge, copied from
 * `apps/api/src/graph/neo4j.ts` on `main`. They must leave every memory node
 * as it was, and this build's purge must then remove them all.
 *
 * Last, the facts of memory, the assistant's notes and their pages, on a
 * project of their own and through the pass the app itself runs
 * (`syncMemory`): that what memory holds after a pass is exactly the facts
 * the record gives, again after the record has changed, with a fact found
 * losing the properties it no longer has; that memory says which facts it
 * holds; that a note is kept on the page of what it is about, found by what
 * a question is about, and trimmed to the newest; that a start-over lets go
 * of every entry and fact and leaves notes and pages; that a writer turned
 * away adds no note; and that the older build's sync and purge leave all of
 * it alone.
 *
 * The probe is not the live site and never writes as one but where it says
 * so, to its own made-up project: the mark that says the live site wrote a
 * project's memory is kept on that project's own node, which the probe
 * removes, and there is no mark for the database as a whole.
 *
 *   pnpm probe:neo4j bolt://localhost:7687
 *
 * The address is taken from the command line and from nowhere else. The user,
 * password and database are read as the app reads them, from
 * `REALYTICA_NEO4J_USER`, `REALYTICA_NEO4J_PASSWORD` and
 * `REALYTICA_NEO4J_DATABASE`.
 *
 * What it leaves behind. It creates the app's constraints and indexes, as a
 * boot does, and the memory's, as its first write does, and they stay: they
 * are the app's own, one of them is the constraint that keeps a project to
 * one marker, and a database the app has booted against has them already.
 * Everything else it writes is projects of its own, under ids no real project
 * has, and it removes them, graph and memory, before it ends, whether or not
 * a check failed.
 *
 * After the checks it times a sync of a project the size of a real one, about
 * 200 nodes and 300 links, three ways: drawn for the first time, drawn again
 * from a later copy that changed, and offered again unchanged. A save waits
 * for its sync for `GRAPH_WAIT_MS` (see `apps/api/src/graph/sync.ts`); a sync
 * that takes longer is finished after the reply. It times one write of
 * memory too, of as many entries as one write holds at most. The figures are
 * from the machine this runs on, not from where the app is hosted.
 *
 * The port's whole contract runs against the same database with the scrub
 * left out:
 *
 *   REALYTICA_NEO4J_URL=bolt://localhost:7687 pnpm exec tsx --test test/graph-store.test.ts
 */
import neo4j from 'neo4j-driver';
import {
  MEM_AT_MOST,
  MEM_SCHEMA,
  MEM_TURN_KINDS,
  PROJECT_NODE_KINDS,
  STANDARD_FACT_KEYS,
  addEvidence,
  addFinding,
  createProject,
  memFactRev,
  memFactsRev,
  memNear,
  memThought,
  memoryDelta,
  memoryFacts,
  patchProject,
  projectLayerFor,
  reviewFacts,
  type DdProject,
  type DocumentFact,
  type MemEntry,
  type MemFact,
  type MemWatermark,
  type ProjectGraphEdge,
  type ProjectGraphNode,
} from '@realytica/shared';
import type { GraphSyncRefused, ProjectGraphSnapshot } from '../apps/api/src/graph/types';

const PROJECT = `prj_probe_${Date.now().toString(16)}`;
const TIMED = `${PROJECT}_timed`;
/** A second project, for the write that tries to take a node of the first. */
const OTHER = `${PROJECT}_other`;
/** A third, whose memory nothing has written before a later shape does. */
const UNWRITTEN = `${PROJECT}_unwritten`;
/** A fourth, for the facts of memory, the assistant's notes and their pages. */
const FACTS = `${PROJECT}_facts`;
/** The workspace the probe's memory is written under. No project store holds it, so nothing looks for it. */
const TENANT = 'tnt_probe';

/**
 * The statements of the build the live site runs, which knows the graph and
 * nothing of memory. Copied from `apps/api/src/graph/neo4j.ts` on `main`,
 * where the names in them are built from that build's own lists: the lists
 * here are this build's, which changes which labels a statement clears and
 * not which nodes it matches.
 */
const MAIN_REL = 'RYT_EDGE';
const MAIN_LAYERS = [...new Set(PROJECT_NODE_KINDS.map(projectLayerFor))];
const MAIN_WRITE_NODES = `
  UNWIND $rows AS row
  MERGE (n:Ryt { id: row.id })
  SET n.projectId = row.projectId, n.kind = row.kind, n.layer = row.layer,
      n.origin = row.origin, n.label = row.label, n.detail = row.detail,
      n.key = row.key, n.status = row.status
  REMOVE n:${[...PROJECT_NODE_KINDS].join(':')}
  REMOVE n:${MAIN_LAYERS.join(':')}
  REMOVE n:derived:authored
`;
const MAIN_KIND_LABELS = (kind: (typeof PROJECT_NODE_KINDS)[number]): string => `
      UNWIND $rows AS row
      MATCH (n:Ryt { id: row.id })
      SET n:${kind}:${projectLayerFor(kind)}
    `;
const MAIN_ORIGIN_LABELS = `
  UNWIND $rows AS row
  MATCH (n:Ryt { id: row.id })
  SET n:derived
`;
const MAIN_WRITE_EDGES = `
  UNWIND $rows AS row
  MATCH (a:Ryt { id: row.from }), (b:Ryt { id: row.to })
  MERGE (a)-[r:${MAIN_REL} { id: row.id }]->(b)
  SET r.projectId = row.projectId, r.kind = row.kind, r.origin = row.origin
  // Re-drawing an edge reopens it: the same relationship asserted again is the
  // same edge, not a second one.
  REMOVE r.closedAt
`;
const MAIN_DROP_NODES = `MATCH (n:Ryt { projectId: $projectId, origin: 'derived' })
           WHERE NOT n.id IN $keep
           DETACH DELETE n`;
const MAIN_CLOSE_EDGES = `MATCH (:Ryt { projectId: $projectId })-[r:${MAIN_REL} { projectId: $projectId, origin: 'derived' }]->(:Ryt)
           WHERE NOT r.id IN $keep AND r.closedAt IS NULL
           SET r.closedAt = $closedAt`;
const MAIN_PURGE = `MATCH (n:Ryt { projectId: $projectId }) DETACH DELETE n`;

/** A made-up project's record, under the probe's id, with a paper filed and two findings raised. */
function record(): DdProject {
  const project = createProject({ name: 'Probe plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-PROBE');
  project.id = PROJECT;
  addEvidence(project, { title: 'A paper', kind: 'document' }, 'probe@example.com');
  addFinding(project, { title: 'A finding', description: 'Made up.', severity: 'low', discipline: 'legal' }, 'probe@example.com');
  addFinding(project, { title: 'Another finding', description: 'Made up.', severity: 'low', discipline: 'legal' }, 'probe@example.com');
  return project;
}

/**
 * A made-up project with values on it of every form a fact takes: a number
 * with a unit and a display, accepted, reopened and corrected, so it has a
 * past; a line; a name; yes or no; two dates; and fields a person typed.
 */
function factsRecord(): { project: DdProject; khata: string; ec: string } {
  const project = createProject({ name: 'Probe facts plot', type: 'residential', location: 'Northfield', city: 'Bengaluru' }, 'RYT-PROBE-F');
  for (const event of project.audit) if (event.entityId === project.id) event.entityId = FACTS;
  project.id = FACTS;
  const by = 'probe@example.com';
  const value = (key: string, held: DocumentFact['value'], display = String(held), more: Partial<DocumentFact> = {}): DocumentFact => ({ key, label: key, value: held, display, page: 2, quote: `${key}: ${display}`, review: 'proposed', ...more });
  const khata = addEvidence(project, { title: 'A khata', kind: 'document' }, by);
  khata.documentType = 'Khata certificate and extract';
  khata.facts = [value('extent_khata', 1100.9, '11,850 sq ft', { unit: 'sqm' }), value('khata_number', '1234/56'), value('owner', 'A Person')];
  reviewFacts(project, khata.id, ['extent_khata'], 'accept', by);
  reviewFacts(project, khata.id, ['extent_khata'], 'reopen', by);
  reviewFacts(project, khata.id, ['extent_khata'], 'accept', by, { value: 1096.2, display: '11,800 sq ft' });
  const ec = addEvidence(project, { title: 'An encumbrance certificate', kind: 'document' }, by);
  ec.documentType = 'Encumbrance certificate';
  ec.facts = [value('ec_nil', true, 'yes'), value('ec_from', '2010-04-01'), value('ec_to', '2026-03-31')];
  reviewFacts(project, ec.id, 'all', 'accept', by);
  patchProject(project, { landAreaSqm: 1210, siteAddress: 'Plot 4, Northfield Road' }, by);
  return { project, khata: khata.id, ec: ec.id };
}

/** Facts in one order with their properties in one order, so that two sets that say the same compare the same. */
const canon = (facts: readonly MemFact[]): string =>
  JSON.stringify([...facts].sort((a, b) => (a.id < b.id ? -1 : 1)).map((fact) => Object.fromEntries(Object.entries(fact).sort(([a], [b]) => (a < b ? -1 : 1)))));

/** An entry made by hand, for the writes that go to the store without a record behind them. */
function entry(projectId: string, sourceId: string): MemEntry {
  return { id: `${projectId}::mem::${sourceId}`, kind: 'finding_raised', at: new Date().toISOString(), by: 'who_00000000000000', sourceId, about: [`fnd_${sourceId}`] };
}

/** Node ids are unique across the whole database, so the probe's carry their project. */
const at = (name: string, project = PROJECT): string => `${project}::${name}`;

function parcel(name: string): ProjectGraphNode {
  return { id: at(name), kind: 'parcel', layer: 'entity', origin: 'derived', label: name };
}

function link(from: string, to: string): ProjectGraphEdge {
  return { id: at(`${from}>${to}`), from: at(from), to: at(to), rel: 'cites' };
}

function snapshot(revision: number | undefined, nodes: Array<string | ProjectGraphNode>, edges: ProjectGraphEdge[] = []): ProjectGraphSnapshot {
  return {
    projectId: PROJECT,
    builtAt: new Date().toISOString(),
    ...(revision === undefined ? {} : { revision }),
    nodes: nodes.map((node) => (typeof node === 'string' ? parcel(node) : node)),
    edges,
  };
}

/** A project the size of a real one: every kind of node the app draws, and half as many links again. */
function sized(revision: number, nodes: number, links: number, relabelled = false): ProjectGraphSnapshot {
  const drawn: ProjectGraphNode[] = [];
  for (let i = 0; i < nodes; i += 1) {
    const kind = PROJECT_NODE_KINDS[i % PROJECT_NODE_KINDS.length]!;
    drawn.push({ id: at(`n${i}`, TIMED), kind, layer: projectLayerFor(kind), origin: 'derived', label: `${kind} ${i}${relabelled && i === 0 ? ' (changed)' : ''}`, detail: 'a line of detail, as most records carry' });
  }
  const edges: ProjectGraphEdge[] = [];
  for (let i = 0; i < links; i += 1) {
    // A ring, then chords across it.
    const from = i % nodes;
    const to = i < nodes ? (i + 1) % nodes : (from + 7 + Math.floor(i / nodes)) % nodes;
    edges.push({ id: at(`e${i}`, TIMED), from: at(`n${from}`, TIMED), to: at(`n${to}`, TIMED), rel: 'cites' });
  }
  return { projectId: TIMED, builtAt: new Date().toISOString(), revision, nodes: drawn, edges };
}

let failed = 0;

function check(name: string, pass: boolean, found?: unknown): void {
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${pass || found === undefined ? '' : `: found ${JSON.stringify(found)}`}`);
  if (!pass) failed += 1;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

async function main(): Promise<void> {
  const uri = process.argv[2];
  if (!uri || !/^(bolt|neo4j)(\+s|\+ssc)?:\/\//.test(uri)) {
    console.error('Name the database to probe: pnpm probe:neo4j bolt://localhost:7687');
    process.exitCode = 1;
    return;
  }
  process.env.REALYTICA_NEO4J_URL = uri;
  const { neo4jAdapter: graph, ensureNeo4jSchema, closeNeo4j } = await import('../apps/api/src/graph/neo4j');
  const { neo4jMemory: memory } = await import('../apps/api/src/graph/mem/neo4j');
  const { writeMemory, writeThought } = await import('../apps/api/src/graph/mem/write');
  const { syncMemory } = await import('../apps/api/src/graph/mem/sync');

  /** The probe project's derived nodes as the database holds them, by the name each was given. */
  const stored = async (): Promise<string[] | null> => {
    const held = await graph.readProject(PROJECT);
    return held ? held.nodes.filter((n) => n.origin === 'derived').map((n) => n.label).sort() : null;
  };
  const refusal = (answer: GraphSyncRefused | void): GraphSyncRefused | null => (answer ? answer : null);

  if (!(await graph.healthy())) {
    console.error(`Nothing answered at ${uri}.`);
    await closeNeo4j();
    process.exitCode = 1;
    return;
  }

  // The probe's own read, for the one thing the adapter writes and never reads back: labels.
  const reader = neo4j.driver(uri, neo4j.auth.basic(process.env.REALYTICA_NEO4J_USER?.trim() || 'neo4j', process.env.REALYTICA_NEO4J_PASSWORD?.trim() ?? ''));
  const database = process.env.REALYTICA_NEO4J_DATABASE?.trim();
  const labelsOf = async (id: string): Promise<string[] | null> => {
    const session = database ? reader.session({ database }) : reader.session();
    try {
      const result = await session.executeRead((tx) => tx.run('MATCH (n:Ryt { id: $id }) RETURN labels(n) AS labels', { id }));
      return result.records.length === 1 ? (result.records[0]!.get('labels') as string[]).sort() : null;
    } finally {
      await session.close();
    }
  };
  /** How many nodes of each memory label a project has, whatever wrote them. */
  const memoryNodes = async (projectId: string): Promise<Record<string, number>> => {
    const session = database ? reader.session({ database }) : reader.session();
    try {
      const result = await session.executeRead((tx) =>
        tx.run(
          `MATCH (n { projectId: $projectId }) WHERE any(label IN labels(n) WHERE label STARTS WITH 'Mem')
           UNWIND labels(n) AS label RETURN label, count(*) AS nodes ORDER BY label`,
          { projectId },
        ),
      );
      return Object.fromEntries(result.records.map((row) => [String(row.get('label')), Number(row.get('nodes'))]));
    } finally {
      await session.close();
    }
  };
  /** The names of the properties the node that says where a project's memory stands holds. */
  const memoryProperties = async (projectId: string): Promise<string[]> => {
    const session = database ? reader.session({ database }) : reader.session();
    try {
      const result = await session.executeRead((tx) => tx.run('MATCH (m:MemProject { projectId: $projectId }) RETURN keys(m) AS names', { projectId }));
      return result.records.length === 1 ? (result.records[0]!.get('names') as string[]).sort() : [];
    } finally {
      await session.close();
    }
  };
  /** A property on a project's memory node that no shape of this build sets, as a later shape might keep one there. The probe's one write of its own to memory. */
  const plantProperty = async (projectId: string): Promise<void> => {
    const session = database ? reader.session({ database }) : reader.session();
    try {
      await session.executeWrite((tx) => tx.run('MATCH (m:MemProject { projectId: $projectId }) SET m.keptByAnotherShape = $value', { projectId, value: 'planted' }));
    } finally {
      await session.close();
    }
  };
  /** The older build's sync of a project, statement for statement, in one transaction as it runs them. */
  const mainSync = async (projectId: string, names: string[], links: ProjectGraphEdge[]): Promise<void> => {
    const rows = names.map((name) => ({ projectId, id: at(name), kind: 'parcel', layer: 'entity', origin: 'derived', label: name, detail: null, key: null, status: null }));
    const session = database ? reader.session({ database }) : reader.session();
    try {
      await session.executeWrite(async (tx) => {
        await tx.run(MAIN_WRITE_NODES, { rows });
        await tx.run(MAIN_KIND_LABELS('parcel'), { rows });
        await tx.run(MAIN_ORIGIN_LABELS, { rows });
        if (links.length > 0) await tx.run(MAIN_WRITE_EDGES, { rows: links.map((e) => ({ projectId, id: e.id, kind: e.rel, from: e.from, to: e.to, origin: 'derived' })) });
        await tx.run(MAIN_DROP_NODES, { projectId, keep: rows.map((row) => row.id) });
        await tx.run(MAIN_CLOSE_EDGES, { projectId, keep: links.map((e) => e.id), closedAt: new Date().toISOString() });
      });
    } finally {
      await session.close();
    }
  };
  const mainPurge = async (projectId: string): Promise<void> => {
    const session = database ? reader.session({ database }) : reader.session();
    try {
      await session.executeWrite((tx) => tx.run(MAIN_PURGE, { projectId }));
    } finally {
      await session.close();
    }
  };

  try {
    await ensureNeo4jSchema();
    await ensureNeo4jSchema();
    check('the constraints and indexes are created, and creating them again changes nothing', true);

    check('a first sync is taken', refusal(await graph.syncProject(snapshot(2, ['a', 'b'], [link('a', 'b')]))) === null);
    check('and its nodes are stored', same(await stored(), ['a', 'b']), await stored());
    const drawn = await labelsOf(at('a'));
    check('each with the labels of its kind, its layer and its origin, and no others', same(drawn, ['Ryt', 'derived', 'entity', 'parcel']), drawn);

    const older = refusal(await graph.syncProject(snapshot(1, ['a'])));
    check('a lower revision is refused, and the answer says which revision is held', same(older, { refused: true, held: 2, drawn: false }), older);
    check('and it deletes nothing the later copy drew', same(await stored(), ['a', 'b']), await stored());
    const edges = (await graph.readProject(PROJECT))?.edges.map((e) => e.id);
    check('nor closes an edge the later copy drew', same(edges, [at('a>b')]), edges);
    const olderSame = refusal(await graph.syncProject(snapshot(1, ['a', 'b'], [link('a', 'b')])));
    check('a lower revision that draws what is stored is refused, and the answer says it is drawn', same(olderSame, { refused: true, held: 2, drawn: true }), olderSame);

    const unnumbered = refusal(await graph.syncProject(snapshot(undefined, ['a'])));
    check('a snapshot with no revision is the lowest', same(unnumbered, { refused: true, held: 2, drawn: false }), unnumbered);

    check('the same revision and the same drawing is taken', refusal(await graph.syncProject(snapshot(2, ['a', 'b'], [link('a', 'b')]))) === null);
    check('and leaves what is stored as it was', same(await stored(), ['a', 'b']), await stored());
    check('the same revision drawn differently is taken', refusal(await graph.syncProject(snapshot(2, ['a', 'b', 'c']))) === null);
    check('and replaces what was stored', same(await stored(), ['a', 'b', 'c']), await stored());

    check('a higher revision that draws the same is taken', refusal(await graph.syncProject(snapshot(3, ['a', 'b', 'c']))) === null);
    const moved = refusal(await graph.syncProject(snapshot(2, ['a'])));
    check('and the marker has moved to it: the revision before is refused', same(moved, { refused: true, held: 3, drawn: false }), moved);
    check('a higher revision is taken', refusal(await graph.syncProject(snapshot(4, ['a']))) === null);
    check('and removes what it no longer draws', same(await stored(), ['a']), await stored());

    const asAsset: ProjectGraphNode = { id: at('a'), kind: 'asset', layer: 'entity', origin: 'derived', label: 'a' };
    await graph.syncProject(snapshot(5, [asAsset]));
    const relabelled = await labelsOf(at('a'));
    check('a node whose kind changed loses the label of the kind it was', same(relabelled, ['Ryt', 'asset', 'derived', 'entity']), relabelled);
    await graph.syncProject(snapshot(6, ['a']));

    const note: ProjectGraphNode = { id: at('note'), kind: 'thought', layer: 'deliberation', origin: 'authored', label: 'a note' };
    await graph.appendProject(PROJECT, [note], [{ id: at('note>a'), from: note.id, to: at('a'), rel: 'cites' }]);
    const noted = await labelsOf(note.id);
    check('a note is labelled as one', same(noted, ['Ryt', 'authored', 'deliberation', 'thought']), noted);
    await graph.syncProject(snapshot(1, []));
    await graph.syncProject(snapshot(7, ['a', 'd']));
    const withNote = await graph.readProject(PROJECT);
    check(
      'a note and its link survive a refused sync and a taken one',
      Boolean(withNote?.nodes.some((n) => n.id === note.id) && withNote.edges.some((e) => e.id === at('note>a'))),
    );

    // Two syncs of one project at once, the lower revision started first as
    // often as not. Whichever order the database runs them in, the graph left
    // behind must be the higher revision's: the second waits on the marker
    // the first holds, and then reads the revision the first wrote.
    let raced = true;
    for (let round = 0; round < 10; round += 1) {
      const lower = snapshot(10 + round * 2, ['a', `lower-${round}`]);
      const higher = snapshot(11 + round * 2, ['a', `higher-${round}`]);
      await Promise.all((round % 2 ? [higher, lower] : [lower, higher]).map((s) => graph.syncProject(s)));
      const left = await stored();
      if (!same(left, ['a', `higher-${round}`])) {
        raced = false;
        check(`two syncs at once leave the higher revision's graph (round ${round})`, false, left);
        break;
      }
    }
    if (raced) check('two syncs at once leave the higher revision’s graph, ten times in ten', true);

    await graph.purgeProject(PROJECT);
    check('a purge removes the graph', (await graph.readProject(PROJECT)) === null);
    check('and the marker with it: the lowest revision is taken again', refusal(await graph.syncProject(snapshot(1, ['a']))) === null);
    check('and stored', same(await stored(), ['a']), await stored());

    // The project's memory, in the same database under labels of its own.
    console.log('\nThe project’s memory:');
    const project = record();
    const told = memoryDelta(project, {});
    // Whatever the shell this runs in says of itself, the probe is not the live site, and says so on every write.
    const notLive = false;
    check('a first write of memory is taken', same(await writeMemory(memory, TENANT, {}, told, notLive), { written: 3 }));
    const first = await memory.entries(PROJECT, 100);
    check('and its entries are stored, newest first', same(first.map((e) => e.id).sort(), told.entries.map((e) => e.id).sort()) && first.every((e, i) => i === 0 || first[i - 1]!.at >= e.at), first.map((e) => e.kind));
    check('each as it was told, with nothing added', same([...first].sort((a, b) => a.id.localeCompare(b.id)), [...told.entries].sort((a, b) => a.id.localeCompare(b.id))), first[0]);
    check('one node a project and one an entry, and no other', same(await memoryNodes(PROJECT), { MemEntry: 3, MemProject: 1 }), await memoryNodes(PROJECT));
    check('the watermark stands where the write ended', same((await memory.watermarks([PROJECT])).get(PROJECT), told.through), [...(await memory.watermarks([PROJECT]))]);

    check('the same entries written again are taken', same(await writeMemory(memory, TENANT, told.through, memoryDelta(project, {}), notLive), { written: 3 }));
    check('and are there once, as they were first told', same(await memory.entries(PROJECT, 100), first) && same(await memoryNodes(PROJECT), { MemEntry: 3, MemProject: 1 }), await memoryNodes(PROJECT));
    const changed = { ...told, entries: told.entries.map((e) => ({ ...e, kind: 'paper_read' as const, label: 'Changed' })) };
    await writeMemory(memory, TENANT, told.through, changed, notLive);
    check('an entry offered again saying something else is left as it was first told', same(await memory.entries(PROJECT, 100), first));

    addFinding(project, { title: 'A later finding', description: 'Made up.', severity: 'low', discipline: 'legal' }, 'probe@example.com');
    const next = memoryDelta(project, told.through);
    check('a write of what came after is taken', next.entries.length === 1 && same(await writeMemory(memory, TENANT, told.through, next, notLive), { written: 1 }));
    check('and the watermark moves with it', same((await memory.watermarks([PROJECT])).get(PROJECT), next.through) && (await memory.entries(PROJECT, 100)).length === 4);
    const stale = await writeMemory(memory, TENANT, told.through, { ...next, entries: [entry(PROJECT, 'stale')] }, notLive);
    check('a write from where memory no longer stands is turned away, and told where it stands', same(stale, { moved: next.through }), stale);
    check('and writes nothing', (await memory.entries(PROJECT, 100)).length === 4 && same((await memory.watermarks([PROJECT])).get(PROJECT), next.through));

    // A value accepted, a question and its answer, and the note of a work-pane write.
    const valued: MemEntry = { ...entry(PROJECT, 'aud_probe_value'), kind: 'value_accepted', key: 'extent_khata', label: 'words of the caller’s own' };
    const turns: MemEntry[] = [
      { ...entry(PROJECT, 'cht_probe_1'), kind: 'chat_asked', about: [] },
      { ...entry(PROJECT, 'cht_probe_2'), kind: 'chat_answered', about: [] },
      { ...entry(PROJECT, 'cht_probe_3'), kind: 'edit_noted', about: [] },
    ];
    const asked = { ...next.through, turnThrough: 'cht_probe_4' };
    check('a write of a value, two chat turns and a note is taken', same(await writeMemory(memory, TENANT, next.through, { projectId: PROJECT, through: asked, entries: [valued, ...turns] }, notLive), { written: 4 }));
    const kept = (await memory.entries(PROJECT, 100)).find((e) => e.id === valued.id);
    check('the value is stored under its key, with the fixed list’s name for it and not the caller’s words', kept?.key === 'extent_khata' && kept.label === STANDARD_FACT_KEYS.extent_khata!.label, kept);
    const counted = await memory.count(PROJECT);
    check('the project’s memory is counted: eight entries and the node that says where it stands', counted.project === 9, counted);
    check('and so is every node the database holds, the graph’s included', counted.database > counted.project, counted);
    const forgotten = await writeMemory(memory, TENANT, asked, { projectId: PROJECT, through: next.through, entries: [], forget: [...MEM_TURN_KINDS] }, notLive);
    check('a write that lets go of what was told from the conversation is taken', same(forgotten, { written: 0 }), forgotten);
    const left = await memory.entries(PROJECT, 100);
    check('and takes those entries, the note with the turns, and no other', left.length === 5 && left.every((e) => !MEM_TURN_KINDS.includes(e.kind)) && left.some((e) => e.id === valued.id), left.map((e) => e.kind));
    check('and the watermark stands at no turn', same((await memory.watermarks([PROJECT])).get(PROJECT), next.through), [...(await memory.watermarks([PROJECT]))]);

    const taking = await memory.write({ projectId: OTHER, tenantId: TENANT, from: {}, through: { schema: MEM_SCHEMA, auditThrough: 'aud_other' }, entries: [{ ...first[0]!, about: ['taken'] }, entry(PROJECT, 'not_yet_told')], live: notLive });
    const mine = await memory.entries(PROJECT, 100);
    check('a write for another project that names this one’s entries writes none of them', same(taking, { written: 0 }) && same(await memoryNodes(OTHER), { MemProject: 1 }), [taking, await memoryNodes(OTHER)]);
    const away = await memory.write({ projectId: `${OTHER}_away`, tenantId: TENANT, from: { auditThrough: 'aud_nowhere' }, through: { schema: MEM_SCHEMA, auditThrough: 'aud_1' }, entries: [], live: notLive });
    check('a write that is turned away leaves nothing behind, not even the node it took', same(away, { moved: {} }) && same(await memoryNodes(`${OTHER}_away`), {}), [away, await memoryNodes(`${OTHER}_away`)]);
    check('and this project’s entries are as they were', mine.length === 5 && mine.some((e) => e.id === first[0]!.id && same(e.about, first[0]!.about)), mine.length);

    // Two writers of one project's memory at once, from the same place. One
    // is taken and the other is told memory has moved, whichever the database
    // runs first: the second waits on the node the first holds.
    let stands = next.through;
    let oneTaken = true;
    for (let round = 0; round < 10 && oneTaken; round += 1) {
      const writers = ['a', 'b'].map((name) => ({ schema: MEM_SCHEMA, auditThrough: `aud_race_${round}_${name}`, ...(stands.turnThrough ? { turnThrough: stands.turnThrough } : {}) }));
      const answers = await Promise.all(writers.map((through) => memory.write({ projectId: PROJECT, tenantId: TENANT, from: stands, through, entries: [entry(PROJECT, `${through.auditThrough}`)], live: notLive })));
      const taken = writers.filter((_, i) => 'written' in answers[i]!);
      const after = (await memory.watermarks([PROJECT])).get(PROJECT);
      const turnedAway = answers.filter((answer) => 'moved' in answer);
      if (taken.length !== 1 || turnedAway.length !== 1 || !same(after, taken[0]) || !same(turnedAway[0], { moved: taken[0] })) {
        oneTaken = false;
        check(`two writers at once leave one write (round ${round})`, false, { answers, after });
      } else {
        stands = taken[0]!;
      }
    }
    if (oneTaken) check('two writers at once leave one write, and the other is told where memory stands, ten times in ten', true);
    check('and only the entries of the writes that were taken are stored', (await memory.entries(PROJECT, 100)).length === 15, (await memory.entries(PROJECT, 100)).length);

    // The build the live site runs, against the same project. This build's
    // graph of it first, so that its marker holds a copy of two nodes.
    await graph.syncProject(snapshot(2, ['a', 'b']));
    const before = { nodes: await memoryNodes(PROJECT), entries: await memory.entries(PROJECT, 100), stands: (await memory.watermarks([PROJECT])).get(PROJECT) };
    const untouched = async (): Promise<boolean> =>
      same({ nodes: await memoryNodes(PROJECT), entries: await memory.entries(PROJECT, 100), stands: (await memory.watermarks([PROJECT])).get(PROJECT) }, before);
    await mainSync(PROJECT, ['a', 'main-drew-this'], [link('a', 'main-drew-this')]);
    check('the older build’s sync redraws the graph', same(await stored(), ['a', 'main-drew-this']), await stored());
    check('and leaves every memory node as it was', await untouched(), await memoryNodes(PROJECT));
    await mainSync(PROJECT, ['a'], []);
    check('its sync that drops a node leaves them too', same(await stored(), ['a']) && (await untouched()), await memoryNodes(PROJECT));
    const redrawn = refusal(await graph.syncProject(snapshot(2, ['a', 'b'])));
    check('this build then draws again the copy its marker holds, because the nodes stored are not as many as it draws', redrawn === null && same(await stored(), ['a', 'b']), await stored());
    await mainPurge(PROJECT);
    check('the older build’s purge removes the graph', (await graph.readProject(PROJECT)) === null);
    check('and leaves every memory node as it was', await untouched(), await memoryNodes(PROJECT));
    const afterPurge = refusal(await graph.syncProject(snapshot(2, ['a', 'b'])));
    check('this build draws the same copy again after it: the marker alone does not call it drawn', afterPurge === null && same(await stored(), ['a', 'b']), await stored());

    // Which writer may write what over a project's memory. Everything so far was written as a deployment that is not the live site.
    const standing = async (): Promise<unknown> => (await memory.watermarks([PROJECT])).get(PROJECT);
    const ids = (entries: MemEntry[]): string[] => entries.map((e) => e.id).sort();
    check('memory the live site has not written is not marked as its own', same(await standing(), stands), await standing());

    // A build with a later shape, on a deployment that is not the live site. It starts over memory the live site has not written.
    const raised = { schema: MEM_SCHEMA + 1, auditThrough: 'aud_raised' };
    const retold: MemEntry = { ...first[0]!, about: ['as_the_later_shape_tells_it'] };
    const believing = await memory.write({ projectId: PROJECT, tenantId: TENANT, from: stands, through: raised, entries: [retold], live: notLive });
    check('a write in a later shape that believes memory stands somewhere is told where it stands', same(believing, { moved: stands }), believing);
    check('and lets go of nothing', (await memory.entries(PROJECT, 100)).length === 15 && same(await standing(), stands), await standing());
    await plantProperty(PROJECT);
    const raising = await memory.write({ projectId: PROJECT, tenantId: TENANT, from: {}, through: raised, entries: [retold, entry(PROJECT, 'raised')], live: notLive });
    check('a later shape is taken over an earlier one the live site has not written', same(raising, { written: 2 }), raising);
    const startedOver = await memory.entries(PROJECT, 100);
    check('and starts memory over: every entry the earlier shape wrote is gone, and its own are there', same(ids(startedOver), ids([retold, entry(PROJECT, 'raised')])) && same(await memoryNodes(PROJECT), { MemEntry: 2, MemProject: 1 }), await memoryNodes(PROJECT));
    check('an entry it tells under an id the earlier shape held is as the later shape tells it', same(startedOver.find((e) => e.id === retold.id)?.about, retold.about), startedOver.find((e) => e.id === retold.id));
    check('the project’s own node is made again: it holds what this write set and nothing from before it', same(await memoryProperties(PROJECT), ['auditThrough', 'id', 'projectId', 'schema', 'tenantId', 'writtenAt']) && same(await standing(), raised), [await memoryProperties(PROJECT), await standing()]);
    const lower = await writeMemory(memory, TENANT, stands, { projectId: PROJECT, through: stands, entries: [entry(PROJECT, 'lower')] }, notLive);
    check('a write in an earlier shape than memory holds is turned away, and told which shape it holds', same(lower, { newer: MEM_SCHEMA + 1 }), lower);
    check('and writes nothing', (await memory.entries(PROJECT, 100)).length === 2 && same(await standing(), raised), await standing());

    // The live site, on this build. Written as one to the probe's own project only: the mark is kept on that project's node, which the probe removes.
    const whole = memoryDelta(project, {});
    const live = await writeMemory(memory, TENANT, {}, whole, true);
    check('the live site’s write is taken over a later shape it did not write: it does not stand down for another deployment’s writing', same(live, { written: 4 }), live);
    check('it starts memory over in its own shape, and what the other deployment wrote is gone', same(ids(await memory.entries(PROJECT, 100)), ids(whole.entries)) && same(await memoryNodes(PROJECT), { MemEntry: 4, MemProject: 1 }), await memoryNodes(PROJECT));
    const marked = { ...whole.through, live: true };
    check('and marks the project’s memory the live site’s', same(await standing(), marked), await standing());
    const turned = await memory.write({ projectId: PROJECT, tenantId: TENANT, from: {}, through: raised, entries: [entry(PROJECT, 'preview')], live: notLive });
    check('from then on a later shape from any other deployment is turned away, and told which shape the live site wrote', same(turned, { lower: MEM_SCHEMA }), turned);
    check('and writes nothing', (await memory.entries(PROJECT, 100)).length === 4 && same(await standing(), marked), await standing());
    const adding = { ...whole.through, auditThrough: 'aud_added' };
    const added = await writeMemory(memory, TENANT, whole.through, { projectId: PROJECT, through: adding, entries: [entry(PROJECT, 'added')] }, notLive);
    check('another deployment in the live site’s shape adds to its memory', same(added, { written: 1 }) && (await memory.entries(PROJECT, 100)).length === 5, added);
    check('and the mark stays under its write', same(await standing(), { ...adding, live: true }), await standing());
    const liveRaised = await memory.write({ projectId: PROJECT, tenantId: TENANT, from: {}, through: raised, entries: [entry(PROJECT, 'live_raised')], live: true });
    check('the live site raises its own memory, by starting it over', same(liveRaised, { written: 1 }) && same(ids(await memory.entries(PROJECT, 100)), [entry(PROJECT, 'live_raised').id]) && same(await standing(), { ...raised, live: true }), [liveRaised, await standing()]);
    const earlierLive = await writeMemory(memory, TENANT, {}, whole, true);
    check('and an earlier build of the live site then stands down', same(earlierLive, { newer: MEM_SCHEMA + 1 }) && (await memory.entries(PROJECT, 100)).length === 1, earlierLive);
    const unwritten = await memory.write({ projectId: UNWRITTEN, tenantId: TENANT, from: {}, through: { schema: MEM_SCHEMA + 1, auditThrough: 'aud_unwritten' }, entries: [entry(UNWRITTEN, 'unwritten')], live: notLive });
    check('where nothing is written yet, any deployment writes first, in its own shape', same(unwritten, { written: 1 }) && same(await memoryNodes(UNWRITTEN), { MemEntry: 1, MemProject: 1 }), [unwritten, await memoryNodes(UNWRITTEN)]);

    await memory.purge(PROJECT);
    check('this build’s purge removes every memory node of the project', same(await memoryNodes(PROJECT), {}), await memoryNodes(PROJECT));
    check('and leaves the graph, which has a purge of its own', same(await stored(), ['a', 'b']), await stored());
    check('a project with no memory reads as one that was never told', (await memory.entries(PROJECT, 100)).length === 0 && !(await memory.watermarks([PROJECT])).has(PROJECT));
    check('and is not listed among the projects that have memory', !(await memory.projects()).some((row) => row.projectId === PROJECT));

    // The facts of memory, the assistant's notes and their pages: through the pass the app itself runs, on a project of their own.
    console.log('\nThe facts of memory, the assistant’s notes and their pages:');
    {
      const lived = factsRecord();
      const known = new Map<string, MemWatermark>();
      // A pass is bounded in time and tells what it reaches. From a machine far from the database it may take more than one to tell a whole record.
      const pass = async () => {
        let passed = await syncMemory({ owed: [{ project: lived.project, tenantId: TENANT }], gone: [], known, stillStored: async () => true }, memory, notLive);
        for (let again = 0; again < 5 && passed.settled.length === 0 && passed.failed === 0; again += 1) {
          passed = await syncMemory({ owed: [{ project: lived.project, tenantId: TENANT }], gone: [], known, stillStored: async () => true }, memory, notLive);
        }
        return passed;
      };
      const given = (): MemFact[] => memoryFacts(lived.project).held;
      const told1 = await pass();
      check('a pass tells a record its facts', told1.settled.length === 1 && told1.failed === 0, told1);
      check('and memory then holds exactly the facts the record gives, each property as it was told', canon(await memory.factsOf(FACTS)) === canon(given()), [(await memory.factsOf(FACTS)).length, given().length]);
      const index = new Map(given().map((fact) => [fact.id, memFactRev(fact)]));
      check('each fact is listed by its id with its own digest', same([...(await memory.factIndex(FACTS))].sort(), [...index].sort()));
      check('and memory says which facts it holds, as one digest of them all', (await memory.watermarks([FACTS])).get(FACTS)?.factsRev === memFactsRev(index), (await memory.watermarks([FACTS])).get(FACTS));
      check('one node a fact, beside the entries and the project’s own', (await memoryNodes(FACTS)).MemFact === given().length && (await memoryNodes(FACTS)).MemProject === 1, await memoryNodes(FACTS));

      // The record changes: a waiting value is accepted, so its fact changes tag and loses what only a reading has, and another is set aside, so its fact goes.
      reviewFacts(lived.project, lived.khata, ['khata_number'], 'accept', 'probe@example.com');
      reviewFacts(lived.project, lived.khata, ['owner'], 'reject', 'probe@example.com');
      lived.project.updatedAt = new Date().toISOString();
      const told2 = await pass();
      const after = await memory.factsOf(FACTS);
      check('after the record changes, a pass leaves memory holding exactly what the record now gives', told2.failed === 0 && canon(after) === canon(given()), [after.length, given().length]);
      const number = after.find((fact) => fact.id.endsWith(`${lived.khata}::khata_number::a`));
      check('a value accepted is approved, and its node has lost what only a waiting value has', number?.tag === 'approved' && number.readBy === undefined && number.stands === undefined && typeof number.by === 'string', number);
      check('and a value set aside has no fact', !after.some((fact) => fact.id.includes(`${lived.khata}::owner::`)));
      const made = (await pass()).made;
      check('a record that has not changed is not written again', made <= 1 && canon(await memory.factsOf(FACTS)) === canon(given()), made);

      // The assistant's notes, and the pages they are on.
      const note = (turnId: string, said: string, aboutId: string, at: string): MemFact => memThought(FACTS, { note: said, aboutId, turnId, at, place: { department: 'legal', fn: 'legal.title' } })!;
      const first1 = note('cht_probe_a', 'The khata is in the seller’s own name.', lived.khata, '2026-10-06T08:00:00.000Z');
      check('a note is kept', same(await writeThought(memory, TENANT, FACTS, first1, notLive), { written: 1 }));
      check('as a fact tagged a thought, holding its sentence and nothing a fact told from the record has', canon((await memory.factsOf(FACTS)).filter((fact) => fact.tag === 'thought')) === canon([first1]), (await memory.factsOf(FACTS)).filter((fact) => fact.tag === 'thought'));
      check('on the page of what it is about', same((await memory.pagesOf(FACTS)).map((page) => [page.aboutId, page.notes]), [[lived.khata, 1]]) && (await memoryNodes(FACTS)).MemPage === 1, await memory.pagesOf(FACTS));
      check('it is not among the facts told from the record, and does not move what memory says it holds', (await memory.factIndex(FACTS)).size === given().length && (await memory.watermarks([FACTS])).get(FACTS)?.factsRev === memFactsRev(new Map(given().map((fact) => [fact.id, memFactRev(fact)]))));
      await writeThought(memory, TENANT, FACTS, note('cht_probe_b', 'The certificate covers sixteen years.', lived.ec, '2026-10-06T08:05:00.000Z'), notLive);
      await writeThought(memory, TENANT, FACTS, note('cht_probe_c', 'The extent was corrected once.', lived.khata, '2026-10-06T08:10:00.000Z'), notLive);
      check('a page counts its notes, and the page most lately written on comes first', same((await memory.pagesOf(FACTS)).map((page) => [page.aboutId, page.notes]), [[lived.khata, 2], [lived.ec, 1]]), await memory.pagesOf(FACTS));
      const near = await memory.factsNear(FACTS, memNear(FACTS, [{ from: 'named', title: 'the khata', aboutIds: [lived.khata], keys: [] }]));
      check(
        'what a question is about finds its facts and its notes, with where memory stands, in one read',
        near.held.every((fact) => fact.aboutId === lived.khata) && near.held.filter((fact) => fact.tag === 'thought').length === 2 && near.held.some((fact) => fact.tag === 'approved') && near.stands?.factsRev === (await memory.watermarks([FACTS])).get(FACTS)?.factsRev,
        near.held.map((fact) => [fact.tag, fact.key]),
      );
      const byKey = await memory.factsNear(FACTS, { aboutIds: [], fns: [], departments: [], keys: ['ec_nil'] });
      check('and a kind of value finds the facts under its key', same(byKey.held.map((fact) => [fact.key, fact.value]), [['ec_nil', true]]), byKey.held);
      const moved = note('cht_probe_b', 'The certificate covers sixteen years.', lived.khata, '2026-10-06T08:05:00.000Z');
      await writeThought(memory, TENANT, FACTS, moved, notLive);
      check('a note written again about another thing is on that page and no longer on the first, whose page goes with its last note', same((await memory.pagesOf(FACTS)).map((page) => [page.aboutId, page.notes]), [[lived.khata, 3]]), await memory.pagesOf(FACTS));
      await memory.think({ projectId: FACTS, tenantId: TENANT, thought: note('cht_probe_d', 'A fourth note.', lived.ec, '2026-10-06T08:20:00.000Z'), schema: MEM_SCHEMA, live: notLive, keep: 2 });
      const kept2 = (await memory.factsOf(FACTS)).filter((fact) => fact.tag === 'thought').map((fact) => fact.source).sort();
      check('a project keeps its newest notes, and a page with none left goes', same(kept2, ['cht_probe_c', 'cht_probe_d']) && same((await memory.pagesOf(FACTS)).map((page) => [page.aboutId, page.notes]), [[lived.ec, 1], [lived.khata, 1]]), [kept2, await memory.pagesOf(FACTS)]);

      // The older build's statements, against a project whose memory holds facts, notes and pages.
      await graph.syncProject({ projectId: FACTS, builtAt: new Date().toISOString(), revision: 1, nodes: [{ id: at('a', FACTS), kind: 'parcel', layer: 'entity', origin: 'derived', label: 'a' }], edges: [] });
      const heldBefore = { nodes: await memoryNodes(FACTS), facts: canon(await memory.factsOf(FACTS)), pages: await memory.pagesOf(FACTS) };
      await mainSync(FACTS, ['a', 'main-drew-this'], []);
      await mainPurge(FACTS);
      check('the older build’s sync and purge leave every fact, note and page as it was', same({ nodes: await memoryNodes(FACTS), facts: canon(await memory.factsOf(FACTS)), pages: await memory.pagesOf(FACTS) }, heldBefore), await memoryNodes(FACTS));

      // A start-over, by a later shape on a deployment that is not the live site.
      const later = await memory.write({ projectId: FACTS, tenantId: TENANT, from: {}, through: { schema: MEM_SCHEMA + 1, auditThrough: 'aud_later' }, entries: [entry(FACTS, 'later')], live: notLive });
      const leftOver = await memory.factsOf(FACTS);
      check('a start-over lets go of every entry and every fact told from the record', same(later, { written: 1 }) && (await memory.entries(FACTS, 100)).length === 1 && (await memory.factIndex(FACTS)).size === 0, [later, await memoryNodes(FACTS)]);
      check('and leaves the notes and their pages, which nothing can tell again', leftOver.length === 2 && leftOver.every((fact) => fact.tag === 'thought') && (await memory.pagesOf(FACTS)).length === 2, await memoryNodes(FACTS));
      const refused = await writeThought(memory, TENANT, FACTS, note('cht_probe_e', 'From an earlier build.', lived.khata, '2026-10-06T09:00:00.000Z'), notLive);
      check('a writer the shape rule turns away adds no note', same(refused, { newer: MEM_SCHEMA + 1 }) && (await memory.factsOf(FACTS)).length === 2, refused);
      await memory.purge(FACTS);
      check('a purge removes the facts, the notes and the pages with the rest', same(await memoryNodes(FACTS), {}), await memoryNodes(FACTS));
    }

    // How long one sync takes from here, for a project the size of a real one.
    const [nodes, links] = [200, 300];
    const timed = async (what: string, work: () => Promise<unknown>): Promise<void> => {
      const started = performance.now();
      await work();
      console.log(`      ${what}: ${Math.round(performance.now() - started)} ms`);
    };
    console.log(`\nOne sync of a project of ${nodes} nodes and ${links} links, from this machine:`);
    await timed('drawn for the first time (5 statements)', () => graph.syncProject(sized(1, nodes, links)));
    await timed('drawn again from a later copy that changed (5 statements)', () => graph.syncProject(sized(2, nodes, links, true)));
    await timed('offered again from a later copy that draws the same (1 statement)', () => graph.syncProject(sized(3, nodes, links, true)));
    const timedBack = await graph.readProject(TIMED);
    check(`and all of it is stored: ${nodes} nodes and ${links} links`, timedBack?.nodes.length === nodes && timedBack.edges.length === links, [timedBack?.nodes.length, timedBack?.edges.length]);
    await timed('dropped (2 statements)', () => graph.purgeProject(TIMED));

    console.log(`\nOne write of memory of ${MEM_AT_MOST} entries, the most one write holds, from this machine:`);
    const many = Array.from({ length: MEM_AT_MOST }, (_, i) => entry(TIMED, `aud_${i}`));
    const through = { schema: MEM_SCHEMA, auditThrough: `aud_${MEM_AT_MOST - 1}` };
    await timed('written for the first time (5 statements: a first write starts memory over)', () => memory.write({ projectId: TIMED, tenantId: TENANT, from: {}, through, entries: many, live: false }));
    await timed('written again, every entry already there (2 statements)', () => memory.write({ projectId: TIMED, tenantId: TENANT, from: through, through, entries: many, live: false }));
    const facts = Array.from({ length: MEM_AT_MOST }, (_, i): MemFact => ({ id: `${TIMED}::fact::ev_${i}::extent_khata::a`, tag: 'approved', key: 'extent_khata', label: STANDARD_FACT_KEYS.extent_khata!.label, value: 1000 + i, unit: 'sqm', aboutId: `ev_${i % 25}`, recordedAt: new Date().toISOString(), by: 'who_00000000000000', at: new Date().toISOString(), source: `ev_${i % 25}`, page: 1 }));
    const withFacts = { ...through, factsRev: memFactsRev(new Map(facts.map((fact) => [fact.id, memFactRev(fact)]))) };
    await timed(`${MEM_AT_MOST} facts written in one write, the most one holds (3 statements)`, () => memory.write({ projectId: TIMED, tenantId: TENANT, from: through, through: withFacts, entries: [], factChanges: { put: facts, drop: [] }, live: false }));
    await timed('what a question is about read back, twenty facts of five hundred, with where memory stands (2 statements)', () => memory.factsNear(TIMED, { aboutIds: ['ev_7'], fns: [], departments: [], keys: [] }));
    await timed('every fact listed by id with its digest', () => memory.factIndex(TIMED));
    await timed(`started over in a later shape, ${MEM_AT_MOST} entries and ${MEM_AT_MOST} facts let go and ${MEM_AT_MOST} entries written (5 statements)`, () =>
      memory.write({ projectId: TIMED, tenantId: TENANT, from: {}, through: { ...through, schema: MEM_SCHEMA + 1 }, entries: many, live: false }),
    );
    await timed('counted, with every node in the database (5 statements)', () => memory.count(TIMED));
    await timed('read back, newest first', () => memory.entries(TIMED, MEM_AT_MOST));
    check(`and all of it is stored: ${MEM_AT_MOST} entries`, same(await memoryNodes(TIMED), { MemEntry: MEM_AT_MOST, MemProject: 1 }), await memoryNodes(TIMED));
    await timed('removed (4 statements)', () => memory.purge(TIMED));
  } finally {
    for (const project of [PROJECT, TIMED, OTHER, `${OTHER}_away`, UNWRITTEN, FACTS]) {
      await graph.purgeProject(project).catch((err: Error) => console.error(`Could not remove the graph of ${project}: ${err.message}`));
      await memory.purge(project).catch((err: Error) => console.error(`Could not remove the memory of ${project}: ${err.message}`));
    }
    await reader.close();
    await closeNeo4j();
  }

  console.log(failed === 0 ? '\nEvery check passed.' : `\n${failed} check(s) failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
