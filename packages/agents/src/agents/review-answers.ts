/**
 * A model's answers to a review table's questions about one paper.
 *
 * The model is sent the words kept for the paper's pages and every question
 * asked of that paper, in one call. It is never sent the file. Each answer
 * comes back with the page it is on and the words it rests on.
 *
 * Nothing it says is believed on its word. Its words are looked for on the
 * page, by the reader's own rule for whether a page holds a quote
 * (`findQuoteInPages` in `page-check`), and only among the pages it was sent.
 * And every number its answer writes has to be a number those words write
 * (`numbersIn`): an answer that says 3,18,50,000 resting on words that say
 * 3,18,00,000 proves nothing, wherever the words are. An answer that passes
 * both rests on the page's text. One that fails either is unverified, and is
 * shown as that.
 *
 * Where the page's words are OCR's reading of a scan, the answer says so: the
 * words were found in what was read off the scan here, which is all the model
 * was sent.
 *
 * What comes back is a cell of a review table and nothing else. No value of
 * the paper is made here.
 *
 * Never throws. A model that cannot be reached, runs out of time or answers
 * something else has answered nothing, and says which.
 */

import { z } from 'zod';
import type { AgentUsage } from '@realytica/shared';
import { agentCapability } from '../client';
import { PROMPT_KEYS, resolvePrompt } from '../prompts';
import { capabilityBlocksRoute, resolveRoute, toolUseOf } from '../providers';
import type { LlmSchemaTool } from '../providers';
import { findQuoteInPages, numbersIn } from './page-check';

export const REVIEW_ANSWERS_TOOL = 'record_paper_answers';

/** How long one paper's answers may take. */
export const REVIEW_ANSWERS_LIMIT_MS = 120_000;

/** How much of a paper's page text one call is sent. A longer paper is sent from its first page to here, and says which pages went. */
export const REVIEW_PAGES_CHARS = 120_000;

const ANSWER_CHARS = 600;
const QUOTE_CHARS = 400;

/** One page of a paper as it was read and kept. */
export interface PaperPageText {
  /** 1-based. */
  page: number;
  text: string;
  /** The words are OCR's reading of a scan, not the file's own text. */
  scanned?: boolean;
}

export interface PaperQuestion {
  id: string;
  question: string;
}

/** One question's answer, held to the page. */
export interface PaperAnswerRead {
  id: string;
  /** False when the pages sent do not answer it. */
  stated: boolean;
  answer?: string;
  /** 1-based: the page the words were found on, else the page the model named among those it was sent. */
  page?: number;
  quote?: string;
  /** Present on an answer: whether its words were found on the page. */
  proof?: 'page_text' | 'unverified';
  scanned?: true;
}

export type PaperAnswersResult =
  | { ok: true; model: string; answers: PaperAnswerRead[]; pagesSent: number[]; usage: AgentUsage }
  | { ok: false; why: 'no_model' | 'failed'; message: string };

/** Whether a model is set up to answer a review table's questions. Where none is, the table searches the page text. */
export function reviewModelSetUp(): boolean {
  const { route, descriptor } = resolveRoute('document_intelligence');
  return !capabilityBlocksRoute(route, agentCapability()) && descriptor.configured;
}

function tool(): LlmSchemaTool {
  return {
    kind: 'schema',
    name: REVIEW_ANSWERS_TOOL,
    description: 'Record, for every numbered question, whether the pages answer it, the answer, its page and the words it rests on.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['answers'],
      properties: {
        answers: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['n', 'stated', 'answer', 'page', 'words'],
            properties: {
              n: { type: 'integer', description: 'The question number, as given.' },
              stated: { type: 'boolean', description: 'True only if these pages answer the question.' },
              answer: { type: ['string', 'null'], description: 'The answer in one or two plain sentences. Null when not stated.' },
              page: { type: ['integer', 'null'], description: 'The number of the page the answer is on. Null when not stated.' },
              words: { type: ['string', 'null'], description: 'The words on that page the answer rests on, copied exactly. Null when not stated.' },
            },
          },
        },
      },
    },
  };
}

const Output = z.object({
  answers: z.array(
    z.object({
      n: z.number().int(),
      stated: z.boolean(),
      answer: z.string().nullish(),
      page: z.number().int().nullish(),
      words: z.string().nullish(),
    }),
  ),
});

/** The pages that fit in one call, from the first: whole pages, and the first one cut to fit when it alone is too long. */
export function pagesToSend(pages: readonly PaperPageText[], budget = REVIEW_PAGES_CHARS): PaperPageText[] {
  const out: PaperPageText[] = [];
  let used = 0;
  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    if (!page.text.trim()) continue;
    if (used + page.text.length > budget) {
      if (!out.length) out.push({ ...page, text: page.text.slice(0, budget) });
      break;
    }
    out.push(page);
    used += page.text.length;
  }
  return out;
}

/**
 * Where an answer's words are, and whether they hold the answer.
 *
 * The words are looked for among the pages that were sent, on the page the
 * model named first. A page is named in the result even when the words are
 * not found on it, so a person can open it and look; it is then unverified.
 */
