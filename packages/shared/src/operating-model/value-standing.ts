/**
 * What a valuation stands on: the summary of values a bank panel reads first,
 * the checks a lender runs before it will lend against the figure, and what
 * moves the value up or down.
 *
 * ## The summary of values
 *
 * Fair market value, then what it realises and what it fetches in distress,
 * then the guideline value beside it — the four lines every panel valuation in
 * India opens with, in that order. Realisable and distress are stated shares
 * of the fair market value (90% and 75%), the convention panel valuers work
 * to; they are conventions with their names on them, not observations.
 *
 * ## The checks
 *
 * The state's own title checks come from the property screen. These are the
 * ones a lender adds on top, read off the file: do the documents agree on the
 * extent, does what stands match what was sanctioned, is a charge registered,
 * is the parcel on the prohibited register, does the figure sit below the
 * guideline value the duty is charged on, and do the approaches agree. Each
 * says what it read and what it could not.
 *
 * ## The drivers
 *
 * What pushes the value up or down, each with where the number came from and
 * whether the figure on the page already carries it. Only what the file
 * records: an externality nobody recorded does not move anything, and a
 * driver nobody has put a number on is shown without one rather than with an
 * invented one.
 */

import type { ComplianceVerdict, ScreenResult } from '../types';
import type { DdProject, EvidenceRecord } from './types';
import type { DocumentFact } from './document-parse';
import type { ValuationWorking } from './valuation-run';
import { approachIsUsable, VALUATION_METHOD_LABEL, type ValuationMethodKey, type ValuationOutcome } from './valuation-model';
import { formatValueInput, guidancePerSqm, valueHasBuilding } from './value-inputs';
import { standingFacts, waitingReadingSaid, waitingReadings } from './fact-review';
import {
  extentAgainstDocuments,
  extentsApart,
  landReadingsWaiting,
  landReadingsWaitingSaid,
  offeredSurveyNumbers,
  parcelLabels,
  revenueExtent,
  revenueGuidance,
  revenueReadFor,
  revenueReads,
  revenueSiteBrief,
  statedLand,
  surveyNumbersLabel,
  type RevenueMapFactor,
  type StatedExtent,
} from './revenue-map';
import { MIN_SCHEDULE, comparableSchedule } from './comparables';
import {
  FACING_ADJUSTMENT_PCT,
  LAYOUT_APPROVAL_ADJUSTMENT_PCT,
  cornerSiteAdjustmentPct,
  dimensionStandardnessAdjustmentPct,
  roadWidthAdjustmentPct,
} from '../engine';
import { amenityDistance, nearestTransit } from '../site';

/* ==================================================================== */
/* The summary of values                                                 */
/* ==================================================================== */

/** What a sale in the ordinary course realises, as a share of fair market value. */
export const REALISABLE_SHARE = 0.9;
/** What a forced sale fetches, as a share of fair market value. */
export const DISTRESS_SHARE = 0.75;
/** Approaches further apart than this need a reconciliation note in the report. */
export const DIVERGENCE_NEEDS_NOTE = 0.15;

export interface ValueSummaryApproach {
  method: ValuationMethodKey;
  label: string;
  amount: number | null;
  /** Its share of the blend, 0..1, among the approaches that ran. */
  share: number;
  missing: string[];
}

export interface ValueGuideline {
  perSqm: number;
  areaSqm: number;
  value: number;
  /** "₹42,000 per sq yd, White Field" */
  published: string;
}

export interface ValueSummary {
  outcome: ValuationOutcome;
  fairMarket: number | null;
  low: number | null;
  high: number | null;
  /** Half the band, as a share of the figure. */
  spread: number | null;
  realisable: number | null;
  distress: number | null;
  area: { sqm: number; label: string } | null;
  ratePerSqm: number | null;
  /** The guidance rate on the plot, where the revenue map publishes one. */
  guideline: ValueGuideline | null;
  /** Why there is no guideline value although the map publishes rates: said on the check, never left as silence. */
  guidelineNote?: string;
  /** Fair market value against the guideline value: +0.45 is 45% above it. */
  vsGuideline: number | null;
  /**
   * The figure is the guideline value itself: the only approach that ran is
   * land at the guidance rate. That is the statutory floor, not a market
   * value, and the page says so rather than letting it pass as one.
   */
  restsOnGuidance: boolean;
  approaches: ValueSummaryApproach[];
}

/** The plot area the valuation used, else the one on the file. */
function plotArea(project: DdProject, working: ValuationWorking): number | null {
  const cost = working.runs.find((r) => r.method === 'depreciated_replacement_cost');
  const fromRun = cost?.inputs.find((i) => i.key === 'land_area')?.value;
  const n = fromRun ?? project.landAreaSqm ?? null;
  return n && n > 0 ? n : null;
}

/**
 * The guideline value of the plot: what the state's published rate makes it.
 *
 * One parcel, or several that carry the same rate, is that rate on the plot.
 * Where the parcels carry different rates, one of them on the whole plot is
 * a figure no register holds — a thousand square metres at ₹10,000 beside
 * nine thousand at ₹30,000 is not ten thousand at ₹10,000. Each parcel then
 * counts at its own rate, in the share of the land its outline is, on the
 * plot the valuation uses.
 *
 * And where one parcel of several carries no published rate at all, no
 * guideline value is given for the site, whether the others agree or not:
 * lending it a neighbour's rate is a figure the state did not publish for
 * that land. Which parcel it is, is said.
 */
