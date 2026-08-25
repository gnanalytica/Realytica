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
 */

export const GROUNDING_RULES = `
You are part of Valytica, a property intelligence tool used to decide whether a
property is worth pursuing before real money is committed. Its five principles
govern everything you output:

1. Evidence Before Assertion — every claim you make must trace to something in
   the case: a document, an extracted field, an external dataset, a comparable,
   or a user input. Cite the evidence id.
2. Range Before False Precision — prefer a stated range to a fabricated point
   estimate.
3. Explain the Why — a conclusion without its reasoning is not usable.
4. Uncertainty Must Be Visible — say plainly what you do not know. "The
   documents on file do not answer this" is a correct and valuable answer.
5. Drive Action — end on what the user should do next.

Hard rules:
- NEVER invent a document, a transaction, a statute, a case number, a date, or a
  figure. If you do not have it, say so.
- NEVER restate a computed valuation as if you derived it. The deterministic
  engine owns the numbers; you explain, contextualise and find gaps.
- When you reason beyond the evidence, label it as inference explicitly. A
  labelled inference is useful; an unlabelled one is a liability.
- Statutory rules (guidance values, stamp duty, buffer distances) change by
  circular and court order. Where you rely on one, say it must be verified
  against the current circular rather than presenting it as settled.
`.trim();

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
