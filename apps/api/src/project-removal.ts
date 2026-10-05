/**
 * Removing a project, and everything kept about it.
 *
 * A project is gone when its documents are gone from storage: every instance
 * takes that, and nothing else, for the answer. So the documents go first,
 * and nothing else is touched until they have. A removal that went on after
 * its documents could not be removed left the project half gone: off this
 * instance's list, its grants and its graph dropped, and its document still
 * in storage, where the next instance to look found it and listed the
 * project again.
 *
 * When the documents will not go, the project stays as it was and the caller
 * is told so, in words to pass on to the person who asked.
 */

import { forgetProjects } from './memory';
import { storageAdapter } from './storage';
import { store } from './store';

/** What a person is told when a project could not be removed. */
export const PROJECT_KEPT = 'This project has not been deleted, because its files could not all be removed from storage. Try again in a moment.';

/**
 * Remove a project: `removed` when it is gone, `absent` when there is none by
 * that id, `kept` when its documents could not be removed and it is still
 * here.
 */
export async function removeProject(projectId: string): Promise<'removed' | 'absent' | 'kept'> {
  const projects = store.data.projects ?? [];
  const at = projects.findIndex((project) => project.id === projectId);
  if (at < 0) return 'absent';
  // Off the list while its documents go, so that nothing on this instance writes one of them back.
  const [project] = projects.splice(at, 1);
  try {
    await storageAdapter.deleteCaseDocuments(projectId);
  } catch (err) {
    projects.splice(at, 0, project!);
    console.warn(`[projects] could not remove the documents of ${projectId}: ${(err as Error).message}`);
    return 'kept';
  }
  // The grants written against it and what it taught the firm's recall. The
  // save this makes, and the one after it, find the project gone, document
  // and all, and drop its graph and its memory.
  await forgetProjects([projectId]);
  await store.save();
  return 'removed';
}
