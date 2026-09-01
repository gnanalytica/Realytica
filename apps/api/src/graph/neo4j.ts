/**
 * The graph in Neo4j.
 *
 * Chosen for its community rather than its benchmarks: the most tutorials, the
 * most answered questions, a first-class Apache-2.0 JS driver, and Neo4j
 * Browser — a real graph explorer on day one, which matters for a product
 * whose reasoning is meant to be looked at rather than only queried.
 *
 * Every node carries `:Ryt` plus a label for its KIND, its LAYER and its
 * ORIGIN, so the halves are separable in Cypher without reading properties:
 * `MATCH (n:Ryt:parcel)` and `MATCH (n:Ryt:authored)` both work, which is what
 * makes the Browser usable by someone who does not have this file open. The
 * header used to claim exactly that and the Cypher only ever wrote `:Ryt` —
 * the claim is now true rather than aspirational, and `writeNodes` is the one
 * place that decides it.
 *
 * Labels cannot be parameterised in Cypher, which is why they are interpolated
 * from the ontology's own frozen arrays rather than from row data. A kind that
 * is not in `PROJECT_NODE_KINDS` never reaches a query string.
 *
 * `projectId` is on every node and relationship, because a single free-tier
 * instance holds every file and a traversal must not be able to wander out of
 * the one it was asked about.
 */

import neo4j, { type Driver } from 'neo4j-driver';
import type { ProjectGraphEdge, ProjectGraphNode } from '@realytica/shared';
import {
  clampGraphHops,
  isProjectNodeKind,
  PROJECT_NODE_KINDS,
  projectLayerFor,
} from '@realytica/shared';
import type { GraphAdapter, ProjectGraphSnapshot } from './types';

let driver: Driver | null = null;

/**
 * The database to run against, or undefined for the server's default.
 *
 * Aura hands out a credentials file naming a database, and on a free instance
 * that name is the instance id rather than `neo4j` — so a session opened
 * without one runs against whatever the server calls default, which is not
 * necessarily the database the credentials describe. That failure is not
 * loud: the write either errors with a database name nobody set, or succeeds
 * somewhere nobody looks.
 */
function database(): string | undefined {
  const name = process.env.REALYTICA_NEO4J_DATABASE?.trim();
  return name ? name : undefined;
}

/** Every session goes through here, so the database cannot be set in one place and forgotten in another. */
function openSession() {
  const name = database();
  return name ? client().session({ database: name }) : client().session();
}

function client(): Driver {
  if (driver) return driver;
  /*
   * Trimmed, all of them. A credential pasted with a trailing newline is
   * ordinary — a dashboard textarea, a `printf` with one `\n` too many, a copy
   * that took the line ending with it — and every one of these fails opaquely
   * when it happens. A URL with a newline reports "could not perform
   * discovery, no routing servers available", which reads as a network or
   * instance problem and sends you to look at the wrong thing entirely; a
   * password with one is an authentication failure against a password that
   * looks correct in the dashboard.
   */
  const url = process.env.REALYTICA_NEO4J_URL?.trim();
  if (!url) throw new Error('REALYTICA_NEO4J_URL is not set');
  const user = process.env.REALYTICA_NEO4J_USER?.trim() || 'neo4j';
  const password = process.env.REALYTICA_NEO4J_PASSWORD?.trim() ?? '';
  driver = neo4j.driver(url, neo4j.auth.basic(user, password));
  return driver;
}

/**
 * One relationship type for every edge, with the semantic kind as a property.
 *
 * The alternative is a type per edge kind, which reads better in ad-hoc Cypher
 * and cannot be parameterised — building the type name by string interpolation
 * is how a query becomes injectable. The kind is indexed, so a filtered
 * traversal costs the same.
 */
const REL = 'RYT_EDGE';

interface NodeRow {
  id: string;
  kind: string;
  layer: string;
  origin: string;
  label: string;
  detail: string | null;
}

function toNode(row: NodeRow): ProjectGraphNode {
  const kind = isProjectNodeKind(row.kind) ? row.kind : 'thought';
  return {
    id: row.id,
    kind,
    layer: projectLayerFor(kind),
    origin: row.origin === 'authored' ? 'authored' : 'derived',
    label: row.label,
    ...(row.detail ? { detail: row.detail } : {}),
  };
}

