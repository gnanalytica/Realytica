/**
 * Proof-pathways agent.
 *
 * This is the agent that answers the question the whole product exists to
 * answer for a Bengaluru buyer: given exactly what is missing or unresolved
 * on this case, what are *all* the real ways to close each gap — which
 * authority, which portal, what it costs, how long it takes, what can go
 * wrong, and what to do when the primary route is genuinely blocked.
 *
 * The gap list itself is never asked of the model. `runScreen` (the
 * deterministic engine) already knows exactly which required documents are
 * absent and which state-pack compliance checks came back `unknown` or
 * `blocker` — asking the model to *also* guess at what's missing would only
 * invite it to invent or miss something the engine already has a definitive
 * answer for. So this file derives the gap list itself, deterministically,
 * and the model's only job is to reason about *routes* for a gap list it is
 * simply handed.
 *
 * Jurisdiction safety: the only proof-route corpus this codebase has is
 * Karnataka's (`knowledge/karnataka-proof-routes.ts`). It is included in the
 * prompt only when the case's resolved state pack is actually `karnataka` —
 * for any other state/country (including a Netherlands case, or an Indian
 * case in a state with no pack yet) the model is explicitly told it has no
 * verified jurisdiction-specific corpus and is forbidden from naming any
 * Karnataka/BBMP-specific institution.
 *
 * Fan-out: each gap is independent of every other gap, so each gets its own
 * model call rather than all of them sharing one response budget — a case
 * with eight gaps used to mean the eighth got whatever attention and output
 * budget was left after the first seven; now every gap gets a full, focused
 * call. Calls run concurrently with a small cap (`GAP_FANOUT_CONCURRENCY`).
 * The system prompt (grounding rules, role, jurisdiction notice, and the
 * Karnataka corpus where it applies) does not depend on which gap is being
 * asked about, so it is built exactly once and passed byte-identical into
 * every call — the same text with the same `cache_control` marker on every
 * request is what lets prompt caching absorb the fan-out cheaply. One gap's
 * call failing (network error, refusal, bad output) never loses the others:
 * it is reported via `buildPathwayFromValidated`'s existing "no route
 * analysis was produced" fallback, exactly as an uncovered gap already was
 * before this file fanned out at all.
 */

import { z } from 'zod';
import type {
  AgentRun,
  AgentStep,
  AgentUsage,
  CapabilityGap,
  ComplianceVerdict,
  CurrencyCode,
  DocumentKind,
  DocumentPathway,
  EvidenceItem,
  PromptUsage,
  ProofRoute,
  ProofRouteKind,
  PropertyCase,
  ReferenceData,
  ScreenResult,
  RetrievalSelection,
  TitleGraph,
} from '@valytica/shared';
import { describeError, sumUsage } from '../client';
import { buildTitleGraph } from '@valytica/shared';
import { PROMPT_KEYS, resolvePrompt } from '../prompts';
import { retrieveCaseContext } from '../retrieval';
import { KARNATAKA_PROOF_ROUTES_VERIFY_BANNER, renderKarnatakaProofRoutesCorpus } from '../knowledge/karnataka-proof-routes';
import { describeGap } from '../routing';
import { mergeGaps, missingCredentialsDetail, resolveRoute, toolUseOf } from '../providers';
import type { LlmProvider } from '../providers';

const TOOL_NAME = 'emit_document_pathway';

/* ------------------------------------------------------------------ */
/* Deterministic gap derivation                                        */
/* ------------------------------------------------------------------ */

interface Gap {
  targetKind: DocumentPathway['targetKind'];
  targetKey: string;
  targetLabel: string;
  whyItMatters: string;
  /** DocumentKind(s) that would satisfy this gap, where it is a missing document. */
  documentKinds: DocumentKind[];
  /** State-pack title-check keys this gap corresponds to, where it is a compliance check. */
  relatedComplianceCheckKeys: string[];
  relatedRiskIds: string[];
  verdict?: ComplianceVerdict;
}

/**
 * Every evidence gap on the case, derived purely from what `runScreen`
 * already computed. Never asks the model what is missing.
 */
