/**
 * Typed fields on a check, and the observations that fall out of them.
 *
 * A check today says what to compare and gives you a box to type prose into:
 *
 *   acceptanceCriteria: "Survey numbers, extents and coordinates in the title
 *                        match the latest survey without unexplained remainder."
 *   comments:           "extent looks a bit off vs the khata, need to confirm"
 *
 * Everything the product wants to do next is blocked on that second line being
 * a sentence instead of two numbers. You cannot compute a divergence from it,
 * cite it in a report, put it in the graph, chart it, or let an agent read it
 * without a model guessing at what it meant. The prose is not the record — it
 * is a description of a record nobody kept.
 *
 * So a check declares the fields it is actually about, and a person (or an
 * extraction, or an accepted proposal) fills them in. Once the numbers exist:
 *
 * - **Insights are computed, not generated.** `checkInsights` is arithmetic
 *   over declared fields against declared tolerances. "The deed recites 1,208
 *   sqm and the khata records 1,161 — 3.9% apart, outside the 1% tolerance"
 *   is a calculation, and calculations belong to the engine, not to a model.
 *   A model may READ an insight and reason about it; it may not author one.
 * - **A chart becomes possible** because there is finally something to plot.
 * - **The graph gets facts** rather than a paragraph.
 * - **An agent can read and write** through a schema that can refuse it.
 *
 * The shape is deliberately one system, not fourteen. A per-scope bespoke
 * panel for each of the 14 scopes would be fourteen half-finished surfaces
 * inside a year; a declared schema per check is one renderer and N lines of
 * data, and a new check costs a declaration rather than a component.
 */

import type { CheckFieldDef, CheckFieldValue, CheckFormula, CheckInsight, CheckInsightRule, CheckInstance, CheckTableRow, Dimension, FieldAddress, FieldState, FindingSeverity, FormulaCondition, FormulaRows, OptionDef, OptionSet, RowCondition, Tone } from './types';
import { formatMeasure, formatMoney, parseMeasure, unitNamed, type Entered, type UnitContext } from './units';

/* ==================================================================== */
/* Reading and writing a value                                           */
/* ==================================================================== */

/** Nothing recorded yet — distinct from a recorded zero, which is a finding. */
export function isBlank(value: CheckFieldValue | undefined): boolean {
  if (!value || value.value === null || value.value === '') return true;
  // An empty table or an empty multi-select is nothing recorded, not a
  // recorded nothing — the same distinction a blank number box carries.
  return Array.isArray(value.value) && value.value.length === 0;
}

