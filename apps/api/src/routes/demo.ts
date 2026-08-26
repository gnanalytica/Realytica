import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { CaseDocument, PropertyCase } from '@realytica/shared';
import { SEED_CASES, SEED_DOCUMENT_FILENAMES, classifyDocument, extractFields, runScreen, REFERENCE_DATA } from '@realytica/shared';
import { store } from '../store';
import { storageAdapter } from '../storage';

function guessMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Build and screen every case in SEED_CASES that isn't already present
 * (matched by `identity.label`), with SEED_DOCUMENT_FILENAMES[label]
 * materialised as CaseDocument records that carry no real file on disk.
 * Returns the number of cases actually created.
 *
 * Async because persisting the seeded cases is now an awaited `store.save()`
 * rather than a fire-and-forget debounce — every caller (this file's `/seed`
 * route, and the boot-time auto-seed in `index.ts`) must await it.
 */
export async function seedDemoData(): Promise<number> {
  const existingLabels = new Set(store.data.cases.map((c) => c.identity.label));
  let created = 0;

  for (const seed of SEED_CASES) {
    if (existingLabels.has(seed.identity.label)) continue;

    const now = new Date().toISOString();
    const newCase: PropertyCase = {
      id: randomUUID(),
      reference: store.nextReference(),
      identity: seed.identity,
      status: 'draft',
      persona: seed.persona,
      ownerName: seed.ownerName,
      createdAt: now,
      updatedAt: now,
      documents: [],
      notes: seed.notes ?? '',
    };

    const fileNames = SEED_DOCUMENT_FILENAMES[seed.identity.label] ?? [];
    for (const fileName of fileNames) {
      const mimeType = guessMimeType(fileName);
      const classification = classifyDocument(fileName, mimeType);
      const doc: CaseDocument = {
        id: randomUUID(),
        caseId: newCase.id,
        fileName,
        mimeType,
        sizeBytes: 150_000 + Math.floor(Math.random() * 1_200_000),
        uploadedAt: now,
        kind: classification.kind,
        classificationConfidence: classification.confidence,
        kindConfirmedByUser: false,
        pages: 1 + Math.floor(Math.random() * 6),
        ocrStatus: 'complete',
        extracted: [],
      };
      doc.extracted = extractFields(doc, newCase.identity, newCase.id);
      newCase.documents.push(doc);
    }

    if (newCase.documents.length > 0 && newCase.status === 'draft') {
      newCase.status = 'collecting';
    }

    newCase.result = runScreen({
      caseId: newCase.id,
      reference: newCase.reference,
      identity: newCase.identity,
      documents: newCase.documents,
      refData: REFERENCE_DATA,
      now,
      project: newCase.project,
    });
    newCase.project = newCase.result.project;
    newCase.status = 'screened';
    newCase.updatedAt = now;

    store.data.cases.push(newCase);
    existingLabels.add(seed.identity.label);
    created += 1;
  }

  if (created > 0) await store.save();
  return created;
}

export const demoRouter = Router();

demoRouter.post('/seed', async (_req, res) => {
  const created = await seedDemoData();
  res.json({ created });
});

demoRouter.post('/reset', async (_req, res) => {
  store.data.cases = [];
  try {
    await storageAdapter.deleteAllDocuments();
  } catch {
    /* nothing stored yet — reset still succeeds */
  }
  await store.save();
  res.json({ ok: true });
});