function deriveGaps(result: ScreenResult): Gap[] {
  const gaps = new Map<string, Gap>();

  for (const item of result.completeness.items) {
    if (item.required && !item.present) {
      gaps.set(`doc:${item.key}`, {
        targetKind: 'missing_document',
        targetKey: item.key,
        targetLabel: item.label,
        whyItMatters: item.note && item.note.length > 0 ? item.note : `${item.label} is required for a complete screen and is not currently on file.`,
        documentKinds: item.satisfiedBy,
        relatedComplianceCheckKeys: [],
        relatedRiskIds: [],
      });
    }
  }

  if (result.stateCompliance) {
    for (const check of result.stateCompliance.checks) {
      if (check.verdict === 'unknown' || check.verdict === 'blocker') {
        gaps.set(`check:${check.key}`, {
          targetKind: 'unresolved_check',
          targetKey: check.key,
          targetLabel: check.label,
          whyItMatters: check.consequence,
          documentKinds: [],
          relatedComplianceCheckKeys: [check.key],
          relatedRiskIds: check.relatedRiskIds,
          verdict: check.verdict,
        });
      }
    }
    // Defensive: `unresolved` is a label list the engine also produces from
    // the same `verdict === 'unknown'` checks above, so in practice every
    // entry is already covered by the loop above — but the two lists are not
    // contractually guaranteed to stay in lockstep, so anything here that
    // does not already match a known check label still gets its own gap
    // rather than being silently dropped.
    for (const label of result.stateCompliance.unresolved) {
      const alreadyCovered = [...gaps.values()].some(g => g.targetLabel === label);
      if (!alreadyCovered) {
        gaps.set(`unresolved:${label}`, {
          targetKind: 'unresolved_check',
          targetKey: label,
          targetLabel: label,
          whyItMatters: 'This check could not be resolved from the evidence currently on file.',
          documentKinds: [],
          relatedComplianceCheckKeys: [],
          relatedRiskIds: [],
        });
      }
    }
  }

  return [...gaps.values()];
}

/* ------------------------------------------------------------------ */
/* Model output contract — zod validation + a hand-authored JSON Schema */
/* that mirrors it exactly for the strict tool definition.              */
/*                                                                      */
/* (This SDK's bundled Zod tool/output-format helpers are beta-only and */
/* geared at the tool-runner's agent loop; here we want one forced,     */
/* single-shot tool call, so the schema is authored directly and zod is */
/* used only to validate the `unknown` tool input we get back — no      */
/* `any`, no unchecked cast.)                                           */
/* ------------------------------------------------------------------ */

const ROUTE_KINDS: ProofRouteKind[] = [
  'online_portal',
  'in_person_office',
  'authorised_intermediary',
  'from_seller',
  'from_lender',
  'court_or_tribunal',
  'reconstruct_from_secondary',
];

const FEASIBILITIES: ProofRoute['feasibility'][] = ['straightforward', 'moderate', 'difficult', 'blocked'];

