/**
 * Every valuation input the file already holds, offered where the valuation
 * reads it.
 *
 * ## Why
 *
 * The Value tab asked for twenty-odd inputs one cell at a time, and several of
 * them were already on the file: the extent the sale deed conveys, the built-up
 * area the plan sanctions, the year the occupancy certificate was issued, the
 * guidance rate the state's own revenue map publishes for the survey number,
 * the rent the lease reserves. Typing those again is copying, not judgement —
 * and a copy can be wrong where the page cannot.
 *
 * So each input gathers what the file says about it, from every place that
 * says anything: the documents (with the page and the words), the revenue-map
 * read, the surveyor's outline, the state pack, and the conventions the check
 * schema already writes down. The page fills them in, a person accepts them,
 * and only then are they recorded.
 *
 * ## The rules
 *
 * **An offer names where it came from.** The document and the page, the map
 * read and its survey number, the pack and its date, the convention and why.
 *
 * **An offer is not a recorded value.** It does not count until a person
 * accepts it, and accepting it records it exactly as typing it would — through
 * the same proof rule, citing the same document.
 *
 * **Nothing here is a market figure the file does not hold.** No locality
 * medians, no portal listings, no rate anybody made up. The guidance value is
 * offered as what it is — the statutory floor — and the inputs the file holds
 * nothing for (a cap rate, a replacement cost) wait for a person, and the page
 * says so.
 */

import type { CheckInstance, DdAssessment, DdProject, EvidenceRecord } from './types';
import type { DocumentFact } from './document-parse';
import { CHECK_FIELDS } from './check-schemas';
import { isBlank } from './check-fields';
import { factReview, standingFacts, waitingReadings } from './fact-review';
import { createAssessment, recordAuditEvent, recordCheckFields } from './operations';
import { patchProject } from './capabilities';
import {
  fileRevenueMapAsEvidence,
  parcelLabels,
  revenueExtent,
  revenueGuidance,
  revenueReads,
  surveyNumbersLabel,
  unacceptedWords,
  wholeNumberWords,
  type RevenueMapAnchor,
} from './revenue-map';
import { COMPARABLE_SOURCE_LABEL, MIN_SCHEDULE, comparableSchedule, fileComparableSchedule } from './comparables';
import { decisionRefused, mayDecidePaper, reviewFacts } from './review';
import type { MayDecide } from './team';
import { REFERENCE_DATA, resolveStatePack } from '../reference';

/* ==================================================================== */
/* The inputs                                                            */
/* ==================================================================== */

export type ValueApproachKey = 'property' | 'comparable' | 'cost' | 'income' | 'residual';

export const VALUE_APPROACH_LABEL: Record<ValueApproachKey, string> = {
  property: 'The property',
  comparable: 'Comparables',
  cost: 'Cost',
  income: 'Income',
  residual: 'Residual',
};

/** The project particulars the approaches read directly. */
export type ValueProjectField = 'landAreaSqm' | 'builtUpAreaSqm' | 'saleableAreaSqm';

export type ValueTarget =
  | { kind: 'project'; field: ValueProjectField }
  | { kind: 'check'; definitionId: string; key: string };

export interface ValueInputSpec {
  /** Stable, and the key every offer for it carries. */
  key: string;
  approach: ValueApproachKey;
  target: ValueTarget;
  label: string;
  unit: string;
  /** When set, the input is a choice among these, not a number. */
  options?: readonly string[];
}

const check = (id: string, key: string): ValueTarget => ({ kind: 'check', definitionId: `indicative_valuation.${id}`, key });

const INTEREST_OPTIONS = ['freehold', 'leasehold', 'development rights'] as const;
const QUOTED_BASIS_OPTIONS = ['carpet', 'built-up', 'super built-up'] as const;

/**
 * Every input, in the order the page fills them: the property first, because
 * every approach multiplies something by its area, then the approaches in the
 * order a valuer reaches for them.
 */
export const VALUE_INPUTS: readonly ValueInputSpec[] = [
  { key: 'land_area', approach: 'property', target: { kind: 'project', field: 'landAreaSqm' }, label: 'Plot area', unit: 'sqm' },
  { key: 'built_up_area', approach: 'property', target: { kind: 'project', field: 'builtUpAreaSqm' }, label: 'Built-up area', unit: 'sqm' },
  { key: 'carpet_area', approach: 'property', target: check('subject', 'rera_carpet_area'), label: 'RERA carpet area', unit: 'sqm' },
  { key: 'area_valued', approach: 'property', target: { kind: 'project', field: 'saleableAreaSqm' }, label: 'Saleable / SBA', unit: 'sqm' },
  { key: 'quoted_basis', approach: 'property', target: check('subject', 'quoted_basis'), label: 'Area basis', unit: '', options: QUOTED_BASIS_OPTIONS },
  { key: 'guideline_rate', approach: 'property', target: check('subject', 'guideline_rate_per_sqm'), label: 'Guideline rate', unit: 'INR/sqm' },
  { key: 'interest', approach: 'property', target: check('subject', 'interest'), label: 'Interest valued', unit: '', options: INTEREST_OPTIONS },
  { key: 'rate_per_sqm', approach: 'comparable', target: check('comparable_inputs', 'rate_per_sqm'), label: 'Rate applied', unit: 'INR/sqm' },
  { key: 'net_adjustment_pct', approach: 'comparable', target: check('comparable_inputs', 'net_adjustment_pct'), label: 'Net adjustment', unit: '%' },
  { key: 'land_rate_per_sqm', approach: 'cost', target: check('cost_inputs', 'land_rate_per_sqm'), label: 'Land rate', unit: 'INR/sqm' },
  { key: 'replacement_rate', approach: 'cost', target: check('cost_inputs', 'replacement_rate'), label: 'Replacement cost', unit: 'INR/sqm' },
  { key: 'effective_age_years', approach: 'cost', target: check('cost_inputs', 'effective_age_years'), label: 'Effective age', unit: 'years' },
  { key: 'expected_life_years', approach: 'cost', target: check('cost_inputs', 'expected_life_years'), label: 'Expected total life', unit: 'years' },
  { key: 'let_area', approach: 'income', target: check('income_inputs', 'let_area'), label: 'Lettable area', unit: 'sqm' },
  { key: 'achievable_rent', approach: 'income', target: check('income_inputs', 'achievable_rent'), label: 'Achievable rent', unit: 'INR/sqm/month' },
  { key: 'vacancy_pct', approach: 'income', target: check('income_inputs', 'vacancy_pct'), label: 'Vacancy allowance', unit: '%' },
  { key: 'opex_pct', approach: 'income', target: check('income_inputs', 'opex_pct'), label: 'Operating expenses', unit: '%' },
  { key: 'cap_rate_pct', approach: 'income', target: check('income_inputs', 'cap_rate_pct'), label: 'Capitalisation rate', unit: '%' },
  { key: 'gdv', approach: 'residual', target: check('residual_inputs', 'gdv'), label: 'Gross development value', unit: 'INR' },
  { key: 'construction_cost', approach: 'residual', target: check('residual_inputs', 'construction_cost'), label: 'Construction cost', unit: 'INR' },
  { key: 'developer_profit_pct', approach: 'residual', target: check('residual_inputs', 'developer_profit_pct'), label: 'Developer’s profit', unit: '%' },
  { key: 'professional_fees_pct', approach: 'residual', target: check('residual_inputs', 'professional_fees_pct'), label: 'Professional fees', unit: '%' },
  { key: 'finance_pct', approach: 'residual', target: check('residual_inputs', 'finance_pct'), label: 'Finance rate', unit: '% a year' },
  { key: 'marketing_pct', approach: 'residual', target: check('residual_inputs', 'marketing_pct'), label: 'Marketing and disposal', unit: '%' },
  { key: 'build_months', approach: 'residual', target: check('residual_inputs', 'build_months'), label: 'Build period', unit: 'months' },
  { key: 'discount_rate_pct', approach: 'residual', target: check('residual_inputs', 'discount_rate_pct'), label: 'Discount rate', unit: '% a year' },
  { key: 'land_acquisition_pct', approach: 'residual', target: check('residual_inputs', 'land_acquisition_pct'), label: 'Land acquisition costs', unit: '%' },
];

