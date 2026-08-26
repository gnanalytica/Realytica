import type {
  CaseDocument,
  EvidenceItem,
  PropertyCase,
  ReferenceData,
  StatePack,
  TitleGraph,
} from '@realytica/shared';

/**
 * A case, cut into addressable pieces.
 *
 * Retrieval needs something smaller than "the case" to select over. This file
 * produces that: one `Segment` per coherent unit, each with a token estimate,
 * the graph nodes it concerns, and the terms it would match on.
 *
 * The cut points are not arbitrary. Measured against the six seeded cases, the
 * whole-case context is ~10,000 tokens and three sections account for 63% of
 * it — `evidence` (24%), `statePack` (24%) and `stateCompliance` (15%), with
 * documents a mere 7%. That measurement is what this design is built on, and
 * it contradicts the obvious assumption that documents dominate.
 *
 * The consequence is the `cacheStable` flag below. `statePack` is large, but it
 * is byte-identical for every case in the same state, and `renderCaseContext`
 * deliberately places it early so repeated agent calls reuse the prompt-cache
 * prefix. A cached read bills at roughly a tenth of the input rate, so slicing
 * that section to save tokens would trade a 90% discount for a partial saving
 * and very likely cost more than it saves. Retrieval therefore leaves the
 * cache-stable prefix whole and applies its budget to the variable tail —
 * evidence, documents, comparables and compliance detail — which is also the
 * part that actually grows with the size of a case.
 */

/** How a segment earns its place in the prompt. */
export type SegmentClass =
  /** Identical across calls and placed first, so the prompt cache covers it. Never trimmed. */
  | 'cache_stable'
  /** Small and needed by every agent regardless of focus. Never trimmed. */
  | 'essential'
  /** Selected against the focus, and dropped when the budget runs out. */
  | 'variable';

export interface Segment {
  key: string;
  label: string;
  segmentClass: SegmentClass;
  /** Rendered payload. Assembled into the final prompt in selection order. */
  value: unknown;
  approxTokens: number;
  /** Title-graph node ids this segment concerns, where the graph resolves them. */
  nodeIds: string[];
  /** Lowercased terms this segment matches on when there is no graph. */
  terms: string[];
  /** Source document id, for evidence and document segments. */
  documentId?: string;
}

/**
 * Token estimate.
 *
 * Four characters per token is the usual English approximation and is close
 * enough for a budget that exists to prevent a context blow-up, not to be
 * exact. It is deliberately not a real tokeniser: pulling one in would add a
 * dependency and a model-version coupling to a number that only has to be
 * roughly right. Callers are told the figure is approximate — the field is
 * named `approxTokens` — so nothing downstream treats it as authoritative.
 *
 * The `null, 1` argument is load-bearing, not cosmetic. The renderer emits
 * pretty-printed JSON, and on a structure this nested the indentation and
 * newlines are roughly a third of the bytes. Estimating against compact JSON
 * measured a budget of 4,000 tokens rendering as 5,383 — a 35% undercount,
 * which is not a budget. The estimate has to serialise the way the renderer
 * serialises.
 */
export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 1);
  return Math.ceil(text.length / 4);
}

function normaliseTerm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Terms a piece of text should match on, deduped and lowercased. */
export function termsOf(...parts: (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    const n = normaliseTerm(p);
    if (n) out.add(n);
    for (const word of n.split(' ')) {
      if (word.length > 3) out.add(word);
    }
  }
  return [...out];
}

/**
 * Graph nodes an evidence item or document is behind.
 *
 * The graph records, per node, which sources asserted it (`assertedBy`), so
 * this is the reverse lookup: given a source, which nodes does it speak to.
 * Built once per retrieval rather than per segment, because a case with 40
 * documents and a few hundred assertions makes the naive nested scan the
 * slowest thing in the pipeline.
 */
export function buildSourceNodeIndex(graph: TitleGraph | undefined): Map<string, string[]> {
  const index = new Map<string, string[]>();
  if (!graph) return index;
  const add = (sourceRef: string, nodeId: string): void => {
    const existing = index.get(sourceRef);
    if (existing) {
      if (!existing.includes(nodeId)) existing.push(nodeId);
    } else {
      index.set(sourceRef, [nodeId]);
    }
  };
  for (const node of graph.nodes) {
    for (const assertion of node.assertedBy) add(assertion.sourceRef, node.id);
  }
  for (const edge of graph.edges) {
    for (const assertion of edge.assertedBy) {
      add(assertion.sourceRef, edge.fromNodeId);
      add(assertion.sourceRef, edge.toNodeId);
    }
  }
  return index;
}

