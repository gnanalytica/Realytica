/**
 * Critic agent — adversarial verification of what the other agents claimed.
 *
 * The proof-pathways agent is asked to be exhaustive about how to obtain a
 * missing khata or encumbrance certificate. A generative model asked for
 * exhaustiveness will reach past its grounding: an invented Sakala service
 * code, a fabricated fee band, or a plausible-but-wrong procedure reads
 * exactly like a real one. This file is the check for that failure mode, and
 * it is built around one rule above everything else:
 *
 *   The default posture is scepticism, not review. For every claim the only
 *   question is "does the grounding I was actually given contain this
 *   specific detail?" — not "does this sound like the kind of thing that
 *   authority would do?". Finding nothing wrong is a failure of the check,
 *   not a success: a critic that rubber-stamps everything as "supported"
 *   manufactures confidence nobody earned, which is worse than not running
 *   the check at all. See the `critic.system` prompt in
 *   `../prompts/registry.ts` for how this is put to the model.
 *
 * What gets checked, and how:
 * - Every `ProofRoute` on every `DocumentPathway` is checked against the same
 *   Karnataka proof-sourcing corpus the proof-pathways agent was grounded in
 *   (or, for a non-Karnataka case, checked against the fact that NO corpus is
 *   loaded at all — see `buildJurisdictionNotice`). This is fanned out one
 *   model call per pathway (concurrency-capped) rather than one giant call,
 *   so a long pathway list cannot cause the later items to be checked
 *   lazily, and one bad call cannot take the rest down with it.
 * - Every `ResearchFinding` is checked, batched into a single additional
 *   call, for whether its claim is actually the kind of thing its cited
 *   source could support — not merely on-topic.
 * - Every `AgentInsight`'s cited evidence ids are checked against the case's
 *   real evidence ledger. This needs no model call at all — it is a plain
 *   membership test — so it runs unconditionally, even when no Anthropic
 *   credentials are configured. A `DocumentPathway` with a genuinely empty
 *   `routes` array is treated the same way: an honestly-empty list is not a
 *   fabrication and costs nothing to record as such.
 *
 * Because part of this file's job needs no model and part of it does, a run
 * with no credentials configured is NOT simply empty the way the other
 * agents' runs are: `run.status` is `'failed'` (route/research verification,
 * the part this file exists for, genuinely could not run), but
 * `verification` still carries whatever the credential-free checks found.
 * The caller gets both the honest failure and whatever real signal exists —
 * "never mutate what you are checking; return findings and let the caller
 * decide" applies to a degraded run just as much as to a healthy one.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AgentInsight,
  AgentRun,
  AgentRunStatus,
  AgentStep,
  AgentUsage,
  CapabilityGap,
  CriticFinding,
  CriticVerdict,
  DocumentPathway,
  PromptUsage,
  ProofRoute,
  ResearchFinding,
  VerificationSummary,
} from '@valytica/shared';
import { describeError, sumUsage } from '../client';
import { PROMPT_KEYS, resolvePrompt } from '../prompts';
import { KARNATAKA_PROOF_ROUTES_VERIFY_BANNER, renderKarnatakaProofRoutesCorpus } from '../knowledge/karnataka-proof-routes';
import { describeGap } from '../routing';
import { mergeGaps, missingCredentialsDetail, resolveRoute, toolUseOf } from '../providers';
import type { LlmProvider } from '../providers';

export interface RunCriticParams {
  caseId: string;
  pathways: DocumentPathway[];
  insights: AgentInsight[];
  research: ResearchFinding[];
  /** Every evidence id currently known on the case — the ledger AgentInsight citations are checked against. */
  evidenceIds: string[];
  /** The case's resolved state-pack id, e.g. "karnataka". Absent or anything else means no jurisdiction corpus applies. */
  statePackId?: string;
  /** ISO timestamp used in the run summary — not wall-clock, so runs are reproducible. */
  now: string;
  onStep?: (step: AgentStep) => void;
}

export interface RunCriticResult {
  run: AgentRun;
  verification: VerificationSummary;
}

const ROUTE_TOOL_NAME = 'emit_route_verification';
const RESEARCH_TOOL_NAME = 'emit_research_verification';

/** One verification call per pathway (plus one for all research findings together), capped like the rest of the codebase's fan-outs. */
const VERIFICATION_CONCURRENCY = 4;

