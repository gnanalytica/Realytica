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
 * only statement of its own is one read, of the labels the adapter left.
 *
 *   pnpm probe:neo4j bolt://localhost:7687
 *
 * The address is taken from the command line and from nowhere else. The user,
 * password and database are read as the app reads them, from
 * `REALYTICA_NEO4J_USER`, `REALYTICA_NEO4J_PASSWORD` and
 * `REALYTICA_NEO4J_DATABASE`.
 *
 * What it leaves behind. It creates the app's constraints and indexes, as a
 * boot does, and they stay: they are the app's own, one of them is the
 * constraint that keeps a project to one marker, and a database the app has
 * booted against has them already. Everything else it writes is two projects
 * of its own, under ids no real project has, and it removes both before it
 * ends, whether or not a check failed.
 *
 * After the checks it times a sync of a project the size of a real one, about
 * 200 nodes and 300 links, three ways: drawn for the first time, drawn again
 * from a later copy that changed, and offered again unchanged. A save waits
 * for its sync for `GRAPH_WAIT_MS` (see `apps/api/src/graph/sync.ts`); a sync
 * that takes longer is finished after the reply. The figures are from the
 * machine this runs on, not from where the app is hosted.
 *
 * The port's whole contract runs against the same database with the scrub
 * left out:
 *
 *   REALYTICA_NEO4J_URL=bolt://localhost:7687 pnpm exec tsx --test test/graph-store.test.ts
 */
import neo4j from 'neo4j-driver';
import { PROJECT_NODE_KINDS, projectLayerFor, type ProjectGraphEdge, type ProjectGraphNode } from '@realytica/shared';
import type { GraphSyncRefused, ProjectGraphSnapshot } from '../apps/api/src/graph/types';

const PROJECT = `prj_probe_${Date.now().toString(16)}`;
const TIMED = `${PROJECT}_timed`;

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
  } finally {
    for (const project of [PROJECT, TIMED]) {
      await graph.purgeProject(project).catch((err: Error) => console.error(`Could not remove ${project}: ${err.message}`));
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
