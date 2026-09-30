/**
 * Getting a document's bytes, and knowing why you could not.
 *
 * The viewer has to tell three states apart, because they call for three
 * different sentences on screen: the file rendered, the record carries no
 * file at all (every demo-seeded document is in this state — the seeder
 * creates metadata without materialising bytes), and something failed. A
 * single "could not display" for all three would report the ordinary case as
 * a fault.
 */

export type DocumentSourceState =
  | { status: 'loading' }
  | { status: 'ready'; blob: Blob; contentType: string; url: string }
  | { status: 'absent' }
  | { status: 'error'; message: string };

import { evidenceFileUrl, fetchWithAuth } from '../../lib/api';

export { evidenceFileUrl };

/**
 * The served content type, taken from the RESPONSE rather than from
 * `document.mimeType`.
 *
 * The stored field is whatever the uploading client announced; the header is
 * what the server decided after looking at the bytes. Choosing a renderer
 * from the claimed type would mean handing a file to a parser that was told
 * what it is by the same party that supplied it.
 */
export function servedType(res: Response): string {
  const raw = res.headers.get('Content-Type') ?? 'application/octet-stream';
  const semi = raw.indexOf(';');
  return (semi === -1 ? raw : raw.slice(0, semi)).trim().toLowerCase();
}


export type RenderKind = 'pdf' | 'image' | 'text' | 'docx' | 'unsupported';

const OFFICE_WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Which renderer handles this served type. Unknown types are not guessed at. */
export function renderKindFor(contentType: string): RenderKind {
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType === 'text/plain') return 'text';
  if (contentType === OFFICE_WORD) return 'docx';
  return 'unsupported';
}

function mimeFromName(fileName: string): string | undefined {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'txt') return 'text/plain';
  if (ext === 'docx') return OFFICE_WORD;
  return undefined;
}

export async function fetchEvidenceFile(
  projectId: string,
  evidenceId: string,
  fileId: string,
  fileName?: string,
  claimedType?: string,
): Promise<DocumentSourceState> {
  let res: Response;
  try {
    // With the token: a plain `fetch` sends none, and the API answers 401.
    res = await fetchWithAuth(evidenceFileUrl(projectId, evidenceId, fileId, { inline: true }));
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
  if (res.status === 404) return { status: 'absent' };
  if (!res.ok) {
    return { status: 'error', message: `${res.status} ${res.statusText}` };
  }
  const blob = await res.blob();
  const served = servedType(res);
  const contentType =
    served !== 'application/octet-stream'
      ? served
      : claimedType && claimedType !== 'application/octet-stream'
        ? claimedType
        : mimeFromName(fileName ?? '') ?? served;
  return { status: 'ready', blob, contentType, url: URL.createObjectURL(blob) };
}

/**
 * Save a filed document to the reader's disk.
 *
 * A plain link to the file cannot do this once sign-in is on: following a
 * link sends no Authorization header, so the API answers 401. The bytes are
 * fetched with the session's token and handed to the browser as a download,
 * the way the Word export already is.
 */
export async function saveEvidenceFile(projectId: string, evidenceId: string, fileId: string, fileName: string): Promise<void> {
  const res = await fetchWithAuth(evidenceFileUrl(projectId, evidenceId, fileId));
  if (res.status === 404) throw new Error('The file is not stored on this record.');
  if (!res.ok) throw new Error(`The file could not be downloaded: ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
