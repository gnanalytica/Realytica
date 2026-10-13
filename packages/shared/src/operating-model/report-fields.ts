/**
 * Reports assembled from fields.
 *
 * Three things a report block may read beside the registers: named fields
 * (`fields`), a table field or the records of a set that repeats
 * (`field_table`), and a chart of either (`field_chart`). Each is resolved by
 * code from what the project's sheets and checks hold, on every read, the
 * same way for the same project.
 *
 * What a block prints of a value is decided by where the value stands:
 *
 * - accepted, typed or worked out: the value as `formatFieldValue` gives it,
 *   units as written, with a footnote saying where it came from (the paper
 *   and its page, the public source and the day it was read, the person and
 *   the day);
 * - assumed: the usual value, marked "assumed", with what it is taken from;
 * - offered and not accepted, or disputed: the word "waiting" and never the
 *   value. A value nobody accepted is not a fact, and a report is where it
 *   would be read as one;
 * - worked out from a rule row: the row's citation, and "not verified" where
 *   nobody has checked the row against the instrument.
 *
 * A function's report is a template: sections in order, each a block of
 * fields, a table, a chart, a reading of the registers, or a place for a
 * person's own words with a cap on its length. A template is declared beside
 * the field set it reports (`FieldSet.reports`); the functions that keep
 * their fields on checks get one made from the checks. A person may then
 * move, add and remove blocks. No model writes any of it.
 */

import { fieldIsDerived, fieldNumber, formatFieldValue, isBlank, tableRows } from './check-fields';
import { workstreamDefinition } from './departments';
import { fieldCatalog, optionSetById, sharedSetsOf, type FieldCatalog } from './field-registry';
import { FIELD_SETS } from './field-sets';
import { CUSTOMER_SETS } from './field-sets/sales-marketing';
import { SHARED_FN, SHARED_RECORD_SETS } from './field-sets/shared-records';
import { fieldRecords, readSheet, refChoices, resolveFields, type FieldResolution, type FieldView } from './field-sheets';
import { fieldCatalogFor } from './firm-fields';
import { meetingDay } from './meetings';
import { departmentReportKind } from './report-blocks';
import { ruleSourceSaid } from './rule-tables';
import { statusPeriodSaid } from './status-report';
import { plural } from './text';
import { NA_REASON_LABEL } from './types';
import type {
  CheckFieldDef,
  CheckFieldValue,
  DdProject,
  FieldAddress,
  FieldReportSection,
  FieldReportTemplate,
  FieldSet,
  GeneratedReport,
  NaReason,
  ReportBlock,
  ReportBoundSource,
  ReportBoundSourceKind,
  ReportFootnote,
  ResolvedReportBlock,
} from './types';

/* ==================================================================== */
/* The three sources                                                     */
/* ==================================================================== */

export const FIELD_SOURCES: readonly ReportBoundSourceKind[] = ['fields', 'field_table', 'field_chart'];

export function isFieldSource(kind: string | undefined): boolean {
  return FIELD_SOURCES.includes(kind as ReportBoundSourceKind);
}

/** A block that read fields and was detached: it holds what the fields said that day, and is not typed into. */
export function isFrozenFieldBlock(block: Pick<ReportBlock, 'detachedAt' | 'detachedFrom'>): boolean {
  return Boolean(block.detachedAt && isFieldSource(block.detachedFrom));
}

/** The most characters a person's note in a report may hold, where the template that placed it sets no smaller cap. */
export const REPORT_NOTE_MOST = 2000;

/** The cap on one block's words. */
export function reportNoteCap(block: Pick<ReportBlock, 'cap'>): number {
  return Math.min(block.cap && block.cap > 0 ? block.cap : REPORT_NOTE_MOST, REPORT_NOTE_MOST);
}

/* ==================================================================== */
/* One value, as a report prints it                                      */
/* ==================================================================== */

export interface FieldPrinted {
  /** The value, or the word that stands in for one that may not be printed. */
  value: string;
  /** Where it stands, in a word or two. */
  standing: string;
  /** Where it came from, each a footnote. */
  notes: string[];
  /** A value was offered, or two are stated, and a person has not decided. */
  waits: boolean;
  /** Worked out from a rule row nobody has verified. */
  unverified: boolean;
}

const day = (iso: string | undefined): string => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? meetingDay(iso) : '');

/** The papers an evidence field holds, by their titles: an id is not a thing to print at a reader. */
function papersSaid(project: DdProject, value: CheckFieldValue | undefined): string | undefined {
  if (isBlank(value) || !Array.isArray(value!.value)) return undefined;
  return (value!.value as unknown[]).map((id) => project.evidence.find((row) => row.id === id)?.title ?? 'A paper not on this copy').join('; ');
}