/* ------------------------------------------------------------------ */
/* Small, dependency-free concurrency helper — deliberately duplicated  */
/* here rather than imported from orchestrator.ts (out of scope for     */
/* this file) or factored into a new shared module (also out of scope). */
/* `fn` must never throw: a rejection here would abort Promise.all and   */
/* lose every other in-flight item's result, defeating the whole point   */
/* of "one worker failing must not lose the others".                     */
/* ------------------------------------------------------------------ */

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

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/* ------------------------------------------------------------------ */
/* Deterministic checks — no model call, always run                    */
/* ------------------------------------------------------------------ */

/** An insight's only checkable grounding is the evidence ids it cites — a plain membership test against the real ledger. */
function checkInsightCitations(insight: AgentInsight, validEvidenceIds: ReadonlySet<string>): CriticFinding {
  const cited = insight.evidenceIds;
  const valid = cited.filter(id => validEvidenceIds.has(id));
  const invalid = cited.filter(id => !validEvidenceIds.has(id));
  const unsupportedSpecifics = invalid.map(id => `cites evidence id "${id}", which does not exist in this case's evidence ledger`);

  let verdict: CriticVerdict;
  let reasoning: string;
  if (cited.length === 0) {
    if (insight.inferred) {
      verdict = 'supported';
      reasoning = 'Honestly labelled as inference and cites no evidence — there is nothing here to fabricate.';
    } else {
      verdict = 'unsupported';
      reasoning = 'Presented as evidence-backed ("inferred": false) but cites no evidence id at all.';
      unsupportedSpecifics.push('no evidenceIds cited despite not being labelled as inference');
    }
  } else if (invalid.length === 0) {
    verdict = 'supported';
    reasoning = `All ${valid.length} cited evidence id(s) exist in this case's evidence ledger.`;
  } else if (valid.length === 0) {
    verdict = 'unsupported';
    reasoning = `All ${invalid.length} cited evidence id(s) do not exist in this case's evidence ledger — a fabricated citation reads exactly like a real one.`;
  } else {
    verdict = 'partly_supported';
    reasoning = `${valid.length} of ${cited.length} cited evidence id(s) exist in this case's evidence ledger; ${invalid.length} do not.`;
  }

  return {
    id: `crit-${randomUUID()}`,
    targetId: insight.id,
    targetKind: 'insight',
    targetLabel: insight.title,
    verdict,
    claim: insight.body,
    reasoning,
    checkedAgainst: cited.length > 0 ? ["case's evidence ledger"] : [],
    unsupportedSpecifics,
    confidence: cited.length === 0 ? 1 : valid.length / cited.length,
  };
}

/** A pathway with zero routes made no claim to verify — record that plainly rather than skip the pathway silently. */
function checkEmptyPathway(pathway: DocumentPathway): CriticFinding {
  return {
    id: `crit-${randomUUID()}`,
    targetId: pathway.id,
    targetKind: 'pathway',
    targetLabel: pathway.targetLabel,
    verdict: 'supported',
    claim: `No route was proposed to close "${pathway.targetLabel}".`,
    reasoning: 'An honestly empty route list is not a claim that needs grounding — nothing was asserted.',
    checkedAgainst: [],
    unsupportedSpecifics: [],
    confidence: 1,
  };
}

function rollupVerdict(verdicts: CriticVerdict[]): CriticVerdict {
  if (verdicts.length === 0) return 'supported';
  if (verdicts.some(v => v === 'contradicted')) return 'contradicted';
  if (verdicts.some(v => v === 'unsupported')) return 'unsupported';
  if (verdicts.some(v => v === 'partly_supported')) return 'partly_supported';
  return 'supported';
}

function buildVerificationSummary(findings: CriticFinding[]): VerificationSummary {
  const checkedCount = findings.length;
  const supportedCount = findings.filter(f => f.verdict === 'supported').length;
  // Deliberately 0, not 100, when nothing was checked — an unearned "fully grounded"
  // reading is exactly the false confidence this file exists to avoid manufacturing.
  const groundingScore = checkedCount > 0 ? Math.round((supportedCount / checkedCount) * 100) : 0;
  const flaggedIds = findings.filter(f => f.verdict === 'unsupported' || f.verdict === 'contradicted').map(f => f.targetId);
  return { checkedCount, findings, flaggedIds, groundingScore };
}