const SPEC_BY_KEY = new Map(VALUE_INPUTS.map((s) => [s.key, s]));
/** Inputs that are signed adjustments rather than quantities. */
const SIGNED: ReadonlySet<string> = new Set(['net_adjustment_pct']);

/** The schema behind a check input — its proof rule and whether the approach needs it. */
function fieldDef(target: ValueTarget) {
  if (target.kind !== 'check') return undefined;
  return (CHECK_FIELDS[target.definitionId] ?? []).find((d) => d.key === target.key);
}

/* ==================================================================== */
/* An offer                                                              */
/* ==================================================================== */

export type ValueSourceKind = 'document' | 'revenue_map' | 'comparables' | 'boundary' | 'state_pack' | 'convention' | 'project';

export interface ValueSource {
  kind: ValueSourceKind;
  /** As a person names it: "Sale deed", "State revenue map", "Karnataka pack". */
  label: string;
  /** The part of it: "p. 3", "Sy. 118/2, White Field", "as of 2026-04-01". */
  detail?: string;
  evidenceId?: string;
  page?: number;
  /** The document's own words, never rewritten. */
  quote?: string;
}

export interface ValueOffer {
  /** Stable while the file says the same thing: the input, the source and the value. */
  id: string;
  input: string;
  /** A quantity, or a choice among a field's options. */
  value: number | string;
  display: string;
  source: ValueSource;
  /** Why this number, in a line. Shown beside it. */
  basis: string;
  /** Lower first, when several sources offer the same input. */
  rank: number;
  /** Recorded on the same check beside it, because the value implies them. */
  with?: Record<string, string | number>;
  /** The document facts it was read from, which accepting it accepts too. */
  facts?: Array<{ evidenceId: string; key: string }>;
}

/* ==================================================================== */
/* Formatting                                                            */
/* ==================================================================== */

function grouped(n: number, digits = 0): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** A value in its own unit, the way a valuer writes it. */
export function formatValueInput(value: number | string, unit: string): string {
  if (typeof value === 'string') return value;
  // A true minus: these sit in columns beside positive figures.
  if (value < 0) return `\u2212${formatValueInput(-value, unit)}`;
  if (unit === 'INR') return `₹${grouped(Math.round(value))}`;
  if (unit.startsWith('INR/')) return `₹${grouped(value, value < 100 ? 2 : 0)}/${unit.slice(4).replace('sqm/month', 'sqm a month')}`;
  if (unit === 'sqm') return `${grouped(value, value < 100 ? 2 : 0)} sqm`;
  if (unit.startsWith('%')) return `${grouped(value, 2)}%${unit.slice(1)}`;
  if (unit === 'years') return `${grouped(value, 1)} years`;
  if (unit === 'months') return `${grouped(value, 0)} months`;
  return `${grouped(value, 2)} ${unit}`.trim();
}

function displayDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ==================================================================== */
/* Reading the file                                                      */
/* ==================================================================== */

/** A row that stands for a paper somebody supplied, and is still relied on. */
function onFile(row: EvidenceRecord): boolean {
  if (row.status === 'superseded' || row.status === 'rejected' || row.status === 'missing') return false;
  return row.attachments.length > 0 || row.status === 'received' || row.status === 'validated' || row.status === 'used';
}

interface Stated {
  row: EvidenceRecord;
  fact: DocumentFact;
}

/**
 * Every number a document on file states under `key`, newest document first.
 * What stands only (`standingFacts`): a model's reading nobody has accepted,
 * and a value two readers differ on, are offered to no input. They wait
 * (`valueReadingsWaiting`), and the page says so.
 */
function stated(project: DdProject, key: string): Stated[] {
  const out: Stated[] = [];
  for (const row of project.evidence ?? []) {
    if (!onFile(row)) continue;
    for (const fact of standingFacts(row)) if (fact.key === key) out.push({ row, fact });
  }
  return out.sort((a, b) => b.row.createdAt.localeCompare(a.row.createdAt));
}

/** The keys an input here is read from, or whether there is a building is told by. */
const VALUE_FACT_KEYS = new Set([
  'extent_title',
  'extent_survey',
  'extent_khata',
  'sanctioned_extent',
  'sanctioned_area',
  'cleared_built_up_area',
  'carpet_area',
  'rera_carpet_area',
  'super_built_up_area',
  'saleable_area',
  'consideration',
  'registration_date',
  'monthly_rent',
  'leased_area',
  'oc_date',
  'oc_issued',
]);

/** The readings an input would have been offered from, that wait on their papers and are offered to nothing. */
export function valueReadingsWaiting(project: DdProject): Array<{ evidence: EvidenceRecord; fact: DocumentFact }> {
  return (project.evidence ?? [])
    .filter(onFile)
    .flatMap((evidence) => waitingReadings(evidence).filter((fact) => VALUE_FACT_KEYS.has(fact.key)).map((fact) => ({ evidence, fact })));
}