const RouteSchema = z.object({
  kind: z.enum(ROUTE_KINDS as [ProofRouteKind, ...ProofRouteKind[]]),
  title: z.string().min(1),
  authority: z.string().min(1),
  portalOrAddress: z.string().nullable(),
  formOrReference: z.string().nullable(),
  steps: z.array(z.string().min(1)),
  prerequisites: z.array(z.string()),
  typicalCostLowInr: z.number().nullable(),
  typicalCostHighInr: z.number().nullable(),
  typicalDurationDaysLow: z.number().nullable(),
  typicalDurationDaysHigh: z.number().nullable(),
  feasibility: z.enum(FEASIBILITIES as [ProofRoute['feasibility'], ...ProofRoute['feasibility'][]]),
  risks: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

const PathwaySchema = z.object({
  targetKey: z.string().min(1),
  whyItMatters: z.string().min(1),
  routes: z.array(RouteSchema),
  recommendedRouteIndex: z.number().int().nullable(),
  recommendedRouteRationale: z.string().nullable(),
  unlocks: z.array(z.string()),
  wouldResolve: z.array(z.string()),
});

type ValidatedPathway = z.infer<typeof PathwaySchema>;

const ROUTE_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    kind: { type: 'string', enum: ROUTE_KINDS, description: 'The mechanism of this route.' },
    title: { type: 'string', description: 'Short label for this route, e.g. "Kaveri Online Services e-khata reprint".' },
    authority: { type: 'string', description: 'The body that actually issues or handles this, e.g. "BBMP", "Sub-Registrar", "Deputy Commissioner (Land Revenue)".' },
    portalOrAddress: { type: ['string', 'null'], description: 'Portal name/URL or office address, where one applies. Null if not applicable.' },
    formOrReference: { type: ['string', 'null'], description: 'Form number, Sakala service code, or statutory section. Null if none.' },
    steps: { type: 'array', items: { type: 'string' }, description: 'Ordered, concrete steps a buyer would actually take.' },
    prerequisites: { type: 'array', items: { type: 'string' }, description: 'What must already be true or in hand before this route can be started.' },
    typicalCostLowInr: { type: ['number', 'null'], description: 'Low end of an indicative INR cost range. Null if no material government fee or not applicable.' },
    typicalCostHighInr: { type: ['number', 'null'], description: 'High end of the indicative INR cost range. Null together with the low end.' },
    typicalDurationDaysLow: { type: ['number', 'null'], description: 'Low end of an indicative working-day duration range. Null if not applicable.' },
    typicalDurationDaysHigh: { type: ['number', 'null'], description: 'High end of the indicative duration range. Null together with the low end.' },
    feasibility: { type: 'string', enum: FEASIBILITIES, description: '"blocked" means this is not actually a working route for this case — describe why in risks rather than a normal procedure.' },
    risks: { type: 'array', items: { type: 'string' }, description: 'Concrete, stated ways this route can fail or fall short — never omitted just because the route otherwise looks clean.' },
    confidence: { type: 'number', description: '0..1 — how confident you are this route is correctly described for this case.' },
  },
  required: [
    'kind',
    'title',
    'authority',
    'portalOrAddress',
    'formOrReference',
    'steps',
    'prerequisites',
    'typicalCostLowInr',
    'typicalCostHighInr',
    'typicalDurationDaysLow',
    'typicalDurationDaysHigh',
    'feasibility',
    'risks',
    'confidence',
  ],
  additionalProperties: false,
};

const PATHWAY_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    targetKey: { type: 'string', description: 'Must exactly match the targetKey of the one gap you were given.' },
    whyItMatters: {
      type: 'string',
      description: 'Why this gap matters, ending with which route you recommend and why (there is no separate rationale field — say it here).',
    },
    routes: {
      type: 'array',
      items: ROUTE_JSON_SCHEMA,
      description: 'Every viable route, ranked best-first. An empty array is correct and honest when no real route exists.',
    },
    recommendedRouteIndex: { type: ['integer', 'null'], description: 'Index into routes[] of the recommended route. Null if routes is empty or none is genuinely better than another.' },
    recommendedRouteRationale: { type: ['string', 'null'], description: 'One or two sentences on why that route is recommended over the others. Null if recommendedRouteIndex is null.' },
    unlocks: { type: 'array', items: { type: 'string' }, description: 'What becomes provable once this lands, in plain language.' },
    wouldResolve: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Name the SPECIFIC screen outputs that would change — a named compliance-check key, a named risk id or title, or a named confidence-factor key from what you were given. Generic statements like "improves the screen" are not acceptable here.',
    },
  },
  required: ['targetKey', 'whyItMatters', 'routes', 'recommendedRouteIndex', 'recommendedRouteRationale', 'unlocks', 'wouldResolve'],
  additionalProperties: false,
};

/* ------------------------------------------------------------------ */
/* Prompt assembly                                                     */
/* ------------------------------------------------------------------ */

/**
 * This agent's role text lives in `../prompts/registry.ts` under the key
 * `proof_pathways.system`; version 1 is byte-identical to the
 * `GROUNDING_RULES` plus `PROOF_PATHWAYS_ROLE` plus jurisdiction-notice string
 * this file used to join inline, with the shared preamble composed in through
 * `{{grounding}}` as before.
 *
 * What stays here, deliberately:
 *
 * - The jurisdiction notice below. It is the sentence that tells this agent
 *   whether it has a corpus at all, and for a non-Karnataka case it is what
 *   stops it naming BBMP, Kaveri or Sakala for a property in a state where
 *   none of those exist. That is derived from the case, not authored, and an
 *   editable version of it would let somebody grant the agent grounding it
 *   does not have. It arrives as `{{jurisdictionNotice}}`.
 * - The Karnataka corpus itself, appended after the prompt. It is reference
 *   data with its own file and its own verification banner, not prose.
 */
