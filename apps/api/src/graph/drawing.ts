/**
 * What a sync would draw of a project, as one short string.
 *
 * A graph store keeps it beside the revision its stored graph was built from.
 * Offered the same drawing again it has nothing to write, and that is what
 * makes it cheap to ask whether a project's graph is behind: almost always it
 * is not, and the answer costs one statement instead of a redraw. Offered a
 * different drawing at the revision it holds, it redraws. One copy of a
 * project is drawn two ways only when the code that draws it has changed.
 *
 * Taken over exactly what a sync writes of a snapshot, in an order that does
 * not depend on the order the snapshot was built in.
 */

import { createHash } from 'node:crypto';
import type { ProjectGraphEdge, ProjectGraphNode } from '@realytica/shared';

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** `nodes` and `edges` are the derived half of a snapshot: the half a sync replaces. */
export function drawingOf(nodes: ProjectGraphNode[], edges: ProjectGraphEdge[]): string {
  const drawn = [
    [...nodes].sort(byId).map((n) => [n.id, n.kind, n.layer, n.label, n.detail ?? null, n.key ?? null, n.status ?? null]),
    [...edges].sort(byId).map((e) => [e.id, e.rel, e.from, e.to]),
  ];
  return createHash('sha256').update(JSON.stringify(drawn)).digest('hex');
}