export function fieldNumber(value: CheckFieldValue | undefined): number | null {
  if (isBlank(value)) return null;
  const raw = value!.value;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return null;
  const parsed = Number(String(raw).replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/* ==================================================================== */
/* Where a value stands                                                  */
/* ==================================================================== */

/**
 * Where a field's value stands with a person.
 *
 * A value saved before states were kept carries none: it reads as accepted
 * where it cites a paper and as typed where it does not, which is what it
 * was.
 */
export function fieldState(value: CheckFieldValue | undefined): FieldState {
  if (!value) return 'empty';
  if (value.state) return value.state === 'empty' && !isBlank(value) ? 'typed' : value.state;
  if (isBlank(value)) return 'empty';
  return value.sourceEvidenceId ? 'accepted' : 'typed';
}

/**
 * Whether a value may be acted on: by a rule, a computed field, a report, a
 * notice, the graph. The one question, as `stands` is for a paper's values
 * (`fact-review.ts`): a value somebody proposed waits for a person, a
 * disputed one waits to be settled, and neither acts on anything.
 */
export function fieldStands(value: CheckFieldValue | undefined): boolean {
  const state = fieldState(value);
  // An assumed value is a usual one standing in: it is said to be assumed wherever it shows, and it does feed what is worked out.
  return state === 'accepted' || state === 'typed' || state === 'assumed';
}

/** The value where it stands, else nothing. What every reader that acts on a field asks for. */
export function standingField(value: CheckFieldValue | undefined): CheckFieldValue | undefined {
  return fieldStands(value) ? value : undefined;
}

/** A holder's values with every one that does not stand left out. */
export function standingValues(values: Record<string, CheckFieldValue> | undefined): Record<string, CheckFieldValue> {
  const out: Record<string, CheckFieldValue> = {};
  for (const [key, value] of Object.entries(values ?? {})) if (fieldStands(value)) out[key] = value;
  return out;
}

/** Whether anything waits beside or in place of a value: a proposal nobody has decided. */
export function fieldWaits(value: CheckFieldValue | undefined): boolean {
  return fieldState(value) === 'proposed' || Boolean(value?.other?.length && fieldState(value) !== 'disputed');
}

/* ==================================================================== */
/* Choices                                                               */
/* ==================================================================== */

/** What a write is checked against beyond the field's own declaration. */
export interface FieldWriteContext extends UnitContext {
  /** Who is writing. A model may not write prose. */
  proposer?: 'person' | 'model' | 'parser';
  /** The shared lists, by id. */
  optionSet?: (id: string) => OptionSet | undefined;
}

/** A field's choices, whether it lists them itself or names a shared list. */
export function fieldOptions(def: CheckFieldDef, optionSet?: (id: string) => OptionSet | undefined): OptionDef[] {
  const shared = def.optionSet ? optionSet?.(def.optionSet)?.options : undefined;
  return shared ?? (def.options ?? []).map((option) => ({ key: option, label: option }));
}

/** The dimension a field measures, where it declares one or its kind implies one. */
export function fieldDimension(def: CheckFieldDef): Dimension | undefined {
  return def.dimension ?? (def.kind === 'area' ? 'area' : def.kind === 'money' ? 'money' : undefined);
}

/** The most a person may write in a prose field. */
export function longtextCap(def: CheckFieldDef): number {
  return def.maxLength ?? 600;
}

/** Kinds nobody writes: worked out, or read from where they are entered. */
export function fieldIsDerived(def: CheckFieldDef): boolean {
  return def.kind === 'computed' || def.kind === 'status' || Boolean(def.sameAs);
}

/**
 * Coerce and check one value against its declaration.
 *
 * Returns the reason rather than throwing, because both callers want to say
 * it rather than crash: the API returns it as a 400, and the agent tool hands
 * it back to the model so the next attempt is right instead of a retry loop.
 */
export function validateFieldValue(
  def: CheckFieldDef,
  raw: unknown,
  ctx: FieldWriteContext = {},
): { value: CheckFieldValue['value']; entered?: Entered } | { error: string } {
  // A computed field is worked out, never written. Refused rather than
  // ignored, so a caller that thought it was setting one is told.
  if (def.kind === 'computed') {
    return { error: `${def.label} is worked out from the other values on this check. It is not written directly.` };
  }
  if (def.kind === 'status') return { error: `${def.label} is worked out by rule. It is not written directly.` };
  if (def.sameAs) return { error: `${def.label} is entered on ${def.sameAs.set}. It is read here, not written.` };
  // Prose is a person's. A model picks keys and values with a source; it writes no sentence that is kept.
  if (def.kind === 'longtext' && ctx.proposer && ctx.proposer !== 'person') return { error: `${def.label} is written by a person.` };
  if (raw === null || raw === undefined || raw === '') return { value: null };

  if ((def.kind === 'enum' || def.kind === 'multi_enum') && def.optionSet) {
    const options = fieldOptions(def, ctx.optionSet);
    const pick = (item: string) => options.find((o) => !o.retired && (o.key.toLowerCase() === item.toLowerCase() || o.label.toLowerCase() === item.toLowerCase()));
    const offered = options.filter((o) => !o.retired).map((o) => o.label).join(', ');
    if (def.kind === 'enum') {
      const hit = pick(String(raw).trim());
      return hit ? { value: hit.key } : { error: `${def.label} is one of: ${offered}.` };
    }
    const list = Array.isArray(raw) ? raw.map(String) : String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    const unknown = list.filter((item) => !pick(item));
    if (unknown.length) return { error: `${def.label}: "${unknown.join('", "')}" is not on the list. Choose from: ${offered}.` };
    return { value: options.filter((o) => list.some((item) => pick(item) === o)).map((o) => o.key) };
  }

  switch (def.kind) {
    case 'ref': {
      // An id into a register. Whether the thing exists is asked by the writer, which has the project.
      const id = String(raw).trim();
      return id ? { value: id.slice(0, 200) } : { value: null };
    }
    case 'multi_enum': {
      const list = Array.isArray(raw) ? raw.map(String) : String(raw).split(',').map((s) => s.trim()).filter(Boolean);
      if (!def.options?.length) return { value: list };
      const unknown = list.filter((item) => !def.options!.some((o) => o.toLowerCase() === item.toLowerCase()));
      if (unknown.length) return { error: `${def.label}: "${unknown.join('", "')}" is not on the list. Choose from: ${def.options.join(', ')}.` };
      return { value: def.options.filter((o) => list.some((i) => i.toLowerCase() === o.toLowerCase())) };
    }
    case 'table': {
      if (!Array.isArray(raw)) return { error: `${def.label} is a table — send an array of rows.` };
      const columns = def.columns ?? [];
      const rows: CheckTableRow[] = [];
      for (const [index, entry] of raw.entries()) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          return { error: `${def.label} row ${index + 1} is not a row object.` };
        }
        const row: CheckTableRow = {};
        for (const [key, cell] of Object.entries(entry as Record<string, unknown>)) {
          const column = columns.find((c) => c.key === key);
          if (!column) return { error: `${def.label} has no column "${key}". It has: ${columns.map((c) => c.key).join(', ')}.` };
          const parsed = validateFieldValue(column, cell, ctx);
          if ('error' in parsed) return { error: `${def.label} row ${index + 1}: ${parsed.error}` };
          /*
           * One proof per row, not a list.
           *
           * A cell holds a scalar — that is what makes a table a table, and
           * what keeps a row printable in a report line. An evidence column
           * therefore cites exactly one document: the NOC certificate for THIS
           * NOC, the closure letter for THIS condition. A row needing several
           * documents is really several rows, or a row whose proof is a
           * bundle filed as one evidence record.
           */
          if (column.kind === 'evidence' && Array.isArray(parsed.value)) {
            if (parsed.value.length > 1) {
              return { error: `${def.label} row ${index + 1}: ${column.label} cites one document per row — file several as one record, or split the row.` };
            }
            row[key] = (parsed.value[0] as string) ?? null;
            continue;
          }
          row[key] = parsed.value as CheckTableRow[string];
        }
        rows.push(row);
      }
      return { value: rows };
    }
    case 'evidence': {
      /*
       * A list, not a string.
       *
       * "Site photographs" is plural in the label and was singular in the
       * store, so the field could hold one of forty shots and the check read
       * as satisfied. Every evidence field is a set of register rows; a field
       * that wants exactly one is a set of size one, which costs nothing and
       * removes the case where the second document has nowhere to go.
       *
       * Existence is NOT checked here — this function is pure and has no
       * project to look in. `recordCheckFields` does it, because a field
       * pointing at an evidence row that does not exist is a citation to
       * nothing, and that has to be refused at the door rather than noticed in
       * a report.
       */
      const list = (Array.isArray(raw) ? raw.map(String) : String(raw).split(',').map((x) => x.trim()))
        .map((x) => x.trim())
        .filter(Boolean);
      if (!list.length) return { value: null };
      return { value: [...new Set(list)] };
    }
    case 'duration':
    case 'number':
    case 'money':
    case 'area':
    case 'percent': {
      let n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s]/g, ''));
      let entered: Entered | undefined;
      /*
       * A measure may be typed in any unit of its dimension and is kept in
       * the base unit with what was typed beside it. A field that declares a
       * dimension always goes this way. An area or an amount on a field that
       * declares none does only where what was typed is more than a number:
       * "1 acre 22 guntas", "4.2 Cr".
       */
      const dimension = fieldDimension(def);
      if (dimension && (def.dimension || !Number.isFinite(n))) {
        const unit = def.unit ? (unitNamed(def.unit) ?? undefined) : undefined;
        const parsed = parseMeasure(typeof raw === 'number' ? raw : String(raw), dimension, { state: ctx.state, enterIn: def.enterIn, ...(unit ? { defaultUnit: unit } : {}) });
        if ('error' in parsed) {
          // A field that declares no dimension answers as it always has: it is a number in its unit.
          if (def.dimension) return { error: `${def.label}: ${parsed.error}` };
        } else {
          // A field with no dimension of its own keeps its value in the unit it names, as it always has.
          if (!def.dimension && unit && dimension !== 'money') {
            const back = parseMeasure(1, dimension, { defaultUnit: unit, state: ctx.state });
            n = 'error' in back ? parsed.value : Math.round((parsed.value / back.value) * 100) / 100;
          } else n = parsed.value;
          entered = parsed.entered;
        }
      }
      if (!Number.isFinite(n)) return { error: `${def.label} is a number${def.unit ? ` in ${def.unit}` : ''}. "${String(raw)}" is not one.` };
      /*
       * A money, an area or a percent is positive unless the field says
       * otherwise, and a field says otherwise by declaring a negative `min`.
       *
       * The blanket rule is right for almost everything — a vacancy rate or a
       * developer's profit below zero is a typo. It is wrong for a SIGNED
       * quantity like a net comparable adjustment, which is negative whenever
       * the comparables were better than the subject, and that is the ordinary
       * case rather than an edge one. Opting in per field keeps the guard where
       * it belongs and lets the exception be visible in the schema.
       */
      const allowsNegative = def.kind === 'number' || def.kind === 'duration' || (def.min !== undefined && def.min < 0);
      if (n < 0 && !allowsNegative) return { error: `${def.label} cannot be negative.` };
      if (def.min !== undefined && n < def.min) return { error: `${def.label} cannot be below ${def.min}${def.unit ? ` ${def.unit}` : ''}.` };
      if (def.max !== undefined && n > def.max) return { error: `${def.label} cannot be above ${def.max}${def.unit ? ` ${def.unit}` : ''}.` };
      return entered ? { value: n, entered } : { value: n };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      const s = String(raw).toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(s)) return { value: true };
      if (['false', 'no', 'n', '0'].includes(s)) return { value: false };
      return { error: `${def.label} is yes or no.` };
    }
    case 'date': {
      const s = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: `${def.label} is a date as YYYY-MM-DD.` };
      if (Number.isNaN(Date.parse(s))) return { error: `"${s}" is not a real date.` };
      return { value: s };
    }
    case 'enum': {
      const s = String(raw).trim();
      if (!def.options?.length) return { value: s };
      const hit = def.options.find((o) => o.toLowerCase() === s.toLowerCase());
      // A choice no longer offered: what it said is now said by leaving the field empty or marking it not applicable.
      if (!hit && def.retiredOptions?.some((o) => o.toLowerCase() === s.toLowerCase())) return { error: `${def.label}: "${s}" is no longer a choice. Leave it empty, or mark the field not applicable.` };
      if (!hit) return { error: `${def.label} is one of: ${def.options.join(', ')}.` };
      return { value: hit };
    }
    case 'longtext': {
      // Bounded, and refused past the bound: a silent cut would keep half a sentence under a person's name.
      const text = String(raw);
      const cap = longtextCap(def);
      if (text.length > cap) return { error: `${def.label} takes ${cap} characters at most. This is ${text.length}.` };
      return { value: text };
    }
    case 'text':
    default:
      return { value: String(raw).slice(0, 2000) };
  }
}

