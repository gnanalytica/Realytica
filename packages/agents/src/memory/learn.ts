/**
 * What a completed case teaches the system — derived deterministically.
 *
 * ## No model call, on purpose
 *
 * It is tempting to hand a finished case to a model and ask "what did we learn?"
 * That would be the wrong tool twice over. First, memory is consulted on *every*
 * subsequent case, so a hallucinated fact here is not a one-off error — it is a
 * permanent one that quietly biases every future screen, and unlike an agent's
 * output nobody re-reads it. Second, the useful signal is already structured:
 * the engine knows exactly which risks fired, the ingestion report knows exactly
 * which sources answered, the pathway list knows exactly which routes were
 * marked blocked. Asking a model to restate that adds cost, latency and
 * fabrication risk to something a `for` loop does exactly.
 *
 * So this file is pure derivation: no `Math.random`, no `Date.now`, no I/O. The
 * clock is a parameter (`ExtractFactsOptions.now`), which is what makes the
 * output byte-identical across runs and therefore idempotent when re-asserted —
 * `MemoryLedger.assert` dedupes on the identity tuple, so re-processing a case
 * is a no-op rather than a doubling.
 *
 * ## The two time axes, as this file sets them
 *
 * - `assertedAt` is always `opts.now`: this is when *we* worked the fact out.
 * - `validFrom` is when the underlying observation happened — the case's
 *   creation for a party sighting, the screen's `generatedAt` for anything
 *   derived from the result, the ingestion or exploration start for a source.
 * - `validTo` is set where an observation genuinely goes stale. A locality rate
 *   or a proof route's feasibility is informative for about a year; a portal's
 *   reachability for about a quarter. Facts about people and preferences get no
 *   expiry, because "this promoter appeared on case X" does not stop being true.
 *
 * Deliberately absent: anything touching `TitleGraph`, `TitleNode` or
 * `TitleEdge`. Party facts here come from extracted document fields, not from
 * the graph's party nodes, even though the graph has a tidier view of them —
 * see `types.ts` for why that boundary is kept structural.
 */

import type { MemoryFact, MemoryScope, PropertyCase, RiskSeverity } from '@valytica/shared';
import { memoryFactId } from './store';
import type { MemoryFactInput } from './types';
import {
  localitySubject,
  looksLikePartyName,
  partySubject,
  procedureSubject,
  sourceSubject,
  userSubject,
  type NormalisedSubject,
} from './subjects';

/* ==================================================================== */
/* Options                                                              */
/* ==================================================================== */

/**
 * How long an observation stays informative, in days.
 *
 * Expiry is a judgement, so it is a parameter rather than a constant buried in
 * the code. The defaults are deliberately generous — an expired fact is not
 * deleted, only held back from recall and counted in `excludedCount`, so erring
 * long costs a little noise while erring short silently discards history.
 */
export interface MemoryHorizons {
  /** Rates, guidance gaps and risk codes observed in a locality. */
  localityObservationDays: number;
  /** Whether a portal or counter answered. Portals change behind the scenes. */
  sourceReliabilityDays: number;
  /** Whether a proof route was feasible. Forms and fees change by circular. */
  procedureFeasibilityDays: number;
}

export const DEFAULT_HORIZONS: MemoryHorizons = {
  localityObservationDays: 365,
  sourceReliabilityDays: 90,
  procedureFeasibilityDays: 365,
};

export interface ExtractFactsOptions {
  /** Knowledge time — the `assertedAt` stamped on every fact produced. */
  now: string;
  horizons?: Partial<MemoryHorizons>;
}

/* ==================================================================== */
/* Time helpers                                                         */
/* ==================================================================== */

const MS_PER_DAY = 86_400_000;

function addDays(iso: string, days: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + days * MS_PER_DAY).toISOString();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/* ==================================================================== */
/* Party mentions                                                       */
/* ==================================================================== */

/**
 * Extraction field keys that name a person or company, and the role they name
 * them in.
 *
 * Keys are compared with punctuation and case removed, because the same role is
 * spelt `ownerName`, `owner_name` and `Owner Name` depending on which extractor
 * produced it.
 */
