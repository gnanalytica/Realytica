/**
 * A firm's own fields, laid over the built-in catalog.
 *
 * The built-in catalog is code: typed, tested, and carrying the standards
 * work. A firm adds to it as data, with a narrow power.
 *
 * - It **adds** fields to a built-in set, and option sets for them to choose
 *   from. An added field is one a person fills: a line, a figure, a date, a
 *   choice, bounded words. Never one that is worked out, mirrored or linked.
 * - It **demotes** a built-in field to expert: folded under "More", never
 *   counted, still there the moment it holds a value.
 * - It may not hide a built-in field, change what one holds, or take its key.
 *   The shape below has no way to say any of those, and a key the firm adds
 *   starts with `firm_`, which no built-in key does.
 *
 * Taking an added field away deletes nothing: what projects saved under its
 * key is kept and shown as no longer asked (`SheetReading.unasked`).
 *
 * The overlay is the firm's, so it is kept at firm level and installed by
 * whoever holds the firm's settings (`installFirmFields`). Every reader of a
 * project's fields asks for the catalog through `fieldCatalogFor`, which
 * gives the firm's where one is installed and the built-in one where not.
 */

import { buildFieldCatalog, fieldCatalog, type FieldCatalog } from './field-registry';
import { FIELD_SETS } from './field-sets';
import type { CheckFieldDef, CheckFieldKind, DdProject, FieldSet, FieldTier, OptionSet } from './types';

/** One field a firm adds to a built-in set. */
export interface FirmField {
  set: string;
  field: CheckFieldDef;
}

export interface FirmFieldPack {
  v: number;
  optionSets: OptionSet[];
  add: FirmField[];
  /** Built-in fields folded as expert, by set and key. */
  demote: Array<{ set: string; field: string }>;
  updatedAt?: string;
  updatedBy?: string;
}

export const EMPTY_FIRM_FIELDS: FirmFieldPack = { v: 1, optionSets: [], add: [], demote: [] };

/** What a firm's own field may be: something a person fills. */
export const FIRM_FIELD_KINDS: readonly CheckFieldKind[] = ['text', 'number', 'money', 'percent', 'date', 'boolean', 'enum', 'multi_enum', 'longtext'];

export const FIRM_FIELD_KIND_LABEL: Partial<Record<CheckFieldKind, string>> = {
  text: 'One line',
  number: 'Figure',
  money: 'Amount',
  percent: 'Percentage',
  date: 'Date',
  boolean: 'Yes or no',
  enum: 'One of a list',
  multi_enum: 'Several of a list',
  longtext: 'A person’s words',
};

/** Every key and id a firm adds starts with this, so it can never meet a built-in one. */
export const FIRM_KEY_PREFIX = 'firm_';
/** The most fields a firm may add to one set, and the most it may add in all. */
export const FIRM_FIELDS_A_SET = 8;
export const FIRM_FIELDS_MOST = 60;
export const FIRM_LABEL_MOST = 60;
export const FIRM_OPTIONS_MOST = 20;
/** The most a firm's prose field may take. */
export const FIRM_LONGTEXT_MOST = 600;

const KEY = /^firm_[a-z0-9]+(?:_[a-z0-9]+)*$/;

/** A label as the key it is kept under: `Broker’s name` is `firm_brokers_name`. */
export function firmKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 34);
  return slug ? `${FIRM_KEY_PREFIX}${slug}` : '';
}

/** The built-in sets a firm may add to: every sheet and every set of records, never a check and never a set that only extends another. */
export function firmSets(sheets: readonly FieldSet[] = FIELD_SETS): FieldSet[] {
  return sheets.filter((set) => !set.extends);
}

/** A field as a firm may declare one: its own members only, whatever else it was sent. */
function firmFieldOf(field: CheckFieldDef): CheckFieldDef {
  const tier: FieldTier = field.tier === 'expert' ? 'expert' : 'core';
  return {
    key: field.key,
    label: String(field.label ?? '').trim(),
    kind: field.kind,
    // A firm's field is never one a sheet waits for: it can be left empty.
    required: false,
    tier,
    firm: true,
    ...(field.section ? { section: field.section } : {}),
    ...(field.unit && (field.kind === 'number' || field.kind === 'money') ? { unit: String(field.unit).slice(0, 12) } : {}),
    ...(field.kind === 'money' ? { currency: field.currency ?? 'INR' } : {}),
    ...(field.optionSet && (field.kind === 'enum' || field.kind === 'multi_enum') ? { optionSet: field.optionSet } : {}),
    ...(field.kind === 'longtext' ? { maxLength: Math.min(FIRM_LONGTEXT_MOST, Math.max(1, Math.round(Number(field.maxLength) || 300))) } : {}),
    ...(field.retired ? { retired: true as const } : {}),
  };
}