/* ==================================================================== */
/* Formulas                                                              */
/* ==================================================================== */

/** What a formula may read beyond its own set: another set's field as it stands, and the records of a set that repeats. */
export interface FormulaOutside {
  read(address: FieldAddress): CheckFieldValue | undefined;
  records(setId: string): Array<Record<string, CheckFieldValue>> | undefined;
  /** A figure from the rule table for the project's place, in force on a day, under conditions. */
  rate?(table: string, on: string | undefined, conditions: Record<string, string | number>): number | null;
  /** A figure another part of the product works out, by its key, of one thing where it is of one. */
  figure?(key: string, of?: string): number | null;
  /** The record the formula is worked out for, where its set repeats. */
  record?: string;
  today?: Date;
}

/** A date as a day number: whole days since 1 January 1970. Null for anything that is not a date. */
export function dayNumber(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const at = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(at) ? null : Math.floor(at / 86_400_000);
}

/** A day number as a date. */
export function dayOfNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function cellNumber(cell: unknown): number | null {
  if (cell && typeof cell === 'object' && 'value' in cell) return fieldNumber(cell as CheckFieldValue);
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (cell === null || cell === undefined || cell === '' || typeof cell === 'boolean') return null;
  const n = Number(String(cell).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** A cell of a table row, or a field of a record, as the plain value it holds. */
function cellValue(cell: unknown): unknown {
  return cell && typeof cell === 'object' && !Array.isArray(cell) && 'value' in cell ? (cell as CheckFieldValue).value : cell;
}

export function rowMeets(row: Record<string, unknown>, where: RowCondition): boolean {
  const raw = cellValue(row[where.column]);
  const blank = raw === null || raw === undefined || raw === '';
  switch (where.is) {
    case 'set':
      return !blank;
    case 'true':
      return raw === true;
    case 'false':
      return raw === false;
    case 'equals':
      return !blank && String(raw) === String(where.value);
    case 'in':
      return !blank && Array.isArray(where.value) && where.value.map(String).includes(String(raw));
    case 'gt':
      return cellNumber(raw) !== null && cellNumber(raw)! > Number(where.value);
    case 'lt':
      return cellNumber(raw) !== null && cellNumber(raw)! < Number(where.value);
    case 'own':
      // Settled by whoever knows the record it is asked for (`ownRows`). Asked bare, nothing is its own.
      return false;
  }
}

/**
 * A condition that joins rows to the record a formula is worked out for, as
 * one that can be asked of a row: the row's column equals the record's id,
 * or what the record's own field named in `value` holds. Null where that is
 * not known, and then no row is the record's own.
 */
export function ownRows(where: RowCondition, values: Record<string, CheckFieldValue>, record: string | undefined): RowCondition | null {
  if (where.is !== 'own') return where;
  const own = typeof where.value === 'string' ? values[where.value]?.value : record;
  return own === null || own === undefined || own === '' || typeof own === 'object' ? null : { column: where.column, is: 'equals', value: own };
}

/** The address a formula reads through one of its own links: the field of the record that link holds. */
function through(at: FieldAddress, via: string | undefined, values: Record<string, CheckFieldValue>): FieldAddress | null {
  if (!via) return at;
  const record = values[via]?.value;
  return typeof record === 'string' && record ? { ...at, record } : null;
}

function formulaRows(over: FormulaRows, values: Record<string, CheckFieldValue>, outside: FormulaOutside | undefined): Array<Record<string, unknown>> | null {
  if ('table' in over) return tableRows(values[over.table]);
  return outside?.records(over.records) ?? null;
}

/** Whether a formula's condition holds, or null where what it reads is not known yet. */
function conditionHolds(when: FormulaCondition, values: Record<string, CheckFieldValue>, outside: FormulaOutside | undefined): boolean | null {
  if ('all' in when) {
    const parts = when.all.map((part) => conditionHolds(part, values, outside));
    return parts.includes(false) ? false : parts.includes(null) ? null : true;
  }
  if ('any' in when) {
    const parts = when.any.map((part) => conditionHolds(part, values, outside));
    return parts.includes(true) ? true : parts.includes(null) ? null : false;
  }
  if ('left' in when) {
    const left = evaluateFormula(when.left, values, outside);
    const right = evaluateFormula(when.right, values, outside);
    if (left === null || right === null) return null;
    return when.is === 'gt' ? left > right : when.is === 'gte' ? left >= right : when.is === 'lt' ? left < right : when.is === 'lte' ? left <= right : when.is === 'eq' ? left === right : left !== right;
  }
  const held = when.at ? outside?.read(when.at) : values[when.field];
  if (when.is === 'set') return !isBlank(held);
  if (isBlank(held)) return null;
  return rowMeets({ x: held!.value }, { column: 'x', is: when.is, value: when.value });
}

/** Dated cash flows discounted to the first of them at a yearly rate, a year being 365 days. */
function presentValue(flows: Array<{ day: number; amount: number }>, rate: number): number | null {
  if (rate <= -1) return null;
  const first = Math.min(...flows.map((flow) => flow.day));
  const total = flows.reduce((sum, flow) => sum + flow.amount / (1 + rate) ** ((flow.day - first) / 365), 0);
  return Number.isFinite(total) ? total : null;
}

/**
 * The yearly rate at which dated cash flows are worth nothing today.
 *
 * Found by halving an interval, not by Newton's method: it always ends, and
 * it says there is no rate where there is none. There is one only where the
 * flows include money out and money in.
 */
function rateOfReturn(flows: Array<{ day: number; amount: number }>): number | null {
  if (!flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) return null;
  let low = -0.9999;
  let high = 100;
  const atLow = presentValue(flows, low);
  const atHigh = presentValue(flows, high);
  if (atLow === null || atHigh === null || Math.sign(atLow) === Math.sign(atHigh)) return null;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    const at = presentValue(flows, mid);
    if (at === null) return null;
    if (Math.abs(at) < 1e-7 || high - low < 1e-10) return mid;
    if (Math.sign(at) === Math.sign(atLow)) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Work out a computed field from its siblings.
 *
 * Returns null rather than 0 whenever any input is missing, and that
 * propagates: a variance against a figure nobody has recorded is not zero
 * variance, it is an unanswered question, and the two must never render the
 * same. Division by zero is null for the same reason.
 *
 * No parser and no eval — the formula is a tree, every leaf is a field key or
 * a literal, and there is nothing here that could execute a string.
 */
export function evaluateFormula(formula: CheckFormula, values: Record<string, CheckFieldValue>, outside?: FormulaOutside): number | null {
  switch (formula.op) {
    case 'const':
      return formula.value;
    case 'field':
      // A field of another set is read through `outside`, and only where it stands there.
      if (!formula.at) return fieldNumber(values[formula.key]);
      {
        const at = through(formula.at, formula.via, values);
        return at ? fieldNumber(outside?.read(at)) : null;
      }
    case 'figure': {
      const of = formula.of ? values[formula.of]?.value : undefined;
      if (formula.of && (typeof of !== 'string' || !of)) return null;
      return outside?.figure?.(formula.key, typeof of === 'string' ? of : undefined) ?? null;
    }
    case 'records': {
      const rows = outside?.records(formula.set);
      if (!rows) return null;
      if (formula.reduce === 'count') return rows.length;
      const amounts = rows.map((row) => fieldNumber(row[formula.field ?? ''])).filter((n): n is number => n !== null);
      if (formula.reduce === 'sum') return amounts.reduce((total, n) => total + n, 0);
      if (!amounts.length) return null;
      const least = Math.min(...amounts);
      const most = Math.max(...amounts);
      if (formula.reduce === 'min') return least;
      if (formula.reduce === 'max') return most;
      // How far apart the figures are, against the largest of them. One figure is no spread.
      return amounts.length < 2 || most === 0 ? null : ((most - least) / Math.abs(most)) * 100;
    }
    case 'min':
    case 'max': {
      const amounts = formula.of.map((part) => evaluateFormula(part, values, outside)).filter((n): n is number => n !== null);
      if (!amounts.length) return null;
      return formula.op === 'min' ? Math.min(...amounts) : Math.max(...amounts);
    }
    case 'if': {
      const holds = conditionHolds(formula.when, values, outside);
      // A condition that cannot be told yet gives no answer, not the "else".
      if (holds === null) return null;
      return evaluateFormula(holds ? formula.then : formula.else, values, outside);
    }
    case 'sum_if':
    case 'count_if': {
      const rows = formulaRows(formula.over, values, outside);
      if (rows === null) return null;
      const where = ownRows(formula.where, values, outside?.record);
      const met = where ? rows.filter((row) => rowMeets(row, where)) : [];
      if (formula.op === 'count_if') return met.length;
      return met.reduce((total, row) => total + (cellNumber(row[formula.column]) ?? 0), 0);
    }
    case 'rate': {
      const on = formula.on ? values[formula.on]?.value : undefined;
      if (formula.on && (typeof on !== 'string' || !on)) return null;
      const conditions: Record<string, string | number> = {};
      for (const [name, from] of Object.entries(formula.where ?? {})) {
        const given = 'value' in from ? from.value : values[from.field]?.value;
        if (given === null || given === undefined || given === '' || typeof given === 'boolean' || Array.isArray(given)) return null;
        conditions[name] = given;
      }
      return outside?.rate?.(formula.table, typeof on === 'string' ? on : undefined, conditions) ?? null;
    }
    case 'irr':
    case 'npv': {
      const rows = formulaRows(formula.over, values, outside);
      if (rows === null) return null;
      const flows = rows.flatMap((row) => {
        const day = dayNumber(row[formula.date]);
        const amount = cellNumber(row[formula.amount]);
        return day === null || amount === null ? [] : [{ day, amount }];
      });
      if (formula.op === 'npv') {
        const rate = evaluateFormula(formula.rate, values, outside);
        return rate === null || !flows.length ? null : presentValue(flows, rate / 100);
      }
      const rate = rateOfReturn(flows);
      return rate === null ? null : rate * 100;
    }
    case 'date':
      if (!formula.at) return dayNumber(values[formula.key]?.value);
      {
        const at = through(formula.at, formula.via, values);
        return at ? dayNumber(outside?.read(at)?.value) : null;
      }
    case 'today':
      return Math.floor((outside?.today ?? new Date()).getTime() / 86_400_000);
    case 'add_days': {
      const date = evaluateFormula(formula.date, values, outside);
      const days = evaluateFormula(formula.days, values, outside);
      return date === null || days === null ? null : date + Math.round(days);
    }
    case 'add_months': {
      const date = evaluateFormula(formula.date, values, outside);
      const months = evaluateFormula(formula.months, values, outside);
      if (date === null || months === null) return null;
      const from = new Date(date * 86_400_000);
      const day = from.getUTCDate();
      const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + Math.round(months), 1));
      // The same day of the month, or the month's last where it is shorter: 31 January and one month is 28 or 29 February.
      const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
      to.setUTCDate(Math.min(day, last));
      return Math.floor(to.getTime() / 86_400_000);
    }
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide': {
      const left = evaluateFormula(formula.left, values, outside);
      const right = evaluateFormula(formula.right, values, outside);
      if (left === null || right === null) return null;
      if (formula.op === 'add') return left + right;
      if (formula.op === 'subtract') return left - right;
      if (formula.op === 'multiply') return left * right;
      return right === 0 ? null : left / right;
    }
    case 'power': {
      const base = evaluateFormula(formula.left, values, outside);
      const exponent = evaluateFormula(formula.right, values, outside);
      if (base === null || exponent === null) return null;
      const raised = base ** exponent;
      /*
       * A negative base to a fractional exponent is NaN, and a large exponent
       * overflows to Infinity. Both are "no answer" rather than a number, and
       * this function's whole contract is that a missing answer is null — a
       * NaN escaping here would render as a figure somewhere downstream.
       */
      return Number.isFinite(raised) ? raised : null;
    }
    case 'variance_pct': {
      const left = evaluateFormula(formula.left, values, outside);
      const right = evaluateFormula(formula.right, values, outside);
      if (left === null || right === null || right === 0) return null;
      return ((left - right) / right) * 100;
    }
    case 'sum': {
      const rows = tableRows(values[formula.table]);
      if (rows === null) return null;
      let total = 0;
      for (const row of rows) {
        const cell = row[formula.column];
        const n = typeof cell === 'number' ? cell : Number(String(cell ?? '').replace(/[,\s]/g, ''));
        if (Number.isFinite(n)) total += n;
      }
      return total;
    }
    case 'count': {
      const rows = tableRows(values[formula.table]);
      return rows === null ? null : rows.length;
    }
    case 'days_between': {
      const left = values[formula.left]?.value;
      const right = values[formula.right]?.value;
      if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return null;
      const a = Date.parse(left);
      const b = Date.parse(right);
      if (Number.isNaN(a) || Number.isNaN(b)) return null;
      return Math.round((a - b) / 86_400_000);
    }
  }
}

