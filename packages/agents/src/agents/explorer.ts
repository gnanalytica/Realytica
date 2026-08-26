/**
 * Explorer — the open-ended exploration agent.
 *
 * Every other agent in this package has a fixed output shape to fill; this
 * one does not. It is given an objective about a property's locality and
 * market, decides what to look at, follows what it finds, and stops when the
 * marginal lead stops paying. That open-endedness is exactly why it needs a
 * loop with real stopping conditions rather than one structured call.
 *
 * Privacy boundary — same as market research, and for the same reason: the
 * prompt is built exclusively from `renderCaseContext(..., { externalSafe:
 * true })`. The address, owner name, price and document contents must never
 * reach a web search. Do not widen this without a new, deliberately-reviewed
 * exception — see market-research.ts's file header for the same rule stated
 * once already.
 *
 * The honesty constraint this file is built around: for Indian property, the
 * authoritative sources — Kaveri, Bhoomi, the BBMP khata and tax portals —
 * are unreachable to a web agent (logins, CAPTCHAs, session state). An agent
 * that quietly fails on those and returns only what it scraped from listing
 * sites would be actively misleading. So every run seeds
 * `ExplorationSession.unreachable` with those sources up front — before
 * spending a single search on them — and `exploration-tools.ts` blocks their
 * domains outright so the model cannot burn budget rediscovering the same
 * dead end. Anything else that turns out to be gated during the run (a
 * captcha-dressed 200 OK, a login wall, a rate limit) is classified from real
 * tool telemetry and folded into the same list, with what it would have
 * answered stated plainly.
 *
 * The loop itself: each outer iteration is one bounded Anthropic request
 * (with its own internal search/fetch tool round trips) that ends in a
 * single structured JSON block — which leads it advanced, which new leads it
 * spawned and why, what turned out unreachable, and what it still does not
 * know. The explorer merges that into the running `ExplorationSession` in
 * its own code — never trusting the model's self-reported "visited" claims
 * without a matching fetch in that iteration's own tool telemetry — and
 * decides whether to continue. Two hard ceilings bound it: `maxIterations`
 * and `maxCostUsd`, both checked before every iteration starts, so an
 * open-ended agent can never become an open-ended bill.
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  AgentUsage,
  ExplorationLead,
  ExplorationSession,
  PropertyCase,
  ReferenceData,
  SourceReachability,
} from '@valytica/shared';
import { agentCapability, baseRequestFor, describeError, estimateUsage, getClient, modelFor, sumUsage, tierFor } from '../client';
import { GROUNDING_RULES, renderCaseContext } from '../context';
import {
  KNOWN_UNREACHABLE_SOURCES,
  classifyFetchError,
  classifyFetchedContent,
  createExplorationMemoryTool,
  createWebFetchTool,
  createWebSearchTool,
  extractFetchedText,
} from '../tools/exploration-tools';

export interface RunExplorerInput {
  caseId: string;
  caseData: PropertyCase;
  refData: ReferenceData;
  /** What to investigate. Defaults to a generic locality/market sweep when omitted. */
  objective?: string;
  maxIterations?: number;
  /** Hard cost ceiling in USD. The single most important safety property of this file — see the file header. */
  maxCostUsd?: number;
  /** ISO timestamp used to date the session — not wall-clock, so runs are reproducible. */
  now: string;
  onStep?: (step: AgentStep) => void;
}

export interface RunExplorerResult {
  run: AgentRun;
  session: ExplorationSession;
}

const DEFAULT_MAX_ITERATIONS = 6;
const DEFAULT_MAX_COST_USD = 0.75;
const MAX_TOKENS_PER_ITERATION = 8000;
/** SDK-internal search<->fetch round trips allowed within one outer iteration — a second, independent bound alongside max_uses on each tool. */
const MAX_TOOL_ROUND_TRIPS_PER_ITERATION = 6;
const SEARCH_USES_PER_ITERATION = 5;
const FETCH_USES_PER_ITERATION = 5;

const FALLBACK_OPEN_QUESTION =
  'This run did not produce a completed iteration, so nothing here should be treated as checked — locality and market claims for this case remain entirely unverified by this agent.';

