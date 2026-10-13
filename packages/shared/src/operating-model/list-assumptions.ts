/**
 * A paper that will not come, and the fields it stands in for.
 *
 * A line of Papers owed marked "to be assumed" names who proceeds on an
 * assumption. Where the paper would have given a field its value, the line
 * names that field and the value assumed. The field then reads that value as
 * ASSUMED, with the line as its reason (`listAssumptions` in `checklist.ts`,
 * read by the field resolver): it feeds what is worked out, is said to be
 * assumed wherever it shows, and gives way the moment a real value is typed
 * or accepted. Nothing is written onto the field itself, so taking the line
 * back, or marking it in hand, takes the assumption away.
 *
 * Only a field a person fills with one value can be assumed: a figure, an
 * amount, a share, a span, an area, a day, a yes or no, a choice, a line.
 * The value is checked as a typed one is.
 */

import { validateFieldValue } from './check-fields';
import { markChecklistAssumed, type ChecklistItem } from './checklist';
import { optionSetById, type FieldCatalog } from './field-registry';
import { fieldCatalogFor } from './firm-fields';
import type { CheckFieldDef, DdProject, FieldAddress, FieldSet } from './types';

const ASSUMABLE: ReadonlySet<CheckFieldDef['kind']> = new Set(['text', 'number', 'money', 'area', 'percent', 'duration', 'date', 'boolean', 'enum']);

/** Whether a line may stand in for a field: one a person fills with a single value, asked today. */
export function fieldMayBeAssumed(def: CheckFieldDef): boolean {
  return ASSUMABLE.has(def.kind) && !def.sameAs && !def.retired;
}

/** The fields of a function's sheets a line may stand in for: the sheets held once, since a record is named by its own id. */
export function assumableFields(fn: string, catalog: FieldCatalog): Array<{ address: FieldAddress; set: FieldSet; def: CheckFieldDef }> {
  const out: Array<{ address: FieldAddress; set: FieldSet; def: CheckFieldDef }> = [];
  for (const set of catalog.sets.values()) {
    if (set.fn !== fn || set.records || set.extends || catalog.checks.has(set.id)) continue;
    for (const def of set.fields) if (fieldMayBeAssumed(def)) out.push({ address: { fn: set.fn, set: set.id, field: def.key }, set, def });
  }
  return out;
}

/**
 * Mark a line to be assumed, with who assumes and the fields it stands in
 * for. Each value is checked against its field; one that will not go takes
 * the whole act with it. `null` takes the line back.
 */
export function assumeChecklistItem(
  project: DdProject,
  itemId: string,
  input: { assumer: string; fields?: ReadonlyArray<{ address: FieldAddress; value: unknown }> } | null,
  actor: string,
  catalog: FieldCatalog = fieldCatalogFor(project),
): ChecklistItem {
  if (!input) return markChecklistAssumed(project, itemId, null, actor);
  const fields = (input.fields ?? []).map(({ address, value }) => {
    const set = catalog.sets.get(address.set);
    const def = set?.fields.find((field) => field.key === address.field);
    if (!set || !def || catalog.checks.has(set.id)) throw new Error('That is not a field of a sheet.');
    if (!fieldMayBeAssumed(def)) throw new Error(`${def.label} is not a field a value can be assumed for.`);
    if (set.records && !address.record) throw new Error(`${set.title} repeats: name the record whose ${def.label.toLowerCase()} is assumed.`);
    const parsed = validateFieldValue(def, value, { proposer: 'person', optionSet: (id) => optionSetById(id, catalog), state: project.jurisdiction });
    if ('error' in parsed) throw new Error(parsed.error);
    if (parsed.value === null || Array.isArray(parsed.value)) throw new Error(`Give the value ${def.label.toLowerCase()} is assumed at.`);
    return { address: { fn: set.fn, set: set.id, field: def.key, ...(address.record ? { record: address.record } : {}) }, value: parsed.value };
  });
  return markChecklistAssumed(project, itemId, { assumer: input.assumer, fields }, actor);
}
