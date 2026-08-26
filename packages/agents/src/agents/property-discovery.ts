/**
 * Property discovery — the sweep for public records about one specific
 * property.
 *
 * Every other web-facing agent here researches the *locality*, under a rule
 * stated in `market-research.ts`: the address, owner name, price and document
 * contents must never reach a web search. This one is the exception, and the
 * exception is governed rather than carved out. `DisclosureLevel` on the case
 * decides what may be sent, a person chooses it explicitly having read what
 * it costs, and the owner name, the price and the document contents remain
 * off-limits at every level.
 *
 * Two design choices carry most of the weight.
 *
 * WHAT TO SEARCH FOR IS NOT THE MODEL'S DECISION. `planDiscovery` in shared
 * settles it: which record kinds matter for a Bengaluru property, which
 * disclosure level each one needs, what goes unchecked without it, and the
 * query templates. The model runs those searches and reads the results. It
 * cannot widen the target set, so it cannot decide on its own to search for
 * the owner. That also means the plan runs with no credentials at all — a
 * case with no model configured still shows what would have been looked for
 * and what is going unchecked, which is a real answer.
 *
 * IDENTITY CONFIDENCE IS A SEPARATE NUMBER FROM SOURCE QUALITY. A search for
 * "Survey No. 42, Sarjapur" returns records about every other Survey No. 42
 * in Karnataka. A perfectly reliable court listing about a different parcel
 * is a high-quality record at an identity confidence of 0.1, and reporting it
 * as a finding about this property would fabricate an encumbrance — someone
 * could walk away from a clean deal over it. So every finding carries both,
 * and the UI leads with the identity number.
 *
 * The sweep is never scheduled by the orchestrator. It costs money and it
 * sends identifiers outside; it happens when a person asks for it.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  CapabilityGap,
  DiscoveryFinding,
  DiscoveryRecordKind,
  DiscoverySweep,
  PromptUsage,
  PropertyCase,
  ReferenceData,
} from '@realytica/shared';
import { planDiscovery, resolveDisclosure } from '@realytica/shared';
import { agentCapability, describeError } from '../client';
import { renderCaseContext } from '../context';
import { PROMPT_KEYS, resolvePrompt } from '../prompts';
import { describeGap } from '../routing';
import { capabilityBlocksRoute, missingCredentialsReason, resolveRoute, textOf } from '../providers';
import type { LlmServerTool } from '../providers';
import { DATA_SOURCES } from '../sources/registry';
import type { RegisteredSource } from '../sources/registry';

export interface RunPropertyDiscoveryParams {
  caseId: string;
  caseData: PropertyCase;
  refData: ReferenceData;
  now?: string;
  onStep?: (step: AgentStep) => void;
}

export interface RunPropertyDiscoveryResult {
  run: AgentRun;
  /** Always present. On the paths that cannot reach a model it is the plan alone. */
  sweep: DiscoverySweep;
}

/**
 * Two searches per record kind, seven kinds, and headroom for the model to
 * follow one result. Bounded because an unbounded sweep is an unbounded bill,
 * and because past ten or so searches the marginal result stops being about
 * this property at all.
 */
const MAX_SEARCHES = 16;

const RECORD_KINDS = [
  'rera_registration',
  'planning_notification',
  'litigation',
  'municipal_notice',
  'developer_track_record',
  'listing',
  'news',
  'other',
] as const;

const FindingSchema = z.object({
  kind: z.enum(RECORD_KINDS),
  claim: z.string().min(1),
  bearing: z.string().min(1),
  sourceUrl: z.string().optional(),
  sourceTitle: z.string().optional(),
  publishedAt: z.string().optional(),
  identityConfidence: z.number().min(0).max(1),
  matchedOn: z.string().min(1),
  materiality: z.enum(['critical', 'serious', 'warning', 'info']),
  corroboration: z.enum(['multiple_sources', 'single_source', 'uncorroborated']),
});

const SweepSchema = z.object({
  findings: z.array(FindingSchema),
  lookedForNotFound: z.array(z.enum(RECORD_KINDS)).default([]),
});

const WEB_SEARCH_TOOL: Anthropic.Beta.BetaWebSearchTool20260209 = {
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: MAX_SEARCHES,
};

const WEB_SEARCH_PORT_TOOL: LlmServerTool = {
  kind: 'server',
  name: 'web_search',
  gap: 'server_web_search_unavailable',
  native: WEB_SEARCH_TOOL,
};

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    return undefined;
  }
}

