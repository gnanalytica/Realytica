/**
 * Span-level attribution: do the figures in a model answer exist on the file?
 *
 * Grounding here has always been enforced on the way IN — retrieval over the
 * project's own graph, prompts that forbid invention — and audited AFTER, by
 * the critic. Nothing checked the way OUT: a copilot answer could carry a
 * number no register holds and render it in the same voice as one that does.
 * The literature calls the missing piece attribution checking, and in a
 * product whose one unshippable failure is an invented figure, it is the
 * cheapest guard of the three: every number the answer is ALLOWED to use is
 * already in memory, so verification is a lookup, not a model call.
 *
 * Three rules keep it honest and quiet:
 *
 * **Flag, never block.** A flagged figure renders with a caution, exactly as
 * capability gaps and inferred values do elsewhere. Blocking would put a
 * regex in charge of what a person may read; the product's stance is that
 * silence is the failure, not imperfection.
 *
 * **Conservative extraction.** Only claims that could plausibly be facts
 * about this project are checked: money, areas, percentages, and large bare
 * numbers. A false "unsupported" flag on every small integer would teach
 * people to ignore the caution — the same reasoning the prompt-guardrail
 * checker documents for its own false-positive rate.
 *
 * **Tolerant matching.** Models round. "₹3.56 crore" for 35,637,070 is a
 * grounded claim, not an invention, so a claim matches a fact within a small
 * relative tolerance or when both round to the same three significant
 * figures. The tolerance is the price of not flagging honest rounding; an
 * actually-invented figure lands nowhere near a real one often enough for
 * the check to keep its meaning.
 *
 * This is deliberately NOT applied to the deterministic chat path: that text
 * is assembled from register values directly and cannot disagree with them.
 * Only model-authored turns carry the risk, so only model turns pay the cost.
 */

import type { DdProject } from './types';

export interface AttributionFact {
  /** Normalised numeric value. Money in major units, areas in sqm, percents as 0..100. */
  value: number;
  kind: 'money' | 'area' | 'percent' | 'number';
  /** Where it came from, for the flag's tooltip and for debugging a false positive. */
  source: string;
}

export interface UnsupportedClaim {
  /** The claim as it appeared in the answer. */
  text: string;
  kind: AttributionFact['kind'];
  value: number;
}

export interface AttributionReport {
  /** Claims extracted and checked. Zero means the answer carried no checkable figures. */
  checked: number;
  unsupported: UnsupportedClaim[];
}

const SQFT_PER_SQM = 10.7639;
const CRORE = 1e7;
const LAKH = 1e5;

/* ==================================================================== */
/* Extracting numbers from text                                          */
/* ==================================================================== */

function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

interface ExtractedClaim {
  text: string;
  kind: AttributionFact['kind'];
  value: number;
}

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;

/**
 * The claim patterns, ordered so a span is consumed by its most specific
 * reading — "₹3.5 crore" must parse as money-in-crore, not as the bare
 * number 3.5.
 */
const CLAIM_PATTERNS: Array<{ kind: AttributionFact['kind']; re: RegExp; scale: (n: number, m: RegExpExecArray) => number }> = [
  {
    kind: 'money',
    re: new RegExp(String.raw`(?:₹|rs\.?\s*|inr\s*)?(${NUM})\s*(crore|cr\b|lakh|lakhs|l\b)`, 'gi'),
    scale: (n, m) => (/^c/i.test(m[2]!) ? n * CRORE : n * LAKH),
  },
  {
    kind: 'money',
    re: new RegExp(String.raw`(?:₹|€|\brs\.?\s*|\binr\s+|\beur\s+)(${NUM})`, 'gi'),
    scale: (n) => n,
  },
  {
    kind: 'area',
    re: new RegExp(String.raw`(${NUM})\s*(?:sq\.?\s*ft|sqft|square\s+feet)`, 'gi'),
    scale: (n) => n / SQFT_PER_SQM, // stored unit is sqm
  },
  {
    kind: 'area',
    re: new RegExp(String.raw`(${NUM})\s*(?:sq\.?\s*m\b|sqm|square\s+met)`, 'gi'),
    scale: (n) => n,
  },
  {
    kind: 'area',
    re: new RegExp(String.raw`(${NUM})\s*acres?\b`, 'gi'),
    scale: (n) => n * 4046.86,
  },
  {
    kind: 'percent',
    re: new RegExp(String.raw`(${NUM})\s*(?:%|percent\b|/\s*100\b)`, 'gi'),
    scale: (n) => n,
  },
  {
    /*
     * Large bare numbers only. Small integers are counts and ordinals, and
     * flagging "3 scopes" would bury the one flag that matters.
     *
     * The boundaries exclude digits sitting inside an identifier. Record ids
     * here look like `prp_1a06d6cf46b-7a5e5f8fcf1098-7134d3e8468978`, and the
     * old lookbehind — digits, punctuation and currency only — let the tail of
     * one through as the claim "8468978". A person then read "Not on the file:
     * 8468978 · 060786. Treat them as unverified", which is a warning about
     * nothing, attached to an answer that had invented no figure at all. A
     * grounding flag that cries wolf is worse than no flag.
     */
    kind: 'number',
    re: new RegExp(String.raw`(?<![\w.,%₹-])(\d[\d,]{4,}(?:\.\d+)?)(?![\w-])`, 'g'),
    scale: (n) => n,
  },
];

