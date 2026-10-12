/**
 * Shapes a catalog declares often, written once.
 */

import type { CheckFieldDef, FieldSet, RefTarget, Tone } from '../types';

/**
 * One figure stated by several people, side by side: cost to complete by the
 * quantity surveyor, the engineer, the accountant and the lender's engineer.
 *
 * It is a set that repeats, one record for each person who states the
 * figure, so nobody's figure overwrites another's and each keeps its own
 * paper and date. The sheet it belongs to gets three worked-out fields and a
 * standing: the lowest, the highest, how far apart they are, and whether
 * that is inside the tolerance.
 *
 * Returns the set to add to the file's array, and the fields to spread into
 * the parent sheet's `fields`.
 */
export function statedBySeveral(input: {
  /** The id of the set that repeats: `finance.budget.cost_to_complete_stated`. */
  id: string;
  fn: string;
  /** What is stated: "Cost to complete". */
  title: string;
  /** The key the parent's fields are named from: `cost_to_complete`. */
  key: string;
  /** The figure itself, without a key: its kind, dimension, currency. */
  figure: Omit<CheckFieldDef, 'key' | 'label'>;
  /** Who states it. A party unless the catalog says otherwise. */
  source?: RefTarget;
  /** How far apart, as a share of the highest, the figures may be before the standing turns. Default 5%. */
  tolerancePct?: number;
  section?: string;
  tone?: Tone;
}): { set: FieldSet; fields: CheckFieldDef[] } {
  const tolerance = input.tolerancePct ?? 5;
  const { kind: _kind, ...shape } = input.figure;
  const derived = (key: string, label: string, reduce: 'min' | 'max'): CheckFieldDef => ({
    ...shape,
    key: `${input.key}_${key}`,
    label,
    kind: 'computed',
    formula: { op: 'records', set: input.id, reduce, field: 'figure' },
    ...(input.section ? { section: input.section } : {}),
  });
  return {
    set: {
      id: input.id,
      fn: input.fn,
      title: `${input.title}, as stated`,
      v: 1,
      records: { of: 'statement', titleField: 'source', summaryFields: ['figure', 'stated_on'] },
      fields: [
        { key: 'source', label: 'Stated by', kind: 'ref', target: input.source ?? 'party' },
        { ...input.figure, key: 'figure', label: input.title, proof: 'expected' },
        { key: 'stated_on', label: 'Stated on', kind: 'date' },
        { key: 'paper', label: 'Paper', kind: 'evidence', accepts: 'document', viewer: 'pdf', required: false },
      ],
      rules: [],
    },
    fields: [
      derived('low', `${input.title}, lowest stated`, 'min'),
      derived('high', `${input.title}, highest stated`, 'max'),
      { key: `${input.key}_spread`, label: `${input.title}, spread`, kind: 'computed', unit: '%', formula: { op: 'records', set: input.id, reduce: 'spread_pct', field: 'figure' }, ...(input.section ? { section: input.section } : {}) },
      {
        key: `${input.key}_agreement`,
        label: `${input.title}, agreement`,
        kind: 'status',
        ...(input.section ? { section: input.section } : {}),
        cases: [
          {
            when: { kind: 'compare', fields: [`${input.key}_low`, `${input.key}_high`], tolerance: tolerance / 100, say: 'The lowest stated is {a} and the highest {b}: {divergence} apart, outside {tolerance}.', severity: 'high' },
            label: 'Stated figures differ',
            tone: input.tone ?? 'critical',
          },
        ],
        otherwise: { label: 'Stated figures agree', tone: 'good' },
      },
    ],
  };
}
