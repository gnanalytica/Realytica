/**
 * The catalog of fields: every check's, and every field set declared under
 * `field-sets/`, read through one door.
 *
 * A check's fields are one holder and a function's sheet is another. Both are
 * a `FieldSet` here, so an address, a formula, a mirror and a tool name a
 * field the same way wherever it is kept. Today's check schemas are exposed
 * unchanged: the set's id is the check definition's id, and its function is
 * the workstream the check sits in.
 *
 * The catalog is built on first use, not as this file loads: it reads the
 * check library and the departments, and both read other things.
 */

import { CHECK_CONDITIONS, CHECK_SITUATIONS } from './check-conditions';
import { CHECK_DEFINITIONS } from './libraries';
import { SUB_STAGES, workstreamDefinition, workstreamOfCheck } from './departments';
import { PROJECT_FIGURES } from './field-figures';
import { FIELD_SETS, RULE_ROWS, RULE_SHAPES } from './field-sets';
import { SHARED_FN, SHARED_RECORD_SETS } from './field-sets/shared-records';
import { ruleRowFaults } from './rule-tables';
import type { CheckFieldDef, CheckFormula, DepthSheet, FieldAddress, FieldSet, FormulaCondition, FormulaRows, LifecycleStage, MatchList, MatchSide, OptionSet, RefTarget, RuleRow, ShowWhen, Situation } from './types';

export interface FieldCatalog {
  /** Every set by id: checks and sheets. */
  sets: ReadonlyMap<string, FieldSet>;
  /** The sheets of each function, in the order they were registered. Checks are not sheets. */
  sheets: ReadonlyMap<string, FieldSet[]>;
  /** Which sets are a check's. */
  checks: ReadonlySet<string>;
  optionSets: ReadonlyMap<string, OptionSet>;
  situations: ReadonlyMap<string, Situation>;
  /** The check sets of each function, by id: what its check screens record. */
  checkSets: ReadonlyMap<string, string[]>;
  /** The sets by which each function adds its own facts to a shared record. */
  extending: ReadonlyMap<string, FieldSet[]>;
}

/** Both conditions, where there are two. */
function both(a: ShowWhen, b: ShowWhen | undefined): ShowWhen {
  return b ? { all: [a, b] } : a;
}

/**
 * A set with its depth sheets laid out as fields of its own: each carries the
 * sheet it belongs to and shows only while the sheet does. They are kept on
 * the holder the sheet opens from, so an address, a formula and a proposal
 * name one as they name any field of the set.
 */
export function withDepthSheets(set: FieldSet): FieldSet {
  if (!set.sheets?.length) return set;
  return {
    ...set,
    fields: [
      ...set.fields,
      ...set.sheets.flatMap((sheet) =>
        sheet.fields.map((def): CheckFieldDef => {
          const section = (sheet.sections ?? []).find((held) => held.key === def.section);
          return { ...def, sheet: sheet.id, tier: def.tier ?? section?.tier ?? 'situational', showWhen: both(both(sheet.showWhen, section?.showWhen), def.showWhen) };
        }),
      ),
    ],
    rules: [...set.rules, ...set.sheets.flatMap((sheet) => sheet.rules.map((rule) => ({ ...rule, sheet: sheet.id, when: both(sheet.showWhen, rule.when) })))],
  };
}

/** A depth sheet of a set, by id. */
export function depthSheet(set: FieldSet, id: string | undefined): DepthSheet | undefined {
  return id ? set.sheets?.find((sheet) => sheet.id === id) : undefined;
}

