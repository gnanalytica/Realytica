/**
 * Reading an uploaded file on this server, before any model is asked.
 *
 * The chat's upload turn used to have two outcomes: a model read the
 * document, or the card said "unread". On a deployment with no model — and on
 * one whose model is rate limited, or down — every deed, every EC, every
 * khata arrived unread. This is the floor underneath that: the words come
 * out of the file here (its text layer, or OCR of a scan), and
 * `parseDocumentText` says what the document is and what it states.
 *
 * A model, where one is configured, still reads afterwards and may add to
 * this. It may not take it away: a local reading that succeeded is never
 * replaced by a model's failure to read the same file.
 */

import { randomUUID } from 'node:crypto';
import type { AgentStep, ChatIngestFile } from '@realytica/shared';
import { parseDocumentText } from '@realytica/shared';
import { readDocumentText } from './read-text';

function step(label: string, kind: AgentStep['kind'] = 'plan'): AgentStep {
  return { id: randomUUID(), at: new Date().toISOString(), kind, label };
}

/**
 * One file, read and understood, as the ingest row the chat builds cards from.
 * Never throws: a file that cannot be read comes back with `readFailure`.
 */
export async function readIngestLocally(
  file: ChatIngestFile,
  bytes: Buffer,
  onStep?: (step: AgentStep) => void,
): Promise<ChatIngestFile> {
  onStep?.(step(`Reading ${file.fileName}`));
  let text: Awaited<ReturnType<typeof readDocumentText>>;
  try {
    text = await readDocumentText(new Uint8Array(bytes), file.mimeType, file.fileName, {
      onProgress: (label) => onStep?.(step(label, 'tool_call')),
    });
  } catch {
    return { ...file, readFailure: 'The file could not be read.' };
  }
  if (text.method === 'none') {
    return { ...file, readFailure: text.failure ?? 'No legible text was found in the file.' };
  }
  const parsed = parseDocumentText(text.pages, file.fileName);
  const joined = text.pages.map((p, i) => (text.pages.length > 1 ? `[page ${i + 1}]\n${p}` : p)).join('\n\n');
  const noun = parsed.type === 'other' ? 'document' : /^[A-Z][a-z]/.test(parsed.label) ? parsed.label.toLowerCase() : parsed.label;
  const found = `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
  onStep?.(
    step(
      `${file.fileName}: ${found}${parsed.facts.length ? `, ${parsed.facts.length} fact${parsed.facts.length === 1 ? '' : 's'} read` : ''}${text.method !== 'text' ? ' (OCR)' : ''}`,
      'tool_result',
    ),
  );
  return {
    ...file,
    // The whole text, bounded — the place extractor, the classifier and any
    // later answer read it, and a 4 KB excerpt cut a deed off mid-schedule.
    excerpt: joined.slice(0, 20_000),
    pages: text.totalPages,
    kindHint: parsed.type === 'other' ? file.kindHint : parsed.documentKind !== 'other' ? parsed.documentKind : parsed.type,
    readFailure: undefined,
    read: {
      type: parsed.type,
      label: parsed.label,
      confidence: parsed.confidence,
      method: text.method,
      ocrConfidence: text.ocrConfidence,
      facts: parsed.facts,
      flags: parsed.flags,
      summary: parsed.summary,
      rowHints: parsed.rowHints,
      scopes: parsed.scopes,
      evidenceKind: parsed.evidenceKind,
    },
  };
}

/**
 * A model's reading laid over the local one.
 *
 * Where the model read the file, its notes and quotes are kept alongside the
 * local facts. Where it failed — unconfigured, rate limited, timed out — the
 * local reading stands and the failure is not shown, because the document
 * WAS read.
 */
export function mergeModelReading(local: ChatIngestFile, model: ChatIngestFile | undefined): ChatIngestFile {
  if (!model) return local;
  if (model.readFailure) return local.read ? local : { ...local, readFailure: model.readFailure };
  return {
    ...local,
    extractionNotes: model.extractionNotes ?? local.extractionNotes,
    quotes: [...(model.quotes ?? []), ...(local.quotes ?? [])].slice(0, 8),
    kindHint: model.kindHint ?? local.kindHint,
    pages: model.pages ?? local.pages,
  };
}
