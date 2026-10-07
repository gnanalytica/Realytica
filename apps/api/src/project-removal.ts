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
 * While the documents go the project is off this instance's list, and the
 * store reads none of them back onto it (`Store.takeOff`): a page left open
 * on the project asks for it about once a second, and removing a project's
 * files can take longer than that. Nor does it write one back: a save of the
 * project already on its way to storage is let land before the documents are
 * removed, and none is begun after. A removal that answered while such a
 * write was still out left a document in storage for a project nothing
 * listed.
 *
 * Once the removal has ended this instance lets go of the project
 * (`Store.letGo`). Nothing in storage says a project was removed, so another
 * instance that still held it can save its document back, and the project
 * comes back with it: this instance then reads it as it reads any other, and
 * removes it when asked again.
 *
 * When the documents will not go, the project stays as it was and the caller
 * is told so, in words to pass on to the person who asked. Its own document
 * may be among what did go, so it is written again before the caller is
 * told: kept has to mean kept wherever the project is next looked for.
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
  // Off the list while its documents go, so that nothing on this instance writes one of them back or reads one back.
  const taken = store.takeOff(projectId);
  if (!taken) return 'absent';
  // A write of its document that was already on its way lands first, and is removed with the rest.
  await store.written(projectId);
  try {
    await storageAdapter.deleteCaseDocuments(projectId);
  } catch (err) {
    store.putBack(taken);
    console.warn(`[projects] could not remove the documents of ${projectId}: ${(err as Error).message}`);
    // Put back as unsaved, and saved here. If storage will not take that either, the next save writes it.
    await store.save().catch((failed: unknown) => {
      console.warn(`[projects] could not write ${projectId} again after its removal failed: ${(failed as Error).message}`);
    });
    return 'kept';
  }
  // The grants written against it and what it taught the firm's recall. The
  // save this makes, and the one after it, find the project gone, document
  // and all, and drop its graph and its memory.
  await forgetProjects([projectId]);
  await store.save();
  // Only once that save has ended: it is the one that takes the project out of the index. Had it failed, this is not
  // reached, the project stays as one this instance is removing, and its next save takes it out of the index.
  store.letGo(projectId);
  return 'removed';
}
