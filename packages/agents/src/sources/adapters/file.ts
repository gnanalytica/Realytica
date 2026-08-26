/**
 * Operator-supplied file ingestion — CSV and JSON.
 *
 * This is the adapter that matters. For Karnataka there is no reachable
 * machine interface to the registries, so the only route to real registry data
 * is that a person passes the gate — logs into Kaveri, clears the CAPTCHA on
 * the guidance-value search, queues at the Sub-Registrar counter — and hands
 * over what came back. Treating that as a second-class path would be a
 * category error: it is *the* path, and it deserves the careful parser.
 *
 * What "careful" means here, concretely, is that this adapter is built for
 * files that were not designed for it. Real government and broker exports
 * arrive with a title line and a blank line above the header, semicolons
 * instead of commas because someone opened them in a European Excel, a UTF-8
 * BOM, `1,23,456` in a numeric column, `2.5 Guntha` in an area column and a
 * date format that is DD-MM-YYYY except where it is not. Every one of those is
 * handled below; the one thing that is *not* handled is guessing, and where a
 * cell is genuinely ambiguous the row is rejected with a reason naming the
 * column and the value (see `../normalise.ts`).
 *
 * DELIBERATELY NOT HERE: PDF. An EC or a khata extract arrives as a scanned
 * PDF far more often than as a CSV, and reading those is the document
 * pipeline's job (`../../pdf.ts` and the document-intelligence agent), which
 * already handles OCR, classification and per-field confidence. This adapter
 * takes structured rows. Duplicating PDF extraction here would produce a
 * second, worse extractor whose output the rest of the app does not know how
 * to attribute.
 */

import type { IngestedRecord, IngestedRecordType } from '@valytica/shared';
import type { DateOrder, NormalisationResult, RawRow, RecordSchema, RejectedRow } from '../normalise';
import { RECORD_SCHEMAS, bindColumns, canonicalise, normaliseRows } from '../normalise';
import type { RegisteredSource } from '../registry';

/* ------------------------------------------------------------------ */
/* Supplied file                                                       */
/* ------------------------------------------------------------------ */

export type SuppliedFileFormat = 'csv' | 'json';

/**
 * A file the operator obtained and handed to the pipeline.
 *
 * `sourceId` is required rather than inferred. A CSV of numbers is not
 * self-describing — the same shape could be a guidance-value table or a
 * broker's asking-price list, and those carry completely different evidential
 * weight. Making the operator say which source it came from keeps provenance
 * attached to the data from the first moment it enters the system, which is
 * the whole point of the evidence model.
 */
export interface SuppliedFile {
  /** Stable id — the case document id where the file came in as a document. */
  id: string;
  fileName: string;
  /** Inferred from `fileName` when omitted. */
  format?: SuppliedFileFormat;
  content: string;
  /** Which registry source this came from. */
  sourceId: string;
  /** Overrides the source's declared record type, for a source that can yield more than one. */
  recordType?: IngestedRecordType;
  /** When the operator took the extract (ISO date). Used for `observedAt` where a row carries no date of its own. */
  observedAt?: string;
  /**
   * Per-column unit declarations, keyed by header (matched case- and
   * punctuation-insensitively). The escape hatch for a file whose area column
   * is headed `Extent` with the unit stated only in a covering email.
   */
  unitHints?: Record<string, string>;
  /** Declare this when the file is not DD-MM-YYYY. Default `dmy`. */
  dateOrder?: DateOrder;
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

/**
 * Bounds, because this runs inside the API process.
 *
 * A 200 MB paste is not a legitimate guidance-value table, and letting one
 * through turns a bad upload into an outage for every other case on the box.
 * Both limits are generous relative to any real extract — a full Bengaluru
 * guidance-value table is thousands of rows, not millions.
 */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_ROWS = 50_000;

/* ------------------------------------------------------------------ */
/* Parsed table                                                        */
/* ------------------------------------------------------------------ */

export interface ParsedTable {
  format: SuppliedFileFormat;
  columns: string[];
  rows: RawRow[];
  /** 1-based physical line the header was found on. 0 for JSON. */
  headerLineNumber: number;
  /** The delimiter chosen, for CSV. */
  delimiter?: string;
  /** Lines above the header that were treated as a title block. */
  preamble: string[];
  /** How the header was chosen, in words. */
  headerNote: string;
}

export type FileParse = { ok: true; table: ParsedTable } | { ok: false; reason: string };

/* ------------------------------------------------------------------ */
/* Delimited text                                                      */
/* ------------------------------------------------------------------ */

const DELIMITER_CANDIDATES = [',', ';', '\t', '|'];

/**
 * RFC 4180-shaped parse: double quotes group, a doubled quote inside a quoted
 * field is a literal quote, and a newline inside quotes does not end the row.
 *
 * Returns the physical line each row started on, so a rejection later can
 * point at a line the operator can actually find in their file — a row index
 * is useless to someone looking at a spreadsheet with a three-line preamble.
 */
function parseDelimited(text: string, delimiter: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let rowHasContent = false;

  const endField = () => {
    cells.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (rowHasContent) rows.push({ cells, line: rowStartLine });
    cells = [];
    rowHasContent = false;
    rowStartLine = line;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      rowHasContent = true;
      continue;
    }
    if (ch === delimiter) {
      endField();
      continue;
    }
    if (ch === '\r') continue;
    if (ch === '\n') {
      line += 1;
      endRow();
      rowStartLine = line;
      continue;
    }
    if (ch.trim() !== '') rowHasContent = true;
    field += ch;
  }
  endRow();

