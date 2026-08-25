/**
 * Market research — external signal via web search.
 *
 * The one agent in this package that talks to an outside service, so the
 * privacy boundary is the entire point of this file, not an afterthought:
 * the prompt is built exclusively from `renderCaseContext(..., { externalSafe:
 * true })`, which strips documents, owner name, address and price. Only
 * country/state/city/locality, property type, areas and locality-level market
 * numbers ever reach the search tool. Do not widen this — if a future change
 * needs more case detail in this file, it needs a new, deliberately-reviewed
 * exception, not a quiet swap back to the full `renderCaseContext(...)`.
 *
 * Gated behind `agentCapability().webSearchEnabled` (opt-in — see client.ts):
 * with it off, this returns a `cancelled` run immediately rather than
 * silently doing nothing.
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentRun, AgentRunStatus, AgentStep, EvidenceItem, PropertyCase, ReferenceData, ResearchFinding } from '@valytica/shared';
import { AGENT_MODEL, BASE_REQUEST, agentCapability, describeError, estimateUsage, getClient } from '../client';
import { GROUNDING_RULES, renderCaseContext } from '../context';

export interface RunMarketResearchParams {
  caseId: string;
  caseData: PropertyCase;
  refData: ReferenceData;
  /** ISO timestamp used to date findings/evidence — not wall-clock, so runs are reproducible. */
  now?: string;
  onStep?: (step: AgentStep) => void;
}

export interface RunMarketResearchResult {
  run: AgentRun;
  findings: ResearchFinding[];
  evidence: EvidenceItem[];
}

const MAX_SEARCHES = 8;

const SYSTEM_PROMPT = `
${GROUNDING_RULES}

You are the market research agent. You are given only locality-level market terms for one property — country, state, city, locality, property type, areas, and this app's own locality reference numbers (median price/land rate per sqm, year-on-year change, sample size). You are never given the property's exact address, owner, price or documents — do not ask for them, and do not assume any exact address.

Use web search to find recent, genuinely relevant signal for this locality: recent transaction or listing price signal, comparable inventory, and infrastructure or planning news (metro/road/zoning changes) that could move value. Prefer sources published within the last ~18 months and say when a source is older.

Compare what you find against the locality reference numbers you were given. Agreement is fine to note briefly; a contradiction is the more valuable finding — surface it plainly rather than smoothing it over, and mark it as such.

When you are done researching, end your ENTIRE response with nothing but a single fenced JSON code block containing an array of finding objects — no text before or after it. If you found nothing worth reporting, the array must still appear, empty: \`\`\`json\n[]\n\`\`\`. Each object has exactly these fields:
- "claim": string — the finding, stated plainly.
- "sourceUrl": string — omit the field entirely if you cannot cite a real URL for this claim.
- "sourceTitle": string — the source's title/publication; omit if unknown.
- "relevance": string — why this matters for this locality/property type.
- "confidence": number 0..1 — your honest confidence in the claim.
- "corroboration": "multiple_sources" | "single_source" | "uncorroborated".
- "contradictsEngine": boolean — true only when this finding conflicts with the locality reference numbers you were given.

Never invent a source URL. A claim with no real source behind it should have "corroboration": "uncorroborated" and a lower confidence, not a fabricated citation.
`.trim();

/**
 * The API accepts `web_search_20260209` (dynamic filtering — the right
 * variant for Opus 5) today; the installed @anthropic-ai/sdk's shipped
 * .d.ts only knows the older `web_search_20250305`. This literal, and the
 * `unknown` cast where it is used below, bridge that gap without touching
 * what is actually sent on the wire and without reaching for `any`.
 */
interface WebSearchTool20260209 {
  type: 'web_search_20260209';
  name: 'web_search';
  max_uses?: number;
}
const WEB_SEARCH_TOOL: WebSearchTool20260209 = { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES };

const FindingInputSchema = z.object({
  claim: z.string(),
  sourceUrl: z.string().optional(),
  sourceTitle: z.string().optional(),
  relevance: z.string(),
  confidence: z.number().min(0).max(1),
  corroboration: z.enum(['multiple_sources', 'single_source', 'uncorroborated']),
  contradictsEngine: z.boolean(),
});
const FindingsArraySchema = z.array(FindingInputSchema);

