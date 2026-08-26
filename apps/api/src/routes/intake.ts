import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { z } from 'zod';
import { REFERENCE_DATA, classifyDocument, extractFields, runScreen } from '@realytica/shared';
import type { CaseDocument, IntakeSession, PropertyCase } from '@realytica/shared';
import { commitDraft, intakeModelAvailable, openingTurn, readDraft, runIntakeTurn } from '@realytica/agents';
import { toCaseSummary } from './cases';
import { store } from '../store';
import { ensureSiteContext } from '../site-context';
import { storageAdapter } from '../storage';
import { documentKey } from '../storage/types';

/**
 * The conversational front door.
 *
 * A session is a draft plus a transcript, and it is deliberately not a case:
 * nothing here appears on the dashboard, in a comparison, or in the case list
 * until the user presses build. Someone who opens the chat, types two messages
 * and leaves has created nothing to clean up.
 *
 * Every response carries the session *and* its readout, computed on read. The
 * client never derives what to ask next or whether the draft is ready, so the
 * chat and the API cannot come to different conclusions about the same draft.
 */
export const intakeRouter = Router();

const MAX_INTAKE_FILE_BYTES = 4 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_INTAKE_FILE_BYTES, files: 5 } });

/** Sessions that produced a case, or that nobody touched for a fortnight. */
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function sessions(): IntakeSession[] {
  if (!store.data.intakeSessions) store.data.intakeSessions = [];
  return store.data.intakeSessions;
}

/**
 * Drop what is finished or abandoned.
 *
 * Run on create rather than on a timer, because a serverless instance has no
 * timer worth trusting. A committed session is kept briefly so the chat can
 * still show its own transcript on the hand-off screen, then goes.
 */
function prune(now: number): void {
  store.data.intakeSessions = sessions().filter(s => now - Date.parse(s.updatedAt) < SESSION_TTL_MS);
}

function find(id: string): IntakeSession | undefined {
  return sessions().find(s => s.id === id);
}

/** The one shape every route in this file returns. */
function envelope(session: IntakeSession) {
  const now = new Date().toISOString();
  return { session, readout: readDraft(session, REFERENCE_DATA, now) };
}

intakeRouter.post('/', async (_req, res) => {
  prune(Date.now());
  const now = new Date().toISOString();
  const session: IntakeSession = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    // The opener is deterministic and says whether a model is configured, so
    // the first thing a user reads is already honest about what they are
    // talking to.
    turns: [{ id: randomUUID(), role: 'assistant', text: openingTurn(intakeModelAvailable()), at: now }],
    fields: [],
    documents: [],
  };
  sessions().push(session);
  await store.save();
  res.status(201).json(envelope(session));
});

intakeRouter.get<{ id: string }>('/:id', (req, res) => {
  const session = find(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'That conversation has expired or never existed.' });
    return;
  }
  res.json(envelope(session));
});

const messageSchema = z.object({ message: z.string().min(1).max(4000) });

intakeRouter.post<{ id: string }>('/:id/turns', async (req, res) => {
  const session = find(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'That conversation has expired or never existed.' });
    return;
  }
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }

  const now = new Date().toISOString();
  session.turns.push({ id: randomUUID(), role: 'user', text: parsed.data.message, at: now });

  const result = await runIntakeTurn({
    sessionId: session.id,
    message: parsed.data.message,
    fields: session.fields,
    documents: session.documents,
    history: session.turns.slice(0, -1),
    refData: REFERENCE_DATA,
    caseId: session.caseId,
    // One conversation is the whole front door: it starts a case, and it finds
    // one that already exists.
    lookupCases: () => store.data.cases.map(toCaseSummary),
    now,
  });

  session.fields = result.fields;
  session.turns.push(result.turn);
  session.updatedAt = now;
  // Nothing to record here: the provider wrapper installed by `initTelemetry`
  // times and prices every model call at the point it is made, so an intake
  // turn appears in the cost view without this route knowing telemetry exists.
  await store.save();

  res.json({ ...envelope(session), rejected: result.rejected });
});

/**
 * Set a particular directly.
 *
 * The path the option buttons use, and the only way to answer anything when no
 * model is configured. Marked `stated` because a person pressing a labelled
 * button is stating it as plainly as typing it.
 */
const setFieldSchema = z.object({
  path: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  saidAs: z.string().max(200).optional(),
});

intakeRouter.post<{ id: string }>('/:id/fields', async (req, res) => {
  const session = find(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'That conversation has expired or never existed.' });
    return;
  }
  const parsed = setFieldSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  const now = new Date().toISOString();
  const { applyCapture } = await import('@realytica/agents');
  const { fields, captured, rejected } = applyCapture(
    session.fields,
    [{ path: parsed.data.path, value: parsed.data.value, provenance: 'stated', saidAs: parsed.data.saidAs }],
    now,
  );
  if (captured.length === 0) {
    res.status(400).json({ error: rejected[0]?.reason ?? 'That is not a particular this intake captures.' });
    return;
  }
  session.fields = fields;
  session.updatedAt = now;
  await store.save();
  res.json(envelope(session));
});