function defaultObjective(caseData: PropertyCase): string {
  const { locality, city, propertyType } = caseData.identity;
  return (
    `Find genuinely reachable, recent signal on ${locality}, ${city}'s property market and locality risk for a ` +
    `${propertyType.replace(/_/g, ' ')}: infrastructure/metro/road and planning news, asking-price and inventory ` +
    `signal from listing portals, K-RERA public project pages for any named nearby project, and any court/NGT ` +
    `orders or local news about lakes, storm-water drains (rajakaluve) or land-acquisition notices that could ` +
    `affect this locality.`
  );
}

function seedKnownUnreachable(): ExplorationSession['unreachable'] {
  return KNOWN_UNREACHABLE_SOURCES.map(s => ({
    source: s.label,
    reachability: s.reachability,
    whatItWouldHaveAnswered: s.whatItWouldHaveAnswered,
  }));
}

/* ------------------------------------------------------------------ */
/* System prompt                                                       */
/* ------------------------------------------------------------------ */

const EXPLORER_SYSTEM_PROMPT = `
${GROUNDING_RULES}

You are the open-ended exploration agent. Unlike other agents in this product you have no fixed output shape to fill — you are given an objective about one property's locality and market, and you decide what to look at, follow what you find, and stop when the marginal lead stops paying.

You are given only locality-level market terms for this property — country, state, city, locality, property type, areas, and this app's own locality reference numbers. You are NEVER given the property's exact address, owner, price or documents — do not ask for them, and do not assume any exact address.

THE AUTHORITATIVE-SOURCE HONESTY RULE — read this carefully:
For Indian property, the authoritative sources — Kaveri (encumbrance/registration), Bhoomi (RTC/land records), and the BBMP khata and property-tax portals — sit behind logins, CAPTCHAs and session state that a web agent cannot pass. Their domains are already blocked from your search and fetch tools for exactly that reason — do not try to work around this, and never claim or imply you checked them. The harness has already logged them as unreachable with what each would have answered; you do not need to re-report those four. But if your own investigation surfaces a MORE SPECIFIC unreachable channel — e.g. "the mother deed's original registration needs in-person verification at the Sub-Registrar office", "the developer's MCA filings require a paid database" — report that too, in "unreachable", with what it would have answered.

WHAT IS GENUINELY WORTH PURSUING:
- Infrastructure and metro/road announcements for the locality
- Municipal and planning news (BBMP, BDA, BMRDA notifications, zoning changes)
- K-RERA public project pages (public, no login) for any named project
- Listing portals for asking-price / inventory signal
- Court and NGT orders affecting the area
- Local news about lakes, storm-water drains (rajakaluve) and land-acquisition notices

HOW YOU WORK, ONE ITERATION AT A TIME:
Each turn you are given the objective, the locality terms, and the current state of the investigation (leads already open, already closed, how many sources are already logged unreachable, and open questions so far). Each iteration is a FRESH conversation — you will not see your own reasoning text from a previous iteration, only the structured state you are given and whatever you saved under /memories/ with the memory tool. Use web_search to find things and web_fetch to read a specific page — web_fetch can only fetch a URL that has already appeared in this conversation (e.g. one a search just returned), never a URL from nowhere. The memory tool is optional scratch space for detail that would not fit in the structured update below; check it at the start of an iteration if you wrote something there before.

Only ever report a URL as "visited" if you actually called web_fetch on it THIS iteration — never list a search result you did not fetch; it will be dropped and flagged. Record a dead end honestly: "dead_end" is valuable information, not a failure to hide. A report that shows only wins is not trustworthy.

WHEN YOU ARE DONE FOR THIS ITERATION, end your ENTIRE response with nothing but a single fenced JSON code block, no text before or after it, in exactly this shape:

\`\`\`json
{
  "leadUpdates": [
    { "id": "<id from the state you were given>", "status": "answered|partial|dead_end", "queriesUsed": ["..."], "visited": [{"url": "...", "title": "...", "note": "..."}], "finding": "...", "confidence": 0.0 }
  ],
  "newLeads": [
    { "tempId": "L1", "question": "...", "motivation": "why this is worth following", "spawnedFromId": "<id of the lead that raised this — an existing id or another tempId from this same iteration; omit if none>", "status": "answered|partial|dead_end (omit if you have not investigated it yet this same iteration)", "queriesUsed": ["..."], "visited": [{"url": "...", "title": "...", "note": "..."}], "finding": "...", "confidence": 0.0 }
  ],
  "unreachable": [
    { "source": "...", "reachability": "fetched|blocked_auth|blocked_captcha|not_found|rate_limited", "whatItWouldHaveAnswered": "..." }
  ],
  "openQuestions": ["your FULL current account of everything you still do not know at this point, restating still-true ones from before — not just what's new this iteration"],
  "stop": "continue|objective_met|no_new_leads",
  "stopReason": "one sentence, plain language",
  "iterationSummary": "one or two sentences on what this iteration did"
}
\`\`\`

"openQuestions" must never come back empty just because the run is short or partial — say plainly what remains unknown, however little you managed. Use "stop":"objective_met" only when the objective is genuinely answered, not merely attempted. Use "stop":"no_new_leads" when you have nothing left worth searching for. Otherwise "continue". On the very first iteration, propose 2-4 initial leads for the objective (as "newLeads" with no "spawnedFromId") and start on the highest-priority one(s) — there is no prior state to advance yet; a new lead can carry its own "visited"/"finding"/"status" right away if you already investigated it this same iteration, so you do not need to wait a full extra iteration just to record what you already found.
`.trim();