function buildJurisdictionNotice(caseData: PropertyCase, karnatakaApplies: boolean): string {
  if (karnatakaApplies) {
    return (
      'This case is in Karnataka, India. The Karnataka/Bengaluru proof-sourcing corpus below is your grounding for this ' +
      'case: use only the authorities, portals and route kinds it names (or a clearly-labelled, obvious extension of ' +
      'them — e.g. the same office for a related sub-service). Do not invent institutions the corpus does not mention. ' +
      KARNATAKA_PROOF_ROUTES_VERIFY_BANNER
    );
  }
  const { country, state } = caseData.identity;
  return (
    `This case is in ${state}, ${country} — NOT Karnataka. No Karnataka/Bengaluru-specific proof-sourcing corpus is ` +
    'loaded for this build. Do NOT reference BBMP, Kaveri Online Services, Khata, DC conversion, K-RERA, BDA, BMRDA, ' +
    'Sakala, or Gram Panchayat for this case under any circumstances — those are Karnataka-only institutions. You may ' +
    "reference only the authority names already present in this case's own country/state pack context below (e.g. " +
    'registrationAuthority, reraAuthority, statutoryRatePortal), where given. Where you do not have enough grounding ' +
    'to name a concrete, real route for this jurisdiction, return an empty routes array for that pathway and say so ' +
    'honestly in whyItMatters — never invent a plausible-sounding procedure for a jurisdiction you have no corpus for.'
  );
}

/**
 * The full system text for one run's gap fan-out, and what it was built from.
 *
 * Resolved once and shared across every gap's call — byte-identical for all of
 * them, which is what lets the concurrent requests share one cached prompt
 * prefix instead of each paying full price for the grounding rules, role and
 * corpus. Resolution is deterministic for a given version, so that stays true.
 */
async function buildSystemText(
  caseData: PropertyCase,
  karnatakaApplies: boolean,
): Promise<{ text: string; usages: PromptUsage[] }> {
  const prompt = await resolvePrompt(PROMPT_KEYS.proofPathwaysSystem, {
    jurisdictionNotice: buildJurisdictionNotice(caseData, karnatakaApplies),
  });
  const parts = [prompt.content];
  if (karnatakaApplies) {
    parts.push(renderKarnatakaProofRoutesCorpus());
  }
  return { text: parts.join('\n\n'), usages: prompt.usages };
}

/**
 * The case context stays in the *user* message rather than the cached system
 * prefix deliberately: it embeds the live screen result, which is exactly the
 * kind of case-specific content the system prefix must NOT vary with, turn to
 * turn, for caching to stay valid. Keeping it here is what lets
 * `buildSystemText`'s output stay a fixed, gap-independent string.
 *
 * It is no longer identical across the fan-out, and that is the point. This
 * agent renders a context per gap, so a whole-case render was paid once per
 * gap — the most expensive context in the system. Retrieval focuses each one
 * on the gap it is actually about: the khata gap gets the register evidence
 * and the parcel's graph neighbourhood, not every comparable in the locality.
 */
function buildGapUserText(
  caseData: PropertyCase,
  refData: ReferenceData,
  result: ScreenResult,
  gap: Gap,
  graph: TitleGraph | undefined,
): { text: string; selection: RetrievalSelection } {
  const confidenceFactors = result.confidence.factors.map(f => ({ key: f.key, label: f.label }));
  const openRisks = result.risks
    .filter(r => r.status === 'open')
    .map(r => ({ id: r.id, title: r.title, severity: r.severity, category: r.category }));

  const retrieved = retrieveCaseContext({
    caseData,
    refData,
    agent: 'proof_pathways',
    graph,
    focus: [gap.targetLabel, gap.targetKey, gap.whyItMatters].filter((x): x is string => Boolean(x)),
  });

  const text = [
    'CASE CONTEXT (JSON) — for jurisdiction, property-type and khata/conversion facts:',
    retrieved.text,
    '',
    'CONFIDENCE FACTORS — cite by "key" in wouldResolve where this pathway would move one of these:',
    JSON.stringify(confidenceFactors, null, 1),
    '',
    'OPEN RISKS — cite by "id" or "title" in wouldResolve/unlocks where this pathway would address one of these:',
    JSON.stringify(openRisks, null, 1),
    '',
    'THE GAP TO ADDRESS — produce exactly one pathway for this gap, matching targetKey exactly:',
    JSON.stringify(gap, null, 1),
  ].join('\n');

  return { text, selection: retrieved.selection };
}