/** What a report prints of one field: its value where that stands, and the word for where it does not. */
export function fieldPrinted(project: DdProject, view: FieldView): FieldPrinted {
  const held = view.held;
  if (view.state === 'proposed') {
    return { value: 'waiting', standing: 'waiting', notes: ['A value has been offered for this field and waits for a person to accept it.'], waits: true, unverified: false };
  }
  if (view.state === 'disputed') {
    return { value: 'waiting', standing: 'waiting', notes: ['Two values are stated for this field. Neither stands until a person keeps one.'], waits: true, unverified: false };
  }
  if (view.state === 'not_applicable') {
    const reason = NA_REASON_LABEL[held?.naReason as NaReason];
    return { value: 'Not applicable', standing: reason ? reason.toLowerCase() : 'not applicable', notes: [], waits: false, unverified: false };
  }
  if (view.state === 'empty' || isBlank(held)) {
    // Something offered beside an empty field is still waiting, not missing.
    const offered = view.waiting.length > 0;
    return offered
      ? { value: 'waiting', standing: 'waiting', notes: ['A value has been offered for this field and waits for a person to accept it.'], waits: true, unverified: false }
      : { value: '—', standing: 'not recorded', notes: [], waits: false, unverified: false };
  }

  const def = view.def;
  const value = def.kind === 'evidence' ? (papersSaid(project, held) ?? view.text) : view.text;
  const notes: string[] = [];
  const source = view.source;
  const decided = held!.acceptedBy ? `accepted by ${held!.acceptedBy}${day(held!.acceptedAt) ? ` on ${day(held!.acceptedAt)}` : ''}` : '';
  if (source?.kind === 'paper') notes.push([`${source.label}${source.page ? `, p. ${source.page}` : ''}`, decided].filter(Boolean).join('; '));
  else if (source?.kind === 'external') notes.push([`${source.label}${source.asOf ? `, read ${day(source.asOf) || source.asOf}` : ''}`, decided].filter(Boolean).join('; '));
  else if (source?.kind === 'field') notes.push(`Read from ${source.label}.`.replace(/\.\.$/, '.'));
  else if (source?.kind === 'default') notes.push(`A usual value${source.label ? `: ${source.label}` : ''}. It gives way when a value is recorded.`);
  else if (!fieldIsDerived(def) && held!.by && held!.by !== 'computed') notes.push(`Entered by ${held!.by}${day(held!.at) ? ` on ${day(held!.at)}` : ''}`);

  const cites = view.cites ?? [];
  for (const cite of cites) {
    notes.push(`${cite.label}, ${cite.value.toLocaleString('en-IN')}${cite.unit ? ` ${cite.unit}` : ''}: ${ruleSourceSaid(cite.source)}, in force from ${day(cite.from) || cite.from}${cite.verified ? '' : '; not verified'}`);
  }
  const unverified = cites.some((cite) => !cite.verified);
  // A figure worked out from a usual value nobody entered says so, and names the fields that stood in.
  const assumes = view.assumes ?? [];
  if (assumes.length) notes.push(`Rests on a usual value nobody entered: ${assumes.join(', ')}.`);
  const worked = assumes.length ? 'worked out, on an assumed value' : 'worked out';
  const standing = view.state === 'assumed' ? 'assumed' : def.kind === 'computed' || def.kind === 'status' ? worked : view.state === 'typed' ? 'entered' : 'accepted';
  return { value, standing: unverified ? `${standing}, not verified` : standing, notes, waits: false, unverified };
}

/** Numbers each distinct footnote once, in the order first met. */
function footnoter() {
  const all: ReportFootnote[] = [];
  return {
    all,
    /** The marks for these notes, as they are appended to a value: " [1] [2]". */
    mark(notes: readonly string[]): string {
      return notes
        .map((text) => {
          let note = all.find((held) => held.text === text);
          if (!note) all.push((note = { n: all.length + 1, text }));
          return ` [${note.n}]`;
        })
        .join('');
    },
  };
}

interface Reading {
  catalog: FieldCatalog;
  resolution: FieldResolution;
  at: Date;
  sheets: Map<string, ReturnType<typeof readSheet>>;
}

function reading(project: DdProject, at: Date, catalog: FieldCatalog): Reading {
  return { catalog, resolution: resolveFields(project, at, catalog), at, sheets: new Map() };
}

function sheetRead(project: DdProject, into: Reading, setId: string, recordId?: string) {
  const key = `${setId}::${recordId ?? ''}`;
  if (!into.sheets.has(key)) into.sheets.set(key, readSheet(project, setId, recordId, into.resolution, into.catalog, into.at));
  return into.sheets.get(key);
}

/** The holders a field named without a record is read from: the one sheet, or each record of a set that repeats. */
function holdersOf(project: DdProject, set: FieldSet, address: Pick<FieldAddress, 'record'>): Array<string | undefined> {
  if (!set.records) return [undefined];
  return address.record ? [address.record] : fieldRecords(project, set.id).map((record) => record.id);
}

const NOTE_WAITING = (n: number): string => `${plural(n, 'value')} ${n === 1 ? 'waits' : 'wait'} for a person and ${n === 1 ? 'is' : 'are'} not printed.`;
const NOTE_UNVERIFIED = 'A figure marked not verified was worked out from a rule row nobody has checked against the instrument.';

