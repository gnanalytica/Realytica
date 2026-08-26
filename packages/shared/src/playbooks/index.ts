/**
 * Karnataka diligence playbooks — real practitioner procedures encoded as
 * typed, gated workflows.
 *
 * Three procedures, run in the order a Bengaluru title lawyer runs them:
 *
 *  1. `karnataka_title_chain` — establish marketable title. Root of title,
 *     chain continuity across the thirty-year lookback, encumbrance coverage,
 *     registration of every link, khata lineage against deed lineage, PTCL
 *     granted-land origin, acquisition overhang.
 *  2. `karnataka_land_use` — is non-agricultural use of this land lawful?
 *     Revenue classification, the s.95 conversion order, its conditions,
 *     layout sanction, master-plan zoning, rajakaluve and lake buffers,
 *     betterment charges.
 *  3. `karnataka_khata_area` — is the record right, and does the area
 *     reconcile? Register type and the A/B classification, e-khata, holder
 *     against registered owner, area basis, assessed area against deed and
 *     plan, property tax, BBMP zone.
 *
 * The gates are the product. A step whose prerequisite is not `clear` is not
 * evaluated: it reports `blocked` and names what is holding it up, rather than
 * producing a finding it cannot support. See `run.ts` for where that is
 * enforced and `types.ts` for why the step evaluators are typed so they cannot
 * reach past it.
 */

export { runPlaybooks, playbooksApplyTo, KARNATAKA_PLAYBOOKS } from './run';
export { KARNATAKA_TITLE_CHAIN_PLAYBOOK } from './karnataka-title-chain';
export { KARNATAKA_LAND_USE_PLAYBOOK } from './karnataka-land-use';
export { KARNATAKA_KHATA_AREA_PLAYBOOK } from './karnataka-khata-area';
// Deliberately narrow. `compareAreas` and `formatSqm` are part of the area-basis
// contract and worth exposing; the date and number parsers are internal plumbing
// whose generic names would collide the moment another module wants them.
export { compareAreas, formatSqm, normaliseSurveyNumber } from './types';
export type {
  AreaComparison,
  AreaFigure,
  AreaQuantity,
  EvaluatedStepState,
  Playbook,
  PlaybookApplicability,
  PlaybookContext,
  PlaybookStep,
  StepOutcome,
  StepSeverity,
} from './types';
