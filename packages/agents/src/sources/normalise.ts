/**
 * Raw rows in, `IngestedRecord`s out — with every rejection named.
 *
 * This module is where a file that a human can read becomes something the
 * engine can price. It is also, deliberately, the strictest part of the
 * ingestion pipeline, for one reason: **a silently dropped row is a
 * data-integrity bug, and a silently guessed unit is a worse one.**
 *
 * Two rules follow from that and are enforced throughout.
 *
 * 1. **Nothing is dropped quietly.** Every row that does not become a record
 *    comes back in `rejected` with a reason that names the column, the raw
 *    value and what was wrong with it. A caller that ingests 40 rows and gets
 *    37 records can always say which three and why.
 *
 * 2. **Ambiguity is refused, not resolved.** An area column with no stated
 *    unit is rejected rather than assumed, because in Karnataka the plausible
 *    candidates are sqft, guntha and cent, and those differ by more than a
 *    thousandfold — a wrong guess does not produce a slightly wrong valuation,
 *    it produces a confidently absurd one. The same applies to `03-04-2019`
 *    read under an unknown day/month order, and to a two-digit year.
 *
 * CANONICAL UNITS. The domain model stores square metres, ISO-8601 dates and
 * major currency units (rupees, not paise; euros, not cents) — see
 * `PropertyIdentity.builtUpAreaSqm` and `LocalityReference.medianPricePerSqm`
 * in the shared contract. Everything here converts into those and records what
 * it converted from, so a reviewer can check the arithmetic rather than trust
 * it.
 *
 * DETERMINISM. No clock is read here and no random source is touched; the
 * caller passes `now`, and record ids are derived from the source id, the
 * record type and the row's position in its file. The same file ingested twice
 * produces byte-identical records.
 */

import type { IngestedRecord, IngestedRecordType } from '@valytica/shared';

/* ------------------------------------------------------------------ */
/* Units of area                                                       */
/* ------------------------------------------------------------------ */

/**
 * 1 sq ft in m², exact: 1 ft = 0.3048 m by definition, squared.
 *
 * Duplicated from `apps/web/src/lib/units.ts` rather than imported — that file
 * is the web app's display layer and this package must not depend on an app.
 * The constant is a definition, not a calibration, so the duplication cannot
 * drift.
 */
export const SQM_PER_SQFT = 0.09290304;

/** 1 ft in m, exact. Used only for dimension notation ("30 x 40 ft"). */
export const M_PER_FT = 0.3048;

export type AreaUnitKey = 'sqft' | 'sqm' | 'sqyd' | 'acre' | 'guntha' | 'cent' | 'hectare' | 'ground';
export type LinearUnitKey = 'ft' | 'm';

export interface AreaUnitDef {
  key: AreaUnitKey;
  label: string;
  /** Multiply a figure in this unit by this to get m². */
  sqmPerUnit: number;
  /** How the factor is derived, so the number can be checked rather than trusted. */
  derivation: string;
  /** Canonicalised aliases (lower case, alphanumerics and single spaces only). */
  aliases: string[];
}

/**
 * Karnataka's traditional land units are on this list because they are what
 * revenue records and site listings actually use. A guntha is a fortieth of an
 * acre and a cent is a hundredth; both are exact fractions, so every factor
 * below is exact rather than rounded, and the `derivation` string says how.
 */
export const AREA_UNITS: readonly AreaUnitDef[] = Object.freeze([
  {
    key: 'sqft',
    label: 'square feet',
    sqmPerUnit: SQM_PER_SQFT,
    derivation: '1 ft = 0.3048 m exactly, so 1 sqft = 0.3048² = 0.09290304 m²',
    aliases: ['sqft', 'sq ft', 'sqfeet', 'sq feet', 'square feet', 'square foot', 'sft', 'ft2', 'ft 2', 'psf'],
  },
  {
    key: 'sqm',
    label: 'square metres',
    sqmPerUnit: 1,
    derivation: 'canonical unit',
    aliases: ['sqm', 'sq m', 'sqmt', 'sq mt', 'sqmtr', 'square metre', 'square metres', 'square meter', 'square meters', 'm2', 'm 2'],
  },
  {
    key: 'sqyd',
    label: 'square yards',
    sqmPerUnit: 9 * SQM_PER_SQFT,
    derivation: '1 sq yd = 9 sqft = 9 × 0.09290304 = 0.83612736 m²',
    aliases: ['sqyd', 'sq yd', 'sqyds', 'square yard', 'square yards', 'gaj', 'gajam'],
  },
  {
    key: 'acre',
    label: 'acres',
    sqmPerUnit: 43560 * SQM_PER_SQFT,
    derivation: '1 acre = 43,560 sqft = 43560 × 0.09290304 = 4046.8564224 m²',
    aliases: ['acre', 'acres', 'ac'],
  },
  {
    key: 'guntha',
    label: 'guntha',
    sqmPerUnit: 1089 * SQM_PER_SQFT,
    derivation: '1 guntha = 1/40 acre = 1,089 sqft = 1089 × 0.09290304 = 101.17141056 m²',
    aliases: ['guntha', 'gunta', 'gunthas', 'guntas', 'guntha s'],
  },
  {
    key: 'cent',
    label: 'cent',
    sqmPerUnit: 435.6 * SQM_PER_SQFT,
    derivation: '1 cent = 1/100 acre = 435.6 sqft = 435.6 × 0.09290304 = 40.468564224 m²',
    aliases: ['cent', 'cents'],
  },
  {
    key: 'hectare',
    label: 'hectares',
    sqmPerUnit: 10000,
    derivation: '1 hectare = 10,000 m² by definition',
    aliases: ['hectare', 'hectares', 'ha'],
  },
  {
    key: 'ground',
    label: 'ground',
    sqmPerUnit: 2400 * SQM_PER_SQFT,
    derivation: '1 ground = 2,400 sqft = 2400 × 0.09290304 = 222.967296 m²',
    aliases: ['ground', 'grounds'],
  },
]);

const LINEAR_UNITS: Record<LinearUnitKey, { label: string; mPerUnit: number; areaUnit: AreaUnitKey; aliases: string[] }> = {
  ft: { label: 'feet', mPerUnit: M_PER_FT, areaUnit: 'sqft', aliases: ['ft', 'feet', 'foot'] },
  m: { label: 'metres', mPerUnit: 1, areaUnit: 'sqm', aliases: ['m', 'metre', 'metres', 'meter', 'meters'] },
};

/** Every area alias, longest first, so `sq ft` wins over `ft` and `sqmtr` over `m`. */
const AREA_ALIAS_INDEX: { alias: string; unit: AreaUnitDef }[] = AREA_UNITS.flatMap(u =>
  u.aliases.map(alias => ({ alias, unit: u })),
).sort((a, b) => b.alias.length - a.alias.length);

