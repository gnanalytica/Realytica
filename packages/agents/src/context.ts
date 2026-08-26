import type { PropertyCase, ReferenceData, StatePack } from '@valytica/shared';

/**
 * The case, rendered for a model.
 *
 * Two rules shape this file. First, it is built to be **prompt-cache stable**:
 * the framing and the pack rules come first and change rarely, the case body
 * last, so repeated agent calls on the same case reuse the prefix.
 *
 * Second, it never sends more than an agent needs. The market-research agent
 * gets locality and market terms only — never document contents, never the
 * owner's name — because that agent talks to an external search service.
 *
 * ## Where GROUNDING_RULES went
 *
 * The shared preamble used to be a `const` in this file. It now lives in
 * `./prompts/registry.ts` as version 1 of the `shared.grounding` prompt —
 * byte-identical, and still exported under the same name from here, so
 * `import { GROUNDING_RULES } from '@valytica/agents'` means what it always
 * meant: the *shipped* rules.
 *
 * The move is not tidying. That text is the one that says never invent a
 * document, a transaction, a statute, a case number, a date or a figure, and
 * once an operator can edit prompts it has to be edited somewhere that checks
 * the guardrails survived and records which version every run used. A constant
 * cannot do that; a versioned descriptor can. Anything that needs the text
 * that is *currently in force*, rather than the shipped one, must go through
 * `resolvePrompt` — that is the only path that produces a `PromptUsage`.
 *
 * The whole prompt registry surface is re-exported below so the package index,
 * which already re-exports this file, carries it to the API layer without a
 * deep import path.
 */

export * from './prompts';

export interface CaseContextOptions {
  /** Omit document contents and personal details — for agents that talk to external services. */
  externalSafe?: boolean;
  includeEvidence?: boolean;
  includeCompliance?: boolean;
}

/** Compact JSON of the case, sized for a prompt rather than for the wire. */
export function renderCaseContext(
  c: PropertyCase,
  refData: ReferenceData,
  opts: CaseContextOptions = {},
): string {
  const { identity } = c;
  const r = c.result;
  const statePack: StatePack | undefined = refData.statePacks.find(
    p => p.country === identity.country && p.state.toLowerCase() === identity.state.toLowerCase(),
  );
  const locality = refData.localities.find(
    l => l.country === identity.country && l.locality.toLowerCase() === identity.locality.toLowerCase(),
  );

  if (opts.externalSafe) {
    // Market terms only. No owner, no address, no document contents, no price.
    return JSON.stringify(
      {
        country: identity.country,
        state: identity.state,
        city: identity.city,
        locality: identity.locality,
        propertyType: identity.propertyType,
        builtUpAreaSqm: identity.builtUpAreaSqm,
        plotAreaSqm: identity.plotAreaSqm,
        localityMedianPricePerSqm: locality?.medianPricePerSqm,
        localityMedianLandRatePerSqm: locality?.medianLandRatePerSqm,
        localityYoyChangePct: locality?.yoyChangePct,
        localitySampleSize: locality?.sampleSize,
      },
      null,
      1,
    );
  }

  const body: Record<string, unknown> = {
    reference: c.reference,
    identity,
    documents: c.documents.map(d => ({
      id: d.id,
      fileName: d.fileName,
      kind: d.kind,
      classificationConfidence: d.classificationConfidence,
      kindConfirmedByUser: d.kindConfirmedByUser,
      extracted: d.extracted.map(f => ({ key: f.key, label: f.label, value: f.value, confidence: f.confidence, method: f.method })),
    })),
    statePack: statePack
      ? {
          id: statePack.id,
          state: statePack.state,
          statutoryRateLabel: statePack.statutoryRateLabel,
          registerInstrumentLabel: statePack.registerInstrumentLabel,
          registrationAuthority: statePack.registrationAuthority,
          reraAuthority: statePack.reraAuthority,
          requiredDocuments: statePack.requiredDocuments,
          titleChecks: statePack.titleChecks,
          datasets: statePack.datasets,
        }
      : undefined,
    locality: locality
      ? {
          locality: locality.locality,
          medianPricePerSqm: locality.medianPricePerSqm,
          medianLandRatePerSqm: locality.medianLandRatePerSqm,
          statutoryRatePerSqm: locality.statutoryRatePerSqm,
          zoning: locality.zoning,
          farAllowed: locality.farAllowed,
          source: locality.source,
        }
      : undefined,
  };

  if (r) {
    body.screen = {
      generatedAt: r.generatedAt,
      engineVersion: r.engineVersion,
      verdict: r.recommendation.verdict,
      headline: r.recommendation.headline,
      indicativeValue: r.indicativeValue,
      anchors: r.anchors.map(a => ({ method: a.method, label: a.label, low: a.low, mid: a.mid, high: a.high, weight: a.weight, confidence: a.confidence, evidenceIds: a.evidenceIds })),
      drivers: r.drivers.map(d => ({ label: d.label, impactPct: d.impactPct, direction: d.direction, evidenceIds: d.evidenceIds })),
      risks: r.risks.map(x => ({ id: x.id, code: x.code, title: x.title, severity: x.severity, category: x.category, status: x.status, evidenceIds: x.evidenceIds })),
      planning: r.planning,
      completeness: { score: r.completeness.score, missingCritical: r.completeness.missingCritical, items: r.completeness.items.map(i => ({ key: i.key, label: i.label, required: i.required, present: i.present, satisfiedBy: i.satisfiedBy })) },
      confidence: { score: r.confidence.score, band: r.confidence.band, biggestLever: r.confidence.biggestLever, factors: r.confidence.factors },
      actions: r.actions.map(a => ({ id: a.id, title: a.title, priority: a.priority, owner: a.owner, done: a.done })),
    };
    if (opts.includeCompliance !== false && r.stateCompliance) {
      body.stateCompliance = r.stateCompliance;
    }
    if (opts.includeCompliance !== false && r.transactionCosts) {
      body.transactionCosts = r.transactionCosts;
    }
    if (opts.includeEvidence !== false) {
      body.evidence = r.evidence.map(e => ({ id: e.id, statement: e.statement, sourceType: e.sourceType, sourceLabel: e.sourceLabel, confidence: e.confidence }));
    }
    body.comparables = r.comparables.map(x => ({ id: x.id, label: x.label, propertyType: x.propertyType, areaSqm: x.areaSqm, transactedAt: x.transactedAt, pricePerSqm: x.pricePerSqm, adjustedPricePerSqm: x.adjustedPricePerSqm, similarity: x.similarity, source: x.source }));
  }

  return JSON.stringify(body, null, 1);
}