const PARTY_ROLE_BY_FIELD_KEY: Record<string, string> = {
  ownername: 'owner',
  registeredowner: 'owner',
  registeredownername: 'owner',
  owner: 'owner',
  khataholder: 'khata_holder',
  khataholdername: 'khata_holder',
  sellername: 'seller',
  seller: 'seller',
  vendorname: 'seller',
  vendor: 'seller',
  buyername: 'buyer',
  buyer: 'buyer',
  purchasername: 'buyer',
  purchaser: 'buyer',
  tenantname: 'tenant',
  tenant: 'tenant',
  lesseename: 'tenant',
  lessee: 'tenant',
  lessorname: 'lessor',
  lessor: 'lessor',
  developername: 'promoter',
  developer: 'promoter',
  buildername: 'promoter',
  builder: 'promoter',
  promotername: 'promoter',
  promoter: 'promoter',
  mortgageename: 'mortgagee',
  mortgagee: 'mortgagee',
  grantorname: 'grantor',
  granteename: 'grantee',
  valuername: 'valuer',
  valuer: 'valuer',
};

function fieldKeyLookup(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface PartyMention {
  subject: NormalisedSubject;
  /** `owner`, `tenant`, `promoter` … as mapped from the extraction field key. */
  role: string;
  /** The name exactly as the document spelt it, kept so variants stay visible. */
  raw: string;
  confidence: number;
  documentId: string;
  fieldKey: string;
}

/**
 * Every party named in a case's extracted document fields.
 *
 * Shared with `recall.ts`, which needs the same subject list to look up who a
 * new case is dealing with — deriving it twice would be two chances to derive it
 * differently.
 *
 * Note that `PropertyCase.ownerName` is deliberately *not* read here: that is
 * the Valytica user who opened the case, not a party to the property. It feeds
 * the `user_preference` scope instead.
 */
export function partyMentionsInCase(c: PropertyCase): PartyMention[] {
  const mentions: PartyMention[] = [];
  for (const doc of c.documents) {
    for (const field of doc.extracted) {
      const role = PARTY_ROLE_BY_FIELD_KEY[fieldKeyLookup(field.key)];
      if (!role) continue;
      const raw = field.value.trim();
      if (!looksLikePartyName(raw)) continue;
      const subject = partySubject(raw);
      if (!subject) continue;
      mentions.push({
        subject,
        role,
        raw: raw.replace(/\s+/g, ' '),
        confidence: clamp01(field.confidence),
        documentId: doc.id,
        fieldKey: field.key,
      });
    }
  }
  // Sorted so the output order never depends on document iteration order.
  mentions.sort(
    (a, b) =>
      a.documentId.localeCompare(b.documentId) ||
      a.fieldKey.localeCompare(b.fieldKey) ||
      a.raw.localeCompare(b.raw),
  );
  return mentions;
}

/* ==================================================================== */
/* Reachability vocabulary                                              */
/* ==================================================================== */

/**
 * One vocabulary for `reachability`, whatever produced the observation.
 *
 * The ingestion pipeline reports an `IngestionOutcome` and the explorer reports
 * a `SourceReachability`; if both fed the same predicate in their own words, two
 * observations of the same event would look like a contradiction and supersede
 * each other forever.
 */
export type ReachabilityValue =
  | 'fetched'
  | 'fetched_no_match'
  | 'unreachable'
  | 'blocked_auth'
  | 'blocked_captcha'
  | 'not_found'
  | 'rate_limited';

/**
 * How notable each outcome is, used only to break a tie between two observations
 * of the same source made at the same instant. A failure outranks a success: if
 * one attempt in a case got through and another was captcha-walled, the
 * captcha is the thing worth remembering.
 */
const REACHABILITY_PRECEDENCE: Record<string, number> = {
  blocked_captcha: 6,
  blocked_auth: 5,
  rate_limited: 4,
  not_found: 3,
  unreachable: 2,
  fetched_no_match: 1,
  fetched: 0,
};

/* ==================================================================== */
/* Fact construction                                                    */
/* ==================================================================== */

interface FactDraft {
  scope: MemoryScope;
  subject: NormalisedSubject;
  predicate: string;
  object: string;
  validFrom: string;
  validTo?: string;
  confidence: number;
  sourceRef?: string;
  /** Only consulted when collapsing two same-instant observations. */
  precedence?: number;
}

/** Severity is the only honest confidence signal a risk code carries. */
const RISK_CONFIDENCE_BY_SEVERITY: Record<RiskSeverity, number> = {
  critical: 0.85,
  serious: 0.75,
  warning: 0.6,
  info: 0.4,
};

/**
 * Predicates that hold one value per subject.
 *
 * Duplicated from `store.ts`'s `DEFAULT_CARDINALITY` in spirit but used for a
 * different job: here it collapses several observations *within one case* before
 * they are ever asserted, so a case that touched a portal four times does not
 * emit four mutually-superseding facts with identical `assertedAt` stamps and
 * leave the winner to an implementation detail of iteration order.
 */
const SINGLE_VALUED_IN_BATCH = new Set([
  'reachability',
  'access',
  'would_have_answered',
  'feasibility',
  'authority',
  'persona',
]);

/* ==================================================================== */
/* extractFactsFromCase                                                 */
/* ==================================================================== */

/**
 * Derive everything a case establishes that is worth remembering elsewhere.
 *
 * Returns facts ready to hand to `MemoryStore.assertMany`. Ordering is stable
 * (scope, subject, predicate, object) so two runs over the same case produce
 * deeply equal arrays — which the harness checks, because "deterministic" is a
 * claim that decays the moment an object-key iteration sneaks in.
 */
export function extractFactsFromCase(c: PropertyCase, opts: ExtractFactsOptions): MemoryFact[] {
  const horizons: MemoryHorizons = { ...DEFAULT_HORIZONS, ...opts.horizons };
  const assertedAt = opts.now;
  const drafts: FactDraft[] = [];

  /* --- party -------------------------------------------------------- */

  for (const mention of partyMentionsInCase(c)) {
    // Damped: an extraction confidence describes how sure we are of the *text*,
    // and carrying a name across cases is a weaker claim than reading it here.
    const confidence = round2(clamp01(mention.confidence * 0.9));
    drafts.push({
      scope: 'party',
      subject: mention.subject,
      predicate: 'appeared_as',
      object: mention.role,
      validFrom: c.createdAt,
      confidence,
      sourceRef: `document:${mention.documentId}#${mention.fieldKey}`,
    });
    // The surface spelling is retained separately. When a later case throws up a
    // variant the fold does not catch, the stored variants are the evidence for
    // fixing the fold.
    drafts.push({
      scope: 'party',
      subject: mention.subject,
      predicate: 'known_as',
      object: mention.raw,
      validFrom: c.createdAt,
      confidence,
      sourceRef: `document:${mention.documentId}#${mention.fieldKey}`,
    });
  }

  /* --- locality ----------------------------------------------------- */

  const locality = localitySubject(c.identity.locality);
  const result = c.result;
  if (locality && result) {
    const observedAt = result.generatedAt;
    const expires = addDays(observedAt, horizons.localityObservationDays);

    const perSqmMid = Math.round(result.indicativeValue.perSqm.mid);
    if (perSqmMid > 0) {
      drafts.push({
        scope: 'locality',
        subject: locality,
        predicate: 'observed_rate_per_sqm',
        // Self-describing: a bare number would be uninterpretable next to a
        // land rate or a different currency, and property type moves the rate
        // by more than most localities differ from each other.
        object: `${perSqmMid} ${result.indicativeValue.currency}/sqm for ${c.identity.propertyType}`,
        validFrom: observedAt,
        validTo: expires,
        confidence: round2(clamp01((result.confidence.score / 100) * 0.9)),
        sourceRef: 'indicativeValue',
      });
    }

    // The gap between the statutory floor and the market ceiling is the whole
    // point of the statutory anchor, and it is the most portable thing a case
    // learns about a locality — it drives stamp duty exposure on the next one.
    const statutory = result.anchors.find(a => a.method === 'statutory_reference');
    if (statutory && statutory.low > 0 && statutory.high > statutory.low) {
      const gapPct = ((statutory.high - statutory.low) / statutory.low) * 100;
      drafts.push({
        scope: 'locality',
        subject: locality,
        predicate: 'guidance_value_gap_pct',
        object: `${gapPct.toFixed(1)}%`,
        validFrom: observedAt,
        validTo: expires,
        confidence: round2(clamp01(statutory.confidence)),
        sourceRef: `anchor:${statutory.id}`,
      });
    }

    if (result.transactionCosts) {
      drafts.push({
        scope: 'locality',
        subject: locality,
        predicate: 'guidance_value_exceeds_consideration',
        object: String(result.transactionCosts.dutiableBasis === 'statutory_guidance_value'),
        validFrom: observedAt,
        validTo: expires,
        confidence: 0.85,
        sourceRef: 'transactionCosts',
      });
    }

    for (const risk of result.risks) {
      // `info` risks are commentary and would swamp the genuine pattern.
      if (risk.severity === 'info') continue;
      drafts.push({
        scope: 'locality',
        subject: locality,
        predicate: 'recurring_risk_code',
        object: risk.code,
        validFrom: observedAt,
        validTo: expires,
        confidence: RISK_CONFIDENCE_BY_SEVERITY[risk.severity],
        sourceRef: `risk:${risk.id}`,
      });
    }
  }

  /* --- source reliability ------------------------------------------- */

  const intelligence = c.intelligence;

  for (const report of intelligence?.ingestions ?? []) {
    const observedAt = report.startedAt;
    const expires = addDays(observedAt, horizons.sourceReliabilityDays);
    for (const attempt of report.attempted) {
      // A skipped source teaches nothing: we did not try it, so we learned
      // nothing about whether it would have answered.
      if (attempt.outcome === 'skipped') continue;
      const subject = sourceSubject(attempt.sourceLabel || attempt.sourceId);
      if (!subject) continue;
      const reachability: ReachabilityValue =
        attempt.outcome === 'ingested'
          ? 'fetched'
          : attempt.outcome === 'no_match'
            ? 'fetched_no_match'
            : 'unreachable';
      drafts.push({
        scope: 'source_reliability',
        subject,
        predicate: 'reachability',
        object: reachability,
        validFrom: observedAt,
        validTo: expires,
        // First-hand: we actually made the attempt, so this is about as sure as
        // memory ever gets.
        confidence: 0.9,
        sourceRef: `ingestion:${report.id}`,
        precedence: REACHABILITY_PRECEDENCE[reachability],
      });
      drafts.push({
        scope: 'source_reliability',
        subject,
        predicate: 'access',
        object: attempt.access,
        validFrom: observedAt,
        validTo: expires,
        confidence: 0.9,
        sourceRef: `ingestion:${report.id}`,
      });
    }
  }

  for (const session of intelligence?.explorations ?? []) {
    const observedAt = session.startedAt;
    const expires = addDays(observedAt, horizons.sourceReliabilityDays);

    for (const entry of session.unreachable) {
      const subject = sourceSubject(entry.source);
      if (!subject) continue;
      drafts.push({
        scope: 'source_reliability',
        subject,
        predicate: 'reachability',
        object: entry.reachability,
        validFrom: observedAt,
        validTo: expires,
        confidence: 0.85,
        sourceRef: `exploration:${session.id}`,
        precedence: REACHABILITY_PRECEDENCE[entry.reachability] ?? 0,
      });
      // The most useful half of an unreachable source is what it would have
      // told us. Remembering that is how the next case can plan around the gap
      // instead of rediscovering it.
      drafts.push({
        scope: 'source_reliability',
        subject,
        predicate: 'would_have_answered',
        object: entry.whatItWouldHaveAnswered,
        validFrom: observedAt,
        validTo: expires,
        confidence: 0.8,
        sourceRef: `exploration:${session.id}`,
      });
    }

    for (const lead of session.leads) {
      for (const visit of lead.visited) {
        const subject = sourceSubject(visit.url);
        if (!subject) continue;
        drafts.push({
          scope: 'source_reliability',
          subject,
          predicate: 'reachability',
          object: visit.reachability,
          validFrom: observedAt,
          validTo: expires,
          // Weaker than a deliberate ingestion attempt: one URL behaving is not
          // proof the source as a whole is usable.
          confidence: 0.7,
          sourceRef: `exploration:${session.id}`,
          precedence: REACHABILITY_PRECEDENCE[visit.reachability] ?? 0,
        });
      }
    }
  }

  /* --- procedure ---------------------------------------------------- */

  // Routes carry no date of their own, so they are dated by the run that
  // produced them, falling back to the case's own last update.
  const routeObservedAt = intelligence?.lastRunAt ?? c.updatedAt;
  const routeExpires = addDays(routeObservedAt, horizons.procedureFeasibilityDays);
  for (const pathway of intelligence?.pathways ?? []) {
    for (const route of pathway.routes) {
      const subject = procedureSubject(route.title);
      if (!subject) continue;
      const confidence = round2(clamp01(route.confidence));
      drafts.push({
        scope: 'procedure',
        subject,
        predicate: 'feasibility',
        object: route.feasibility,
        validFrom: routeObservedAt,
        validTo: routeExpires,
        confidence,
        sourceRef: route.formOrReference ? `route:${route.id}#${route.formOrReference}` : `route:${route.id}`,
      });
      drafts.push({
        scope: 'procedure',
        subject,
        predicate: 'authority',
        object: route.authority,
        validFrom: routeObservedAt,
        validTo: routeExpires,
        confidence,
        sourceRef: `route:${route.id}`,
      });
      if (pathway.recommendedRouteId && route.id === pathway.recommendedRouteId) {
        drafts.push({
          scope: 'procedure',
          subject,
          predicate: 'recommended_for',
          object: pathway.targetLabel,
          validFrom: routeObservedAt,
          validTo: routeExpires,
          confidence,
          sourceRef: `pathway:${pathway.id}`,
        });
      }
    }
  }

  /* --- user preference ---------------------------------------------- */

  const user = userSubject(c.ownerName);
  drafts.push({
    scope: 'user_preference',
    subject: user,
    predicate: 'persona',
    object: c.persona,
    validFrom: c.createdAt,
    // The user picked this themselves; there is nothing to be uncertain about
    // beyond their having changed their mind, which supersession handles.
    confidence: 0.95,
    sourceRef: 'identity',
  });

  if (result) {
    for (const risk of result.risks) {
      if (risk.status === 'open') continue;
      const disposition = risk.status === 'accepted' ? 'accepts' : 'mitigates';
      // Both the class and the specific code are recorded. The class is the
      // signal the product cares about — a user who accepts every tenancy risk
      // is telling you what kind of buyer they are — while the code keeps that
      // claim auditable back to the individual decisions behind it.
      drafts.push({
        scope: 'user_preference',
        subject: user,
        predicate: `${disposition}_risk_category`,
        object: risk.category,
        validFrom: result.generatedAt,
        confidence: 0.7,
        sourceRef: `risk:${risk.id}`,
      });
      drafts.push({
        scope: 'user_preference',
        subject: user,
        predicate: `${disposition}_risk_code`,
        object: risk.code,
        validFrom: result.generatedAt,
        confidence: 0.7,
        sourceRef: `risk:${risk.id}`,
      });
    }
  }

  /* --- collapse, materialise, sort ---------------------------------- */

  return materialise(collapseSingleValued(drafts), c.id, assertedAt);
}

/**
 * Keep one draft per (subject, predicate) for predicates that can only hold one
 * value, so a single case never emits its own contradiction.
 *
 * The winner is the latest observation; ties go to the more notable outcome,
 * then to the higher confidence, then alphabetically. Every step is total and
 * deterministic — an arbitrary winner would make the whole extraction
 * non-reproducible.
 */
function collapseSingleValued(drafts: FactDraft[]): FactDraft[] {
  const singles = new Map<string, FactDraft>();
  const out: FactDraft[] = [];
  for (const d of drafts) {
    if (!SINGLE_VALUED_IN_BATCH.has(d.predicate)) {
      out.push(d);
      continue;
    }
    const key = `${d.subject.key}|${d.predicate}`;
    const held = singles.get(key);
    if (!held || beats(d, held)) singles.set(key, d);
  }
  return [...out, ...singles.values()];
}

function beats(candidate: FactDraft, held: FactDraft): boolean {
  const ct = Date.parse(candidate.validFrom);
  const ht = Date.parse(held.validFrom);
  const cValid = Number.isNaN(ct) ? 0 : ct;
  const hValid = Number.isNaN(ht) ? 0 : ht;
  if (cValid !== hValid) return cValid > hValid;
  const cp = candidate.precedence ?? 0;
  const hp = held.precedence ?? 0;
  if (cp !== hp) return cp > hp;
  if (candidate.confidence !== held.confidence) return candidate.confidence > held.confidence;
  return candidate.object.localeCompare(held.object) < 0;
}

/** Turn drafts into facts with derived ids, then sort into a canonical order. */
function materialise(drafts: FactDraft[], caseId: string, assertedAt: string): MemoryFact[] {
  const facts: MemoryFact[] = drafts.map(d => {
    const base: MemoryFactInput = {
      scope: d.scope,
      subject: d.subject.key,
      subjectLabel: d.subject.label,
      predicate: d.predicate,
      object: d.object,
      validFrom: d.validFrom,
      validTo: d.validTo,
      assertedAt,
      sourceCaseId: caseId,
      sourceRef: d.sourceRef,
      confidence: round2(clamp01(d.confidence)),
    };
    return { ...base, id: memoryFactId({ ...base, scope: d.scope }) };
  });

  facts.sort(
    (a, b) =>
      a.scope.localeCompare(b.scope) ||
      a.subject.localeCompare(b.subject) ||
      a.predicate.localeCompare(b.predicate) ||
      a.object.localeCompare(b.object) ||
      a.id.localeCompare(b.id),
  );

  // A case can legitimately produce the same tuple twice — the same name in the
  // same role on two documents, say. The store would dedupe on assert, but
  // returning duplicates would make the output misleading to read.
  const seen = new Set<string>();
  return facts.filter(f => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}
