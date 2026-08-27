import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import type { CaseDocument } from '@realytica/shared';
import { classifyDocument, extractFields } from '@realytica/shared';
import { store } from '../store';
import { storageAdapter } from '../storage';
import { documentKey } from '../storage/types';
import { updateDocumentSchema } from '../schemas';
import { findCase } from './cases';

const MAX_FILES_PER_UPLOAD = 10;
const LOCAL_MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Vercel rejects a request body over 4.5 MB at the platform edge, before the
 * function is invoked at all. Multer never sees it, so no limit set here can
 * turn that into a useful error — the client gets an opaque
 * FUNCTION_PAYLOAD_TOO_LARGE page instead.
 *
 * Rounded down to a flat 4 MiB. The documented figure is ambiguous between
 * 4.5 million bytes and 4.5 MiB, and multipart framing adds a few hundred
 * bytes per file on top of the file contents, so the exact number is not
 * worth cutting close to. A whole number of MiB also means the client can
 * quote the limit back to the user as "4.0 MB" rather than an odd figure.
 */
const VERCEL_MAX_REQUEST_BYTES = 4 * 1024 * 1024;

const onVercel = process.env.VERCEL === '1';

/**
 * What this deployment can actually accept, reported by `/api/health` so the
 * client can enforce it before sending rather than discover it from a failed
 * request. `maxRequestBytes` is the cap on one upload call: on Vercel that is
 * the platform's, everywhere else it is just however many files of the
 * maximum size are allowed at once.
 */
export const UPLOAD_LIMITS = {
  maxFiles: MAX_FILES_PER_UPLOAD,
  maxFileBytes: onVercel ? VERCEL_MAX_REQUEST_BYTES : LOCAL_MAX_FILE_BYTES,
  maxRequestBytes: onVercel ? VERCEL_MAX_REQUEST_BYTES : LOCAL_MAX_FILE_BYTES * MAX_FILES_PER_UPLOAD,
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMITS.maxFileBytes, files: MAX_FILES_PER_UPLOAD },
});

export const documentsRouter = Router({ mergeParams: true });

// mergeParams sub-routers only get the parent :id typed when we say so
// explicitly — Express infers req.params purely from this route's own path.
documentsRouter.post<{ id: string }>('/', upload.array('files', 10), async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }

  // Express 4's multer typings don't narrow `req.files` for `.array()` use —
  // one narrowing cast here, in the single place this shape is consumed.
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  try {
    const now = new Date().toISOString();
    const created: CaseDocument[] = [];
    for (const file of files) {
      const docId = randomUUID();
      const classification = classifyDocument(file.originalname, file.mimetype);
      const doc: CaseDocument = {
        id: docId,
        caseId: found.id,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedAt: now,
        kind: classification.kind,
        classificationConfidence: classification.confidence,
        kindConfirmedByUser: false,
        pages: 1,
        ocrStatus: 'complete',
        extracted: [],
      };
      doc.extracted = extractFields(doc, found.identity, found.id);
      await storageAdapter.putDocument(found.id, documentKey(doc), file.buffer, file.mimetype);
      found.documents.push(doc);
      created.push(doc);
    }

    if (found.status === 'draft') found.status = 'collecting';
    found.updatedAt = now;
    await store.save();
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: `Failed to store uploaded file(s): ${e instanceof Error ? e.message : String(e)}` });
  }
});

/**
 * What a browser may be told to render in place, and nothing else.
 *
 * `doc.mimeType` is whatever the upload declared — multer copies the
 * client-supplied part header verbatim — so it is attacker-controlled and
 * independent of the bytes actually stored. Echoing it back as the response
 * `Content-Type` while serving `inline` from this origin is stored XSS: upload
 * HTML bytes with a declared type of `text/html`, open the preview, and the
 * payload runs on the app's own origin.
 *
 * So the declared type is never trusted as a rendering instruction. It is
 * looked up in this allowlist, and anything not on it is served as an opaque
 * download instead. Every entry here is a format the browser renders in a
 * sandbox of its own rather than as script.
 */
