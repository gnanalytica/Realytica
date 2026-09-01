/**
 * A valuation as a formula over inputs that can each be traced to something.
 *
 * The version this replaces computed four numbers from three project fields and
 * a locality median, then wrote a sentence about each. It read like a
 * valuation and could not be checked like one: there was no way to ask where
 * a rate came from, no way to see the working, and — the part that mattered
 * most — no connection at all between the number and the areas somebody had
 * carefully evidenced on the valuation checks. A valuer could record a RERA
 * carpet area against an approved drawing and the computed value would quietly
 * use `project.saleableAreaSqm` instead.
 *
 * So the unit here is not an amount. It is an APPROACH RUN: a named method, a
 * list of inputs each carrying where it came from, the working shown line by
 * line, and an amount at the end. Everything a reader needs to disagree with
 * the number is in the same object as the number.
 *
 * ## Why the source is on the input rather than on the approach
 *
 * "Market approach, INR 8.4 crore, from locality medians" is one provenance
 * statement covering four different facts, and in practice they never share a
 * provenance: the area came off an approved drawing through a check that
 * required proof, the rate came off a locality reference table nobody
 * inspected, and the adjustment came off a rule somebody wrote down last year.
 * Attaching provenance per input is what lets a report say "the area is
 * evidenced, the rate is not" — which is the true and useful sentence, and
 * unsayable when provenance lives on the approach.
 *
 * ## Missing inputs do not become zero
 *
 * An approach with an input it could not find does not run. It records what it
 * was missing and reports `usable: false`, and the reconciliation says so.
 * This is the single most important rule in the file: the previous version
 * defaulted a missing locality rate to `?? 18_000` and valued the site on an
 * invented number with nothing on the page to say so.
 */

import type { ValuationApproach } from './types';

/* ==================================================================== */
/* Where a number came from                                              */
/* ==================================================================== */

/**
 * The provenance of one input, as a discriminated union rather than a string.
 *
 * A string would let "approved drawings" and "locality median" sit in the same
 * field looking equally solid. These are different KINDS of claim and the
 * renderer has to be able to treat them differently — an evidenced check field
 * is checkable, a reference median is a market observation nobody inspected,
 * and a stated assumption is somebody's judgement with their name on it.
 */
export type ValuationInputSource =
  /** Recorded on a check, and therefore subject to that check's proof rule. */
  | { kind: 'check_field'; checkId: string; checkTitle: string; fieldKey: string }
  /** A particular of the project record. */
  | { kind: 'project'; field: string }
  /** A locality reference median. Market observation, not inspected for this asset. */
  | { kind: 'locality'; localityId: string; localityLabel: string; field: string }
  /** Derived from an earlier step of the same approach. */
  | { kind: 'derived'; from: string }
  /** Somebody's stated assumption, with their name on it. */
  | { kind: 'assumption'; statedBy: string };

export const INPUT_SOURCE_STRENGTH: Record<ValuationInputSource['kind'], string> = {
  check_field: 'recorded on a check',
  project: 'a project particular',
  locality: 'a locality median — a market observation, not inspected for this asset',
  derived: 'worked out from the inputs above',
  assumption: 'a stated assumption',
};

export interface ValuationInput {
  key: string;
  label: string;
  /** Null when the input could not be found. The approach then does not run. */
  value: number | null;
  unit?: string;
  source: ValuationInputSource;
  /** The evidence row this was read off, when the check that recorded it cited one. */
  evidenceId?: string;
  note?: string;
}

/** One line of the working, so a reader can follow the arithmetic. */
export interface ValuationStep {
  label: string;
  /** The arithmetic with the numbers in it — "1,208 sqm × 85,000/sqm". */
  expression: string;
  value: number;
  unit?: string;
}

/* ==================================================================== */
/* One approach, run                                                     */
/* ==================================================================== */

/**
 * The specific method inside an approach.
 *
 * `ValuationApproach` is the four-way family a report groups by; this is what
 * was actually done. "Cost" covers both a bare replacement cost and a
 * depreciated one, and those are not the same valuation — an undepreciated
 * replacement cost on a thirty-year-old building overstates it by whatever
 * proportion of its life has run, which is the error the previous version made
 * on every asset it touched.
 */
export type ValuationMethodKey =
  | 'comparable_rate'
  | 'land_rate'
  | 'depreciated_replacement_cost'
  | 'investment_income'
  | 'residual_land';

export const VALUATION_METHOD_LABEL: Record<ValuationMethodKey, string> = {
  comparable_rate: 'Comparable rate on saleable area',
  land_rate: 'Land rate on plot area',
  depreciated_replacement_cost: 'Depreciated replacement cost',
  investment_income: 'Income capitalisation',
  residual_land: 'Residual land value',
};

export const VALUATION_METHOD_APPROACH: Record<ValuationMethodKey, ValuationApproach> = {
  comparable_rate: 'market',
  land_rate: 'market',
  depreciated_replacement_cost: 'cost',
  investment_income: 'income',
  residual_land: 'residual',
};

