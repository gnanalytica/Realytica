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
 */

import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  AgentRun,
  AgentStep,
  ComplianceVerdict,
  CurrencyCode,
  DocumentKind,
  DocumentPathway,
  EvidenceItem,
  ProofRoute,
  ProofRouteKind,
  PropertyCase,
  ReferenceData,
  ScreenResult,
} from '@valytica/shared';
import { AGENT_MODEL, BASE_REQUEST, describeError, estimateUsage, getClient } from '../client';
import { GROUNDING_RULES, renderCaseContext } from '../context';
import { KARNATAKA_PROOF_ROUTES_VERIFY_BANNER, renderKarnatakaProofRoutesCorpus } from '../knowledge/karnataka-proof-routes';

const TOOL_NAME = 'emit_document_pathways';

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

const OutputSchema = z.object({
  pathways: z.array(PathwaySchema),
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
    targetKey: { type: 'string', description: 'Must exactly match one targetKey from the gaps list you were given — no more, no fewer pathways than gaps given.' },
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

const OUTPUT_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    pathways: { type: 'array', items: PATHWAY_JSON_SCHEMA },
  },
  required: ['pathways'],
  additionalProperties: false,
};

/* ------------------------------------------------------------------ */
/* Prompt assembly                                                     */
/* ------------------------------------------------------------------ */

const PROOF_PATHWAYS_ROLE = `
You are the proof-pathways agent inside Valytica. You are handed a fixed list
of evidence gaps that a deterministic engine has already identified on this
case — required documents that are missing, and state-pack compliance checks
that came back "unknown" or "blocker". You do not decide what is missing;
that list is given to you and is final. Your job is to work out, for EACH
gap given to you, every realistic way to close it.

For each gap, produce one pathway with every viable route you can respons­ibly
name, ranked best-first:
- Be concrete: a named authority, a named portal or office, ordered steps a
  buyer could actually follow, prerequisites, an indicative cost range and an
  indicative duration range — never a vague "contact the relevant authority".
- Every cost and duration MUST be a range and MUST be described as
  indicative, needing verification on the portal or with the office before
  being relied on. Do not state a fee or timeline as settled fact.
- Cover the different kinds of route where they genuinely exist for that
  gap: an online portal, an in-person office visit, what a licensed
  intermediary (documentation agent, advocate, liaison, surveyor) can do on
  the buyer's behalf, what only the seller/developer/promoter can produce,
  and — for a genuinely lost original — how to reconstruct from secondary
  evidence (certified copies, an indemnity bond, a newspaper notice).
- Be honest about routes that do not actually work. Some gaps have no good
  route: a B-khata property cannot simply be converted to A-khata on
  demand; DC conversion can only be applied for by the landowner, not a
  prospective buyer; an occupancy certificate that was never applied for
  cannot be obtained by a unit buyer; a genuinely unapproved/revenue layout
  usually cannot be retroactively approved by filing a form. Where this is
  so, set that route's feasibility to "blocked", explain why in its risks,
  and make sure the pathway as a whole still gives the buyer the REAL
  options: regularisation where one genuinely exists (name it, and hedge
  that its current availability must be checked), a price/financing
  adjustment that prices in the defect, or walking away. Never invent a
  cheerful procedure for something that structurally cannot be done by a
  buyer pre-purchase.
- Not every gap is a document you can walk into an office and obtain — some
  (e.g. a rajakaluve/lake buffer proximity finding, a PTCL granted-land
  restriction) are facts about the land itself. For those, the "route" is
  about getting authoritative confirmation or measurement (a licensed
  surveyor's certificate against the BBMP/BDA drain map, a certified search
  of grant records) and about the real remedies if the fact turns out
  unfavourable — not a document-issuing office that will clear the finding
  on request.
- wouldResolve must name the SPECIFIC screen output that would change once
  this pathway is completed: a named compliance-check key, a named risk id
  or title, or a named confidence-factor key, all drawn from what you were
  given in this prompt. Do not write generic statements like "improves the
  screen".
- Produce exactly one pathway per gap given to you, with targetKey matching
  exactly — no more, no fewer, no gap skipped.
`.trim();

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

function buildSystemText(caseData: PropertyCase, karnatakaApplies: boolean): string {
  const parts = [GROUNDING_RULES, PROOF_PATHWAYS_ROLE, buildJurisdictionNotice(caseData, karnatakaApplies)];
  if (karnatakaApplies) {
    parts.push(renderKarnatakaProofRoutesCorpus());
  }
  return parts.join('\n\n');
}

