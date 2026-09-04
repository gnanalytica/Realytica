/**
 * What the file already knows, offered as a starting value.
 *
 * ## Why this exists, and why it is not "AI filling the form"
 *
 * A new project reports "no approach had all of its inputs" four times over,
 * and several of the cells it is waiting on are quantities this deployment
 * already holds: the locality's median rate, its replacement cost, the land
 * rate, the built-up area on the project itself, the acquisition cost implied
 * by the state pack's own duty and registration figures.
 *
 * Making somebody retype a number the system is already storing is not rigour,
 * it is friction wearing rigour's clothes. So the sheet proposes them.
 *
 * ## The rule every suggestion here obeys
 *
 * **A suggestion names where it came from.** Every entry carries a `basis`
 * sentence and a `source` kind, and the sheet shows them — a proposed value
 * that cannot say why is indistinguishable from a guess, and this product's
 * whole position is that those are different things.
 *
 * **A suggestion is not a recorded value.** Nothing here is written to the
 * project. It lives in the interface until a person accepts it, and until then
 * it does not count toward completeness or confidence. A screen that scored
 * itself on its own proposals would be marking its own homework.
 *
 * ## What is deliberately NOT suggested
 *
 * - **The capitalisation rate.** The obvious source is `grossYield`, and the
 *   schema's own hint says why that is wrong: it is the rate NET income is
 *   capitalised at, and a gross yield would overstate the value by the whole
 *   of the outgoings. A plausible-looking wrong number is worse here than an
 *   empty cell.
 * - **GDV, construction cost, developer's profit.** Appraisal judgements with
 *   no defensible source on the file. A residual is the number a developer
 *   bids with; proposing its three largest inputs from nothing would be
 *   inventing the answer and calling it a default.
 */

import type { LocalityReference, StatePack } from '../types';
import type { DdProject } from './types';

/** Where a proposed value came from. Ordered loosely by how much it is worth. */
export type SuggestionSource =
  /** A figure held in the locality reference data for this deployment. */
  | 'reference'
  /** Derived from the state pack's own statutory figures. */
  | 'pack'
  /** Already recorded elsewhere on this project. */
  | 'project'
  /** A stated professional convention, named in the field's own hint. */
  | 'convention';

export interface FieldSuggestion {
  /** The check this belongs to. */
  definitionId: string;
  /** The field within it. */
  key: string;
  value: number;
  /** Why this number and not another, in one line. Shown beside the cell. */
  basis: string;
  source: SuggestionSource;
}

/**
 * Expected total life for a framed residential building, in years.
 *
 * Not invented here: the `expected_life_years` hint already states it — "RCC
 * framed residential is conventionally taken at 60 years unless the condition
 * survey says otherwise" — and a convention the product already writes down is
 * a convention it can offer.
 */
const RCC_EXPECTED_LIFE_YEARS = 60;

/** Months in a year, named because it appears inside a rent conversion. */
const MONTHS = 12;

/**
 * Every input this file could reasonably start from.
 *
 * Returns only fields that have a defensible source. A short list is the point:
 * the cells left empty are the ones that genuinely need a person, and padding
 * the list would hide them.
 */
export function suggestValuationInputs(
  project: DdProject,
  locality: LocalityReference | undefined,
  statePack: StatePack | undefined,
): FieldSuggestion[] {
  const out: FieldSuggestion[] = [];
  const add = (
    definitionId: string,
    key: string,
    value: number | null | undefined,
    basis: string,
    source: SuggestionSource,
  ): void => {
    if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return;
    out.push({ definitionId, key, value: Math.round(value * 100) / 100, basis, source });
  };

  const where = locality ? `${locality.locality}, ${locality.city}` : 'the locality';

  /* ---- comparable ---------------------------------------------------- */

  add(
    'indicative_valuation.comparable_inputs',
    'rate_per_sqm',
    locality?.medianPricePerSqm,
    `Median transacted rate for ${where}. A locality median is a market observation nobody inspected for this asset — record the basis as such if you keep it.`,
    'reference',
  );

  /* ---- depreciated replacement cost ---------------------------------- */

  add(
    'indicative_valuation.cost_inputs',
    'replacement_rate',
    locality?.replacementCostPerSqm,
    `Construction cost per sqm carried for ${where}.`,
    'reference',
  );
  add(
    'indicative_valuation.cost_inputs',
    'land_rate_per_sqm',
    locality?.medianLandRatePerSqm,
    `Median transacted LAND rate for ${where}, per sqm of plot — not the built-up rate.`,
    'reference',
  );
  add(
    'indicative_valuation.cost_inputs',
    'expected_life_years',
    RCC_EXPECTED_LIFE_YEARS,
    'The convention for RCC framed residential, as this field’s own guidance states. A condition survey overrides it.',
    'convention',
  );

  /* ---- income --------------------------------------------------------- */

  // The lettable area is on the project already; asking for it again is asking
  // somebody to copy a number across two screens.
  add(
    'indicative_valuation.income_inputs',
    'let_area',
    project.builtUpAreaSqm,
    'The built-up area recorded on this project.',
    'project',
  );
  // Rent implied by the locality's own median price and gross yield. Offered
  // as a starting rent, NOT as a cap rate — see the note at the top.
  if (locality && locality.medianPricePerSqm > 0 && locality.grossYield > 0) {
    add(
      'indicative_valuation.income_inputs',
      'achievable_rent',
      (locality.medianPricePerSqm * locality.grossYield) / MONTHS,
      `Implied by ${where}’s median rate and its ${(locality.grossYield * 100).toFixed(1)}% gross yield. A starting figure — a rent roll or a lease beats it.`,
      'reference',
    );
  }

  /* ---- residual ------------------------------------------------------- */

  /*
   * Acquisition costs computed from the pack rather than typed from memory.
   *
   * Duty at the top band, plus cess and surcharge on that duty, plus the
   * registration fee — the same arithmetic `computeTransactionCosts` performs,
   * expressed as a percentage of the land value it is charged on. The residual
   * field's own hint says "around 5.6% + 1%", and this is that sentence
   * computed from the figures actually in force rather than restated.
   */
  if (statePack) {
    const slabs = statePack.stampDutySlabs.value;
    const topRate = slabs.find((slab) => slab.upTo === null)?.pct ?? slabs[slabs.length - 1]?.pct;
    if (topRate !== undefined) {
      const cess = statePack.stampDutyCessPct.value;
      const surcharge = statePack.stampDutySurchargePct.value;
      const registration = statePack.registrationFeePct.value;
      const total = topRate * (1 + cess / 100 + surcharge / 100) + registration;
      add(
        'indicative_valuation.residual_inputs',
        'land_acquisition_pct',
        total,
        `${topRate}% duty plus ${cess}% cess and ${surcharge}% surcharge on that duty, plus ${registration}% registration — from the ${statePack.state} pack, as of ${statePack.stampDutySlabs.asOf}.`,
        'pack',
      );
    }
  }

  return out;
}

/** The suggestions for one check, keyed by field. */
export function suggestionsFor(
  suggestions: readonly FieldSuggestion[],
  definitionId: string,
): Map<string, FieldSuggestion> {
  const out = new Map<string, FieldSuggestion>();
  for (const s of suggestions) if (s.definitionId === definitionId) out.set(s.key, s);
  return out;
}