function nodeParams(projectId: string, nodes: ProjectGraphNode[]): Record<string, unknown>[] {
  return nodes.map(n => ({
    projectId,
    id: n.id,
    kind: n.kind,
    layer: n.layer,
    origin: n.origin,
    label: n.label,
    detail: n.detail ?? null,
  }));
}

function edgeParams(projectId: string, edges: ProjectGraphEdge[], origin: 'derived' | 'authored'): Record<string, unknown>[] {
  return edges.map(e => ({ projectId, id: e.id, kind: e.rel, from: e.from, to: e.to, origin }));
}

/** The distinct layers, for the blanket label removal below. */
const LAYERS = [...new Set(PROJECT_NODE_KINDS.map(projectLayerFor))];

/**
 * Node upsert.
 *
 * Cypher cannot set a label from a parameter, so the labels are applied in a
 * second pass (`labelStatements`) that interpolates them from the ontology's
 * own arrays. This statement clears the whole closed vocabulary first:
 * `REMOVE` of a label a node does not have is a no-op, and without it a node
 * whose kind changed between two syncs would answer `MATCH (n:Ryt:check)`
 * forever after it stopped being one.
 */
const WRITE_NODES = `
  UNWIND $rows AS row
  MERGE (n:Ryt { id: row.id })
  SET n.projectId = row.projectId, n.kind = row.kind, n.layer = row.layer,
      n.origin = row.origin, n.label = row.label, n.detail = row.detail
  REMOVE n:${[...PROJECT_NODE_KINDS].join(':')}
  REMOVE n:${LAYERS.join(':')}
  REMOVE n:derived:authored
`;

const WRITE_EDGES = `
  UNWIND $rows AS row
  MATCH (a:Ryt { id: row.from }), (b:Ryt { id: row.to })
  MERGE (a)-[r:${REL} { id: row.id }]->(b)
  SET r.projectId = row.projectId, r.kind = row.kind, r.origin = row.origin
  // Re-drawing an edge reopens it: the same relationship asserted again is the
  // same edge, not a second one.
  REMOVE r.closedAt
`;

/**
 * The per-kind label pass.
 *
 * One statement per kind rather than one per node: `$rows` is filtered to the
 * kind in the query, so a sync of 400 nodes across 12 kinds costs 12 round
 * trips inside one transaction rather than 400. Generated from the ontology,
 * so a new kind cannot be added without this following it.
 */
function labelStatements(): { kind: string; cypher: string }[] {
  return PROJECT_NODE_KINDS.map(kind => ({
    kind,
    cypher: `
      UNWIND $rows AS row
      MATCH (n:Ryt { id: row.id })
      SET n:${kind}:${projectLayerFor(kind)}
    `,
  }));
}

const ORIGIN_LABELS = `
  UNWIND $rows AS row
  MATCH (n:Ryt { id: row.id })
  SET n:derived
`;

const AUTHORED_LABELS = `
  UNWIND $rows AS row
  MATCH (n:Ryt { id: row.id })
  SET n:authored
`;

async function writeNodes(
  tx: { run: (q: string, p?: Record<string, unknown>) => Promise<unknown> },
  projectId: string,
  nodes: ProjectGraphNode[],
): Promise<void> {
  if (nodes.length === 0) return;
  const rows = nodeParams(projectId, nodes);
  await tx.run(WRITE_NODES, { rows });
  for (const { kind, cypher } of labelStatements()) {
    const forKind = rows.filter(r => r.kind === kind);
    if (forKind.length > 0) await tx.run(cypher, { rows: forKind });
  }
  const derived = rows.filter(r => r.origin === 'derived');
  const authored = rows.filter(r => r.origin === 'authored');
  if (derived.length > 0) await tx.run(ORIGIN_LABELS, { rows: derived });
  if (authored.length > 0) await tx.run(AUTHORED_LABELS, { rows: authored });
}