export interface ValuationApproachRun {
  method: ValuationMethodKey;
  approach: ValuationApproach;
  /** The formula in symbols, before the numbers go in. */
  formula: string;
  inputs: ValuationInput[];
  steps: ValuationStep[];
  /** Null when the approach could not run. Never zero for a missing input. */
  amount: number | null;
  /** Named, so "why is there no income approach here" has an answer on the page. */
  missing: string[];
  /**
   * Share of the reconciliation, and WHY.
   *
   * Weight without a basis is a number somebody has to take on trust, and
   * IBBI Rule 8(h) asks for the procedure to be stated. The basis is a
   * sentence a valuer could argue with.
   */
  weight: number;
  weightBasis: string;
}

export function approachIsUsable(run: ValuationApproachRun): boolean {
  return run.amount !== null && run.missing.length === 0;
}

/* ==================================================================== */
/* Building one                                                          */
/* ==================================================================== */

/**
 * A small builder, because every approach does the same three things and
 * getting any of them subtly different across four methods is how a valuation
 * ends up with one approach that silently treats a missing input as zero.
 */
export class ApproachBuilder {
  private readonly inputs: ValuationInput[] = [];
  private readonly steps: ValuationStep[] = [];
  private readonly missing: string[] = [];

  constructor(
    private readonly method: ValuationMethodKey,
    private readonly formula: string,
  ) {}

  /**
   * Take an input. A null value is RECORDED rather than skipped — the report
   * has to be able to say "no cap rate was recorded", and an input that simply
   * vanished cannot say that.
   */
  need(input: ValuationInput): number | null {
    this.inputs.push(input);
    if (input.value === null || !Number.isFinite(input.value)) {
      this.missing.push(input.label);
      return null;
    }
    return input.value;
  }

  /** An input the approach can run without. Absence is not a failure. */
  optional(input: ValuationInput, fallback: number): number {
    this.inputs.push(input);
    return input.value !== null && Number.isFinite(input.value) ? input.value : fallback;
  }

  step(label: string, expression: string, value: number, unit?: string): number {
    this.steps.push({ label, expression, value, ...(unit ? { unit } : {}) });
    return value;
  }

  /** Finish. An approach missing anything it needed returns a null amount. */
  done(amount: number | null, weight: number, weightBasis: string): ValuationApproachRun {
    const blocked = this.missing.length > 0;
    return {
      method: this.method,
      approach: VALUATION_METHOD_APPROACH[this.method],
      formula: this.formula,
      inputs: this.inputs,
      steps: blocked ? [] : this.steps,
      amount: blocked ? null : amount,
      missing: this.missing,
      weight: blocked ? 0 : weight,
      weightBasis: blocked ? `Not run — missing ${this.missing.join(', ')}.` : weightBasis,
    };
  }
}

/* ==================================================================== */
/* Reconciling several approaches                                        */
/* ==================================================================== */

export interface ValuationReconciliation {
  /** The weighted figure, or null when nothing ran. */
  indicated: number | null;
  low: number | null;
  high: number | null;
  /** How the spread was arrived at, since a hardcoded ±12% says nothing. */
  spreadBasis: string;
  usedMethods: ValuationMethodKey[];
  skippedMethods: Array<{ method: ValuationMethodKey; because: string }>;
}

/**
 * Blend what ran, and derive the range from how much they disagree.
 *
 * The previous version printed `±12%` on every valuation regardless of whether
 * its four approaches landed within 2% of each other or a factor of three
 * apart. Those are opposite situations and the band is the one number that
 * should tell them apart, so it comes from the spread of the approaches
 * themselves, floored so that a single-approach valuation still shows honest
 * uncertainty rather than a suspiciously tight range.
 */
export const MIN_VALUATION_SPREAD = 0.08;

export function reconcile(runs: ValuationApproachRun[]): ValuationReconciliation {
  const usable = runs.filter(approachIsUsable);
  const skipped = runs
    .filter((r) => !approachIsUsable(r))
    .map((r) => ({ method: r.method, because: r.missing.length ? `missing ${r.missing.join(', ')}` : 'produced no amount' }));

  if (!usable.length) {
    return {
      indicated: null,
      low: null,
      high: null,
      spreadBasis: 'No approach had all of its inputs, so there is no indication to give.',
      usedMethods: [],
      skippedMethods: skipped,
    };
  }

  const weightSum = usable.reduce((n, r) => n + r.weight, 0) || 1;
  const indicated = usable.reduce((n, r) => n + r.amount! * (r.weight / weightSum), 0);

  const amounts = usable.map((r) => r.amount!);
  const lowest = Math.min(...amounts);
  const highest = Math.max(...amounts);
  // Half the spread of the approaches about the blend, floored. One approach
  // means no disagreement to measure, which is not the same as no uncertainty.
  const observed = indicated > 0 ? (highest - lowest) / 2 / indicated : 0;
  const spread = Math.max(MIN_VALUATION_SPREAD, observed);

  return {
    indicated,
    low: indicated * (1 - spread),
    high: indicated * (1 + spread),
    spreadBasis:
      usable.length === 1
        ? `One approach ran, so there is no cross-check to measure. The band is the ${(MIN_VALUATION_SPREAD * 100).toFixed(0)}% floor this product applies to any single-method indication.`
        : `${usable.length} approaches spanning ${Math.round(lowest).toLocaleString('en-IN')}–${Math.round(highest).toLocaleString('en-IN')}; the band is half that spread about the blend (${(spread * 100).toFixed(1)}%), floored at ${(MIN_VALUATION_SPREAD * 100).toFixed(0)}%.`,
    usedMethods: usable.map((r) => r.method),
    skippedMethods: skipped,
  };
}