  return rows;
}

/**
 * Pick the delimiter by parsing with each candidate and seeing which one
 * yields a consistent table.
 *
 * Counting characters would be simpler and wrong: `1,23,456` puts more commas
 * in a semicolon-delimited Indian export than the semicolons themselves. The
 * only reliable signal is whether the *table* comes out rectangular, so each
 * candidate is actually parsed and scored on its modal column count and how
 * many rows match it.
 */
function chooseDelimiter(text: string): { delimiter: string; columnCount: number } {
  let best = { delimiter: ',', columnCount: 1, score: -1 };
  for (const delimiter of DELIMITER_CANDIDATES) {
    const rows = parseDelimited(text, delimiter).slice(0, 200);
    if (rows.length === 0) continue;
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.cells.length, (counts.get(r.cells.length) ?? 0) + 1);
    let modal = 1;
    let modalRows = 0;
    for (const [count, n] of counts) {
      if (n > modalRows || (n === modalRows && count > modal)) {
        modal = count;
        modalRows = n;
      }
    }
    if (modal < 2) continue;
    const consistency = modalRows / rows.length;
    const score = modal * consistency;
    if (score > best.score) best = { delimiter, columnCount: modal, score };
  }
  return { delimiter: best.delimiter, columnCount: best.columnCount };
}

/**
 * Find the header row.
 *
 * Government and broker exports routinely carry a title, an "as on" line and a
 * blank before the actual header, so assuming line 1 loses the whole file. Each
 * of the first few rows is scored on three things: whether it has the table's
 * modal column count, how much of it is text rather than numbers (a data row
 * of rates is mostly numeric, a header is not), and — the strongest signal —
 * how many of its cells bind to a field of the schema we are ingesting into.
 * The chosen row and the reason are reported, so a wrong choice is visible
 * rather than mysterious.
 */
function detectHeaderRow(
  rows: { cells: string[]; line: number }[],
  modalColumnCount: number,
  schema: RecordSchema,
): { index: number; note: string } {
  const limit = Math.min(rows.length, 15);
  let best = { index: 0, score: -Infinity, bound: 0, textShare: 0 };

  for (let i = 0; i < limit; i += 1) {
    const cells = rows[i].cells.map(c => c.trim());
    const nonEmpty = cells.filter(c => c !== '');
    if (nonEmpty.length < 2) continue;

    const textShare = nonEmpty.filter(c => !/^[₹€$]?\s*[\d.,]+\s*$/.test(c)).length / nonEmpty.length;
    const bindings = bindColumns(cells, schema);
    const bound = bindings.filter(b => b.field).length;
    const boundShare = bound / nonEmpty.length;
    const shapeMatch = cells.length === modalColumnCount ? 1 : 0;

    const score = 3 * boundShare + 2 * textShare + 2 * shapeMatch - i * 0.05;
    if (score > best.score) best = { index: i, score, bound, textShare };
  }

  const note = `header taken from line ${rows[best.index]?.line ?? 1}: ${best.bound} of its cells bind to \`${schema.recordType}\` fields and ${Math.round(best.textShare * 100)}% are non-numeric${best.index > 0 ? `; the ${best.index} line(s) above it were treated as a title block` : ''}`;
  return { index: best.index, note };
}

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

const JSON_ARRAY_KEYS = ['records', 'data', 'rows', 'items', 'results', 'features'];

/**
 * Accepts a bare array of objects, a wrapper object with the array under a
 * conventional key, or a GeoJSON `FeatureCollection` (whose `properties` are
 * the row). GeoJSON is included because it is what the one genuinely open
 * source in the registry returns, and the same normalisation should apply to
 * it as to a hand-made CSV — one code path, one set of rejection reasons.
 */