/* ------------------------------------------------------------------ */
/* Model output contracts — zod validation + a hand-authored JSON       */
/* Schema mirroring it exactly, same approach as proof-pathways.ts.     */
/* ------------------------------------------------------------------ */

const CRITIC_VERDICTS: CriticVerdict[] = ['supported', 'partly_supported', 'unsupported', 'contradicted'];
const CriticVerdictSchema = z.enum(CRITIC_VERDICTS as [CriticVerdict, ...CriticVerdict[]]);

const VERDICT_FIELDS_JSON_SCHEMA = {
  verdict: { type: 'string', enum: CRITIC_VERDICTS, description: 'See the system prompt for exactly what each verdict means. Default to "unsupported" when in doubt — do not extend charity to a detail that only "sounds right".' },
  claim: { type: 'string', description: 'The specific claim you examined, quoted or closely paraphrased.' },
  reasoning: { type: 'string', description: 'Why you reached this verdict — name what you checked and what you did or did not find.' },
  checkedAgainst: { type: 'array', items: { type: 'string' }, description: 'What you actually checked this against: a corpus topic/route, or "no corpus available" when none exists for this jurisdiction.' },
  unsupportedSpecifics: {
    type: 'array',
    items: { type: 'string' },
    description: 'The exact invented or unverifiable detail(s) — a specific code, fee, portal name, or citation — a reader would otherwise act on without realising it was never grounded. Empty ONLY for a fully "supported" verdict.',
  },
  confidence: { type: 'number', description: '0..1 — your confidence in this verdict itself.' },
} as const;