export function placePaperAnswer(
  read: { answer: string; page?: number | null; quote?: string | null },
  sent: readonly PaperPageText[],
): { page?: number; proof: 'page_text' | 'unverified'; scanned?: true } {
  const named = sent.find((page) => page.page === read.page);
  const unverified = { ...(named ? { page: named.page } : {}), proof: 'unverified' as const };
  const quote = read.quote?.trim();
  if (!quote) return unverified;
  // Held to its own words first: a number the words do not write is the model's, not the page's.
  const written = new Set(numbersIn(quote));
  if (!numbersIn(read.answer).every((number) => written.has(number))) return unverified;
  const texts: string[] = [];
  for (const page of sent) texts[page.page - 1] = page.text;
  const found = findQuoteInPages(quote, Array.from(texts, (text) => text ?? ''), named?.page);
  if (found === undefined) return unverified;
  return { page: found, proof: 'page_text', ...(sent.find((page) => page.page === found)?.scanned ? { scanned: true as const } : {}) };
}

/** The pages and the questions as the model is shown them. */
function asked(title: string, kind: string | undefined, sent: readonly PaperPageText[], pagesInFile: number | undefined, questions: readonly PaperQuestion[]): string {
  const last = sent[sent.length - 1]?.page ?? 0;
  const cut = pagesInFile !== undefined && pagesInFile > last ? `Pages ${last + 1} to ${pagesInFile} of this document are not here.` : '';
  return [
    `Document: ${title}${kind ? ` (${kind})` : ''}`,
    ...(cut ? [cut] : []),
    '',
    ...sent.flatMap((page) => [`Page ${page.page}:`, page.text.trim(), '']),
    'Questions:',
    ...questions.map((q, i) => `${i + 1}. ${q.question}`),
  ].join('\n');
}

/**
 * Asks every question of one paper in one call, and holds each answer to the
 * page. `caseId` is the project, for the telemetry that counts what a project
 * spent.
 */
export async function answerPaperQuestions(input: {
  caseId?: string;
  title: string;
  kind?: string;
  pages: readonly PaperPageText[];
  pagesInFile?: number;
  questions: readonly PaperQuestion[];
  timeoutMs?: number;
}): Promise<PaperAnswersResult> {
  const { route, provider, descriptor } = resolveRoute('document_intelligence');
  if (capabilityBlocksRoute(route, agentCapability()) || !descriptor.configured) {
    return { ok: false, why: 'no_model', message: 'No model is set up.' };
  }
  const sent = pagesToSend(input.pages);
  if (!sent.length || !input.questions.length) return { ok: true, model: route.model, answers: [], pagesSent: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0 } };

  const limit = input.timeoutMs ?? REVIEW_ANSWERS_LIMIT_MS;
  const started = Date.now();
  try {
    const system = await resolvePrompt(PROMPT_KEYS.documentIntelligenceReviewAnswers, { toolName: REVIEW_ANSWERS_TOOL });
    const result = await provider.complete({
      agent: 'document_intelligence',
      ...(input.caseId ? { caseId: input.caseId } : {}),
      model: route.model,
      maxTokens: 1_200 + input.questions.length * 400,
      system: [{ text: system.content, cacheBreakpoint: true }],
      tools: [tool()],
      messages: [{ role: 'user', content: asked(input.title, input.kind, sent, input.pagesInFile, input.questions) }],
      timeoutMs: limit,
    });
    const parsed = Output.safeParse(toolUseOf(result, REVIEW_ANSWERS_TOOL)?.input);
    if (!parsed.success) {
      // Why, in the log. Never the paper's words.
      console.warn(`[review answers] ${input.questions.length} question(s): no answer that could be used (the model stopped with ${result.stopReason ?? 'no reason given'})`);
      return { ok: false, why: 'failed', message: 'The model returned an answer this app could not use.' };
    }
    const byNumber = new Map(parsed.data.answers.map((answer) => [answer.n, answer]));
    const answers = input.questions.map((question, i): PaperAnswerRead => {
      const said = byNumber.get(i + 1);
      const answer = said?.answer?.replace(/\s+/g, ' ').trim();
      if (!said || !said.stated || !answer) return { id: question.id, stated: false };
      const quote = said.words?.replace(/\s+/g, ' ').trim().slice(0, QUOTE_CHARS);
      const placed = placePaperAnswer({ answer, page: said.page, quote }, sent);
      return { id: question.id, stated: true, answer: answer.slice(0, ANSWER_CHARS), ...(quote ? { quote } : {}), ...placed };
    });
    return { ok: true, model: route.model, answers, pagesSent: sent.map((page) => page.page), usage: result.usage };
  } catch (err) {
    const timedOut = Date.now() - started >= limit - 500 || /timed out/i.test(err instanceof Error ? err.message : '');
    console.warn(`[review answers] ${input.questions.length} question(s): ${timedOut ? 'not answered in the time allowed' : `the call failed (${err instanceof Error ? err.name : 'error'})`}`);
    return { ok: false, why: 'failed', message: timedOut ? 'The model did not answer in time.' : 'The model could not be reached.' };
  }
}