function numberOf(fact: DocumentFact): number | null {
  const n = typeof fact.value === 'number' ? fact.value : Number(String(fact.value).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function documentName(row: EvidenceRecord): string {
  return row.documentType ?? row.title;
}

function docSource(row: EvidenceRecord, fact: DocumentFact): ValueSource {
  return {
    kind: 'document',
    label: documentName(row),
    detail: `p. ${fact.page}`,
    evidenceId: row.id,
    page: fact.page,
    quote: fact.quote,
  };
}

/** Square metres per unit a guidance rate is published in. */
const SQM_PER_UNIT: Record<RevenueMapAnchor['unit'], number> = { sqyd: 0.83612736, sqft: 0.09290304 };

/**
 * The guidance rate per square metre, from the rate as carried.
 *
 * Kaveri publishes whole rupees per square metre and the read carries them
 * per square yard, so converting back lands a fraction off the published
 * figure — ₹59,999.997 — which then multiplies into a value twenty-three
 * rupees short of a round one. Rounded to the rupee the state published.
 */
export function guidancePerSqm(anchor: RevenueMapAnchor): number {
  return Math.round(anchor.guidancePerUnit / SQM_PER_UNIT[anchor.unit]);
}

const STANDING_STAGES: ReadonlySet<DdProject['currentStage']> = new Set(['completion', 'handover', 'operations']);

/**
 * Whether there is a building to value, rather than a site.
 *
 * A sanctioned plan is not one: on a site bought to develop, the plan is what
 * may be built, and reading its area as the building turns a land valuation
 * into a valuation of something that does not exist. A building is one
 * somebody recorded, one an occupancy certificate says was finished, or a
 * project past completion.
 */
export function valueHasBuilding(project: DdProject): boolean {
  if ((project.builtUpAreaSqm ?? 0) > 0) return true;
  if (STANDING_STAGES.has(project.currentStage)) return true;
  return stated(project, 'oc_date').length > 0 || stated(project, 'oc_issued').some(({ fact }) => fact.value === true);
}

export interface OwnSale {
  evidenceId: string;
  document: string;
  registeredOn: string;
  price: number;
  areaSqm: number;
  ratePerSqm: number;
  ageYears: number;
  /** Recent enough to stand as a comparable without a time adjustment. */
  recent: boolean;
}

/** What this parcel's own registered sales recite, newest first. */
export function ownSales(project: DdProject, now = new Date()): OwnSale[] {
  const out: OwnSale[] = [];
  for (const row of (project.evidence ?? []).filter(onFile)) {
    const facts = standingFacts(row);
    const consideration = facts.find((f) => f.key === 'consideration');
    const extent = facts.find((f) => f.key === 'extent_title');
    const registered = facts.find((f) => f.key === 'registration_date');
    const price = consideration ? numberOf(consideration) : null;
    const area = extent ? numberOf(extent) : null;
    const age = registered ? yearsSince(String(registered.value), now) : null;
    if (price === null || area === null || age === null) continue;
    out.push({
      evidenceId: row.id,
      document: documentName(row),
      registeredOn: String(registered!.value),
      price,
      areaSqm: area,
      ratePerSqm: price / area,
      ageYears: age,
      recent: age * 12 <= OWN_SALE_RECENT_MONTHS,
    });
  }
  return out.sort((a, b) => b.registeredOn.localeCompare(a.registeredOn));
}

/** Years from an ISO date to now, to one decimal. */
function yearsSince(iso: string, now: Date): number | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const years = (now.getTime() - then.getTime()) / (365.25 * 24 * 3600 * 1000);
  return years >= 0 ? Math.round(years * 10) / 10 : null;
}

/** A registered sale this recent stands as a comparable on its own; older needs a time adjustment first. */
export const OWN_SALE_RECENT_MONTHS = 36;

/** The convention the expected-life field's own hint states, for an RCC frame. */
export const RCC_EXPECTED_LIFE_YEARS = 60;

/* ==================================================================== */
/* Gathering                                                             */
/* ==================================================================== */

/**
 * Every offer the file supports, for every input.
 *
 * Sorted per input by rank; set-aside offers are left out. `now` is only for
 * ages, so a test can pin it.
 */
export function valueOffers(project: DdProject, now = new Date()): ValueOffer[] {
  const out: ValueOffer[] = [];
  const setAside = new Set((project.valueSetAside ?? []).map((s) => s.offerId));
  const add = (
    input: string,
    value: number,
    source: ValueSource,
    basis: string,
    rank: number,
    extra: Partial<Pick<ValueOffer, 'with' | 'facts'>> & { idPart?: string } = {},
  ) => {
    const spec = SPEC_BY_KEY.get(input);
    // An adjustment is signed; everything else on the sheet is a positive quantity.
    if (!spec || spec.options || !Number.isFinite(value) || value === 0 || (value < 0 && !SIGNED.has(input))) return;
    const rounded = spec.unit === 'sqm' || spec.unit.startsWith('INR') ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10;
    // A rate worked out from a price keeps every digit, so the price comes
    // back out of it exactly: ₹5.5 Cr over 1,200 sqm times 1,200 sqm is
    // ₹5.5 Cr, not four rupees short of it. The id rounds, so it is stable.
    const kept = spec.unit.startsWith('INR/') ? value : rounded;
    const { idPart, ...rest } = extra;
    const id = [input, source.kind, idPart ?? source.evidenceId ?? source.detail ?? source.label, rest.facts?.[0]?.key ?? '', rounded].join('|');
    if (setAside.has(id) || out.some((o) => o.id === id)) return;
    out.push({ id, input, value: kept, display: formatValueInput(kept, spec.unit), source, basis, rank, ...rest });
  };

  const addChoice = (
    input: string,
    value: string,
    source: ValueSource,
    basis: string,
    rank: number,
    extra: Partial<Pick<ValueOffer, 'with' | 'facts'>> & { idPart?: string } = {},
  ) => {
    const spec = SPEC_BY_KEY.get(input);
    if (!spec?.options || !spec.options.includes(value)) return;
    const { idPart, ...rest } = extra;
    const id = [input, source.kind, idPart ?? source.evidenceId ?? source.detail ?? source.label, rest.facts?.[0]?.key ?? '', value].join('|');
    if (setAside.has(id) || out.some((o) => o.id === id)) return;
    out.push({ id, input, value, display: formatValueInput(value, spec.unit), source, basis, rank, ...rest });
  };

  /* ---- the plot ------------------------------------------------------- */

  const EXTENTS: Array<{ key: string; rank: number; says: string }> = [
    { key: 'extent_title', rank: 1, says: 'The extent the title conveys' },
    { key: 'extent_survey', rank: 2, says: 'The extent the survey sketch measures' },
    { key: 'extent_khata', rank: 3, says: 'The extent the khata records' },
    { key: 'sanctioned_extent', rank: 4, says: 'The site area on the sanctioned plan' },
  ];
  for (const { key, rank, says } of EXTENTS) {
    for (const { row, fact } of stated(project, key)) {
      const n = numberOf(fact);
      if (n !== null) add('land_area', n, docSource(row, fact), `${says}, read off the ${documentName(row).toLowerCase()}.`, rank, { facts: [{ evidenceId: row.id, key }] });
    }
  }
  const boundary = project.surveyBoundary;
  if (boundary && (boundary.source === 'uploaded_kml' || boundary.source === 'uploaded_geojson') && boundary.computedAreaSqm > 0) {
    add(
      'land_area',
      boundary.computedAreaSqm,
      { kind: 'boundary', label: 'Surveyor’s outline', detail: boundary.suppliedNote },
      'The area inside the outline a person supplied, computed from its corners.',
      2,
    );
  }
  // A site on several survey numbers is all of its parcels: the outlines the
  // state publishes are added up, and the offer names the numbers it adds.
  const kept = revenueReads(project);
  const labels = parcelLabels(kept);
  const reads = kept.filter((r) => r.areaSqm > 0);
  if (reads.length) {
    const village = reads[0].village && reads.every((r) => r.village === reads[0].village) ? `, ${reads[0].village}` : '';
    // What the figure is not: a parcel that is the whole of a number asked for
    // by a part may hold more land than the site, and a number off a reading
    // nobody has accepted is a machine's word that the parcel is the site's.
    const counted = (revenueExtent(project, kept)?.parcels ?? []).filter((p) => p.areaSqm > 0);
    const parcels = counted.flatMap((p) => [
      ...(p.askedAs.length ? [` Sy. ${p.label} is the ${wholeNumberWords(p.askedAs)}: its outline may hold more land than the site.`] : []),
      ...(p.unaccepted ? [` Sy. ${p.label} is ${unacceptedWords(p.unaccepted)}.`] : []),
    ]);
    add(
      'land_area',
      reads.reduce((sum, r) => sum + r.areaSqm, 0),
      { kind: 'revenue_map', label: 'State revenue map', detail: `${surveyNumbersLabel(reads.map((r) => labels.get(r.parcelRef) ?? r.surveyNo), 12)}${village}` },
      `${
        reads.length === 1
          ? 'The parcel outline the state publishes for this survey number.'
          : `The ${reads.length} parcel outlines the state publishes for these survey numbers, added up.`
      } Machine-read, and the register carries its own survey error.${parcels.join('')}`,
      5,
    );
  }

  /* ---- the building --------------------------------------------------- */

  const building = valueHasBuilding(project);
  if (building) {
    for (const { row, fact } of stated(project, 'sanctioned_area')) {
      const n = numberOf(fact);
      if (n !== null) add('built_up_area', n, docSource(row, fact), 'The built-up area the plan sanctions — what may stand, which is not always what does.', 1, { facts: [{ evidenceId: row.id, key: 'sanctioned_area' }] });
    }
    for (const { row, fact } of stated(project, 'cleared_built_up_area')) {
      const n = numberOf(fact);
      if (n !== null) add('built_up_area', n, docSource(row, fact), 'The built-up area the clearance covers.', 2, { facts: [{ evidenceId: row.id, key: 'cleared_built_up_area' }] });
    }
  }

  /* ---- carpet (RERA) and saleable / SBA -------------------------------- */

  const CARPET_KEYS: Array<{ key: string; rank: number; says: string }> = [
    { key: 'rera_carpet_area', rank: 1, says: 'The RERA carpet area' },
    { key: 'carpet_area', rank: 2, says: 'The carpet area' },
  ];
  for (const { key, rank, says } of CARPET_KEYS) {
    for (const { row, fact } of stated(project, key)) {
      const n = numberOf(fact);
      if (n !== null) {
        add('carpet_area', n, docSource(row, fact), `${says} the ${documentName(row).toLowerCase()} states — RERA s.2(k).`, rank, {
          facts: [{ evidenceId: row.id, key }],
          with: { quoted_basis: 'carpet' },
        });
      }
    }
  }

  const SALEABLE_KEYS: Array<{ key: string; rank: number; says: string; basis: string }> = [
    { key: 'saleable_area', rank: 1, says: 'The saleable area', basis: 'super built-up' },
    { key: 'super_built_up_area', rank: 2, says: 'The super built-up area', basis: 'super built-up' },
  ];
  for (const { key, rank, says, basis } of SALEABLE_KEYS) {
    for (const { row, fact } of stated(project, key)) {
      const n = numberOf(fact);
      if (n !== null) {
        add('area_valued', n, docSource(row, fact), `${says} the ${documentName(row).toLowerCase()} states.`, rank, {
          facts: [{ evidenceId: row.id, key }],
          with: { quoted_basis: basis },
        });
        addChoice('quoted_basis', basis, docSource(row, fact), `The ${documentName(row).toLowerCase()} states the area on a ${basis} basis.`, rank, {
          facts: [{ evidenceId: row.id, key }],
        });
      }
    }
  }
  for (const { row, fact } of stated(project, 'carpet_area').concat(stated(project, 'rera_carpet_area'))) {
    addChoice('quoted_basis', 'carpet', docSource(row, fact), `The ${documentName(row).toLowerCase()} states a carpet area.`, 1, {
      facts: [{ evidenceId: row.id, key: fact.key }],
    });
  }
  for (const { row, fact } of stated(project, 'sanctioned_area').concat(stated(project, 'cleared_built_up_area'))) {
    addChoice('quoted_basis', 'built-up', docSource(row, fact), `The ${documentName(row).toLowerCase()} states a built-up area.`, 2, {
      facts: [{ evidenceId: row.id, key: fact.key }],
    });
  }

  /* ---- interest valued ------------------------------------------------ */

  if (project.tenure === 'freehold' || project.tenure === 'leasehold') {
    addChoice('interest', project.tenure, { kind: 'project', label: 'This file', detail: 'Tenure' }, `The tenure recorded on this file is ${project.tenure}.`, 1);
  }

  /* ---- what is valued -------------------------------------------------- */

  const recordedLand = project.landAreaSqm ?? 0;
  const recordedBuilt = project.builtUpAreaSqm ?? 0;
  if (building) {
    if (recordedBuilt > 0) add('area_valued', recordedBuilt, { kind: 'project', label: 'This file', detail: 'Built-up area' }, 'The built-up area recorded on this file. Record a carpet area where the sale is quoted on it.', 3);
    for (const offer of out.filter((o) => o.input === 'built_up_area')) {
      if (typeof offer.value !== 'number') continue;
      add('area_valued', offer.value, offer.source, `Valued on the built-up area. ${offer.basis}`, offer.rank + 3, offer.facts ? { facts: offer.facts } : {});
    }
  } else {
    if (recordedLand > 0) add('area_valued', recordedLand, { kind: 'project', label: 'This file', detail: 'Plot area' }, 'A bare site is valued on its extent — the plot area recorded on this file.', 3);
    for (const offer of out.filter((o) => o.input === 'land_area')) {
      if (typeof offer.value !== 'number') continue;
      add('area_valued', offer.value, offer.source, `A bare site is valued on its extent. ${offer.basis}`, offer.rank + 3, offer.facts ? { facts: offer.facts } : {});
    }
  }

  /* ---- comparables: the parcel's own recent sale ----------------------- */

  // Only for a bare site: a deed's consideration for a building pays for the
  // building too, and divided by the land it is a rate for nothing.
  if (!building) {
    for (const sale of ownSales(project, now).filter((x) => x.recent)) {
      const row = project.evidence.find((e) => e.id === sale.evidenceId)!;
      const consideration = standingFacts(row).find((f) => f.key === 'consideration')!;
      add(
        'rate_per_sqm',
        sale.ratePerSqm,
        docSource(row, consideration),
        `This parcel’s own registered sale on ${displayDate(sale.registeredOn)}: ${formatValueInput(sale.price, 'INR')} for ${formatValueInput(sale.areaSqm, 'sqm')}. The closest comparable there is — adjust it for the time since.`,
        1,
        {
          with: { rate_basis: 'reported transactions', comparable_count: 1 },
          facts: ['consideration', 'extent_title', 'registration_date'].map((key) => ({ evidenceId: row.id, key })),
        },
      );
    }
  }

  /* ---- comparables: the schedule on the register ---------------------- */

  const schedule = comparableSchedule(project);
  if (schedule) {
    const net = Math.round(schedule.netAdjustmentPct * 10) / 10;
    const portals = schedule.sources.filter((src) => src === '99acres' || src === 'magicbricks').map((src) => COMPARABLE_SOURCE_LABEL[src]);
    const counted = `${schedule.count} comparable${schedule.count === 1 ? '' : 's'}${portals.length ? `, ${portals.join(' and ')}` : ''}`;
    const asking = schedule.undiscountedListings
      ? ` ${schedule.undiscountedListings === schedule.count ? 'All are' : `${schedule.undiscountedListings} are`} asking prices with no listing discount set — most property sells below its asking price.`
      : '';
    const thin = schedule.count < MIN_SCHEDULE ? ` ${schedule.count === 1 ? 'One comparable is' : `${schedule.count} comparables are`} a sample, not a market.` : '';
    add(
      'rate_per_sqm',
      schedule.rawRate,
      { kind: 'comparables', label: 'Comparable schedule', detail: counted },
      `The weighted rate of ${schedule.count} comparable${schedule.count === 1 ? '' : 's'} on the register${net ? `, ${net > 0 ? '+' : ''}${net}% once adjusted to the subject` : ''}.${asking}${thin}`,
      schedule.count >= MIN_SCHEDULE ? 0 : 2,
      { idPart: `schedule:${schedule.fingerprint}`, with: { rate_basis: schedule.basis, comparable_count: schedule.count, net_adjustment_pct: net } },
    );
    if (net) {
      add(
        'net_adjustment_pct',
        net,
        { kind: 'comparables', label: 'Comparable schedule', detail: `${schedule.count} adjusted` },
        'The comparables’ own adjustments — time, size, location, condition and listing discount — weighted as the rate is.',
        0,
        { idPart: `schedule:${schedule.fingerprint}` },
      );
    }
  }

  /* ---- cost: the guidance rate, and the building's age ----------------- */

  // One value, from one parcel, and the offer says which. Where the parcels
  // carry different published values the others are named and none is
  // averaged: an average is a rate the state never published.
  const guidance = revenueGuidance(kept);
  if (guidance) {
    const { read, anchor, differing } = guidance;
    const several = kept.length > 1;
    const from = labels.get(read.parcelRef) ?? read.surveyNo;
    const perUnit = (a: RevenueMapAnchor) => `₹${grouped(a.guidancePerUnit)} per ${a.unit === 'sqft' ? 'sq ft' : 'sq yd'}`;
    const others = differing.length
      ? ` ${differing.map((r) => `Sy. ${labels.get(r.parcelRef) ?? r.surveyNo} carries ${r.anchor ? perUnit(r.anchor) : ''}`).join('; ')}: the published values differ by parcel, and this is the one for Sy. ${from}, not an average.`
      : '';
    const none = several && guidance.unpriced.length ? ` The map published no value for ${surveyNumbersLabel(guidance.unpriced.map((r) => labels.get(r.parcelRef) ?? r.surveyNo), 12)}.` : '';
    const guidanceSource: ValueSource = {
      kind: 'revenue_map',
      label: 'State revenue map',
      detail: `Guidance value${anchor.locality ? `, ${anchor.locality}` : ''}${several || !anchor.locality ? `, Sy. ${from}` : ''}`,
    };
    const guidanceBasis = `The guidance value the state publishes here: ${perUnit(anchor)}.${several ? ` Read for Sy. ${from}.` : ''}${others}${none} The statutory floor, not a market rate — most sites transact above it, so replace it with land comparables where you hold them.`;
    const guidanceRate = guidancePerSqm(anchor);
    add('guideline_rate', guidanceRate, guidanceSource, guidanceBasis, 1);
    add('land_rate_per_sqm', guidanceRate, guidanceSource, guidanceBasis, 1);
  }

  for (const { row, fact } of stated(project, 'oc_date')) {
    const years = yearsSince(String(fact.value), now);
    if (years === null) continue;
    add(
      'effective_age_years',
      Math.max(years, 0.1),
      docSource(row, fact),
      `Years since the occupancy certificate on ${displayDate(String(fact.value))} — the building’s age by the calendar. A condition survey can make it younger or older.`,
      1,
    );
  }
  if (building) {
    add(
      'expected_life_years',
      RCC_EXPECTED_LIFE_YEARS,
      { kind: 'convention', label: 'Convention', detail: 'RCC frame' },
      'RCC framed buildings are conventionally taken at 60 years, as this field’s own guidance says. A condition survey overrides it.',
      5,
    );
  }

  /* ---- income: the lease on file --------------------------------------- */

  for (const row of (project.evidence ?? []).filter(onFile)) {
    const facts = standingFacts(row);
    const rent = facts.find((f) => f.key === 'monthly_rent');
    const let_ = facts.find((f) => f.key === 'leased_area');
    const area = let_ ? numberOf(let_) : null;
    if (let_ && area !== null) add('let_area', area, docSource(row, let_), 'The area the lease lets.', 1, { facts: [{ evidenceId: row.id, key: 'leased_area' }] });
    const amount = rent ? numberOf(rent) : null;
    if (rent && amount !== null && area !== null) {
      add(
        'achievable_rent',
        amount / area,
        docSource(row, rent),
        `The rent the lease reserves: ${formatValueInput(amount, 'INR')} a month for ${formatValueInput(area, 'sqm')}. Passing rent — what this tenant pays, not necessarily what the market would today.`,
        1,
        { facts: [{ evidenceId: row.id, key: 'monthly_rent' }, { evidenceId: row.id, key: 'leased_area' }] },
      );
    }
  }
  if (building && recordedBuilt > 0) {
    add('let_area', recordedBuilt, { kind: 'project', label: 'This file', detail: 'Built-up area' }, 'The built-up area recorded on this file.', 3);
  }

  /* ---- residual: acquisition costs from the pack ------------------------ */

  // Only where a residual is in play. Offered on every file it would fill one
  // cell of nine on a finished building and read as a residual half-begun.
  const residualRecorded = ['gdv', 'construction_cost'].some((key) => recordedOf(project, SPEC_BY_KEY.get(key)!.target) !== null);
  const pack = residualRecorded ? resolveStatePack({ country: 'IN', state: project.jurisdiction || 'Karnataka' }, REFERENCE_DATA.statePacks) : undefined;
  if (pack) {
    const slabs = pack.stampDutySlabs.value;
    const top = slabs.find((s) => s.upTo === null)?.pct ?? slabs[slabs.length - 1]?.pct;
    if (top !== undefined) {
      const cess = pack.stampDutyCessPct.value;
      const surcharge = pack.stampDutySurchargePct.value;
      const registration = pack.registrationFeePct.value;
      add(
        'land_acquisition_pct',
        top * (1 + cess / 100 + surcharge / 100) + registration,
        { kind: 'state_pack', label: `${pack.state} pack`, detail: `as of ${pack.stampDutySlabs.asOf}` },
        `${top}% duty plus ${cess}% cess and ${surcharge}% surcharge on the duty, plus ${registration}% registration.`,
        1,
      );
    }
  }

  return out.sort((a, b) => a.rank - b.rank);
}

/* ==================================================================== */
/* Where each input stands                                               */
/* ==================================================================== */

/** The check the valuation reads for a definition: the most recently updated, as the engine picks. */
function currentCheck(project: DdProject, definitionId: string): CheckInstance | undefined {
  let held: CheckInstance | undefined;
  for (const a of project.assessments ?? []) {
    for (const s of a.scopes ?? []) {
      for (const c of s.checks ?? []) {
        if (c.definitionId === definitionId && (!held || c.updatedAt > held.updatedAt)) held = c;
      }
    }
  }
  return held;
}

export interface RecordedValue {
  value: number | string;
  /** Where it was recorded from, when it cites something. */
  source?: string;
  evidenceId?: string;
  /** Page on that paper, when known. */
  page?: number;
  /** Document fact key on that paper, when known — so the desk opens on this figure alone. */
  factKey?: string;
}

function recordedOf(project: DdProject, target: ValueTarget): RecordedValue | null {
  if (target.kind === 'project') {
    const n = project[target.field];
    if (typeof n !== 'number' || n <= 0) return null;
    // The document it was accepted from, while the value is still the one accepted.
    const from = project.valueSources?.[target.field];
    if (!from || from.value !== n) return { value: n, source: 'This file' };
    const paper = from.evidenceId ? project.evidence.find((e) => e.id === from.evidenceId) : undefined;
    const hit = paper
      ? (from.factKey ? standingFacts(paper).find((f) => f.key === from.factKey) : undefined) ??
        standingFacts(paper).find((f) => typeof f.value === 'number' && !apart(f.value, n)) ??
        standingFacts(paper).find((f) => {
          const parsed = Number(String(f.value).replace(/[,\s]/g, ''));
          return Number.isFinite(parsed) && !apart(parsed, n);
        })
      : undefined;
    return {
      value: n,
      source: `${from.label}${from.page ? ` p. ${from.page}` : ''}`,
      ...(from.evidenceId ? { evidenceId: from.evidenceId } : {}),
      ...(hit ? { factKey: hit.key, page: hit.page } : from.page !== undefined ? { page: from.page } : {}),
      ...(from.factKey && !hit ? { factKey: from.factKey } : {}),
    };
  }
  const held = currentCheck(project, target.definitionId)?.fields?.[target.key];
  if (!held || isBlank(held)) return null;
  if (typeof held.value === 'string' && held.value.trim()) {
    const text = held.value.trim();
    const row = held.sourceEvidenceId ? project.evidence.find((e) => e.id === held.sourceEvidenceId) : undefined;
    return {
      value: text,
      ...(row ? { source: documentName(row), evidenceId: row.id } : {}),
      ...(held.page !== undefined ? { page: held.page } : {}),
    };
  }
  if (typeof held.value !== 'number') return null;
  const n = held.value;
  const row = held.sourceEvidenceId ? project.evidence.find((e) => e.id === held.sourceEvidenceId) : undefined;
  if (!row) return { value: n };
  // Prefer the document fact whose number is this figure; else the page the check cited.
  const facts = standingFacts(row);
  const hit =
    facts.find((f) => typeof f.value === 'number' && !apart(f.value, n)) ??
    facts.find((f) => {
      const parsed = Number(String(f.value).replace(/[,\s]/g, ''));
      return Number.isFinite(parsed) && !apart(parsed, n);
    });
  return {
    value: n,
    source: documentName(row),
    evidenceId: row.id,
    ...(hit ? { factKey: hit.key, page: hit.page } : held.page !== undefined ? { page: held.page } : {}),
  };
}

export interface ValueInputRow {
  key: string;
  approach: ValueApproachKey;
  label: string;
  unit: string;
  target: ValueTarget;
  /** Has to cite a document when recorded. */
  proof: boolean;
  /** The approach does not run without it. */
  required: boolean;
  /** Choice options when the input is an enum, not a quantity. */
  options?: readonly string[];
  recorded: (RecordedValue & { display: string }) | null;
  /** Everything the file offers for it, best first. */
  offers: ValueOffer[];
  /** What would fill it now: the best offer, when nothing is recorded. */
  waiting: ValueOffer | null;
  /** The file says different things about it — offers apart from one another, or from what is recorded. */
  disagree: boolean;
}

/** Two figures this far apart are two different statements, not one rounded twice. */
const AGREE_WITHIN = 0.02;

function apart(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9) > AGREE_WITHIN;
}