/* ---- fields ---------------------------------------------------------- */

interface FieldRow {
  address: FieldAddress;
  label: string;
  where: string;
  printed: FieldPrinted;
}

/** Every field decided inside a period, oldest first: what a status report says of the sheets. */
function decidedIn(project: DdProject, into: Reading, from: string, to: string): FieldRow[] {
  const rows: Array<FieldRow & { on: string }> = [];
  for (const set of into.catalog.sets.values()) {
    for (const recordId of holdersOf(project, set, {})) {
      const sheet = sheetRead(project, into, set.id, recordId);
      for (const view of sheet?.fields ?? []) {
        if (fieldIsDerived(view.def) || isBlank(view.held)) continue;
        if (view.state !== 'accepted' && view.state !== 'typed') continue;
        const on = view.held!.acceptedAt ?? view.held!.at;
        if (!on || on < from || on >= to) continue;
        rows.push({ address: view.address, label: view.def.label, where: set.records ? `${set.title} · ${sheet!.title}` : set.title, printed: fieldPrinted(project, view), on });
      }
    }
  }
  return rows.sort((a, b) => a.on.localeCompare(b.on));
}

function resolveFieldsBlock(project: DdProject, source: ReportBoundSource, at: Date, catalog: FieldCatalog): ResolvedReportBlock {
  const into = reading(project, at, catalog);
  const period = source.from && source.to && !source.addresses?.length ? { from: source.from, to: source.to } : undefined;
  const rows: FieldRow[] = [];
  if (period) rows.push(...decidedIn(project, into, period.from, period.to));
  for (const address of period ? [] : (source.addresses ?? [])) {
    const set = into.catalog.sets.get(address.set);
    const def = set?.fields.find((field) => field.key === address.field);
    if (!set || !def) {
      rows.push({ address, label: address.field, where: address.set, printed: { value: '—', standing: 'no longer declared', notes: [], waits: false, unverified: false } });
      continue;
    }
    for (const recordId of holdersOf(project, set, address)) {
      const sheet = sheetRead(project, into, set.id, recordId);
      const view = sheet?.fields.find((held) => held.def.key === def.key);
      // A field that is not in play is not asked for, and a report does not ask for it either.
      if (!view || view.shown === 'hidden') continue;
      rows.push({ address: view.address, label: def.label, where: set.records ? `${set.title} · ${sheet!.title}` : set.title, printed: fieldPrinted(project, view) });
    }
  }
  if (!rows.length) {
    return {
      lines: [],
      recordIds: [],
      note: period ? `No field was recorded in ${statusPeriodSaid(period)}.` : source.addresses?.length ? 'None of these fields is in play on this project.' : 'No field is chosen for this section.',
    };
  }
  const notes = footnoter();
  const several = new Set(rows.map((row) => row.where)).size > 1;
  const marked = rows.map((row) => ({ row, value: `${row.printed.value}${notes.mark(row.printed.notes)}` }));
  const waiting = rows.filter((row) => row.printed.waits).length;
  const said = [waiting ? NOTE_WAITING(waiting) : '', rows.some((row) => row.printed.unverified) ? NOTE_UNVERIFIED : ''].filter(Boolean).join(' ');
  return {
    lines: marked.map(({ row, value }) => `${several ? `${row.where} · ` : ''}${row.label}: ${value} · ${row.printed.standing}`),
    recordIds: rows.map(() => ''),
    ...(source.layout === 'list'
      ? {}
      : {
          table: {
            columns: [...(several ? ['Where'] : []), 'Field', 'Value', 'Standing'],
            rows: marked.map(({ row, value }) => ({ cells: [...(several ? [row.where] : []), row.label, value, row.printed.standing], address: row.address })),
          },
        }),
    ...(notes.all.length ? { footnotes: notes.all } : {}),
    ...(said ? { note: said } : {}),
  };
}

/* ---- field_table ----------------------------------------------------- */

/** One cell of a table field, as its column says to print it. A link reads as the name of what it links to. */
function cellSaid(project: DdProject, into: Reading, column: CheckFieldDef, raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (column.kind === 'ref') return refChoices(project, column.target, into.catalog).find((choice) => choice.id === raw)?.label ?? String(raw);
  return formatFieldValue(column, { value: raw as CheckFieldValue['value'], at: '', by: '' }, (id) => optionSetById(id, into.catalog));
}

interface Tabled {
  columns: Array<{ key: string; label: string; def: CheckFieldDef }>;
  /** Each row as printed, with the raw figures a chart draws. */
  rows: Array<{ cells: string[]; raw: Record<string, unknown>; address: FieldAddress }>;
  footnotes: ReportFootnote[];
  waiting: number;
  unverified: boolean;
  /** Said where there is nothing to print. */
  empty?: string;
  /** The standing of a table field as a whole. */
  standing?: string;
  mark?: string;
}