/* ------------------------------------------------------------------ */
/* Route / pathway assembly from the validated model output            */
/* ------------------------------------------------------------------ */

function toProofRoute(id: string, route: ValidatedPathway['routes'][number], currency: CurrencyCode): ProofRoute {
  const typicalCost =
    route.typicalCostLowInr !== null && route.typicalCostHighInr !== null
      ? { low: route.typicalCostLowInr, high: route.typicalCostHighInr, currency }
      : undefined;
  const typicalDurationDays =
    route.typicalDurationDaysLow !== null && route.typicalDurationDaysHigh !== null
      ? { low: route.typicalDurationDaysLow, high: route.typicalDurationDaysHigh }
      : undefined;
  return {
    id,
    kind: route.kind,
    title: route.title,
    authority: route.authority,
    portalOrAddress: route.portalOrAddress ?? undefined,
    formOrReference: route.formOrReference ?? undefined,
    steps: route.steps,
    prerequisites: route.prerequisites,
    typicalCost,
    typicalDurationDays,
    feasibility: route.feasibility,
    risks: route.risks,
    confidence: Math.max(0, Math.min(1, route.confidence)),
    evidenceIds: [],
  };
}

function buildPathwayFromValidated(
  pathwayId: string,
  gap: Gap,
  validated: ValidatedPathway | undefined,
  currency: CurrencyCode,
  evidenceId: string,
): { pathway: DocumentPathway; evidence: EvidenceItem } {
  if (!validated) {
    // The model failed to cover this gap. Never fabricate a route on its
    // behalf — surface the shortfall honestly instead.
    const pathway: DocumentPathway = {
      id: pathwayId,
      targetKind: gap.targetKind,
      targetKey: gap.targetKey,
      targetLabel: gap.targetLabel,
      whyItMatters: `${gap.whyItMatters} (The proof-pathways agent did not return a route analysis for this gap in its last run — treat it as unresolved and investigate manually.)`,
      routes: [],
      recommendedRouteId: undefined,
      unlocks: [],
      wouldResolve: [],
    };
    const evidence: EvidenceItem = {
      id: evidenceId,
      statement: `No route analysis was produced for "${gap.targetLabel}".`,
      sourceType: 'model_inference',
      sourceRef: gap.targetKey,
      sourceLabel: 'Proof-pathways agent',
      confidence: 0.2,
      capturedAt: new Date().toISOString(),
    };
    return { pathway, evidence };
  }

  const routes = validated.routes.map((r, i) => toProofRoute(`${pathwayId}-route-${i + 1}`, r, currency));
  const recommendedRouteId =
    validated.recommendedRouteIndex !== null && validated.recommendedRouteIndex >= 0 && validated.recommendedRouteIndex < routes.length
      ? routes[validated.recommendedRouteIndex].id
      : undefined;
  const recommendedRoute = recommendedRouteId ? routes.find(r => r.id === recommendedRouteId) : undefined;
  const whyItMatters =
    recommendedRoute && validated.recommendedRouteRationale
      ? `${validated.whyItMatters} Recommended: ${recommendedRoute.title} — ${validated.recommendedRouteRationale}`
      : validated.whyItMatters;

  // Every route traces back to this one model-inference evidence item — the
  // whole pathway is a single labelled inference, not a documented fact.
  for (const route of routes) {
    route.evidenceIds = [evidenceId];
  }

  const avgConfidence = routes.length > 0 ? routes.reduce((sum, r) => sum + r.confidence, 0) / routes.length : 0.3;

  const pathway: DocumentPathway = {
    id: pathwayId,
    targetKind: gap.targetKind,
    targetKey: gap.targetKey,
    targetLabel: gap.targetLabel,
    whyItMatters,
    routes,
    recommendedRouteId,
    unlocks: validated.unlocks,
    wouldResolve: validated.wouldResolve,
  };

  const evidence: EvidenceItem = {
    id: evidenceId,
    statement:
      routes.length > 0
        ? `${routes.length} route(s) identified to close "${gap.targetLabel}"${recommendedRoute ? `; recommended: ${recommendedRoute.title} (${recommendedRoute.authority})` : ''}.`
        : `No viable route identified to close "${gap.targetLabel}" — treated as structurally blocked or out of the buyer's hands pre-purchase.`,
    sourceType: 'model_inference',
    sourceRef: gap.targetKey,
    sourceLabel: 'Proof-pathways agent',
    confidence: Math.max(0, Math.min(1, avgConfidence)),
    capturedAt: new Date().toISOString(),
  };

  return { pathway, evidence };
}

