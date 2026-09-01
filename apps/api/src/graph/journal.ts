/**
 * The graph as an append-only file, and the reason every other adapter can be
 * treated as disposable.
 *
 * Derived nodes are held per project and replaced on every sync — cheap,
 * because they are a function of the project registers and a rebuild costs
 * nothing but time. Authored records are appended and never rewritten, so the
 * file is a replay log: point a fresh Neo4j at it and the annotations come
 * back.
 *
 * This is the default deliberately. Every hosted graph free tier deletes an
 * idle instance — Aura after a paused spell, FalkorDB's free tier after a
 * week and with no persistence at all — and a reasoning record that evaporated
 * because nobody logged in for a month is worse than never having had a graph.
 * The journal makes that outcome an inconvenience instead of a loss.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectGraphEdge, ProjectGraphNode } from '@realytica/shared';
import { clampGraphHops, extractProjectSubgraph } from '@realytica/shared';
import type { GraphAdapter, ProjectGraphSnapshot } from './types';
import { DATA_DIR } from '../storage/filesystem';

interface ProjectRecord {
  derived: { nodes: ProjectGraphNode[]; edges: ProjectGraphEdge[] };
  /** Append-only. Keyed by id so a replay cannot double up. */
  authored: { nodes: Record<string, ProjectGraphNode>; edges: Record<string, ProjectGraphEdge> };
  builtAt: string;
}

type ProjectJournalFile = Record<string, ProjectRecord>;

const FILE = path.join(DATA_DIR, 'project-graph-journal.json');

async function readAll(): Promise<ProjectJournalFile> {
  try {
    return JSON.parse(await readFile(FILE, 'utf8')) as ProjectJournalFile;
  } catch {
    // A missing or unreadable journal is an empty one. The derived half is
    // rebuilt from the project's own registers on the next projection, so
    // this is recoverable rather than fatal — which is the whole design.
    return {};
  }
}

// Writes are serialised through one chain for the same reason the project
// store serialises its own: two requests resolving close together would
// otherwise interleave read-modify-write and lose one of them.
let queue: Promise<void> = Promise.resolve();
function serialise<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function writeAll(data: ProjectJournalFile): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, FILE);
}

function emptyRecord(builtAt: string): ProjectRecord {
  return { derived: { nodes: [], edges: [] }, authored: { nodes: {}, edges: {} }, builtAt };
}

/** Whether an edge was open at `asOf` — or is open now, when no instant is given. */
function openAt(edge: ProjectGraphEdge, asOf?: string): boolean {
  return asOf ? !edge.closedAt || edge.closedAt > asOf : !edge.closedAt;
}

export const journalAdapter: GraphAdapter = {
  kind: 'journal',

  async syncProject(snapshot: ProjectGraphSnapshot): Promise<void> {
    await serialise(async () => {
      const all = await readAll();
      const record = all[snapshot.projectId] ?? emptyRecord(snapshot.builtAt);
      const authoredIds = new Set(snapshot.nodes.filter(n => n.origin === 'authored').map(n => n.id));
      const incoming = snapshot.edges.filter(e => !authoredIds.has(e.from) && !authoredIds.has(e.to));
      const incomingIds = new Set(incoming.map(e => e.id));
      const closedAt = snapshot.builtAt;

      // An edge the rebuild no longer draws is CLOSED, not deleted. The file
      // changed; the edge was not wrong. Keeping it with a timestamp is what
      // lets the graph answer "what did this finding rest on in March" —
      // deleting it answers that with silence, which in a diligence file is
      // the wrong answer rather than no answer.
      const closed = record.derived.edges
        .filter(e => !incomingIds.has(e.id))
        .map(e => (e.closedAt ? e : { ...e, closedAt }));
      // A re-drawn edge REOPENS: the same relationship asserted again is the
      // same edge, not a second one, so the stale timestamp comes off.
      const reopened = incoming.map(e => {
        const { closedAt: _was, ...open } = e;
        return open;
      });

      record.derived = {
        nodes: snapshot.nodes.filter(n => n.origin === 'derived'),
        edges: [...reopened, ...closed],
      };
      record.builtAt = snapshot.builtAt;
      all[snapshot.projectId] = record;
      await writeAll(all);
    });
  },

  async appendProject(projectId, nodes, edges): Promise<void> {
    await serialise(async () => {
      const all = await readAll();
      const record = all[projectId] ?? emptyRecord(new Date().toISOString());
      for (const node of nodes) {
        // Refused rather than coerced: a caller appending a derived node is
        // confused about which half it is writing, and silently relabelling it
        // would put something rebuildable into the half that is never rebuilt.
        if (node.origin !== 'authored') continue;
        record.authored.nodes[node.id] = node;
      }
      for (const edge of edges) record.authored.edges[edge.id] = edge;
      // An id is derived from its endpoints, so the same id IS the same edge.
      // Neo4j gets that from MERGE on id; here the two halves are separate
      // maps and would otherwise hold two copies, which read would return as
      // a duplicate.
      record.derived.edges = record.derived.edges.filter(e => !(e.id in record.authored.edges));
      all[projectId] = record;
      await writeAll(all);
    });
  },

  async readProject(projectId, asOf): Promise<ProjectGraphSnapshot | null> {
    const all = await readAll();
    const record = all[projectId];
    if (!record) return null;
    const nodes = [...record.derived.nodes, ...Object.values(record.authored.nodes)];
    const present = new Set(nodes.map(n => n.id));
    // An authored edge outlives the sync that removed the node it pointed at,
    // because the journal is append-only and never rewrites. So dangling ones
    // are dropped on the way out rather than deleted on the way in: the note
    // is kept (somebody wrote it; a register row leaving the file does not
    // un-write it) and the fabricated connection is not returned. Neo4j gets
    // this for free from DETACH DELETE, and the two must agree or the port is
    // a lie.
    const edges = [...record.derived.edges, ...Object.values(record.authored.edges)]
      .filter(e => openAt(e, asOf))
      .filter(e => present.has(e.from) && present.has(e.to));
    return { projectId, builtAt: record.builtAt, nodes, edges };
  },

  async neighbourhood(projectId, seedIds, hops): Promise<ProjectGraphSnapshot | null> {
    const stored = await journalAdapter.readProject(projectId);
    if (!stored) return null;
    const sub = extractProjectSubgraph(stored, seedIds, clampGraphHops(hops));
    return { projectId, builtAt: stored.builtAt, nodes: sub.nodes, edges: sub.edges };
  },

  async purgeProject(projectId): Promise<void> {
    await serialise(async () => {
      const all = await readAll();
      delete all[projectId];
      await writeAll(all);
    });
  },

  async healthy(): Promise<boolean> {
    return true;
  },
};
