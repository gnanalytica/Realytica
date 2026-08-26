/**
 * The counterfactual: which single document, obtained next, closes the most
 * of what is open.
 *
 * A diligence checklist tells a user that eleven documents are missing. It
 * cannot tell them which one to chase first, because it does not know what
 * each one would *prove*. Evidence dependency is itself a graph — every chain
 * break and every contradiction names the remedies that would close it — so
 * "obtain the mother deed and four findings collapse" is computable rather
 * than written by hand per case, and stays true when the findings change.
 *
 * Two decisions make the ranking mean something.
 *
 * **Weight, do not count.** A document that closes one critical break beats
 * one that closes three informational notes. Impact is a share of open
 * *finding weight* (severity-weighted, see `SEVERITY_WEIGHT`), not a share of
 * findings, so the ranking matches how a transaction is actually triaged.
 *
 * **Group on the exact remedy text.** Findings name their remedies from the
 * shared catalogue in `ontology.ts`. If a chain break asked for "the mother
 * deed" and a contradiction asked for "link documents", the same document
 * would appear as two half-impact paths and be ranked below something less
 * useful. The catalogue exists to make that impossible.
 */

import type { ChainBreak, GraphContradiction, ResolutionPath, RiskSeverity, TitleChain } from '../types';
import { SEVERITY_WEIGHT, lookupRemedy, severityRank, stableDigest } from './ontology';

/** One open finding, flattened out of whichever structure produced it. */
interface OpenFinding {
  id: string;
  severity: RiskSeverity;
  resolvedBy: string[];
  /** How the finding reads in a rationale sentence. */
  phrase: string;
}

/**
 * How each finding kind reads inside "…including the critical <phrase>".
 * Written as noun phrases rather than enum names because the rationale is
 * shown to a user, not logged.
 */
const FINDING_PHRASE: Record<string, string> = {
  missing_predecessor: 'missing predecessor at the root of the chain',
  party_discontinuity: 'break between successive parties in the chain',
  undated_instrument: 'undated instrument that cannot be placed in sequence',
  no_root: 'absence of any instrument conveying title',
  insufficient_depth: 'shortfall against the chain depth the jurisdiction expects',
  area_mismatch: 'conflict between the extents the sources state',
  party_mismatch: 'conflict between the party the register names and the party the deeds name',
  date_impossible: 'impossible sequence of dates',
  identifier_mismatch: 'conflict between the parcel identifiers the sources use',
  status_conflict: 'conflict between the recorded statuses',
};

function phraseFor(kind: string): string {
  return FINDING_PHRASE[kind] ?? kind.replace(/_/g, ' ');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Ranks the documents that would close the most open finding weight.
 *
 * Deliberately takes only the findings, not the case or the graph: a
 * resolution path is a statement about what is unresolved, and letting it see
 * the documents already on file would tempt it into recommending things for
 * reasons other than what they would close.
 */
export function resolutionPaths(chains: TitleChain[], contradictions: GraphContradiction[]): ResolutionPath[] {
  const findings: OpenFinding[] = [];

  for (const chain of chains) {
    for (const gap of chain.breaks as ChainBreak[]) {
      findings.push({ id: gap.id, severity: gap.severity, resolvedBy: gap.resolvedBy, phrase: phraseFor(gap.kind) });
    }
  }
  for (const contradiction of contradictions as GraphContradiction[]) {
    findings.push({
      id: contradiction.id,
      severity: contradiction.severity,
      resolvedBy: contradiction.resolvedBy,
      phrase: phraseFor(contradiction.kind),
    });
  }

  const totalWeight = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  if (totalWeight === 0) return [];

  /* --- Group findings by the remedy they name ------------------------ */

  const groups = new Map<string, OpenFinding[]>();
  for (const finding of findings) {
    for (const remedy of finding.resolvedBy) {
      const bucket = groups.get(remedy);
      if (bucket) bucket.push(finding);
      else groups.set(remedy, [finding]);
    }
  }

  const paths: ResolutionPath[] = [];
  for (const [obtain, cleared] of groups) {
    const catalogued = lookupRemedy(obtain);
    const weight = cleared.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
    // Worst first, so the rationale names the finding a reader cares about
    // rather than whichever happened to be discovered first.
    const worst = [...cleared].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))[0];
    const impact = weight / totalWeight;
    const pct = Math.round(impact * 100);

    paths.push({
      // Catalogued remedies get a stable, readable id; anything else falls
      // back to a digest of its own text so the id is still reproducible.
      id: catalogued ? `path-${catalogued.key}` : `path-${stableDigest(obtain, 8)}`,
      obtain,
      documentKind: catalogued?.spec.documentKind,
      resolves: cleared.map(f => f.id).sort(),
      impact: round2(impact),
      rationale:
        `Named as the remedy by ${cleared.length} of ${findings.length} open finding${findings.length === 1 ? '' : 's'}, ` +
        `the gravest of them rated ${worst.severity}: the ${worst.phrase}. ` +
        `Obtaining it clears ${pct}% of the open finding weight on this title.`,
    });
  }

  // Highest impact first. Ties break on the text so the order is total and the
  // same case always presents its options in the same sequence.
  return paths.sort((a, b) => {
    if (a.impact !== b.impact) return b.impact - a.impact;
    return a.obtain < b.obtain ? -1 : a.obtain > b.obtain ? 1 : 0;
  });
}