function guidelineOn(project: DdProject, plot: number | null): { guideline: ValueGuideline | null; guidelineNote?: string } {
  const reads = revenueReads(project);
  const guidance = revenueGuidance(reads);
  if (!guidance || !plot) return { guideline: null };
  const published = (a: NonNullable<typeof guidance>['anchor']) => `₹${Math.round(a.guidancePerUnit).toLocaleString('en-IN')} per ${a.unit === 'sqft' ? 'sq ft' : 'sq yd'}`;
  const labels = parcelLabels(reads);
  const label = (parcelRef: string, surveyNo: string) => labels.get(parcelRef) ?? surveyNo;
  const measured = reads.filter((r) => r.areaSqm > 0);
  if (reads.length > 1 && guidance.unpriced.length) {
    const numbers = surveyNumbersLabel(guidance.unpriced.map((r) => label(r.parcelRef, r.surveyNo)));
    return {
      guideline: null,
      guidelineNote: `The map published no guidance value for ${numbers}, so the guideline value of the whole site cannot be worked out from the map. The value it published for Sy. ${label(guidance.read.parcelRef, guidance.read.surveyNo)} is offered as a land rate, and is that parcel's alone.`,
    };
  }
  if (!guidance.differing.length) {
    const { anchor } = guidance;
    return { guideline: { perSqm: guidancePerSqm(anchor), areaSqm: plot, value: guidancePerSqm(anchor) * plot, published: `${published(anchor)}${anchor.locality ? `, ${anchor.locality}` : ''}` } };
  }
  const land = measured.reduce((sum, r) => sum + r.areaSqm, 0);
  const perSqm = measured.reduce((sum, r) => sum + r.areaSqm * (r.anchor ? guidancePerSqm(r.anchor) : 0), 0) / land;
  return {
    guideline: {
      perSqm,
      areaSqm: plot,
      value: perSqm * plot,
      published: `each parcel at its own rate (${measured.map((r) => `Sy. ${label(r.parcelRef, r.surveyNo)} ${r.anchor ? published(r.anchor) : ''}`).join(', ')})`,
    },
  };
}

export function valueSummary(project: DdProject, working: ValuationWorking): ValueSummary {
  const r = working.reconciliation;
  const fair = r.outcome === 'indicated' && r.indicated !== null && r.indicated > 0 ? r.indicated : null;
  const area = working.area.value && working.area.value > 0 ? { sqm: working.area.value, label: working.area.label } : null;
  const plot = plotArea(project, working);
  const { guideline, guidelineNote } = guidelineOn(project, plot);
  const usable = working.runs.filter(approachIsUsable);
  const weights = usable.reduce((n, run) => n + run.weight, 0) || 1;
  const landRate = usable.length === 1 && usable[0]!.method === 'depreciated_replacement_cost' ? usable[0]!.inputs.find((i) => i.key === 'land_rate')?.value : undefined;
  const built = usable[0]?.inputs.some((i) => i.key === 'replacement_rate' && i.value !== null);
  const restsOnGuidance = fair !== null && !!guideline && !built && typeof landRate === 'number' && Math.abs(landRate / guideline.perSqm - 1) < 0.01;
  return {
    outcome: r.outcome,
    fairMarket: fair,
    low: fair !== null ? r.low : null,
    high: fair !== null ? r.high : null,
    spread: fair !== null && r.low !== null && r.high !== null ? (r.high - r.low) / 2 / fair : null,
    realisable: fair !== null ? fair * REALISABLE_SHARE : null,
    distress: fair !== null ? fair * DISTRESS_SHARE : null,
    area,
    ratePerSqm: fair !== null && area ? fair / area.sqm : null,
    guideline,
    ...(guidelineNote ? { guidelineNote } : {}),
    vsGuideline: fair !== null && guideline && guideline.value > 0 ? fair / guideline.value - 1 : null,
    restsOnGuidance,
    approaches: working.runs.map((run) => ({
      method: run.method,
      label: VALUATION_METHOD_LABEL[run.method],
      amount: run.amount,
      share: approachIsUsable(run) ? run.weight / weights : 0,
      missing: run.missing,
    })),
  };
}

/* ==================================================================== */
/* What a lender checks                                                  */
/* ==================================================================== */

export interface ValueCheck {
  key: string;
  label: string;
  verdict: ComplianceVerdict;
  /** The answer, in a few words. */
  headline: string;
  /** What was read, what it means, what to do. */
  detail: string;
  /** Where the answer came from. */
  source: string;
  /** The state's title checks, or the ones a lender adds. */
  group: 'state' | 'lender';
}

function onFile(row: EvidenceRecord): boolean {
  if (row.status === 'superseded' || row.status === 'rejected' || row.status === 'missing') return false;
  return row.attachments.length > 0 || row.status === 'received' || row.status === 'validated' || row.status === 'used';
}

interface Said {
  row: EvidenceRecord;
  fact: DocumentFact;
}