/** Confirm an inference, which is the only thing that turns one into an answer. */
intakeRouter.post<{ id: string; path: string }>('/:id/fields/:path/confirm', async (req, res) => {
  const session = find(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'That conversation has expired or never existed.' });
    return;
  }
  const field = session.fields.find(f => f.path === req.params.path);
  if (!field) {
    res.status(404).json({ error: 'Nothing has been captured for that particular.' });
    return;
  }
  field.confirmed = true;
  session.updatedAt = new Date().toISOString();
  await store.save();
  res.json(envelope(session));
});

intakeRouter.delete<{ id: string; path: string }>('/:id/fields/:path', async (req, res) => {
  const session = find(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'That conversation has expired or never existed.' });
    return;
  }
  session.fields = session.fields.filter(f => f.path !== req.params.path);
  session.updatedAt = new Date().toISOString();
  await store.save();
  res.json(envelope(session));
});

/**
 * Documents handed over during the conversation, before a case holds them.
 *
 * Stored against the session id so the bytes survive the hand-off: `commit`
 * moves them onto the new case rather than asking the user to upload twice.
 */
intakeRouter.post<{ id: string }>('/:id/documents', upload.array('files', 5), async (req, res) => {
  const session = find(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'That conversation has expired or never existed.' });
    return;
  }
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }
  const now = new Date().toISOString();
  try {
    for (const file of files) {
      const classification = classifyDocument(file.originalname, file.mimetype);
      const doc: CaseDocument = {
        id: randomUUID(),
        caseId: session.id,
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
      await storageAdapter.putDocument(session.id, documentKey(doc), file.buffer, file.mimetype);
      session.documents.push(doc);
    }
    session.updatedAt = now;
    await store.save();
    res.status(201).json(envelope(session));
  } catch (e) {
    res.status(500).json({ error: `Failed to store the file(s): ${e instanceof Error ? e.message : String(e)}` });
  }
});

const commitSchema = z.object({
  ownerName: z.string().max(200).optional(),
  persona: z.enum(['property_investor', 'developer_acquisition_manager', 'property_adviser', 'valuation_firm']).optional(),
});

/**
 * Build the case.
 *
 * The only route here that creates anything, and it exists as its own explicit
 * press rather than as something a turn can trigger — a model reading "yes go
 * ahead" out of a sentence is an interpretation of consent, not consent.
 *
 * Runs the screen immediately, because the whole promise of the conversation
 * is that the numbers the user has been reading are the real ones. Landing
 * them in an unscreened workspace would make that a lie at the last step.
 */
intakeRouter.post<{ id: string }>('/:id/commit', async (req, res) => {
  const session = find(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'That conversation has expired or never existed.' });
    return;
  }
  const parsed = commitSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    return;
  }
  if (parsed.data.ownerName) session.ownerName = parsed.data.ownerName;
  if (parsed.data.persona) session.persona = parsed.data.persona;

  const now = new Date().toISOString();
  const outcome = commitDraft(session, REFERENCE_DATA, now);
  if (!outcome.ok) {
    res.status(409).json({ error: outcome.reason, missing: outcome.missing });
    return;
  }

  const caseId = randomUUID();
  const documents: CaseDocument[] = [];
  for (const doc of session.documents) {
    // Re-keyed onto the case, then re-extracted: `extractFields` reads against
    // the case identity, which did not exist when the file arrived.
    const moved: CaseDocument = { ...doc, caseId };
    try {
      const bytes = await storageAdapter.getDocument(session.id, documentKey(doc));
      if (bytes) await storageAdapter.putDocument(caseId, documentKey(moved), bytes, doc.mimeType);
    } catch {
      /* the record survives even when the bytes do not; the document still counts as received */
    }
    documents.push(moved);
  }

  const newCase: PropertyCase = {
    id: caseId,
    reference: store.nextReference(),
    identity: outcome.request.identity,
    status: 'collecting',
    persona: outcome.request.persona,
    ownerName: outcome.request.ownerName,
    createdAt: now,
    updatedAt: now,
    documents,
    notes: outcome.request.notes ?? '',
  };
  for (const doc of newCase.documents) {
    doc.extracted = extractFields(doc, newCase.identity, caseId);
  }
  // The case is pushed to the store below, so this mutates a local object —
  // `siteContext` rides along with it into the store on the same save.
  const siteContext = await ensureSiteContext(newCase, now);
  newCase.result = runScreen({
    caseId,
    reference: newCase.reference,
    identity: newCase.identity,
    documents: newCase.documents,
    refData: REFERENCE_DATA,
    now,
    siteContext,
    project: newCase.project,
  });
  newCase.project = newCase.result.project;
  newCase.status = 'screened';

  store.data.cases.push(newCase);
  session.caseId = caseId;
  session.updatedAt = now;
  await store.save();

  res.status(201).json({ ...envelope(session), case: newCase, unconfirmed: outcome.unconfirmed });
});
