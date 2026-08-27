import type { Response } from 'express';
import type { CaseDocument } from '@realytica/shared';

/**
 * Serving a stored file back to the browser.
 *
 * One rule governs this file: **the response Content-Type is decided by the
 * bytes, never by `documents.mimeType`.** That field is whatever the client
 * announced at upload — it is independent of what was actually stored, so
 * echoing it back and serving the result `inline` from our own origin is
 * stored XSS: upload an HTML file announced as a PDF, and it executes with
 * the session's origin when someone opens the proof pane.
 *
 * So the type is sniffed from the leading bytes, and only a type this app can
 * actually render is served inline. Everything else — including a file whose
 * sniff and whose claimed type disagree — is sent as an attachment with
 * `nosniff`, which is a download rather than a render. That is a viewer
 * limitation, not a security theatre: a file we cannot identify is a file we
 * cannot safely display.
 */

/** The types the viewer can render, and which are therefore safe to inline. */
const INLINE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
]);

function startsWith(bytes: Buffer, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/**
 * What these bytes actually are.
 *
 * Returns null when the leading bytes match nothing known — deliberately, so
 * the caller downloads rather than guesses. Only signatures that are
 * unambiguous at the head of the file are listed; a sniff that needs context
 * to be sure is not a sniff.
 */
export function sniffContentType(bytes: Buffer): string | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf'; // %PDF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';

  // Every OOXML and ODF file is a zip. The zip signature alone cannot tell a
  // .docx from a .xlsx or from an arbitrary archive, and the distinction
  // decides whether the viewer will try to convert it — so the extension is
  // consulted ONLY within the set of things already known to be zips, by the
  // caller. Here we can honestly say no more than "a zip".
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return 'application/zip';
  }
  return null;
}

/** Office formats the viewer converts. Reached only for files that sniff as a zip. */
const ZIP_BACKED_BY_EXTENSION: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/**
 * The type to serve, and whether it may be rendered in place.
 *
 * A zip-backed Office file is named from the extension, because the container
 * cannot say which it is — but it is still never inlined: the browser has no
 * renderer for it, so it is a download here and a conversion in the client.
 */
export function resolveServedType(bytes: Buffer, fileName: string): { contentType: string; inline: boolean } {
  const sniffed = sniffContentType(bytes);
  if (!sniffed) return { contentType: 'application/octet-stream', inline: false };

  if (sniffed === 'application/zip') {
    const dot = fileName.lastIndexOf('.');
    const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : '';
    return { contentType: ZIP_BACKED_BY_EXTENSION[ext] ?? 'application/zip', inline: false };
  }

  return { contentType: sniffed, inline: INLINE_TYPES.has(sniffed) };
}

/**
 * `Content-Disposition`'s filename, ASCII-only.
 *
 * The header is latin-1, so an Indic or accented filename cannot go in it
 * literally. The plain parameter is stripped to ASCII and the real name is
 * carried in `filename*` (RFC 5987), which every current browser prefers.
 * Quotes and backslashes are removed rather than escaped — a filename is not
 * worth a parsing bug.
 */
function contentDisposition(inline: boolean, fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function sendDocumentBytes(res: Response, doc: CaseDocument, bytes: Buffer): void {
  const { contentType, inline } = resolveServedType(bytes, doc.fileName);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', contentDisposition(inline, doc.fileName));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', String(bytes.length));
  // A case document is private to whoever may read the case. Shared caches
  // must not hold it; the browser may, because the bytes never change once
  // uploaded — a new upload is a new document id.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; object-src 'none'; sandbox");
  res.end(bytes);
}
