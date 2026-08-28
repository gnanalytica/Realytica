/**
 * The graph in Neo4j.
 *
 * Chosen for its community rather than its benchmarks: the most tutorials, the
 * most answered questions, a first-class Apache-2.0 JS driver, and Neo4j
 * Browser — a real graph explorer on day one, which matters for a product
 * whose reasoning is meant to be looked at rather than only queried.
 *
 * Every node is written with the same label set: `:Dd` plus its kind and its
 * origin, so the two halves are separable in Cypher without reading properties.
 * `caseId` is on every node and relationship, because a single free-tier
 * instance holds every case and a traversal must not be able to wander out of
 * the one it was asked about.
 *
 * Attributes are stored as a JSON string rather than spread onto the node.
 * Neo4j properties are scalars or arrays of one scalar type, and our
 * attribute bags are heterogeneous — spreading them means a property whose
 * type differs per node, which is legal and then bites the first time a query
 * compares two of them.
 */

import neo4j, { type Driver } from 'neo4j-driver';
import type { DdEdge, DdGraph, DdNode, DdNodeKind, DdOrigin } from '@realytica/shared';
import { ddLayerFor } from '@realytica/shared';
import type { GraphAdapter } from './types';

let driver: Driver | null = null;

function client(): Driver {
  if (driver) return driver;
  const url = process.env.REALYTICA_NEO4J_URL;
  if (!url) throw new Error('REALYTICA_NEO4J_URL is not set');
  const user = process.env.REALYTICA_NEO4J_USER ?? 'neo4j';
  const password = process.env.REALYTICA_NEO4J_PASSWORD ?? '';
  driver = neo4j.driver(url, neo4j.auth.basic(user, password));
  return driver;
}

interface Row {
  id: string;
  kind: string;
  label: string;
  origin: string;
  domain: string | null;
  attributes: string;
}

function toNode(row: Row): DdNode {
  const kind = row.kind as DdNodeKind;
  return {
    id: row.id,
    kind,
    layer: ddLayerFor(kind),
    label: row.label,
    origin: row.origin as DdOrigin,
    ...(row.domain ? { domain: row.domain as DdNode['domain'] } : {}),
    attributes: JSON.parse(row.attributes) as DdNode['attributes'],
  };
}

function nodeParams(caseId: string, nodes: DdNode[]): Record<string, unknown>[] {
  return nodes.map(n => ({
    caseId,
    id: n.id,
    kind: n.kind,
    label: n.label,
    origin: n.origin,
    domain: n.domain ?? null,
    attributes: JSON.stringify(n.attributes),
  }));
}

function edgeParams(caseId: string, edges: DdEdge[], origin: DdOrigin): Record<string, unknown>[] {
  return edges.map(e => ({ caseId, id: e.id, kind: e.kind, from: e.fromNodeId, to: e.toNodeId, label: e.label, origin }));
}

/**
 * One relationship type for every edge, with the semantic kind as a property.
 *
 * The alternative is a type per edge kind, which reads better in ad-hoc Cypher
 * and cannot be parameterised — building the type name by string interpolation
 * is how a query becomes injectable. The kind is indexed, so a filtered
 * traversal costs the same.
 */
const REL = 'DD_EDGE';

const WRITE_NODES = `
  UNWIND $rows AS row
  MERGE (n:Dd { id: row.id })
  SET n.caseId = row.caseId, n.kind = row.kind, n.label = row.label,
      n.origin = row.origin, n.domain = row.domain, n.attributes = row.attributes
`;

const WRITE_EDGES = `
  UNWIND $rows AS row
  MATCH (a:Dd { id: row.from }), (b:Dd { id: row.to })
  MERGE (a)-[r:${REL} { id: row.id }]->(b)
  SET r.caseId = row.caseId, r.kind = row.kind, r.label = row.label, r.origin = row.origin
`;

