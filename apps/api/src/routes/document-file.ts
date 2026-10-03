/**
 * Serving a stored file back to the browser.
 *
 * One rule governs this file: **the response Content-Type is decided by the
 * bytes, never by `documents.mimeType`.** That field is whatever the client
 * announced at upload — multer copies the part header verbatim — so it is
 * attacker-controlled and independent of what was actually stored. Echoing it
 * back and serving the result `inline` from our own origin is stored XSS:
 * upload HTML announced as a PDF, and it executes with the session's origin
 * when someone opens the proof pane.
 *
 * So the type is sniffed from the leading bytes, and only a type this app can
 * actually render is served inline. Everything else — including a file whose
 * sniff and whose claimed type disagree — is sent as an attachment with
 * `nosniff`, which is a download rather than a render. That is a viewer
 * limitation, not security theatre: a file we cannot identify is a file we
 * cannot safely display.
 */

/** The types the viewer can render, and which are therefore safe to inline. */
const INLINE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'text/plain',
]);

function startsWith(bytes: Buffer, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/** ASCII at a byte offset — used for the ISO-BMFF brand that identifies HEIC. */
function asciiAt(bytes: Buffer, offset: number, length: number): string {
  if (bytes.length < offset + length) return '';
  return bytes.subarray(offset, offset + length).toString('latin1');
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
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, 8, 4) === 'WEBP') return 'image/webp';

  // HEIC/HEIF is an ISO base media file: a `ftyp` box at offset 4, then the
  // brand. Site photographs off an iPhone arrive in this format and nothing
  // else in the head of the file distinguishes it from an MP4.
  if (asciiAt(bytes, 4, 4) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 4);
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'heim' || brand === 'heis') return 'image/heic';
    if (brand === 'mif1' || brand === 'msf1') return 'image/heif';
  }

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
 *
 * `forceDownload` is the `?download=1` path: the same URL backs the viewer
 * and the download button, so a type that *could* render still has to be
 * servable as an attachment on request.
 */
export function resolveServedType(
  bytes: Buffer,
  fileName: string,
  forceDownload = false,
): { contentType: string; inline: boolean } {
  const sniffed = sniffContentType(bytes);
  if (!sniffed) return { contentType: 'application/octet-stream', inline: false };

  if (sniffed === 'application/zip') {
    const dot = fileName.lastIndexOf('.');
    const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : '';
    return { contentType: ZIP_BACKED_BY_EXTENSION[ext] ?? 'application/zip', inline: false };
  }

  if (forceDownload) return { contentType: 'application/octet-stream', inline: false };
  return { contentType: sniffed, inline: INLINE_TYPES.has(sniffed) };
}

/**
 * `Content-Disposition`'s filename, ASCII-only.
 *
 * The header is latin-1, so an Indic or accented filename cannot go in it
 * literally. The plain parameter is stripped to ASCII and the real name is
 * carried in `filename*` (RFC 5987), which every current browser prefers.
 * Quotes, backslashes and newlines are removed rather than escaped — a
 * filename is not worth a header-injection bug.
 */
export function documentDisposition(inline: boolean, fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '').slice(0, 200) || 'document';
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
