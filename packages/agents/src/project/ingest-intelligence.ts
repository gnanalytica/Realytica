/**
 * Document intelligence on a project ingest — citations on the file card,
 * filename classify as fallback. Nothing is filed until a person approves.
 */

import { randomUUID } from 'node:crypto';
import type { AgentRun, AgentStep, AgentUsage, CaseDocument, ChatIngestFile, DdProject, DocumentFact, ExtractedField, TurnSpend } from '@realytica/shared';
import { failureCause, projectToIdentity, STANDARD_FACT_KEYS, standardFact, standardKeyFits } from '@realytica/shared';
import { CUT_OFF_REASON, runDocumentIntelligence, type UnconfirmedField } from '../agents/document-intelligence';
import { quoteStates } from '../agents/page-check';
import { priceTokens } from '../telemetry/pricing';

export interface EnrichIngestParams {
  project: DdProject;
  files: ChatIngestFile[];
  buffers: Buffer[];
  /**
   * Each file's text page by page, as this server already read it, aligned
   * with `files`. A model's quote found in its page's own words is placed
   * there without another call.
   */
  pageTexts?: (readonly string[] | undefined)[];
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
  /** Each file as the model starts on it, and its reading once it is done — for drawing the reading as it goes. */
  onFile?: (index: number, phase: 'start' | 'done', file?: ChatIngestFile) => void;
  /**
   * Start no new document after this instant. Reads run one after another,
   * and a turn has a hard ceiling; a document not started is left for the
   * next turn rather than cut off half-read with nothing saved.
   */
  deadline?: number;
  /**
   * No model call runs past this instant, whichever document it is for. For a
   * request somebody is waiting on: a call still out at this time is given
   * up, and its document keeps the reading it had, said to be unfinished.
   */
  stopAt?: number;
}

/**
 * Prices one document read and hands it back.
 *
 * `exact` travels with the figure rather than being inferred from it: the
 * pricing module returns zero for a model it has no rate for, and a zero that
 * means "not priced" must never render as a call that was free.
 */
function reportSpend(
  onSpend: ((spend: TurnSpend) => void) | undefined,
  run: AgentRun,
  pageChecks: { model: string; usage: AgentUsage }[] = [],
): void {
  if (!onSpend) return;
  const calls = [...(run.usage ? [{ model: run.model, usage: run.usage }] : []), ...pageChecks];
  for (const call of calls) {
    // Each call at its own model's rate: the page checks may run on another one.
    const price = priceTokens(run.provider ?? 'anthropic', call.model, {
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
      cacheReadTokens: call.usage.cacheReadTokens,
    });
    onSpend({ usd: price.costUsd, exact: price.confidence === 'exact' });
  }
}

/** How long past the last new document its page checks may still run. */
const PAGE_CHECK_GRACE_MS = 120_000;

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

/**
 * A value that says it could not be read is not a reading. Measured on a
 * stamped Kannada khata: the owner came back as "Smt. [name obscured by
 * stamp]", with a quote that was on the page.
 */
const NOT_A_VALUE = /\[[^\]]*\]|\b(?:illegible|obscured|unreadable|unclear|not (?:legible|readable|clear))\b/i;

/** How many unconfirmed values one paper keeps. Past this it is a bundle nobody will read value by value. */
const MAX_UNVERIFIED = 20;

/**
 * A model's fields as document facts, only where the field's own quote was
 * verified on a page: by a citation, or by the page check in
 * `agents/page-check`. A field with no page is a reading nobody can check
 * against the document, so it stays in the notes and out of the facts that
 * can fill a check.
 *
 * A field under one of the rules' own keys is taken only on a paper that
 * carries the key (`standardKeyFits`): a model put `ec_nil` on a record of
 * rights and an applicant under `owner`, and a key on the wrong paper answers
 * a check it has nothing to do with. It is then put in the rules' form for
 * the key (`STANDARD_FACT_KEYS`), so the two readings of one value can be set
 * side by side; one that cannot be put in that form is left out.
 *
 * Every value that has to be exact is held to the words quoted for it,
 * whatever placed it on its page (`quoteStates`): a date, an area, a width
 * and a count as much as an amount or an identifier. A quote ending
 * "31-03-2024" beside the value 31-01-2024 proves nothing, wherever it was
 * found, and the value is unverified.
 *
 * Each fact says what stands behind it (`proof`). What the model read and
 * nothing confirmed on a page is handed back apart, as `unverified`: no fact,
 * each marked as that and carrying only the page the model named.
 */
