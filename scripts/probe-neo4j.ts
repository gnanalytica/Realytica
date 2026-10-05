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
 * own statements are two reads, of the labels the adapter left and of how
 * many memory nodes a project has, and the older build's statements below.
 *
 * It then does the same for the project's memory, which is kept in the same
 * database under labels of its own (`apps/api/src/graph/mem/`): that entries
 * written twice are there once and as first told, that the watermark moves
 * with them, that a write from where memory no longer stands is turned away
 * and so is one over a later shape, that a deployment which may not raise
 * the shape writes nothing over an earlier one, that a value is kept under
 * its key with the fixed list's name for it, that a write which lets go of
 * the chat turns takes those entries and no other, that the nodes of a
 * project's memory and of the whole database are counted, that two writers
 * of one project's memory at once leave one write, and that a write cannot
 * move a node to another project. And it runs the statements of the build the live site runs, which
 * knows only the graph, against the same project: its sync and its purge,
 * copied from `apps/api/src/graph/neo4j.ts` on `main`. They must leave every
 * memory node as it was, and this build's purge must then remove them all.
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
  MEM_CHAT_KINDS,
  MEM_SCHEMA,
  PROJECT_NODE_KINDS,
  STANDARD_FACT_KEYS,
  addEvidence,
  addFinding,
  createProject,
  memoryDelta,
  projectLayerFor,
  type DdProject,
  type MemEntry,
  type ProjectGraphEdge,
  type ProjectGraphNode,
} from '@realytica/shared';
import type { GraphSyncRefused, ProjectGraphSnapshot } from '../apps/api/src/graph/types';