export const neo4jAdapter: GraphAdapter = {
  kind: 'neo4j',

  async sync(graph: DdGraph): Promise<void> {
    const session = client().session();
    try {
      const authored = new Set(graph.nodes.filter(n => n.origin === 'authored').map(n => n.id));
      const derivedNodes = graph.nodes.filter(n => n.origin === 'derived');
      const derivedEdges = graph.edges.filter(e => !authored.has(e.fromNodeId) && !authored.has(e.toNodeId));

      /*
       * Upsert first, THEN remove what is no longer there. The obvious order —
       * delete every derived node and rewrite them — was wrong in a way only a
       * live database showed: `DETACH DELETE` takes a node's relationships with
       * it, including the authored citations pointing AT it. So a rebuild that
       * re-created the very same parcel still destroyed the edge joining a
       * reason to it, and the reason survived as an orphan. That is the
       * invariant this whole split exists to protect, failing silently.
       *
       * Merging keeps a node that is still present identical in place, so its
       * relationships are never disturbed. Only a node the rebuild genuinely
       * dropped is deleted, and losing the citation to something no longer on
       * file is correct — an edge naming an absent node is the fabricated
       * connection the projection already refuses.
       */
      await session.executeWrite(async tx => {
        if (derivedNodes.length > 0) await tx.run(WRITE_NODES, { rows: nodeParams(graph.caseId, derivedNodes) });
        if (derivedEdges.length > 0) await tx.run(WRITE_EDGES, { rows: edgeParams(graph.caseId, derivedEdges, 'derived') });
        await tx.run(
          `MATCH (n:Dd { caseId: $caseId, origin: 'derived' })
           WHERE NOT n.id IN $keep
           DETACH DELETE n`,
          { caseId: graph.caseId, keep: derivedNodes.map(n => n.id) },
        );
        // Stale derived edges between nodes that both survived — a
        // relationship the rebuild no longer draws. Scoped by origin so an
        // authored citation is never in scope for this delete.
        await tx.run(
          `MATCH (:Dd { caseId: $caseId })-[r:${REL} { caseId: $caseId, origin: 'derived' }]->(:Dd)
           WHERE NOT r.id IN $keep
           DELETE r`,
          { caseId: graph.caseId, keep: derivedEdges.map(e => e.id) },
        );
      });
    } finally {
      await session.close();
    }
  },

  async append(caseId: string, nodes: DdNode[], edges: DdEdge[]): Promise<void> {
    const authored = nodes.filter(n => n.origin === 'authored');
    if (authored.length === 0 && edges.length === 0) return;
    const session = client().session();
    try {
      await session.executeWrite(async tx => {
        if (authored.length > 0) await tx.run(WRITE_NODES, { rows: nodeParams(caseId, authored) });
        if (edges.length > 0) await tx.run(WRITE_EDGES, { rows: edgeParams(caseId, edges, 'authored') });
      });
    } finally {
      await session.close();
    }
  },

  async read(caseId: string): Promise<DdGraph | null> {
    const session = client().session();
    try {
      const nodeResult = await session.executeRead(tx =>
        tx.run(
          `MATCH (n:Dd { caseId: $caseId })
           RETURN n.id AS id, n.kind AS kind, n.label AS label, n.origin AS origin,
                  n.domain AS domain, n.attributes AS attributes
           ORDER BY n.id`,
          { caseId },
        ),
      );
      if (nodeResult.records.length === 0) return null;
      const edgeResult = await session.executeRead(tx =>
        tx.run(
          `MATCH (:Dd { caseId: $caseId })-[r:${REL} { caseId: $caseId }]->(:Dd)
           RETURN r.id AS id, r.kind AS kind, r.label AS label,
                  startNode(r).id AS fromNodeId, endNode(r).id AS toNodeId
           ORDER BY r.id`,
          { caseId },
        ),
      );
      return {
        caseId,
        builtAt: new Date().toISOString(),
        nodes: nodeResult.records.map(r => toNode(r.toObject() as unknown as Row)),
        edges: edgeResult.records.map(r => r.toObject() as unknown as DdEdge),
      };
    } finally {
      await session.close();
    }
  },

  async purge(caseId: string): Promise<void> {
    const session = client().session();
    try {
      await session.executeWrite(tx => tx.run(`MATCH (n:Dd { caseId: $caseId }) DETACH DELETE n`, { caseId }));
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
      // the product down — the case data and the projection both live
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
  const session = client().session();
  try {
    await session.executeWrite(async tx => {
      await tx.run('CREATE CONSTRAINT dd_node_id IF NOT EXISTS FOR (n:Dd) REQUIRE n.id IS UNIQUE');
      await tx.run('CREATE INDEX dd_node_case IF NOT EXISTS FOR (n:Dd) ON (n.caseId)');
      await tx.run('CREATE INDEX dd_node_origin IF NOT EXISTS FOR (n:Dd) ON (n.origin)');
      await tx.run(`CREATE INDEX dd_edge_kind IF NOT EXISTS FOR ()-[r:${REL}]-() ON (r.kind)`);
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
