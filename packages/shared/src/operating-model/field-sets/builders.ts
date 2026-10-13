/**
 * Shapes a catalog declares often, written once.
 */

import type { CheckFieldDef, CheckInsightRule, FieldAddress, FieldReportTemplate, FieldSection, FieldSet, RefTarget, Tone } from '../types';

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

/**
 * What one set of a file reads from another department.
 *
 * A department declares its own facts in its sets. Where one of its sets
 * needs a fact another department owns, it does not hold it a second time:
 * it mirrors the owner's field, links to the owner's record, works a figure
 * out from the owner's records, or holds its own figure to the owner's with
 * a rule. Those readings are declared together, in the reader's file, as one
 * list of these, so what a department takes from the others can be read in
 * one place and none of it is a second box to type in.
 */
export interface SetLinks {
  /** The set of this file the links belong to. */
  set: string;
  /** Sections the added fields sit in, where the set has none for them. */
  sections?: FieldSection[];
  /** Fields added: a mirror (`sameAs`), a link (`ref`) or a figure worked out from the owner's fields. */
  fields?: CheckFieldDef[];
  /** A field the set already declares, given again as a reading of its owner: same key, never a typed kind. */
  replace?: CheckFieldDef[];
  /** A mirror the set already declares, pointed at the field its owner now keeps. */
  repoint?: Record<string, FieldAddress>;
  /** Rules that hold a figure of this set to another department's (`at`). */
  rules?: CheckInsightRule[];
  /** Reports the set's function hands over that are put together from several sets, its own and others'. */
  reports?: FieldReportTemplate[];
}

/** A file's sets with its links to other departments laid in. A link that names a set or a field that is not there stops the build. */
export function withLinks(sets: readonly FieldSet[], links: readonly SetLinks[]): FieldSet[] {
  const out = sets.map((set) => ({ ...set }));
  for (const link of links) {
    const set = out.find((held) => held.id === link.set);
    if (!set) throw new Error(`A link names the set "${link.set}", which this file does not declare.`);
    const keys = new Set(set.fields.map((def) => def.key));
    for (const def of link.fields ?? []) if (keys.has(def.key)) throw new Error(`${link.set}/${def.key}: a link adds a field the set already has.`);
    for (const def of link.replace ?? []) {
      if (!keys.has(def.key)) throw new Error(`${link.set}/${def.key}: a link replaces a field the set does not have.`);
      if (!def.sameAs && def.kind !== 'computed' && def.kind !== 'ref' && def.kind !== 'status') throw new Error(`${link.set}/${def.key}: a link replaces a field with a reading of its owner, never with another box to type in.`);
    }
    for (const key of Object.keys(link.repoint ?? {})) if (!set.fields.find((def) => def.key === key)?.sameAs) throw new Error(`${link.set}/${key}: only a mirror can be pointed at another field.`);
    const replaced = new Map((link.replace ?? []).map((def) => [def.key, def]));
    set.fields = [...set.fields.map((def) => replaced.get(def.key) ?? (link.repoint?.[def.key] ? { ...def, sameAs: link.repoint[def.key] } : def)), ...(link.fields ?? [])];
    if (link.sections?.length) set.sections = [...(set.sections ?? []), ...link.sections];
    if (link.rules?.length) set.rules = [...set.rules, ...link.rules];
    if (link.reports?.length) set.reports = [...(set.reports ?? []), ...link.reports];
  }
  return out;
}