/**
 * What the papers on file state under a key, for a lender's check to rest on:
 * what a person accepted, and what the rules read off the page. Not a model's
 * reading that nobody has accepted. That one waits, and the check it would
 * have answered says so (`readingWaits`): "nil encumbrance" is never a
 * model's word for a paper nobody looked at.
 */
function said(project: DdProject, key: string): Said[] {
  const out: Said[] = [];
  for (const row of (project.evidence ?? []).filter(onFile)) {
    for (const fact of standingFacts(row)) if (fact.key === key) out.push({ row, fact });
  }
  return out;
}

function num(fact: DocumentFact): number | null {
  const n = typeof fact.value === 'number' ? fact.value : Number(String(fact.value).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function docName(row: EvidenceRecord): string {
  return row.documentType ?? row.title;
}

const pctText = (share: number): string => `${Math.round(Math.abs(share) * 100)}%`;

/**
 * Do the papers agree on how much land there is?
 *
 * A statement is set against another only where both are of the same land.
 * Deeds for different survey numbers state different land, and are added up,
 * not compared: three deeds for three parcels do not disagree by being three
 * sizes. What they add up to is then set against whatever else states all of
 * that land — a khata for the same numbers, the state's map once every one
 * of them is read — and each deed against any other paper for its own
 * numbers. The land each document states is `statedLand`'s to say, so this
 * check and the map's own comparison cannot give two answers on one screen.
 */
function extentsAgree(project: DdProject): ValueCheck {
  type Statement = { value: number; from: string };
  const of = (s: StatedExtent): Statement => ({ value: s.sqm, from: `${s.document} p. ${s.page}` });
  const one = (n: string) => n.replace(/\s+/g, '').toUpperCase();
  const sameNumbers = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((n) => b.some((m) => one(m) === one(n)));
  const mapFrom = (parcels: number) => (parcels === 1 ? 'the state revenue map' : `the state revenue map, ${parcels} parcels added up`);

  const land = statedLand(project, 'standing');
  const onMap = revenueExtent(project, revenueReads(project), 'standing');
  const mapRead = Boolean(onMap && onMap.totalSqm > 0);
  /** Each group is the statements of one piece of land. */
  const groups: Statement[][] = [];
  /** Documents that state an extent for land overlapping this without being the same. */
  let otherLand = 0;
  /** Why the map, though read, is not one of the statements. */
  let mapLeftOut: string | null = null;

  if (land && land.sqm === null) {
    // Several documents that name no survey number and do not agree. Nothing says they are different land, so they are set
    // against each other as papers always were; nothing says they are the site either, so the map is not set beside them.
    groups.push(land.sources.map(of));
    if (mapRead) mapLeftOut = land.unset ?? null;
  } else if (land) {
    const all: Statement[] = [
      land.sources.length === 1 ? of(land.sources[0]!) : { value: land.sqm ?? 0, from: `${land.sources.length} documents for different survey numbers, added up` },
    ];
    const each: Statement[][] = land.sources.length > 1 ? land.sources.map((s) => [of(s)]) : [];
    for (const other of land.others) {
      const at = land.sources.findIndex((s) => sameNumbers(s.numbers, other.numbers));
      // Its land is named only in a reading that waits: it is compared with nothing, and the line below says a reading waits.
      if (other.numbersWaiting) continue;
      if (other.unreadable.length) otherLand += 1;
      // A paper that names no number is taken, as it always was, to state the land the others do: all of it.
      else if (!other.numbers.length || sameNumbers(other.numbers, land.numbers)) all.push(of(other));
      else if (each.length && at >= 0) each[at]!.push(of(other));
      else otherLand += 1;
    }
    const stated = onMap?.documents;
    if (stated?.compared && !stated.compared.wholeNumbers.length) all.push({ value: stated.compared.mapSqm, from: mapFrom(stated.compared.parcels.length) });
    else if (onMap && stated?.compared) mapLeftOut = `the map holds the whole of ${surveyNumbersLabel(stated.compared.wholeNumbers)}, where a part of it is named`;
    else if (onMap && mapRead) mapLeftOut = extentAgainstDocuments(onMap)?.verdict ?? null;
    groups.push(all, ...each);
  } else if (onMap && mapRead) {
    groups.push([{ value: onMap.totalSqm, from: mapFrom(onMap.parcels.filter((p) => p.areaSqm > 0).length) }]);
  }

  const statements = groups.flat();
  const base = { key: 'extents_agree', label: 'Extent across the documents', group: 'lender' as const, source: statements.map((s) => s.from).join(', ') || 'No extent on file' };
  // A model's reading nobody has accepted, and one two readers differ on, are counted for nothing above. They are said.
  const waiting = landReadingsWaiting(project);
  const waits = landReadingsWaitingSaid(waiting);
  const aside = [
    ...(waits ? [`${waits.charAt(0).toUpperCase()}${waits.slice(1)}.`] : []),
    ...(mapLeftOut ? [`The map is read and is not set beside ${statements.length === 1 ? 'it' : 'them'}: ${mapLeftOut}.`] : []),
    ...(otherLand ? [`${otherLand === 1 ? 'One other document states' : `${otherLand} other documents state`} an extent for land that is not the same, and ${otherLand === 1 ? 'is' : 'are'} not compared.`] : []),
  ];
  const compared = groups
    .filter((g) => g.length >= 2)
    .map((g) => {
      const lo = Math.min(...g.map((s) => s.value));
      const hi = Math.max(...g.map((s) => s.value));
      return { lo, hi, gap: (hi - lo) / hi, count: g.length, list: g.map((s) => `${formatValueInput(s.value, 'sqm')} (${s.from})`).join('; ') };
    });
  if (!compared.length) {
    const once = !statements.length
      ? 'None of them is on file.'
      : land && land.sqm !== null && land.sources.length > 1
        ? `The ${land.sources.length} documents on file state the extents of different survey numbers, ${formatValueInput(land.sqm, 'sqm')} in all, and nothing else states the same land, so there is nothing to compare them with.`
        : aside.length > (waits ? 1 : 0)
          ? 'Only one of them states this land, so there is nothing to compare it with.'
          : 'Only one of them is on file, so there is nothing to compare it with.';
    return {
      ...base,
      verdict: 'unknown',
      headline: statements.length ? 'Stated once' : waits ? 'A reading is waiting' : 'No extent on file',
      detail: ['A lender compares the extent on the title, the khata, the survey sketch and the map.', once, ...aside].join(' '),
    };
  }
  const worst = compared.reduce((a, b) => (b.gap > a.gap ? b : a));
  if (!extentsApart(worst.lo, worst.hi)) {
    const agree = compared.length === 1 ? `${worst.count} statements of the extent agree: ${worst.list}.` : `The statements of each piece of land agree: ${compared.map((c) => c.list).join('. ')}.`;
    return { ...base, verdict: 'clear', headline: `Agree within ${pctText(worst.gap)}`, detail: [agree, ...aside].join(' ') };
  }
  return {
    ...base,
    verdict: worst.gap > 0.15 ? 'blocker' : 'attention',
    headline: `${pctText(worst.gap)} apart`,
    detail: [
      `The papers disagree on the extent: ${worst.list}. A lender values the smaller figure until a survey settles it; the valuation uses whichever is recorded as the plot area.`,
      ...aside,
    ].join(' '),
  };
}

/** Does what stands match what was sanctioned? */
function planDeviation(project: DdProject): ValueCheck | null {
  // A plan on a site not yet built is what may stand; there is nothing to deviate yet.
  if (!valueHasBuilding(project)) return null;
  const built = project.builtUpAreaSqm ?? 0;
  const sanctioned = said(project, 'sanctioned_area').map((s) => ({ n: num(s.fact), s })).find((x) => x.n && x.n > 0);
  if (built <= 0 && !sanctioned) return null;
  const base = { key: 'plan_deviation', label: 'Built against the sanctioned plan', group: 'lender' as const };
  if (!sanctioned || built <= 0) {
    return {
      ...base,
      verdict: 'unknown',
      headline: sanctioned ? 'Built-up area not recorded' : 'No sanctioned plan on file',
      detail: 'A lender compares the built-up area with the sanctioned plan: more than 5% over is a deviation to explain, more than 25% is one most panels will not lend against.',
      source: sanctioned ? `${docName(sanctioned.s.row)} p. ${sanctioned.s.fact.page}` : 'This file',
    };
  }
  const over = built / sanctioned.n! - 1;
  const source = `${docName(sanctioned.s.row)} p. ${sanctioned.s.fact.page}; the built-up area on this file`;
  if (over > 0.25) return { ...base, verdict: 'blocker', headline: `${pctText(over)} over the sanction`, detail: `${formatValueInput(built, 'sqm')} recorded against ${formatValueInput(sanctioned.n!, 'sqm')} sanctioned. Past 25% a panel valuer values only the sanctioned area, and most lenders decline.`, source };
  if (over > 0.05) return { ...base, verdict: 'attention', headline: `${pctText(over)} over the sanction`, detail: `${formatValueInput(built, 'sqm')} recorded against ${formatValueInput(sanctioned.n!, 'sqm')} sanctioned. A deviation to explain, and to value on the sanctioned area if it cannot be regularised.`, source };
  return { ...base, verdict: 'clear', headline: 'Within the sanction', detail: `${formatValueInput(built, 'sqm')} recorded against ${formatValueInput(sanctioned.n!, 'sqm')} sanctioned.`, source };
}

/** Is the FAR used within the FAR permitted? */
function farWithin(project: DdProject): ValueCheck | null {
  const used = said(project, 'sanctioned_far').map((s) => ({ n: num(s.fact), s })).find((x) => x.n && x.n > 0);
  const allowed = said(project, 'permissible_far').map((s) => ({ n: num(s.fact), s })).find((x) => x.n && x.n > 0);
  if (!used || !allowed) return null;
  const source = `${docName(used.s.row)} p. ${used.s.fact.page}; ${docName(allowed.s.row)} p. ${allowed.s.fact.page}`;
  const base = { key: 'far_within', label: 'FAR against the permitted', group: 'lender' as const, source };
  if (used.n! > allowed.n! + 1e-9) return { ...base, verdict: 'blocker', headline: `${used.n} against ${allowed.n} permitted`, detail: 'The FAR sanctioned exceeds the FAR the zoning permits. The excess is exposed to demolition or a penalty, and a lender will not value it.' };
  return { ...base, verdict: 'clear', headline: `${used.n} of ${allowed.n} permitted`, detail: 'The FAR sanctioned is within the FAR the zoning permits.' };
}

/** Is a charge registered against the property? */
function chargesOnTitle(project: DdProject): ValueCheck | null {
  const nil = said(project, 'ec_nil')[0];
  const charges = said(project, 'subsisting_charges')[0];
  if (!nil && !charges) return null;
  const base = { key: 'charges', label: 'Charges on the title', group: 'lender' as const };
  if (charges) {
    const raw = String(charges.fact.value).trim();
    const count = Number(raw);
    const none = Number.isFinite(count) ? count <= 0 : /^(?:nil|none|no)\b/i.test(raw) || raw === '';
    if (!none) {
      const what = Number.isFinite(count) ? `${count} subsisting charge${count === 1 ? '' : 's'}` : `“${raw}”`;
      return { ...base, verdict: 'attention', headline: Number.isFinite(count) ? `${count} charge${count === 1 ? '' : 's'} registered` : 'A charge is registered', detail: `The encumbrance certificate records ${what}. It has to be discharged before completion, or the lender's charge ranks behind it.`, source: `${docName(charges.row)} p. ${charges.fact.page}` };
    }
  }
  if (nil && (nil.fact.value === true || /^(?:yes|true|nil)$/i.test(String(nil.fact.value)))) {
    return { ...base, verdict: 'clear', headline: 'Nil encumbrance', detail: 'The encumbrance certificate on file records no charge for the period it covers. Check that period reaches today.', source: `${docName(nil.row)} p. ${nil.fact.page}` };
  }
  return { ...base, verdict: 'attention', headline: 'Not a nil EC', detail: 'The encumbrance certificate on file is not a nil certificate. Read the transactions it lists for a subsisting charge.', source: nil ? `${docName(nil.row)} p. ${nil.fact.page}` : 'Encumbrance certificate' };
}

/** Is the parcel on the state's prohibited register? */
function prohibited(project: DdProject): ValueCheck | null {
  const reads = revenueReads(project);
  if (!reads.length) return null;
  const labels = parcelLabels(reads);
  const label = (r: (typeof reads)[number]) => labels.get(r.parcelRef) ?? r.surveyNo;
  const base = { key: 'prohibited', label: 'Prohibited register', group: 'lender' as const, source: `State revenue map, ${surveyNumbersLabel(reads.map(label))}` };
  // One listed parcel blocks the site, whatever else is read or not.
  const listed = reads.filter((r) => r.prohibitedCategory);
  if (listed.length && reads.length === 1) {
    const read = listed[0]!;
    return { ...base, verdict: 'blocker', headline: read.prohibitedCategory ?? '', detail: `The parcel is on the state's prohibited register as ${read.prohibitedCategory}. It cannot be registered for sale until it is removed, and no lender will take it as security.` };
  }
  if (listed.length) {
    return {
      ...base,
      verdict: 'blocker',
      headline: `${surveyNumbersLabel(listed.map(label))} listed`,
      detail: `${listed.map((r) => `Sy. ${label(r)} is on the state's prohibited register as ${r.prohibitedCategory}`).join('; ')}. A listed parcel cannot be registered for sale until it is removed, and no lender will take it as security.`,
    };
  }
  const unjoined = reads.filter((r) => r.prohibitedRegisterUnjoined);
  const silence = unjoined.length
    ? reads.length === 1
      ? 'The layer this parcel came from is not joined to the prohibited register, so its silence says nothing.'
      : `The layer ${surveyNumbersLabel(unjoined.map(label))} came from is not joined to the prohibited register, so its silence says nothing.`
    : null;
  // A number the file states, accepted by a person, with no parcel read for it: the register has not been asked about that
  // land, and the parcels that were read cannot answer for it.
  const unread = offeredSurveyNumbers(project)
    .filter((o) => o.accepted && !o.unreadable && !revenueReadFor(reads, o.surveyNo))
    .map((o) => o.surveyNo);
  if (unread.length) {
    const found = silence ?? (reads.length === 1 ? 'The revenue map read found the parcel on no prohibited register.' : `The revenue map read found none of the ${reads.length} parcels on a prohibited register.`);
    return {
      ...base,
      verdict: 'unknown',
      headline: `${surveyNumbersLabel(unread)} not read`,
      detail: `${found} But ${surveyNumbersLabel(unread)} ${unread.length === 1 ? 'is' : 'are'} stated on this file and not read from the map, and one listed parcel blocks a site. Read ${unread.length === 1 ? 'it' : 'them'}, or search the register at the sub-registrar.`,
    };
  }
  if (silence) return { ...base, verdict: 'unknown', headline: 'Register not joined', detail: `${silence} Search the register at the sub-registrar.` };
  if (reads.length === 1) return { ...base, verdict: 'clear', headline: 'Not on the register', detail: 'The revenue map read found the parcel on no prohibited register.' };
  return { ...base, verdict: 'clear', headline: 'Not on the register', detail: `The revenue map read found none of the ${reads.length} parcels on a prohibited register.` };
}

/** Does the figure sit below the value the duty is charged on? */
function againstGuideline(summary: ValueSummary): ValueCheck | null {
  if (!summary.guideline) {
    return summary.guidelineNote
      ? { key: 'vs_guideline', label: 'Value against the guideline value', group: 'lender', source: 'State revenue map', verdict: 'unknown', headline: 'No guideline value for the site', detail: summary.guidelineNote }
      : null;
  }
  const base = { key: 'vs_guideline', label: 'Value against the guideline value', group: 'lender' as const, source: `Guidance value, ${summary.guideline.published}` };
  if (summary.vsGuideline === null) return { ...base, verdict: 'unknown', headline: `Guideline ${formatValueInput(summary.guideline.value, 'INR')}`, detail: 'There is no figure yet to compare with the guideline value of the land.' };
  if (summary.restsOnGuidance) {
    return { ...base, verdict: 'unknown', headline: 'The figure is the guideline value', detail: 'The only rate on the file is the guidance value, so the figure is the guideline value itself and there is nothing to test it against. Record comparables, or a recent sale of the parcel, for a market figure.' };
  }
  if (summary.vsGuideline < 0) {
    return {
      ...base,
      verdict: 'attention',
      headline: `${pctText(summary.vsGuideline)} below guideline`,
      detail: `The figure is below the guideline value of the land (${formatValueInput(summary.guideline.value, 'INR')}). Stamp duty is charged on the guideline value regardless, the buyer's income-tax position is computed on it, and a lender will ask why the market sits under the state's own floor.`,
    };
  }
  return { ...base, verdict: 'clear', headline: `${pctText(summary.vsGuideline)} above guideline`, detail: `The figure sits above the guideline value of the land (${formatValueInput(summary.guideline.value, 'INR')}).` };
}

/** Do the approaches cross-check each other? */
function approachesAgree(working: ValuationWorking): ValueCheck | null {
  const usable = working.runs.filter(approachIsUsable);
  const blend = working.unadjusted.indicated;
  if (!usable.length) return null;
  const base = { key: 'approaches_agree', label: 'Approaches against each other', group: 'lender' as const, source: usable.map((r) => VALUATION_METHOD_LABEL[r.method]).join(', ') };
  if (usable.length === 1) {
    return { ...base, verdict: 'attention', headline: 'One approach — no cross-check', detail: `Only ${VALUATION_METHOD_LABEL[usable[0]!.method].toLowerCase()} ran. A panel report wants a second approach beside it; the inputs each other approach is waiting on are listed under it.` };
  }
  if (blend === null || blend <= 0) {
    return { ...base, verdict: 'blocker', headline: 'Too far apart to blend', detail: working.reconciliation.spreadBasis };
  }
  const furthest = usable.reduce((worst, r) => (Math.abs(r.amount! / blend - 1) > Math.abs(worst.amount! / blend - 1) ? r : worst));
  const gap = Math.abs(furthest.amount! / blend - 1);
  if (gap > DIVERGENCE_NEEDS_NOTE) {
    return { ...base, verdict: 'attention', headline: `${pctText(gap)} apart`, detail: `${VALUATION_METHOD_LABEL[furthest.method]} sits ${pctText(gap)} from the blend. Past ${pctText(DIVERGENCE_NEEDS_NOTE)} the report has to say why the approaches differ and why the weights are what they are.` };
  }
  return { ...base, verdict: 'clear', headline: `Within ${pctText(gap)}`, detail: `${usable.length} approaches agree within ${pctText(gap)} of their blend.` };
}

/** Is the market rate drawn from enough comparables, adjusted to the subject? */
function comparablesStand(project: DdProject): ValueCheck | null {
  const schedule = comparableSchedule(project);
  if (!schedule) return null;
  const base = { key: 'comparables', label: 'Comparable evidence', group: 'lender' as const, source: `Comparable schedule, ${schedule.count} on the register` };
  if (schedule.undiscountedListings) {
    return {
      ...base,
      verdict: 'attention',
      headline: `${schedule.undiscountedListings} asking price${schedule.undiscountedListings === 1 ? '' : 's'}, no discount`,
      detail: `${schedule.undiscountedListings} of the ${schedule.count} comparables are portal listings with no listing discount set. An asking price is what a seller hopes for; a panel valuer takes it down to what the property would sell at before using it.`,
    };
  }
  if (schedule.count < MIN_SCHEDULE) {
    return { ...base, verdict: 'attention', headline: `Only ${schedule.count}`, detail: `A rate from ${schedule.count} comparable${schedule.count === 1 ? '' : 's'} is a sample, not a market. A panel report wants three or more.` };
  }
  return { ...base, verdict: 'clear', headline: `${schedule.count} comparables, adjusted`, detail: `${schedule.count} comparables, every listing discounted from its asking price, at a net ${schedule.netAdjustmentPct >= 0 ? '+' : ''}${schedule.netAdjustmentPct.toFixed(1)}% to the subject.` };
}

const VERDICT_ORDER: ComplianceVerdict[] = ['blocker', 'attention', 'unknown', 'clear'];

/**
 * A check with nothing to stand on yet, where what would answer it has been
 * read and waits: a model's reading nobody has accepted, or a value two
 * readers differ on.
 */
function readingWaits(project: DdProject, key: string, label: string, facts: readonly string[]): ValueCheck | null {
  for (const row of (project.evidence ?? []).filter(onFile)) {
    const fact = waitingReadings(row).find((f) => facts.includes(f.key));
    if (!fact) continue;
    return {
      key,
      label,
      group: 'lender',
      verdict: 'unknown',
      headline: 'A reading is waiting',
      detail: `${waitingReadingSaid(fact, docName(row))} ${fact.otherReading ? 'Keep one' : 'Accept it or set it aside'} on the document; until then it answers nothing here.`,
      source: `${docName(row)} p. ${fact.page}`,
    };
  }
  return null;
}

/**
 * Every check on the figure: the state's title checks from the last screen,
 * then the lender's own. Worst first.
 */
export function valueChecks(project: DdProject, working: ValuationWorking, summary: ValueSummary, screen?: ScreenResult): ValueCheck[] {
  const state: ValueCheck[] = (screen?.stateCompliance?.checks ?? []).map((c) => ({
    key: `state:${c.key}`,
    label: c.label,
    verdict: c.verdict,
    headline: c.headline,
    detail: [c.finding, c.nextStep].filter(Boolean).join(' '),
    source: c.statute,
    group: 'state',
  }));
  // A check with nothing to stand on, where a model has read what would answer it, says that the reading is waiting.
  const orWaiting = (check: ValueCheck | null, key: string, label: string, facts: readonly string[]): ValueCheck | null =>
    check && check.verdict !== 'unknown' ? check : (readingWaits(project, key, label, facts) ?? check);
  const lender = [
    extentsAgree(project),
    orWaiting(planDeviation(project), 'plan_deviation', 'Built against the sanctioned plan', ['sanctioned_area']),
    orWaiting(farWithin(project), 'far_within', 'FAR against the permitted', ['sanctioned_far', 'permissible_far']),
    orWaiting(chargesOnTitle(project), 'charges', 'Charges on the title', ['ec_nil', 'subsisting_charges']),
    prohibited(project),
    comparablesStand(project),
    againstGuideline(summary),
    approachesAgree(working),
  ].filter((c): c is ValueCheck => c !== null);
  return [...state, ...lender].sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict));
}