const LINEAR_ALIAS_INDEX: { alias: string; key: LinearUnitKey }[] = (Object.keys(LINEAR_UNITS) as LinearUnitKey[])
  .flatMap(key => LINEAR_UNITS[key].aliases.map(alias => ({ alias, key })))
  .sort((a, b) => b.alias.length - a.alias.length);

/** Reduce a string to lower-case alphanumerics separated by single spaces. */
export function canonicalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/²/g, '2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasToken(haystack: string, token: string): boolean {
  return new RegExp(`(^| )${token.replace(/ /g, ' ')}( |$)`).test(haystack);
}

/** The area unit named anywhere in a piece of text (a header, a cell, a hint), or undefined. */
export function detectAreaUnit(text: string): AreaUnitDef | undefined {
  const c = canonicalise(text);
  if (!c) return undefined;
  return AREA_ALIAS_INDEX.find(entry => hasToken(c, entry.alias))?.unit;
}

export function detectLinearUnit(text: string): LinearUnitKey | undefined {
  const c = canonicalise(text);
  if (!c) return undefined;
  return LINEAR_ALIAS_INDEX.find(entry => hasToken(c, entry.alias))?.key;
}

/**
 * Remove a unit's words from a value so only the quantity is left.
 *
 * Each alias is matched with any run of non-alphanumerics standing in for the
 * space inside it, because real cells write the same unit as `sq ft`, `sq.ft`
 * and `sqft` interchangeably, and a parser that only handles one of the three
 * fails on a third of a real file.
 */
function stripUnitWords(text: string, aliases: string[]): string {
  let out = text;
  for (const alias of [...aliases].sort((a, b) => b.length - a.length)) {
    const pattern = alias.replace(/ /g, '[^a-z0-9]*');
    out = out.replace(new RegExp(`(^|[^a-z0-9])${pattern}\\.?([^a-z0-9]|$)`, 'gi'), '$1 $2');
  }
  return out;
}

export function areaUnitByKey(key: string): AreaUnitDef | undefined {
  const c = canonicalise(key);
  return AREA_UNITS.find(u => u.key === c) ?? detectAreaUnit(key);
}

/* ------------------------------------------------------------------ */
/* Parse results                                                       */
/* ------------------------------------------------------------------ */

export type ParseOk<T> = { ok: true; value: T };
export type ParseFail = { ok: false; reason: string };
export type ParseResult<T> = ParseOk<T> | ParseFail;

const fail = (reason: string): ParseFail => ({ ok: false, reason });
const ok = <T>(value: T): ParseOk<T> => ({ ok: true, value });

/** Cells that mean "the source left this blank", as distinct from "the source said zero". */
const BLANK_TOKENS = new Set(['', '-', '--', 'na', 'n a', 'nil', 'none', 'null', 'not available', 'not applicable', 'nan']);

export function isBlank(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'string') return BLANK_TOKENS.has(canonicalise(raw));
  return false;
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

/** Word multipliers seen in Indian price notation, longest alias first. */
const MULTIPLIERS: { alias: string; factor: number; label: string }[] = [
  { alias: 'crores', factor: 1e7, label: 'crore' },
  { alias: 'crore', factor: 1e7, label: 'crore' },
  { alias: 'cr', factor: 1e7, label: 'crore' },
  { alias: 'lakhs', factor: 1e5, label: 'lakh' },
  { alias: 'lakh', factor: 1e5, label: 'lakh' },
  { alias: 'lacs', factor: 1e5, label: 'lakh' },
  { alias: 'lac', factor: 1e5, label: 'lakh' },
  { alias: 'thousand', factor: 1e3, label: 'thousand' },
  { alias: 'million', factor: 1e6, label: 'million' },
  { alias: 'mn', factor: 1e6, label: 'million' },
  { alias: 'billion', factor: 1e9, label: 'billion' },
  { alias: 'bn', factor: 1e9, label: 'billion' },
  { alias: 'l', factor: 1e5, label: 'lakh' },
  { alias: 'k', factor: 1e3, label: 'thousand' },
].sort((a, b) => b.alias.length - a.alias.length);

const CURRENCY_TOKENS = ['inr', 'rs', 'rupees', 'rupee', 'eur', 'euro', 'euros'];

export interface NumericParse {
  value: number;
  /** The multiplier word applied, if any — carried so the record can show its working. */
  multiplier?: string;
  /** True when the raw text used Indian (2-digit) comma grouping. */
  indianGrouping: boolean;
}

/**
 * Parse a number as it appears in Indian records.
 *
 * Handles `₹1,23,456.78` (two-digit grouping above the hundreds), the Western
 * `1,234,567.89`, and the word multipliers a price is quoted in — `85 lakh`,
 * `1.35 Cr`, `45L`. Comma grouping is *validated* rather than merely stripped:
 * `1,2,3` is not a number in either convention, and a parser that answers 123
 * to it will happily answer something to a corrupted export too.
 */
export function parseNumeric(raw: unknown): ParseResult<NumericParse> {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? ok({ value: raw, indianGrouping: false }) : fail('not a finite number');
  }
  if (typeof raw === 'boolean') return fail(`expected a number, found the boolean ${raw}`);
  if (raw === null || raw === undefined) return fail('empty');

  let text = String(raw).trim();
  if (text === '') return fail('empty');

  const negative = /^[-−–]/.test(text);
  if (negative) text = text.slice(1).trim();

  // Strip currency symbols and words wherever they sit.
  text = text.replace(/[₹€$£]/g, ' ');
  for (const token of CURRENCY_TOKENS) {
    text = text.replace(new RegExp(`(^|[^a-z])${token}\\.?([^a-z]|$)`, 'gi'), '$1 $2');
  }
  text = text.replace(/\s+/g, ' ').trim();

  // Pull off a trailing multiplier word (`1.35 Cr`, `45L`, `12k`).
  let multiplier: { alias: string; factor: number; label: string } | undefined;
  for (const m of MULTIPLIERS) {
    const re = new RegExp(`^(.*?)\\s*${m.alias}\\.?$`, 'i');
    const match = text.match(re);
    if (match && /\d/.test(match[1])) {
      multiplier = m;
      text = match[1].trim();
      break;
    }
  }

  // A number written with spaces as separators, e.g. `1 23 456`.
  if (/^\d[\d ]*\d$/.test(text) && text.includes(' ')) text = text.replace(/ /g, '');

  if (!/^\d[\d,]*(\.\d+)?$/.test(text)) {
    return fail(`"${String(raw).trim()}" is not a number this parser recognises (expected digits, optional , grouping, optional decimal point, optional lakh/crore word)`);
  }

  const [intPart, decPart] = text.split('.');
  const grouping = validateGrouping(intPart);
  if (!grouping.ok) return grouping;

  const digits = intPart.replace(/,/g, '');
  const numeric = Number(decPart === undefined ? digits : `${digits}.${decPart}`);
  if (!Number.isFinite(numeric)) return fail(`"${String(raw).trim()}" did not resolve to a finite number`);

  const scaled = numeric * (multiplier?.factor ?? 1);
  return ok({
    value: negative ? -scaled : scaled,
    multiplier: multiplier?.label,
    indianGrouping: grouping.value,
  });
}