export function extractClaims(text: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  const consumed: Array<[number, number]> = [];
  for (const pattern of CLAIM_PATTERNS) {
    pattern.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.re.exec(text))) {
      const start = match.index;
      const end = start + match[0].length;
      if (consumed.some(([s, e]) => start < e && end > s)) continue;
      const n = toNumber(match[1]!);
      if (n === null || n <= 0) continue;
      const value = pattern.scale(n, match);
      if (pattern.kind === 'number' && value < 10_000) continue;
      consumed.push([start, end]);
      claims.push({ text: match[0].trim(), kind: pattern.kind, value });
    }
  }
  return claims;
}

/* ==================================================================== */
/* The fact index                                                        */
/* ==================================================================== */

function pushFact(facts: AttributionFact[], value: number | undefined | null, kind: AttributionFact['kind'], source: string): void {
  if (value === undefined || value === null || !Number.isFinite(value) || value === 0) return;
  facts.push({ value, kind, source });
}

/** Numbers embedded in register prose are on the file, so citing them is grounded. */
function pushTextFacts(facts: AttributionFact[], text: string | undefined, source: string): void {
  if (!text) return;
  for (const claim of extractClaims(text)) {
    facts.push({ value: claim.value, kind: claim.kind, source });
  }
}

/**
 * Every figure an answer may legitimately use, from the records the copilot
 * can read. Rebuilt per call rather than cached: the registers move under
 * chat constantly, and a stale index flags true statements.
 */