/** A table field, or the records of a set that repeats, as rows of printed cells. */
function tabled(project: DdProject, source: ReportBoundSource, at: Date, catalog: FieldCatalog, wanted: string[] | undefined): Tabled {
  const into = reading(project, at, catalog);
  const notes = footnoter();
  const none = (empty: string): Tabled => ({ columns: [], rows: [], footnotes: [], waiting: 0, unverified: false, empty });

  if (source.records) {
    const set = into.catalog.sets.get(source.records);
    if (!set?.records) return none('The set this section reads is no longer declared.');
    const keys = wanted?.length ? wanted : [set.records.titleField, ...set.records.summaryFields];
    const columns = keys.flatMap((key) => {
      const def = set.fields.find((field) => field.key === key);
      return def ? [{ key, label: def.label, def }] : [];
    });
    let waiting = 0;
    let unverified = false;
    const rows = fieldRecords(project, set.id).flatMap((record) => {
      const sheet = sheetRead(project, into, set.id, record.id);
      if (!sheet) return [];
      const raw: Record<string, unknown> = {};
      // One record's values mostly come from one place: a footnote is marked once in a row, where it is first met.
      const marked = new Set<string>();
      const once = (texts: string[]) => texts.filter((text) => !marked.has(text) && Boolean(marked.add(text)));
      const cells = columns.map((column) => {
        const view = sheet.fields.find((held) => held.def.key === column.key)!;
        if (view.shown === 'hidden') return '';
        const printed = fieldPrinted(project, view);
        if (printed.waits) waiting += 1;
        else if (!isBlank(view.held)) raw[column.key] = view.held!.value;
        unverified ||= printed.unverified;
        const standing = printed.standing === 'assumed' || printed.unverified ? ` (${printed.standing})` : '';
        return printed.standing === 'not recorded' ? '' : `${printed.value}${standing}${notes.mark(once(printed.notes))}`;
      });
      // A record nothing of which stands or waits is not one yet.
      return cells.some(Boolean) ? [{ cells, raw, address: { fn: set.fn, set: set.id, field: set.records!.titleField, record: record.id } }] : [];
    });
    return { columns, rows, footnotes: notes.all, waiting, unverified, ...(rows.length ? {} : { empty: `No ${set.records.of} is recorded yet.` }) };
  }

  const address = source.address;
  const set = address ? into.catalog.sets.get(address.set) : undefined;
  const def = set?.fields.find((field) => field.key === address!.field);
  if (!address || !set || !def) return none(address ? 'The table this section reads is no longer declared.' : 'No table is chosen for this section.');
  if (def.kind !== 'table') return none(`${def.label} is not a table.`);
  const recordId = set.records ? address.record : undefined;
  const view = sheetRead(project, into, set.id, recordId)?.fields.find((held) => held.def.key === def.key);
  if (!view || view.shown === 'hidden') return none(`${def.label} is not in play on this project.`);
  const printed = fieldPrinted(project, view);
  if (printed.waits) return { ...none(`${def.label}: rows have been offered and wait for a person to accept them. They are not printed.`), waiting: 1 };
  const all = def.columns ?? [];
  const columns = (wanted?.length ? wanted.flatMap((key) => all.filter((column) => column.key === key)) : all).map((column) => ({ key: column.key, label: column.label, def: column }));
  const held = tableRows(view.held) ?? [];
  const rows = held.map((row) => ({ cells: columns.map((column) => cellSaid(project, into, column.def, row[column.key])), raw: row as Record<string, unknown>, address: view.address }));
  return {
    columns,
    rows,
    footnotes: notes.all,
    waiting: 0,
    unverified: printed.unverified,
    standing: printed.standing,
    mark: notes.mark(printed.notes),
    ...(rows.length ? {} : { empty: `${def.label}: no row is recorded yet.` }),
  };
}

function resolveFieldTable(project: DdProject, source: ReportBoundSource, at: Date, catalog: FieldCatalog): ResolvedReportBlock {
  const read = tabled(project, source, at, catalog, source.columns);
  if (!read.rows.length) return { lines: [], recordIds: [], note: read.empty };
  const said = [
    read.standing ? `${plural(read.rows.length, 'row')}, ${read.standing}${read.mark ?? ''}.` : '',
    read.waiting ? NOTE_WAITING(read.waiting) : '',
    read.unverified ? NOTE_UNVERIFIED : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    lines: read.rows.map((row) => row.cells.map((cell, i) => (cell ? `${read.columns[i]!.label}: ${cell}` : '')).filter(Boolean).join(' · ')),
    recordIds: read.rows.map(() => ''),
    table: { columns: read.columns.map((column) => column.label), rows: read.rows.map((row) => ({ cells: row.cells, address: row.address })) },
    ...(read.footnotes.length ? { footnotes: read.footnotes } : {}),
    ...(said ? { note: said } : {}),
  };
}

/* ---- field_chart ----------------------------------------------------- */