/** The rows of a table field, or null when nothing has been entered. */
export function tableRows(value: CheckFieldValue | undefined): CheckTableRow[] | null {
  if (!value || !Array.isArray(value.value)) return null;
  const rows = value.value as (string | CheckTableRow)[];
  return rows.filter((r): r is CheckTableRow => typeof r === 'object' && r !== null);
}

/**
 * The values a holder may act on, with every computed field worked out.
 *
 * Only what stands is read: a proposed value and a disputed one are left out
 * before anything is computed, so no sum, no rule and no standing is ever
 * drawn from a value nobody has accepted. A field that mirrors another
 * (`sameAs`) reads the owner's value where the caller can reach it.
 */
export function withComputed(defs: CheckFieldDef[], values: Record<string, CheckFieldValue>, outside?: FormulaOutside, now: Date = new Date()): Record<string, CheckFieldValue> {
  const out = standingValues(values);
  for (const def of defs) {
    if (!def.sameAs) continue;
    const owner = outside?.read(def.sameAs);
    if (owner && !isBlank(owner)) out[def.key] = { ...owner, origin: { kind: 'field', address: def.sameAs } };
    else delete out[def.key];
  }
  for (const def of defs) {
    if (def.kind !== 'computed' || !def.formula) continue;
    out[def.key] = computedValue(def, evaluateFormula(def.formula, out, outside ?? { read: () => undefined, records: () => undefined, today: now }));
  }
  for (const def of defs) {
    if (def.kind !== 'status') continue;
    const standing = evaluateStatus(def, defs, out, now);
    out[def.key] = { value: standing?.label ?? null, at: '', by: 'computed' };
  }
  return out;
}

