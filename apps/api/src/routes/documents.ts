import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import type { CaseDocument } from '@valytica/shared';
import { classifyDocument, extractFields } from '@valytica/shared';
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
