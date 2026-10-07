/**
 * What one node of the project graph touches, in the words the Graph page's
 * side panel reads it out in.
 *
 * Kept apart from the canvas, with no renderer in it, because this is the
 * part of that page that says things: which way a relation reads, whether a
 * paper is in hand or still needed, which of two functions called Handover
 * is meant. Each of those can be wrong without anything looking broken, so
 * each is a plain function a test can ask.
 */

import { DEPARTMENT_SHORT, functionDepartment, projectEdgePhrase, withDepartment, type ProjectGraphEdge, type ProjectGraphNode } from '@realytica/shared';

type Kind = ProjectGraphNode['kind'];

/**
 * What a node rests on, read first: documents, then the occasions of looking
 * and the sheets placed on the ground.
 */
const SOURCE_KINDS: readonly Kind[] = ['evidence', 'site_visit', 'site_entry', 'sheet'];

export interface NodeLink {
  edgeId: string;
  /** The node at the other end. */
  otherId: string;
  /** Its name, as it is said beside others. */
  label: string;
  /** The relation in plain words, said of the node being read. */
  phrase: string;
}

/**
 * The department a function sits in, by its one word.
 *
 * A function's own word is not always a name. Legal and Commercial each have
 * a Handover, and on a card or in a list of links the two are otherwise the
 * same word twice.
 */
export function departmentWord(node: ProjectGraphNode): string | undefined {
  if (node.kind !== 'workstream' || !node.key) return undefined;
  const department = functionDepartment(node.key);
  return department ? DEPARTMENT_SHORT[department] : undefined;
}

/** A node's name where other nodes are named beside it: a function with its department, as the app writes a place. */
export function nameBeside(node: ProjectGraphNode): string {
  return node.kind === 'workstream' && node.key ? withDepartment(node.key, node.label) : node.label;
}

/** A node's second line: what kind of thing it is, the department a function sits in, then its detail. */
export function secondLine(node: ProjectGraphNode, kind: string): string {
  return [kind, departmentWord(node), node.detail].filter(Boolean).join(' · ');
}

/**
 * Everything one node touches, said from its side and gathered by the kind
 * of thing at the other end.
 *
 * An edge is stored one way round and read from both: a check `supported_by`
 * a deed "rests on" it when the check is open and "supports" it when the deed
 * is. The words come from the ontology, so no relation reaches a reader as
 * its key, and they follow the state of the record the edge reaches: a deed
 * the file is still waiting for is one the check "still needs".
 *
 * Sources come first, then the kinds in the order the lanes run, then any
 * kind neither list names. The lane order is kept by hand, and a link must
 * not go unread because its kind was never added to it.
 */
export function linksOf(
  nodeId: string,
  edges: readonly ProjectGraphEdge[],
  byId: ReadonlyMap<string, ProjectGraphNode>,
  laneOrder: readonly Kind[],
): { kind: Kind; links: NodeLink[] }[] {
  const self = byId.get(nodeId);
  if (!self) return [];
  const byKind = new Map<Kind, NodeLink[]>();
  for (const edge of edges) {
    const outward = edge.from === nodeId;
    if (!outward && edge.to !== nodeId) continue;
    const other = byId.get(outward ? edge.to : edge.from);
    if (!other) continue;
    const link = {
      edgeId: edge.id,
      otherId: other.id,
      label: nameBeside(other),
      phrase: projectEdgePhrase(edge.rel, outward ? 'forward' : 'backward', outward ? other : self),
    };
    const held = byKind.get(other.kind);
    if (held) held.push(link);
    else byKind.set(other.kind, [link]);
  }
  return [...new Set([...SOURCE_KINDS, ...laneOrder, ...byKind.keys()])].flatMap((kind) => {
    const links = byKind.get(kind);
    return links ? [{ kind, links }] : [];
  });
}