export function buildFactIndex(project: DdProject): AttributionFact[] {
  const facts: AttributionFact[] = [];

  pushFact(facts, project.budget, 'money', 'project budget');
  pushFact(facts, project.landAreaSqm, 'area', 'project land area');
  pushFact(facts, project.builtUpAreaSqm, 'area', 'project built-up area');
  pushFact(facts, project.saleableAreaSqm, 'area', 'project saleable area');

  for (const run of project.valuationRuns) {
    pushFact(facts, run.indicatedValue, 'money', `valuation ${run.id}`);
    pushFact(facts, run.low, 'money', `valuation ${run.id} low`);
    pushFact(facts, run.high, 'money', `valuation ${run.id} high`);
    pushFact(facts, run.landValue, 'money', `valuation ${run.id} land`);
    pushFact(facts, run.buildingReplacement, 'money', `valuation ${run.id} replacement`);
    pushFact(facts, run.comparableValue, 'money', `valuation ${run.id} comparable`);
    for (const approach of run.ibbi.approaches) pushFact(facts, approach.amount, 'money', `valuation approach ${approach.approach}`);
  }

  const screen = project.lastScreenResult;
  if (screen) {
    pushFact(facts, screen.indicativeValue.low, 'money', 'screen low');
    pushFact(facts, screen.indicativeValue.mid, 'money', 'screen mid');
    pushFact(facts, screen.indicativeValue.high, 'money', 'screen high');
    for (const anchor of screen.anchors) {
      pushFact(facts, anchor.low, 'money', `anchor ${anchor.method} low`);
      pushFact(facts, anchor.mid, 'money', `anchor ${anchor.method} mid`);
      pushFact(facts, anchor.high, 'money', `anchor ${anchor.method} high`);
      pushFact(facts, anchor.weight * 100, 'percent', `anchor ${anchor.method} weight`);
    }
    pushFact(facts, screen.completeness.score, 'percent', 'completeness score');
    pushFact(facts, screen.confidence.score, 'percent', 'confidence score');
    if (screen.stateCompliance) pushFact(facts, screen.stateCompliance.score, 'percent', 'compliance score');
    if (screen.transactionCosts) {
      pushFact(facts, screen.transactionCosts.total, 'money', 'transaction costs total');
      pushFact(facts, screen.transactionCosts.dutiableValue, 'money', 'dutiable value');
      for (const line of screen.transactionCosts.lines) {
        pushFact(facts, line.amount, 'money', `transaction cost ${line.key}`);
        pushFact(facts, line.pct, 'percent', `transaction cost ${line.key} rate`);
      }
    }
    for (const driver of screen.drivers) pushFact(facts, Math.abs(driver.impactPct), 'percent', `driver ${driver.id}`);
    for (const comparable of screen.comparables) {
      pushFact(facts, comparable.adjustedPricePerSqm, 'money', `comparable ${comparable.id}`);
      pushFact(facts, comparable.pricePerSqm, 'money', `comparable ${comparable.id} raw`);
    }
  }
  if (project.lastScreen) {
    pushFact(facts, project.lastScreen.indicatedLow, 'money', 'snapshot low');
    pushFact(facts, project.lastScreen.indicatedMid, 'money', 'snapshot mid');
    pushFact(facts, project.lastScreen.indicatedHigh, 'money', 'snapshot high');
  }

  for (const asset of project.assets) pushTextFacts(facts, `${asset.name} ${asset.notes ?? ''}`, `asset ${asset.id}`);
  for (const row of project.evidence) pushTextFacts(facts, `${row.title} ${row.description ?? ''}`, `evidence ${row.id}`);
  for (const row of project.findings) pushTextFacts(facts, `${row.title} ${row.description}`, `finding ${row.id}`);
  for (const row of project.risks) pushTextFacts(facts, `${row.title} ${row.cause} ${row.mitigation ?? ''}`, `risk ${row.id}`);
  for (const row of project.actions) pushTextFacts(facts, `${row.title} ${row.description ?? ''}`, `action ${row.id}`);
  for (const row of project.decisions) pushTextFacts(facts, `${row.title} ${row.rationale}`, `decision ${row.id}`);
  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) pushTextFacts(facts, check.comments, `check ${check.id}`);
    }
  }

  return facts;
}

/* ==================================================================== */
/* Matching                                                              */
/* ==================================================================== */

const RELATIVE_TOLERANCE = 0.015;

function roundSig(value: number, figures: number): number {
  if (value === 0) return 0;
  const magnitude = 10 ** (figures - 1 - Math.floor(Math.log10(Math.abs(value))));
  return Math.round(value * magnitude) / magnitude;
}

function matches(claim: ExtractedClaim, fact: AttributionFact): boolean {
  // Percent claims only match percent facts — 12% and ₹12 are unrelated.
  // Money and bare numbers cross-match: "the mid is 35,637,070" cites a money
  // fact without a currency mark. Areas match areas in either unit, and also
  // bare numbers, since register prose writes "1,850 sqm" as text.
  if (claim.kind === 'percent' && fact.kind !== 'percent') return false;
  if (claim.kind !== 'percent' && fact.kind === 'percent') return false;

  const candidates = claim.kind === 'area' && fact.kind !== 'area'
    ? [claim.value, claim.value * SQFT_PER_SQM]
    : [claim.value];

  for (const value of candidates) {
    if (Math.abs(value - fact.value) <= Math.abs(fact.value) * RELATIVE_TOLERANCE) return true;
    if (roundSig(value, 3) === roundSig(fact.value, 3)) return true;
  }
  return false;
}

/**
 * Check a model answer against the file.
 *
 * Returns what was checked and what nothing on the file supports. Never
 * throws: an attribution checker that can break chat has its priorities
 * inverted, so a malformed anything degrades to "nothing checked".
 */
export function verifyAttribution(project: DdProject, answerText: string): AttributionReport {
  try {
    const claims = extractClaims(answerText);
    if (claims.length === 0) return { checked: 0, unsupported: [] };
    const facts = buildFactIndex(project);
    const unsupported = claims
      .filter((claim) => !facts.some((fact) => matches(claim, fact)))
      .map((claim) => ({ text: claim.text, kind: claim.kind, value: claim.value }));
    return { checked: claims.length, unsupported };
  } catch {
    return { checked: 0, unsupported: [] };
  }
}
