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
 *
 * The same gate now applies to the *route*. Web search here is a server-run
 * Anthropic tool, and a provider without `serverWebSearch` cannot substitute
 * anything for it — this agent's only source of facts would be gone, leaving a
 * model asked for "recent transaction signal" with nothing but its own
 * recollection to answer from. That is the one degradation this file must not
 * accept: a fabricated market finding with a fabricated source URL is exactly
 * what its prompt spends four paragraphs forbidding. So a route without server
 * web search cancels the run and says so, with the gap recorded, rather than
 * running blind and calling the output research.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentRun, AgentRunStatus, AgentStep, CapabilityGap, EvidenceItem, PropertyCase, ReferenceData, ResearchFinding } from '@valytica/shared';
import { agentCapability, describeError } from '../client';
import { GROUNDING_RULES, renderCaseContext } from '../context';
import { describeGap } from '../routing';
import { capabilityBlocksRoute, missingCredentialsReason, resolveRoute, textOf } from '../providers';
import type { LlmServerTool } from '../providers';

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

/**
 * The same tool, declared to the port.
 *
 * `native` is passed through verbatim by a provider that hosts server tools,
 * so the request on the wire is unchanged. `gap` is what a provider that does
 * not host them must record instead — there is no portable substitute for a
 * search the vendor runs, and pretending otherwise is how an agent ends up
 * inventing its sources.
 */
const WEB_SEARCH_PORT_TOOL: LlmServerTool = {
  kind: 'server',
  name: 'web_search',
  gap: 'server_web_search_unavailable',
  native: WEB_SEARCH_TOOL,
};

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

  // Resolved once, at the top, so the model recorded on the run is the model
  // the request was built with and the model the usage was priced against.
  const { route, provider, descriptor } = resolveRoute('market_research');
  const tier = route.tier;
  const model = route.model;

  /** What this run asked the provider for and did not get. */
  let capabilityGaps: CapabilityGap[] = [];

  const finish = (status: AgentRunStatus, error: string | undefined, usage?: AgentRun['usage']): RunMarketResearchResult => {
    const run: AgentRun = {
      id: runId,
      caseId,
      agent: 'market_research',
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      model,
      tier,
      provider: route.provider,
      capabilityGaps,
      steps,
      error,
      usage,
      producedEvidenceIds: [],
    };
    return { run, findings: [], evidence: [] };
  };

  emit({ kind: 'plan', label: `Researching market signal for ${caseData.identity.locality}, ${caseData.identity.city}` });

  // The credential half of `agentCapability()` only speaks for an Anthropic
  // route; the kill switch speaks for all of them. See `capabilityBlocksRoute`.
  const capability = agentCapability();
  if (capabilityBlocksRoute(route, capability)) {
    const reason = `Market research is unavailable (${capability.reason}) — Anthropic credentials are not configured.`;
    emit({ kind: 'error', label: 'Agent unavailable', detail: reason });
    return finish('failed', reason);
  }
  if (!capability.webSearchEnabled) {
    const reason = 'Web search is disabled for this deployment (set VALYTICA_AGENT_WEB_SEARCH=1 to enable) — market research was skipped rather than run without it.';
    emit({ kind: 'plan', label: 'Skipped — web search disabled', detail: reason });
    return finish('cancelled', reason);
  }
  // Cancelled, not degraded. Every other agent can produce a thinner but real
  // answer without its missing capability; this one cannot. Its entire job is
  // to bring in facts from outside the case file, and without a provider-run
  // search there is no outside. Running anyway would hand a user a set of
  // "findings" whose only source is the model, which is worse than no findings
  // at all — see the file header.
  if (!descriptor.capabilities.serverWebSearch) {
    capabilityGaps = ['server_web_search_unavailable'];
    const reason =
      `Route ${route.provider} does not host a server-run web search — market research was skipped rather than run without it. ` +
      describeGap('server_web_search_unavailable');
    emit({ kind: 'plan', label: 'Skipped — no server web search on this route', detail: reason });
    return finish('cancelled', reason);
  }

  if (!descriptor.configured) {
    const reason = missingCredentialsReason(route, 'market research is unavailable.');
    emit({ kind: 'error', label: 'No credentials', detail: reason });
    return finish('failed', reason);
  }

  // externalSafe: no documents, no owner, no address, no price. See the file
  // header — this is the one line in the whole package that is allowed to
  // build a prompt for an agent that talks to an outside service.
  const contextBlock = renderCaseContext(caseData, refData, { externalSafe: true });

  emit({ kind: 'tool_call', label: 'Searching the web for locality signal', toolName: 'web_search' });

  let result;
  try {
    result = await provider.runTools({
      agent: 'market_research',
      model,
      maxTokens: 8000,
      system: [{ text: SYSTEM_PROMPT, cacheBreakpoint: true }],
      tools: [WEB_SEARCH_PORT_TOOL],
      messages: [{ role: 'user', content: `Locality market terms (this is all you are given — do not ask for more):\n${contextBlock}` }],
      // Server-tool telemetry is Anthropic-shaped by construction: this agent
      // cancels above on any route without server web search, so `native` is
      // always a BetaMessage by the time this runs. Reading it directly keeps
      // every search/result step exactly as it was, rather than routing rich
      // tool results through a lossy normalised description.
      //
      // `pause_turn` resumption moved into the provider — it is a protocol
      // detail of the server-run tool, not of this agent — and behaves
      // identically: the assistant turn is pushed back and the runner
      // continues.
      onMessage: message => {
        const native = message.native as Anthropic.Beta.BetaMessage | undefined;
        if (!native) return;
        for (const block of native.content) {
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
      },
    });
  } catch (e) {
    const reason = describeError(e);
    emit({ kind: 'error', label: 'Model request failed', detail: reason });
    return finish('failed', reason);
  }

  capabilityGaps = result.capabilityGaps;
  for (const gap of capabilityGaps) {
    emit({ kind: 'message', label: `Degraded on route ${route.provider}: ${gap}`, detail: describeGap(gap) });
  }

  const usage = result.usage;

  if (result.stopReason === 'refusal') {
    const reason = 'Claude declined to perform this research (safety filtering).';
    emit({ kind: 'error', label: 'Request refused', detail: reason });
    return finish('failed', reason, usage);
  }
  if (result.stopReason === 'pause_turn') {
    const reason = 'Research paused repeatedly without concluding — treating the run as incomplete rather than guessing at partial results.';
    emit({ kind: 'error', label: 'Research did not conclude', detail: reason });
    return finish('failed', reason, usage);
  }

  const parsed = FindingsArraySchema.safeParse(extractJson(textOf(result)));

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
    model,
    tier,
    provider: route.provider,
    capabilityGaps,
    steps,
    summary: `${findings.length} market finding(s) for ${caseData.identity.locality}${contradictions > 0 ? ` (${contradictions} contradicting engine data)` : ''}.`,
    usage,
    producedEvidenceIds: evidence.map(e => e.id),
  };
  return { run, findings, evidence };
}