const RouteVerdictSchema = z.object({
  routeId: z.string().min(1),
  verdict: CriticVerdictSchema,
  claim: z.string().min(1),
  reasoning: z.string().min(1),
  checkedAgainst: z.array(z.string()),
  unsupportedSpecifics: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
const RouteVerificationOutputSchema = z.object({ verdicts: z.array(RouteVerdictSchema) });
type ValidatedRouteVerdict = z.infer<typeof RouteVerdictSchema>;

const ROUTE_VERIFICATION_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    verdicts: {
      type: 'array',
      description: 'Exactly one verdict per route "id" given below — no more, no fewer, none skipped.',
      items: {
        type: 'object' as const,
        properties: { routeId: { type: 'string', description: 'Must exactly match one "id" from the routes given.' }, ...VERDICT_FIELDS_JSON_SCHEMA },
        required: ['routeId', 'verdict', 'claim', 'reasoning', 'checkedAgainst', 'unsupportedSpecifics', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
};

const ResearchVerdictSchema = z.object({
  findingId: z.string().min(1),
  verdict: CriticVerdictSchema,
  claim: z.string().min(1),
  reasoning: z.string().min(1),
  checkedAgainst: z.array(z.string()),
  unsupportedSpecifics: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
const ResearchVerificationOutputSchema = z.object({ verdicts: z.array(ResearchVerdictSchema) });
type ValidatedResearchVerdict = z.infer<typeof ResearchVerdictSchema>;

const RESEARCH_VERIFICATION_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    verdicts: {
      type: 'array',
      description: 'Exactly one verdict per "findingId" given below — no more, no fewer, none skipped.',
      items: {
        type: 'object' as const,
        properties: { findingId: { type: 'string', description: 'Must exactly match one "findingId" from the findings given.' }, ...VERDICT_FIELDS_JSON_SCHEMA },
        required: ['findingId', 'verdict', 'claim', 'reasoning', 'checkedAgainst', 'unsupportedSpecifics', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
};

/* ------------------------------------------------------------------ */
/* Prompt assembly                                                     */
/* ------------------------------------------------------------------ */

/**
 * The critic's role text lives in `../prompts/registry.ts` under the key
 * `critic.system`; version 1 is byte-identical to the `GROUNDING_RULES` plus
 * `CRITIC_ROLE` plus jurisdiction-notice string this file used to join inline,
 * with the shared preamble composed in through `{{grounding}}` as before.
 *
 * What is *not* in the registry, deliberately:
 *
 * - The jurisdiction notice below. It is a statement of fact about what
 *   grounding this particular case has — "the Karnataka corpus is the only
 *   thing you may check against" versus "you have no corpus at all, so treat
 *   every specific as unsupported" — derived from the case's state pack.
 *   Making it editable would let somebody tell the critic it has grounding it
 *   does not have, which turns the one check that catches invented
 *   authorities into a rubber stamp. It is passed in as
 *   `{{jurisdictionNotice}}` instead.
 * - The Karnataka corpus itself, appended after the prompt. It is reference
 *   data with its own file and its own verification banner, not prose.
 */
function buildJurisdictionNotice(karnatakaApplies: boolean): string {
  if (karnatakaApplies) {
    return (
      'This case is in Karnataka. When checking proof routes below, the Karnataka/Bengaluru proof-sourcing corpus that ' +
      'follows is the ONLY grounding you have — an authority, portal, form/service code, fee band or timeline is ' +
      '"supported" only if this corpus actually states it (a route that is honestly just "ask the seller directly", with ' +
      'no authority or fee to check, needs no corpus entry to be supported). ' +
      KARNATAKA_PROOF_ROUTES_VERIFY_BANNER
    );
  }
  return (
    'No jurisdiction-specific proof-sourcing corpus is loaded for this case. You have NO grounding to check any named ' +
    'authority, portal, form/service code, fee or timeline against for a proof route — treat every such specific as ' +
    '"unsupported" unless it is trivially generic (e.g. "ask the seller"), and say plainly in your reasoning that no ' +
    'corpus exists for this jurisdiction to confirm it against.'
  );
}

/**
 * The full system text for a verification call, and what it was built from.
 *
 * Resolved once per run and shared across the whole verification fan-out —
 * byte-identical for every concurrent call, which is what lets them share one
 * cached prompt prefix instead of each paying full price for the grounding
 * rules, role and corpus.
 */
async function buildSystemText(karnatakaApplies: boolean): Promise<{ text: string; usages: PromptUsage[] }> {
  const prompt = await resolvePrompt(PROMPT_KEYS.criticSystem, {
    jurisdictionNotice: buildJurisdictionNotice(karnatakaApplies),
  });
  const parts = [prompt.content];
  if (karnatakaApplies) parts.push(renderKarnatakaProofRoutesCorpus());
  return { text: parts.join('\n\n'), usages: prompt.usages };
}

function buildPathwayUserText(pathway: DocumentPathway): string {
  return [
    `GAP: "${pathway.targetLabel}" — ${pathway.whyItMatters}`,
    '',
    'ROUTES TO VERIFY — produce exactly one verdict per "id" below:',
    JSON.stringify(
      pathway.routes.map(r => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        authority: r.authority,
        portalOrAddress: r.portalOrAddress ?? null,
        formOrReference: r.formOrReference ?? null,
        steps: r.steps,
        prerequisites: r.prerequisites,
        typicalCost: r.typicalCost ?? null,
        typicalDurationDays: r.typicalDurationDays ?? null,
        feasibility: r.feasibility,
        risks: r.risks,
      })),
      null,
      1,
    ),
  ].join('\n');
}

function buildResearchUserText(findings: ResearchFinding[]): string {
  return [
    'RESEARCH FINDINGS TO VERIFY — produce exactly one verdict per "findingId" below.',
    'For each, judge whether the stated sourceUrl/sourceTitle plausibly and SPECIFICALLY supports the exact claim made — ' +
      'not merely whether it is on-topic. Weigh "corroboration" honestly: a claim marked "uncorroborated" with no sourceUrl ' +
      'at all should not be waved through as "supported" just because the claim itself sounds reasonable.',
    JSON.stringify(
      findings.map(f => ({
        findingId: f.id,
        claim: f.claim,
        sourceUrl: f.sourceUrl ?? null,
        sourceTitle: f.sourceTitle ?? null,
        relevance: f.relevance,
        confidence: f.confidence,
        corroboration: f.corroboration,
        contradictsEngine: f.contradictsEngine,
      })),
      null,
      1,
    ),
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Per-item model calls — each fully self-contained, never throws past  */
/* its caller: the fan-out worker below is the one place that catches.  */
/* ------------------------------------------------------------------ */

function toRouteFinding(pathway: DocumentPathway, route: ProofRoute, v: ValidatedRouteVerdict): CriticFinding {
  return {
    id: `crit-${randomUUID()}`,
    targetId: route.id,
    targetKind: 'proof_route',
    targetLabel: `${route.title} (${pathway.targetLabel})`,
    verdict: v.verdict,
    claim: v.claim,
    reasoning: v.reasoning,
    checkedAgainst: v.checkedAgainst,
    unsupportedSpecifics: v.unsupportedSpecifics,
    confidence: clamp01(v.confidence),
  };
}

function missingRouteFinding(pathway: DocumentPathway, route: ProofRoute): CriticFinding {
  return {
    id: `crit-${randomUUID()}`,
    targetId: route.id,
    targetKind: 'proof_route',
    targetLabel: `${route.title} (${pathway.targetLabel})`,
    verdict: 'unsupported',
    claim: `${route.title} — ${route.authority}`,
    reasoning: 'The verification pass did not return a verdict for this route; treated as unverified rather than silently passed.',
    checkedAgainst: [],
    unsupportedSpecifics: ['no verdict returned by the verification pass'],
    confidence: 0,
  };
}

/** One model call verifying every route on one pathway, plus a deterministic pathway-level rollup. Throws on any failure — the caller decides what that means. */
async function verifyPathwayRoutes(
  provider: LlmProvider,
  model: string,
  systemText: string,
  pathway: DocumentPathway,
): Promise<{ findings: CriticFinding[]; usage: AgentUsage; capabilityGaps: CapabilityGap[] }> {
  const result = await provider.complete({
    agent: 'critic',
    model,
    maxTokens: 8000,
    effort: 'high',
    system: [{ text: systemText, cacheBreakpoint: true }],
    messages: [{ role: 'user', content: buildPathwayUserText(pathway) }],
    tools: [
      {
        kind: 'schema',
        name: ROUTE_TOOL_NAME,
        description: 'Emit one adversarial verdict per proof route given, checked against the grounding in the system prompt.',
        strict: true,
        parameters: ROUTE_VERIFICATION_JSON_SCHEMA,
      },
    ],
    toolChoice: { type: 'tool', name: ROUTE_TOOL_NAME },
  });

  if (result.stopReason === 'refusal') {
    throw new Error('The model declined to verify this pathway (safety refusal).');
  }
  const toolUse = toolUseOf(result, ROUTE_TOOL_NAME);
  if (!toolUse) {
    throw new Error('The model did not return the expected verification tool call.');
  }
  const parsed = RouteVerificationOutputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`Verification output did not match the expected schema: ${parsed.error.message}`);
  }

  const byVerdict = new Map(parsed.data.verdicts.map(v => [v.routeId, v]));
  const routeFindings = pathway.routes.map(route => {
    const v = byVerdict.get(route.id);
    return v ? toRouteFinding(pathway, route, v) : missingRouteFinding(pathway, route);
  });

  const pathwayFinding: CriticFinding = {
    id: `crit-${randomUUID()}`,
    targetId: pathway.id,
    targetKind: 'pathway',
    targetLabel: pathway.targetLabel,
    verdict: rollupVerdict(routeFindings.map(f => f.verdict)),
    claim: `${pathway.routes.length} route(s) proposed to close "${pathway.targetLabel}".`,
    reasoning: `${routeFindings.filter(f => f.verdict === 'supported').length} of ${routeFindings.length} route(s) verified fully supported by the grounding available.`,
    checkedAgainst: [],
    unsupportedSpecifics: routeFindings.flatMap(f => f.unsupportedSpecifics),
    confidence: routeFindings.length > 0 ? routeFindings.reduce((s, f) => s + f.confidence, 0) / routeFindings.length : 0,
  };

  return { findings: [...routeFindings, pathwayFinding], usage: result.usage, capabilityGaps: result.capabilityGaps };
}

/** One model call verifying every research finding together. Throws on any failure — the caller decides what that means. */
async function verifyResearchFindings(
  provider: LlmProvider,
  model: string,
  systemText: string,
  findings: ResearchFinding[],
): Promise<{ findings: CriticFinding[]; usage: AgentUsage; capabilityGaps: CapabilityGap[] }> {
  const result = await provider.complete({
    agent: 'critic',
    model,
    maxTokens: 8000,
    effort: 'high',
    system: [{ text: systemText, cacheBreakpoint: true }],
    messages: [{ role: 'user', content: buildResearchUserText(findings) }],
    tools: [
      {
        kind: 'schema',
        name: RESEARCH_TOOL_NAME,
        description: 'Emit one adversarial verdict per research finding given, judging whether its cited source actually supports its claim.',
        strict: true,
        parameters: RESEARCH_VERIFICATION_JSON_SCHEMA,
      },
    ],
    toolChoice: { type: 'tool', name: RESEARCH_TOOL_NAME },
  });

  if (result.stopReason === 'refusal') {
    throw new Error('The model declined to verify these research findings (safety refusal).');
  }
  const toolUse = toolUseOf(result, RESEARCH_TOOL_NAME);
  if (!toolUse) {
    throw new Error('The model did not return the expected verification tool call.');
  }
  const parsed = ResearchVerificationOutputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`Verification output did not match the expected schema: ${parsed.error.message}`);
  }

  const byVerdict = new Map<string, ValidatedResearchVerdict>(parsed.data.verdicts.map(v => [v.findingId, v]));
  const out = findings.map(f => {
    const v = byVerdict.get(f.id);
    if (v) {
      return {
        id: `crit-${randomUUID()}`,
        targetId: f.id,
        targetKind: 'research_finding' as const,
        targetLabel: f.claim.slice(0, 120),
        verdict: v.verdict,
        claim: v.claim,
        reasoning: v.reasoning,
        checkedAgainst: v.checkedAgainst,
        unsupportedSpecifics: v.unsupportedSpecifics,
        confidence: clamp01(v.confidence),
      };
    }
    return {
      id: `crit-${randomUUID()}`,
      targetId: f.id,
      targetKind: 'research_finding' as const,
      targetLabel: f.claim.slice(0, 120),
      verdict: 'unsupported' as const,
      claim: f.claim,
      reasoning: 'The verification pass did not return a verdict for this finding; treated as unverified rather than silently passed.',
      checkedAgainst: [],
      unsupportedSpecifics: ['no verdict returned by the verification pass'],
      confidence: 0,
    };
  });

  return { findings: out, usage: result.usage, capabilityGaps: result.capabilityGaps };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function runCritic(input: RunCriticParams): Promise<RunCriticResult> {
  const { caseId, pathways, insights, research, evidenceIds, statePackId, now, onStep } = input;
  const runId = `run-${caseId}-critic-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const steps: AgentStep[] = [];

  const emit = (step: Omit<AgentStep, 'id' | 'at'>): void => {
    const full: AgentStep = { id: randomUUID(), at: new Date().toISOString(), ...step };
    steps.push(full);
    onStep?.(full);
  };

  // Resolved once, at the top, so the model recorded on the run is the model
  // every verification call was built with and the model their usage was
  // priced against.
  const { route, provider, descriptor } = resolveRoute('critic');
  const tier = route.tier;
  const model = route.model;

  /** Unioned across the verification fan-out. */
  let capabilityGaps: CapabilityGap[] = [];

  /**
   * Which prompt versions this run used. Empty on the paths that return before
   * a model call — including the deterministic-checks-only path, which
   * genuinely uses no prompt.
   */
  let promptUsages: PromptUsage[] = [];

  const finish = (
    status: AgentRunStatus,
    opts: { summary?: string; error?: string; usage?: AgentUsage; verification: VerificationSummary },
  ): RunCriticResult => ({
    run: {
      id: runId,
      caseId,
      agent: 'critic',
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      model,
      tier,
      provider: route.provider,
      capabilityGaps,
      prompts: promptUsages,
      steps,
      summary: opts.summary,
      error: opts.error,
      usage: opts.usage,
      producedEvidenceIds: [],
    },
    verification: opts.verification,
  });

  const totalRoutes = pathways.reduce((n, p) => n + p.routes.length, 0);
  emit({
    kind: 'plan',
    label: `Verifying ${pathways.length} pathway(s) (${totalRoutes} route(s)), ${insights.length} insight(s), ${research.length} research finding(s) as of ${now}.`,
  });

  if (totalRoutes === 0 && pathways.length === 0 && insights.length === 0 && research.length === 0) {
    emit({ kind: 'message', label: 'Nothing to verify — no pathways, insights or research findings were supplied.' });
    return finish('succeeded', { summary: 'Nothing to verify on this run.', verification: buildVerificationSummary([]) });
  }

  // --- Deterministic checks: no model call, always run ----------------
  const validEvidenceIdSet = new Set(evidenceIds);
  const deterministicFindings: CriticFinding[] = [
    ...insights.map(i => checkInsightCitations(i, validEvidenceIdSet)),
    ...pathways.filter(p => p.routes.length === 0).map(p => checkEmptyPathway(p)),
  ];
  if (deterministicFindings.length > 0) {
    emit({ kind: 'message', label: `${deterministicFindings.length} claim(s) checked without a model call (evidence-citation and empty-route checks).` });
  }

  if (!descriptor.configured) {
    const reason = missingCredentialsDetail(route, 'proof-route and research-finding verification could not run.');
    emit({ kind: 'error', label: 'Model-based verification unavailable', detail: reason });
    return finish('failed', {
      error: reason,
      summary: `${deterministicFindings.length} evidence-citation/empty-route check(s) completed; route and research verification were skipped (no credentials).`,
      verification: buildVerificationSummary(deterministicFindings),
    });
  }

  const karnatakaApplies = statePackId === 'karnataka';
  emit({
    kind: 'plan',
    label: karnatakaApplies ? 'Karnataka proof-route corpus is the grounding for route checks on this case.' : 'No jurisdiction-specific proof-route corpus applies to this case.',
  });
  const systemPrompt = await buildSystemText(karnatakaApplies);
  const systemText = systemPrompt.text;
  promptUsages = systemPrompt.usages;

  type WorkItem = { kind: 'pathway'; pathway: DocumentPathway } | { kind: 'research'; findings: ResearchFinding[] };
  const workItems: WorkItem[] = pathways.filter(p => p.routes.length > 0).map(p => ({ kind: 'pathway', pathway: p }));
  if (research.length > 0) workItems.push({ kind: 'research', findings: research });

  const modelFindings: CriticFinding[] = [];
  const usageList: AgentUsage[] = [];
  let failedItems = 0;

  if (workItems.length > 0) {
    emit({ kind: 'plan', label: `Fanning out ${workItems.length} verification call(s), concurrency ${VERIFICATION_CONCURRENCY}.` });
    const outcomes = await mapWithConcurrency(workItems, VERIFICATION_CONCURRENCY, async item => {
      const label = item.kind === 'pathway' ? `pathway "${item.pathway.targetLabel}"` : `${item.findings.length} research finding(s)`;
      emit({ kind: 'tool_call', label: `Verifying ${label}.`, toolName: item.kind === 'pathway' ? ROUTE_TOOL_NAME : RESEARCH_TOOL_NAME });
      try {
        const result =
          item.kind === 'pathway' ? await verifyPathwayRoutes(provider, model, systemText, item.pathway) : await verifyResearchFindings(provider, model, systemText, item.findings);
        emit({ kind: 'tool_result', label: `Verified ${label} — ${result.findings.length} finding(s).` });
        return { findings: result.findings, usage: result.usage as AgentUsage | undefined, gaps: result.capabilityGaps, failed: false };
      } catch (e) {
        const reason = describeError(e);
        emit({ kind: 'error', label: `Verification failed for ${label}`, detail: reason });
        return { findings: [] as CriticFinding[], usage: undefined as AgentUsage | undefined, gaps: [] as CapabilityGap[], failed: true };
      }
    });
    for (const o of outcomes) {
      modelFindings.push(...o.findings);
      if (o.usage) usageList.push(o.usage);
      capabilityGaps = mergeGaps(capabilityGaps, o.gaps);
      if (o.failed) failedItems += 1;
    }
    for (const gap of capabilityGaps) {
      emit({ kind: 'message', label: `Degraded on route ${route.provider}: ${gap}`, detail: describeGap(gap) });
    }
  }

  const allFindings = [...deterministicFindings, ...modelFindings];
  const verification = buildVerificationSummary(allFindings);
  const usage = sumUsage(usageList);

  const allWorkFailed = workItems.length > 0 && failedItems === workItems.length;
  const status: AgentRunStatus = allWorkFailed && modelFindings.length === 0 ? 'failed' : 'succeeded';
  const error = allWorkFailed && modelFindings.length === 0 ? 'All verification calls failed — see the step log for details.' : undefined;

  const summary =
    `Checked ${verification.checkedCount} claim(s) as of ${now} — ${verification.flaggedIds.length} flagged as unsupported or contradicted ` +
    `(grounding score ${verification.groundingScore}).` +
    (failedItems > 0 ? ` ${failedItems} of ${workItems.length} verification call(s) could not be completed and were skipped.` : '') +
    (capabilityGaps.length > 0 ? ` Route ${route.provider} degraded: ${capabilityGaps.join(', ')}.` : '');
  emit({ kind: 'message', label: summary });

  return finish(status, { summary, error, usage, verification });
}