/* ------------------------------------------------------------------ */
/* Run bookkeeping helpers                                             */
/* ------------------------------------------------------------------ */

function makeStep(caseId: string, n: number, kind: AgentStep['kind'], label: string, detail?: string, toolName?: string): AgentStep {
  return { id: `step-${caseId}-proof_pathways-${n}`, at: new Date().toISOString(), kind, label, detail, toolName };
}

/* ------------------------------------------------------------------ */
/* Per-gap fan-out                                                     */
/* ------------------------------------------------------------------ */

/** One gap's worth of concurrency, capped like the rest of this codebase's fan-outs (see orchestrator.ts's own DOCUMENT_INTELLIGENCE_CONCURRENCY). */
const GAP_FANOUT_CONCURRENCY = 4;

/** A single gap needs far less output budget than the old one-call-for-everything request did. */
const GAP_MAX_TOKENS = 16000;

/**
 * Small, dependency-free concurrency helper — deliberately duplicated here
 * rather than imported from orchestrator.ts (out of scope for this file) or
 * factored into a new shared module (also out of scope). `fn` must never
 * throw: a rejection here would abort `Promise.all` and lose every other
 * in-flight gap's result, defeating the whole point of "one gap failing must
 * not lose the others".
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
  return results;
}

interface GapCallOutcome {
  validated?: ValidatedPathway;
  usage?: AgentUsage;
  error?: string;
  /** What this one call asked for and did not get. Unioned across the fan-out onto the run. */
  capabilityGaps?: CapabilityGap[];
}

/**
 * One model call for one gap. Never throws — every failure mode (network
 * error, safety refusal, missing tool call, schema mismatch) is caught and
 * turned into `{ error }` so the caller can fall back to
 * `buildPathwayFromValidated`'s existing "no route analysis was produced"
 * path for this gap alone, without disturbing any other gap's call.
 */