/** The catalog made of the checks and these sheets. Pure, so a test can ask it of sheets of its own. */
export function buildFieldCatalog(declared: readonly FieldSet[]): FieldCatalog {
  const sheets = declared.map(withDepthSheets);
  const sets = new Map<string, FieldSet>();
  const checks = new Set<string>();
  const checkSets = new Map<string, string[]>();
  const situations = new Map<string, Situation>();
  for (const definition of CHECK_DEFINITIONS) {
    if (!definition.fields?.length) continue;
    const fn = workstreamOfCheck(definition.id);
    // A check whose fields are only asked in a situation: each takes the check's condition where it has none of its own.
    const when = CHECK_CONDITIONS[definition.id];
    const fields = when ? definition.fields.map((def): CheckFieldDef => (def.showWhen ? def : { ...def, showWhen: when, tier: def.tier ?? 'situational' })) : definition.fields;
    sets.set(definition.id, { id: definition.id, fn, title: definition.title, v: 1, fields, rules: definition.insightRules ?? [] });
    checks.add(definition.id);
    checkSets.set(fn, [...(checkSets.get(fn) ?? []), definition.id]);
  }
  for (const { fn, situations: declaredFor } of CHECK_SITUATIONS) {
    for (const situation of declaredFor) situations.set(situationKey(situation, fn), situation);
  }
  const byFn = new Map<string, FieldSet[]>();
  const optionSets = new Map<string, OptionSet>();
  for (const set of sheets) {
    if (!set.extends) {
      if (!sets.has(set.id)) sets.set(set.id, set);
      byFn.set(set.fn, [...(byFn.get(set.fn) ?? []), set]);
    }
    for (const list of set.optionSets ?? []) if (!optionSets.has(list.id)) optionSets.set(list.id, list);
    for (const situation of set.situations ?? []) {
      const key = situationKey(situation, set.fn);
      if (!situations.has(key)) situations.set(key, situation);
    }
  }
  // A set that extends another adds its fields to it: one record, every department's facts about it.
  const extending = new Map<string, FieldSet[]>();
  for (const extra of sheets) {
    const target = extra.extends ? sets.get(extra.extends) : undefined;
    if (!target || checks.has(target.id)) continue;
    const merged: FieldSet = {
      ...target,
      // Each added field says which function added it, so that function's page shows its own facts of the record and not every department's.
      fields: [...target.fields, ...extra.fields.filter((def) => !target.fields.some((held) => held.key === def.key)).map((def): CheckFieldDef => ({ ...def, addedBy: extra.fn }))],
      rules: [...target.rules, ...extra.rules],
      sections: [...(target.sections ?? []), ...(extra.sections ?? []).filter((section) => !(target.sections ?? []).some((held) => held.key === section.key))],
    };
    sets.set(target.id, merged);
    extending.set(extra.fn, [...(extending.get(extra.fn) ?? []), extra]);
    byFn.set(target.fn, (byFn.get(target.fn) ?? []).map((held) => (held.id === target.id ? merged : held)));
  }
  return { sets, sheets: byFn, checks, optionSets, situations, checkSets, extending };
}

/** Every list a match table pairs: its left, its right, and any further ones. */
export function matchSides(def: Pick<CheckFieldDef, 'match'>): MatchSide[] {
  return def.match ? [def.match.left, def.match.right, ...(def.match.also ?? [])] : [];
}

/** Whether nobody fills a field: it is worked out, a standing, or a mirror. */
function fieldIsWorkedOut(def: CheckFieldDef): boolean {
  return def.kind === 'computed' || def.kind === 'status' || Boolean(def.sameAs);
}

/** The set that repeats a `ref` links to, where its target is one: a shared record's, or the set it names. */
export function refSet(target: RefTarget | undefined): string | undefined {
  if (!target) return undefined;
  if (typeof target === 'object') return target.set;
  return (SHARED_RECORD_SETS as Record<string, string>)[target];
}

/**
 * The shared records a function's sheets link to or pair up, for its page to
 * list beside its own: the parties a Title sheet names, the parcels it
 * matches.
 */
export function sharedSetsOf(fn: string, catalog = fieldCatalog()): FieldSet[] {
  const ids = new Set<string>();
  const from = (list: MatchList | undefined) => {
    if (!list) return;
    if ('records' in list) ids.add(list.records);
    else if ('target' in list) ids.add(refSet(list.target) ?? '');
  };
  for (const set of fieldSetsOf(fn, catalog)) {
    for (const def of set.fields.flatMap((field) => [field, ...(field.columns ?? [])])) {
      if (def.kind === 'ref') ids.add(refSet(def.target) ?? '');
      for (const side of matchSides(def)) from(side.of);
    }
  }
  // And the records it adds facts of its own to: those facts are filled from its page, whether or not a sheet of it links to one.
  for (const extra of catalog.extending.get(fn) ?? []) ids.add(extra.extends!);
  return [...ids].flatMap((id) => {
    const set = catalog.sets.get(id);
    return set && set.fn === SHARED_FN ? [set] : [];
  });
}

let built: FieldCatalog | undefined;

/** The product's catalog. */
export function fieldCatalog(): FieldCatalog {
  built ??= buildFieldCatalog(FIELD_SETS);
  return built;
}

/** The key a situation is kept under: its own for the project's, `<fn>:<key>` for one function's. */
export function situationKey(situation: Pick<Situation, 'key' | 'scope'>, fn: string): string {
  return situation.scope === 'function' ? `${fn}:${situation.key}` : situation.key;
}

export function fieldSet(id: string, catalog = fieldCatalog()): FieldSet | undefined {
  return catalog.sets.get(id);
}

