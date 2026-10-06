/**
 * A model's wording for the lines of a status report.
 *
 * The report is written by code: each line, its day, its person and what is
 * behind it come from the record. Where a model is set up it may put a line
 * in plainer words for the person the report is for. That is all it is asked
 * for and all it is given: the numbered lines, and nothing of the record.
 *
 * Nothing it answers is used on its word. The caller holds every wording to
 * the line it was made for (`statusWordingHeld` in the shared package): a
 * wording is kept only for a line that exists, with every figure and every
 * quoted title of that line and no other. So the answer here can add no
 * line, drop none, and change no date, amount or name of a paper.
 *
 * Never throws. A model that cannot be reached, runs out of time or answers
 * something else has reworded nothing, and the lines stand as code wrote them.
 */

import { agentCapability } from '../client';
import { basicChatModel } from '../config';
import { capabilityBlocksRoute, resolveRoute, toolUseOf } from '../providers';
import type { LlmSchemaTool } from '../providers';

export const STATUS_WORDING_TOOL = 'reword_status_lines';

/** How long the rewording may take before the lines stand as they are. */
export const STATUS_WORDING_LIMIT_MS = 20_000;

/** How many lines one report sends to be reworded, at most. */
export const STATUS_WORDING_LINES = 60;

const SYSTEM = `You reword the lines of a status report on a property project so that the person it is written for can read them easily.

Rules:
1. Reword each numbered line as one plain sentence. Keep its meaning exactly. Add nothing the line does not say and leave nothing out.
2. Keep every number, date and amount exactly as written, and keep everything inside “quotation marks” exactly as written, quotation marks included.
3. Do not add a line. Do not join two lines. Do not explain, advise or draw a conclusion.
4. No jargon and no filler. Under 240 characters a line.
5. A line that is already plain is left out of your answer.
Call ${STATUS_WORDING_TOOL} once, with the number of each line you reworded and its new words.`;

function tool(): LlmSchemaTool {
  return {
    kind: 'schema',
    name: STATUS_WORDING_TOOL,
    description: 'Give the new words for the lines of the status report that were reworded.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['lines'],
      properties: {
        lines: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['n', 'text'],
            properties: {
              n: { type: 'integer', description: 'The number of the line.' },
              text: { type: 'string', description: 'The line in plainer words.' },
            },
          },
        },
      },
    },
  };
}

/**
 * What a model would put some lines as: a list of `{ n, text }`, or null when
 * no model reworded them. `audience` is who the report is for, in words.
 */
export async function rewordStatusLinesByModel(input: { lines: readonly string[]; audience?: string; caseId?: string; timeoutMs?: number }): Promise<unknown[] | null> {
  const lines = input.lines.slice(0, STATUS_WORDING_LINES);
  if (!lines.length) return null;
  try {
    const { route, provider, descriptor } = resolveRoute('analyst_copilot');
    if (capabilityBlocksRoute(route, agentCapability()) || !descriptor.configured) return null;
    const result = await provider.complete({
      agent: 'analyst_copilot',
      ...(input.caseId ? { caseId: input.caseId } : {}),
      // Rewording is the free model's work when there is one.
      model: basicChatModel() ?? route.model,
      maxTokens: 3000,
      system: [{ text: SYSTEM, cacheBreakpoint: true }],
      tools: [tool()],
      toolChoice: { type: 'tool', name: STATUS_WORDING_TOOL },
      messages: [{ role: 'user', content: `${input.audience ? `The report is for ${input.audience}.\n\n` : ''}The lines:\n${lines.map((line, at) => `${at + 1}. ${line}`).join('\n')}` }],
      timeoutMs: input.timeoutMs ?? STATUS_WORDING_LIMIT_MS,
    });
    const said = toolUseOf(result, STATUS_WORDING_TOOL)?.input as { lines?: unknown } | undefined;
    return said && Array.isArray(said.lines) ? said.lines : null;
  } catch (err) {
    console.warn(`[status report] a model did not reword the lines: ${err instanceof Error ? err.name : 'error'}`);
    return null;
  }
}
