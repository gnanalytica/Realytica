/**
 * The one way anything enters the project's memory.
 *
 * Every entry is passed through `scrubMemEntry` here, whoever made it and
 * whether or not it was scrubbed before: what reaches a store is an entry's
 * own properties and nothing else, with no words from a page or a chat, no
 * file, no email, and no identity number, phone number or account number in
 * its label. An entry that cannot be brought to that is left out. A fact is
 * held to its own rule the same way (`scrubMemFact`): a key on a fixed list,
 * a value in that key's form, and nothing of what is never kept.
 *
 * A note of the assistant's comes in through `writeThought` and through
 * nothing else. It is scrubbed as a note is: one sentence, tagged as a
 * thought by `memThought` and held to that here, so nothing reaches a store
 * through this door that is tagged as anything else.
 *
 * It writes in this build's schema and no other, and says whether the
 * writer is the live site, because what a writer may write over depends on
 * both; see `shapeRule`.
 */

import { MEM_ENTRY_KINDS, MEM_SCHEMA, MEM_THOUGHTS_KEPT, scrubMemEntry, scrubMemFact, type MemDelta, type MemFact, type MemWatermark } from '@realytica/shared';
import type { MemoryPort, MemWriteAnswer, MemWriter } from './types';

/**
 * Who this deployment is to memory: the shape its build writes, and whether
 * it is the live site.
 *
 * The live site is the deployment Vercel runs as production. Vercel names
 * the kind of deployment, and gives every deployment it runs the address it
 * is served at. Both are asked for, because the name alone is not enough: a
 * machine that has been handed production's settings (`vercel env pull`
 * writes them to a file, the name among them) has the name and an empty
 * address, and may be pointed at the live site's database. So a preview is
 * not the live site, and neither is a laptop, a test or a probe, whatever
 * settings it runs with.
 */
export function memWriter(env: NodeJS.ProcessEnv = process.env): MemWriter {
  return { schema: MEM_SCHEMA, live: env.VERCEL_ENV === 'production' && Boolean(env.VERCEL_URL?.trim()) };
}

/**
 * Write what `delta` tells, if memory stands where `from` says.
 *
 * `from` is where the caller believes the project's memory stands, as the
 * store last told it. `tenantId` is the workspace the project belongs to.
 * `live` is whether the writer is the live site: this deployment's own answer
 * unless a caller says otherwise, which is how the rule is tested.
 */
export async function writeMemory(
  port: MemoryPort,
  tenantId: string,
  from: MemWatermark,
  delta: MemDelta,
  live: boolean = memWriter().live,
): Promise<MemWriteAnswer> {
  const entries = delta.entries.flatMap((entry) => {
    const clean = scrubMemEntry(delta.projectId, entry);
    return clean ? [clean] : [];
  });
  const forget = (delta.forget ?? []).filter((kind) => MEM_ENTRY_KINDS.includes(kind));
  const changes = delta.factChanges;
  const factChanges = changes && {
    // Told from the record, so never a thought: those have a way in of their own.
    put: changes.put.flatMap((fact) => {
      const clean = fact.tag === 'thought' ? undefined : scrubMemFact(delta.projectId, fact);
      return clean ? [clean] : [];
    }),
    drop: changes.drop.filter((id) => typeof id === 'string'),
  };
  return port.write({
    projectId: delta.projectId,
    tenantId,
    from,
    through: { ...delta.through, schema: MEM_SCHEMA },
    entries,
    ...(forget.length ? { forget } : {}),
    ...(factChanges ? { factChanges } : {}),
    live,
  });
}

/**
 * Keep a note of the assistant's. What is offered is scrubbed again, and one
 * that is not a note, or is under another project's id, writes nothing. The
 * project keeps its newest `MEM_THOUGHTS_KEPT`.
 */
export async function writeThought(
  port: MemoryPort,
  tenantId: string,
  projectId: string,
  thought: MemFact,
  live: boolean = memWriter().live,
): Promise<MemWriteAnswer> {
  const clean = thought.tag === 'thought' ? scrubMemFact(projectId, thought) : undefined;
  if (!clean) return { written: 0 };
  return port.think({ projectId, tenantId, thought: clean, schema: MEM_SCHEMA, live, keep: MEM_THOUGHTS_KEPT });
}
