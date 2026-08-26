import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import type { EvalCase } from '@realytica/shared';
import { providerFor } from '../providers/registry';
import { clientToolFromRunnable } from '../providers/anthropic';
import type { LlmClientTool } from '../providers/types';
import { PROMPT_KEYS, resolvePrompt } from '../prompts';
import { describeError } from '../client';
import type { EvalAnswer } from './score';
import type { EvalExecution, EvalExecutionRequest, EvalExecutor } from './run';

/**
 * The half of the evaluation harness that was never built.
 *
 * `runEvalComparison` takes an injected executor and scores whatever comes
 * back. Nothing implemented that executor, so the 43 cases, the scoring, the
 * fabrication gate and the ranking were all reachable only from a test that
 * did not exist — the harness could grade an answer and had no way to obtain
 * one.
 *
 * Two decisions worth stating:
 *
 *  - **The answer shape is a tool schema built from the case's own expectation
 *    keys.** Every key the case scores is offered, nullable, with
 *    `additionalProperties: false`. That is deliberate for the adversarial
 *    cases: a fabrication only happens when the field is asked for, so an
 *    extractor never asked about a conversion order number is never tested for
 *    inventing one. Offering the key and accepting null is the trap.
 *
 *  - **The system prompt is the shipped grounding preamble**, resolved through
 *    the prompt registry rather than written here. An evaluation that runs
 *    against a preamble nobody deploys measures a configuration that does not
 *    exist. It also ties the two features together: gut the anti-fabrication
 *    rules in the Prompts page and the adversarial scores should fall, which is
 *    the check that those rules do anything.
 */

const MAX_TOKENS = 2000;

/** What the model is asked, per task kind. Deliberately terse — the grounding preamble carries the rules. */
function taskBriefing(evalCase: EvalCase): string {
  const input = evalCase.input;
  switch (evalCase.kind) {
    case 'document_extraction': {
      const keys = (input.requestedKeys as string[] | undefined) ?? [];
      return [
        'Extract the requested fields from this document. Return a value only where the document actually states one.',
        'Where the document does not contain a field, return null for it. A plausible-looking value you did not read is the worst possible answer.',
        '',
        `Property identity on file: ${JSON.stringify(input.identity)}`,
        `Document: ${JSON.stringify(input.document)}`,
        '',
        `Fields requested: ${keys.join(', ')}`,
      ].join('\n');
    }
    case 'grounding':
      return [
        'Decide whether this claim is supported by the evidence supplied, and nothing else.',
        'Return `verdict` as exactly "supported" or "unsupported". In `unsupportedSpecifics`, quote the specific parts that the evidence does not carry.',
        'Do not supply a corrected figure for anything you find unsupported: a corrected fee you did not read is still a fabricated fee. Return null for any such field.',
        '',
        `Claim: ${String(input.claim)}`,
        `Evidence: ${JSON.stringify(input.evidence)}`,
      ].join('\n');
    case 'proof_routing':
      return [
        'Name the route to obtaining this document: the authority, the form, and the procedure.',
        'Every element must come from the corpus supplied. Return null for anything it does not state.',
        '',
        JSON.stringify(input),
      ].join('\n');
    case 'title_reasoning':
      return [
        'Reason about this title chain and answer the fields requested.',
        'Return null for anything the material does not establish.',
        '',
        JSON.stringify(input),
      ].join('\n');
  }
}

/**
 * The answer tool for one case.
 *
 * Built per case because the keys are the case's own. `additionalProperties:
 * false` means an answer cannot carry a key nobody asked about, and every key
 * is nullable so "the document does not say" is expressible — without that,
 * a model with no way to decline would be forced into inventing something,
 * and the adversarial cases would be measuring the schema rather than the
 * model.
 */
function answerTool(evalCase: EvalCase, collect: (answer: EvalAnswer) => void) {
  const properties: Record<string, { type: string[]; description: string }> = {};
  for (const e of evalCase.expectations) {
    properties[e.key] = {
      type: ['string', 'number', 'boolean', 'null'],
      description: 'The value the source actually states, or null if it does not state one.',
    };
  }
  /*
   * One cast, and it is unavoidable rather than lazy.
   *
   * `betaTool` is typed for a `const` literal schema so it can infer the
   * argument type of `run`. This schema's keys are the case's own and are only
   * known at runtime, so no literal exists to infer from. The cast is confined
   * to the schema object — `run` is typed explicitly below rather than
   * inferred, so nothing downstream is silently untyped.
   */
  const inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: evalCase.expectations.map(e => e.key),
    properties,
  } as unknown as Parameters<typeof betaTool>[0]['inputSchema'];

  return betaTool({
    name: 'submit_answer',
    description:
      'Submit your answer. Every field is optional in value but must be present as a key: use null for anything the source does not state.',
    inputSchema,
    run: async (args: unknown) => {
      collect((args ?? {}) as EvalAnswer);
      return JSON.stringify({ received: true });
    },
  });
}

export interface ProviderEvalExecutorOptions {
  /** Overrides the grounding preamble. Only for a harness proving the preamble itself matters. */
  systemOverride?: string;
}

/**
 * An executor that actually calls a model.
 *
 * Routed through `providerFor`, so every eval call is recorded by the
 * telemetry wrapper like any other — an evaluation sweep shows up in the cost
 * view rather than being invisible spend.
 */
export function createProviderEvalExecutor(options: ProviderEvalExecutorOptions = {}): EvalExecutor {
  return async ({ evalCase, route }: EvalExecutionRequest): Promise<EvalExecution> => {
    let answer: EvalAnswer | undefined;
    const tools: LlmClientTool[] = [answerTool(evalCase, a => { answer = a; })].map(clientToolFromRunnable);

    const grounding = options.systemOverride ?? (await resolvePrompt(PROMPT_KEYS.sharedGrounding)).content;
    const provider = providerFor(route.provider);
    const startedAt = Date.now();

    try {
      const result = await provider.runTools({
        agent: 'critic',
        model: route.model,
        maxTokens: MAX_TOKENS,
        system: [{ text: grounding, cacheBreakpoint: true }],
        tools,
        toolChoice: { type: 'tool', name: 'submit_answer' },
        messages: [{ role: 'user', content: taskBriefing(evalCase) }],
        maxIterations: 2,
      });

      if (!answer) {
        // Recorded as a failure rather than as an empty answer. An empty answer
        // scores as "declined to invent anything", which on the adversarial
        // cases is a perfect score — so a model that simply never called the
        // tool would top the ranking for being broken.
        return {
          error: 'The model returned no answer (submit_answer was never called).',
          usage: result.usage,
          durationMs: result.durationMs,
          capabilityGaps: result.capabilityGaps,
        };
      }

      return {
        answer,
        usage: result.usage,
        durationMs: result.durationMs,
        capabilityGaps: result.capabilityGaps,
      };
    } catch (e) {
      return { error: describeError(e), durationMs: Date.now() - startedAt };
    }
  };
}
