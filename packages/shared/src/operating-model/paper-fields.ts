/**
 * The keys a kind of paper is read into: the field catalog's own.
 *
 * A reader left to name what it reads calls a landowner's share
 * `owner_share_percent` where the field that waits for it is `owner_share`, and
 * a value under a name nobody waits for reaches nothing. So a reader is told,
 * for the kind of paper in front of it, the key of every registered field that
 * says it is read from that kind (`fromTypes`), with the field's label, what
 * it holds and what it may be. It answers in those keys, and a value under any
 * other key is not kept: a reader may not invent one.
 *
 * The rules' standard keys (`STANDARD_FACT_KEYS`) are the same thing for the
 * land papers the rules read themselves, with a form of their own; where a
 * field's key is one of them, that form is kept.
 */

import { fieldIsDerived, fieldOptions } from './check-fields';
import { factInForm, readDocumentTypes, readTypeOfLabel, STANDARD_FACT_KEYS, standardFact, standardKeyFits, standardKeyGuide, standardValueForms, tellPaperKeys, type DocumentFact, type FactForm, type ReadDocumentType } from './document-parse';
import { fieldCatalog, optionSetById, type FieldCatalog } from './field-registry';
import type { CheckFieldDef, FieldAddress } from './types';

/** One thing a kind of paper states that a field waits for. */
export interface PaperKey {
  /** The key a reading files the value under: the field's `factKey`, or its own. */
  key: string;
  /** The field's label, with its sheet's title where the label alone says too little. */
  label: string;
  kind: CheckFieldDef['kind'];
  /** What a number is in: rupees, an area, a percentage, months. */
  unit?: string;
  /** The only values it takes, by key and label. */
  options?: Array<{ key: string; label: string }>;
  /** The field that waits for it. */
  field: FieldAddress;
}

/** The kinds of field a paper's value can be offered to: one value, typed. A table, a file and a list of ticks are not one value. */
const READ_KINDS = new Set<CheckFieldDef['kind']>(['text', 'number', 'money', 'area', 'percent', 'duration', 'date', 'boolean', 'enum', 'ref']);

/** Whether a field takes a value read off a paper at all. */
export function readsPapers(def: CheckFieldDef): boolean {
  return Boolean(def.fromTypes?.length) && !fieldIsDerived(def) && !def.retired && READ_KINDS.has(def.kind);
}

function unitOf(def: CheckFieldDef): string | undefined {
  if (def.kind === 'money') return 'rupees';
  if (def.kind === 'area') return 'an area, with its unit';
  if (def.kind === 'percent') return 'percent';
  if (def.dimension === 'length') return 'a length, with its unit';
  return def.unit;
}

const built = new WeakMap<FieldCatalog, Map<ReadDocumentType, PaperKey[]>>();

function keysByPaper(catalog: FieldCatalog): Map<ReadDocumentType, PaperKey[]> {
  let map = built.get(catalog);
  if (map) return map;
  map = new Map();
  for (const sets of catalog.sheets.values()) {
    for (const set of sets) {
      for (const def of set.fields) {
        if (!readsPapers(def)) continue;
        for (const label of def.fromTypes!) {
          const type = readTypeOfLabel(label);
          if (type === 'other') continue;
          const keys = map.get(type) ?? [];
          const key = def.factKey ?? def.key;
          // One field waits for one fact of one paper (`paperKeyClashes`); were there two, the first is the one a reader is told of.
          if (keys.some((known) => known.key === key)) continue;
          const options = def.kind === 'enum' ? fieldOptions(def, (id) => optionSetById(id, catalog)).filter((option) => !option.retired).map((option) => ({ key: option.key, label: option.label })) : undefined;
          keys.push({ key, label: `${def.label}, of ${set.title}`, kind: def.kind, ...(unitOf(def) ? { unit: unitOf(def) } : {}), ...(options?.length ? { options } : {}), field: { fn: set.fn, set: set.id, field: def.key } });
          map.set(type, keys);
        }
      }
    }
  }
  built.set(catalog, map);
  return map;
}

/** Every key a kind of paper is read into, beyond the rules' standard keys for it. `paper` is the rules' name for the kind (`sale_deed`). */
export function paperKeys(paper: string | null | undefined, catalog: FieldCatalog = fieldCatalog()): PaperKey[] {
  return keysByPaper(catalog).get(paper as ReadDocumentType) ?? [];
}

/** Whether a paper of this kind carries a key: a standard key of that paper, or one a registered field reads off it. */
export function paperKeyFits(key: string, paper: string | null | undefined, catalog: FieldCatalog = fieldCatalog()): boolean {
  return standardKeyFits(key, paper) || paperKeys(paper, catalog).some((known) => known.key === key);
}

/** The kinds of paper a reader can be asked to read into keys: each has a standard key or a field that waits. */
export function readablePapers(catalog: FieldCatalog = fieldCatalog()): ReadDocumentType[] {
  const standard = (type: ReadDocumentType) => Object.keys(STANDARD_FACT_KEYS).some((key) => standardKeyFits(key, type));
  return readDocumentTypes().map(({ type }) => type as ReadDocumentType).filter((type) => standard(type) || paperKeys(type, catalog).length > 0);
}

const FORM: Partial<Record<CheckFieldDef['kind'], FactForm>> = {
  text: 'words',
  ref: 'words',
  number: 'number',
  percent: 'number',
  duration: 'number',
  money: 'rupees',
  area: 'sqm',
  date: 'date',
  boolean: 'yes_no',
};