/**
 * Validate comma grouping and report which convention it follows.
 *
 * Indian grouping puts the last comma three digits from the end and every
 * earlier one two digits apart (`1,23,45,678`); Western grouping uses three
 * throughout (`12,345,678`). Anything else — a mixed pattern, a four-digit
 * group, a stray comma — is a corrupted cell, and saying so beats inventing a
 * value for it.
 */
function validateGrouping(intPart: string): ParseResult<boolean> {
  if (!intPart.includes(',')) return ok(false);
  const groups = intPart.split(',');
  if (groups.some(g => g.length === 0)) return fail(`"${intPart}" has an empty comma group`);
  const first = groups[0];
  const rest = groups.slice(1);
  if (first.length < 1 || first.length > 3) {
    return fail(`"${intPart}" starts with a ${first.length}-digit group; neither Indian nor Western grouping allows that`);
  }
  const last = rest[rest.length - 1];
  if (last.length !== 3) {
    return fail(`"${intPart}" ends with a ${last.length}-digit group; both Indian and Western grouping end in 3 digits`);
  }
  const middles = rest.slice(0, -1);
  if (middles.length === 0) return ok(false);
  if (middles.every(g => g.length === 2)) return ok(true);
  if (middles.every(g => g.length === 3)) return ok(false);
  return fail(
    `"${intPart}" mixes group sizes (${middles.map(g => g.length).join(',')} before the final 3); it is neither Indian (2-digit) nor Western (3-digit) grouping`,
  );
}

/* ------------------------------------------------------------------ */
/* Areas                                                               */
/* ------------------------------------------------------------------ */

export interface AreaParse {
  sqm: number;
  /** The unit the source expressed it in. */
  unit: AreaUnitKey;
  unitLabel: string;
  sqmPerUnit: number;
  /** The figure before conversion, in `unit`. */
  quantity: number;
  /** Human statement of the conversion done, e.g. `2.5 guntha × 101.17141056 = 252.928526 m²`. */
  working: string;
}

export interface AreaParseOptions {
  /** Unit named by the column header, e.g. `Area (sq ft)`. */
  headerUnit?: string;
  /** Unit given in a companion column on the same row, e.g. a `Unit` column. */
  rowUnit?: string;
  /** Unit declared for this column by the operator when supplying the file. */
  declaredUnit?: string;
  /** Unit the source is documented to publish in. Only set where that is actually known. */
  defaultUnit?: string;
}

/**
 * Parse an area into m².
 *
 * The unit may be in the value itself (`1,200 sq ft`), in the header, in a
 * companion unit column, declared by the operator, or documented on the
 * source — searched in that order of specificity. If none of them names a
 * unit, the value is **rejected**. That is a deliberate refusal: an Indian
 * area column could be sqft, guntha or cent, 1 guntha is 1,089 sqft, and a
 * pipeline that guesses will eventually price a 2.5-guntha site as 2.5 sqft.
 *
 * Also understands Bengaluru dimension notation (`30 x 40`), but only when a
 * linear unit is stated — for the same reason.
 */
export function parseAreaToSqm(raw: unknown, opts: AreaParseOptions = {}): ParseResult<AreaParse> {
  if (isBlank(raw)) return fail('empty');
  const text = String(raw).trim();

  const valueUnit = detectAreaUnit(text);
  const unitSources: { unit: AreaUnitDef | undefined; from: string }[] = [
    { unit: valueUnit, from: 'the value itself' },
    { unit: opts.rowUnit ? detectAreaUnit(opts.rowUnit) : undefined, from: 'the row unit column' },
    { unit: opts.headerUnit ? detectAreaUnit(opts.headerUnit) : undefined, from: 'the column header' },
    { unit: opts.declaredUnit ? areaUnitByKey(opts.declaredUnit) : undefined, from: 'the operator declaration' },
    { unit: opts.defaultUnit ? areaUnitByKey(opts.defaultUnit) : undefined, from: 'the source default' },
  ];
  const resolved = unitSources.find(u => u.unit !== undefined);

  // Dimension notation: `30 x 40`, `30x40 ft`, `9 x 12 m`.
  const dims = text.match(/^\s*([\d.,]+)\s*[x×*]\s*([\d.,]+)\s*(.*)$/i);
  if (dims) {
    const linearFromValue = detectLinearUnit(dims[3]);
    const linearFromHeader = opts.headerUnit ? detectLinearUnit(opts.headerUnit) : undefined;
    const linearFromRow = opts.rowUnit ? detectLinearUnit(opts.rowUnit) : undefined;
    const linear = linearFromValue ?? linearFromRow ?? linearFromHeader;
    if (!linear) {
      return fail(
        `"${text}" looks like a dimension pair but states no linear unit; refusing to assume feet vs metres (state it in the value, the header, or a unit column)`,
      );
    }
    const w = parseNumeric(dims[1]);
    if (!w.ok) return fail(`width in "${text}": ${w.reason}`);
    const d = parseNumeric(dims[2]);
    if (!d.ok) return fail(`depth in "${text}": ${d.reason}`);
    const unitDef = AREA_UNITS.find(u => u.key === LINEAR_UNITS[linear].areaUnit)!;
    const quantity = w.value.value * d.value.value;
    const sqm = quantity * unitDef.sqmPerUnit;
    return ok({
      sqm,
      unit: unitDef.key,
      unitLabel: unitDef.label,
      sqmPerUnit: unitDef.sqmPerUnit,
      quantity,
      working: `${w.value.value} × ${d.value.value} ${LINEAR_UNITS[linear].label} = ${quantity} ${unitDef.label} × ${unitDef.sqmPerUnit} = ${round(sqm, 4)} m²`,
    });
  }

  if (!resolved || !resolved.unit) {
    return fail(
      `"${text}" has no area unit anywhere (value, unit column, header, operator declaration or source default); refusing to guess between sqft, sqm, guntha and cent`,
    );
  }

  // Strip the unit words out of the value before parsing the quantity.
  const numericPart = stripUnitWords(text, resolved.unit.aliases).replace(/\bper\b/gi, ' ').replace(/\s+/g, ' ').trim();

  const qty = parseNumeric(numericPart);
  if (!qty.ok) return fail(`area "${text}": ${qty.reason}`);
  if (qty.value.value < 0) return fail(`area "${text}" is negative`);

  const sqm = qty.value.value * resolved.unit.sqmPerUnit;
  return ok({
    sqm,
    unit: resolved.unit.key,
    unitLabel: resolved.unit.label,
    sqmPerUnit: resolved.unit.sqmPerUnit,
    quantity: qty.value.value,
    working: `${qty.value.value} ${resolved.unit.label} (unit from ${resolved.from}) × ${resolved.unit.sqmPerUnit} = ${round(sqm, 4)} m²`,
  });
}

