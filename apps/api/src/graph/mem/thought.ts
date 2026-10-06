/**
 * Keeping what the assistant concluded in a reply.
 *
 * A reply carries its note itself, as one last line the chat takes off it
 * before anybody reads the reply. So a note costs no second call to a model.
 * It is kept after the reply is out, and nothing waits on it: a note that
 * could not be kept is logged and lost, and the reply is the same reply.
 *
 * Only for the firm's own people. Somebody working from a grant sees a part
 * of the project, and what the assistant concluded from a part is not
 * written into the memory of the whole.
 */

import { memThought, memThoughtAbout, type DdProject, type MemPlace } from '@realytica/shared';
import { memoryPort } from './index';
import type { MemoryPort } from './types';
import { writeThought } from './write';

export interface NoteToKeep {
  /** The sentence the reply asked to keep. */
  note: string;
  /** The id the reply named as what the note is about, if it named one. */
  about?: string;
  /** The reply the note came with, and when it was given. */
  turnId: string;
  at: string;
  /** The page the question was asked on. */
  place?: MemPlace;
  /** What the reply had to do with: the check the sitting was on, and the records the reply cited. A note is filed under one of these or under the project. */
  sitting?: { checkId?: string };
  cited?: readonly string[];
}

/**
 * Keep one note. `project` is the record as the person who asked may see it,
 * and `tenantId` the workspace it belongs to. Settles whatever happens: the
 * caller has already replied.
 */
export async function keepThought(project: DdProject, tenantId: string, said: NoteToKeep, port: MemoryPort = memoryPort): Promise<void> {
  try {
    const thought = memThought(project.id, {
      note: said.note,
      aboutId: memThoughtAbout(project, said.about, { sitting: said.sitting, cited: said.cited }),
      turnId: said.turnId,
      at: said.at,
      place: said.place,
    });
    // Not a sentence memory may keep: too long, more than a line, or carrying what is never kept.
    if (!thought) return;
    const answer = await writeThought(port, tenantId, project.id, thought);
    if ('newer' in answer || 'lower' in answer || 'full' in answer) {
      console.warn(`[memory] a note on ${project.id} was not kept: ${'full' in answer ? 'the store is full' : 'this build may not write the memory held'}`);
    }
  } catch (err) {
    console.warn(`[memory] a note on ${project.id} was not kept: ${(err as Error).message}`);
  }
}
