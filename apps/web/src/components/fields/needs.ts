/**
 * What the Needs you card shows, worked out apart from how it is drawn.
 *
 * A function opens on at most five lines in all, the most pressing first
 * across the five groups (Decide, Accept, Failing, Due soon, Missing). Each
 * group is a chip with its count that narrows the card to it, and one "Show
 * all" lifts the cap. Every line has one action that works: Accept where the
 * value can be accepted on this page, otherwise Open, which goes to the
 * sheet, the record or the check that holds it.
 */

import { NEED_KINDS, RECORD_AS_OFFERED, daySaid, fieldIsDerived, type CheckFieldDef, type DdProject, type FieldCatalog, type FieldException, type FieldView, type FunctionFields, type NeedKind } from '@realytica/shared';

/** How many lines the card opens on, across every group. */
export const NEEDS_SHOWN = 5;

/** The lines to draw: every group in order, or the one a chip narrowed to, capped at five until all are asked for. */
export function needLines(needs: FunctionFields['needs'], opts: { only?: NeedKind | null; all?: boolean } = {}): FieldException[] {
  const kinds = opts.only ? [opts.only] : NEED_KINDS;
  const lines = kinds.flatMap((kind) => needs[kind]);
  return opts.all ? lines : lines.slice(0, NEEDS_SHOWN);
}

/** The groups that hold something, each with its count: the card's chips. */
export function needChips(needs: FunctionFields['needs']): Array<{ kind: NeedKind; count: number }> {
  return NEED_KINDS.filter((kind) => needs[kind].length > 0).map((kind) => ({ kind, count: needs[kind].length }));
}

/**
 * Where a line sits, said once. The sheet's name is left out where the line's
 * own label already says it, and where the sheet is "Variations · VO-08" under
 * a line labelled "Variations", only the record is said.
 */
export function needWhere(exception: Pick<FieldException, 'label' | 'sheet'>): string {
  const { label, sheet } = exception;
  if (!sheet || sheet === label) return '';
  return sheet.startsWith(`${label} · `) ? sheet.slice(label.length + 3) : sheet;
}

/** A source as a line says it: the paper and its page, or the public source and the day it was read. Never a key. */
export function needSource(source: FieldException['source']): string {
  if (!source?.label) return '';
  if (source.page) return `${source.label}, p. ${source.page}`;
  return source.asOf ? `${source.label}, read ${daySaid(source.asOf)}` : source.label;
}

/** Where Open goes. */
export type NeedTarget =
  /** A sheet, a record or a depth sheet of this function, at a field where the line names one. */
  | { where: 'here'; set: string; record?: string; depth?: string; field?: string }
  /** The check that holds the value: a field here that only reads it cannot decide it. */
  | { where: 'check'; ddId: string; scopeId: string; checkId: string; field?: string }
  /** Another function's sheet that holds the value. */
  | { where: 'function'; fn: string; set: string; record?: string; field: string };

export type NeedAction = { kind: 'accept' } | { kind: 'situation'; key: string } | { kind: 'open'; target: NeedTarget } | { kind: 'none' };

function viewOf(page: FunctionFields, exception: FieldException): FieldView | undefined {
  const address = exception.address;
  if (!address) return undefined;
  const readings = [...page.sheets.flatMap((sheet) => (sheet.reading ? [sheet.reading] : (sheet.records ?? []))), ...page.shared.flatMap((shared) => shared.records)];
  return readings.find((reading) => reading.set.id === address.set && reading.recordId === address.record)?.fields.find((view) => view.def.key === address.field);
}

/**
 * Whether a line rests on a figure read from a rule row nobody has checked
 * against the instrument. Such a line is marked, so "failing" over a cap the
 * Act is said to set does not read as settled law.
 */
export function needRuleUnchecked(page: FunctionFields, exception: FieldException): boolean {
  if (exception.need !== 'failing' && exception.need !== 'due_soon') return false;
  // A line about a whole sheet says so itself; a line about one field is read off the field.
  return Boolean(exception.ruleUnchecked || viewOf(page, exception)?.cites?.some((cite) => !cite.verified));
}

/** The rule rows a marked line read, as a person reads them: what each is called and the day it is in force from. */
export function needRuleRows(page: FunctionFields, exception: FieldException): string {
  const cites = (exception.cites ?? viewOf(page, exception)?.cites ?? []).filter((cite) => !cite.verified);
  return cites.map((cite) => `${cite.label}, from ${daySaid(cite.from)}`).join('; ');
}