/* ------------------------------------------------------------------ */
/* Rates (money per unit area)                                         */
/* ------------------------------------------------------------------ */

export interface RateParse {
  perSqm: number;
  perUnit: number;
  unit: AreaUnitKey;
  unitLabel: string;
  sqmPerUnit: number;
  working: string;
}

/**
 * Parse a rate into currency per m².
 *
 * The denominator unit is found the same way, and refused the same way, as in
 * `parseAreaToSqm` — with one extra trap handled: a rate *divides* by the
 * unit, so the conversion goes the other way. ₹8,500/sqft is ₹91,494/m², not
 * ₹790/m², and getting the direction wrong is a mistake that looks plausible
 * on the page.
 */
export function parseRateToPerSqm(raw: unknown, opts: AreaParseOptions = {}): ParseResult<RateParse> {
  if (isBlank(raw)) return fail('empty');
  const text = String(raw).trim();

  const unit =
    detectAreaUnit(text) ??
    (opts.rowUnit ? detectAreaUnit(opts.rowUnit) : undefined) ??
    (opts.headerUnit ? detectAreaUnit(opts.headerUnit) : undefined) ??
    (opts.declaredUnit ? areaUnitByKey(opts.declaredUnit) : undefined) ??
    (opts.defaultUnit ? areaUnitByKey(opts.defaultUnit) : undefined);

  if (!unit) {
    return fail(
      `rate "${text}" states no area unit in its value, header, unit column, operator declaration or source default; refusing to guess the denominator`,
    );
  }

  const numericPart = stripUnitWords(text, unit.aliases)
    .replace(/\bper\b/gi, ' ')
    .replace(/[/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const qty = parseNumeric(numericPart);
  if (!qty.ok) return fail(`rate "${text}": ${qty.reason}`);
  if (qty.value.value < 0) return fail(`rate "${text}" is negative`);

  const perSqm = qty.value.value / unit.sqmPerUnit;
  return ok({
    perSqm,
    perUnit: qty.value.value,
    unit: unit.key,
    unitLabel: unit.label,
    sqmPerUnit: unit.sqmPerUnit,
    working: `${qty.value.value} per ${unit.label} ÷ ${unit.sqmPerUnit} m² per ${unit.label} = ${round(perSqm, 2)} per m²`,
  });
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/**
 * Which of the first two components of a slash/dash date is the day.
 *
 * Defaults to `dmy` because Indian records overwhelmingly use DD-MM-YYYY, and
 * a default has to be chosen for the genuinely ambiguous `03-04-2019`. The
 * choice is recorded on the parse so a record can state which convention it
 * was read under, and a file that is known to be American can say so.
 */
export type DateOrder = 'dmy' | 'mdy' | 'ymd';

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export interface DateParse {
  /** `YYYY-MM-DD`. */
  iso: string;
  /** True when the input was ordered day-first and could in principle have been month-first. */
  ambiguousOrderResolvedBy?: DateOrder;
}

/**
 * Parse a date into an ISO `YYYY-MM-DD` string.
 *
 * Accepts ISO, `DD-MM-YYYY` and its slash and dot variants, and named months
 * (`12-Mar-2019`, `12 March 2019`). Rejects, with a reason:
 *
 * - a two-digit year, because `12-03-19` could be 1919, 2019 or 2119 and a
 *   registry date that is a century out is worse than a missing one;
 * - a date whose month component exceeds 12 under the declared order, which
 *   means the file is not in the order it was read under;
 * - a component combination that is not a real calendar date (`30-02-2019`).
 */
export function parseDateToIso(raw: unknown, order: DateOrder = 'dmy'): ParseResult<DateParse> {
  if (isBlank(raw)) return fail('empty');
  const text = String(raw).trim();

  // ISO first, including a timestamp we simply date-truncate.
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), text);

  // Named month, in either order: `12-Mar-2019`, `March 12, 2019`.
  const namedDayFirst = text.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})\.?[\s\-/.]+(\d{2,4})$/);
  if (namedDayFirst) {
    const month = MONTH_NAMES[namedDayFirst[2].toLowerCase()];
    if (month === undefined) return fail(`"${text}" names a month this parser does not recognise ("${namedDayFirst[2]}")`);
    const year = namedDayFirst[3];
    if (year.length !== 4) return fail(`"${text}" has a ${year.length}-digit year; a two-digit year is ambiguous by a century and is refused rather than guessed`);
    return buildDate(Number(year), month, Number(namedDayFirst[1]), text);
  }
  const namedMonthFirst = text.match(/^([A-Za-z]{3,9})\.?[\s\-/.]+(\d{1,2}),?[\s\-/.]+(\d{2,4})$/);
  if (namedMonthFirst) {
    const month = MONTH_NAMES[namedMonthFirst[1].toLowerCase()];
    if (month === undefined) return fail(`"${text}" names a month this parser does not recognise ("${namedMonthFirst[1]}")`);
    const year = namedMonthFirst[3];
    if (year.length !== 4) return fail(`"${text}" has a ${year.length}-digit year; a two-digit year is ambiguous by a century and is refused rather than guessed`);
    return buildDate(Number(year), month, Number(namedMonthFirst[2]), text);
  }

  const numeric = text.match(/^(\d{1,4})[\-/.](\d{1,2})[\-/.](\d{1,4})$/);
  if (!numeric) {
    return fail(`"${text}" is not a date this parser recognises (expected YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY or DD-Mon-YYYY)`);
  }

  const [, a, b, c] = numeric;
  if (order === 'ymd' || a.length === 4) {
    if (a.length !== 4) return fail(`"${text}" was read as year-first but "${a}" is not a four-digit year`);
    return buildDate(Number(a), Number(b), Number(c), text);
  }
  if (c.length !== 4) {
    return fail(`"${text}" has a ${c.length}-digit year; a two-digit year is ambiguous by a century and is refused rather than guessed`);
  }

  const dayFirst = order === 'dmy';
  const day = Number(dayFirst ? a : b);
  const month = Number(dayFirst ? b : a);
  if (month > 12) {
    return fail(
      `"${text}" read as ${order.toUpperCase()} gives month ${month}, which does not exist; the file is not in ${order.toUpperCase()} order — declare its date order rather than letting it be silently reinterpreted`,
    );
  }
  const built = buildDate(Number(c), month, day, text);
  if (!built.ok) return built;
  // Flag the genuinely ambiguous case: both components ≤ 12, so the order mattered.
  if (day <= 12) built.value.ambiguousOrderResolvedBy = order;
  return built;
}