function valuesDisagree(values: Array<number | string>): boolean {
  if (values.length < 2) return false;
  const first = values[0]!;
  if (typeof first === 'string') return values.some((v) => String(v) !== first);
  return values.some((v) => typeof v !== 'number' || apart(v, first));
}

/** Each input, what is recorded for it, and what the file offers. */
export function valueInputRows(project: DdProject, offers = valueOffers(project)): ValueInputRow[] {
  return VALUE_INPUTS.map((spec) => {
    const def = fieldDef(spec.target);
    const recorded = recordedOf(project, spec.target);
    const mine = offers.filter((o) => o.input === spec.key);
    const values = [...(recorded ? [recorded.value] : []), ...mine.map((o) => o.value)];
    // Choices on the subject are settled when known; they do not block a figure.
    const choice = Boolean(spec.options);
    return {
      key: spec.key,
      approach: spec.approach,
      label: spec.label,
      unit: spec.unit,
      target: spec.target,
      proof: def?.proof === 'required',
      required: choice ? false : spec.target.kind === 'project' ? false : def?.required !== false,
      ...(spec.options ? { options: spec.options } : {}),
      recorded: recorded ? { ...recorded, display: formatValueInput(recorded.value, spec.unit) } : null,
      offers: mine,
      waiting: recorded ? null : (mine[0] ?? null),
      disagree: valuesDisagree(values),
    };
  });
}

