/**
 * Internal definition types for the Karnataka diligence playbooks.
 *
 * These are NOT the output contract. `PlaybookRun`, `PlaybookStepResult` and
 * `PlaybookStepState` live in `../types` and are frozen; what follows is the
 * private vocabulary the three playbook modules and the runner share in order
 * to *produce* those structures.
 *
 * WHY THE STEP EVALUATOR CANNOT RETURN 'blocked'
 * ----------------------------------------------
 * `StepOutcome.state` is deliberately typed as `Exclude<PlaybookStepState,
 * 'blocked'>`. Blocking is the runner's decision, never the step's, and it is
 * taken *before* the evaluator is called: if a prerequisite step did not come
 * back `clear`, the runner emits `blocked` and the evaluator function is never
 * invoked at all. That makes the single most important behaviour in this
 * module a property of the type system rather than of anyone's discipline —
 * a step physically cannot reach past its own gate and guess, because it never
 * runs.
 *
 * This matters because the failure mode it prevents is not hypothetical. A
 * Bengaluru title lawyer establishes the chain before reconciling areas, and
 * reconciles areas before arguing about rate, because an area reconciled
 * against a chain nobody has established is a number with no referent. A
 * generic planner asked to "check everything" will happily reconcile the areas
 * first, produce a confident-sounding number, and mislead the buyer at exactly
 * the point where being wrong is most expensive.
 */

import type {
  AreaBasis,
  CaseDocument,
  ComplianceCheck,
  DocumentKind,
  ExtractedField,
  KarnatakaAttributes,
  PlaybookStepState,
  PropertyCase,
  PropertyIdentity,
  ScreenResult,
} from '../types';

/* ==================================================================== */
/* Step and playbook definitions                                        */
/* ==================================================================== */

/** Every state a step evaluator may legitimately reach on its own. */
export type EvaluatedStepState = Exclude<PlaybookStepState, 'blocked'>;

/**
 * Internal severity, used only to decide the run's `ComplianceVerdict`.
 *
 * `PlaybookStepState` has one `attention` value covering everything from "the
 * khata number could not be cross-checked" to "this land is still agricultural
 * and someone has built on it". Those are not the same finding, and rolling a
 * run containing the second one up to `attention` would understate it — so a
 * step may mark its outcome `blocker`, which surfaces on the run verdict while
 * leaving the step's own state (and therefore the frozen contract) untouched.
 */
export type StepSeverity = 'attention' | 'blocker';

export interface StepOutcome {
  state: EvaluatedStepState;
  /**
   * Why the step is in that state, in the terms a practitioner would use, and
   * including the consequence where there is one. Never empty: a state with no
   * stated reason cannot be acted on, argued with, or relied upon.
   */
  finding: string;
  /** Ids of `ScreenResult.evidence` items this finding actually rests on. */
  evidenceIds?: string[];
  /** Narrows the step's declared `needs` to what this particular outcome wants. */
  needs?: DocumentKind[];
  /** Only read when `state` is 'attention'. Defaults to 'attention'. */
  severity?: StepSeverity;
}

export interface PlaybookStep {
  key: string;
  label: string;
  /** The question a practitioner actually asks at this point in the procedure. */
  question: string;
  /**
   * Keys of earlier steps that must be `clear` before this one is evaluated at
   * all. Name a prerequisite here only where evaluating without it would
   * produce an answer with no meaning — a gate that fires for tidiness rather
   * than for substance trains users to click past gates.
   */
  requires: string[];
  /** Documents that bear on this step, whether or not they are on file. */
  needs: DocumentKind[];
  /**
   * The statute, rule, circular or authority this step tests against.
   *
   * A wrong statutory reference is worse than none, so this carries the
   * instrument name without a section number wherever the section is not
   * something this module can stand behind. Where a figure or period is
   * genuinely uncertain, the `finding` says so in words rather than the
   * citation implying a precision the module does not have.
   */
  citation?: string;
  evaluate(ctx: PlaybookContext): StepOutcome;
}

/** Whether a whole procedure is worth running against this case at all. */
export interface PlaybookApplicability {
  applicable: boolean;
  /**
   * Stated on every step when the procedure does not apply, so the user can
   * see the procedure was considered and dismissed for a reason — rather than
   * finding a silently shorter list and having to work out why.
   */
  reason: string;
}

