/**
 * What the reading desk says where it has nothing to draw.
 *
 * Two places: the page, when the file behind it cannot be had or cannot be
 * drawn, and the list beside it, when nothing was read off the document. Both
 * are kept here, apart from the drawing, so a test can hold them.
 */

/** Why a page is not drawn. */
export type NoPage =
  /** The server answered, and not with the file. */
  | { why: 'refused'; status: number }
  /** No answer came: the connection dropped, or a file picked on this machine could not be read. */
  | { why: 'unreached'; local?: boolean }
  /** A PDF that does not open. */
  | { why: 'broken' }
  /** A picture this browser cannot draw: an iPhone's HEIC outside Safari. */
  | { why: 'undrawable' }
  /** A kind of file with no page to it: a Word file, a sheet, a recording. */
  | { why: 'pageless' };

/**
 * The sentence for a page that is not drawn, and whether asking again can end
 * differently. It can where the fetch failed and not the file: a person signs
 * in again, the connection comes back, the file is put on the record.
 */
export function noPageSaid(no: NoPage): { said: string; again: boolean } {
  switch (no.why) {
    case 'refused':
      if (no.status === 401) return { said: 'You are signed out. Sign in again to see this page.', again: true };
      if (no.status === 403) return { said: 'You do not have access to this file.', again: true };
      if (no.status === 404) return { said: 'The file is not stored on this record.', again: true };
      return { said: `The file could not be fetched (${no.status}).`, again: true };
    case 'unreached':
      return { said: no.local ? 'The file could not be read.' : 'The file could not be fetched. Check the connection.', again: true };
    case 'broken':
      return { said: 'This PDF could not be opened.', again: false };
    case 'undrawable':
      return { said: 'This browser cannot draw this picture.', again: false };
    case 'pageless':
      return { said: 'A file of this kind has no page to show here.', again: false };
  }
}

/**
 * Whether to say that nothing was read off a document: only where nothing was.
 *
 * `streamed` counts the values the reading sent as it went, `held` the values
 * on the document's row once it is filed. A filed paper opened for review has
 * none of the first and all of the second, so neither count alone can say it.
 * A reading that failed, one a model is still at, and one that left a note
 * each say their own thing instead.
 */
export function nothingRead(doc: { shown: boolean; streamed: number; held: number; notes?: string; phase: string }): boolean {
  return doc.shown && doc.streamed === 0 && doc.held === 0 && !doc.notes && doc.phase !== 'failed' && doc.phase !== 'model';
}