/** Survey numbers the property papers name — identity for The property card. */
export function propertySurveyLine(project: DdProject): {
  display: string;
  evidenceId: string;
  key: string;
  page?: number;
} | null {
  for (const row of project.evidence) {
    const fact = standingFacts(row).find((f) => f.key === 'survey_numbers' || f.key === 'covered_survey_numbers');
    if (!fact) continue;
    const display = fact.display || String(fact.value);
    if (!display.trim()) continue;
    return {
      display,
      evidenceId: row.id,
      key: fact.key,
      ...(fact.page !== undefined ? { page: fact.page } : {}),
    };
  }
  return null;
}

/* ==================================================================== */
/* The file as it would be                                               */
/* ==================================================================== */

const OFFER_ACTOR = 'offered';

/**
 * A copy of the project with these offers recorded, for the figure they would
 * give. Never saved: this is how the page shows the value moving while the
 * offers are still offers.
 */
export function withValueOffers(project: DdProject, offers: readonly ValueOffer[]): DdProject {
  if (!offers.length) return project;
  // The project is plain data: it is stored as JSON, so it copies as JSON.
  const copy = JSON.parse(JSON.stringify(project)) as DdProject;
  const at = new Date().toISOString();
  let virtual: DdAssessment | undefined;
  for (const offer of offers) {
    const spec = SPEC_BY_KEY.get(offer.input);
    if (!spec) continue;
    if (spec.target.kind === 'project') {
      if (typeof offer.value === 'number') copy[spec.target.field] = offer.value;
      continue;
    }
    let held = currentCheck(copy, spec.target.definitionId);
    if (!held) {
      if (!virtual) {
        virtual = {
          id: 'dd_offered',
          name: 'Indicative valuation',
          ddType: 'indicative_valuation',
          scopes: [{ id: 'scope_offered', scopeKey: 'indicative_valuation', checks: [] }],
        } as unknown as DdAssessment;
        copy.assessments = [...(copy.assessments ?? []), virtual];
      }
      held = { id: `chk_offered_${spec.target.definitionId}`, definitionId: spec.target.definitionId, title: spec.target.definitionId, fields: {}, updatedAt: at } as unknown as CheckInstance;
      virtual.scopes[0]!.checks.push(held);
    }
    held.fields = {
      ...(held.fields ?? {}),
      [spec.target.key]: { value: offer.value, at, by: OFFER_ACTOR, ...(offer.source.evidenceId ? { sourceEvidenceId: offer.source.evidenceId } : {}) },
      ...Object.fromEntries(Object.entries(offer.with ?? {}).map(([k, v]) => [k, { value: v, at, by: OFFER_ACTOR }])),
    };
    held.updatedAt = at;
  }
  return copy;
}