/** The longest a value kept as words may be: a name, a number, a place. A sentence is not a value. */
const WORDS_MOST = 120;

const bare = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');

/**
 * A value a reader gave under a key, as the fact it is kept as: under the
 * catalog's name for it and in the form its field holds. Null where the paper
 * does not carry the key, or the value cannot be put in that form.
 */
export function paperFact(paper: string | null | undefined, key: string, value: string, unit?: string | null, catalog: FieldCatalog = fieldCatalog()): Pick<DocumentFact, 'label' | 'value' | 'unit' | 'display'> | null {
  if (standardKeyFits(key, paper)) return standardFact(key, value, unit);
  const known = paperKeys(paper, catalog).find((candidate) => candidate.key === key);
  if (!known) return null;
  const label = known.label.replace(/, of .*$/, '');
  // One of the rules' keys read off a paper the rules do not read it from: in the rules' own form for it.
  if (STANDARD_FACT_KEYS[key]) {
    const fact = standardFact(key, value, unit);
    return fact ? { ...fact, label } : null;
  }
  if (known.kind === 'enum') {
    const said = bare(value);
    const chosen = said ? (known.options ?? []).find((option) => bare(option.key) === said || bare(option.label) === said) : undefined;
    return chosen ? { label, value: chosen.key, display: chosen.label } : null;
  }
  const form = FORM[known.kind];
  if (!form) return null;
  const fact = factInForm(label, form, value, unit);
  if (!fact) return null;
  if (form === 'words' && String(fact.value).length > WORDS_MOST) return null;
  // A length is kept as the paper writes it: the field converts what it is given.
  if (known.kind === 'number' && unit && /^(?:m|ft|feet|met(?:re|er)s?)$/i.test(unit.trim())) return { ...fact, unit: unit.trim(), display: `${fact.display} ${unit.trim()}` };
  return fact;
}

/**
 * The keys as a reader is told them: the rules' standard keys for the land
 * papers, then, paper by paper, the key of every field that waits for
 * something that kind of paper states.
 */
export function paperKeyGuide(catalog: FieldCatalog = fieldCatalog()): string {
  const labels = new Map(readDocumentTypes().map(({ type, label }) => [type as ReadDocumentType, label]));
  const lines: string[] = [];
  for (const paper of readablePapers(catalog)) {
    const keys = paperKeys(paper, catalog).filter((known) => !standardKeyFits(known.key, paper));
    if (!keys.length) continue;
    lines.push(`  - ${paper} (${labels.get(paper)}):`);
    for (const known of keys) {
      const takes = known.options ? `one of: ${known.options.map((option) => option.label).join(', ')}` : known.kind === 'date' ? 'a date' : known.kind === 'boolean' ? 'yes or no' : known.kind === 'text' || known.kind === 'ref' ? 'as written' : (known.unit ?? 'a number');
      lines.push(`      ${known.key}: ${known.label}; ${takes}`);
    }
  }
  return [
    standardKeyGuide(),
    '  Fields that wait for a value, by the paper that states it. Where the document is one of these papers, record each of the ' +
      'things below that it states under exactly that key, with the page and the exact words. ' +
      standardValueForms(),
    ...lines,
  ].join('\n');
}

/* ==================================================================== */
/* What the catalog test holds the catalog to                            */
/* ==================================================================== */

/** Every `fromTypes` entry that names a kind of paper no classifier can produce. */
export function unknownPaperKinds(catalog: FieldCatalog = fieldCatalog()): string[] {
  const out: string[] = [];
  for (const sets of catalog.sheets.values()) {
    for (const set of sets) {
      for (const def of set.fields) {
        for (const label of def.fromTypes ?? []) if (readTypeOfLabel(label) === 'other') out.push(`${set.id}/${def.key}: reads "${label}", which is no kind of paper the register has.`);
      }
    }
  }
  return out;
}

/** The kinds of paper the register has that no field reads a value from. Not a fault: a list to work down. */
export function papersNoFieldReads(catalog: FieldCatalog = fieldCatalog()): string[] {
  const read = keysByPaper(catalog);
  return readDocumentTypes().filter(({ type }) => !read.get(type)?.length).map(({ label }) => label);
}

/**
 * Every fact of a kind of paper that two fields wait for. A value read from a
 * paper is offered once, on the function that owns the fact; the second place
 * it appears is a mirror (`sameAs`), never a second value to accept.
 */
export function paperKeyClashes(catalog: FieldCatalog = fieldCatalog()): string[] {
  const readers = new Map<string, string[]>();
  for (const sets of catalog.sheets.values()) {
    for (const set of sets) {
      for (const def of set.fields) {
        if (!readsPapers(def)) continue;
        for (const label of def.fromTypes!) {
          const at = `${label} › ${def.factKey ?? def.key}`;
          readers.set(at, [...(readers.get(at) ?? []), `${set.id}/${def.key}`]);
        }
      }
    }
  }
  return [...readers].filter(([, fields]) => fields.length > 1).map(([at, fields]) => `${at} is read by ${fields.join(' and ')}.`);
}

// A paper's row carries a key some registered field reads off that kind of paper (`paperCarries`).
tellPaperKeys((type, key) => paperKeys(type).some((known) => known.key === key));