/** A pack as it was kept, with whatever is not a pack's left out. Anything that is not one at all reads as empty. */
export function firmFieldsHeld(raw: unknown): FirmFieldPack {
  if (!raw || typeof raw !== 'object') return EMPTY_FIRM_FIELDS;
  const kept = raw as Partial<FirmFieldPack>;
  const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  return {
    v: typeof kept.v === 'number' ? kept.v : 1,
    optionSets: list<OptionSet>(kept.optionSets)
      .filter((set) => set && typeof set.id === 'string' && Array.isArray(set.options))
      .map((set) => ({ id: set.id, label: String(set.label ?? '').trim(), options: set.options.filter((o) => o && typeof o.key === 'string').map((o) => ({ key: o.key, label: String(o.label ?? o.key).trim(), ...(o.retired ? { retired: true as const } : {}) })) })),
    add: list<FirmField>(kept.add)
      .filter((row) => row && typeof row.set === 'string' && row.field && typeof row.field.key === 'string')
      .map((row) => ({ set: row.set, field: firmFieldOf(row.field) })),
    demote: list<{ set: string; field: string }>(kept.demote).filter((row) => row && typeof row.set === 'string' && typeof row.field === 'string').map((row) => ({ set: row.set, field: row.field })),
    ...(typeof kept.updatedAt === 'string' ? { updatedAt: kept.updatedAt } : {}),
    ...(typeof kept.updatedBy === 'string' ? { updatedBy: kept.updatedBy } : {}),
  };
}

/**
 * Everything wrong with a firm's pack, each in a sentence. Empty for one
 * that may be saved. What a firm may not do is refused here: take a built-in
 * key (which would re-type the field), add a field nobody fills, demote the
 * field a record is named by.
 */
export function firmFieldFaults(pack: FirmFieldPack, sheets: readonly FieldSet[] = FIELD_SETS): string[] {
  const faults: string[] = [];
  const open = new Map(firmSets(sheets).map((set) => [set.id, set]));
  const lists = new Set<string>();
  for (const list of pack.optionSets) {
    if (!KEY.test(list.id)) faults.push(`A list’s id starts with "${FIRM_KEY_PREFIX}" and is lower case: "${list.id}" is not.`);
    if (lists.has(list.id)) faults.push(`Two lists are called "${list.id}".`);
    lists.add(list.id);
    if (!list.label) faults.push(`The list "${list.id}" needs a name.`);
    if (!list.options.length) faults.push(`${list.label || list.id} needs at least one choice.`);
    if (list.options.length > FIRM_OPTIONS_MOST) faults.push(`${list.label || list.id} has ${list.options.length} choices; ${FIRM_OPTIONS_MOST} at most.`);
    const keys = new Set<string>();
    for (const option of list.options) {
      if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(option.key)) faults.push(`${list.label || list.id}: a choice’s key is lower case with underscores, and "${option.key}" is not.`);
      if (keys.has(option.key)) faults.push(`${list.label || list.id}: "${option.key}" is there twice.`);
      keys.add(option.key);
      if (/^(?:n\/?a|not applicable|unknown|not known)$/i.test(option.label.trim())) faults.push(`${list.label || list.id}: "${option.label}" is not a choice. Not applicable is a state of the field, and unknown is the field left empty.`);
    }
  }
  if (pack.add.length > FIRM_FIELDS_MOST) faults.push(`${pack.add.length} fields added; ${FIRM_FIELDS_MOST} at most.`);
  const added = new Map<string, number>();
  const seen = new Set<string>();
  for (const { set: id, field } of pack.add) {
    const set = open.get(id);
    const name = field.label || field.key;
    if (!set) {
      faults.push(`${name}: "${id}" is not a set a firm adds to.`);
      continue;
    }
    added.set(id, (added.get(id) ?? 0) + 1);
    if (!KEY.test(field.key)) faults.push(`${name}: a field’s key starts with "${FIRM_KEY_PREFIX}" and is lower case, so it never takes a built-in field’s.`);
    if (seen.has(`${id}::${field.key}`)) faults.push(`${name}: ${set.title} already has a field of this key.`);
    seen.add(`${id}::${field.key}`);
    if (set.fields.some((held) => held.key === field.key) || (set.sheets ?? []).some((sheet) => sheet.fields.some((held) => held.key === field.key))) faults.push(`${name}: ${set.title} has a built-in field of this key, and a firm does not change what one holds.`);
    if (!field.label) faults.push(`${field.key}: a field needs a label.`);
    if (field.label.length > FIRM_LABEL_MOST) faults.push(`${name}: a label takes ${FIRM_LABEL_MOST} characters at most.`);
    if (!FIRM_FIELD_KINDS.includes(field.kind)) faults.push(`${name}: a firm’s field is one a person fills. "${field.kind}" is not.`);
    if ((field.kind === 'enum' || field.kind === 'multi_enum') && !(field.optionSet && lists.has(field.optionSet))) faults.push(`${name}: a choice needs one of the firm’s lists.`);
    if (field.section && !(set.sections ?? []).some((section) => section.key === field.section)) faults.push(`${name}: ${set.title} has no section "${field.section}".`);
  }
  for (const [id, count] of added) if (count > FIRM_FIELDS_A_SET) faults.push(`${open.get(id)!.title}: ${count} fields added; ${FIRM_FIELDS_A_SET} at most on one set.`);
  const folded = new Set<string>();
  for (const { set: id, field: key } of pack.demote) {
    const set = open.get(id);
    const def = set?.fields.find((held) => held.key === key);
    if (!set || !def) faults.push(`"${id}/${key}" is not a built-in field.`);
    else if (set.records?.titleField === key) faults.push(`${def.label} is what a ${set.records.of} is named by, and stays where it is.`);
    if (folded.has(`${id}::${key}`)) faults.push(`"${id}/${key}" is folded twice.`);
    folded.add(`${id}::${key}`);
  }
  return faults;
}