/** Pulls the trailing fenced JSON block (or the whole text, as a fallback) and parses it. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    return undefined;
  }
}

export async function runMarketResearch(params: RunMarketResearchParams): Promise<RunMarketResearchResult> {
  const { caseId, caseData, refData } = params;
  const now = params.now ?? new Date().toISOString();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const steps: AgentStep[] = [];

  const emit = (step: Omit<AgentStep, 'id' | 'at'>): void => {
    const full: AgentStep = { id: randomUUID(), at: new Date().toISOString(), ...step };
    steps.push(full);
    params.onStep?.(full);
  };

  const finish = (status: AgentRunStatus, error: string | undefined, usage?: AgentRun['usage']): RunMarketResearchResult => {
    const run: AgentRun = {
      id: runId,
      caseId,
      agent: 'market_research',
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      model: AGENT_MODEL,
      steps,
      error,
      usage,
      producedEvidenceIds: [],
    };
    return { run, findings: [], evidence: [] };
  };

  emit({ kind: 'plan', label: `Researching market signal for ${caseData.identity.locality}, ${caseData.identity.city}` });

  const capability = agentCapability();
  if (!capability.available) {
    const reason = `Market research is unavailable (${capability.reason}) — Anthropic credentials are not configured.`;
    emit({ kind: 'error', label: 'Agent unavailable', detail: reason });
    return finish('failed', reason);
  }
  if (!capability.webSearchEnabled) {
    const reason = 'Web search is disabled for this deployment (set VALYTICA_AGENT_WEB_SEARCH=1 to enable) — market research was skipped rather than run without it.';
    emit({ kind: 'plan', label: 'Skipped — web search disabled', detail: reason });
    return finish('cancelled', reason);
  }

  const client = getClient();
  if (!client) {
    const reason = 'Anthropic credentials are not configured — market research is unavailable.';
    emit({ kind: 'error', label: 'No credentials', detail: reason });
    return finish('failed', reason);
  }

  // externalSafe: no documents, no owner, no address, no price. See the file
  // header — this is the one line in the whole package that is allowed to
  // build a prompt for an agent that talks to an outside service.
  const contextBlock = renderCaseContext(caseData, refData, { externalSafe: true });

  const requestParams = {
    ...BASE_REQUEST,
    max_tokens: 8000,
    system: [{ type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } }],
    tools: [WEB_SEARCH_TOOL as unknown as Anthropic.Beta.BetaToolUnion],
    messages: [{ role: 'user' as const, content: `Locality market terms (this is all you are given — do not ask for more):\n${contextBlock}` }],
  };

  emit({ kind: 'tool_call', label: 'Searching the web for locality signal', toolName: 'web_search' });

  // See the file-level cast comment on WEB_SEARCH_TOOL: same SDK/API version
  // gap, same `unknown`-only workaround. The toolRunner's own parameter type
  // isn't re-exported anywhere convenient, so it is derived from the client
  // method itself rather than duplicated by hand.
  type ToolRunnerParams = Parameters<typeof client.beta.messages.toolRunner>[0];
  type NonStreamingToolRunnerParams = ToolRunnerParams & { stream?: false };

  let final: Anthropic.Beta.BetaMessage;
  try {
    const runner = client.beta.messages.toolRunner(requestParams as unknown as NonStreamingToolRunnerParams);
    // web_search is a server-side tool: a long research turn can come back
    // with stop_reason "pause_turn" after the server's own iteration limit.
    // The runner does not auto-resume that — it would otherwise silently
    // truncate the research here — so it is handled explicitly.
    for await (const message of runner) {
      if (message.stop_reason === 'pause_turn') {
        runner.pushMessages({ role: 'assistant', content: message.content });
      }
      for (const block of message.content) {
        if (block.type === 'server_tool_use' && block.name === 'web_search') {
          const query = typeof block.input.query === 'string' ? block.input.query : undefined;
          emit({ kind: 'tool_call', label: query ? `Searching: "${query}"` : 'Searching the web', toolName: 'web_search' });
        }
        if (block.type === 'web_search_tool_result') {
          const content = block.content;
          if (Array.isArray(content)) {
            emit({ kind: 'tool_result', label: `Found ${content.length} result(s)` });
          } else {
            emit({ kind: 'error', label: 'Web search error', detail: content.error_code });
          }
        }
      }
    }
    final = await runner.done();
  } catch (e) {
    const reason = describeError(e);
    emit({ kind: 'error', label: 'Anthropic request failed', detail: reason });
    return finish('failed', reason);
  }

  const usage = estimateUsage(final.usage);

  if (final.stop_reason === 'refusal') {
    const reason = 'Claude declined to perform this research (safety filtering).';
    emit({ kind: 'error', label: 'Request refused', detail: reason });
    return finish('failed', reason, usage);
  }
  if (final.stop_reason === 'pause_turn') {
    const reason = 'Research paused repeatedly without concluding — treating the run as incomplete rather than guessing at partial results.';
    emit({ kind: 'error', label: 'Research did not conclude', detail: reason });
    return finish('failed', reason, usage);
  }

  const textBlocks = final.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text');
  const rawText = textBlocks.map(b => b.text).join('\n\n');
  const parsed = FindingsArraySchema.safeParse(extractJson(rawText));

  if (!parsed.success) {
    const reason = `Research completed but did not return valid structured findings: ${parsed.error.message}`;
    emit({ kind: 'error', label: 'Invalid findings output', detail: reason });
    return finish('failed', reason, usage);
  }

  const findings: ResearchFinding[] = [];
  const evidence: EvidenceItem[] = [];
  for (const f of parsed.data) {
    const id = `research-${randomUUID()}`;
    findings.push({
      id,
      claim: f.claim,
      sourceUrl: f.sourceUrl,
      sourceTitle: f.sourceTitle,
      retrievedAt: now,
      relevance: f.relevance,
      confidence: f.confidence,
      corroboration: f.corroboration,
      contradictsEngine: f.contradictsEngine,
    });
    evidence.push({
      id: `ev-${id}`,
      statement: f.claim,
      sourceType: 'external_dataset',
      sourceRef: f.sourceUrl ?? 'web_search',
      sourceLabel: f.sourceTitle ?? f.sourceUrl ?? 'External web research',
      confidence: f.confidence,
      capturedAt: now,
    });
  }

  const contradictions = findings.filter(f => f.contradictsEngine).length;
  emit({
    kind: 'message',
    label: `${findings.length} finding(s)${contradictions > 0 ? `, ${contradictions} contradicting the engine's locality data` : ''}`,
  });

  const run: AgentRun = {
    id: runId,
    caseId,
    agent: 'market_research',
    status: 'succeeded',
    startedAt,
    finishedAt: new Date().toISOString(),
    model: AGENT_MODEL,
    steps,
    summary: `${findings.length} market finding(s) for ${caseData.identity.locality}${contradictions > 0 ? ` (${contradictions} contradicting engine data)` : ''}.`,
    usage,
    producedEvidenceIds: evidence.map(e => e.id),
  };
  return { run, findings, evidence };
}
