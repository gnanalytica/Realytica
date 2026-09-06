/**
 * Document intelligence on a project ingest — citations on the file card,
 * filename classify as fallback. Nothing is filed until a person approves.
 */

import { randomUUID } from 'node:crypto';
import type { AgentRun, AgentStep, CaseDocument, ChatIngestFile, DdProject, TurnSpend } from '@realytica/shared';
import { failureCause, projectToIdentity } from '@realytica/shared';
import { runDocumentIntelligence } from '../agents/document-intelligence';
import { priceTokens } from '../telemetry/pricing';

export interface EnrichIngestParams {
  project: DdProject;
  files: ChatIngestFile[];
  buffers: Buffer[];
  now?: string;
  onStep?: (step: AgentStep) => void;
  /**
   * What each document read cost, as it finishes.
   *
   * Reading a scanned deed is the most expensive call this product makes —
   * whole PDFs into the extraction tier, once per document — and the upload
   * turn was the one turn that showed no figure beside it. A chat turn has
   * carried its own cost since the copilot was tiered; this closes the gap
   * for the turn that costs the most.
   *
   * A callback rather than a return value so a run that throws part-way still
   * reports what it spent before it did.
   */
  onSpend?: (spend: TurnSpend) => void;
}

/**
 * Prices one document read and hands it back.
 *
 * `exact` travels with the figure rather than being inferred from it: the
 * pricing module returns zero for a model it has no rate for, and a zero that
 * means "not priced" must never render as a call that was free.
 */
function reportSpend(onSpend: ((spend: TurnSpend) => void) | undefined, run: AgentRun): void {
  if (!onSpend || !run.usage) return;
  const price = priceTokens(run.provider ?? 'anthropic', run.model, {
    inputTokens: run.usage.inputTokens,
    outputTokens: run.usage.outputTokens,
    cacheReadTokens: run.usage.cacheReadTokens,
  });
  onSpend({ usd: price.costUsd, exact: price.confidence === 'exact' });
}

function stubDocument(projectId: string, file: ChatIngestFile, now: string): CaseDocument {
  return {
    id: `ing_${randomUUID()}`,
    caseId: projectId,
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    uploadedAt: now,
    kind: 'other',
    classificationConfidence: 0,
    kindConfirmedByUser: false,
    pages: 0,
    ocrStatus: 'pending',
    extracted: [],
  };
}

function clipQuote(label: string, value: string, max = 140): string {
  const raw = `${label}: ${value}`.replace(/\s+/g, ' ').trim();
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

/**
 * Why a file could not be read, in words a person can act on.
 *
 * The provider's own message is the wrong thing to show. It is a transport
 * failure written for whoever is on call — an HTTP status, a JSON body, a
 * `request_id`, sometimes a Zod dump naming `fields[6].unit` — and it arrived
 * in chat where the summary of a title deed belongs. Worse, it arrived in the
 * same typeface and the same position as the real summaries, so a batch of six
 * uploads looked like six classifications when only two of them were.
 *
 * So the raw text is reduced to a cause and a next step. It is not discarded:
 * the run itself carries the full error for anyone debugging one.
 */
function readFailureReason(raw: string): string {
  switch (failureCause(raw)) {
    case 'rate_limited':
      return 'The document reader was rate limited. The file is attached; upload it again to read it.';
    case 'unreadable':
      return 'The document reader could not open this PDF — it may be a scan or protected.';
    case 'malformed':
      return 'The reader returned an answer this app could not use. The file is attached; upload it again to read it.';
    case 'unsupported':
      return 'This file type cannot be read — PDFs and images only.';
    case 'unconfigured':
      return 'Document reading is not configured on this deployment.';
    case 'timeout':
      return 'The document reader did not answer in time.';
    default:
      return 'The document reader could not read this file.';
  }
}

/**
 * Run document intelligence per uploaded file. On skip or failure the original
 * ingest row is returned unchanged so filename classify still works.
 */
export async function enrichIngestWithDocumentIntelligence(params: EnrichIngestParams): Promise<ChatIngestFile[]> {
  const now = params.now ?? new Date().toISOString();
  const identity = projectToIdentity(params.project);
  const out: ChatIngestFile[] = [];

  for (let i = 0; i < params.files.length; i += 1) {
    const file = params.files[i]!;
    const bytes = params.buffers[i] ?? null;
    params.onStep?.({
      id: randomUUID(),
      at: new Date().toISOString(),
      kind: 'plan',
      label: `Reading ${file.fileName}`,
    });
    if (!bytes || bytes.length === 0) {
      out.push(file);
      continue;
    }
    try {
      const result = await runDocumentIntelligence({
        caseId: params.project.id,
        document: stubDocument(params.project.id, file, now),
        fileBytes: bytes,
        identity,
        now,
        onStep: params.onStep,
      });
      reportSpend(params.onSpend, result.run);
      if (result.run.status !== 'succeeded' || result.fields.length === 0) {
        /*
         * Nothing was read, so nothing may be said about the contents. The
         * reason goes in `readFailure`, never in `extractionNotes` — see the
         * note on that field for what happened when they shared one.
         */
        out.push(
          result.notes
            ? { ...file, readFailure: readFailureReason(result.notes) }
            : file,
        );
        continue;
      }
      const quotes = result.fields.slice(0, 4).map((f) => ({
        text: clipQuote(f.label, f.value),
        page: f.sourcePage,
      }));
      const pages = result.fields.reduce((max, f) => Math.max(max, f.sourcePage ?? 0), 0);
      out.push({
        ...file,
        kindHint: result.kind !== 'other' && result.kind !== 'unclassified' ? result.kind : file.kindHint,
        extractionNotes: result.notes?.slice(0, 400) || undefined,
        quotes,
        pages: pages || undefined,
      });
    } catch {
      out.push(file);
    }
  }

  return out;
}
