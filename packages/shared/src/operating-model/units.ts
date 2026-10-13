/**
 * Units: one table of conversions, one reader of what a person typed, one
 * writer of what a person reads.
 *
 * A value is kept once, in its dimension's base unit (square metres, metres,
 * the field's own currency), with what was typed kept beside it. A deed that
 * recites "1 acre 22 guntas" is worked on as 6,273 sqm and printed as the
 * deed wrote it.
 *
 * Lakh and crore are ways of writing rupees, not units of anything: they are
 * read on the way in and written on the way out, and never stored.
 */

import { fieldStatePack } from './field-sets/state-packs';
import type { Dimension, FieldCurrency } from './types';

/* ==================================================================== */
/* Area                                                                  */
/* ==================================================================== */

export const SQM_PER_SQFT = 0.09290304;
export const SQM_PER_ACRE = 4046.8564224;
/** A gunta is a fortieth of an acre. */
export const SQM_PER_GUNTA = 101.17141056;

export type AreaUnit = 'sqm' | 'sqft' | 'sqyd' | 'acre' | 'gunta' | 'cent' | 'ground' | 'hectare';

/** Square metres in one of each unit that means the same everywhere. A ground does not: see `groundSqm`. */
export const SQM_PER_AREA_UNIT: Record<Exclude<AreaUnit, 'ground'>, number> = {
  sqm: 1,
  sqft: SQM_PER_SQFT,
  sqyd: 0.83612736,
  acre: SQM_PER_ACRE,
  gunta: SQM_PER_GUNTA,
  // A cent is a hundredth of an acre.
  cent: 40.468564224,
  hectare: 10000,
};

/**
 * Square metres in a ground. A ground is a customary measure, and only a
 * state whose pack gives it a settled size has one (`field-sets/state-packs.ts`);
 * anywhere else it is not converted, and the person is asked for another unit.
 */
export function groundSqm(state: string | undefined): number | null {
  const sqft = fieldStatePack(state)?.groundSqft;
  return sqft ? sqft * SQM_PER_SQFT : null;
}

/* ==================================================================== */
/* Every dimension                                                       */
/* ==================================================================== */

/** What a unit of a dimension is worth in the base unit. The first listed is the base. */
const PER_BASE: Record<Exclude<Dimension, 'money'>, Record<string, number>> = {
  area: SQM_PER_AREA_UNIT,
  length: { m: 1, ft: 0.3048, in: 0.0254, mm: 0.001, cm: 0.01, km: 1000, yd: 0.9144 },
  volume: { cum: 1, cft: 0.028316846592, litre: 0.001 },
  mass: { kg: 1, tonne: 1000, quintal: 100, g: 0.001 },
  time: { days: 1, weeks: 7, months: 30.4375, years: 365.25 },
  count: { nos: 1 },
  ratio: { ratio: 1 },
};

export const UNIT_LABEL: Record<string, string> = {
  sqm: 'sqm',
  sqft: 'sqft',
  sqyd: 'sq yd',
  acre: 'acre',
  gunta: 'gunta',
  cent: 'cent',
  ground: 'ground',
  hectare: 'hectare',
  cum: 'cu m',
  cft: 'cu ft',
};

