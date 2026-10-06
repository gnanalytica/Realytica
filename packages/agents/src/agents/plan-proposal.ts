/**
 * A model's proposal for a plan, for an instruction the rules do not read.
 *
 * A plan's steps are a fixed list of kinds the chat already does by a
 * sentence (`PLAN_STEP_KINDS` in the shared package), and a plan is made by
 * code from the words of an instruction. Where the words are not ones the
 * rules read ("go through everything on file, fill what you can in the
 * lender's questionnaire and tell the owner where we are"), a model may say
 * which of those kinds the instruction asks for, in order.
 *
 * That is all it says. It is sent the instruction and the list of kinds, and
 * nothing of the project. What it answers is held to the list by the caller
 * (`planWantsHeld`): a kind that is not on it is no step. What each step
 * would touch is then counted from the record by code, a step that would
 * touch nothing is dropped, and the plan is shown to a person before any of
 * it runs. A model starts nothing here.
 *
 * Never throws. A model that cannot be reached, runs out of time or answers
 * something else has proposed nothing.
 */

import { agentCapability } from '../client';
import { basicChatModel } from '../config';
import { capabilityBlocksRoute, resolveRoute, toolUseOf } from '../providers';
import type { LlmSchemaTool } from '../providers';

export const PLAN_PROPOSAL_TOOL = 'propose_plan';

/** How long the proposal may take before the instruction is answered as any other. */
export const PLAN_PROPOSAL_LIMIT_MS = 20_000;

const KINDS = ['read_filed', 'accept_raised', 'suggest_answers', 'write_report', 'keep_meeting', 'run_playbook'] as const;

const SYSTEM = `You turn an instruction about a property project into the steps of a plan. A step is one of exactly six kinds:

- read_filed: read the papers filed on the project that have not been read. "only" names one page of the menu when the instruction limits it (for example "title", "approvals", "legal"). "again" is true when papers already read are to be read again.
- accept_raised: accept what the last reply raised ("form": "last"), or everything waiting ("form": "open"). Only when the instruction plainly says to accept or approve.
- suggest_answers: suggest answers to a questionnaire's open questions from the file.
- write_report: write a report. "report" is one of status, executive_dd, detailed_dd, red_flag, evidence_completeness, open_risk_action, changes_since_previous, indicative_valuation, handover_readiness, technical_dd, legal_dd, financial_dd. A status or progress update for somebody is "status", and "period" is the words of the instruction for its period ("this week", "for September", "since the last report"), with who it is for ("for the owner") when the instruction says.
- keep_meeting: keep the notes of a meeting the chat is holding.
- run_playbook: run a saved playbook on papers. "playbook" is its name as the instruction gives it, and "only" a page of the menu when the instruction limits the papers.

Rules:
1. Use only these six kinds, in the order the instruction asks for them. Never invent a kind.
2. Leave out anything the instruction asks for that none of the six does.
3. Do not add a step the instruction does not ask for. Never add accept_raised on your own.
4. If none applies, give an empty list.
Call ${PLAN_PROPOSAL_TOOL} once.`;

function tool(): LlmSchemaTool {
  return {
    kind: 'schema',
    name: PLAN_PROPOSAL_TOOL,
    description: 'Give the steps of the plan the instruction asks for, each one of the six kinds.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['steps'],
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'only', 'again', 'form', 'report', 'period', 'playbook'],
            properties: {
              kind: { type: 'string', enum: [...KINDS] },
              only: { type: ['string', 'null'] },
              again: { type: ['boolean', 'null'] },
              form: { type: ['string', 'null'], enum: ['last', 'open', null] },
              report: { type: ['string', 'null'] },
              period: { type: ['string', 'null'] },
              playbook: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
  };
}

/** What a model says the steps of an instruction are: a list for the caller to check, or null when no model proposed one. */
export async function proposePlanByModel(input: { instruction: string; caseId?: string; timeoutMs?: number }): Promise<unknown[] | null> {
  const instruction = input.instruction.trim().slice(0, 600);
  if (!instruction) return null;
  try {
    const { route, provider, descriptor } = resolveRoute('analyst_copilot');
    if (capabilityBlocksRoute(route, agentCapability()) || !descriptor.configured) return null;
    const result = await provider.complete({
      agent: 'analyst_copilot',
      ...(input.caseId ? { caseId: input.caseId } : {}),
      model: basicChatModel() ?? route.model,
      maxTokens: 800,
      system: [{ text: SYSTEM, cacheBreakpoint: true }],
      tools: [tool()],
      toolChoice: { type: 'tool', name: PLAN_PROPOSAL_TOOL },
      messages: [{ role: 'user', content: `The instruction:\n${instruction}` }],
      timeoutMs: input.timeoutMs ?? PLAN_PROPOSAL_LIMIT_MS,
    });
    const said = toolUseOf(result, PLAN_PROPOSAL_TOOL)?.input as { steps?: unknown } | undefined;
    return said && Array.isArray(said.steps) ? said.steps : null;
  } catch (err) {
    console.warn(`[plans] a model did not propose a plan: ${err instanceof Error ? err.name : 'error'}`);
    return null;
  }
}