function documentSegment(doc: CaseDocument, nodeIds: string[]): Segment {
  const value = {
    id: doc.id,
    fileName: doc.fileName,
    kind: doc.kind,
    classificationConfidence: doc.classificationConfidence,
    kindConfirmedByUser: doc.kindConfirmedByUser,
    extracted: doc.extracted.map(f => ({
      key: f.key,
      label: f.label,
      value: f.value,
      unit: f.unit,
      confidence: f.confidence,
      method: f.method,
    })),
  };
  return {
    key: `document:${doc.id}`,
    label: doc.fileName,
    segmentClass: 'variable',
    value,
    approxTokens: estimateTokens(value),
    nodeIds,
    terms: termsOf(doc.fileName, doc.kind, ...doc.extracted.flatMap(f => [f.key, f.label, f.value])),
    documentId: doc.id,
  };
}

function evidenceSegment(item: EvidenceItem, nodeIds: string[]): Segment {
  const value = {
    id: item.id,
    statement: item.statement,
    sourceType: item.sourceType,
    sourceLabel: item.sourceLabel,
    confidence: item.confidence,
  };
  return {
    key: `evidence:${item.id}`,
    label: item.statement.slice(0, 80),
    segmentClass: 'variable',
    value,
    approxTokens: estimateTokens(value),
    nodeIds,
    terms: termsOf(item.statement, item.sourceLabel, item.sourceType),
    documentId: item.sourceType === 'document' ? item.sourceRef : undefined,
  };
}

export interface SegmentCaseParams {
  caseData: PropertyCase;
  refData: ReferenceData;
  /** Supplied when a title graph has been built; retrieval degrades to term matching without it. */
  graph?: TitleGraph;
}

/**
 * Cut a case into segments.
 *
 * Evidence and documents become one segment each — they are the parts that
 * scale with the size of a case, and selecting among them individually is the
 * whole point. Everything else stays whole, because a screen's risk list or
 * confidence summary is only useful entire; half a risk list is a misleading
 * risk list, not a cheaper one.
 */