export function factsFromFields(
  fields: ExtractedField[],
  unconfirmed: UnconfirmedField[],
  paper: string | undefined,
): { facts: DocumentFact[]; unverified: DocumentFact[] } {
  const asFact = (f: ExtractedField, page: number): DocumentFact | null => {
    if (!f.quote || NOT_A_VALUE.test(f.value)) return null;
    const known = f.key in STANDARD_FACT_KEYS;
    if (known && !standardKeyFits(f.key, paper)) return null;
    const standard = known ? standardFact(f.key, f.value, f.unit) : undefined;
    if (standard === null) return null;
    return {
      key: f.key,
      label: f.label,
      value: f.value,
      ...(f.unit ? { unit: f.unit } : {}),
      display: f.unit ? `${f.value} ${f.unit}` : f.value,
      ...standard,
      page,
      quote: f.quote,
      ...(f.originalValue ? { originalValue: f.originalValue, originalScript: f.originalScript } : {}),
      source: 'model',
    };
  };
  const facts: DocumentFact[] = [];
  /** Found on a page, and not stated by its own quote: no fact, whatever found it there. */
  const unsupported: Array<{ field: ExtractedField; page: number }> = [];
  for (const f of fields) {
    if (!f.sourcePage || facts.some((existing) => existing.key === f.key)) continue;
    const fact = asFact(f, f.sourcePage);
    if (!fact) continue;
    if (!quoteStates({ key: f.key, value: f.value, unit: f.unit }, f.quote ?? '')) {
      unsupported.push({ field: f, page: f.sourcePage });
      continue;
    }
    facts.push({ ...fact, ...(f.pageCheck ? { pageCheck: f.pageCheck } : {}), proof: f.pageCheck === 'page' ? 'second_reader' : 'page_text' });
  }
  const unverified: DocumentFact[] = [];
  const loose = [
    ...unsupported,
    // Page 0 is no page: the model named none, and nobody found the value on one.
    ...unconfirmed.map((field) => ({ field, page: field.namedPage ?? 0 })),
  ];
  for (const { field, page } of loose) {
    if (unverified.length >= MAX_UNVERIFIED) break;
    const fact = asFact(field, page);
    if (!fact || unverified.some((existing) => existing.key === fact.key && String(existing.value) === String(fact.value))) continue;
    unverified.push({ ...fact, proof: 'unverified' });
  }
  return { facts, unverified };
}

/**
 * Notes cut to a length at a sentence, or failing that a word.
 *
 * Cut at a fixed length they ended mid-word on the file's card — "Page
 * references are self-reported by the model rather th".
 */