/** The fields nobody entered that a line's figure rests on: a usual value stands in for each. */
export function needAssumes(page: FunctionFields, exception: FieldException): string[] {
  if (exception.need !== 'failing' && exception.need !== 'due_soon') return [];
  return exception.assumes ?? viewOf(page, exception)?.assumes ?? [];
}

/** Whether a line offers words a model said are on a page and this server did not find there. */
export function needUnverified(exception: FieldException): boolean {
  return exception.kind === 'proposed' && exception.source?.proof === 'unverified';
}

/**
 * The place on this function's page a line is about. A value waiting beside
 * a field that reads another is drawn at that field (`shownAt`), and a record
 * a paper offered whole is the record, with no one field of it.
 */
function here(exception: FieldException): NeedTarget {
  const at = exception.shownAt ?? exception.address;
  const field = at?.field && at.field !== RECORD_AS_OFFERED ? at.field : undefined;
  return {
    where: 'here',
    set: at?.set ?? exception.key.split('::')[0]!,
    ...((exception.shownAt ? exception.shownAt.record : exception.record) ? { record: (exception.shownAt ? exception.shownAt.record : exception.record)! } : {}),
    ...(exception.depth ? { depth: exception.depth } : {}),
    ...(field ? { field } : {}),
  };
}

/**
 * The one action a line carries.
 *
 * A value offered for a field this page keeps is accepted here, by whoever
 * may decide in the function that holds it (`mayDecide` is asked of the
 * line's own address: a value waiting on a check or on a shared record is
 * decided there, and the server holds the same line). A value offered for a
 * field that is worked out or read from another place is never accepted
 * here: nobody decides a reading, so the line opens the check or the function
 * that holds the value. A line caused by another function's record opens that
 * record. Everything else opens where it sits.
 */
export function needAction(page: FunctionFields, exception: FieldException, mayDecide: boolean, project: Pick<DdProject, 'assessments'>, catalog: Pick<FieldCatalog, 'checks'>): NeedAction {
  if (exception.kind === 'situation') return mayDecide && exception.situation ? { kind: 'situation', key: exception.situation.split(':').pop()! } : { kind: 'none' };
  const def: CheckFieldDef | undefined = viewOf(page, exception)?.def;
  const holder = def?.sameAs;
  if (exception.kind === 'proposed' && !(def && fieldIsDerived(def))) return mayDecide ? { kind: 'accept' } : { kind: 'open', target: here(exception) };
  if (exception.kind === 'proposed' && holder) {
    if (catalog.checks.has(holder.set)) {
      for (const assessment of project.assessments) {
        for (const scope of assessment.scopes) {
          const check = scope.checks.find((held) => held.definitionId === holder.set);
          if (check) return { kind: 'open', target: { where: 'check', ddId: assessment.id, scopeId: scope.id, checkId: check.id, field: holder.field } };
        }
      }
    } else if (holder.fn !== page.fn) {
      return { kind: 'open', target: { where: 'function', fn: holder.fn, set: holder.set, ...(holder.record ? { record: holder.record } : {}), field: holder.field } };
    } else {
      return { kind: 'open', target: { where: 'here', set: holder.set, ...(holder.record ? { record: holder.record } : {}), field: holder.field } };
    }
  }
  // A line another function's record causes opens that record, where the thing to do is.
  if (exception.target && exception.target.fn !== page.fn) {
    return { kind: 'open', target: { where: 'function', fn: exception.target.fn, set: exception.target.set, ...(exception.target.record ? { record: exception.target.record } : {}), field: exception.target.field } };
  }
  return { kind: 'open', target: here(exception) };
}

/** A place on a function's sheets as an address carries it, and back: the set, the record and the field. */
export function sheetItem(target: { set: string; record?: string; field?: string }): string {
  return [target.set, target.record ?? '', target.field ?? ''].join('::').replace(/(::)+$/, '');
}

export function sheetItemOf(item: string | null | undefined): { set: string; record?: string; field?: string } | null {
  if (!item) return null;
  const [set, record, field] = item.split('::');
  return set ? { set, ...(record ? { record } : {}), ...(field ? { field } : {}) } : null;
}