/** A function's sheets. */
export function fieldSetsOf(fn: string, catalog = fieldCatalog()): FieldSet[] {
  return catalog.sheets.get(fn) ?? [];
}

/** Whether a function has sheets of its own, and so a page to open even where nothing else of it is built. */
export function functionHasSheets(fn: string, catalog = fieldCatalog()): boolean {
  return fieldSetsOf(fn, catalog).length > 0;
}

export function optionSetById(id: string, catalog = fieldCatalog()): OptionSet | undefined {
  return catalog.optionSets.get(id);
}

/** The situations a function's sheets answer to, with the key each is kept under. */
export function situationsOf(fn: string, catalog = fieldCatalog()): Array<{ at: string; situation: Situation }> {
  const named = new Set<string>();
  const collect = (when: ShowWhen | undefined) => {
    if (!when) return;
    if ('situation' in when) named.add(when.situation);
    else if ('all' in when) when.all.forEach(collect);
    else if ('any' in when && Array.isArray(when.any)) when.any.forEach(collect);
  };
  // Its own sheets, and what it adds to a shared record: a unit's sale waits on a lender as much as a sheet does.
  for (const set of [...fieldSetsOf(fn, catalog), ...(catalog.extending.get(fn) ?? [])]) {
    for (const situation of set.situations ?? []) named.add(situation.key);
    for (const section of set.sections ?? []) collect(section.showWhen);
    for (const def of set.fields) collect(def.showWhen);
  }
  // And the ones its checks' fields wait on: an approach, on Valuation.
  for (const id of catalog.checkSets.get(fn) ?? []) for (const def of catalog.sets.get(id)?.fields ?? []) collect(def.showWhen);
  const out: Array<{ at: string; situation: Situation }> = [];
  for (const key of named) {
    const own = catalog.situations.get(`${fn}:${key}`);
    const shared = catalog.situations.get(key);
    if (own) out.push({ at: `${fn}:${key}`, situation: own });
    else if (shared) out.push({ at: key, situation: shared });
  }
  return out;
}

/** The field an address names, or undefined. A column is found inside its table. */
export function fieldDefAt(address: FieldAddress, catalog = fieldCatalog()): CheckFieldDef | undefined {
  const def = catalog.sets.get(address.set)?.fields.find((field) => field.key === address.field);
  return address.column ? def?.columns?.find((column) => column.key === address.column) : def;
}

/** An address as one string: what a node, a memo and a tool key by. */
export function addressKey(address: FieldAddress): string {
  return [address.set, address.record ?? '', address.field, address.column ?? ''].join('::').replace(/(::)+$/, '');
}

/** The address of a field of a set. */
export function fieldAddressOf(set: Pick<FieldSet, 'id' | 'fn'>, field: string, record?: string): FieldAddress {
  return { fn: set.fn, set: set.id, field, ...(record ? { record } : {}) };
}

/* ==================================================================== */
/* What a field is worked out from                                       */
/* ==================================================================== */

function formulaReads(formula: CheckFormula, set: FieldSet): FieldAddress[] {
  const own = (field: string): FieldAddress => ({ fn: set.fn, set: set.id, field });
  const rows = (over: FormulaRows, ...columns: string[]): FieldAddress[] =>
    'table' in over ? columns.map((column) => ({ ...own(over.table), column })) : columns.map((field) => ({ fn: set.fn, set: over.records, field }));
  // A join on one of the record's own fields reads that field.
  const joined = (where: { is: string; value?: unknown }): FieldAddress[] => (where.is === 'own' && typeof where.value === 'string' ? [own(where.value)] : []);
  const condition = (when: FormulaCondition): FieldAddress[] => {
    if ('all' in when) return when.all.flatMap(condition);
    if ('any' in when) return when.any.flatMap(condition);
    if ('left' in when) return [...formulaReads(when.left, set), ...formulaReads(when.right, set)];
    return [when.at ?? own(when.field)];
  };
  switch (formula.op) {
    case 'const':
    case 'today':
      return [];
    case 'field':
    case 'date':
      return [formula.at ?? own(formula.key), ...(formula.via ? [own(formula.via)] : [])];
    case 'figure':
      return formula.of ? [own(formula.of)] : [];
    case 'records':
      return [{ fn: set.fn, set: formula.set, field: formula.field ?? '' }];
    case 'sum':
      return [{ ...own(formula.table), column: formula.column }];
    case 'count':
      return [own(formula.table)];
    case 'days_between':
      return [own(formula.left), own(formula.right)];
    case 'min':
    case 'max':
      return formula.of.flatMap((part) => formulaReads(part, set));
    case 'if':
      return [...condition(formula.when), ...formulaReads(formula.then, set), ...formulaReads(formula.else, set)];
    case 'sum_if':
      return [...rows(formula.over, formula.column, formula.where.column), ...joined(formula.where)];
    case 'count_if':
      return [...rows(formula.over, formula.where.column), ...joined(formula.where)];
    case 'rate':
      return [...(formula.on ? [own(formula.on)] : []), ...Object.values(formula.where ?? {}).flatMap((from) => ('field' in from ? [own(from.field)] : []))];
    case 'irr':
      return rows(formula.over, formula.date, formula.amount);
    case 'npv':
      return [...formulaReads(formula.rate, set), ...rows(formula.over, formula.date, formula.amount)];
    case 'add_days':
      return [...formulaReads(formula.date, set), ...formulaReads(formula.days, set)];
    case 'add_months':
      return [...formulaReads(formula.date, set), ...formulaReads(formula.months, set)];
    default:
      return [...formulaReads(formula.left, set), ...formulaReads(formula.right, set)];
  }
}