const PROJECT = `prj_probe_${Date.now().toString(16)}`;
const TIMED = `${PROJECT}_timed`;
/** A second project, for the write that tries to take a node of the first. */
const OTHER = `${PROJECT}_other`;
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
  const { writeMemory } = await import('../apps/api/src/graph/mem/write');

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
    check('a first write of memory is taken', same(await writeMemory(memory, TENANT, {}, told), { written: 3 }));
    const first = await memory.entries(PROJECT, 100);
    check('and its entries are stored, newest first', same(first.map((e) => e.id).sort(), told.entries.map((e) => e.id).sort()) && first.every((e, i) => i === 0 || first[i - 1]!.at >= e.at), first.map((e) => e.kind));
    check('each as it was told, with nothing added', same([...first].sort((a, b) => a.id.localeCompare(b.id)), [...told.entries].sort((a, b) => a.id.localeCompare(b.id))), first[0]);
    check('one node a project and one an entry, and no other', same(await memoryNodes(PROJECT), { MemEntry: 3, MemProject: 1 }), await memoryNodes(PROJECT));
    check('the watermark stands where the write ended', same((await memory.watermarks([PROJECT])).get(PROJECT), told.through), [...(await memory.watermarks([PROJECT]))]);

    check('the same entries written again are taken', same(await writeMemory(memory, TENANT, told.through, memoryDelta(project, {})), { written: 3 }));
    check('and are there once, as they were first told', same(await memory.entries(PROJECT, 100), first) && same(await memoryNodes(PROJECT), { MemEntry: 3, MemProject: 1 }), await memoryNodes(PROJECT));
    const changed = { ...told, entries: told.entries.map((e) => ({ ...e, kind: 'paper_read' as const, label: 'Changed' })) };
    await writeMemory(memory, TENANT, told.through, changed);
    check('an entry offered again saying something else is left as it was first told', same(await memory.entries(PROJECT, 100), first));

    addFinding(project, { title: 'A later finding', description: 'Made up.', severity: 'low', discipline: 'legal' }, 'probe@example.com');
    const next = memoryDelta(project, told.through);
    check('a write of what came after is taken', next.entries.length === 1 && same(await writeMemory(memory, TENANT, told.through, next), { written: 1 }));
    check('and the watermark moves with it', same((await memory.watermarks([PROJECT])).get(PROJECT), next.through) && (await memory.entries(PROJECT, 100)).length === 4);
    const stale = await writeMemory(memory, TENANT, told.through, { ...next, entries: [entry(PROJECT, 'stale')] });
    check('a write from where memory no longer stands is turned away, and told where it stands', same(stale, { moved: next.through }), stale);
    check('and writes nothing', (await memory.entries(PROJECT, 100)).length === 4 && same((await memory.watermarks([PROJECT])).get(PROJECT), next.through));

    // A value accepted, and a question and its answer.
    const valued: MemEntry = { ...entry(PROJECT, 'aud_probe_value'), kind: 'value_accepted', key: 'extent_khata', label: 'words of the caller’s own' };
    const chats: MemEntry[] = [
      { ...entry(PROJECT, 'cht_probe_1'), kind: 'chat_asked', about: [] },
      { ...entry(PROJECT, 'cht_probe_2'), kind: 'chat_answered', about: [] },
    ];
    const asked = { ...next.through, turnThrough: 'cht_probe_2' };
    check('a write of a value and two chat turns is taken', same(await writeMemory(memory, TENANT, next.through, { projectId: PROJECT, through: asked, entries: [valued, ...chats] }), { written: 3 }));
    const kept = (await memory.entries(PROJECT, 100)).find((e) => e.id === valued.id);
    check('the value is stored under its key, with the fixed list’s name for it and not the caller’s words', kept?.key === 'extent_khata' && kept.label === STANDARD_FACT_KEYS.extent_khata!.label, kept);
    const counted = await memory.count(PROJECT);
    check('the project’s memory is counted: seven entries and the node that says where it stands', counted.project === 8, counted);
    check('and so is every node the database holds, the graph’s included', counted.database > counted.project, counted);
    const forgotten = await writeMemory(memory, TENANT, asked, { projectId: PROJECT, through: next.through, entries: [], forget: [...MEM_CHAT_KINDS] });
    check('a write that lets go of the chat turns is taken', same(forgotten, { written: 0 }), forgotten);
    const left = await memory.entries(PROJECT, 100);
    check('and takes those entries and no other', left.length === 5 && left.every((e) => !MEM_CHAT_KINDS.includes(e.kind)) && left.some((e) => e.id === valued.id), left.map((e) => e.kind));
    check('and the watermark stands at no turn', same((await memory.watermarks([PROJECT])).get(PROJECT), next.through), [...(await memory.watermarks([PROJECT]))]);

    const taking = await memory.write({ projectId: OTHER, tenantId: TENANT, from: {}, through: { schema: MEM_SCHEMA, auditThrough: 'aud_other' }, entries: [{ ...first[0]!, about: ['taken'] }, entry(PROJECT, 'not_yet_told')], mayRaise: true });
    const mine = await memory.entries(PROJECT, 100);
    check('a write for another project that names this one’s entries writes none of them', same(taking, { written: 0 }) && same(await memoryNodes(OTHER), { MemProject: 1 }), [taking, await memoryNodes(OTHER)]);
    const away = await memory.write({ projectId: `${OTHER}_away`, tenantId: TENANT, from: { auditThrough: 'aud_nowhere' }, through: { schema: MEM_SCHEMA, auditThrough: 'aud_1' }, entries: [], mayRaise: true });
    check('a write that is turned away leaves nothing behind, not even the node it took', same(away, { moved: {} }) && same(await memoryNodes(`${OTHER}_away`), {}), [away, await memoryNodes(`${OTHER}_away`)]);
    check('and this project’s entries are as they were', mine.length === 5 && mine.some((e) => e.id === first[0]!.id && same(e.about, first[0]!.about)), mine.length);

    // Two writers of one project's memory at once, from the same place. One
    // is taken and the other is told memory has moved, whichever the database
    // runs first: the second waits on the node the first holds.
    let stands = next.through;
    let oneTaken = true;
    for (let round = 0; round < 10 && oneTaken; round += 1) {
      const writers = ['a', 'b'].map((name) => ({ schema: MEM_SCHEMA, auditThrough: `aud_race_${round}_${name}`, ...(stands.turnThrough ? { turnThrough: stands.turnThrough } : {}) }));
      const answers = await Promise.all(writers.map((through) => memory.write({ projectId: PROJECT, tenantId: TENANT, from: stands, through, entries: [entry(PROJECT, `${through.auditThrough}`)], mayRaise: true })));
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

    // A build with a later shape. To it, memory in this build's shape stands nowhere. On a preview it may not raise it.
    const raised = { ...stands, schema: MEM_SCHEMA + 1 };
    const preview = await memory.write({ projectId: PROJECT, tenantId: TENANT, from: {}, through: raised, entries: [entry(PROJECT, 'preview')], mayRaise: false });
    check('a deployment that may not raise the shape is turned away, and told which shape memory holds', same(preview, { lower: MEM_SCHEMA }), preview);
    check('and writes nothing', (await memory.entries(PROJECT, 100)).length === 15 && same((await memory.watermarks([PROJECT])).get(PROJECT), stands));
    const unwritten = await memory.write({ projectId: TIMED, tenantId: TENANT, from: {}, through: { schema: MEM_SCHEMA + 1, auditThrough: 'aud_preview' }, entries: [entry(TIMED, 'preview')], mayRaise: false });
    check('nor does it write a later shape where nothing is written yet, or leave a node behind for having asked', same(unwritten, { lower: 0 }) && same(await memoryNodes(TIMED), {}), [unwritten, await memoryNodes(TIMED)]);
    const later = await memory.write({ projectId: PROJECT, tenantId: TENANT, from: {}, through: raised, entries: [], mayRaise: true });
    check('the live site’s write in a later shape is taken over memory in this one', same(later, { written: 0 }), later);
    const lower = await writeMemory(memory, TENANT, stands, { projectId: PROJECT, through: stands, entries: [entry(PROJECT, 'lower')] });
    check('a write in a lower shape than memory holds is turned away, and told which shape it holds', same(lower, { newer: MEM_SCHEMA + 1 }), lower);
    check('and writes nothing', (await memory.entries(PROJECT, 100)).length === 15);

    await memory.purge(PROJECT);
    check('this build’s purge removes every memory node of the project', same(await memoryNodes(PROJECT), {}), await memoryNodes(PROJECT));
    check('and leaves the graph, which has a purge of its own', same(await stored(), ['a', 'b']), await stored());
    check('a project with no memory reads as one that was never told', (await memory.entries(PROJECT, 100)).length === 0 && !(await memory.watermarks([PROJECT])).has(PROJECT));
    check('and is not listed among the projects that have memory', !(await memory.projects()).some((row) => row.projectId === PROJECT));

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
    await timed('written for the first time (2 statements)', () => memory.write({ projectId: TIMED, tenantId: TENANT, from: {}, through, entries: many, mayRaise: true }));
    await timed('written again, every entry already there (2 statements)', () => memory.write({ projectId: TIMED, tenantId: TENANT, from: through, through, entries: many, mayRaise: true }));
    await timed('counted, with every node in the database (5 statements)', () => memory.count(TIMED));
    await timed('read back, newest first', () => memory.entries(TIMED, MEM_AT_MOST));
    check(`and all of it is stored: ${MEM_AT_MOST} entries`, same(await memoryNodes(TIMED), { MemEntry: MEM_AT_MOST, MemProject: 1 }), await memoryNodes(TIMED));
    await timed('removed (4 statements)', () => memory.purge(TIMED));
  } finally {
    for (const project of [PROJECT, TIMED, OTHER, `${OTHER}_away`]) {
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