export interface Playbook {
  id: string;
  label: string;
  /** The authority whose procedure this is — BBMP, the DC's office, the Sub-Registrar. */
  authorityContext: string;
  applicability(ctx: PlaybookContext): PlaybookApplicability;
  /**
   * Declaration order is the order a practitioner works in, and the runner
   * evaluates in this order. A step may only require keys declared before it.
   */
  steps: PlaybookStep[];
}

/* ==================================================================== */
/* Evaluation context                                                   */
/* ==================================================================== */

/**
 * Everything a step evaluator is allowed to read, and nothing else.
 *
 * There is no ambient clock and no PRNG on this interface on purpose: `now`
 * arrives as an ISO string from the caller exactly as it does throughout
 * `engine.ts`, and every derived date is computed from it. Two runs over the
 * same case and the same `now` therefore produce byte-identical output.
 */
export interface PlaybookContext {
  readonly propertyCase: PropertyCase;
  readonly identity: PropertyIdentity;
  /** Karnataka State Pack attributes; absent on a case that never recorded them. */
  readonly karnataka: KarnatakaAttributes | undefined;
  readonly documents: CaseDocument[];
  /** The screen, when one has been run. Absent on a case screened for the first time. */
  readonly result: ScreenResult | undefined;
  /** ISO instant supplied by the caller. Never `Date.now()`. */
  readonly now: string;
  /** Calendar year of `now`, read off the ISO string rather than through a `Date`. */
  readonly nowYear: number;

  /** First document of a kind, in upload order. */
  doc(kind: DocumentKind): CaseDocument | undefined;
  hasDoc(kind: DocumentKind): boolean;
  /** An extracted field from the first document of a kind. */
  field(kind: DocumentKind, key: string): ExtractedField | undefined;
  fieldValue(kind: DocumentKind, key: string): string | undefined;
  /** Evidence ids the screen minted for every field of a document. */
  evidenceForDoc(kind: DocumentKind): string[];
  /** The evidence id the screen minted for one extracted field, if any. */
  evidenceForField(kind: DocumentKind, key: string): string[];
  /** Evidence ids whose `sourceRef` names a case-identity attribute, e.g. `identity.karnataka.khataType`. */
  evidenceForRef(ref: string): string[];
  /** The State Pack compliance check with this key, when a screen exists. */
  check(key: string): ComplianceCheck | undefined;
}

/* ==================================================================== */
/* Shared vocabulary                                                    */
/* ==================================================================== */
/*
 * A handful of pure helpers the three playbook modules share. They live here
 * rather than in a sixth file so that the modules speak one vocabulary about
 * areas and dates — most importantly, so that the rule about never comparing
 * two areas measured on different bases is written down once.
 */

/**
 * WHAT an area figure measures, as distinct from the basis it is measured on.
 *
 * This distinction is the whole point. A Bengaluru khata extract's assessed
 * area is a measure of *building*; a sale deed's extent for a flat is the
 * *undivided share of land* that flat carries; a site's extent is the land
 * itself. Those are three different quantities, and two of them differing by
 * 160% is not a discrepancy — it is what correct paperwork looks like.
 * Reporting it as a mismatch is a false positive that sends a buyer to a
 * lawyer over nothing, and it is a mistake this codebase makes exactly once
 * before nobody trusts the output again.
 */
export type AreaQuantity =
  /** The land itself — a site's extent, a plot's area. */
  | 'land_extent'
  /** The undivided share of the layout/building land attached to a unit. */
  | 'undivided_share'
  /** Floor area of a structure, on some basis. */
  | 'built_area';

export interface AreaFigure {
  sqm: number;
  quantity: AreaQuantity;
  /** Only meaningful for `built_area`; 'unknown' where the paperwork does not say. */
  basis: AreaBasis;
  /** How this figure is described to the user, e.g. "assessed area on the khata extract". */
  label: string;
}

export type AreaComparison =
  /** The two figures measure the same quantity on the same basis and can be differenced. */
  | { comparable: true; deltaPct: number; reason: string }
  /** They cannot be differenced. `reason` says why, in the terms the user needs. */
  | { comparable: false; reason: string };

