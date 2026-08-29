import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { DdEdge, DdNode } from '@realytica/shared';
import { findCase } from './cases';
import { graphAdapter } from '../graph';

/**
 * The stored reasoning graph, and the one thing that lives only in it.
 *
 * Every other graph surface builds the projection on demand — the title graph
 * route says why, and it is right for anything derived: a stored projection
 * can disagree with what it describes. This route exists for the two things a
 * rebuild cannot produce.
 *
 * **`asOf`.** The projection knows only what the case says now. Only the store
 * remembers that an edge was drawn in March and stopped being drawn in July,
 * because only the store was there for both. "What did we believe when we
 * signed the March report" is a question a diligence file has to answer, and
 * it is a query here rather than an archaeology exercise.
 *
 * **Annotations.** A note an analyst writes on a node, and a link they draw by
 * hand, exist nowhere else. They are `authored`, they survive every rebuild,
 * and they are the reason the graph store is a home rather than a cache. Until
 * this route existed, everything in the graph was a copy of the case store and
 * the graph could have been deleted with no loss — which made "core reasoning
 * centre" a description of an intention rather than of the system.
 */
export const graphRouter = Router({ mergeParams: true });

graphRouter.get<{ id: string }>('/', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
  try {
    const graph = await graphAdapter.read(found.id, asOf);
    if (!graph) {
      // Not an error: a case saved before the graph store was configured, or
      // one whose first sync has not run. Distinguished from a failure so a
      // client can say "not indexed yet" rather than "something broke".
      res.status(200).json({ graph: null, reason: 'not_indexed', adapter: graphAdapter.kind });
      return;
    }
    res.json({ graph, adapter: graphAdapter.kind, asOf: asOf ?? null });
  } catch (err) {
    res.status(503).json({ error: `The graph store did not answer: ${(err as Error).message}` });
  }
});

interface AnnotationBody {
  /** The node this is about. Must already be in the graph. */
  nodeId?: unknown;
  text?: unknown;
  author?: unknown;
  /** Optional second node, to draw a link rather than leave a note. */
  linkedNodeId?: unknown;
}

graphRouter.post<{ id: string }>('/annotations', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }

  const body = req.body as AnnotationBody;
  const nodeId = typeof body.nodeId === 'string' ? body.nodeId.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const author = typeof body.author === 'string' ? body.author.trim() : '';
  const linkedNodeId = typeof body.linkedNodeId === 'string' ? body.linkedNodeId.trim() : '';
  if (!nodeId || !text) {
    res.status(400).json({ error: 'nodeId and text are both required.' });
    return;
  }

  let stored;
  try {
    stored = await graphAdapter.read(found.id);
  } catch (err) {
    res.status(503).json({ error: `The graph store did not answer: ${(err as Error).message}` });
    return;
  }
  // Checked against the STORED graph rather than a fresh projection, because
  // an annotation may legitimately hang off another annotation and those are
  // not in a projection. A note on a node that does not exist is the same
  // fabricated connection the projection refuses.
  const present = new Set((stored?.nodes ?? []).map(n => n.id));
  if (!present.has(nodeId)) {
    res.status(400).json({ error: `No node "${nodeId}" in this case's graph.` });
    return;
  }
  if (linkedNodeId && !present.has(linkedNodeId)) {
    res.status(400).json({ error: `No node "${linkedNodeId}" in this case's graph.` });
    return;
  }

  const id = `dd-note-${randomUUID()}`;
  const at = new Date().toISOString();
  const node: DdNode = {
    id,
    kind: 'thought',
    layer: 'deliberation',
    label: text,
    // The whole point. This is the one thing in the graph a rebuild cannot
    // produce, so a sync must never touch it.
    origin: 'authored',
    attributes: { at, ...(author ? { author } : {}) },
  };
  const edges: DdEdge[] = [
    { id: `dde-note-${id}-about`, kind: 'cites', fromNodeId: id, toNodeId: nodeId, label: 'note on' },
    ...(linkedNodeId
      ? [{ id: `dde-note-${id}-link`, kind: 'cites' as const, fromNodeId: id, toNodeId: linkedNodeId, label: 'links to' }]
      : []),
  ];

  try {
    await graphAdapter.append(found.id, [node], edges);
  } catch (err) {
    // 503 rather than 500: the note was not written and the caller still has
    // it. Reporting success here would lose the only copy.
    res.status(503).json({ error: `The graph store did not accept the note: ${(err as Error).message}` });
    return;
  }
  res.status(201).json({ node, edges });
});