async function runGapPathway(provider: LlmProvider, model: string, systemText: string, caseData: PropertyCase, refData: ReferenceData, result: ScreenResult, gap: Gap, graph: TitleGraph | undefined): Promise<GapCallOutcome> {
  const { text: userText } = buildGapUserText(caseData, refData, result, gap, graph);
  try {
    const outcome = await provider.complete({
      agent: 'proof_pathways',
      caseId: caseData.id,
      model,
      maxTokens: GAP_MAX_TOKENS,
      effort: 'high',
      // Byte-identical across every gap's call — this is what lets the fan-out's
      // concurrent requests share one cached prompt prefix instead of each
      // paying full price for the grounding rules, role and corpus text. The
      // breakpoint is a request: a provider without prompt caching drops it
      // and records `prompt_caching_unavailable`, which costs money and
      // changes nothing about the answer.
      system: [{ text: systemText, cacheBreakpoint: true }],
      messages: [{ role: 'user', content: userText }],
      tools: [
        {
          kind: 'schema',
          name: TOOL_NAME,
          description: 'Emit the ranked, costed proof-sourcing pathway for the one gap given.',
          strict: true,
          parameters: PATHWAY_JSON_SCHEMA,
        },
      ],
      toolChoice: { type: 'tool', name: TOOL_NAME },
    });
    const capabilityGaps = outcome.capabilityGaps;

    if (outcome.stopReason === 'refusal') {
      return { error: 'The model declined to answer (safety refusal) for this gap.', usage: outcome.usage, capabilityGaps };
    }
    const toolUse = toolUseOf(outcome, TOOL_NAME);
    if (!toolUse) {
      return { error: 'The model did not return the expected tool call for this gap.', usage: outcome.usage, capabilityGaps };
    }
    const parsed = PathwaySchema.safeParse(toolUse.input);
    if (!parsed.success) {
      return { error: `Model output did not match the expected schema: ${parsed.error.message}`, usage: outcome.usage, capabilityGaps };
    }
    return { validated: parsed.data, usage: outcome.usage, capabilityGaps };
  } catch (e) {
    return { error: describeError(e) };
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function runProofPathways(input: {
  caseId: string;
  caseData: PropertyCase;
  refData: ReferenceData;
  now: string;
  onStep?: (step: AgentStep) => void;
}): Promise<{ run: AgentRun; pathways: DocumentPathway[]; evidence: EvidenceItem[] }> {
  const { caseId, caseData, refData, now, onStep } = input;
  const startedAt = new Date().toISOString();
  const steps: AgentStep[] = [];
  let stepCounter = 0;
  const emit = (kind: AgentStep['kind'], label: string, detail?: string, toolName?: string): void => {
    const step = makeStep(caseId, ++stepCounter, kind, label, detail, toolName);
    steps.push(step);
    onStep?.(step);
  };

  // Resolved once, at the top, so the model recorded on the run is the model
  // every gap call was built with and the model their usage was priced
  // against — and so every gap call in the fan-out goes to the same provider.
  const { route, provider, descriptor } = resolveRoute('proof_pathways');
  const tier = route.tier;
  const model = route.model;

  /** Unioned across the fan-out: one gap's call degrading is the run degrading. */
  let capabilityGaps: CapabilityGap[] = [];

  /** Which prompt versions this run used. Empty on the paths that fail before resolving one. */
  let promptUsages: PromptUsage[] = [];

  const fail = (error: string): { run: AgentRun; pathways: DocumentPathway[]; evidence: EvidenceItem[] } => {
    emit('error', 'Proof-pathways run failed', error);
    return {
      run: {
        id: `run-${caseId}-proof_pathways-${Date.parse(startedAt)}`,
        caseId,
        agent: 'proof_pathways',
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        model,
        tier,
        provider: route.provider,
        capabilityGaps,
        prompts: promptUsages,
        steps,
        error,
        producedEvidenceIds: [],
      },
      pathways: [],
      evidence: [],
    };
  };

  const result = caseData.result;
  if (!result) {
    emit('plan', 'No screen result on this case yet — nothing to find gaps in.');
    return {
      run: {
        id: `run-${caseId}-proof_pathways-${Date.parse(startedAt)}`,
        caseId,
        agent: 'proof_pathways',
        status: 'succeeded',
        startedAt,
        finishedAt: new Date().toISOString(),
        model,
        tier,
        provider: route.provider,
        capabilityGaps,
        prompts: promptUsages,
        steps,
        summary: 'No screen result is available for this case yet, so there is no gap list to build pathways for.',
        producedEvidenceIds: [],
      },
      pathways: [],
      evidence: [],
    };
  }

  emit('plan', 'Deriving the deterministic evidence-gap list from completeness and state-compliance.');
  const gaps = deriveGaps(result);

  if (gaps.length === 0) {
    emit('message', 'No open gaps — every required document is present and every state-compliance check resolved clear or attention.');
    return {
      run: {
        id: `run-${caseId}-proof_pathways-${Date.parse(startedAt)}`,
        caseId,
        agent: 'proof_pathways',
        status: 'succeeded',
        startedAt,
        finishedAt: new Date().toISOString(),
        model,
        tier,
        provider: route.provider,
        capabilityGaps,
        prompts: promptUsages,
        steps,
        summary: 'No evidence gaps found on this case — no proof pathways were needed.',
        producedEvidenceIds: [],
      },
      pathways: [],
      evidence: [],
    };
  }
  emit('message', `${gaps.length} gap(s) found.`, gaps.map(g => g.targetKey).join(', '));

  if (!descriptor.configured) {
    return fail(missingCredentialsDetail(route));
  }

  const statePack = refData.statePacks.find(
    p => p.country === caseData.identity.country && p.state.toLowerCase() === caseData.identity.state.toLowerCase(),
  );
  const karnatakaApplies = statePack?.id === 'karnataka';
  emit(
    'plan',
    karnatakaApplies ? 'Karnataka proof-route corpus applies to this case — grounding the model with it.' : 'No jurisdiction-specific proof-route corpus applies to this case.',
  );

  const systemPrompt = await buildSystemText(caseData, karnatakaApplies);
  const systemText = systemPrompt.text;
  promptUsages = systemPrompt.usages;

  emit('plan', `Fanning out ${gaps.length} gap(s) to ${model} (${tier} tier), one call per gap, concurrency ${GAP_FANOUT_CONCURRENCY}.`);

  const currency = caseData.identity.currency;
  const usageList: AgentUsage[] = [];
  let failedGaps = 0;

  // Built once and shared across the fan-out: it is the same graph for every
  // gap, and rebuilding it per call would repeat identical work N times for
  // no benefit.
  const graph = buildTitleGraph(caseData, now);

  const built = await mapWithConcurrency(gaps, GAP_FANOUT_CONCURRENCY, async (gap, i) => {
    const n = i + 1;
    const pathwayId = `pathway-${caseId}-${n}`;
    const evidenceId = `ev-pathway-${caseId}-${n}`;
    emit('tool_call', `Requesting route analysis for gap "${gap.targetKey}".`, undefined, TOOL_NAME);
    const outcome = await runGapPathway(provider, model, systemText, caseData, refData, result, gap, graph);
    if (outcome.usage) usageList.push(outcome.usage);
    if (outcome.capabilityGaps) capabilityGaps = mergeGaps(capabilityGaps, outcome.capabilityGaps);
    if (outcome.error) {
      failedGaps += 1;
      emit('error', `Route analysis failed for gap "${gap.targetKey}" — recorded as unresolved.`, outcome.error);
    } else {
      emit('tool_result', `Received route analysis for gap "${gap.targetKey}".`, undefined, TOOL_NAME);
    }
    return buildPathwayFromValidated(pathwayId, gap, outcome.validated, currency, evidenceId);
  });

  const pathways = built.map(b => b.pathway);
  const evidence = built.map(b => b.evidence);

  const blockedCount = pathways.filter(p => p.routes.length === 0 || p.routes.every(r => r.feasibility === 'blocked')).length;
  emit(
    'message',
    `Produced ${pathways.length} pathway(s) covering ${gaps.length} gap(s)${blockedCount > 0 ? `; ${blockedCount} have no working route and are marked accordingly` : ''}` +
      `${failedGaps > 0 ? `; ${failedGaps} gap call(s) failed and were recorded as unresolved rather than dropped` : ''}.`,
  );

  const usage = sumUsage(usageList);

  for (const gap of capabilityGaps) {
    emit('message', `Degraded on route ${route.provider}: ${gap}`, describeGap(gap));
  }

  return {
    run: {
      id: `run-${caseId}-proof_pathways-${Date.parse(startedAt)}`,
      caseId,
      agent: 'proof_pathways',
      status: 'succeeded',
      startedAt,
      finishedAt: new Date().toISOString(),
      model,
      tier,
      provider: route.provider,
      capabilityGaps,
      prompts: promptUsages,
      steps,
      summary:
        `Built ${pathways.length} proof pathway(s) for ${gaps.length} evidence gap(s) as of ${now}` +
        `${failedGaps > 0 ? ` (${failedGaps} could not be analysed and are marked unresolved)` : ''}` +
        `${capabilityGaps.length > 0 ? ` (route ${route.provider} degraded: ${capabilityGaps.join(', ')})` : ''}.`,
      usage,
      producedEvidenceIds: evidence.map(e => e.id),
    },
    pathways,
    evidence,
  };
}
