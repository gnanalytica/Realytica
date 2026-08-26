import { Router } from 'express';
import type { SuppliedFile } from '@valytica/agents';
import {
  allDescriptors,
  applicableSources,
  extractFactsFromCase,
  recallForCase,
  runIngestionDetailed,
} from '@valytica/agents';
import { store } from '../store';
import { memoryStore } from '../memory';
import { findCase } from './cases';

/**
 * The two routes that connect a case to knowledge outside it: external data
 * coming in, and what earlier cases taught the system.
 *
 * Both are deliberately explicit rather than automatic. Ingestion reaches
 * outside the app, and memory carries party names across case boundaries —
 * neither should happen as a side effect of opening a screen.
 */

/* ------------------------------------------------------------------ */
/* Sources & ingestion                                                 */
/* ------------------------------------------------------------------ */

export const sourcesRouter = Router();

/** The whole catalogue, including the sources that cannot be reached. */
sourcesRouter.get('/', (_req, res) => {
  res.json(allDescriptors());
});

export const caseKnowledgeRouter = Router({ mergeParams: true });

/** Sources that have something to say about this specific property. */
caseKnowledgeRouter.get<{ id: string }>('/sources', (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  res.json(applicableSources(found.identity).map(s => ({
    id: s.id,
    label: s.label,
    authority: s.authority,
    kind: s.kind,
    country: s.country,
    state: s.state,
    access: s.access,
    url: s.url,
    whatItWouldHaveAnswered: s.whatItWouldHaveAnswered,
    manualRoute: s.manualRoute,
  })));
});

interface IngestBody {
  sources?: string[];
  files?: { id?: string; fileName: string; content: string; sourceId: string }[];
  /** Allow HTTP to the handful of sources the registry has verified are open. Off by default. */
  allowNetwork?: boolean;
}

caseKnowledgeRouter.post<{ id: string }>('/ingest', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const body = (req.body ?? {}) as IngestBody;
  const files: SuppliedFile[] = (body.files ?? []).map((f, i) => ({
    id: f.id ?? `supplied-${i + 1}`,
    fileName: f.fileName,
    content: f.content,
    sourceId: f.sourceId,
  }));
  if (files.some(f => !f.fileName || !f.sourceId || typeof f.content !== 'string')) {
    res.status(400).json({ error: 'Each file needs fileName, sourceId and string content.' });
    return;
  }

  const now = new Date();
  const detail = await runIngestionDetailed({
    caseData: found,
    now,
    sources: body.sources ?? 'all_applicable',
    suppliedFiles: files,
    // Off unless asked for. Reaching a public register is still reaching
    // outside the app, and that is the user's call to make per run.
    network: { enabled: body.allowNetwork === true },
  });

  const intelligence = found.intelligence ?? {
    runs: [], pathways: [], research: [], insights: [], conversation: [],
  };
  intelligence.ingestions = [...(intelligence.ingestions ?? []), detail.report];
  found.intelligence = intelligence;
  found.updatedAt = now.toISOString();
  await store.save();

  // The per-row rejections have no field on the frozen contract, so they ride
  // alongside the report rather than being flattened into a note string. A
  // truncated rejection list is a summary, not data.
  res.status(201).json({
    report: detail.report,
    rejections: detail.rejections,
    networkRequests: detail.networkRequests,
    unknownFileSourceIds: detail.unknownFileSourceIds,
  });
});

/* ------------------------------------------------------------------ */
/* Cross-case memory                                                   */
/* ------------------------------------------------------------------ */

/** What earlier cases know that bears on this one. */
caseKnowledgeRouter.get<{ id: string }>('/memory', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const recall = await recallForCase(memoryStore, found, { now: new Date().toISOString() });
  res.json(recall);
});

/**
 * Teach the store what this case establishes.
 *
 * Explicit rather than automatic on screen: a case is worth learning from
 * once its documents have been reviewed, not while a user is still uploading
 * them and correcting classifications. Re-running it is safe — assertion is
 * idempotent, so a case learned twice writes nothing the second time.
 */
caseKnowledgeRouter.post<{ id: string }>('/memory', async (req, res) => {
  const found = findCase(req.params.id);
  if (!found) {
    res.status(404).json({ error: 'Case not found' });
    return;
  }
  const now = new Date().toISOString();
  const facts = extractFactsFromCase(found, { now });
  const assertions = await memoryStore.assertMany(facts);

  const recall = await recallForCase(memoryStore, found, { now });
  const intelligence = found.intelligence ?? {
    runs: [], pathways: [], research: [], insights: [], conversation: [],
  };
  intelligence.memory = recall;
  found.intelligence = intelligence;
  found.updatedAt = now;
  await store.save();

  res.status(201).json({
    learned: facts.length,
    // Counted separately because they mean different things: a superseded
    // fact is a correction of something believed earlier, a deduplicated one
    // is this case being learned again with nothing new to say.
    superseded: assertions.filter(a => a.superseded.length > 0).length,
    deduplicated: assertions.filter(a => a.deduplicated).length,
    recall,
  });
});
