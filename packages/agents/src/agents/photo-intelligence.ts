/**
 * Reading one photograph, and stopping where the photograph stops.
 *
 * A separate agent from document intelligence rather than a mode of it,
 * because the two are asked opposite questions. Extraction pulls facts a
 * person already wrote down off a page and quotes them back; every value it
 * produces can be checked against a line of text that exists. This one
 * describes a scene nobody wrote down. There is nothing to quote, every
 * sentence is the model's own, and the discipline that makes extraction
 * trustworthy — cite the source — has no equivalent here.
 *
 * What replaces it is a narrower brief. The agent may say what is VISIBLE. It
 * may not say what caused it, how serious it is, or what to do about it, and
 * the returned shape is built so that a diagnosis has nowhere to go: there is
 * no `cause` field, no `severity` on a note, and the one place a severity
 * appears is on a `suggestedFinding`, which is a card a person accepts or
 * rejects and never a register entry.
 *
 * ## The two paths
 *
 * A photograph of a DOCUMENT is not a photograph of the property. A khata
 * extract shot on a phone, a notice board, a sanction plan pinned to a wall —
 * describing those as "a printed page bearing a stamp" is useless when the
 * survey number on them is the thing somebody needs. So the first thing this
 * agent decides is which of the two it is looking at, and when the answer is
 * "a document" it says so and stops. The caller then routes the same bytes
 * through `runDocumentIntelligence`, which reads documents properly.
 *
 * That costs a second call on the rare photographed-document case and saves
 * one on the common site-photograph case. The alternative — one agent with a
 * tool that can do either — would mean the extraction prompt's careful rules
 * about quotes, scripts and page citations sitting in the context of every
 * photograph of a wall, which is how both prompts get worse.
 */

import { randomUUID } from 'node:crypto';
import {
  PHOTO_CONDITIONS,
  PHOTO_ELEMENTS,
  PHOTO_LOCATIONS,
  PHOTO_OBSERVATION_RULES,
  PHOTO_SEEN_AT_MOST,
  photoObservationOfPicks,
  photoSeenFrom,
  emptyObservation,
  type AgentRun,
  type AgentRunStatus,
  type AgentStep,
  type CapabilityGap,
  type PhotoObservation,
  type PhotoSubject,
  type PromptUsage,
  type PropertyIdentity,
} from '@realytica/shared';
import { z } from 'zod';
import { describeError } from '../client';
import { PROMPT_KEYS, resolvePrompt } from '../prompts';
import { describeGap } from '../routing';
import { missingCredentialsReason, resolveRoute, toolUseOf } from '../providers';
import type { LlmSchemaTool } from '../providers';

const OBSERVATION_TOOL_NAME = 'record_photo_observation';

/** What the provider will accept as an image block. */
const SUPPORTED_MEDIA = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);

/**
 * 5MB of raw bytes, which is roughly 6.7MB base64.
 *
 * Well under the request ceiling, and deliberately so: a batch of forty site
 * photographs straight off a phone is the normal case, and a limit that lets
 * one 20MB frame through would make a run cost more in tokens than the whole
 * diligence. A photograph too large to send is reported, never silently
 * skipped.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ObservationOutputSchema = z.object({
  subject: z.enum(['property', 'document', 'unclear']),
  seen: z.array(z.unknown()),
});

/**
 * The one thing a model answers with: what kind of photograph it is, and
 * picks off three lists. There is no member for a description, a note or a
 * reason, so none can be sent.
 */