export function clipNotes(notes: string, max: number): string {
  const text = notes.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = head.match(/^.*[.!?](?=\s|$)/);
  if (sentence && sentence[0].length >= max * 0.5) return sentence[0];
  const word = head.replace(/\s+\S*$/, '');
  return `${word}…`;
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
  if (raw.includes(CUT_OFF_REASON)) {
    return 'This file states more than one reading can hold, so the reader’s answer was cut off. The file is attached.';
  }
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
    if (params.deadline !== undefined && Date.now() > params.deadline) {
      out.push({ ...file, readFailure: 'Not read yet: this turn ran out of time. Ask to read the filed documents again to carry on.' });
      continue;
    }
    params.onFile?.(i, 'start');
    try {
      const pageTexts = params.pageTexts?.[i];
      // Only the pages this server could not read well itself, where it said which; see `ReadingCoverage`.
      const only = file.reading?.modelPages;
      const ocrPages = file.reading?.ocrPages;
      const result = await runDocumentIntelligence({
        caseId: params.project.id,
        document: stubDocument(params.project.id, file, now),
        fileBytes: bytes,
        identity,
        now,
        onStep: params.onStep,
        ...(pageTexts?.length ? { pageTexts } : {}),
        ...(params.deadline !== undefined ? { checkDeadline: params.deadline + PAGE_CHECK_GRACE_MS } : {}),
        ...(params.stopAt !== undefined ? { stopAt: params.stopAt } : {}),
        ...(only?.length ? { pages: only } : {}),
        ...(ocrPages?.length ? { ocrPages } : {}),
      });
      reportSpend(params.onSpend, result.run, result.pageCheckUsage);
      const sent = result.pagesSent ?? [];
      /** What the model was sent and, of that, the pages a value came back for that was found on its page. Never a page that was not sent. */
      const answered = (found: number[]): NonNullable<ChatIngestFile['reading']> => {
        const read = found.filter((page) => sent.includes(page));
        return {
          ...(file.reading ?? { pagesInFile: result.pagesInFile ?? sent.length, pagesRead: read.length, readers: { text: 0, ocr: 0, model: read.length }, modelReasons: [], modelPages: [] }),
          modelPagesSent: sent,
          modelPagesRead: read,
          // The second reader ran out of time on some page: values are unverified that a minute more might have confirmed.
          ...(result.checksCut ? { modelChecksCut: true } : {}),
        };
      };
      const loose = result.run.status === 'succeeded' ? factsFromFields([], result.unconfirmed ?? [], result.paper).unverified : [];
      if (result.run.status === 'succeeded' && result.fields.length === 0) {
        // It answered, and gave nothing that could be kept. Said so on the reading, so the same question is not asked again.
        console.warn('[document reader] read, and no value kept');
        out.push({ ...file, readFailure: undefined, modelRead: true, ...(loose.length ? { modelUnverified: loose } : {}), reading: answered([]) });
        params.onFile?.(i, 'done', out[out.length - 1]);
        continue;
      }
      if (result.run.status !== 'succeeded') {
        // In the log, so a reading that failed can be told from one that read nothing.
        // The run's own error only: the model's notes can quote the document.
        console.warn(`[document reader] reading failed: ${(result.run.error ?? 'no reason given').slice(0, 300)}`);
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
        params.onFile?.(i, 'done', out[out.length - 1]);
        continue;
      }
      // The document's own words where the model gave them; its reading
      // (label and value) only where it did not.
      const quotes = result.fields.slice(0, 4).map((f) => ({
        text: f.quote ? f.quote.slice(0, 140) : clipQuote(f.label, f.value),
        page: f.sourcePage,
      }));
      const { facts: modelFacts, unverified } = factsFromFields(result.fields, result.unconfirmed ?? [], result.paper);
      const pages = result.fields.reduce((max, f) => Math.max(max, f.sourcePage ?? 0), 0);
      out.push({
        ...file,
        /*
         * The model read it. Whatever this server said of its own attempt
         * (`readFailure` on the row it was handed) is not the model's failure:
         * left on, the merge took a paper the model had read for one it had
         * failed on, and a file this server found no legible text in lost the
         * only reading it had.
         */
        readFailure: undefined,
        kindHint: result.kind !== 'other' && result.kind !== 'unclassified' ? result.kind : file.kindHint,
        extractionNotes: result.notes ? clipNotes(result.notes, 400) || undefined : undefined,
        quotes,
        pages: pages || undefined,
        modelRead: true,
        ...(modelFacts.length ? { modelFacts } : {}),
        ...(unverified.length ? { modelUnverified: unverified } : {}),
        // Which pages the model was sent, and which of them it gave a value for that was found there, beside what this server said of its own reading.
        reading: answered([...new Set(modelFacts.map((fact) => fact.page))].sort((a, b) => a - b)),
      });
    } catch {
      // Said, so the paper is known not to have been read by a model and is offered again.
      out.push({ ...file, readFailure: readFailureReason('') });
    }
    params.onFile?.(i, 'done', out[out.length - 1]);
  }

  return out;
}