/* ------------------------------------------------------------------ */
/* Per-iteration structured output                                     */
/* ------------------------------------------------------------------ */

const SOURCE_REACHABILITIES = ['fetched', 'blocked_auth', 'blocked_captcha', 'not_found', 'rate_limited'] as const;

const VisitedInputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  note: z.string().optional(),
});

const LeadUpdateInputSchema = z.object({
  id: z.string(),
  status: z.enum(['answered', 'partial', 'dead_end']),
  queriesUsed: z.array(z.string()).default([]),
  visited: z.array(VisitedInputSchema).default([]),
  finding: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const NewLeadInputSchema = z.object({
  tempId: z.string(),
  question: z.string(),
  motivation: z.string(),
  spawnedFromId: z.string().optional(),
  // A freshly-spawned lead may already have been investigated in the same
  // iteration it was proposed in (e.g. iteration 1 proposes AND fetches) — so
  // it can carry the same progress fields a leadUpdate can, all optional.
  status: z.enum(['answered', 'partial', 'dead_end']).optional(),
  queriesUsed: z.array(z.string()).default([]),
  visited: z.array(VisitedInputSchema).default([]),
  finding: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const UnreachableInputSchema = z.object({
  source: z.string(),
  reachability: z.enum(SOURCE_REACHABILITIES),
  whatItWouldHaveAnswered: z.string(),
});

const IterationUpdateSchema = z.object({
  leadUpdates: z.array(LeadUpdateInputSchema).default([]),
  newLeads: z.array(NewLeadInputSchema).default([]),
  unreachable: z.array(UnreachableInputSchema).default([]),
  openQuestions: z.array(z.string()).default([]),
  stop: z.enum(['continue', 'objective_met', 'no_new_leads']),
  stopReason: z.string(),
  iterationSummary: z.string(),
});
type IterationUpdate = z.infer<typeof IterationUpdateSchema>;

/** Pulls the trailing fenced JSON block (or the whole text, as a fallback) and parses it. Mirrors market-research.ts's helper of the same shape. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    return undefined;
  }
}

function renderIterationState(state: {
  leads: ExplorationLead[];
  unreachableCount: number;
  openQuestions: string[];
  iteration: number;
  maxIterations: number;
  budgetRemainingUsd: number;
}): string {
  const open = state.leads.filter(l => l.outcome === 'partial');
  const closed = state.leads.filter(l => l.outcome !== 'partial');

  const openBlock =
    open.length > 0
      ? open
          .map(
            l =>
              `- id=${l.id} — "${l.question}" (why: ${l.motivation}) — queries so far: ${l.queries.length}, pages visited: ${l.visited.length}` +
              (l.finding ? `, current finding: ${l.finding}` : ''),
          )
          .join('\n')
      : '(none yet)';

  const closedBlock =
    closed.length > 0
      ? closed.map(l => `- id=${l.id} — "${l.question}" -> ${l.outcome}${l.finding ? `: ${l.finding}` : ''}`).join('\n')
      : '(none yet)';

  const questionsBlock = state.openQuestions.length > 0 ? state.openQuestions.map(q => `- ${q}`).join('\n') : '(none recorded yet)';

  return [
    `Iteration ${state.iteration} of at most ${state.maxIterations}. Remaining budget: $${state.budgetRemainingUsd.toFixed(4)}.`,
    `${state.unreachableCount} source(s) already logged as unreachable (the 4 always-known registries are in your system instructions; check memory for any others you found).`,
    '',
    'OPEN LEADS (status "partial" — pick these up, or spawn new ones as warranted):',
    openBlock,
    '',
    'CLOSED LEADS (already answered or dead-ended — do not re-open unless you have a genuinely new angle):',
    closedBlock,
    '',
    'OPEN QUESTIONS SO FAR:',
    questionsBlock,
    '',
    state.iteration === 1
      ? 'This is the first iteration: propose 2-4 initial leads for the objective and start on the highest-priority one(s).'
      : 'Continue the investigation: advance open leads, spawn new ones only when something genuinely opens a new question, and close out anything you now believe is a dead end.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Merge bookkeeping                                                    */
/* ------------------------------------------------------------------ */

interface FetchTelemetry {
  reachability: SourceReachability;
  note?: string;
  title?: string;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase();
}

function addUnreachable(list: ExplorationSession['unreachable'], entry: ExplorationSession['unreachable'][number]): boolean {
  const key = normalizeKey(entry.source);
  if (list.some(u => normalizeKey(u.source) === key)) return false;
  list.push(entry);
  return true;
}

/**
 * Turns a model-reported `visited` list into real `ExplorationLead['visited']`
 * entries — but ONLY for URLs this iteration's own tool telemetry actually
 * observed a `web_fetch` for. A URL the model names without a matching fetch
 * is dropped and flagged rather than trusted (Evidence Before Assertion
 * applies to the explorer's own bookkeeping, not just its findings).
 */
function resolveVisited(
  claimed: { url: string; title?: string; note?: string }[],
  fetchTelemetry: Map<string, FetchTelemetry>,
  leadLabel: string,
  emit: (step: Omit<AgentStep, 'id' | 'at'>) => void,
): { visited: ExplorationLead['visited']; anyResolved: boolean } {
  const visited: ExplorationLead['visited'] = [];
  let anyResolved = false;
  for (const v of claimed) {
    const telemetry = fetchTelemetry.get(v.url);
    if (!telemetry) {
      emit({
        kind: 'error',
        label: 'Unverified "visited" claim dropped',
        detail: `${leadLabel} reported visiting ${v.url} but no matching web_fetch was observed this iteration — dropped rather than trusted.`,
      });
      continue;
    }
    visited.push({
      url: v.url,
      title: telemetry.title ?? v.title,
      reachability: telemetry.reachability,
      note: [v.note, telemetry.note].filter((n): n is string => Boolean(n)).join(' — ') || undefined,
    });
    anyResolved = true;
  }
  return { visited, anyResolved };
}

/**
 * Merges one iteration's parsed update into the running session state.
 * Mutates `leads` and `unreachable` in place, returns the new `openQuestions`
 * (or the prior list unchanged if this iteration reported none) and whether
 * anything genuinely novel happened — the input to the `no_new_leads` guard.
 */
function mergeIterationUpdate(
  update: IterationUpdate,
  leads: ExplorationLead[],
  unreachable: ExplorationSession['unreachable'],
  openQuestionsBefore: string[],
  fetchTelemetry: Map<string, FetchTelemetry>,
  emit: (step: Omit<AgentStep, 'id' | 'at'>) => void,
): { openQuestions: string[]; progressed: boolean } {
  let progressed = false;

  for (const lu of update.leadUpdates) {
    const lead = leads.find(l => l.id === lu.id);
    if (!lead) {
      emit({ kind: 'error', label: 'Unknown lead id in model output', detail: `Ignored an update for lead id "${lu.id}", which is not in this session.` });
      continue;
    }
    for (const q of lu.queriesUsed) {
      if (!lead.queries.includes(q)) lead.queries.push(q);
    }
    const alreadyVisited = new Set(lead.visited.map(v => v.url));
    const { visited: newlyResolved } = resolveVisited(
      lu.visited.filter(v => !alreadyVisited.has(v.url)),
      fetchTelemetry,
      `Lead "${lead.question}"`,
      emit,
    );
    if (newlyResolved.length > 0) {
      lead.visited.push(...newlyResolved);
      progressed = true;
    }
    if (lead.outcome !== lu.status) {
      lead.outcome = lu.status;
      progressed = true;
    }
    if (lu.finding && lu.finding !== lead.finding) {
      lead.finding = lu.finding;
      progressed = true;
    }
    if (typeof lu.confidence === 'number') lead.confidence = lu.confidence;
  }

  const tempIdToFinalId = new Map<string, string>();
  const createdLeads: ExplorationLead[] = [];
  for (const nl of update.newLeads) {
    const id = `lead-${randomUUID()}`;
    tempIdToFinalId.set(nl.tempId, id);
    // A freshly-spawned lead can already carry its own first findings (see
    // NewLeadInputSchema) — e.g. iteration 1 proposes AND immediately fetches.
    const { visited, anyResolved } = resolveVisited(nl.visited, fetchTelemetry, `New lead "${nl.question}"`, emit);
    if (anyResolved) progressed = true;
    createdLeads.push({
      id,
      question: nl.question,
      motivation: nl.motivation,
      queries: [...new Set(nl.queriesUsed)],
      visited,
      outcome: nl.status ?? 'partial',
      confidence: nl.confidence ?? 0,
      spawnedLeadIds: [],
    });
  }
  for (const nl of update.newLeads) {
    if (!nl.spawnedFromId) continue;
    const childId = tempIdToFinalId.get(nl.tempId);
    if (!childId) continue;
    const parentId = tempIdToFinalId.get(nl.spawnedFromId) ?? nl.spawnedFromId;
    const parent = leads.find(l => l.id === parentId) ?? createdLeads.find(l => l.id === parentId);
    if (parent && !parent.spawnedLeadIds.includes(childId)) parent.spawnedLeadIds.push(childId);
  }
  if (createdLeads.length > 0) {
    leads.push(...createdLeads);
    progressed = true;
  }

  for (const u of update.unreachable) {
    const added = addUnreachable(unreachable, u);
    if (added) progressed = true;
  }
  // Fold in anything the telemetry itself caught that the model didn't self-report —
  // a gate the explorer hit is unreachable whether or not the model thought to say so.
  for (const [url, t] of fetchTelemetry) {
    if (t.reachability === 'fetched' || t.reachability === 'not_found') continue;
    const owningLead = leads.find(l => l.visited.some(v => v.url === url));
    const added = addUnreachable(unreachable, {
      source: url,
      reachability: t.reachability,
      whatItWouldHaveAnswered: owningLead ? owningLead.question : (t.note ?? 'Not established — this page was found while exploring but never successfully read.'),
    });
    if (added) progressed = true;
  }

  const openQuestions = update.openQuestions.length > 0 ? update.openQuestions : openQuestionsBefore;
  return { openQuestions, progressed };
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                     */
/* ------------------------------------------------------------------ */

export async function runExplorer(input: RunExplorerInput): Promise<RunExplorerResult> {
  const { caseId, caseData, refData, now } = input;
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxCostUsd = input.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  const objective = input.objective?.trim() || defaultObjective(caseData);

  const runId = randomUUID();
  const sessionId = randomUUID();
  // The AgentRun's own bookkeeping timestamps are wall-clock, matching every
  // other agent in this package. `now` instead dates the *session* — the
  // domain artifact this agent produces — so a run replayed against the same
  // inputs is reproducible, the same convention market-research.ts uses for
  // `ResearchFinding.retrievedAt` and copilot.ts for `CopilotTurn.at`.
  const startedAt = new Date().toISOString();
  const steps: AgentStep[] = [];

  const emit = (step: Omit<AgentStep, 'id' | 'at'>): void => {
    const full: AgentStep = { id: randomUUID(), at: new Date().toISOString(), ...step };
    steps.push(full);
    input.onStep?.(full);
  };

  // Resolved once, at the top, so the model recorded on the run is the model
  // every iteration was built with and the model their usage was priced
  // against — this agent's budget check reads that cost, so a mispriced
  // iteration would move the stopping point, not just the report.
  const tier = tierFor('explorer');
  const model = modelFor('explorer');

  const leads: ExplorationLead[] = [];
  const unreachable: ExplorationSession['unreachable'] = seedKnownUnreachable();
  let openQuestions: string[] = [];
  let usage: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0 };

  const buildSession = (iterations: number, stoppedBecause: ExplorationSession['stoppedBecause']): ExplorationSession => ({
    id: sessionId,
    caseId,
    objective,
    startedAt: now,
    finishedAt: new Date().toISOString(),
    leads,
    unreachable,
    openQuestions: openQuestions.length > 0 ? openQuestions : [FALLBACK_OPEN_QUESTION],
    iterations,
    stoppedBecause,
    usage,
  });

  const buildRun = (status: AgentRunStatus, error: string | undefined): AgentRun => ({
    id: runId,
    caseId,
    agent: 'explorer',
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    model,
    tier,
    steps,
    summary:
      status === 'succeeded'
        ? `${leads.length} lead(s) explored, ${unreachable.length} source(s) unreachable, ${openQuestions.length} open question(s).`
        : undefined,
    error,
    usage,
    producedEvidenceIds: [],
  });

  emit({ kind: 'plan', label: `Exploring ${caseData.identity.locality}, ${caseData.identity.city}`, detail: objective });
  for (const src of unreachable) {
    emit({ kind: 'message', label: `Known unreachable: ${src.source}`, detail: src.whatItWouldHaveAnswered });
  }

  const capability = agentCapability();
  if (!capability.available) {
    const reason = `The explorer is unavailable (${capability.reason}) — Anthropic credentials are not configured.`;
    emit({ kind: 'error', label: 'Agent unavailable', detail: reason });
    return { run: buildRun('failed', reason), session: buildSession(0, 'error') };
  }
  if (!capability.webSearchEnabled) {
    const reason = 'Web search is disabled for this deployment (set VALYTICA_AGENT_WEB_SEARCH=1 to enable) — exploration was skipped rather than run without it.';
    emit({ kind: 'plan', label: 'Skipped — web search disabled', detail: reason });
    return { run: buildRun('cancelled', reason), session: buildSession(0, 'error') };
  }
  const client = getClient();
  if (!client) {
    const reason = 'Anthropic credentials are not configured — the explorer is unavailable.';
    emit({ kind: 'error', label: 'No credentials', detail: reason });
    return { run: buildRun('failed', reason), session: buildSession(0, 'error') };
  }

  // externalSafe: no documents, no owner, no address, no price. See the file
  // header — this is the one context render this file is allowed to build a
  // prompt from.
  const contextBlock = renderCaseContext(caseData, refData, { externalSafe: true });

  const searchTool = createWebSearchTool(SEARCH_USES_PER_ITERATION);
  const fetchTool = createWebFetchTool(FETCH_USES_PER_ITERATION);
  const memory = createExplorationMemoryTool();

  const systemBlocks = [
    { type: 'text' as const, text: EXPLORER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } },
    {
      type: 'text' as const,
      text: `Objective:\n${objective}\n\nLocality market terms (all you are given about this case — do not ask for more):\n${contextBlock}`,
      cache_control: { type: 'ephemeral' as const },
    },
  ];

  let completedIterations = 0;
  let stoppedBecause: ExplorationSession['stoppedBecause'] | undefined;
  let hardError: string | undefined;

  for (let i = 1; i <= maxIterations; i++) {
    if (usage.estimatedCostUsd >= maxCostUsd) {
      stoppedBecause = 'budget_exhausted';
      break;
    }

    emit({
      kind: 'plan',
      label: `Iteration ${i}/${maxIterations}`,
      detail: `Budget used $${usage.estimatedCostUsd.toFixed(4)} of $${maxCostUsd.toFixed(2)}`,
    });

    const userMessage = renderIterationState({
      leads,
      unreachableCount: unreachable.length,
      openQuestions,
      iteration: i,
      maxIterations,
      budgetRemainingUsd: Math.max(0, maxCostUsd - usage.estimatedCostUsd),
    });

    const requestParams = {
      ...baseRequestFor('explorer'),
      max_tokens: MAX_TOKENS_PER_ITERATION,
      system: systemBlocks,
      tools: [searchTool, fetchTool, memory.tool],
      messages: [{ role: 'user' as const, content: userMessage }],
      max_iterations: MAX_TOOL_ROUND_TRIPS_PER_ITERATION,
    };

    const fetchUrlByToolUseId = new Map<string, string>();
    const fetchTelemetry = new Map<string, FetchTelemetry>();

    let final: Anthropic.Beta.BetaMessage;
    try {
      const runner = client.beta.messages.toolRunner(requestParams);
      // web_search/web_fetch are server-side tools: a long turn can come back
      // with stop_reason "pause_turn" after the server's own iteration limit.
      // The runner does not auto-resume that — it would otherwise silently
      // truncate this iteration — so it is handled explicitly, matching
      // market-research.ts.
      for await (const message of runner) {
        if (message.stop_reason === 'pause_turn') {
          runner.pushMessages({ role: 'assistant', content: message.content });
        }
        for (const block of message.content) {
          if (block.type === 'server_tool_use' && block.name === 'web_search') {
            const query = typeof block.input.query === 'string' ? block.input.query : undefined;
            emit({ kind: 'tool_call', label: query ? `Searching: "${query}"` : 'Searching the web', toolName: 'web_search' });
          }
          if (block.type === 'server_tool_use' && block.name === 'web_fetch') {
            const url = typeof block.input.url === 'string' ? block.input.url : undefined;
            if (url) fetchUrlByToolUseId.set(block.id, url);
            emit({ kind: 'tool_call', label: url ? `Fetching ${url}` : 'Fetching a page', toolName: 'web_fetch' });
          }
          if (block.type === 'web_search_tool_result') {
            const content = block.content;
            if (Array.isArray(content)) {
              emit({ kind: 'tool_result', label: `Found ${content.length} result(s)` });
            } else {
              emit({ kind: 'error', label: 'Web search error', detail: content.error_code });
            }
          }
          if (block.type === 'web_fetch_tool_result') {
            const content = block.content;
            if (content.type === 'web_fetch_tool_result_error') {
              const url = fetchUrlByToolUseId.get(block.tool_use_id);
              if (url) {
                const { reachability, note } = classifyFetchError(content.error_code, url);
                fetchTelemetry.set(url, { reachability, note });
                emit({ kind: 'tool_result', label: `Fetch blocked: ${url}`, detail: note ?? content.error_code });
              } else {
                emit({ kind: 'error', label: 'Web fetch error', detail: content.error_code });
              }
            } else {
              const url = content.url;
              const text = extractFetchedText(content);
              const { reachability, note } = classifyFetchedContent(text);
              fetchTelemetry.set(url, { reachability, note, title: content.content.title ?? undefined });
              emit({ kind: 'tool_result', label: `Fetched ${url}`, detail: reachability === 'fetched' ? undefined : note });
            }
          }
        }
      }
      final = await runner.done();
    } catch (e) {
      hardError = describeError(e);
      emit({ kind: 'error', label: 'Anthropic request failed', detail: hardError });
      stoppedBecause = 'error';
      break;
    }

    usage = sumUsage([usage, estimateUsage(model, final.usage)]);

    if (final.stop_reason === 'refusal') {
      hardError = 'Claude declined to continue this iteration (safety filtering).';
      emit({ kind: 'error', label: 'Request refused', detail: hardError });
      stoppedBecause = 'error';
      break;
    }
    if (final.stop_reason === 'pause_turn') {
      hardError = `Iteration ${i} paused repeatedly without concluding — treating the run as stopped rather than guessing at a partial iteration.`;
      emit({ kind: 'error', label: 'Iteration did not conclude', detail: hardError });
      stoppedBecause = 'error';
      break;
    }

    const textBlocks = final.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text');
    const rawText = textBlocks.map(b => b.text).join('\n\n');
    const parsed = IterationUpdateSchema.safeParse(extractJson(rawText));
    if (!parsed.success) {
      hardError = `Iteration ${i} did not return a valid structured update: ${parsed.error.message}`;
      emit({ kind: 'error', label: 'Invalid iteration output', detail: hardError });
      stoppedBecause = 'error';
      break;
    }

    completedIterations = i;
    const update = parsed.data;
    const merged = mergeIterationUpdate(update, leads, unreachable, openQuestions, fetchTelemetry, emit);
    openQuestions = merged.openQuestions;

    emit({ kind: 'message', label: `Iteration ${i}: ${update.iterationSummary}` });

    if (update.stop === 'objective_met') {
      stoppedBecause = 'objective_met';
      break;
    }
    if (update.stop === 'no_new_leads' || !merged.progressed) {
      stoppedBecause = 'no_new_leads';
      emit({ kind: 'plan', label: 'Stopping — no new leads', detail: update.stopReason });
      break;
    }
  }

  const finalStoppedBecause = stoppedBecause ?? 'budget_exhausted';
  const runStatus: AgentRunStatus = completedIterations === 0 ? 'failed' : 'succeeded';
  emit({
    kind: 'message',
    label: `Exploration finished: ${finalStoppedBecause}`,
    detail: `${leads.length} lead(s), ${unreachable.length} unreachable source(s), $${usage.estimatedCostUsd.toFixed(4)} spent over ${completedIterations} iteration(s).`,
  });

  return {
    run: buildRun(runStatus, hardError),
    session: buildSession(completedIterations, finalStoppedBecause),
  };
}
