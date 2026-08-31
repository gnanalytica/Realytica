/**
 * Document intelligence on a project ingest — citations on the file card,
 * filename classify as fallback. Nothing is filed until a person approves.
 */

import { randomUUID } from 'node:crypto';
import type { AgentStep, CaseDocument, ChatIngestFile, DdProject } from '@realytica/shared';
import { projectToIdentity } from '@realytica/shared';
import { runDocumentIntelligence } from '../agents/document-intelligence';

export interface EnrichIngestParams {
  project: DdProject;
  files: ChatIngestFile[];
  buffers: Buffer[];
  now?: string;
  onStep?: (step: AgentStep) => void;
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
      if (result.run.status !== 'succeeded' || result.fields.length === 0) {
        out.push(
          result.notes
            ? { ...file, extractionNotes: result.notes.slice(0, 400) }
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