/** The rule tables a formula reads, by key. */
function formulaRates(formula: CheckFormula): string[] {
  switch (formula.op) {
    case 'rate':
      return [formula.table];
    case 'min':
    case 'max':
      return formula.of.flatMap(formulaRates);
    case 'if':
      return [...formulaRates(formula.then), ...formulaRates(formula.else), ...conditionRates(formula.when)];
    case 'npv':
      return formulaRates(formula.rate);
    case 'add_days':
      return [...formulaRates(formula.date), ...formulaRates(formula.days)];
    case 'add_months':
      return [...formulaRates(formula.date), ...formulaRates(formula.months)];
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'variance_pct':
    case 'power':
      return [...formulaRates(formula.left), ...formulaRates(formula.right)];
    default:
      return [];
  }
}

/** The figures of other parts of the product a formula reads, wherever in it they sit, each with the own link it is asked of. */
function formulaFigures(node: unknown): Array<{ key: string; of?: string }> {
  if (!node || typeof node !== 'object') return [];
  const held = node as { op?: unknown; key?: unknown; of?: unknown };
  const here = held.op === 'figure' ? [{ key: String(held.key), ...(typeof held.of === 'string' ? { of: held.of } : {}) }] : [];
  return [...here, ...Object.values(node).flatMap(formulaFigures)];
}

function conditionRates(when: FormulaCondition): string[] {
  if ('all' in when) return when.all.flatMap(conditionRates);
  if ('any' in when) return when.any.flatMap(conditionRates);
  return 'left' in when ? [...formulaRates(when.left), ...formulaRates(when.right)] : [];
}

/** The fields a derived field reads: a formula's leaves, a status's rule fields, a mirror's owner. Empty for a field a person fills. */
export function fieldReads(def: CheckFieldDef, set: FieldSet): FieldAddress[] {
  if (def.sameAs) return [def.sameAs];
  if (def.kind === 'computed' && def.formula) return formulaReads(def.formula, set);
  if (def.kind === 'status') return (def.cases ?? []).flatMap((option) => option.when.fields.map((field) => ({ fn: set.fn, set: set.id, field })));
  return [];
}

/**
 * Every derived field in the order it can be worked out: each after all it
 * reads. Where fields read each other in a ring there is no such order, and
 * `cycle` names the ring.
 */
export function fieldOrder(catalog = fieldCatalog()): { order: FieldAddress[]; cycle?: string[] } {
  const order: FieldAddress[] = [];
  const done = new Set<string>();
  const open: string[] = [];
  let cycle: string[] | undefined;
  const visit = (address: FieldAddress) => {
    const key = `${address.set}::${address.field}`;
    if (done.has(key) || cycle) return;
    if (open.includes(key)) {
      cycle = [...open.slice(open.indexOf(key)), key];
      return;
    }
    const set = catalog.sets.get(address.set);
    const def = set?.fields.find((field) => field.key === address.field);
    if (!set || !def) return;
    const reads = fieldReads(def, set);
    if (!reads.length) return;
    open.push(key);
    for (const read of reads) visit(read);
    open.pop();
    done.add(key);
    order.push({ fn: set.fn, set: set.id, field: def.key });
  };
  for (const set of catalog.sets.values()) for (const def of set.fields) visit({ fn: set.fn, set: set.id, field: def.key });
  return cycle ? { order, cycle } : { order };
}

/* ==================================================================== */
/* What is wrong with a catalog                                          */
/* ==================================================================== */