/**
 * Registry sources that bear on a title and cannot be reached.
 *
 * Carried onto every sweep, successful or not. A user reading "nothing found"
 * has to be able to tell that Kaveri and Bhoomi were never in scope — the
 * encumbrance record that would settle half of this sits behind a CAPTCHA,
 * and silence about that is the difference between "clean" and "unchecked".
 */
function unreachableForTitle(): DiscoverySweep['unreachable'] {
  return DATA_SOURCES.filter(
    (source: RegisteredSource) =>
      source.access !== 'open' && source.produces.some(p => p === 'encumbrance' || p === 'instrument'),
  )
    .slice(0, 6)
    .map((source: RegisteredSource) => ({
      label: source.label,
      whatItWouldHaveAnswered: source.whatItWouldHaveAnswered,
    }));
}

export async function runPropertyDiscovery(params: RunPropertyDiscoveryParams): Promise<RunPropertyDiscoveryResult> {
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

  const disclosure = resolveDisclosure(caseData.disclosure);
  const plan = planDiscovery(caseData.identity, disclosure);
  const queriesRun = plan.searchable.flatMap(s => s.queries);

  const { route, provider, descriptor } = resolveRoute('property_discovery');
  let capabilityGaps: CapabilityGap[] = [];
  let promptUsages: PromptUsage[] = [];

  /**
   * The plan-only sweep: what would have been searched for, what is gated,
   * what is unreachable. Returned on every path that cannot reach a model, so
   * a case with no credentials still tells the truth about its blind spots
   * rather than showing an empty list.
   */
  const planOnly = (reason: string): DiscoverySweep => ({
    ranAt: now,
    disclosure,
    queriesRun: [],
    findings: [],
    lookedForNotFound: [],
    notLookedFor: plan.gated,
    unreachable: unreachableForTitle(),
    planOnlyReason: reason,
  });

  const finish = (status: AgentRunStatus, error: string | undefined, sweep: DiscoverySweep, usage?: AgentRun['usage']): RunPropertyDiscoveryResult => ({
    run: {
      id: runId,
      caseId,
      agent: 'property_discovery',
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      model: route.model,
      tier: route.tier,
      provider: route.provider,
      capabilityGaps,
      prompts: promptUsages,
      steps,
      error,
      usage,
      producedEvidenceIds: [],
    },
    sweep,
  });

  emit({
    kind: 'plan',
    label: `Sweeping public records at disclosure level "${disclosure}"`,
    detail:
      `${plan.searchable.length} record kind(s) searchable, ${plan.gated.length} gated by the disclosure level, ` +
      `${plan.missingIdentifiers.length} blocked by an identifier this case does not carry.`,
  });

  if (plan.searchable.length === 0) {
    const reason =
      'Nothing can be searched for at this disclosure level with the identifiers on this case. ' +
      (plan.gated.length > 0 ? 'Widen the level, ' : '') +
      (plan.missingIdentifiers.length > 0 ? `or supply ${plan.missingIdentifiers.map(m => m.needs).join(' / ')}.` : '');
    emit({ kind: 'plan', label: 'Nothing to search for', detail: reason });
    return finish('cancelled', reason, planOnly(reason));
  }

  const capability = agentCapability();
  if (capabilityBlocksRoute(route, capability)) {
    const reason = `Property discovery is unavailable (${capability.reason}) — no model credentials are configured.`;
    emit({ kind: 'error', label: 'Agent unavailable', detail: reason });
    return finish('failed', reason, planOnly(reason));
  }
  if (!capability.webSearchEnabled) {
    const reason =
      'Web search is disabled for this deployment (set REALYTICA_AGENT_WEB_SEARCH=1 to enable) — the sweep was planned but not run.';
    emit({ kind: 'plan', label: 'Skipped — web search disabled', detail: reason });
    return finish('cancelled', reason, planOnly(reason));
  }
  // Cancelled, not degraded — the same call market research makes, for the
  // same reason. This agent's entire job is to bring in records from outside
  // the case file. Without a provider-run search there is no outside, and
  // "findings" whose only source is the model would be fabricated records
  // about a named parcel: the worst possible output this product could emit.
  if (!descriptor.capabilities.serverWebSearch) {
    capabilityGaps = ['server_web_search_unavailable'];
    const reason =
      `Route ${route.provider} does not host a server-run web search — the sweep was planned but not run. ` +
      describeGap('server_web_search_unavailable');
    emit({ kind: 'plan', label: 'Skipped — no server web search on this route', detail: reason });
    return finish('cancelled', reason, planOnly(reason));
  }
  if (!descriptor.configured) {
    const reason = missingCredentialsReason(route, 'property discovery is unavailable.');
    emit({ kind: 'error', label: 'No credentials', detail: reason });
    return finish('failed', reason, planOnly(reason));
  }

  // The one place in this package that may send parcel identifiers outside,
  // and only up to the level the case carries. See `disclosure.ts`.
  const contextBlock = renderCaseContext(caseData, refData, { externalSafe: true, disclosure });

  const searchBlock = plan.searchable
    .map(s => `- ${s.item.label} (${s.item.kind}) — answers: ${s.item.answers}\n  queries: ${s.queries.map(q => `"${q}"`).join(', ')}`)
    .join('\n');

  const systemPrompt = await resolvePrompt(PROMPT_KEYS.propertyDiscoverySystem);
  promptUsages = systemPrompt.usages;

  emit({ kind: 'tool_call', label: `Running ${queriesRun.length} search(es)`, toolName: 'web_search' });

  let result;
  try {
    result = await provider.runTools({
      agent: 'property_discovery',
      caseId,
      model: route.model,
      maxTokens: 8000,
      system: [{ text: systemPrompt.content, cacheBreakpoint: true }],
      tools: [WEB_SEARCH_PORT_TOOL],
      messages: [
        {
          role: 'user',
          content:
            `Disclosure level: ${disclosure}. Identifiers you may use (this is all you are given — do not ask for more):\n${contextBlock}\n\n` +
            `Run these searches and report what they return:\n${searchBlock}`,
        },
      ],
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
            if (Array.isArray(content)) emit({ kind: 'tool_result', label: `Found ${content.length} result(s)` });
            else emit({ kind: 'error', label: 'Web search error', detail: content.error_code });
          }
        }
      },
    });
  } catch (e) {
    const reason = describeError(e);
    emit({ kind: 'error', label: 'Model request failed', detail: reason });
    return finish('failed', reason, planOnly(reason));
  }

  capabilityGaps = result.capabilityGaps;
  for (const gap of capabilityGaps) {
    emit({ kind: 'message', label: `Degraded on route ${route.provider}: ${gap}`, detail: describeGap(gap) });
  }
  const usage = result.usage;

  if (result.stopReason === 'refusal') {
    const reason = 'Claude declined to run this sweep (safety filtering).';
    emit({ kind: 'error', label: 'Request refused', detail: reason });
    return finish('failed', reason, planOnly(reason), usage);
  }

  const parsed = SweepSchema.safeParse(extractJson(textOf(result)));
  if (!parsed.success) {
    const reason = `The sweep ran but did not return valid structured findings: ${parsed.error.message}`;
    emit({ kind: 'error', label: 'Invalid sweep output', detail: reason });
    return finish('failed', reason, planOnly(reason), usage);
  }

  const findings: DiscoveryFinding[] = parsed.data.findings.map(f => ({
    id: `discovery-${randomUUID()}`,
    kind: f.kind,
    claim: f.claim,
    bearing: f.bearing,
    sourceUrl: f.sourceUrl,
    sourceTitle: f.sourceTitle,
    publishedAt: f.publishedAt,
    retrievedAt: now,
    identityConfidence: f.identityConfidence,
    matchedOn: f.matchedOn,
    // Stamped from the level actually in force, never from anything the model
    // said — a finding must not be able to claim it was found under a
    // narrower disclosure than the one that produced it.
    foundAtDisclosure: disclosure,
    materiality: f.materiality,
    corroboration: f.corroboration,
  }));

  // Only kinds we actually searched for can be reported as searched-and-absent.
  // A model listing a gated kind here would turn "we were not allowed to look"
  // into "we looked and it is not there", which is the exact inversion this
  // whole design exists to prevent.
  const searchedKinds = new Set<DiscoveryRecordKind>(plan.searchable.map(s => s.item.kind));
  const lookedForNotFound = parsed.data.lookedForNotFound.filter(k => searchedKinds.has(k) && !findings.some(f => f.kind === k));

  emit({
    kind: 'message',
    label: `${findings.length} finding(s), ${lookedForNotFound.length} searched and not found`,
    detail: findings.length > 0 ? findings.map(f => `${f.kind}: ${f.claim} (identity ${Math.round(f.identityConfidence * 100)}%)`).join('\n') : undefined,
  });

  return finish(
    'succeeded',
    undefined,
    {
      ranAt: now,
      disclosure,
      queriesRun,
      findings,
      lookedForNotFound,
      notLookedFor: plan.gated,
      unreachable: unreachableForTitle(),
    },
    usage,
  );
}