function buildUserText(caseData: PropertyCase, refData: ReferenceData, result: ScreenResult, gaps: Gap[]): string {
  const confidenceFactors = result.confidence.factors.map(f => ({ key: f.key, label: f.label }));
  const openRisks = result.risks
    .filter(r => r.status === 'open')
    .map(r => ({ id: r.id, title: r.title, severity: r.severity, category: r.category }));

  return [
    'CASE CONTEXT (JSON) — for jurisdiction, property-type and khata/conversion facts:',
    renderCaseContext(caseData, refData, { includeEvidence: false, includeCompliance: true }),
    '',
    'CONFIDENCE FACTORS — cite by "key" in wouldResolve where a pathway would move one of these:',
    JSON.stringify(confidenceFactors, null, 1),
    '',
    'OPEN RISKS — cite by "id" or "title" in wouldResolve/unlocks where a pathway would address one of these:',
    JSON.stringify(openRisks, null, 1),
    '',
    'GAPS TO ADDRESS — produce exactly one pathway per gap below, matching targetKey exactly:',
    JSON.stringify(gaps, null, 1),
  ].join('\n');
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
        model: AGENT_MODEL,
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
        model: AGENT_MODEL,
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
        model: AGENT_MODEL,
        steps,
        summary: 'No evidence gaps found on this case — no proof pathways were needed.',
        producedEvidenceIds: [],
      },
      pathways: [],
      evidence: [],
    };
  }
  emit('message', `${gaps.length} gap(s) found.`, gaps.map(g => g.targetKey).join(', '));

  const client = getClient();
  if (!client) {
    return fail('Anthropic credentials are not configured for this deployment (no ANTHROPIC_API_KEY, auth token, or `ant auth login` profile was found).');
  }

  const statePack = refData.statePacks.find(
    p => p.country === caseData.identity.country && p.state.toLowerCase() === caseData.identity.state.toLowerCase(),
  );
  const karnatakaApplies = statePack?.id === 'karnataka';
  emit(
    'plan',
    karnatakaApplies ? 'Karnataka proof-route corpus applies to this case — grounding the model with it.' : 'No jurisdiction-specific proof-route corpus applies to this case.',
  );

  const systemText = buildSystemText(caseData, karnatakaApplies);
  const userText = buildUserText(caseData, refData, result, gaps);

  emit('tool_call', `Requesting route analysis for ${gaps.length} gap(s) from ${AGENT_MODEL}.`, undefined, TOOL_NAME);

  let finalMessage: Anthropic.Beta.Messages.BetaMessage;
  try {
    // The params object is cast once, at this call site, because BASE_REQUEST's
    // `thinking: {type:'adaptive'}` and `fallbacks` are current API but postdate
    // this SDK build's bundled .d.ts. Everything else stays type-checked. See
    // the note in client.ts.
    const streamParams = {
      ...BASE_REQUEST,
      max_tokens: 64000,
      output_config: { effort: 'high' },
      system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userText }],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Emit the ranked, costed proof-sourcing pathway for every gap given, one pathway per gap.',
          strict: true,
          input_schema: OUTPUT_JSON_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    };
    const stream = client.beta.messages.stream(
      streamParams as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
    );
    finalMessage = await stream.finalMessage();
  } catch (e) {
    return fail(describeError(e));
  }

  emit('tool_result', `Received response (stop_reason: ${finalMessage.stop_reason ?? 'unknown'}).`, undefined, TOOL_NAME);

  if (finalMessage.stop_reason === 'refusal') {
    return fail('The model declined to answer (safety refusal) and no fallback produced a usable response.');
  }

  const toolUse = finalMessage.content.find(
    (block): block is Anthropic.Beta.Messages.BetaToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!toolUse) {
    return fail('The model did not return the expected tool call.');
  }

  const parsed = OutputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return fail(`Model output did not match the expected schema: ${parsed.error.message}`);
  }

  const byTargetKey = new Map<string, ValidatedPathway>();
  for (const p of parsed.data.pathways) {
    if (!byTargetKey.has(p.targetKey)) {
      byTargetKey.set(p.targetKey, p);
    }
  }

  const extraKeys = [...byTargetKey.keys()].filter(k => !gaps.some(g => g.targetKey === k));
  if (extraKeys.length > 0) {
    emit('message', `Ignored ${extraKeys.length} pathway(s) for keys that were not in the gap list.`, extraKeys.join(', '));
  }

  const currency = caseData.identity.currency;
  const pathways: DocumentPathway[] = [];
  const evidence: EvidenceItem[] = [];

  gaps.forEach((gap, i) => {
    const n = i + 1;
    const pathwayId = `pathway-${caseId}-${n}`;
    const evidenceId = `ev-pathway-${caseId}-${n}`;
    const validated = byTargetKey.get(gap.targetKey);
    if (!validated) {
      emit('message', `No route analysis returned for gap "${gap.targetKey}" — recorded as unresolved.`);
    }
    const built = buildPathwayFromValidated(pathwayId, gap, validated, currency, evidenceId);
    pathways.push(built.pathway);
    evidence.push(built.evidence);
  });

  const blockedCount = pathways.filter(p => p.routes.length === 0 || p.routes.every(r => r.feasibility === 'blocked')).length;
  emit(
    'message',
    `Produced ${pathways.length} pathway(s) covering ${gaps.length} gap(s)${blockedCount > 0 ? `; ${blockedCount} have no working route and are marked accordingly` : ''}.`,
  );

  const usage = estimateUsage(finalMessage.usage);

  return {
    run: {
      id: `run-${caseId}-proof_pathways-${Date.parse(startedAt)}`,
      caseId,
      agent: 'proof_pathways',
      status: 'succeeded',
      startedAt,
      finishedAt: new Date().toISOString(),
      model: AGENT_MODEL,
      steps,
      summary: `Built ${pathways.length} proof pathway(s) for ${gaps.length} evidence gap(s) as of ${now}.`,
      usage,
      producedEvidenceIds: evidence.map(e => e.id),
    },
    pathways,
    evidence,
  };
}