/** What a computed field holds for a formula's answer: a figure to its precision, or a date where the field yields one. */
export function computedValue(def: CheckFieldDef, result: number | null): CheckFieldValue {
  if (result === null) return { value: null, at: '', by: 'computed' };
  if (def.yields === 'date') return { value: dayOfNumber(Math.round(result)), at: '', by: 'computed' };
  const places = 10 ** (def.precision ?? 2);
  return { value: Math.round(result * places) / places, at: '', by: 'computed' };
}

/**
 * A status field's standing: the first of its cases whose rule fires, else
 * its `otherwise`, else nothing. The rule engine decides; nobody writes one.
 */
export function evaluateStatus(def: CheckFieldDef, defs: CheckFieldDef[], values: Record<string, CheckFieldValue>, now: Date = new Date()): { label: string; tone: Tone } | null {
  // With nothing recorded under any field its cases read, there is no standing yet: an untouched sheet is not "in order".
  // What counts as recorded is what this holder has of its own. A mirror of another function's field is that function's.
  const own = (key: string) => !defs.find((d) => d.key === key)?.sameAs;
  if (!(def.cases ?? []).some((option) => option.when.fields.some((key) => own(key) && !isBlank(values[key])))) return null;
  for (const option of def.cases ?? []) {
    if (checkInsights(defs, values, [option.when], now).length) return { label: option.label, tone: option.tone };
  }
  return def.otherwise ?? null;
}