function extractJsonRows(parsed: unknown): { ok: true; rows: Record<string, unknown>[] } | { ok: false; reason: string } {
  let list: unknown = parsed;

  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const key = JSON_ARRAY_KEYS.find(k => Array.isArray(obj[k]));
    if (!key) {
      return {
        ok: false,
        reason: `the JSON is an object with no array under any of ${JSON_ARRAY_KEYS.join(', ')}; supply an array of row objects, or wrap it under one of those keys`,
      };
    }
    list = obj[key];
  }

  if (!Array.isArray(list)) return { ok: false, reason: 'the JSON is not an array of row objects' };

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: `element ${i + 1} of the array is not an object` };
    }
    const record = entry as Record<string, unknown>;
    // GeoJSON: the row is the feature's properties.
    const source = record.type === 'Feature' && record.properties !== null && typeof record.properties === 'object'
      ? (record.properties as Record<string, unknown>)
      : record;
    const flat: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(source)) {
      flat[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    }
    rows.push(flat);
  }
  return { ok: true, rows };
}

/* ------------------------------------------------------------------ */
/* Parsing entry point                                                 */
/* ------------------------------------------------------------------ */

export function inferFormat(file: SuppliedFile): SuppliedFileFormat | undefined {
  if (file.format) return file.format;
  const name = file.fileName.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) return 'csv';
  if (name.endsWith('.json') || name.endsWith('.geojson')) return 'json';
  return undefined;
}