/** The built-in sets with a firm's pack laid over them. What the pack names that is not there is left out, never an error: a build may be older than the pack. */
export function applyFirmFields(sheets: readonly FieldSet[], pack: FirmFieldPack | undefined): readonly FieldSet[] {
  if (!pack || (!pack.add.length && !pack.demote.length)) return sheets;
  const lists = new Map(pack.optionSets.map((list) => [list.id, list]));
  return sheets.map((set) => {
    if (set.extends) return set;
    const adds = pack.add
      .filter((row) => row.set === set.id && FIRM_FIELD_KINDS.includes(row.field.kind) && KEY.test(row.field.key) && !set.fields.some((held) => held.key === row.field.key))
      .filter((row, index, all) => all.findIndex((other) => other.field.key === row.field.key) === index)
      .map((row) => firmFieldOf(row.field))
      // A choice whose list is gone cannot be drawn; a section that is gone leaves the field at the top.
      .filter((field) => (field.kind !== 'enum' && field.kind !== 'multi_enum') || (field.optionSet && lists.has(field.optionSet)))
      .map((field) => (field.section && !(set.sections ?? []).some((section) => section.key === field.section) ? { ...field, section: undefined } : field));
    const demoted = new Set(pack.demote.filter((row) => row.set === set.id && set.records?.titleField !== row.field).map((row) => row.field));
    if (!adds.length && !demoted.size) return set;
    const used = [...new Set(adds.flatMap((field) => (field.optionSet ? [field.optionSet] : [])))].map((id) => lists.get(id)!);
    return {
      ...set,
      fields: [...set.fields.map((def): CheckFieldDef => (demoted.has(def.key) ? { ...def, tier: 'expert' } : def)), ...adds],
      ...(used.length ? { optionSets: [...(set.optionSets ?? []), ...used.filter((list) => !(set.optionSets ?? []).some((held) => held.id === list.id))] } : {}),
    };
  });
}

/* ==================================================================== */
/* The firm's catalog                                                    */
/* ==================================================================== */

/** The slot a pack is installed under where the firm is not named: what a project that names no firm reads. */
const ANY_FIRM = '*';
const installed = new Map<string, { pack: FirmFieldPack; catalog?: FieldCatalog }>();
let version = 0;

/**
 * Installs a firm's pack, or takes it away with none. `firm` is the firm's
 * id as a project carries it (`tenantId`); without it the pack is the one a
 * project that names no firm reads. One firm's pack is never another's.
 */
export function installFirmFields(firm: string | undefined, pack: FirmFieldPack | undefined): void {
  const slot = firm ?? ANY_FIRM;
  const held = installed.get(slot);
  if (!pack || (!pack.add.length && !pack.demote.length)) {
    if (held) {
      installed.delete(slot);
      version += 1;
    }
    return;
  }
  if (held && JSON.stringify(held.pack) === JSON.stringify(pack)) return;
  installed.set(slot, { pack });
  version += 1;
}

/** Counts every change to what is installed, so a screen that read the catalog knows to read it again. */
export function firmFieldsVersion(): number {
  return version;
}

/** The pack installed for a project's firm, where there is one. */
export function firmFieldsFor(project?: Pick<DdProject, 'tenantId'>): FirmFieldPack | undefined {
  return installed.get(project?.tenantId ?? ANY_FIRM)?.pack;
}

/**
 * The catalog a project's fields are read by: the built-in one, with its
 * firm's fields where the firm has added any. Built once for each pack.
 */
export function fieldCatalogFor(project?: Pick<DdProject, 'tenantId'>): FieldCatalog {
  const slot = installed.get(project?.tenantId ?? ANY_FIRM);
  if (!slot) return fieldCatalog();
  slot.catalog ??= buildFieldCatalog(applyFirmFields(FIELD_SETS, slot.pack));
  return slot.catalog;
}