const AREA_QUANTITY_NOUN: Record<AreaQuantity, string> = {
  land_extent: 'extent of land',
  undivided_share: 'undivided share of land',
  built_area: 'floor area of a structure',
};

const AREA_BASIS_NOUN: Record<AreaBasis, string> = {
  carpet: 'carpet area',
  built_up: 'built-up area',
  super_built_up: 'super built-up area',
  unknown: 'an unstated basis',
};

/**
 * The area-basis guard.
 *
 * Refuses to difference two figures unless they measure the same quantity on
 * the same basis, and states precisely why when it refuses. Carpet, built-up
 * and super built-up differ by 25-35% end to end in Bengaluru practice — the
 * city quotes on super built-up while RERA mandates carpet — so a comparison
 * across bases produces a percentage that looks like a title defect and is
 * arithmetic.
 */
export function compareAreas(a: AreaFigure, b: AreaFigure): AreaComparison {
  if (a.quantity !== b.quantity) {
    return {
      comparable: false,
      reason:
        `These two figures do not measure the same thing: the ${a.label} is the ${AREA_QUANTITY_NOUN[a.quantity]}, ` +
        `the ${b.label} is the ${AREA_QUANTITY_NOUN[b.quantity]}. Differencing them would report a discrepancy where ` +
        'correct paperwork routinely shows two unrelated numbers, so no mismatch is asserted here.',
    };
  }
  if (a.quantity === 'built_area' && a.basis !== b.basis) {
    return {
      comparable: false,
      reason:
        `Both figures are floor areas, but the ${a.label} is quoted on ${AREA_BASIS_NOUN[a.basis]} and the ${b.label} ` +
        `on ${AREA_BASIS_NOUN[b.basis]}. Carpet, built-up and super built-up run 25-35% apart end to end in Bengaluru, ` +
        'so the difference between them would be a unit-conversion artefact rather than a discrepancy in the record. ' +
        'Re-express both on one basis before reading anything into the gap.',
    };
  }
  if (a.sqm <= 0 || b.sqm <= 0) {
    return {
      comparable: false,
      reason:
        `One of the two figures is zero or absent (${a.label}: ${formatSqm(a.sqm)}; ${b.label}: ${formatSqm(b.sqm)}), ` +
        'so there is nothing to reconcile. A zero here is usually a true statement about the property rather than a ' +
        'gap in the record — a vacant site has no assessed built area.',
    };
  }
  const deltaPct = ((a.sqm - b.sqm) / b.sqm) * 100;
  return {
    comparable: true,
    deltaPct: Math.round(deltaPct * 10) / 10,
    reason: `Both figures are the ${AREA_QUANTITY_NOUN[a.quantity]} and can be differenced directly.`,
  };
}

/** One decimal place, with the unit, so every area in a finding reads the same way. */
export function formatSqm(sqm: number): string {
  return `${(Math.round(sqm * 10) / 10).toFixed(1)} sqm`;
}

/**
 * Calendar year off the front of an ISO date string.
 *
 * Deliberately string slicing rather than `new Date(...).getFullYear()`: the
 * latter is timezone-dependent at year boundaries, and a diligence step whose
 * answer changes with the runner's TZ setting is not deterministic.
 */
export function isoYear(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const match = /^(\d{4})/.exec(iso.trim());
  return match ? Number(match[1]) : undefined;
}

/** Parses a numeric extracted field value; returns undefined rather than NaN. */
export function numericValue(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.replace(/[,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
  return Number(cleaned);
}

/**
 * Normalises a Karnataka survey number for comparison.
 *
 * "Survey No. 42/3, Whitefield", "Sy. No. 42/3" and "42/3" are the same
 * parcel written three ways, and treating them as three different parcels
 * would manufacture a chain break out of a transcription habit.
 */
export function normaliseSurveyNumber(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = /(\d+\s*(?:\/\s*\d+)*)/.exec(raw.replace(/sy\.?\s*no\.?|survey\s*no\.?/gi, ''));
  return match ? match[1].replace(/\s+/g, '') : undefined;
}