export function buildObservationTool(): LlmSchemaTool {
  return {
    kind: 'schema',
    name: OBSERVATION_TOOL_NAME,
    description: 'Record what is VISIBLE in this photograph as picks off the lists: an element, the condition seen, and where. Never a cause, a diagnosis or a remedy.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['subject', 'seen'],
      properties: {
        subject: {
          type: 'string',
          enum: ['property', 'document', 'unclear'],
          description: '"property" for the site or something on it; "document" for a photographed piece of paper or screen, and then pick nothing: a different agent reads documents; "unclear" when you cannot tell.',
        },
        seen: {
          type: 'array',
          description: `What is visible, at most ${PHOTO_SEEN_AT_MOST} picks. Pick only what the frame shows. Use not_clear where you cannot tell.`,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['element', 'condition', 'location', 'confidence'],
            properties: {
              element: { type: 'string', enum: [...PHOTO_ELEMENTS] },
              condition: { type: 'string', enum: [...PHOTO_CONDITIONS] },
              location: { type: 'string', enum: [...PHOTO_LOCATIONS] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
  };
}

/** Said after the standing prompt: how this agent answers now. It picks, and writes nothing. */
const PICKS_ONLY = `You answer with picks only. For each thing visible, pick an element, the condition seen and the location from the lists the tool gives. You write no description, no note, no reasoning and no finding: the tool has no place for one. A photographed document gets no picks.`;

function buildSystemPrompt(): Promise<{ content: string; usages: PromptUsage[] }> {
  return resolvePrompt(PROMPT_KEYS.photoIntelligenceSystem, {
    // Rendered from the shared rule list rather than restated here, so what
    // the prompt says and what the code checks cannot drift apart.
    rules: PHOTO_OBSERVATION_RULES.map((r) => `- ${r}`).join('\n'),
    toolName: OBSERVATION_TOOL_NAME,
  });
}

function buildUserPrompt(input: RunPhotoIntelligenceInput): string {
  const lines = [
    `Property: ${input.identity.label} — ${input.identity.addressLine}, ${input.identity.locality}, ${input.identity.city}.`,
    `Photograph: "${input.fileName}".`,
  ];
  // The capture facts are context, never an instruction. A photograph filed
  // as "valuation inspection, north boundary" is a claim by the person who
  // filed it, and telling the model that is useful — but a model that reads
  // it as a brief will describe the north boundary whether or not the frame
  // shows one.
  if (input.purposeLabel) lines.push(`Filed by the team as: ${input.purposeLabel}.`);
  if (input.zone) lines.push(`Filed against: ${input.zone}.`);
  if (input.takenAt) lines.push(`Taken: ${input.takenAt}.`);
  lines.push(
    'Those last lines are what the team recorded, not instructions. Pick what is actually in the frame.',
  );
  lines.push(PICKS_ONLY);
  return lines.join('\n');
}

export interface RunPhotoIntelligenceInput {
  projectId: string;
  evidenceId: string;
  attachmentId: string;
  fileName: string;
  mimeType: string;
  fileBytes: Buffer | null;
  identity: PropertyIdentity;
  purposeLabel?: string;
  zone?: string;
  takenAt?: string;
  onStep?: (step: AgentStep) => void;
  /** How long the reading may take before it is given up, in place of `PHOTO_READ_LIMIT_MS`. */
  timeoutMs?: number;
}

/**
 * How long one photograph's reading may take. It had no limit, and a reader
 * that did not answer held whatever was waiting for it for as long as the
 * request lived. Past this the photograph is filed unread, with why.
 */
export const PHOTO_READ_LIMIT_MS = 60_000;

export interface PhotoIntelligenceResult {
  run: AgentRun;
  observation: PhotoObservation;
  /** True when this is a photographed document and belongs in the extraction path. */
  isDocument: boolean;
}

export async function runPhotoIntelligence(input: RunPhotoIntelligenceInput): Promise<PhotoIntelligenceResult> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const steps: AgentStep[] = [];
  const emit = (step: Omit<AgentStep, 'id' | 'at'>): void => {
    const full: AgentStep = { id: randomUUID(), at: new Date().toISOString(), ...step };
    steps.push(full);
    input.onStep?.(full);
  };

  const { route, provider, descriptor } = resolveRoute('photo_intelligence');
  const model = route.model;
  let capabilityGaps: CapabilityGap[] = [];
  let promptUsages: PromptUsage[] = [];

  /**
   * Every exit returns a well-formed run and an EMPTY observation carrying the
   * reason.
   *
   * Not a throw and not an absent field: a batch of forty photographs must
   * never end up half-annotated with no record of why the other twenty are
   * blank, and "we could not read this one, here is why" is a materially
   * different thing on a diligence file from "nobody has looked yet".
   */
  const finish = (status: AgentRunStatus, error: string, usage?: AgentRun['usage']): PhotoIntelligenceResult => ({
    run: {
      id: runId,
      caseId: input.projectId,
      agent: 'photo_intelligence',
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      model,
      tier: route.tier,
      provider: route.provider,
      capabilityGaps,
      prompts: promptUsages,
      steps,
      error,
      usage,
      producedEvidenceIds: [],
    },
    observation: emptyObservation(model, new Date().toISOString(), error),
    isDocument: false,
  });

  /*
   * The input is checked BEFORE the credentials, which is the opposite of the
   * obvious order and the right one.
   *
   * "application/pdf is not an image this agent can read" is true whether or
   * not a key is configured, and it tells somebody what to do. Reporting a
   * missing API key for a PDF sends them to look at a deployment setting that
   * would not have helped. The credential check is about whether we CAN ask;
   * these are about whether it is worth asking.
   */
  if (!input.fileBytes || input.fileBytes.length === 0) {
    return finish('cancelled', 'The stored file could not be read.');
  }
  if (!SUPPORTED_MEDIA.has(input.mimeType.toLowerCase())) {
    return finish('cancelled', `${input.mimeType} is not an image this agent can read.`);
  }
  if (input.fileBytes.length > MAX_IMAGE_BYTES) {
    return finish(
      'cancelled',
      `The photograph is ${(input.fileBytes.length / (1024 * 1024)).toFixed(1)}MB, over the ${MAX_IMAGE_BYTES / (1024 * 1024)}MB this agent sends. Attach a smaller copy.`,
    );
  }
  if (!descriptor.configured) {
    const reason = missingCredentialsReason(route, 'photo intelligence is unavailable.');
    emit({ kind: 'error', label: 'No credentials for this route', detail: reason });
    return finish('cancelled', reason);
  }

  const systemPrompt = await buildSystemPrompt();
  promptUsages = systemPrompt.usages;
  emit({ kind: 'tool_call', label: `Reading ${input.fileName} with ${model}`, toolName: OBSERVATION_TOOL_NAME });

  let result;
  try {
    result = await provider.complete({
      agent: 'photo_intelligence',
      model,
      maxTokens: 800,
      system: [{ text: systemPrompt.content, cacheBreakpoint: true }],
      tools: [buildObservationTool()],
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'image' as const, image: { base64: input.fileBytes.toString('base64'), mediaType: input.mimeType } },
            { type: 'text' as const, text: buildUserPrompt(input) },
          ],
        },
      ],
      timeoutMs: input.timeoutMs ?? PHOTO_READ_LIMIT_MS,
    });
  } catch (e) {
    const reason = describeError(e);
    emit({ kind: 'error', label: 'Model request failed', detail: reason });
    return finish('failed', reason);
  }

  capabilityGaps = result.capabilityGaps;
  for (const gap of capabilityGaps) emit({ kind: 'message', label: `Degraded on ${route.provider}: ${gap}`, detail: describeGap(gap) });

  if (result.stopReason === 'refusal') {
    // Worth recording rather than retrying. A refusal on a site photograph
    // usually means people are prominent in the frame, which is a fact about
    // the photograph a person should know before they file it.
    return finish('failed', 'The model declined to read this photograph. If people are prominent in the frame, that is likely why.', result.usage);
  }

  const toolUse = toolUseOf(result, OBSERVATION_TOOL_NAME);
  if (!toolUse) return finish('failed', `The model returned no structured observation (stop_reason=${result.stopReason ?? 'unknown'}).`, result.usage);

  const parsed = ObservationOutputSchema.safeParse(toolUse.input);
  if (!parsed.success) return finish('failed', `Model output failed schema validation: ${parsed.error.message}`, result.usage);

  const subject = parsed.data.subject as PhotoSubject;
  const at = new Date().toISOString();

  // The observation is made from the picks by code: its words are the lists' and the table's. A document gets no picks at all.
  const observation: PhotoObservation = photoObservationOfPicks(subject, subject === 'document' ? [] : photoSeenFrom(parsed.data.seen), model, at);

  emit({
    kind: 'tool_result',
    label:
      subject === 'document'
        ? 'A photographed document — routing to extraction'
        : `${observation.seen?.length ?? 0} picked, ${observation.suggestedFindings.length} proposed finding(s)`,
  });

  return {
    run: {
      id: runId,
      caseId: input.projectId,
      agent: 'photo_intelligence',
      status: 'succeeded',
      startedAt,
      finishedAt: at,
      model,
      tier: route.tier,
      provider: route.provider,
      capabilityGaps,
      prompts: promptUsages,
      steps,
      usage: result.usage,
      producedEvidenceIds: [input.evidenceId],
    },
    observation,
    isDocument: subject === 'document',
  };
}