export function segmentCase({ caseData, refData, graph }: SegmentCaseParams): Segment[] {
  const { identity } = caseData;
  const result = caseData.result;
  const statePack: StatePack | undefined = refData.statePacks.find(
    p => p.country === identity.country && p.state.toLowerCase() === identity.state.toLowerCase(),
  );
  const locality = refData.localities.find(
    l => l.country === identity.country && l.locality.toLowerCase() === identity.locality.toLowerCase(),
  );
  const sourceNodes = buildSourceNodeIndex(graph);
  const segments: Segment[] = [];

  const push = (
    key: string,
    label: string,
    segmentClass: SegmentClass,
    value: unknown,
    terms: string[] = [],
    nodeIds: string[] = [],
  ): void => {
    if (value === undefined || value === null) return;
    segments.push({ key, label, segmentClass, value, approxTokens: estimateTokens(value), nodeIds, terms });
  };

  // Cache-stable first, matching the ordering `renderCaseContext` established
  // and for the same reason: the prompt cache only helps if the prefix is
  // byte-identical between calls.
  if (statePack) {
    push('statePack', `${statePack.state} state pack`, 'cache_stable', {
      id: statePack.id,
      state: statePack.state,
      statutoryRateLabel: statePack.statutoryRateLabel,
      registerInstrumentLabel: statePack.registerInstrumentLabel,
      registrationAuthority: statePack.registrationAuthority,
      reraAuthority: statePack.reraAuthority,
      requiredDocuments: statePack.requiredDocuments,
      titleChecks: statePack.titleChecks,
      datasets: statePack.datasets,
    });
  }

  push('reference', 'Case reference', 'essential', caseData.reference);
  push('identity', 'Property identity', 'essential', identity, termsOf(identity.label, identity.locality, identity.parcelId));
  if (locality) {
    push('locality', 'Locality reference', 'essential', {
      locality: locality.locality,
      medianPricePerSqm: locality.medianPricePerSqm,
      medianLandRatePerSqm: locality.medianLandRatePerSqm,
      statutoryRatePerSqm: locality.statutoryRatePerSqm,
      zoning: locality.zoning,
      farAllowed: locality.farAllowed,
      source: locality.source,
    }, termsOf(locality.locality, locality.zoning));
  }

  for (const doc of caseData.documents) {
    segments.push(documentSegment(doc, sourceNodes.get(doc.id) ?? []));
  }

  if (result) {
    // The verdict and the value are what every other section is about; an
    // agent that receives risks without the verdict they bear on is reasoning
    // in the dark, so these stay essential regardless of budget.
    push('screen.headline', 'Verdict', 'essential', {
      generatedAt: result.generatedAt,
      engineVersion: result.engineVersion,
      verdict: result.recommendation.verdict,
      headline: result.recommendation.headline,
      indicativeValue: result.indicativeValue,
    });
    push('screen.risks', 'Risk flags', 'essential', result.risks.map(x => ({
      id: x.id, code: x.code, title: x.title, severity: x.severity, category: x.category, status: x.status, evidenceIds: x.evidenceIds,
    })), termsOf(...result.risks.flatMap(x => [x.code, x.title, x.category])));

    push('screen.anchors', 'Valuation anchors', 'variable', result.anchors.map(a => ({
      method: a.method, label: a.label, low: a.low, mid: a.mid, high: a.high, weight: a.weight, confidence: a.confidence, evidenceIds: a.evidenceIds,
    })), termsOf('valuation', 'anchor', 'price', ...result.anchors.map(a => a.method)));
    push('screen.drivers', 'Value drivers', 'variable', result.drivers.map(d => ({
      label: d.label, impactPct: d.impactPct, direction: d.direction, evidenceIds: d.evidenceIds,
    })), termsOf('driver', ...result.drivers.map(d => d.label)));
    push('screen.planning', 'Planning position', 'variable', result.planning, termsOf('planning', 'zoning', 'far'));
    push('screen.completeness', 'Completeness', 'variable', {
      score: result.completeness.score,
      missingCritical: result.completeness.missingCritical,
      items: result.completeness.items.map(i => ({ key: i.key, label: i.label, required: i.required, present: i.present, satisfiedBy: i.satisfiedBy })),
    }, termsOf('completeness', 'missing', 'document'));
    push('screen.confidence', 'Confidence', 'variable', result.confidence, termsOf('confidence', 'uncertainty'));
    push('screen.actions', 'Recommended actions', 'variable', result.actions.map(a => ({
      id: a.id, title: a.title, priority: a.priority, owner: a.owner, done: a.done,
    })), termsOf('action', 'next step', ...result.actions.map(a => a.title)));
    push('comparables', 'Comparables', 'variable', result.comparables.map(x => ({
      id: x.id, label: x.label, propertyType: x.propertyType, areaSqm: x.areaSqm, transactedAt: x.transactedAt,
      pricePerSqm: x.pricePerSqm, adjustedPricePerSqm: x.adjustedPricePerSqm, similarity: x.similarity, source: x.source,
    })), termsOf('comparable', 'transaction', 'market'));

    if (result.stateCompliance) {
      push('stateCompliance', 'State compliance', 'variable', result.stateCompliance,
        termsOf('compliance', 'khata', 'conversion', 'statutory', ...result.stateCompliance.checks.map(x => x.label)));
    }
    if (result.transactionCosts) {
      push('transactionCosts', 'Transaction costs', 'variable', result.transactionCosts,
        termsOf('stamp duty', 'registration', 'cost', 'fee'));
    }
    if (result.titleGraph) {
      // Findings rather than the whole graph: the chains, contradictions and
      // resolution paths are what a model can act on, and they are already a
      // compressed read of a structure far too large to inline.
      push('titleGraph', 'Title graph findings', 'variable', {
        headline: result.titleGraph.headline,
        integrityScore: result.titleGraph.integrityScore,
        chains: result.titleGraph.chains,
        contradictions: result.titleGraph.contradictions,
        resolutionPaths: result.titleGraph.resolutionPaths,
      }, termsOf('title', 'chain', 'contradiction', 'owner', 'conveyance'));
    }
    if (result.playbooks) {
      push('playbooks', 'Diligence playbooks', 'variable', result.playbooks,
        termsOf('playbook', 'procedure', 'gate', ...result.playbooks.map(p => p.label)));
    }

    for (const item of result.evidence) {
      segments.push(evidenceSegment(item, sourceNodes.get(item.sourceRef) ?? []));
    }
  }

  return segments;
}