/* ==================================================================== */
/* Recording                                                             */
/* ==================================================================== */

/** Whether the file has the checks a valuation records into. */
export function hasValueChecks(project: DdProject): boolean {
  return (project.assessments ?? []).some((a) => a.scopes.some((s) => s.checks.some((c) => c.definitionId.startsWith('indicative_valuation.'))));
}

/**
 * Start the valuation's own DD when the file has nowhere to record its inputs.
 *
 * Only the valuation scope: the legal and regulatory scopes the full template
 * carries are diligence somebody chooses to start, not a side effect of asking
 * what a site is worth.
 */
export function ensureValueChecks(project: DdProject, actor: string): DdAssessment | undefined {
  if (hasValueChecks(project)) return undefined;
  return createAssessment(
    project,
    {
      ddType: 'indicative_valuation',
      name: 'Indicative valuation',
      owner: actor,
      targetType: 'project',
      excludeScopes: ['commercial_market', 'cost_quantity', 'legal', 'regulatory'],
    },
    actor,
  );
}

export interface AcceptedOffers {
  applied: ValueOffer[];
  refused: Array<{ id: string; error: string }>;
  started?: DdAssessment;
}

/**
 * The valuation's inputs are Finance's. With `mayDecide`, a lead, signer or
 * contributor there may accept what the file offers or set it aside — the
 * figure on the desk, not a paper's own reading. Anybody else is refused
 * before anything changes. With nobody asking, nothing is refused.
 */