const INLINE_RENDERABLE = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

/** Strip anything that could break out of the Content-Disposition header. */
function safeFilename(name: string): string {
  return name.replace(/[\r\n"\\]/g, '_').slice(0, 200) || 'document';
}

/**
 * Serve one uploaded document's bytes.
 *
 * Until this existed a document could be uploaded, classified, read by the
 * agents for extraction, and cited by id in the evidence ledger — and there
 * was no way for the person who uploaded it to open it again. The storage
 * adapter has had `getDocument` all along; nothing reached it over HTTP.
 *
 * The bytes are proxied through this route rather than handed out as a
 * storage URL. On the Blob adapter that URL is public and its pathname is
 * deterministic, so linking to it directly would put the file outside
 * whatever access control this app later grows; on the filesystem adapter
 * there is no URL to hand out at all. One route that reads through the
 * adapter keeps both backends behaving the same and keeps the storage
 * address server-side.
 */
documentsRouter.get<{ id: string; docId: string }>('/:docId/file', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  // Matched within the case rather than globally, so a document id from one
  // case cannot be read through another case's URL.
  const doc = found.documents.find((d) => d.id === req.params.docId);
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  let bytes: Buffer | null;
  try {
    bytes = await storageAdapter.getDocument(found.id, documentKey(doc));
  } catch (e) {
    res.status(502).json({ error: `Could not read the stored file: ${e instanceof Error ? e.message : String(e)}` });
    return;
  }
  if (!bytes) {
    // A demo-seeded document is a real row with no bytes behind it. That is a
    // specific, explainable state rather than a failure, and the client says
    // so instead of showing a broken viewer.
    res.status(404).json({ error: 'This document has no stored file — seeded demo documents carry their extracted fields only.' });
    return;
  }

  const declared = (doc.mimeType ?? '').split(';')[0].trim().toLowerCase();
  // `?download=1` forces the attachment path for a type that could otherwise
  // render, so the same URL backs both the viewer and the download button.
  const forceDownload = req.query.download === '1';
  const inline = !forceDownload && INLINE_RENDERABLE.has(declared);

  res.setHeader('Content-Type', inline ? declared : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeFilename(doc.fileName)}"`);
  res.setHeader('Content-Length', String(bytes.byteLength));
  // Belt and braces against the same class of bug: forbid MIME sniffing, so a
  // "PDF" whose bytes are HTML cannot be re-interpreted as a document.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Only on the download path — the browser's built-in PDF viewer is sensitive
  // to a restrictive CSP on the PDF response itself, and an inline response is
  // already pinned to an inert media type above.
  if (!inline) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // The bytes are immutable for a given document id — an upload creates a new
  // document, it never rewrites one — so a short private cache is what makes
  // reopening a case instant instead of re-downloading several megabytes.
  // `private` keeps it out of shared and CDN caches.
  res.setHeader('Cache-Control', 'private, max-age=900, must-revalidate');
  res.end(bytes);
});

documentsRouter.patch<{ id: string; docId: string }>('/:docId', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const doc = found.documents.find((d) => d.id === req.params.docId);
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const parsed = updateDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  if (parsed.data.kind !== undefined) {
    doc.kind = parsed.data.kind;
    doc.kindConfirmedByUser = true;
    doc.classificationConfidence = 1;
    doc.extracted = extractFields(doc, found.identity, found.id);
  }
  if (parsed.data.notes !== undefined) doc.notes = parsed.data.notes;
  found.updatedAt = new Date().toISOString();
  await store.save();
  res.json(doc);
});

documentsRouter.delete<{ id: string; docId: string }>('/:docId', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const idx = found.documents.findIndex((d) => d.id === req.params.docId);
  if (idx === -1) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  const [doc] = found.documents.splice(idx, 1);
  try {
    await storageAdapter.deleteDocument(found.id, documentKey(doc));
  } catch {
    /* demo-seeded documents (and any already-missing file) have nothing to delete */
  }
  found.updatedAt = new Date().toISOString();
  await store.save();
  res.status(204).end();
});
