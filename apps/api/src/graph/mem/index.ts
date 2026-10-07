/**
 * Which store holds the project's memory on this deployment.
 *
 * Neo4j wherever the graph database is configured, the file beside the
 * project store everywhere else. A preview deployment is not an exception:
 * its projection of the graph is detached (see `../preview.ts`), because a
 * branch that draws the graph differently would redraw the live site's, and
 * memory has no such hazard. An entry is told from the record by a rule that
 * gives every build of one shape the same entry under the same id, and is
 * never rewritten, so a preview and the live site in the same shape write
 * the same thing. A branch that tells the record differently has a shape of
 * its own, and which shape may be written over which is the stores' rule
 * (`shapeRule` in `types.ts`).
 *
 * A host with no graph database configured is not refused here. `../index.ts`
 * already refuses to boot a serverless host without one, and memory is told
 * from the record, so a file that is lost is told again.
 */

import { journalMemory } from './journal';
import type { MemoryPort } from './types';

async function selectPort(): Promise<MemoryPort> {
  if (!process.env.REALYTICA_NEO4J_URL?.trim()) return journalMemory;
  return (await import('./neo4j')).neo4jMemory;
}

export const memoryPort: MemoryPort = await selectPort();

export type { MemoryPort } from './types';