export const neo4jAdapter: GraphAdapter = {
  kind: 'neo4j',

  async syncProject(snapshot: ProjectGraphSnapshot): Promise<void> {
    const session = openSession();
    try {
      const authored = new Set(snapshot.nodes.filter(n => n.origin === 'authored').map(n => n.id));
      const derivedNodes = snapshot.nodes.filter(n => n.origin === 'derived');
      const derivedEdges = snapshot.edges.filter(e => !authored.has(e.from) && !authored.has(e.to));

      /*
       * Upsert first, THEN remove what is no longer there. The obvious order —
       * delete every derived node and rewrite them — was wrong in a way only a
       * live database showed: `DETACH DELETE` takes a node's relationships with
       * it, including the authored annotations pointing AT it. So a rebuild
       * that re-created the very same check still destroyed the edge joining a
       * note to it, and the note survived as an orphan. That is the invariant
       * this whole split exists to protect, failing silently.
       *
       * Merging keeps a node that is still present identical in place, so its
       * relationships are never disturbed. Only a node the rebuild genuinely
       * dropped is deleted, and losing the annotation on something no longer
       * on file is correct — an edge naming an absent node is the fabricated
       * connection the projection already refuses.
       */
      await session.executeWrite(async tx => {
        await writeNodes(tx, snapshot.projectId, derivedNodes);
        if (derivedEdges.length > 0) {
          await tx.run(WRITE_EDGES, { rows: edgeParams(snapshot.projectId, derivedEdges, 'derived') });
        }
        await tx.run(
          `MATCH (n:Ryt { projectId: $projectId, origin: 'derived' })
           WHERE NOT n.id IN $keep
           DETACH DELETE n`,
          { projectId: snapshot.projectId, keep: derivedNodes.map(n => n.id) },
        );
        // A derived edge the rebuild no longer draws is CLOSED, not deleted.
        // The file changed; the edge was not wrong, and "what did this finding
        // rest on in March" is a question a diligence file has to answer.
        // Scoped by origin so an authored annotation is never in scope.
        await tx.run(
          `MATCH (:Ryt { projectId: $projectId })-[r:${REL} { projectId: $projectId, origin: 'derived' }]->(:Ryt)
           WHERE NOT r.id IN $keep AND r.closedAt IS NULL
           SET r.closedAt = $closedAt`,
          { projectId: snapshot.projectId, keep: derivedEdges.map(e => e.id), closedAt: snapshot.builtAt },
        );
      });
    } finally {
      await session.close();
    }
  },

  async appendProject(projectId, nodes, edges): Promise<void> {
    const authored = nodes.filter(n => n.origin === 'authored');
    if (authored.length === 0 && edges.length === 0) return;
    const session = openSession();
    try {
      await session.executeWrite(async tx => {
        await writeNodes(tx, projectId, authored);
        if (edges.length > 0) await tx.run(WRITE_EDGES, { rows: edgeParams(projectId, edges, 'authored') });
      });
    } finally {
      await session.close();
    }
  },

  async readProject(projectId, asOf): Promise<ProjectGraphSnapshot | null> {
    const session = openSession();
    try {
      const nodeResult = await session.executeRead(tx =>
        tx.run(
          `MATCH (n:Ryt { projectId: $projectId })
           RETURN n.id AS id, n.kind AS kind, n.layer AS layer, n.origin AS origin,
                  n.label AS label, n.detail AS detail
           ORDER BY n.id`,
          { projectId },
        ),
      );
      if (nodeResult.records.length === 0) return null;
      // Open now, or open at the instant asked about. Expressed as one query
      // with a null `asOf` rather than two, so the two cannot drift.
      const edgeResult = await session.executeRead(tx =>
        tx.run(
          `MATCH (:Ryt { projectId: $projectId })-[r:${REL} { projectId: $projectId }]->(:Ryt)
           WHERE r.closedAt IS NULL OR ($asOf IS NOT NULL AND r.closedAt > $asOf)
           RETURN r.id AS id, startNode(r).id AS from, endNode(r).id AS to, r.kind AS rel
           ORDER BY r.id`,
          { projectId, asOf: asOf ?? null },
        ),
      );
      return {
        projectId,
        builtAt: new Date().toISOString(),
        nodes: nodeResult.records.map(r => toNode(r.toObject() as unknown as NodeRow)),
        edges: edgeResult.records.map(r => r.toObject() as unknown as ProjectGraphEdge),
      };
    } finally {
      await session.close();
    }
  },

  async neighbourhood(projectId: string, seedIds: string[], hops: number): Promise<ProjectGraphSnapshot | null> {
    const depth = clampGraphHops(hops);
    const session = openSession();
    try {
      const nodeResult = await session.executeRead(tx =>
        tx.run(
          `MATCH (seed:Ryt { projectId: $projectId })
           WHERE seed.id IN $seeds
           MATCH (seed)-[:${REL}*0..${depth}]-(n:Ryt { projectId: $projectId })
           RETURN DISTINCT n.id AS id, n.kind AS kind, n.layer AS layer, n.origin AS origin,
                  n.label AS label, n.detail AS detail
           ORDER BY n.id`,
          { projectId, seeds: seedIds },
        ),
      );
      if (nodeResult.records.length === 0) return null;
      let keep = nodeResult.records.map(r => r.get('id') as string);
      const alarmResult = await session.executeRead(tx =>
        tx.run(
          `MATCH (n:Ryt { projectId: $projectId })-[:${REL} { projectId: $projectId }]-(alarm:Ryt { projectId: $projectId })
           WHERE n.id IN $keep AND (
             (alarm.kind = 'finding' AND (toLower(coalesce(alarm.detail, '')) CONTAINS 'critical' OR toLower(coalesce(alarm.detail, '')) CONTAINS 'high'))
             OR (alarm.kind = 'risk' AND toLower(coalesce(alarm.detail, '')) CONTAINS 'critical')
             OR (alarm.kind = 'check' AND (toLower(coalesce(alarm.detail, '')) CONTAINS 'missing_evidence' OR toLower(coalesce(alarm.detail, '')) CONTAINS 'non_compliant'))
           )
           RETURN DISTINCT alarm.id AS id, alarm.kind AS kind, alarm.layer AS layer, alarm.origin AS origin,
                  alarm.label AS label, alarm.detail AS detail`,
          { projectId, keep },
        ),
      );
      const extra = alarmResult.records.filter(r => !keep.includes(r.get('id') as string));
      const nodeRecords = extra.length > 0 ? [...nodeResult.records, ...extra] : nodeResult.records;
      keep = nodeRecords.map(r => r.get('id') as string);
      const edgeResult = await session.executeRead(tx =>
        tx.run(
          `MATCH (a:Ryt { projectId: $projectId })-[r:${REL} { projectId: $projectId }]->(b:Ryt { projectId: $projectId })
           WHERE a.id IN $keep AND b.id IN $keep AND r.closedAt IS NULL
           RETURN r.id AS id, a.id AS from, b.id AS to, r.kind AS rel
           ORDER BY r.id`,
          { projectId, keep },
        ),
      );
      return {
        projectId,
        builtAt: new Date().toISOString(),
        nodes: nodeRecords.map(r => toNode(r.toObject() as unknown as NodeRow)),
        edges: edgeResult.records.map(r => r.toObject() as unknown as ProjectGraphEdge),
      };
    } finally {
      await session.close();
    }
  },

  async purgeProject(projectId: string): Promise<void> {
    const session = openSession();
    try {
      await session.executeWrite(tx => tx.run(`MATCH (n:Ryt { projectId: $projectId }) DETACH DELETE n`, { projectId }));
    } finally {
      await session.close();
    }
  },

  async healthy(): Promise<boolean> {
    try {
      await client().verifyConnectivity();
      return true;
    } catch {
      // Reported, never thrown. A graph store being unreachable must not take
      // the product down — the project data and the projection both live
      // elsewhere, and this is an index over them.
      return false;
    }
  },
};

