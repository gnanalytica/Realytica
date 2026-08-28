/**
 * The graph as an append-only file, and the reason every other adapter can be
 * treated as disposable.
 *
 * Derived nodes are held per case and replaced on every sync — cheap, because
 * they are a function of the case store and a rebuild costs nothing but time.
 * Authored records are appended and never rewritten, so the file is a replay
 * log: point a fresh Neo4j at it and the reasoning comes back.
 *
 * This is the default deliberately. Every hosted graph free tier deletes an
 * idle instance — Aura after a paused spell, FalkorDB's free tier after a
 * week and with no persistence at all — and a reasoning record that evaporated
 * because nobody logged in for a month is worse than never having had a graph.
 * The journal makes that outcome an inconvenience instead of a loss.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DdEdge, DdGraph, DdNode } from '@realytica/shared';
import type { GraphAdapter } from './types';
import { DATA_DIR } from '../storage/filesystem';

interface CaseRecord {
  derived: { nodes: DdNode[]; edges: DdEdge[] };
  /** Append-only. Keyed by node id so a replay cannot double up. */
  authored: { nodes: Record<string, DdNode>; edges: Record<string, DdEdge> };
  builtAt: string;
}

type JournalFile = Record<string, CaseRecord>;

const FILE = path.join(DATA_DIR, 'graph-journal.json');

async function readAll(): Promise<JournalFile> {
  try {
    return JSON.parse(await readFile(FILE, 'utf8')) as JournalFile;
  } catch {
    // A missing or unreadable journal is an empty one. The authored half is
    // rebuilt from the case's own conversation on the next projection, so
    // this is recoverable rather than fatal — which is the whole design.
    return {};
  }
}

// Writes are serialised through one chain for the same reason the case store
// serialises its own: two requests resolving close together would otherwise
// interleave read-modify-write and lose one of them.
let queue: Promise<void> = Promise.resolve();
function serialise<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function writeAll(data: JournalFile): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, FILE);
}

function emptyRecord(builtAt: string): CaseRecord {
  return { derived: { nodes: [], edges: [] }, authored: { nodes: {}, edges: {} }, builtAt };
}

export const journalAdapter: GraphAdapter = {
  kind: 'journal',

  async sync(graph: DdGraph): Promise<void> {
    await serialise(async () => {
      const all = await readAll();
      const record = all[graph.caseId] ?? emptyRecord(graph.builtAt);
      const authoredIds = new Set(graph.nodes.filter(n => n.origin === 'authored').map(n => n.id));
      record.derived = {
        nodes: graph.nodes.filter(n => n.origin === 'derived'),
        // An edge touching an authored node belongs to the authored half, or a
        // sync would drop the joins that make deliberation traversable.
        edges: graph.edges.filter(e => !authoredIds.has(e.fromNodeId) && !authoredIds.has(e.toNodeId)),
      };
      record.builtAt = graph.builtAt;
      all[graph.caseId] = record;
      await writeAll(all);
    });
  },

  async append(caseId: string, nodes: DdNode[], edges: DdEdge[]): Promise<void> {
    await serialise(async () => {
      const all = await readAll();
      const record = all[caseId] ?? emptyRecord(new Date().toISOString());
      for (const node of nodes) {
        // Refused rather than coerced: a caller appending a derived node is
        // confused about which half it is writing, and silently relabelling it
        // would put something rebuildable into the half that is never rebuilt.
        if (node.origin !== 'authored') continue;
        record.authored.nodes[node.id] = node;
      }
      for (const edge of edges) record.authored.edges[edge.id] = edge;
      all[caseId] = record;
      await writeAll(all);
    });
  },

  async read(caseId: string): Promise<DdGraph | null> {
    const all = await readAll();
    const record = all[caseId];
    if (!record) return null;
    const nodes = [...record.derived.nodes, ...Object.values(record.authored.nodes)];
    const present = new Set(nodes.map(n => n.id));
    // An authored edge outlives the sync that removed the node it pointed at,
    // because the journal is append-only and never rewrites. So dangling ones
    // are dropped on the way out rather than deleted on the way in: the reason
    // is kept (somebody wrote it; a document leaving the case does not un-write
    // it) and the fabricated connection is not returned. Neo4j gets this for
    // free from DETACH DELETE, and the two must agree or the port is a lie.
    const edges = [...record.derived.edges, ...Object.values(record.authored.edges)]
      .filter(e => present.has(e.fromNodeId) && present.has(e.toNodeId));
    return { caseId, builtAt: record.builtAt, nodes, edges };
  },

  async purge(caseId: string): Promise<void> {
    await serialise(async () => {
      const all = await readAll();
      delete all[caseId];
      await writeAll(all);
    });
  },

  async healthy(): Promise<boolean> {
    return true;
  },
};