function buildDate(year: number, month: number, day: number, original: string): ParseResult<DateParse> {
  if (month < 1 || month > 12) return fail(`"${original}" has month ${month}, which does not exist`);
  if (day < 1 || day > 31) return fail(`"${original}" has day ${day}, which does not exist`);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return fail(`"${original}" is not a real calendar date (${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year} does not exist)`);
  }
  return ok({ iso: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` });
}

/* ------------------------------------------------------------------ */
/* Booleans                                                            */
/* ------------------------------------------------------------------ */

const TRUE_TOKENS = new Set(['true', 'yes', 'y', '1', 'paid', 'registered', 'available']);
const FALSE_TOKENS = new Set(['false', 'no', 'n', '0', 'unpaid', 'unregistered', 'not available']);

export function parseBoolean(raw: unknown): ParseResult<boolean> {
  if (typeof raw === 'boolean') return ok(raw);
  if (isBlank(raw)) return fail('empty');
  const c = canonicalise(String(raw));
  if (TRUE_TOKENS.has(c)) return ok(true);
  if (FALSE_TOKENS.has(c)) return ok(false);
  return fail(`"${String(raw).trim()}" is not a yes/no value this parser recognises`);
}

/* ------------------------------------------------------------------ */
/* Record schemas                                                      */
/* ------------------------------------------------------------------ */

export type FieldKind = 'text' | 'number' | 'money' | 'area' | 'rate' | 'date' | 'boolean';

export interface FieldSpec {
  /** Canonical key written onto `IngestedRecord.fields`. */
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** Canonicalised header aliases. Matched exactly, then by prefix, then by containment. */
  aliases: string[];
}

export interface RecordSchema {
  recordType: IngestedRecordType;
  fields: FieldSpec[];
  /**
   * The field whose value is the source's own observation date. Drives
   * `IngestedRecord.observedAt`, which the contract defines as "when the
   * source observed this, not when we read it".
   */
  observedAtFields: string[];
  /** One line describing what a row of this type is, used in notes. */
  rowDescription: string;
}

const f = (key: string, label: string, kind: FieldKind, required: boolean, aliases: string[]): FieldSpec => ({
  key,
  label,
  kind,
  required,
  aliases: aliases.map(canonicalise),
});

/**
 * The schemas.
 *
 * Aliases are deliberately generous — real files say `Extent`, `Area`,
 * `Measurement`, `Sy. Extent` and `Site area` for the same thing, and an
 * intake that only accepts one spelling pushes the normalisation work back
 * onto the operator, which is where it was before this pipeline existed. The
 * Dutch aliases on `parcel` are there so the open PDOK feeds land in the same
 * canonical shape as a hand-made CSV.
 */
export const RECORD_SCHEMAS: Record<IngestedRecordType, RecordSchema> = {
  guidance_value: {
    recordType: 'guidance_value',
    rowDescription: 'a notified guidance value for a locality or classification',
    observedAtFields: ['effectiveOn'],
    fields: [
      f('locality', 'Locality', 'text', true, ['locality', 'area name', 'place', 'location', 'village', 'ward', 'zone name']),
      f('ratePerSqm', 'Guidance rate per m²', 'rate', true, ['rate', 'guidance value', 'guidance rate', 'circle rate', 'value', 'rate per unit', 'market value', 'woz value']),
      f('effectiveOn', 'Effective from', 'date', false, ['effective from', 'effective date', 'effective on', 'w e f', 'wef', 'notified on', 'date', 'valuation date', 'waardepeildatum']),
      f('propertyClass', 'Property classification', 'text', false, ['property class', 'classification', 'category', 'type', 'property type', 'usage']),
      f('district', 'District', 'text', false, ['district']),
      f('taluk', 'Taluk', 'text', false, ['taluk', 'taluka', 'tehsil']),
      f('hobli', 'Hobli', 'text', false, ['hobli']),
      f('village', 'Village', 'text', false, ['village', 'village name']),
      f('notificationRef', 'Notification reference', 'text', false, ['notification', 'notification no', 'notification reference', 'circular', 'reference']),
      f('currency', 'Currency', 'text', false, ['currency', 'ccy']),
    ],
  },

  comparable: {
    recordType: 'comparable',
    rowDescription: 'a transacted comparable',
    observedAtFields: ['transactedOn'],
    fields: [
      f('address', 'Address', 'text', true, ['address', 'property', 'property address', 'comparable', 'description', 'site', 'project']),
      f('areaSqm', 'Area (m²)', 'area', true, ['area', 'extent', 'measurement', 'site area', 'plot area', 'built up area', 'super built up area', 'saleable area', 'carpet area', 'dimensions', 'size']),
      f('price', 'Price', 'money', true, ['price', 'consideration', 'sale price', 'transacted price', 'amount', 'sale consideration', 'total price']),
      f('transactedOn', 'Transacted on', 'date', true, ['transacted on', 'transaction date', 'date of sale', 'sale date', 'registered on', 'date']),
      f('pricePerSqm', 'Price per m²', 'rate', false, ['price per unit', 'rate', 'rate per unit', 'price per sqft', 'psf', 'unit rate']),
      f('propertyType', 'Property type', 'text', false, ['property type', 'type', 'asset type', 'category']),
      f('locality', 'Locality', 'text', false, ['locality', 'area name', 'micro market', 'location']),
      f('distanceKm', 'Distance (km)', 'number', false, ['distance', 'distance km', 'distance from subject']),
      f('source', 'Source', 'text', false, ['source', 'evidence', 'provenance', 'reference']),
    ],
  },

  encumbrance: {
    recordType: 'encumbrance',
    rowDescription: 'an encumbrance-certificate entry',
    observedAtFields: ['registeredOn'],
    fields: [
      f('instrumentType', 'Instrument', 'text', true, ['instrument', 'instrument type', 'nature of deed', 'nature', 'deed type', 'transaction type', 'document type']),
      f('registeredOn', 'Registered on', 'date', true, ['registered on', 'registration date', 'date of registration', 'date of execution', 'date']),
      f('registrationNumber', 'Registration number', 'text', false, ['registration number', 'registration no', 'document number', 'doc no', 'cd number', 'book volume page']),
      f('executant', 'Executant', 'text', false, ['executant', 'executants', 'seller', 'vendor', 'transferor', 'from party']),
      f('claimant', 'Claimant', 'text', false, ['claimant', 'claimants', 'buyer', 'purchaser', 'transferee', 'to party']),
      f('consideration', 'Consideration', 'money', false, ['consideration', 'amount', 'value', 'sale consideration']),
      f('extentSqm', 'Extent (m²)', 'area', false, ['extent', 'area', 'measurement', 'schedule extent']),
      f('parcelRef', 'Parcel reference', 'text', false, ['survey number', 'survey no', 'sy no', 'property id', 'pid', 'khata number', 'schedule']),
      f('remarks', 'Remarks', 'text', false, ['remarks', 'notes', 'observations']),
    ],
  },

  instrument: {
    recordType: 'instrument',
    rowDescription: 'a registered instrument',
    observedAtFields: ['registeredOn', 'executedOn'],
    fields: [
      f('instrumentType', 'Instrument', 'text', true, ['instrument', 'instrument type', 'deed type', 'nature of deed', 'document type']),
      f('registeredOn', 'Registered on', 'date', false, ['registered on', 'registration date', 'date of registration']),
      f('executedOn', 'Executed on', 'date', false, ['executed on', 'execution date', 'date of execution', 'date']),
      f('registrationNumber', 'Registration number', 'text', false, ['registration number', 'registration no', 'document number', 'doc no']),
      f('executant', 'Executant', 'text', false, ['executant', 'seller', 'vendor', 'transferor', 'from party']),
      f('claimant', 'Claimant', 'text', false, ['claimant', 'buyer', 'purchaser', 'transferee', 'to party']),
      f('consideration', 'Consideration', 'money', false, ['consideration', 'amount', 'sale consideration']),
      f('extentSqm', 'Extent (m²)', 'area', false, ['extent', 'area', 'measurement', 'schedule extent']),
      f('parcelRef', 'Parcel reference', 'text', false, ['survey number', 'survey no', 'sy no', 'property id', 'pid', 'khata number', 'schedule']),
    ],
  },

  parcel: {
    recordType: 'parcel',
    rowDescription: 'a parcel or assessment record',
    observedAtFields: ['paidOn', 'recordedOn'],
    fields: [
      f('parcelRef', 'Parcel reference', 'text', true, [
        'parcel', 'parcel ref', 'parcel id', 'property id', 'pid', 'survey number', 'survey no', 'sy no', 'khata number',
        'application number', 'sas application number', 'identificatie', 'identificatielokaalid',
      ]),
      f('areaSqm', 'Area (m²)', 'area', false, ['area', 'extent', 'assessed area', 'measurement', 'oppervlakte', 'kadastralegroottewaarde']),
      f('holder', 'Recorded holder', 'text', false, ['holder', 'owner', 'recorded owner', 'khatedar', 'name']),
      f('status', 'Status', 'text', false, ['status', 'statushistoriewaarde', 'pandstatus']),
      f('assessmentYear', 'Assessment year', 'text', false, ['assessment year', 'year', 'tax year', 'financial year']),
      f('amountPaid', 'Amount paid', 'money', false, ['amount paid', 'tax paid', 'amount', 'paid', 'demand']),
      f('paidOn', 'Paid on', 'date', false, ['paid on', 'payment date', 'date of payment', 'receipt date']),
      f('recordedOn', 'Recorded on', 'date', false, ['recorded on', 'record date', 'begingeldigheid', 'tijdstipregistratie']),
      f('yearBuilt', 'Year built', 'number', false, ['year built', 'bouwjaar', 'construction year']),
      f('useClass', 'Use class', 'text', false, ['use', 'use class', 'gebruiksdoel', 'usage']),
      f('buildingRef', 'Building reference', 'text', false, ['building', 'building id', 'pandidentificatie']),
      f('locality', 'Locality', 'text', false, ['locality', 'village', 'woonplaats', 'kadastralegemeentewaarde', 'city']),
      f('streetName', 'Street', 'text', false, ['street', 'openbare ruimte', 'road']),
      f('houseNumber', 'House number', 'number', false, ['house number', 'huisnummer', 'door number']),
      f('postcode', 'Postcode', 'text', false, ['postcode', 'postal code', 'pin code', 'pincode']),
      f('sectionRef', 'Section', 'text', false, ['sectie', 'section']),
      f('parcelNumber', 'Parcel number', 'number', false, ['perceelnummer', 'parcel number']),
    ],
  },

  approval: {
    recordType: 'approval',
    rowDescription: 'a permission, registration or notification',
    observedAtFields: ['issuedOn'],
    fields: [
      f('reference', 'Reference', 'text', true, ['reference', 'registration number', 'registration no', 'number', 'certificate number', 'notification number', 'rera number', 'krera number']),
      f('issuedBy', 'Issued by', 'text', true, ['issued by', 'authority', 'issuing authority', 'regulator', 'department']),
      f('issuedOn', 'Issued on', 'date', false, ['issued on', 'issue date', 'date of issue', 'registered on', 'notification date', 'date']),
      f('status', 'Status', 'text', false, ['status', 'state', 'zone', 'land use', 'current status']),
      f('projectName', 'Project', 'text', false, ['project', 'project name', 'scheme', 'layout']),
      f('promoter', 'Promoter', 'text', false, ['promoter', 'developer', 'builder', 'applicant']),
      f('declaredCompletionOn', 'Declared completion', 'date', false, ['completion date', 'declared completion', 'proposed completion', 'expected completion']),
      f('parcelRef', 'Parcel reference', 'text', false, ['survey number', 'survey no', 'sy no', 'property id', 'pid', 'parcel']),
      f('notes', 'Notes', 'text', false, ['notes', 'remarks', 'observations', 'description']),
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Column mapping                                                      */
/* ------------------------------------------------------------------ */

export interface ColumnBinding {
  /** The header exactly as it appeared in the file. */
  column: string;
  canonicalHeader: string;
  /** The schema field this column feeds, or null when nothing matched. */
  field: FieldSpec | null;
  /** Area unit named in the header itself, e.g. `Rate per sq ft (INR)`. */
  headerUnit?: AreaUnitKey;
  /** How the match was made — exact alias, prefix or containment. */
  matchedBy?: 'exact' | 'prefix' | 'contains';
}

/** Headers that carry the unit for another column rather than a value of their own. */
const UNIT_COLUMN_ALIASES = ['unit', 'units', 'uom', 'area unit', 'measure', 'measurement unit', 'rate unit'];

function isUnitColumn(canonicalHeader: string): boolean {
  return UNIT_COLUMN_ALIASES.includes(canonicalHeader);
}

/**
 * Bind the file's headers to schema fields.
 *
 * Candidates are scored, not taken in declaration order. An exact alias match
 * beats a prefix match beats a containment match, and within a tier the
 * *longest* alias wins — otherwise a schema field declared early with a short
 * generic alias steals a column a later field describes precisely. `Site area
 * (sq ft)` binding to `address` because `address` lists `site` and comes first
 * is not a hypothetical: it is what the naive version did.
 *
 * Each column binds at most once and each field is filled at most once, and
 * every unmatched column is reported rather than ignored — an operator whose
 * `Guidance Value` column was silently unread would otherwise see an empty
 * result and no explanation.
 */
export function bindColumns(columns: string[], schema: RecordSchema): ColumnBinding[] {
  const bindings: ColumnBinding[] = columns.map(column => ({
    column,
    canonicalHeader: canonicalise(column),
    field: null,
    headerUnit: detectAreaUnit(column)?.key,
  }));

  type Candidate = { columnIndex: number; fieldIndex: number; tier: number; aliasLength: number; matchedBy: NonNullable<ColumnBinding['matchedBy']> };
  const candidates: Candidate[] = [];

  bindings.forEach((binding, columnIndex) => {
    if (isUnitColumn(binding.canonicalHeader)) return;
    schema.fields.forEach((field, fieldIndex) => {
      for (const alias of field.aliases) {
        if (binding.canonicalHeader === alias) {
          candidates.push({ columnIndex, fieldIndex, tier: 3, aliasLength: alias.length, matchedBy: 'exact' });
        } else if (binding.canonicalHeader.startsWith(`${alias} `)) {
          candidates.push({ columnIndex, fieldIndex, tier: 2, aliasLength: alias.length, matchedBy: 'prefix' });
        } else if (alias.length >= 4 && binding.canonicalHeader.includes(alias)) {
          candidates.push({ columnIndex, fieldIndex, tier: 1, aliasLength: alias.length, matchedBy: 'contains' });
        }
      }
    });
  });

  candidates.sort(
    (a, b) =>
      b.tier - a.tier ||
      b.aliasLength - a.aliasLength ||
      a.fieldIndex - b.fieldIndex ||
      a.columnIndex - b.columnIndex,
  );

  const takenColumns = new Set<number>();
  const takenFields = new Set<number>();
  for (const c of candidates) {
    if (takenColumns.has(c.columnIndex) || takenFields.has(c.fieldIndex)) continue;
    takenColumns.add(c.columnIndex);
    takenFields.add(c.fieldIndex);
    bindings[c.columnIndex].field = schema.fields[c.fieldIndex];
    bindings[c.columnIndex].matchedBy = c.matchedBy;
  }

  return bindings;
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

export interface RawRow {
  /** 1-based line number in the source file, so a rejection points somewhere real. */
  rowNumber: number;
  values: Record<string, unknown>;
}

export interface RejectedRow {
  rowNumber: number;
  /** Specific, and naming the column and value wherever one can be named. */
  reason: string;
  column?: string;
  rawValue?: string;
}

export interface NormalisationContext {
  sourceId: string;
  recordType: IngestedRecordType;
  /** Extra canonical keys that must resolve, on top of the schema's own required set. */
  extraRequiredFields?: string[];
  /** Area unit for columns that name none. Leave unset to reject rather than assume. */
  defaultAreaUnit?: string;
  /** Denominator unit for rate columns that name none. Same rule. */
  defaultRateUnit?: string;
  /** Operator's per-column unit declarations, keyed by the header as written or canonicalised. */
  unitHints?: Record<string, string>;
  dateOrder?: DateOrder;
  /** When the operator says the extract was taken (ISO date). */
  fileObservedAt?: string;
  /** The clock, passed in. Nothing here calls `Date.now()`. */
  now: Date;
  /** Confidence a complete row from this source earns. */
  baseConfidence: number;
  /** Carry columns the schema did not claim onto the record as `extra.<key>`. */
  keepUnmapped?: boolean;
  /**
   * Distinguishes record ids when one source contributes more than one file in
   * a single run. Without it two files against the same source would collide
   * on `...-r0007`, and the second would look like a duplicate of the first.
   */
  idDiscriminator?: string;
}

export interface NormalisationResult {
  records: IngestedRecord[];
  rejected: RejectedRow[];
  bindings: ColumnBinding[];
  /** Headers no schema field claimed. */
  unmappedColumns: string[];
  /** Required schema fields no column supplied — a whole-file problem, not a row one. */
  missingRequiredColumns: string[];
}

function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/**
 * Turn raw rows into `IngestedRecord`s.
 *
 * Row-level failures produce a `RejectedRow`; a file-level failure (a required
 * column simply absent) produces `missingRequiredColumns` and rejects every
 * row with that reason, so the caller never sees "0 records" with no
 * explanation attached.
 */
export function normaliseRows(rows: RawRow[], ctx: NormalisationContext): NormalisationResult {
  const schema = RECORD_SCHEMAS[ctx.recordType];
  const columns = rows.length > 0 ? Object.keys(rows[0].values) : [];
  const bindings = bindColumns(columns, schema);

  const required = new Set<string>([
    ...schema.fields.filter(fs => fs.required).map(fs => fs.key),
    ...(ctx.extraRequiredFields ?? []),
  ]);
  const bound = new Set(bindings.filter(b => b.field).map(b => b.field!.key));
  const missingRequiredColumns = [...required].filter(key => !bound.has(key)).sort();

  const unitColumns = bindings.filter(b => isUnitColumn(b.canonicalHeader)).map(b => b.column);
  const hints = normaliseHints(ctx.unitHints);

  const records: IngestedRecord[] = [];
  const rejected: RejectedRow[] = [];

  for (const row of rows) {
    if (missingRequiredColumns.length > 0) {
      rejected.push({
        rowNumber: row.rowNumber,
        reason: `the file has no column for required field${missingRequiredColumns.length > 1 ? 's' : ''} ${missingRequiredColumns
          .map(k => `\`${k}\` (${schema.fields.find(fs => fs.key === k)?.label ?? k})`)
          .join(', ')}`,
      });
      continue;
    }

    const outcome = normaliseRow(row, bindings, schema, required, unitColumns, hints, ctx);
    if (outcome.ok) records.push(outcome.value);
    else rejected.push({ rowNumber: row.rowNumber, reason: outcome.reason, column: outcome.column, rawValue: outcome.rawValue });
  }

  return {
    records,
    rejected,
    bindings,
    unmappedColumns: bindings.filter(b => !b.field && !isUnitColumn(b.canonicalHeader)).map(b => b.column),
    missingRequiredColumns,
  };
}

function normaliseHints(hints: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(hints ?? {})) out[canonicalise(k)] = v;
  return out;
}

type RowFailure = { ok: false; reason: string; column?: string; rawValue?: string };

function normaliseRow(
  row: RawRow,
  bindings: ColumnBinding[],
  schema: RecordSchema,
  required: Set<string>,
  unitColumns: string[],
  hints: Record<string, string>,
  ctx: NormalisationContext,
): ParseOk<IngestedRecord> | RowFailure {
  const fields: Record<string, string | number | boolean> = {};
  /** Unit stated by a companion unit column on this row, if there is one. */
  const rowUnit = unitColumns.map(c => row.values[c]).find(v => !isBlank(v));
  const rowUnitText = rowUnit === undefined ? undefined : String(rowUnit);

  let missingOptional = 0;

  for (const binding of bindings) {
    const field = binding.field;
    const raw = row.values[binding.column];

    if (!field) {
      if (ctx.keepUnmapped && !isBlank(raw) && !isUnitColumn(binding.canonicalHeader)) {
        fields[`extra.${binding.canonicalHeader.replace(/ /g, '_')}`] = String(raw);
      }
      continue;
    }

    if (isBlank(raw)) {
      if (required.has(field.key)) {
        return { ok: false, reason: `required field \`${field.key}\` (${field.label}) is empty`, column: binding.column, rawValue: raw === undefined ? '' : String(raw) };
      }
      missingOptional += 1;
      continue;
    }

    const converted = convertCell(raw, field, binding, rowUnitText, hints, ctx);
    if (!converted.ok) {
      return { ok: false, reason: `column "${binding.column}" -> \`${field.key}\`: ${converted.reason}`, column: binding.column, rawValue: String(raw) };
    }
    for (const [k, v] of Object.entries(converted.value)) fields[k] = v;
  }

  // Cross-field checks the schema alone cannot express.
  const crossCheck = crossCheckRow(schema.recordType, fields);
  if (!crossCheck.ok) return { ok: false, reason: crossCheck.reason };

  const observed = resolveObservedAt(schema, fields, ctx);
  fields.observedAtBasis = observed.basis;

  const confidence = round(
    Math.min(0.99, Math.max(0.3, ctx.baseConfidence - 0.02 * missingOptional - (observed.basis === 'ingestion_clock' ? 0.05 : 0))),
    2,
  );

  return ok({
    id: `ingested-${ctx.sourceId}${ctx.idDiscriminator ? `-${ctx.idDiscriminator}` : ''}-${ctx.recordType}-r${String(row.rowNumber).padStart(4, '0')}`,
    sourceId: ctx.sourceId,
    recordType: ctx.recordType,
    fields,
    observedAt: observed.iso,
    confidence,
  });
}

