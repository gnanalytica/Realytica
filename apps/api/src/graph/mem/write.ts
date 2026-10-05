/**
 * The one way anything enters the project's memory.
 *
 * Every entry is passed through `scrubMemEntry` here, whoever made it and
 * whether or not it was scrubbed before: what reaches a store is an entry's
 * own properties and nothing else, with no words from a page or a chat, no
 * file, no email, and no identity number, phone number or account number in
 * its label. An entry that cannot be brought to that is left out.
 *
 * It writes in this build's schema and no other. A store that holds a higher
 * one answers that it does, and nothing is written: an older build stands
 * down rather than write an older shape into a newer memory. And it says
 * whether this deployment is one that may raise the schema a project's
 * memory holds, which a preview is not; see `shapeRefused`.
 */

import { MEM_ENTRY_KINDS, MEM_SCHEMA, scrubMemEntry, type MemDelta, type MemWatermark } from '@realytica/shared';
import { isPreviewDeployment } from '../preview';
import type { MemoryPort, MemWriteAnswer } from './types';

/**
 * Write what `delta` tells, if memory stands where `from` says.
 *
 * `from` is where the caller believes the project's memory stands, as the
 * store last told it. `tenantId` is the workspace the project belongs to.
 */
export async function writeMemory(port: MemoryPort, tenantId: string, from: MemWatermark, delta: MemDelta): Promise<MemWriteAnswer> {
  const entries = delta.entries.flatMap((entry) => {
    const clean = scrubMemEntry(delta.projectId, entry);
    return clean ? [clean] : [];
  });
  const forget = (delta.forget ?? []).filter((kind) => MEM_ENTRY_KINDS.includes(kind));
  return port.write({
    projectId: delta.projectId,
    tenantId,
    from,
    through: { ...delta.through, schema: MEM_SCHEMA },
    entries,
    ...(forget.length ? { forget } : {}),
    mayRaise: !isPreviewDeployment(),
  });
}