/**
 * Everything a catalog declares that cannot work, each in a sentence naming
 * the set and the field. Empty for a catalog that can be used. A test holds
 * the product's own catalog to it, so a field set with a fault fails the
 * build and not a person's screen.
 */
export function catalogFaults(sheets: readonly FieldSet[] = FIELD_SETS, rules: readonly RuleRow[] = RULE_ROWS): string[] {
  const catalog = buildFieldCatalog(sheets);
  const faults: string[] = ruleRowFaults(rules);
  // A rule whose figures are not loaded yet is still one a formula may name: it gives no answer until they are.
  const rated = new Set([...rules.map((row) => row.key), ...RULE_SHAPES.map((shape) => shape.key)]);
  const exists = (address: FieldAddress) => Boolean(fieldDefAt(address, catalog));

  const seen = new Set<string>();
  for (const set of sheets.map(withDepthSheets)) {
    const at = (field?: string) => `${set.id}${field ? `/${field}` : ''}`;
    if (seen.has(set.id)) faults.push(`${at()}: two field sets have this id.`);
    if (catalog.checks.has(set.id)) faults.push(`${at()}: a check already has this id.`);
    seen.add(set.id);
    if (set.fn !== SHARED_FN && !workstreamDefinition(set.fn)) faults.push(`${at()}: "${set.fn}" is not a function.`);
    if (set.extends) {
      const target = sheets.find((other) => other.id === set.extends);
      if (!target?.records) faults.push(`${at()}: extends "${set.extends}", which is not a set that repeats.`);
      const held = target ? withDepthSheets(target).fields : [];
      for (const def of set.fields) if (held.some((own) => own.key === def.key)) faults.push(`${at(def.key)}: "${set.extends}" already has a field of this key.`);
      // Two departments adding to one record under one key: the second would be dropped without a word.
      for (const other of sheets) {
        if (other === set || other.extends !== set.extends || sheets.indexOf(other) > sheets.indexOf(set)) continue;
        for (const def of set.fields) if (other.fields.some((own) => own.key === def.key)) faults.push(`${at(def.key)}: "${other.id}" already adds a field of this key to "${set.extends}".`);
      }
    }
    const sections = new Set((set.sections ?? []).map((section) => section.key));
    const keys = new Set<string>();
    for (const def of set.fields) {
      if (keys.has(def.key)) faults.push(`${at(def.key)}: declared twice.`);
      keys.add(def.key);
      const within = def.sheet ? new Set((depthSheet(set, def.sheet)?.sections ?? []).map((section) => section.key)) : sections;
      if (def.section && !within.has(def.section)) faults.push(`${at(def.key)}: section "${def.section}" is not declared.`);
      if (def.sheet && def.kind === 'table' && def.display === 'match') faults.push(`${at(def.key)}: a depth sheet holds no list that pairs or opens another.`);
      if (def.dueFrom && !SUB_STAGES.includes(def.dueFrom as LifecycleStage) && !/^\d{4}-\d{2}-\d{2}$/.test(def.dueFrom)) faults.push(`${at(def.key)}: dueFrom is a step of the project or a day, and "${def.dueFrom}" is neither.`);
      if (def.owedBy && typeof def.owedBy === 'object') {
        const link = set.fields.find((field) => field.key === (def.owedBy as { ref: string }).ref);
        if (!link || link.kind !== 'ref' || refSet(link.target) !== SHARED_RECORD_SETS.party) faults.push(`${at(def.key)}: owedBy names "${def.owedBy.ref}", which is not a link to a party on this set.`);
      }
      if (def.owedBy && (fieldIsWorkedOut(def) || def.required === false)) faults.push(`${at(def.key)}: only a must-field somebody fills can be owed by a party.`);
      if (def.kind === 'longtext' && !def.maxLength) faults.push(`${at(def.key)}: a longtext field needs maxLength.`);
      if (def.tier === 'situational' && !def.showWhen && !(set.sections ?? []).find((section) => section.key === def.section)?.showWhen) faults.push(`${at(def.key)}: a situational field needs showWhen, on it or on its section.`);
      if (def.kind === 'ref' && !def.target) faults.push(`${at(def.key)}: a ref field needs a target.`);
      for (const linked of [def, ...(def.columns ?? [])]) {
        // A target that names a set has to name one that repeats. A register's name (party, parcel) needs no set: it is linked to as the project keeps it.
        const to = linked.kind === 'ref' && typeof linked.target === 'object' ? linked.target.set : undefined;
        if (to && !catalog.sets.get(to)?.records) faults.push(`${at(def.key)}: its target "${to}" is not a set that repeats.`);
      }
      if (def.display === 'match') {
        if (!def.match) faults.push(`${at(def.key)}: a match table needs its two sides.`);
        for (const column of def.match?.agree ?? []) if (!matchSides(def).some((side) => side.column === column)) faults.push(`${at(def.key)}: match says "${column}" should agree, and no side holds it.`);
        for (const side of matchSides(def)) {
          if (!def.columns?.some((column) => column.key === side.column)) faults.push(`${at(def.key)}: match names column "${side.column}", which it does not have.`);
          const of = side.of;
          if ('records' in of && !catalog.sets.get(of.records)?.fields.some((field) => field.key === of.field)) faults.push(`${at(def.key)}: match reads ${of.records}/${of.field}, which does not exist.`);
          if ('table' in of && !fieldDefAt({ ...of.table, column: of.column }, catalog)) faults.push(`${at(def.key)}: match reads ${of.table.set}/${of.table.field}/${of.column}, which does not exist.`);
        }
      }
      if (def.display === 'chart' && (!def.chart || ![def.chart.x, def.chart.y].every((key) => def.columns?.some((column) => column.key === key)))) faults.push(`${at(def.key)}: a chart table names its x and y columns.`);
      if (def.display === 'chart' && def.chart?.mark === 'stacked' && !def.columns?.some((column) => column.key === def.chart!.stack)) faults.push(`${at(def.key)}: a stacked chart names the column its bars are built of.`);
      for (const table of def.formula ? formulaRates(def.formula) : []) if (!rated.has(table)) faults.push(`${at(def.key)}: reads the rule "${table}", which the rule table does not have.`);
      for (const figure of def.formula ? formulaFigures(def.formula) : []) {
        const known = PROJECT_FIGURES[figure.key];
        if (!known) faults.push(`${at(def.key)}: reads the figure "${figure.key}", which nothing works out.`);
        else if (Boolean(known.of) !== Boolean(figure.of)) faults.push(`${at(def.key)}: the figure "${figure.key}" ${known.of ? `is of one ${known.of}: name the link to it` : 'is of the project, not of one thing'}.`);
      }
      if (def.kind === 'status' && !def.cases?.length) faults.push(`${at(def.key)}: a status field needs cases.`);
      if (def.kind === 'computed' && !def.formula) faults.push(`${at(def.key)}: a computed field needs a formula.`);
      for (const column of [def, ...(def.columns ?? [])]) {
        if (column.optionSet && !catalog.optionSets.has(column.optionSet)) faults.push(`${at(def.key)}: option set "${column.optionSet}" is not declared.`);
      }
    }
    if (set.records) {
      for (const field of [set.records.titleField, ...set.records.summaryFields]) if (!keys.has(field)) faults.push(`${at()}: records names "${field}", which is not a field of it.`);
    }
    const depthIds = new Set<string>();
    for (const sheet of set.sheets ?? []) {
      if (depthIds.has(sheet.id)) faults.push(`${at()}: two depth sheets are called "${sheet.id}".`);
      depthIds.add(sheet.id);
      if (set.extends) faults.push(`${at()}: a set that extends another holds no depth sheet. Declare it on the record itself.`);
      if (!sheet.fields.length) faults.push(`${at()}: depth sheet "${sheet.id}" has no fields.`);
    }
    for (const list of set.optionSets ?? []) {
      const held = catalog.optionSets.get(list.id);
      if (held && JSON.stringify(held) !== JSON.stringify(list)) faults.push(`${at()}: option set "${list.id}" is declared differently elsewhere.`);
    }
    for (const situation of set.situations ?? []) {
      const held = catalog.situations.get(situationKey(situation, set.fn));
      if (held && JSON.stringify(held) !== JSON.stringify(situation)) faults.push(`${at()}: situation "${situation.key}" is declared differently elsewhere.`);
    }
    const known = (key: string) => catalog.situations.has(`${set.fn}:${key}`) || catalog.situations.has(key);
    const shows = (when: ShowWhen | undefined, where: string) => {
      if (!when) return;
      if ('situation' in when) {
        if (!known(when.situation)) faults.push(`${where}: showWhen names situation "${when.situation}", which is not declared.`);
      } else if ('field' in when) {
        if (!exists(when.field)) faults.push(`${where}: showWhen names ${when.field.set}/${when.field.field}, which does not exist.`);
      } else if ('records' in when) {
        const of = catalog.sets.get(when.records);
        if (!of?.records) faults.push(`${where}: showWhen counts "${when.records}", which is not a set that repeats.`);
        else if (when.where && !of.fields.some((field) => field.key === when.where!.column)) faults.push(`${where}: showWhen reads ${when.records}/${when.where.column}, which does not exist.`);
      } else for (const part of 'all' in when ? when.all : when.any) shows(part, where);
    };
    for (const section of set.sections ?? []) shows(section.showWhen, at(`section ${section.key}`));
    for (const situation of set.situations ?? []) shows(situation.impliedBy, at(`situation ${situation.key}`));
    for (const def of set.fields) {
      shows(def.showWhen, at(def.key));
      shows(def.requiredWhen, at(def.key));
      for (const rule of def.defaults ?? []) {
        shows(rule.when, at(def.key));
        if (!rule.cite && rule.from !== 'firm') faults.push(`${at(def.key)}: a usual value needs where it is written, unless it is the firm's own.`);
      }
    }
    for (const situation of set.situations ?? []) shows(situation.derive, at(`situation ${situation.key}`));
    for (const rule of set.rules) {
      shows(rule.when, at('a rule'));
      for (const [key, address] of Object.entries(rule.at ?? {})) if (!exists(address)) faults.push(`${at()}: a rule reads ${address.set}/${address.field} as "${key}", which does not exist.`);
    }
    // A rule of a set that adds to a record reads that record as it stands merged: its own fields, and what another department added.
    const inherited = new Set(set.extends ? (catalog.sets.get(set.extends)?.fields ?? []).map((def) => def.key) : []);
    for (const rule of set.rules) for (const field of rule.fields) if (!keys.has(field) && !inherited.has(field) && !rule.at?.[field]) faults.push(`${at()}: a rule reads "${field}", which is not a field of it.`);
  }

  // Over the whole catalog, the checks' own fields included: nothing derived may read a field that is not there.
  for (const set of catalog.sets.values()) {
    for (const def of set.fields) {
      for (const read of fieldReads(def, set)) {
        const target = catalog.sets.get(read.set);
        // A count of a set's records names no field of it, wherever in the formula the count sits.
        const recordsOnly = !read.field;
        if (recordsOnly ? !target?.records : !exists(read)) faults.push(`${set.id}/${def.key}: reads ${read.set}/${read.field || '(records)'}, which does not exist.`);
      }
      if (def.sameAs && fieldDefAt(def.sameAs, catalog)?.sameAs) faults.push(`${set.id}/${def.key}: mirrors a field that is itself a mirror. Name the field it is entered on.`);
    }
  }
  const { cycle } = fieldOrder(catalog);
  if (cycle) faults.push(`Fields are worked out from each other in a ring: ${cycle.join(' → ')}.`);
  return faults;
}