function convertCell(
  raw: unknown,
  field: FieldSpec,
  binding: ColumnBinding,
  rowUnitText: string | undefined,
  hints: Record<string, string>,
  ctx: NormalisationContext,
): ParseResult<Record<string, string | number | boolean>> {
  const declaredUnit = hints[binding.canonicalHeader] ?? hints[canonicalise(field.key)];

  switch (field.kind) {
    case 'text':
      return ok({ [field.key]: String(raw).trim() });

    case 'number': {
      const n = parseNumeric(raw);
      return n.ok ? ok({ [field.key]: n.value.value }) : n;
    }

    case 'money': {
      const n = parseNumeric(raw);
      if (!n.ok) return n;
      const out: Record<string, string | number | boolean> = { [field.key]: round(n.value.value, 2) };
      if (n.value.multiplier || n.value.indianGrouping) out[`${field.key}Source`] = String(raw).trim();
      return ok(out);
    }

    case 'area': {
      const a = parseAreaToSqm(raw, {
        headerUnit: binding.column,
        rowUnit: rowUnitText,
        declaredUnit,
        defaultUnit: ctx.defaultAreaUnit,
      });
      if (!a.ok) return a;
      return ok({
        [field.key]: round(a.value.sqm, 4),
        [`${field.key}Source`]: String(raw).trim(),
        [`${field.key}SourceUnit`]: a.value.unit,
        [`${field.key}Working`]: a.value.working,
      });
    }

    case 'rate': {
      const r = parseRateToPerSqm(raw, {
        headerUnit: binding.column,
        rowUnit: rowUnitText,
        declaredUnit,
        defaultUnit: ctx.defaultRateUnit ?? ctx.defaultAreaUnit,
      });
      if (!r.ok) return r;
      return ok({
        [field.key]: round(r.value.perSqm, 2),
        [`${field.key}Source`]: String(raw).trim(),
        [`${field.key}SourceUnit`]: r.value.unit,
        [`${field.key}Working`]: r.value.working,
      });
    }

    case 'date': {
      const d = parseDateToIso(raw, ctx.dateOrder ?? 'dmy');
      if (!d.ok) return d;
      const out: Record<string, string | number | boolean> = { [field.key]: d.value.iso };
      if (d.value.ambiguousOrderResolvedBy) {
        out[`${field.key}OrderAssumed`] = d.value.ambiguousOrderResolvedBy;
      }
      return ok(out);
    }

    case 'boolean': {
      const b = parseBoolean(raw);
      return b.ok ? ok({ [field.key]: b.value }) : b;
    }

    default:
      return fail(`unhandled field kind for \`${field.key}\``);
  }
}