/** The tone of a status field's value, or of a choice that carries one. */
export function fieldTone(def: CheckFieldDef, value: CheckFieldValue | undefined, optionSet?: (id: string) => OptionSet | undefined): Tone | undefined {
  if (isBlank(value)) return undefined;
  if (def.kind === 'status') return [...(def.cases ?? []), ...(def.otherwise ? [def.otherwise] : [])].find((c) => c.label === value!.value)?.tone;
  if (def.kind === 'enum') return fieldOptions(def, optionSet).find((o) => o.key === value!.value)?.tone;
  return undefined;
}

/** Render a value the way it should read in a report or a graph node. */
export function formatFieldValue(def: CheckFieldDef, value: CheckFieldValue | undefined, optionSet?: (id: string) => OptionSet | undefined): string {
  if (isBlank(value)) return '—';
  const raw = value!.value;
  if (def.optionSet && (def.kind === 'enum' || def.kind === 'multi_enum')) {
    const options = fieldOptions(def, optionSet);
    const label = (key: unknown) => options.find((o) => o.key === key)?.label ?? String(key);
    return Array.isArray(raw) ? raw.map(label).join(', ') : label(raw);
  }
  // A measure that says what it measures prints as it was typed, through the one formatter.
  if ((def.dimension || def.currency || value!.entered) && typeof raw === 'number' && def.kind !== 'percent') {
    const dimension = fieldDimension(def);
    if (dimension === 'money') return formatMoney(raw, def.currency, def.precision);
    if (def.dimension) return formatMeasure(raw, def.dimension, { entered: value!.entered, precision: def.precision });
    if (value!.entered?.text) return `${value!.entered.text} (${raw.toLocaleString('en-IN')}${def.unit ? ` ${def.unit}` : ''})`;
  }
  if (Array.isArray(raw)) {
    if (def.kind === 'table') return `${raw.length} row(s)`;
    // Evidence holds ids, and an id is not a thing to print at a reader. The
    // titles live on the project, which this function cannot see, so it says
    // how many and leaves the naming to whoever has the register.
    if (def.kind === 'evidence') return `${raw.length} document(s)`;
    return (raw as string[]).join(', ');
  }
  if (typeof raw === 'boolean') return raw ? 'yes' : 'no';
  if (def.kind === 'money' || def.kind === 'area' || def.kind === 'number' || def.kind === 'computed' || def.kind === 'duration') {
    const n = fieldNumber(value);
    if (n === null) return String(raw);
    return `${n.toLocaleString('en-IN')}${def.unit ? ` ${def.unit}` : ''}`;
  }
  if (def.kind === 'percent') return `${fieldNumber(value) ?? raw}%`;
  return String(raw);
}

/* ==================================================================== */
/* Observations, computed                                                */
/* ==================================================================== */

const DEFAULT_TOLERANCE = 0.01;

function fill(template: string, parts: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => parts[key] ?? `{${key}}`);
}

