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

export function documentFileUrl(caseId: string, documentId: string): string {
  return `/api/cases/${caseId}/documents/${documentId}/file`;
}

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

export async function fetchDocument(caseId: string, documentId: string): Promise<DocumentSourceState> {
  let res: Response;
  try {
    res = await fetch(documentFileUrl(caseId, documentId));
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }

  if (!res.ok) {
    let code = '';
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body?.code) code = body.code;
      if (body?.error) message = body.error;
    } catch {
      /* a non-JSON error body tells us nothing more than the status did */
    }
    if (code === 'file_not_stored') return { status: 'absent' };
    return { status: 'error', message };
  }

  const blob = await res.blob();
  return { status: 'ready', blob, contentType: servedType(res), url: URL.createObjectURL(blob) };
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