/**
 * Checks that need two fields at once.
 *
 * The comparable case is the one that matters: a file that states both a price
 * and a per-unit rate is asserting two things that must agree, and when they
 * do not, one of them is wrong. Averaging them, or preferring one silently,
 * would launder a corrupted file into a confident valuation input — so the row
 * is rejected with both numbers named and left for a human.
 */
function crossCheckRow(recordType: IngestedRecordType, fields: Record<string, string | number | boolean>): { ok: true } | { ok: false; reason: string } {
  if (recordType !== 'comparable') return { ok: true };

  const area = typeof fields.areaSqm === 'number' ? fields.areaSqm : undefined;
  const price = typeof fields.price === 'number' ? fields.price : undefined;
  if (area === undefined || price === undefined) return { ok: true };
  if (area <= 0) return { ok: false, reason: `area resolves to ${area} m², which cannot be right` };

  const derived = price / area;
  const stated = typeof fields.pricePerSqm === 'number' ? fields.pricePerSqm : undefined;

  if (stated === undefined) {
    fields.pricePerSqm = round(derived, 2);
    fields.pricePerSqmBasis = 'derived from price ÷ area';
    return { ok: true };
  }

  const divergence = Math.abs(stated - derived) / Math.max(stated, derived);
  if (divergence > 0.05) {
    return {
      ok: false,
      reason: `the stated rate and the price/area arithmetic disagree by ${(divergence * 100).toFixed(1)}%: the row states ${round(stated, 2)} per m² but ${round(price, 2)} ÷ ${round(area, 4)} m² = ${round(derived, 2)} per m². One of the three figures is wrong; the row is not ingested rather than one of them being silently preferred`,
    };
  }
  fields.pricePerSqmBasis = `stated, and within ${(divergence * 100).toFixed(1)}% of price ÷ area`;
  return { ok: true };
}

type ObservedAtBasis = 'row_date' | 'file_declared' | 'ingestion_clock';

/**
 * `IngestedRecord.observedAt` is defined as when the *source* observed the
 * fact. Falling back to the ingestion clock therefore states something false,
 * so the fallback is allowed but always labelled: `observedAtBasis` goes onto
 * the record, and a clock-derived date costs the record confidence.
 */
function resolveObservedAt(
  schema: RecordSchema,
  fields: Record<string, string | number | boolean>,
  ctx: NormalisationContext,
): { iso: string; basis: ObservedAtBasis } {
  for (const key of schema.observedAtFields) {
    const value = fields[key];
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { iso: value, basis: 'row_date' };
  }
  if (ctx.fileObservedAt && /^\d{4}-\d{2}-\d{2}/.test(ctx.fileObservedAt)) {
    return { iso: ctx.fileObservedAt.slice(0, 10), basis: 'file_declared' };
  }
  return { iso: ctx.now.toISOString().slice(0, 10), basis: 'ingestion_clock' };
}