/* ==================================================================== */
/* What moves the value                                                  */
/* ==================================================================== */

export interface ValueDriverLine {
  key: string;
  label: string;
  direction: 'up' | 'down' | 'neutral';
  /** Signed percent of value, as one figure or a band. Null where nobody has put a number on it. */
  impact: { low: number; high: number } | null;
  /** The figure on the page already carries it. */
  applied: boolean;
  /** Why, in a sentence. */
  basis: string;
  source: string;
}

const dir = (pct: number): ValueDriverLine['direction'] => (pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral');
const one = (pct: number) => ({ low: pct, high: pct });

/**
 * What pushes this value up or down.
 *
 * Applied first — the surroundings the figure already takes off, and the
 * building's age the cost approach depreciates for — then what the file
 * records that a buyer or a lender would price, each with the rate this
 * product keeps for it and a note that the figure does not carry it. A valuer
 * reflects those in the comparables' adjustment, where they belong.
 */
export function valueDrivers(project: DdProject, working: ValuationWorking, screen?: ScreenResult): ValueDriverLine[] {
  const out: ValueDriverLine[] = [];

  for (const a of working.externalities.applied) {
    out.push({ key: `ext:${a.key}`, label: a.label, direction: 'down', impact: one(a.pct * 100), applied: true, basis: a.say, source: a.from });
  }

  const cost = working.runs.find((r) => r.method === 'depreciated_replacement_cost');
  const age = cost?.inputs.find((i) => i.key === 'effective_age')?.value;
  const life = cost?.inputs.find((i) => i.key === 'expected_life')?.value;
  if (cost && approachIsUsable(cost) && age && life && life > 0) {
    const share = Math.min(1, age / life);
    out.push({
      key: 'depreciation',
      label: 'Age of the building',
      direction: 'down',
      impact: null,
      applied: true,
      basis: `${age} of ${life} years into its life, so the cost approach takes ${Math.round(share * 100)}% off the building's replacement cost.`,
      source: 'Cost approach',
    });
  }

  // What the state's maps found. One parcel's factors are told as they
  // always were. A site on several is every parcel's, each finding once and
  // told for the parcel it bears on hardest — the lines the brief under the
  // map shows — and saying which parcel that is. Only a line the engine put
  // a verdict on moves a value; a tank that is merely nearby does not.
  const reads = revenueReads(project);
  const onMap: Array<{ f: RevenueMapFactor; key: string; where: string | null }> = [];
  if (reads.length > 1) {
    const brief = revenueSiteBrief(project, reads);
    const keyed = new Set<string>();
    for (const item of brief ? [...brief.warnings, ...brief.planned, ...brief.zoning, ...brief.positives] : []) {
      const f = reads.find((r) => r.parcelRef === item.told)?.factors.find((x) => x.code === item.code);
      if (!f) continue;
      onMap.push({ f, key: keyed.has(f.code) ? `map:${f.code}:${item.told}` : `map:${f.code}`, where: item.where });
      keyed.add(f.code);
    }
  } else {
    for (const f of reads[0]?.factors ?? []) onMap.push({ f, key: `map:${f.code}`, where: null });
  }
  for (const { f, key, where } of onMap) {
    const low = Math.min(f.impactLowPct, f.impactHighPct);
    const high = Math.max(f.impactLowPct, f.impactHighPct);
    out.push({
      key,
      label: where ? `${f.label} · ${where}` : f.label,
      direction: f.direction === 'up' ? 'up' : f.direction === 'down' ? 'down' : 'neutral',
      impact: low === 0 && high === 0 ? null : { low, high },
      applied: false,
      basis: f.headline,
      source: f.source,
    });
  }

  const checks = new Map((screen?.stateCompliance?.checks ?? []).map((c) => [c.key, c]));
  const ka = project.karnataka;
  if (ka?.khataType === 'b_khata' || /\bB-?khata\b/i.test(checks.get('khata_classification')?.headline ?? '')) {
    out.push({ key: 'b_khata', label: 'B-khata', direction: 'down', impact: one(-12), applied: false, basis: 'Scheduled banks will not lend against B-khata, so buyers are cash buyers only, and that alone forces a discount against A-khata stock.', source: checks.has('khata_classification') ? 'Khata classification check' : 'Karnataka particulars' });
  }
  if (ka?.jurisdiction === 'gram_panchayat') {
    out.push({ key: 'gram_panchayat', label: 'Gram Panchayat jurisdiction', direction: 'down', impact: one(-6), applied: false, basis: 'Outside BBMP and BDA limits: height and density are capped, and mainstream lenders are more cautious.', source: 'Karnataka particulars' });
  }
  const oc = checks.get('occupancy_certificate_compliance');
  if (oc && (oc.verdict === 'attention' || oc.verdict === 'blocker') && (project.builtUpAreaSqm ?? 0) > 0) {
    out.push({ key: 'no_oc', label: 'No occupancy certificate', direction: 'down', impact: one(-5), applied: false, basis: 'Without an OC, compliance with the sanctioned plan cannot be confirmed — lenders and careful buyers both price it.', source: 'Occupancy certificate check' });
  }
  if (project.tenure === 'leasehold') {
    out.push({ key: 'tenure', label: 'Leasehold', direction: 'down', impact: one(-6), applied: false, basis: 'Leasehold is priced at a discount to the freehold stock most comparables are.', source: 'Tenure on this file' });
  } else if (!project.tenure || project.tenure === 'unknown') {
    out.push({ key: 'tenure', label: 'Tenure unconfirmed', direction: 'down', impact: one(-4), applied: false, basis: 'Nothing on the file confirms the tenure, so a buyer prices it cautiously until a document does.', source: 'Tenure on this file' });
  }

  const plot = project.plot;
  if (plot) {
    if (plot.roadWidthFt !== undefined) {
      const pct = roadWidthAdjustmentPct(plot.roadWidthFt);
      out.push({ key: 'road', label: `${plot.roadWidthFt} ft road`, direction: dir(pct), impact: pct ? one(pct) : null, applied: false, basis: pct >= 0 ? 'A wider road gives access and, in Bengaluru zoning, a higher permissible FAR.' : 'Narrower than the layout norm, which constrains access and the FAR the site can use.', source: 'Plot particulars' });
    }
    if (plot.cornerSite) {
      const pct = cornerSiteAdjustmentPct(true);
      out.push({ key: 'corner', label: 'Corner site', direction: 'up', impact: one(pct), applied: false, basis: 'Two road frontages and easier access.', source: 'Plot particulars' });
    }
    if (plot.facing && plot.facing !== 'unknown') {
      const pct = FACING_ADJUSTMENT_PCT[plot.facing];
      if (pct) out.push({ key: 'facing', label: `${plot.facing.replace(/_/g, '-')} facing`, direction: dir(pct), impact: one(pct), applied: false, basis: pct > 0 ? 'A facing the market pays a little more for.' : 'A facing the market discounts a little.', source: 'Plot particulars' });
    }
    if (plot.dimensionsFt) {
      const pct = dimensionStandardnessAdjustmentPct(plot.dimensionsFt);
      if (pct) out.push({ key: 'shape', label: `${plot.dimensionsFt.width} × ${plot.dimensionsFt.depth} ft`, direction: dir(pct), impact: one(pct), applied: false, basis: pct > 0 ? 'A standard shape resells most easily.' : 'An elongated shape is harder to build on and to resell.', source: 'Plot particulars' });
    }
    if (plot.layoutApproval && plot.layoutApproval !== 'unknown') {
      const pct = LAYOUT_APPROVAL_ADJUSTMENT_PCT[plot.layoutApproval];
      if (pct) out.push({ key: 'layout', label: `Layout: ${plot.layoutApproval.replace(/_/g, ' ')}`, direction: dir(pct), impact: one(pct), applied: false, basis: pct > 0 ? 'An approved layout is the most bankable status.' : 'Hard to finance and to resell, and exposed to regularisation.', source: 'Plot particulars' });
    }
  }

  const transit = nearestTransit(project.siteContext);
  if (transit) {
    const { metres, basis } = amenityDistance(transit);
    if (metres <= 1500) {
      out.push({
        key: 'transit',
        label: `${transit.name} ${metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`}`,
        direction: 'up',
        impact: null,
        applied: false,
        basis: `Transit within walking distance${basis === 'straight_line' ? ' (straight line)' : ''}${transit.fromApproximatePin ? ', measured from an approximate pin' : ''}. A premium the comparables should already show.`,
        source: 'Site context',
      });
    }
  }

  return out;
}