function assertMayDecideValue(mayDecide: MayDecide | undefined): void {
  if (!mayDecide) return;
  if (mayDecide('finance')) return;
  if (mayDecide.roleIn?.('finance') === 'contributor') return;
  throw decisionRefused('Deciding a value for the valuation', 'finance', mayDecide);
}

/**
 * Record the offers a person accepted, by id.
 *
 * Each is looked up afresh on the file as it is now, so an id the page held
 * from before a document was set aside records nothing. A value read off a
 * document cites it, with its page and words; the guidance rate cites the
 * revenue-map read, filed on the register for the purpose; and a document's
 * own value still waiting on its row is accepted there too, so it is not asked
 * about twice.
 *
 * That last step is a decision on the document, so with `mayDecide` it is
 * taken only where the person may decide that paper as well. A Finance lead
 * who does not lead the deed's department records the extent for the
 * valuation, and the deed's own value waits for whoever decides it.
 */
export function acceptValueOffers(project: DdProject, ids: readonly string[], actor: string, options: { mayDecide?: MayDecide } = {}): AcceptedOffers {
  assertMayDecideValue(options.mayDecide);
  const offers = new Map(valueOffers(project).map((o) => [o.id, o]));
  const wanted = ids.map((id) => ({ id, offer: offers.get(id) }));
  const started = wanted.some((w) => w.offer && SPEC_BY_KEY.get(w.offer.input)?.target.kind === 'check') ? ensureValueChecks(project, actor) : undefined;
  const applied: ValueOffer[] = [];
  const refused: AcceptedOffers['refused'] = [];
  const seen = new Set<string>();

  for (const { id, offer } of wanted) {
    if (!offer) {
      refused.push({ id, error: 'That value is no longer what the file says. Reload to see what it says now.' });
      continue;
    }
    // One value per input: two offers for the same cell are a choice, not a pair.
    if (seen.has(offer.input)) {
      refused.push({ id, error: `Another value for ${SPEC_BY_KEY.get(offer.input)!.label.toLowerCase()} was accepted in the same step.` });
      continue;
    }
    const spec = SPEC_BY_KEY.get(offer.input)!;
    try {
      if (spec.target.kind === 'project') {
        if (typeof offer.value !== 'number') throw new Error('That project field only takes a number.');
        patchProject(project, { [spec.target.field]: offer.value }, actor);
        project.valueSources = {
          ...(project.valueSources ?? {}),
          [spec.target.field]: {
            value: offer.value,
            label: offer.source.label,
            ...(offer.source.evidenceId ? { evidenceId: offer.source.evidenceId } : {}),
            ...(offer.source.page ? { page: offer.source.page } : {}),
            ...(offer.facts?.[0]?.key ? { factKey: offer.facts[0].key } : {}),
            at: new Date().toISOString(),
            by: actor,
          },
        };
      } else {
        const held = currentCheck(project, spec.target.definitionId);
        if (!held) throw new Error('There is no valuation check to record it on.');
        const evidenceId =
          offer.source.kind === 'document'
            ? offer.source.evidenceId
            : offer.source.kind === 'revenue_map'
              ? // The one rate the map offers is the guidance value, cited to the read of the parcel it came from.
                fileRevenueMapAsEvidence(project, actor, revenueGuidance(revenueReads(project))?.read).id
              : offer.source.kind === 'comparables'
                ? fileComparableSchedule(project, actor).id
                : undefined;
        const citations = offer.source.page || offer.source.quote ? { [spec.target.key]: { page: offer.source.page, quote: offer.source.quote } } : undefined;
        // A rate from the schedule cites the schedule in its own field too.
        const schedule = offer.source.kind === 'comparables' && spec.target.key === 'rate_per_sqm' && evidenceId ? { comparable_schedule: [evidenceId] } : {};
        const outcome = recordCheckFields(project, held.id, { [spec.target.key]: offer.value, ...(offer.with ?? {}), ...schedule }, actor, evidenceId, citations);
        if (outcome.rejected.length) throw new Error(outcome.rejected.map((r) => r.error).join(' '));
      }
      // The document is accepted as stating what was just recorded from it.
      for (const read of offer.facts ?? []) {
        const row = project.evidence.find((e) => e.id === read.evidenceId);
        // The value the offer was read from: one that stands, since no other is offered.
        const fact = row ? standingFacts(row).find((f) => f.key === read.key) : undefined;
        if (row && fact && factReview(fact) === 'proposed' && (!options.mayDecide || mayDecidePaper(project, row, options.mayDecide))) {
          reviewFacts(project, row.id, [fact.key], 'accept', actor, undefined, { mayDecide: options.mayDecide });
        }
      }
      seen.add(offer.input);
      applied.push(offer);
    } catch (e) {
      refused.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (applied.length) {
    recordAuditEvent(project, { actor, action: 'accept_value_inputs', entityType: 'valuation', entityId: project.id, newValue: applied.map((o) => `${o.input}: ${o.display} (${o.source.label})`).join('; ') });
  }
  return { applied, refused, ...(started ? { started } : {}) };
}

/**
 * Set offers aside. They stay out of the page until the file says something
 * different — a new document, a corrected value — which is a new offer.
 */
export function setAsideValueOffers(project: DdProject, ids: readonly string[], actor: string, options: { mayDecide?: MayDecide } = {}): number {
  assertMayDecideValue(options.mayDecide);
  const offers = new Map(valueOffers(project).map((o) => [o.id, o]));
  const at = new Date().toISOString();
  const list = project.valueSetAside ?? [];
  let n = 0;
  for (const id of ids) {
    const offer = offers.get(id);
    if (!offer || list.some((s) => s.offerId === id)) continue;
    list.push({ offerId: id, input: offer.input, at, by: actor });
    n += 1;
  }
  project.valueSetAside = list;
  if (n) recordAuditEvent(project, { actor, action: 'set_aside_value_inputs', entityType: 'valuation', entityId: project.id, oldValue: ids.join('; ') });
  return n;
}

/** The check a value input records on, for a link to it. */
export function valueInputCheckId(project: DdProject, target: ValueTarget): string | undefined {
  return target.kind === 'check' ? currentCheck(project, target.definitionId)?.id : undefined;
}
