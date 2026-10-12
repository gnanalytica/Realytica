/**
 * What the four design files share: the functions they write for, the ids of
 * the sets they read across, the two situations that belong to the whole
 * project, and a few shapes written once.
 *
 * The design department is one function in the menu and many on the record:
 * the architect's, the interior and landscape designer's, the structural
 * engineer's and the services engineer's. Each has its own sheets, and they
 * read each other here, by address.
 */

import type { CheckFieldDef, CheckFormula, CheckInsightRule, FieldAddress, RowCondition, Situation, Tone } from '../../types';

/** The functions, by the workstream each is (departments.ts). */
export const FN = {
  brief: 'design.brief',
  areas: 'design.areas',
  compliance: 'design.compliance',
  drawings: 'design.drawings',
  rfis: 'design.rfis',
  sanction: 'design.sanction',
  certificates: 'design.certificates',
  coordination: 'design.coordination',
  finishes: 'design.finishes',
  landscape: 'design.landscape',
  samples: 'design.samples',
  changes: 'design.changes',
  soil: 'design.soil',
  structure: 'design.structure',
  proof: 'design.proof',
  structuralSet: 'design.structural_set',
  electrical: 'design.electrical',
  hvac: 'design.hvac',
  water: 'design.water',
  sewage: 'design.sewage',
  fire: 'design.fire',
  lifts: 'design.lifts',
} as const;

/** The sets more than one file reads. */
export const SET = {
  brief: 'design.brief.sheet',
  unitTypes: 'design.brief.unit_types',
  statement: 'design.areas.statement',
  floors: 'design.areas.floors',
  parking: 'design.areas.parking',
  height: 'design.compliance.height',
  revisions: 'design.drawings.revisions',
  requests: 'design.rfis.requests',
  comparisons: 'design.sanction.comparisons',
  sanction: 'design.sanction.reference',
  finishItems: 'design.finishes.items',
  makes: 'design.finishes.makes',
  submittals: 'design.samples.submittals',
  changes: 'design.changes.register',
  soil: 'design.soil.report',
  bearing: 'design.soil.bearing',
  waterDemand: 'design.water.demand',
  tanks: 'design.water.tanks',
  plant: 'design.sewage.plant',
  electricalDemand: 'design.electrical.demand',
} as const;

/** The checks that already hold some of this, each in the function it sits in. */
export const TECHNICAL = 'construction.quality';
export const APPROVALS = 'legal.approvals';
export const TITLE = 'legal.title';

export const at = (fn: string, set: string, field: string): FieldAddress => ({ fn, set, field });

/** A field of this set. */
export const f = (key: string): CheckFormula => ({ op: 'field', key });
/** A field of another set, by its address. */
export const read = (address: FieldAddress): CheckFormula => ({ op: 'field', key: address.field, at: address });
export const sumOf = (set: string, field: string): CheckFormula => ({ op: 'records', set, reduce: 'sum', field });
export const countOf = (set: string): CheckFormula => ({ op: 'records', set, reduce: 'count' });
export const countWhere = (set: string, where: RowCondition): CheckFormula => ({ op: 'count_if', over: { records: set }, where });
export const sumWhere = (set: string, column: string, where: RowCondition): CheckFormula => ({ op: 'sum_if', over: { records: set }, column, where });
export const times = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'multiply', left, right });
export const over = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'divide', left, right });
export const plus = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'add', left, right });
export const minus = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'subtract', left, right });
/** How far one amount is over another, and nothing where it is not. No answer until both are known. */
export const excess = (left: CheckFormula, right: CheckFormula): CheckFormula => ({ op: 'if', when: { left, is: 'gt', right }, then: minus(left, right), else: { op: 'const', value: 0 } });
/** One amount as a share of another, in hundredths. */
export const share = (part: CheckFormula, whole: CheckFormula): CheckFormula => times(over(part, whole), { op: 'const', value: 100 });

/**
 * A measure against a limit, as a standing: the limit is not on file, the
 * measure is on the wrong side of it, or it is within. The limit is a field
 * of the same set, usually one read from the rule table or from a paper, so
 * a limit nobody has loaded says so and is never taken for a pass.
 */
export function against(input: {
  key: string;
  label: string;
  measure: string;
  limit: string;
  /** `at_most`: the measure may not pass the limit. `at_least`: it has to reach it. */
  must: 'at_most' | 'at_least';
  missing: string;
  failing: string;
  passing: string;
  say: string;
  section?: string;
  tone?: Tone;
  more?: Partial<CheckFieldDef>;
}): CheckFieldDef {
  return {
    key: input.key,
    label: input.label,
    kind: 'status',
    ...(input.section ? { section: input.section } : {}),
    cases: [
      { when: { kind: 'require', fields: [input.limit], say: `${input.missing}.`, severity: 'low' }, label: input.missing, tone: 'neutral' },
      // A limit with nothing measured against it is no pass either.
      { when: { kind: 'require', fields: [input.measure], say: 'Not recorded.', severity: 'low' }, label: 'Not recorded', tone: 'neutral' },
      { when: { kind: input.must, fields: [input.measure, input.limit], say: input.say, severity: 'high' }, label: input.failing, tone: input.tone ?? 'critical' },
    ],
    otherwise: { label: input.passing, tone: 'good' },
    ...input.more,
  };
}

/** The sentence a standing's failing case says, as a rule of the sheet, so the page's line carries the figures. */
export const saying = (kind: 'at_most' | 'at_least', measure: string, limit: string, say: string): CheckInsightRule => ({ kind, fields: [measure, limit], say, severity: 'high' });

/* ==================================================================== */
/* Situations of the whole project that the architect's sheets settle    */
/* ==================================================================== */

/** The word the height sheet's standing gives a high-rise. The situation follows from it, and nobody is asked. */
export const HIGH_RISE_LABEL = 'High-rise';

export const HIGH_RISE: Situation = {
  key: 'high_rise',
  label: 'High-rise',
  scope: 'project',
  hint: 'The building is at or above the height the code in force calls high-rise.',
  derive: { field: at(FN.compliance, SET.height, 'height_class'), is: 'equals', value: HIGH_RISE_LABEL },
};

export const MIXED_USE: Situation = {
  key: 'mixed_use',
  label: 'Mixed use',
  scope: 'project',
  hint: 'More than one use shares the plot or a building.',
  derive: { field: at(FN.brief, SET.brief, 'project_use'), is: 'equals', value: 'mixed' },
};

/** One basement or more on any building: nobody is asked. Kept by each function that names it. */
export const BASEMENT: Situation = {
  key: 'basement_or_deep_excavation',
  label: 'Basement',
  scope: 'function',
  hint: 'A building has one basement or more.',
  derive: { records: 'shared.buildings', is: 'any', where: { column: 'basements', is: 'gt', value: 0 } },
};