/** How each unit is written, loosely, by people and by papers. */
const UNIT_WORDS: Array<[RegExp, string]> = [
  [/^(?:square\s*met(?:re|er)s?|sq\.?\s*m(?:trs?|eters?|etres?)?\.?|sqm|m2|m²)$/i, 'sqm'],
  [/^(?:square\s*f(?:ee|oo)t|sq\.?\s*f(?:ee)?t\.?|sqft|sft)$/i, 'sqft'],
  [/^(?:square\s*yards?|sq\.?\s*yds?\.?|sqyd|gaj)$/i, 'sqyd'],
  [/^acres?$/i, 'acre'],
  [/^gunt(?:a|ha)s?$/i, 'gunta'],
  [/^cents?$/i, 'cent'],
  [/^grounds?$/i, 'ground'],
  [/^(?:hectares?|ha)$/i, 'hectare'],
  [/^(?:m|mtrs?\.?|met(?:re|er)s?)$/i, 'm'],
  [/^(?:ft\.?|feet|foot|')$/i, 'ft'],
  [/^(?:in\.?|inch(?:es)?|")$/i, 'in'],
  [/^mm$/i, 'mm'],
  [/^cm$/i, 'cm'],
  [/^km$/i, 'km'],
  [/^(?:yd|yards?)$/i, 'yd'],
  [/^(?:cum|cu\.?\s*m|m3|m³)$/i, 'cum'],
  [/^(?:cft|cu\.?\s*ft)$/i, 'cft'],
  [/^(?:l|lit(?:re|er)s?)$/i, 'litre'],
  [/^(?:kg|kgs|kilograms?)$/i, 'kg'],
  [/^(?:t|mt|tonnes?)$/i, 'tonne'],
  [/^quintals?$/i, 'quintal'],
  [/^(?:g|grams?)$/i, 'g'],
  [/^days?$/i, 'days'],
  [/^weeks?$/i, 'weeks'],
  [/^months?$/i, 'months'],
  [/^(?:years?|yrs?)$/i, 'years'],
  [/^(?:nos?\.?|numbers?)$/i, 'nos'],
];

/** The unit a word names, or null. */
export function unitNamed(word: string): string | null {
  const w = word.trim().replace(/\s+/g, ' ');
  for (const [pattern, unit] of UNIT_WORDS) if (pattern.test(w)) return unit;
  return null;
}

/** The units of a dimension, base first. */
export function unitsOf(dimension: Dimension): string[] {
  if (dimension === 'money') return ['rupees', 'lakh', 'crore'];
  if (dimension === 'area') return [...Object.keys(SQM_PER_AREA_UNIT), 'ground'];
  return Object.keys(PER_BASE[dimension]);
}

export function baseUnit(dimension: Dimension): string {
  return unitsOf(dimension)[0]!;
}

export interface UnitContext {
  /** The state the land is in, for the measures that differ by state. */
  state?: string;
}

function factor(dimension: Dimension, unit: string, ctx: UnitContext): number | null {
  if (dimension === 'money') return unit === 'crore' ? 1e7 : unit === 'lakh' ? 1e5 : unit === 'rupees' ? 1 : null;
  if (dimension === 'area' && unit === 'ground') return groundSqm(ctx.state);
  return PER_BASE[dimension][unit] ?? null;
}

/** A value in a unit, as the dimension's base unit. Null where the unit is not one of the dimension's, or has no settled size here. */
export function toBase(value: number, unit: string, dimension: Dimension, ctx: UnitContext = {}): number | null {
  const f = factor(dimension, unit, ctx);
  return f === null ? null : value * f;
}

export function fromBase(base: number, unit: string, dimension: Dimension, ctx: UnitContext = {}): number | null {
  const f = factor(dimension, unit, ctx);
  return f === null ? null : base / f;
}

/** Square metres from a value in a unit. Kept for the callers that have always asked in these words. */
export function areaInSqm(value: number, unit: AreaUnit, ctx: UnitContext = {}): number | null {
  return toBase(value, unit, 'area', ctx);
}

/* ==================================================================== */
/* Reading what was typed                                                */
/* ==================================================================== */

export interface Entered {
  value: number;
  unit: string;
  /** The words as typed, kept where they are more than a number and a unit: "1 acre 22 guntas". */
  text?: string;
}

const NUMBER = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const num = (raw: string): number => Number(raw.replace(/,/g, ''));

/**
 * What a person typed for a measure, as the base value and what was typed.
 *
 * A bare number is in `defaultUnit`. A number and a unit is in that unit. Two
 * or three of them together ("1 acre 22 guntas", "2 acres 10 guntas 4 sqft",
 * "5 ft 6 in") are added up and kept under the first unit named, with the
 * words kept so they print as written.
 */
export function parseMeasure(
  typed: string | number,
  dimension: Dimension,
  options: UnitContext & { defaultUnit?: string; enterIn?: readonly string[] } = {},
): { value: number; entered: Entered } | { error: string } {
  const allowed = options.enterIn?.length ? options.enterIn : unitsOf(dimension);
  // A bare number is in the base unit, or in the first unit the field allows where the base is not one of them.
  const fallback = options.defaultUnit ?? (allowed.includes(baseUnit(dimension)) ? baseUnit(dimension) : allowed[0]!);
  if (typeof typed === 'number') {
    const base = toBase(typed, fallback, dimension, options);
    if (base === null || !Number.isFinite(base)) return { error: `"${typed}" is not a measure in ${fallback}.` };
    return { value: base, entered: { value: typed, unit: fallback } };
  }
  const text = typed.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (dimension === 'money') return parseMoney(text);

  const bare = new RegExp(`^-?${NUMBER}$`).exec(text);
  if (bare) {
    const value = num(text);
    const base = toBase(value, fallback, dimension, options);
    if (base === null) return { error: `${fallback} has no settled size here. Give it in another unit.` };
    return { value: base, entered: { value, unit: fallback } };
  }

  // One or more "number unit" parts, with "and" or a comma between them.
  // A unit may end in the 2 or 3 of "m2" and "m3".
  const part = new RegExp(`${NUMBER}\\s*([^\\d,]+?(?:(?<=[a-z])[23](?![\\d.,]))?)\\s*(?:,|\\band\\b)?\\s*(?=\\d|$)`, 'gi');
  const parts = [...text.matchAll(part)];
  if (!parts.length || text.replace(part, '').trim()) return { error: `"${typed}" is not a measure. Write a number and a unit, as 2,450 sqft.` };
  let total = 0;
  let first: { value: number; unit: string } | undefined;
  for (const part of parts) {
    const unit = unitNamed(part[2]!.replace(/[.]$/g, '').trim());
    if (!unit || !unitsOf(dimension).includes(unit)) {
      return { error: `"${part[2]!.trim()}" is not a unit of ${dimension}. Use one of: ${allowed.join(', ')}.` };
    }
    if (!allowed.includes(unit)) return { error: `This is entered in ${allowed.join(', ')}.` };
    const base = toBase(num(part[1]!), unit, dimension, options);
    if (base === null) return { error: `A ${unit} has no settled size${options.state ? ` in ${options.state}` : ''}. Give it in another unit.` };
    total += base;
    first ??= { value: num(part[1]!), unit };
  }
  return { value: round(total, 4), entered: parts.length > 1 ? { ...first!, text } : first! };
}

function parseMoney(text: string): { value: number; entered: Entered } | { error: string } {
  const hit = new RegExp(`^(?:rs\\.?|inr|₹)?\\s*(-?${NUMBER})\\s*(crores?|cr\\.?|lakhs?|lacs?|l)?$`, 'i').exec(text);
  if (!hit) return { error: `"${text}" is not an amount. Write it as 4,20,00,000 or 4.2 Cr or 45 lakh.` };
  const value = num(hit[1]!);
  const word = (hit[3] ?? '').toLowerCase();
  const unit = word.startsWith('c') ? 'crore' : word ? 'lakh' : 'rupees';
  return { value: round(value * (unit === 'crore' ? 1e7 : unit === 'lakh' ? 1e5 : 1), 2), entered: { value, unit } };
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/* ==================================================================== */
/* Writing what a person reads                                           */
/* ==================================================================== */

const grouped = (n: number, places = 2): string => n.toLocaleString('en-IN', { maximumFractionDigits: places });

/**
 * Rupees in words a person says: crore from one crore up, lakh from one lakh
 * up, the figure below that. The one place lakh and crore are written.
 */
export function rupeesSaid(n: number, sign = 'Rs ', places = 2): string {
  const a = Math.abs(n);
  const minus = n < 0 ? '−' : '';
  // The band is chosen by the figure as it will print: 99,99,999 is a crore to two places, never "100 lakh".
  const to = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
  if (a >= 1e7 || to(a / 1e5, 2) >= 100) return `${minus}${sign}${grouped(a / 1e7)} Cr`;
  if (a >= 1e5 || to(a, places) >= 1e5) return `${minus}${sign}${grouped(a / 1e5)} lakh`;
  return `${minus}${sign}${grouped(a, places)}`;
}

const CURRENCY_SIGN: Record<FieldCurrency, { sign: string; locale: string }> = {
  INR: { sign: '₹', locale: 'en-IN' },
  USD: { sign: '$', locale: 'en-US' },
  AED: { sign: 'AED ', locale: 'en-US' },
  EUR: { sign: '€', locale: 'en-IE' },
};

/** An amount in its own currency. Rupees in lakh and crore; another currency in full, never converted. */
export function formatMoney(amount: number, currency: FieldCurrency = 'INR', precision = 2): string {
  const { sign, locale } = CURRENCY_SIGN[currency];
  if (currency === 'INR') return rupeesSaid(amount, sign, precision);
  return `${amount < 0 ? '−' : ''}${sign}${Math.abs(amount).toLocaleString(locale, { maximumFractionDigits: precision })}`;
}

/** An amount written out to the rupee, for where two amounts would read the same in lakh and crore. */
export function formatMoneyInFull(amount: number, currency: FieldCurrency = 'INR'): string {
  const { sign, locale } = CURRENCY_SIGN[currency];
  return `${amount < 0 ? '−' : ''}${sign}${Math.abs(amount).toLocaleString(locale, { maximumFractionDigits: 2 })}`;
}

/**
 * A measure as a person reads it: what was typed where that was kept, with
 * the base value beside it when the two differ; else the base value.
 */
export function formatMeasure(base: number, dimension: Dimension, options: { entered?: Entered; precision?: number; currency?: FieldCurrency } = {}): string {
  if (dimension === 'money') return formatMoney(base, options.currency, options.precision);
  const unit = baseUnit(dimension);
  const said = (value: number, u: string) => `${grouped(value, options.precision ?? 2)} ${UNIT_LABEL[u] ?? u}${value !== 1 && (u === 'acre' || u === 'gunta' || u === 'cent' || u === 'ground' || u === 'hectare') ? 's' : ''}`;
  const inBase = said(base, unit);
  const entered = options.entered;
  if (!entered || (entered.unit === unit && !entered.text)) return inBase;
  return `${entered.text ?? said(entered.value, entered.unit)} (${inBase})`;
}