/* ==================================================================== */
/* What a catalog author is held to                                      */
/* ==================================================================== */

export interface CatalogLimitBreach {
  set: string;
  field?: string;
  /** Which limit. */
  limit: 'core_fields' | 'record_fields' | 'wide_table' | 'table_is_records' | 'statutory_number' | 'option_not_applicable' | 'depth_fields' | 'depth_sections';
  said: string;
}

/** The most core fields a sheet may always show, and the most fields a record's own sheet may hold. */
export const CORE_FIELDS_MOST = 12;
export const RECORD_FIELDS_MOST = 20;
export const TABLE_COLUMNS_MOST = 6;
/** The most a depth sheet may hold, and the most sections it may be cut into. */
export const DEPTH_FIELDS_MOST = 20;
export const DEPTH_SECTIONS_MOST = 4;

/** "Not applicable" and "unknown" however they are abbreviated: N/A, N.A., NA, "Not applicable (NA)", "Don't know". */
const NOT_A_CHOICE = /^(?:n\.?\s*\/?\s*a\.?|not applicable(?:\s*\(\s*n\.?\s*\/?\s*a\.?\s*\))?|unknown|not known|don[’']?t know|none of these)$/i;
/**
 * A figure a law could change, written into a key or a label: a percentage, a period, a height, a section number.
 * The unit ends where no letter follows it: "%" is followed by a space or nothing, which is no word boundary.
 */
const STATUTORY = /\b\d+(?:\.\d+)?\s*(?:%|per ?cent|percent|days?|months?|years?|m|metres?|meters?|sqm|sq\.? ?ft)(?![a-z])|\b(?:section|s\.|rule|form)\s*\d/i;

/**
 * Where a catalog goes past the limits that keep a sheet readable, each
 * named by its field set so the author of that file can fix it.
 *
 * - At most twelve core fields on a sheet: the ones always shown. Past that,
 *   give a field a condition, fold it as expert, or make the repeating part
 *   a set that repeats.
 * - At most twenty fields on a record's sheet.
 * - A table of more than six columns, or one whose rows carry a status, a
 *   date that runs out or a paper, is a set that repeats and not a table.
 * - No figure a law sets in a key or a label: it is a row of the rule table.
 * - No choice called "not applicable" or "unknown": the first is a state any
 *   field can be put in, and the second is the field left empty.
 */
export function catalogLimits(sheets: readonly FieldSet[] = FIELD_SETS): CatalogLimitBreach[] {
  const out: CatalogLimitBreach[] = [];
  // A shared list is declared on the set that owns it and named from any other.
  const lists = new Map(sheets.flatMap((set) => (set.optionSets ?? []).map((list) => [list.id, list] as const)));
  for (const set of sheets) {
    const section = (key: string | undefined) => (set.sections ?? []).find((s) => s.key === key);
    const core = set.fields.filter((def) => !def.retired && !def.showWhen && def.tier !== 'expert' && def.tier !== 'situational' && !section(def.section)?.showWhen && section(def.section)?.tier !== 'expert');
    if (!set.records && !set.extends && core.length > CORE_FIELDS_MOST) {
      out.push({ set: set.id, limit: 'core_fields', said: `${core.length} fields are always shown; ${CORE_FIELDS_MOST} at most. Give some a showWhen, fold some as expert, or make what repeats a set of records.` });
    }
    if (set.records && set.fields.length > RECORD_FIELDS_MOST) out.push({ set: set.id, limit: 'record_fields', said: `A record of it has ${set.fields.length} fields; ${RECORD_FIELDS_MOST} at most.` });
    // What a set adds to a shared record is held to the same number of its own.
    if (set.extends && !set.records && set.fields.length > RECORD_FIELDS_MOST) out.push({ set: set.id, limit: 'record_fields', said: `It adds ${set.fields.length} fields to "${set.extends}"; ${RECORD_FIELDS_MOST} of its own at most.` });
    for (const sheet of set.sheets ?? []) {
      if (sheet.fields.length > DEPTH_FIELDS_MOST) out.push({ set: set.id, limit: 'depth_fields', said: `Depth sheet "${sheet.title}" has ${sheet.fields.length} fields; ${DEPTH_FIELDS_MOST} at most.` });
      if ((sheet.sections ?? []).length > DEPTH_SECTIONS_MOST) out.push({ set: set.id, limit: 'depth_sections', said: `Depth sheet "${sheet.title}" has ${(sheet.sections ?? []).length} sections; ${DEPTH_SECTIONS_MOST} at most.` });
    }
    for (const def of [...set.fields, ...(set.sheets ?? []).flatMap((sheet) => sheet.fields)]) {
      // A table's columns are read as its fields are: a figure a law sets is no more a column's name than a field's.
      const statutory = [def, ...(def.columns ?? [])].find((named) => STATUTORY.test(named.key.replace(/_/g, ' ')) || STATUTORY.test(named.label));
      if (statutory) out.push({ set: set.id, field: def.key, limit: 'statutory_number', said: `"${statutory.label}" carries a figure a law sets. Put it in the rule table and read it with a rate formula.` });
      for (const holder of [def, ...(def.columns ?? [])]) {
        const named = [...(holder.options ?? []), ...(holder.optionSet ? lists.get(holder.optionSet)?.options.filter((o) => !o.retired).map((o) => o.label) ?? [] : [])];
        const bad = named.find((option) => NOT_A_CHOICE.test(option.trim()));
        if (bad) out.push({ set: set.id, field: def.key, limit: 'option_not_applicable', said: `"${bad}" is not a choice. Not applicable is a state of the field, and unknown is the field left empty.` });
      }
      if (def.kind !== 'table') continue;
      const columns = def.columns ?? [];
      // A table that pairs lists is held to the same width as any other.
      if (columns.length > TABLE_COLUMNS_MOST) out.push({ set: set.id, field: def.key, limit: 'wide_table', said: `${columns.length} columns; ${TABLE_COLUMNS_MOST} at most. Make it a set of records.` });
      if (def.display === 'match') continue;
      const lifecycle = columns.find((column) => column.kind === 'evidence' || column.expires || (column.kind === 'enum' && /status|standing|stage/.test(column.key)) || (column.kind === 'date' && /valid|expir|due/.test(column.key)));
      if (lifecycle) out.push({ set: set.id, field: def.key, limit: 'table_is_records', said: `Its rows carry "${lifecycle.label}": a status, a date that runs out or a paper. Make it a set of records.` });
    }
  }
  return out;
}