function resolveFieldChart(project: DdProject, source: ReportBoundSource, at: Date, catalog: FieldCatalog): ResolvedReportBlock {
  if (!source.x || !source.y) return { lines: [], recordIds: [], note: 'This chart has not been told which column to draw.' };
  const read = tabled(project, source, at, catalog, [source.x, source.y]);
  if (read.columns.length < 2) return { lines: [], recordIds: [], note: read.empty ?? 'A column this chart draws is no longer declared.' };
  const [x, y] = [read.columns[0]!, read.columns[1]!];
  const points = read.rows.flatMap((row) => {
    const figure = fieldNumber({ value: row.raw[y.key] as CheckFieldValue['value'], at: '', by: '' });
    return figure === null || !row.cells[0] ? [] : [{ label: row.cells[0].replace(/( \[\d+\])+$/, ''), value: figure, said: row.cells[1]!, address: row.address }];
  });
  const left = read.rows.length - points.length;
  if (!points.length) return { lines: [], recordIds: [], note: read.empty ?? `No ${y.label.toLowerCase()} stands to be drawn yet.${read.waiting ? ` ${NOTE_WAITING(read.waiting)}` : ''}` };
  const said = [
    read.standing ? `${plural(points.length, 'figure')}, ${read.standing}${read.mark ?? ''}.` : '',
    left ? `${plural(left, 'row')} with no ${y.label.toLowerCase()} that stands ${left === 1 ? 'is' : 'are'} not drawn.` : '',
    read.waiting ? NOTE_WAITING(read.waiting) : '',
    read.unverified ? NOTE_UNVERIFIED : '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    lines: points.map((point) => `${point.label}: ${point.said}`),
    recordIds: points.map(() => ''),
    table: { columns: [x.label, y.label], rows: points.map((point) => ({ cells: [point.label, point.said], address: point.address })) },
    chart: { mark: source.mark ?? 'bar', x: x.label, y: y.label, points: points.map(({ label, value, said: text }) => ({ label, value, said: text })) },
    ...(read.footnotes.length ? { footnotes: read.footnotes } : {}),
    ...(said ? { note: said } : {}),
  };
}

/** One block that reads fields, resolved from what the project holds now. */
export function resolveFieldBlock(project: DdProject, source: ReportBoundSource, at: Date = new Date(), catalog: FieldCatalog = fieldCatalogFor(project)): ResolvedReportBlock {
  if (source.kind === 'field_table') return resolveFieldTable(project, source, at, catalog);
  if (source.kind === 'field_chart') return resolveFieldChart(project, source, at, catalog);
  return resolveFieldsBlock(project, source, at, catalog);
}

/** What a frozen field block shows: what the fields said the day it was issued or detached. */
export function frozenFieldBlock(block: ReportBlock): ResolvedReportBlock {
  return {
    lines: block.frozen ?? (block.text ? block.text.split('\n').filter(Boolean) : []),
    recordIds: block.frozenRecordIds ?? [],
    ...(block.frozenTable ? { table: block.frozenTable } : {}),
    ...(block.frozenFootnotes?.length ? { footnotes: block.frozenFootnotes } : {}),
    ...(block.frozenChart ? { chart: block.frozenChart } : {}),
    ...(block.frozenNote ? { note: block.frozenNote } : {}),
  };
}

/** Keep on a block what it reads now, for the day it stops reading. */
export function freezeFieldBlock(block: ReportBlock, resolved: ResolvedReportBlock): void {
  block.frozen = resolved.lines;
  block.frozenRecordIds = resolved.recordIds;
  if (resolved.table) block.frozenTable = resolved.table;
  else delete block.frozenTable;
  if (resolved.footnotes?.length) block.frozenFootnotes = resolved.footnotes;
  else delete block.frozenFootnotes;
  if (resolved.chart) block.frozenChart = resolved.chart;
  else delete block.frozenChart;
  if (resolved.note) block.frozenNote = resolved.note;
  else delete block.frozenNote;
}

/** Take off a block what it kept while frozen, when it reads the fields again. */
export function thawFieldBlock(block: ReportBlock): void {
  delete block.frozen;
  delete block.frozenRecordIds;
  delete block.frozenTable;
  delete block.frozenFootnotes;
  delete block.frozenChart;
  delete block.frozenNote;
}

/* ==================================================================== */
/* What a field source may ask for                                       */
/* ==================================================================== */

const CHARTED = new Set(['number', 'money', 'area', 'percent', 'duration', 'computed']);