/**
 * What the recorded values say, on their own terms.
 *
 * Every rule is arithmetic against a declared tolerance, and every insight
 * names the two numbers it is about — so a reader can disagree with the
 * conclusion by checking the inputs, which is the only kind of automated
 * observation worth putting in front of a valuer.
 *
 * A field that has not been filled in produces NO insight. Silence about an
 * unknown is correct; "0 sqm, a 100% divergence" from an empty box is the
 * confident wrong answer this whole product exists to avoid.
 */
export function checkInsights(
  defs: CheckFieldDef[],
  values: Record<string, CheckFieldValue>,
  rules: CheckInsightRule[],
  // Injected rather than read from the clock inside, so an expiry rule is
  // testable and so a report rendered twice in one session cannot disagree
  // with itself about what "expired" meant.
  now: Date = new Date(),
): CheckInsight[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: CheckInsight[] = [];

  for (const rule of rules) {
    if (rule.kind === 'at_least' || rule.kind === 'at_most') {
      const [aKey, bKey] = rule.fields;
      const a = fieldNumber(values[aKey!]);
      const b = rule.against ?? fieldNumber(values[bKey!]);
      if (a === null || b === null) continue;
      if (rule.kind === 'at_least' ? a >= b : a <= b) continue;
      const figure = (key: string | undefined, n: number) => (key && byKey.get(key) && values[key] ? formatFieldValue(byKey.get(key)!, values[key]) : n.toLocaleString('en-IN'));
      out.push({ severity: rule.severity, text: fill(rule.say, { a: figure(aKey, a), b: rule.against !== undefined ? b.toLocaleString('en-IN') : figure(bKey, b) }), fields: rule.fields.filter(Boolean), computed: true });
      continue;
    }

    if (rule.kind === 'compare') {
      const [aKey, bKey] = rule.fields;
      const a = fieldNumber(values[aKey!]);
      const b = rule.against ?? fieldNumber(values[bKey!]);
      if (a === null || b === null) continue;
      const base = Math.max(Math.abs(a), Math.abs(b));
      if (base === 0) continue;
      const divergence = Math.abs(a - b) / base;
      const tolerance = rule.tolerance ?? DEFAULT_TOLERANCE;
      if (divergence <= tolerance) continue;
      out.push({
        severity: rule.severity,
        text: fill(rule.say, {
          a: formatFieldValue(byKey.get(aKey!)!, values[aKey!]),
          b: rule.against !== undefined ? b.toLocaleString('en-IN') : formatFieldValue(byKey.get(bKey!)!, values[bKey!]),
          divergence: `${(divergence * 100).toFixed(1)}%`,
          tolerance: `${(tolerance * 100).toFixed(1)}%`,
        }),
        fields: rule.against !== undefined ? [aKey!] : [aKey!, bKey!],
        computed: true,
      });
      continue;
    }

    if (rule.kind === 'before') {
      const [aKey, bKey] = rule.fields;
      const a = values[aKey!]?.value;
      const b = values[bKey!]?.value;
      if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) continue;
      if (a <= b) continue;
      out.push({ severity: rule.severity, text: fill(rule.say, { a, b }), fields: [aKey!, bKey!], computed: true });
      continue;
    }

    if (rule.kind === 'require') {
      const [aKey] = rule.fields;
      const value = values[aKey!];
      // Only fires once SOMETHING has been recorded on this check. A wholly
      // untouched check is not a finding, it is work not yet done, and the
      // progress figures already say so.
      if (Object.keys(values).length === 0) continue;
      if (!isBlank(value)) continue;
      out.push({ severity: rule.severity, text: fill(rule.say, {}), fields: [aKey!], computed: true });
      continue;
    }

    if (rule.kind === 'require_if') {
      // The gate has to have been answered before its consequence can be
      // demanded. An unanswered gate is a question, not a shortfall.
      const [gateKey, needKey] = rule.fields;
      const gate = values[gateKey!];
      if (isBlank(gate)) continue;
      const answer = String(gate!.value);
      if (rule.whenIn && !rule.whenIn.includes(answer)) continue;
      if (!isBlank(values[needKey!])) continue;
      out.push({
        severity: rule.severity,
        text: fill(rule.say, { a: formatFieldValue(byKey.get(gateKey!)!, gate) }),
        fields: [gateKey!, needKey!],
        computed: true,
      });
      continue;
    }

    if (rule.kind === 'row_expired' || rule.kind === 'row_missing') {
      const [tableKey] = rule.fields;
      const def = byKey.get(tableKey!);
      const rows = values[tableKey!]?.value;
      if (!def || def.kind !== 'table' || !Array.isArray(rows) || !rule.column) continue;

      for (const [index, entry] of (rows as CheckTableRow[]).entries()) {
        if (typeof entry !== 'object' || entry === null) continue;
        // The gate is what stops a register nagging about rows it should not.
        // A NOC marked "not required" has no expiry to be past and no
        // certificate to be missing.
        if (rule.gate && rule.whenIn && !rule.whenIn.includes(String(entry[rule.gate] ?? ''))) continue;

        const label = rowLabel(def, entry, index);
        const cell = entry[rule.column];

        if (rule.kind === 'row_missing') {
          if (cell !== null && cell !== undefined && String(cell).trim() !== '') continue;
          out.push({ severity: rule.severity, text: fill(rule.say, { row: label }), fields: [tableKey!], computed: true });
          continue;
        }

        // An expiry nobody recorded is a different fact from one in the past,
        // and only the second is this rule's business. `row_missing` is how you
        // ask about the first.
        if (typeof cell !== 'string' || !cell.trim()) continue;
        const when = new Date(`${cell}T00:00:00Z`);
        if (Number.isNaN(when.getTime()) || when.getTime() >= now.getTime()) continue;
        const days = Math.floor((now.getTime() - when.getTime()) / 86_400_000);
        out.push({
          severity: rule.severity,
          text: fill(rule.say, { row: label, a: cell, days: String(days) }),
          fields: [tableKey!],
          computed: true,
        });
      }
    }
  }

  return out;
}