/**
 * Constraints and indexes. Idempotent, run once at boot.
 *
 * The unique constraint on `id` is what makes MERGE a real upsert rather than
 * a scan, and without it a second sync duplicates every node — silently, and
 * only visibly once a traversal returns each fact twice.
 */
export async function ensureNeo4jSchema(): Promise<void> {
  const session = openSession();
  try {
    await session.executeWrite(async tx => {
      await tx.run('CREATE CONSTRAINT ryt_node_id IF NOT EXISTS FOR (n:Ryt) REQUIRE n.id IS UNIQUE');
      await tx.run('CREATE INDEX ryt_node_project IF NOT EXISTS FOR (n:Ryt) ON (n.projectId)');
      await tx.run('CREATE INDEX ryt_node_kind IF NOT EXISTS FOR (n:Ryt) ON (n.kind)');
      await tx.run('CREATE INDEX ryt_node_origin IF NOT EXISTS FOR (n:Ryt) ON (n.origin)');
      await tx.run(`CREATE INDEX ryt_edge_kind IF NOT EXISTS FOR ()-[r:${REL}]-() ON (r.kind)`);
      await tx.run(`CREATE INDEX ryt_edge_open IF NOT EXISTS FOR ()-[r:${REL}]-() ON (r.closedAt)`);
    });
  } finally {
    await session.close();
  }
}

/** Closes the driver's pool. Tests and shutdown paths only. */
export async function closeNeo4j(): Promise<void> {
  await driver?.close();
  driver = null;
}