/** What is wrong with a field source, in a sentence a person can act on. Nothing for one that can be read. */
export function fieldSourceFault(source: ReportBoundSource, catalog: FieldCatalog = fieldCatalog()): string | undefined {
  if (!isFieldSource(source.kind)) return undefined;
  const fieldAt = (address: FieldAddress): { set?: FieldSet; def?: CheckFieldDef } => {
    const set = catalog.sets.get(address.set);
    return { set, def: set?.fields.find((field) => field.key === address.field) };
  };
  if (source.kind === 'fields') {
    for (const address of source.addresses ?? []) {
      const { set, def } = fieldAt(address);
      if (!set || !def) return `There is no field “${address.field}” on “${address.set}”.`;
      if (address.fn !== set.fn) return `“${def.label}” is a field of ${set.fn}, not of ${address.fn}.`;
    }
    if ((source.addresses ?? []).length > 60) return 'A section prints sixty fields at most. Split it in two.';
    return undefined;
  }
  let columns: CheckFieldDef[];
  if (source.records) {
    const set = catalog.sets.get(source.records);
    if (!set?.records) return `“${source.records}” is not a set of records.`;
    columns = set.fields;
  } else {
    if (!source.address) return 'Name the table this section reads.';
    const { def } = fieldAt(source.address);
    if (!def) return `There is no field “${source.address.field}” on “${source.address.set}”.`;
    if (def.kind !== 'table') return `“${def.label}” is not a table.`;
    columns = def.columns ?? [];
  }
  const has = (key: string | undefined) => columns.find((column) => column.key === key);
  for (const key of source.columns ?? []) if (!has(key)) return `There is no column “${key}” to print.`;
  if (source.kind === 'field_chart') {
    if (!has(source.x)) return 'Name the column along the foot of the chart.';
    const y = has(source.y);
    if (!y) return 'Name the column the chart draws.';
    if (!CHARTED.has(y.kind)) return `“${y.label}” is not a figure, so there is nothing to draw.`;
  }
  return undefined;
}

/** What a section that reads fields is called where nobody has named it: the set it reads, or the function where it reads several. */
export function fieldSourceHeading(source: ReportBoundSource, catalog: FieldCatalog = fieldCatalog()): string | undefined {
  if (!isFieldSource(source.kind)) return undefined;
  const sets = [...new Set([...(source.addresses ?? []), ...(source.address ? [source.address] : [])].map((address) => address.set)), ...(source.records ? [source.records] : [])];
  const first = catalog.sets.get(sets[0] ?? '');
  if (!first) return undefined;
  if (sets.length === 1) return source.address ? (first.fields.find((field) => field.key === source.address!.field)?.label ?? first.title) : first.title;
  return workstreamDefinition(first.fn)?.label ?? first.title;
}

/* ==================================================================== */
/* Templates                                                             */
/* ==================================================================== */

export type FunctionReportTemplate = FieldReportTemplate & { fn: string; set?: string };

/**
 * The functions that keep their fields on checks and whose department hands
 * over a report: each gets a template made from its checks, one section for
 * each check's fields and one for each table, with a note at the end.
 */
function checkTemplates(catalog: FieldCatalog): FunctionReportTemplate[] {
  const byFn = new Map<string, FieldSet[]>();
  for (const id of catalog.checks) {
    const set = catalog.sets.get(id)!;
    byFn.set(set.fn, [...(byFn.get(set.fn) ?? []), set]);
  }
  const out: FunctionReportTemplate[] = [];
  for (const [fn, sets] of byFn) {
    const workstream = workstreamDefinition(fn);
    if (!workstream || !departmentReportKind(workstream.department)) continue;
    const sections: FieldReportSection[] = [];
    for (const set of sets) {
      const plain = set.fields.filter((def) => def.kind !== 'table' && !def.retired);
      if (plain.length) sections.push({ heading: set.title, fields: plain.map((def) => ({ fn, set: set.id, field: def.key })) });
      for (const def of set.fields) if (def.kind === 'table' && !def.retired) sections.push({ heading: `${set.title}: ${def.label.toLowerCase()}`, table: { fn, set: set.id, field: def.key } });
    }
    sections.push({ heading: 'Remarks', note: { maxLength: 600, hint: 'What a reader should know that no field holds.' } });
    out.push({ id: `${fn}.checks`, fn, title: `${workstream.label}: recorded fields`, sections });
  }
  return out;
}

let templates: FunctionReportTemplate[] | undefined;

/** Every report template: those declared on a field set, then those made from the checks. */
export function functionReportTemplates(): FunctionReportTemplate[] {
  templates ??= [
    ...FIELD_SETS.flatMap((set) => (set.reports ?? []).map((template) => ({ ...template, fn: template.fn ?? set.fn, set: set.id }))),
    ...checkTemplates(fieldCatalog()),
  ];
  return templates;
}

export function functionReportTemplate(id: string | undefined): FunctionReportTemplate | undefined {
  return functionReportTemplates().find((template) => template.id === id);
}

/** The templates of one function. */
export function functionReportTemplatesOf(fn: string): FunctionReportTemplate[] {
  return functionReportTemplates().filter((template) => template.fn === fn);
}

/** A field a template names: by its key on the template's own set, or by its whole address. */
function addressIn(template: FunctionReportTemplate, named: string | FieldAddress): FieldAddress {
  return typeof named === 'string' ? { fn: template.fn, set: template.set ?? '', field: named } : named;
}