/**
 * What to call one row of a table in a sentence.
 *
 * The first column's value, because in every table declared here that is the
 * identifying one — the NOC, the condition, the variation. Falling back to a
 * position keeps a sentence readable when the identifying cell is the blank
 * one being complained about.
 */
function rowLabel(def: CheckFieldDef, row: CheckTableRow, index: number): string {
  const first = def.columns?.[0];
  const value = first ? row[first.key] : undefined;
  return value !== null && value !== undefined && String(value).trim() ? String(value) : `row ${index + 1}`;
}

/* ==================================================================== */
/* Divergence against the line it was judged by                          */
/* ==================================================================== */

export interface ToleranceReading {
  /** What is being compared, in words. */
  label: string;
  aLabel: string;
  bLabel: string;
  a: number;
  b: number;
  /** Absolute relative difference, 0..1. */
  divergence: number;
  /** What the rule said was close enough, 0..1. */
  tolerance: number;
  /**
   * Divergence as a MULTIPLE of its own tolerance.
   *
   * This is the number that makes different checks comparable, and it is the
   * whole reason a chart of these is worth drawing. A 3% budget variance and
   * a 3% extent variance are not the same fact: one is inside a 5% threshold
   * and the other is triple a 1% one. Plotting raw percentages side by side
   * says they are equal. Plotting multiples of tolerance says which one is a
   * finding.
   *
   * `Infinity` when the tolerance is zero — an FAR above what the plan allows
   * is not "a lot over", it is a breach, and it should sit at the end of the
   * scale rather than be given a finite position that invites comparison.
   */
  overBy: number;
  within: boolean;
  severity: FindingSeverity;
  text: string;
}

/**
 * Every comparison this check makes, with how far past its own line it fell.
 *
 * Only rules with both numbers recorded appear. A comparison missing a side
 * is not a zero divergence, it is an unanswered question, and putting it on a
 * chart at the origin would read as the safest thing on the page.
 */
export function toleranceReadings(
  defs: CheckFieldDef[],
  values: Record<string, CheckFieldValue>,
  rules: CheckInsightRule[],
): ToleranceReading[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: ToleranceReading[] = [];

  for (const rule of rules) {
    if (rule.kind !== 'compare') continue;
    const [aKey, bKey] = rule.fields;
    const aDef = byKey.get(aKey!);
    const bDef = byKey.get(bKey!);
    if (!aDef || !bDef) continue;
    const a = fieldNumber(values[aKey!]);
    const b = fieldNumber(values[bKey!]);
    if (a === null || b === null) continue;
    const base = Math.max(Math.abs(a), Math.abs(b));
    if (base === 0) continue;

    const divergence = Math.abs(a - b) / base;
    const tolerance = rule.tolerance ?? 0.01;
    const overBy = tolerance === 0 ? (divergence === 0 ? 0 : Number.POSITIVE_INFINITY) : divergence / tolerance;
    out.push({
      label: `${aDef.label} vs ${bDef.label}`,
      aLabel: formatFieldValue(aDef, values[aKey!]),
      bLabel: formatFieldValue(bDef, values[bKey!]),
      a,
      b,
      divergence,
      tolerance,
      overBy,
      within: divergence <= tolerance,
      severity: rule.severity,
      text: rule.say,
    });
  }

  return out;
}

/** Everything a check's fields say, ready for the panel, the report or a tool. */
export interface CheckFieldReading {
  defs: CheckFieldDef[];
  /** The values that stand, with every computed field worked out from them. What anything that acts on a check reads. */
  values: Record<string, CheckFieldValue>;
  /** Everything stored, whatever its standing: a value that waits or is disputed is here and not in `values`. For the screen. */
  held: Record<string, CheckFieldValue>;
  insights: CheckInsight[];
  /** Every comparison on this check, and how far past its own line it fell. */
  tolerances: ToleranceReading[];
  /** Declared fields still blank. What the panel nudges toward, and what an agent should ask for. */
  missing: CheckFieldDef[];
  /**
   * Recorded, but with nothing on the evidence register behind it.
   *
   * Not an error and not a blocker — plenty of a diligence gets recorded from
   * a phone call before the certificate arrives. It is a distinct state that
   * a report has to be able to see, because a figure with a deed behind it
   * and a figure somebody remembered must never print the same.
   */
  unproven: CheckFieldDef[];
  filled: number;
  total: number;
}

export function readCheckFields(check: CheckInstance, defs: CheckFieldDef[], rules: CheckInsightRule[]): CheckFieldReading {
  const held = check.fields ?? {};
  const values = withComputed(defs, held);
  // A computed field is never "missing" — nobody can fill it in, and asking
  // somebody to would be asking for the wrong thing. Nor is one no longer asked.
  const answerable = defs.filter((d) => !fieldIsDerived(d) && !d.retired);
  // A value that waits for a person is not blank, and a field marked not applicable is answered.
  const answered = (d: CheckFieldDef) => !isBlank(values[d.key]) || ['proposed', 'disputed', 'not_applicable'].includes(fieldState(held[d.key]));
  return {
    defs,
    values,
    held,
    insights: checkInsights(defs, values, rules),
    tolerances: toleranceReadings(defs, values, rules),
    missing: answerable.filter((d) => d.required !== false && !answered(d)),
    unproven: answerable.filter(
      (d) => d.proof && d.proof !== 'none' && !isBlank(values[d.key]) && !values[d.key]?.sourceEvidenceId,
    ),
    filled: answerable.filter((d) => !isBlank(values[d.key])).length,
    total: answerable.length,
  };
}

/** The worst thing the numbers say, for a badge. */
export function worstInsight(insights: CheckInsight[]): FindingSeverity | null {
  const order: FindingSeverity[] = ['critical', 'high', 'medium', 'low'];
  for (const level of order) if (insights.some((i) => i.severity === level)) return level;
  return null;
}