/** Strip a UTF-8 BOM, which Excel writes and every naive parser then reads into the first header name. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseSuppliedFile(file: SuppliedFile, recordType: IngestedRecordType): FileParse {
  const format = inferFormat(file);
  if (!format) {
    return { ok: false, reason: `cannot tell whether "${file.fileName}" is CSV or JSON; set \`format\` explicitly or give the file a .csv/.json extension` };
  }

  const content = stripBom(file.content);
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_FILE_BYTES) {
    return { ok: false, reason: `"${file.fileName}" is ${(bytes / 1024 / 1024).toFixed(1)} MB, above the ${MAX_FILE_BYTES / 1024 / 1024} MB ingestion limit` };
  }
  if (content.trim() === '') return { ok: false, reason: `"${file.fileName}" is empty` };

  const schema = RECORD_SCHEMAS[recordType];

  if (format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      return { ok: false, reason: `"${file.fileName}" is not valid JSON: ${(error as Error).message}` };
    }
    const extracted = extractJsonRows(parsed);
    if (!extracted.ok) return { ok: false, reason: `"${file.fileName}": ${extracted.reason}` };
    if (extracted.rows.length === 0) return { ok: false, reason: `"${file.fileName}" contains no rows` };
    if (extracted.rows.length > MAX_ROWS) {
      return { ok: false, reason: `"${file.fileName}" has ${extracted.rows.length} rows, above the ${MAX_ROWS} row ingestion limit` };
    }
    // The union of keys, so a row that omits an optional key does not shrink the table.
    const columns: string[] = [];
    for (const row of extracted.rows) for (const k of Object.keys(row)) if (!columns.includes(k)) columns.push(k);
    return {
      ok: true,
      table: {
        format,
        columns,
        rows: extracted.rows.map((values, i) => ({ rowNumber: i + 1, values: fillColumns(values, columns) })),
        headerLineNumber: 0,
        preamble: [],
        headerNote: `JSON: ${columns.length} distinct keys across ${extracted.rows.length} objects; row numbers are array positions, not file lines`,
      },
    };
  }

  const { delimiter, columnCount } = chooseDelimiter(content);
  const raw = parseDelimited(content, delimiter);
  if (raw.length === 0) return { ok: false, reason: `"${file.fileName}" contains no rows` };
  if (raw.length > MAX_ROWS) {
    return { ok: false, reason: `"${file.fileName}" has ${raw.length} rows, above the ${MAX_ROWS} row ingestion limit` };
  }

  const header = detectHeaderRow(raw, columnCount, schema);
  const headerCells = raw[header.index].cells.map(c => c.trim());
  const columns = dedupeColumns(headerCells);
  const dataRows = raw.slice(header.index + 1);
  if (dataRows.length === 0) {
    return { ok: false, reason: `"${file.fileName}" has a header on line ${raw[header.index].line} but no data rows after it` };
  }

  const rows: RawRow[] = dataRows.map(r => {
    const values: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      values[col] = r.cells[i] === undefined ? '' : r.cells[i].trim();
    });
    return { rowNumber: r.line, values };
  });

  return {
    ok: true,
    table: {
      format,
      columns,
      rows,
      headerLineNumber: raw[header.index].line,
      delimiter,
      preamble: raw.slice(0, header.index).map(r => r.cells.join(delimiter)),
      headerNote: `${describeDelimiter(delimiter)}-delimited; ${header.note}`,
    },
  };
}

function fillColumns(values: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) out[c] = values[c];
  return out;
}

/** Two columns with the same name would silently overwrite each other, so the later ones are suffixed. */
function dedupeColumns(cells: string[]): string[] {
  const seen = new Map<string, number>();
  return cells.map((cell, i) => {
    const base = cell === '' ? `column_${i + 1}` : cell;
    const key = canonicalise(base);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

function describeDelimiter(delimiter: string): string {
  if (delimiter === '\t') return 'tab';
  if (delimiter === ',') return 'comma';
  if (delimiter === ';') return 'semicolon';
  if (delimiter === '|') return 'pipe';
  return delimiter;
}

/* ------------------------------------------------------------------ */
/* Ingestion                                                           */
/* ------------------------------------------------------------------ */

export interface FileIngestionResult {
  records: IngestedRecord[];
  rejected: RejectedRow[];
  table?: ParsedTable;
  /** Set when the file could not be parsed at all — no rows were even attempted. */
  fatal?: string;
  /** Human account of what happened, for the `IngestionAttempt.note`. */
  note: string;
  normalisation?: NormalisationResult;
}

export interface FileIngestionOptions {
  now: Date;
  baseConfidence: number;
  /** Carry columns the schema did not claim onto the record as `extra.<key>`. */
  keepUnmapped?: boolean;
  /** Set when one source contributes several files in a run, to keep record ids distinct. */
  idDiscriminator?: string;
}

/**
 * Parse one supplied file and normalise it against its source's declared
 * intake contract.
 *
 * The source is consulted for three things and no more: which record type the
 * rows are, which fields it insists on beyond the schema's own required set,
 * and whether the source is documented to publish in a particular unit. It is
 * deliberately not consulted for a *default* unit for the Indian sources — see
 * `FileIntakeSpec.defaultAreaUnit`.
 */
export function ingestSuppliedFile(
  file: SuppliedFile,
  source: RegisteredSource,
  options: FileIngestionOptions,
): FileIngestionResult {
  const intake = source.fileIntake;
  const recordType = file.recordType ?? intake?.recordType;
  if (!recordType) {
    return {
      records: [],
      rejected: [],
      fatal: `source \`${source.id}\` declares no file intake and the supplied file names no record type`,
      note: `"${file.fileName}" was not ingested: ${source.label} has no declared file-intake shape.`,
    };
  }

  if (intake && !intake.formats.includes(inferFormat(file) ?? 'csv')) {
    return {
      records: [],
      rejected: [],
      fatal: `source \`${source.id}\` accepts ${intake.formats.join('/')} and "${file.fileName}" is not one of those`,
      note: `"${file.fileName}" was not ingested: ${source.label} accepts ${intake.formats.join(' or ')}.`,
    };
  }

  const parsed = parseSuppliedFile(file, recordType);
  if (!parsed.ok) {
    return {
      records: [],
      rejected: [],
      fatal: parsed.reason,
      note: `"${file.fileName}" could not be read: ${parsed.reason}.`,
    };
  }

  const normalisation = normaliseRows(parsed.table.rows, {
    sourceId: source.id,
    recordType,
    extraRequiredFields: intake?.requiredFields,
    defaultAreaUnit: intake?.defaultAreaUnit,
    defaultRateUnit: intake?.defaultRateUnit,
    unitHints: file.unitHints,
    dateOrder: file.dateOrder,
    fileObservedAt: file.observedAt,
    now: options.now,
    baseConfidence: options.baseConfidence,
    keepUnmapped: options.keepUnmapped ?? true,
    idDiscriminator: options.idDiscriminator,
  });

  return {
    records: normalisation.records,
    rejected: normalisation.rejected,
    table: parsed.table,
    normalisation,
    note: summariseFileIngestion(file, parsed.table, normalisation),
  };
}

/** How many rejections are spelled out in the attempt note before it turns into a count. */
const NOTE_REJECTION_LIMIT = 5;

function summariseFileIngestion(file: SuppliedFile, table: ParsedTable, result: NormalisationResult): string {
  const parts: string[] = [];
  parts.push(
    `"${file.fileName}": ${table.rows.length} row(s) read (${table.headerNote}); ${result.records.length} ingested, ${result.rejected.length} rejected.`,
  );
  if (result.unmappedColumns.length > 0) {
    parts.push(`Columns carried but not mapped to a schema field: ${result.unmappedColumns.join(', ')}.`);
  }
  if (result.missingRequiredColumns.length > 0) {
    parts.push(`No column supplied required field(s): ${result.missingRequiredColumns.join(', ')}.`);
  }
  if (result.rejected.length > 0) {
    const shown = result.rejected.slice(0, NOTE_REJECTION_LIMIT);
    parts.push(
      `Rejections — ${shown.map(r => `line ${r.rowNumber}: ${r.reason}`).join(' | ')}${
        result.rejected.length > shown.length ? ` | and ${result.rejected.length - shown.length} more` : ''
      }.`,
    );
  }
  return parts.join(' ');
}