export interface TemplateBlock {
  heading: string;
  source?: ReportBoundSource;
  text?: string;
  cap?: number;
  hint?: string;
}

/** What a report made from a template opens as: one block for each section, in order. */
export function templateBlocks(template: FunctionReportTemplate): TemplateBlock[] {
  return template.sections.map((section): TemplateBlock => {
    if ('fields' in section) return { heading: section.heading, source: { kind: 'fields', addresses: section.fields.map((named) => addressIn(template, named)), ...(section.layout ? { layout: section.layout } : {}) } };
    if ('table' in section) return { heading: section.heading, source: { kind: 'field_table', address: addressIn(template, section.table), ...(section.columns ? { columns: section.columns } : {}) } };
    if ('records' in section) return { heading: section.heading, source: { kind: 'field_table', records: section.records, ...(section.columns ? { columns: section.columns } : {}) } };
    if ('chart' in section) {
      const of = section.chart.of;
      const what = typeof of === 'object' && 'records' in of ? { records: of.records } : { address: addressIn(template, of) };
      return { heading: section.heading, source: { kind: 'field_chart', ...what, x: section.chart.x, y: section.chart.y, mark: section.chart.mark ?? 'bar' } };
    }
    if ('note' in section) return { heading: section.heading, text: '', cap: Math.min(section.note.maxLength, REPORT_NOTE_MOST), ...(section.note.hint ? { hint: section.note.hint } : {}) };
    return { heading: section.heading, source: section.register };
  });
}

/** What is wrong with the templates, each fault in a sentence naming the template. Empty where every one can be used. */
export function reportTemplateFaults(all: readonly FunctionReportTemplate[] = functionReportTemplates(), catalog: FieldCatalog = fieldCatalog()): string[] {
  const faults: string[] = [];
  const seen = new Set<string>();
  for (const template of all) {
    const at = `Report “${template.id}”`;
    if (seen.has(template.id)) faults.push(`${at}: another template has this id.`);
    seen.add(template.id);
    if (!template.title.trim()) faults.push(`${at}: needs a title.`);
    if (!workstreamDefinition(template.fn)) faults.push(`${at}: “${template.fn}” is not a function.`);
    if (!template.sections.length) faults.push(`${at}: has no section.`);
    template.sections.forEach((section, index) => {
      if (!section.heading.trim()) faults.push(`${at}, section ${index + 1}: needs a heading.`);
      if ('note' in section) {
        if (!(section.note.maxLength > 0) || section.note.maxLength > REPORT_NOTE_MOST) faults.push(`${at}, “${section.heading}”: a note is capped at between 1 and ${REPORT_NOTE_MOST} characters.`);
        return;
      }
      if ('register' in section) {
        if (isFieldSource(section.register.kind)) faults.push(`${at}, “${section.heading}”: name fields with fields, table, records or chart.`);
        return;
      }
    });
    for (const block of templateBlocks(template)) {
      const fault = block.source ? fieldSourceFault(block.source, catalog) : undefined;
      if (fault) faults.push(`${at}, “${block.heading}”: ${fault}`);
    }
  }
  return faults;
}

/* ==================================================================== */
/* The status report and the owner pack                                  */
/* ==================================================================== */

/** Whether a project's sheets or checks hold any field at all. A project that keeps none has nothing for a field section to say. */
export function projectHoldsFields(project: DdProject): boolean {
  if (Object.values(project.fieldSheets ?? {}).some((sheet) => Object.keys(sheet.values).length > 0 || (sheet.records ?? []).length > 0)) return true;
  return project.assessments.some((assessment) => assessment.scopes.some((scope) => scope.checks.some((check) => Object.keys(check.fields ?? {}).length > 0)));
}

/** The section a status report carries beside its three: the fields decided in its period. */
export function statusFieldsBlock(period: { from: string; to: string }): TemplateBlock {
  return { heading: `Fields recorded, ${statusPeriodSaid(period)}`, source: { kind: 'fields', from: period.from, to: period.to } };
}

/**
 * The fields an owner pack prints under its sections, where a project keeps
 * them: the dates and figures the pack otherwise tells from the schedule and
 * the Cost Report, as the functions' own fields record them.
 */
export const OWNER_PACK_FIELDS: Record<'time' | 'cost', FieldAddress[]> = {
  time: [
    { fn: 'construction.progress', set: 'schedule_progress.forecast_completion', field: 'contractual_completion' },
    { fn: 'construction.progress', set: 'schedule_progress.forecast_completion', field: 'baseline_completion' },
    { fn: 'construction.progress', set: 'schedule_progress.forecast_completion', field: 'forecast_completion' },
    { fn: 'construction.progress', set: 'schedule_progress.planned_vs_actual', field: 'planned_percent' },
    { fn: 'construction.progress', set: 'schedule_progress.planned_vs_actual', field: 'actual_percent' },
  ],
  cost: [
    { fn: 'finance.budget', set: 'cost_quantity.budget_current', field: 'sanctioned_budget' },
    { fn: 'finance.budget', set: 'cost_quantity.budget_current', field: 'current_forecast' },
    { fn: 'finance.budget', set: 'cost_quantity.budget_current', field: 'spent_to_date' },
    { fn: 'finance.budget', set: 'cost_quantity.forecast', field: 'forecast_at_completion' },
    { fn: 'finance.budget', set: 'cost_quantity.forecast', field: 'forecast_dated' },
    { fn: 'finance.budget', set: 'cost_quantity.forecast', field: 'contingency_left' },
  ],
};

/** A pack section's fields, or nothing where none of them is recorded or waiting: a project that keeps none reads as it did. */
export function ownerPackFields(project: DdProject, section: 'time' | 'cost', at: Date = new Date()): ResolvedReportBlock | undefined {
  const resolved = resolveFieldBlock(project, { kind: 'fields', addresses: OWNER_PACK_FIELDS[section] }, at);
  const holds = (resolved.table?.rows ?? []).some((row) => row.cells.at(-1) !== 'not recorded');
  return holds ? resolved : undefined;
}

/* ==================================================================== */
/* A copy handed to somebody outside                                     */
/* ==================================================================== */

/**
 * The reports of a copy made for somebody working from a grant, with what
 * its field blocks say of functions out of their reach taken out.
 *
 * A block that names a field of a function they are not handed is left out
 * whole, live or frozen: its values are not theirs to read. A frozen block
 * that read every field of a period keeps only the rows of functions in
 * reach. Nothing on the project itself is changed.
 */
export function fieldReportsOfCopy(reports: readonly GeneratedReport[], inReach: (fn: string) => boolean): GeneratedReport[] {
  const catalog = fieldCatalog();
  const shared = new Set([...catalog.sheets.keys()].filter(inReach).flatMap((fn) => sharedSetsOf(fn, catalog).map((set) => set.id)));
  /*
   * The same rule the copy of the sheets is cut by (`project-view.ts`): a
   * buyers' set is nobody's outside the firm, whatever the grant names; a
   * shared record is theirs where a function in reach links to it; and what
   * a department added to a shared record goes only where that department's
   * function is in reach. A unit's sale is not read off a report by somebody
   * who may not read it off the unit.
   */
  const reached = (address: Pick<FieldAddress, 'set'> & { field?: string }): boolean => {
    const set = catalog.sets.get(address.set);
    if (!set || CUSTOMER_SETS.includes(set.id)) return false;
    if (set.fn !== SHARED_FN) return inReach(set.fn);
    if (!shared.has(set.id)) return false;
    const addedBy = address.field ? set.fields.find((def) => def.key === address.field)?.addedBy : undefined;
    return !addedBy || inReach(addedBy);
  };
  /** The records of a set, printed as a table: every column it prints has to be theirs, and a list of parties kept as it read one day may name a buyer. */
  const recordsReached = (setId: string, columns: readonly string[] | undefined, frozen: boolean): boolean => {
    const set = catalog.sets.get(setId);
    if (!set || !reached({ set: setId })) return false;
    if (set.fn !== SHARED_FN) return true;
    if (frozen && setId === SHARED_RECORD_SETS.party) return false;
    const printed = columns?.length ? columns : set.fields.map((def) => def.key);
    return printed.every((key) => reached({ set: setId, field: key }));
  };
  return reports.map((report) => {
    let changed = false;
    const blocks = (report.body.blocks ?? []).flatMap((block) => {
      const source = block.source ?? block.detachedSource;
      const kind = block.source?.kind ?? block.detachedFrom;
      if (!isFieldSource(kind)) return [block];
      const named = [...(source?.addresses ?? []), ...(source?.address ? [source.address] : [])];
      if (named.some((address) => !reached(address)) || (source?.records && !recordsReached(source.records, source.columns, !block.source))) {
        changed = true;
        return [];
      }
      const rows = block.frozenTable?.rows;
      if (!rows || rows.every((row) => !row.address || reached(row.address))) return [block];
      // The rows and the lines of a field block are one for one.
      const keep = rows.map((row) => !row.address || reached(row.address));
      changed = true;
      const kept = <T>(list: readonly T[] | undefined): T[] | undefined => list?.filter((_, at) => keep[at]);
      const lines = kept(block.frozen);
      const left = kept(rows)!;
      // A footnote says where a value came from: one no row left here marks is of a value taken out.
      const marked = new Set(left.flatMap((row) => row.cells.join(' ').match(/\[(\d+)\]/g) ?? []));
      const footnotes = block.frozenFootnotes?.filter((note) => marked.has(`[${note.n}]`));
      return [{ ...block, frozen: lines, frozenRecordIds: kept(block.frozenRecordIds), frozenTable: { ...block.frozenTable!, rows: left }, ...(footnotes ? { frozenFootnotes: footnotes } : {}), ...(block.text !== undefined ? { text: (lines ?? []).join('\n') } : {}) }];
    });
    return changed ? { ...report, body: { ...report.body, blocks } } : report;
  });
}
