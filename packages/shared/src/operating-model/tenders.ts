/**
 * Procurement › Tenders: each work package, from tender papers to a signed
 * contract.
 *
 * A tender is kept for one work package of the cost register. It moves
 * through nine stages, in order, and each has a date it is due by and the
 * person it is with. The bidders are kept beside it: what each quoted, what
 * they revised it to after negotiation, what they qualified or left out, and
 * their price item by item where it was given.
 *
 * Four things the register holds to.
 *
 * The comparison is arithmetic and says so. A bid is set against the
 * pre-tender estimate and against the median of the bids. One that
 * stands further from the others than a set percentage is flagged, and the
 * flag says how far and which way: "differs from the others by 18%". It never
 * says a bid is good, low, abnormal or to be rejected. That is a person's to
 * say, in the recommendation.
 *
 * The recommendation is a person's words, under their name. Nothing here
 * writes one.
 *
 * A letter of acceptance offers, and Finance accepts. The awarded value is
 * offered to the package's row on the Cost Report as PO issued. It is written
 * there when a lead or a signer in Finance accepts it, and not before.
 *
 * A stage past its date is an alert, once for that date, cleared when the
 * stage is done, moved or marked not needed.
 *
 * Bidders' names and prices are commercially sensitive. Somebody working from
 * a grant is handed a project without this register unless the grant names
 * Procurement (`projectView`).
 */

import type { DdProject } from './types';
import type { DepartmentKey } from './departments';
import { costRegister, moneySaid } from './cost';
import { costReportsOf, updateCostReportRow } from './cost-report';
import { recordAuditEvent } from './operations';

/* ==================================================================== */
/* What is kept                                                          */
/* ==================================================================== */

/** The stages of a tender, in the order they are worked. */
export const TENDER_STAGES = [
  'documents_ready',
  'issued',
  'queries',
  'bids_received',
  'comparison',
  'negotiation',
  'recommendation',
  'letter_of_acceptance',
  'contract_signed',
] as const;

export type TenderStageKey = (typeof TENDER_STAGES)[number];

export const TENDER_STAGE_LABEL: Record<TenderStageKey, string> = {
  documents_ready: 'Tender documents ready',
  issued: 'Issued to bidders',
  queries: 'Queries and addenda',
  bids_received: 'Bids received',
  comparison: 'Comparison',
  negotiation: 'Negotiation',
  recommendation: 'Recommendation',
  letter_of_acceptance: 'Letter of acceptance',
  contract_signed: 'Contract signed',
};

/** The stages a tender may go without: no bidder asked anything, or nothing was negotiated. */
export const TENDER_STAGES_OPTIONAL: readonly TenderStageKey[] = ['queries', 'negotiation'];

/** A bid is flagged when it stands further than this from the median of the bids, in percent. */
export const TENDER_BID_FLAG_PERCENT = 15;

/** One priced item of a bid is flagged when it stands further than this from the median of the prices given for it, in percent. */
export const TENDER_LINE_FLAG_PERCENT = 25;

/** The fewest bids there are before one is set against the others: with two, there are no others to speak of. */
export const TENDER_MIN_BIDS_TO_FLAG = 3;

/** How much of each thing a tender keeps. The routes hold their input to the same sizes. */
export const TENDER_LIMITS = { tenders: 200, bidders: 30, lines: 200, name: 160, owner: 120, note: 2000, text: 4000 } as const;

export interface TenderStage {
  key: TenderStageKey;
  /** The day it is due by, YYYY-MM-DD. */
  dueOn?: string;
  /** Who it is with, as the office names them. */
  owner?: string;
  /** The day it was done, YYYY-MM-DD. */
  doneOn?: string;
  /** A person said this tender goes without it. Only for the stages that may be gone without. */
  notNeeded?: true;
}

/** One priced item of a bid. */
export interface TenderBidLine {
  id: string;
  item: string;
  amount: number;
}

export interface TenderBidder {
  id: string;
  name: string;
  /** What they quoted, in the project's currency. */
  quoted?: number;
  /** What they revised it to after negotiation. */
  revised?: number;
  /** What they made their price conditional on, as noted. */
  qualifications?: string;
  /** What they left out of their price, as noted. */
  exclusions?: string;
  lines?: TenderBidLine[];
  addedAt: string;
  addedBy: string;
  updatedAt: string;
  updatedBy: string;
}

/** A person's recommendation of who to award to, in their words. */
export interface TenderRecommendation {
  bidderId: string;
  text: string;
  by: string;
  at: string;
}

/** The letter of acceptance: who the package was awarded to, and for how much. */
export interface TenderAward {
  bidderId: string;
  value: number;
  /** The day of the letter, YYYY-MM-DD. */
  letterOn: string;
  /** The letter, on the document vault. */
  evidenceId?: string;
  by: string;
  at: string;
}

/** The awarded value, offered to the Cost Report's row for the package as PO issued. */
export interface TenderOffer {
  id: string;
  workPackageId: string;
  amount: number;
  status: 'offered' | 'accepted' | 'declined';
  offeredAt: string;
  offeredBy: string;
  decidedAt?: string;
  decidedBy?: string;
  /** Why it was declined. */
  reason?: string;
  /** The Cost Report it was written on, once accepted. */
  reportId?: string;
}

export interface Tender {
  id: string;
  /** The work package of the cost register it is for. */
  workPackageId: string;
  /** The package's name when the tender was started, for a reader who is not shown the cost register. */
  packageName: string;
  /** The pre-tender estimate, in the project's currency. */
  estimate?: number;
  /** All nine, in order. */
  stages: TenderStage[];
  bidders: TenderBidder[];
  recommendation?: TenderRecommendation;
  award?: TenderAward;
  offer?: TenderOffer;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ProcurementRegister {
  tenders: Tender[];
}

/* ==================================================================== */
/* Small things                                                          */
/* ==================================================================== */

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

/** An amount in whole paise, read as the decimal it was written as. */
function inPaise(amount: number): number {
  return Math.round(Number((Math.abs(amount) * 100).toPrecision(15))) * (amount < 0 ? -1 : 1);
}

const AMOUNT_BELOW = 1e13;

/** An amount as it is kept: more than nothing, below ten million million, to the paisa. */
function amountOf(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= AMOUNT_BELOW) throw new Error(`${what} is an amount of money, more than nothing.`);
  return inPaise(value) / 100;
}

/** Whether some words are a day of the calendar, written YYYY-MM-DD. */
function isDay(value: unknown): value is string {
  const said = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!said) return false;
  const [year, month, day] = [Number(said[1]), Number(said[2]), Number(said[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dayOf(value: unknown, what: string): string {
  if (!isDay(value)) throw new Error(`${what} is a day, written YYYY-MM-DD.`);
  return value;
}

/** Some words as they are kept: trimmed, and no longer than their limit. */
function wordsOf(value: string | undefined | null, limit: number, what: string): string | undefined {
  const said = value?.trim();
  if (!said) return undefined;
  if (said.length > limit) throw new Error(`${what} is at most ${limit} characters.`);
  return said;
}

const todayOf = (now: Date): string => now.toISOString().slice(0, 10);

/** A percentage as it is written: to one place, and to none where that place is nought. */
function percentSaid(percent: number): string {
  const tenths = Math.round(Math.abs(percent) * 10) / 10;
  return `${Number.isInteger(tenths) ? tenths.toFixed(0) : tenths.toFixed(1)}%`;
}

/* ==================================================================== */
/* Reading                                                               */
/* ==================================================================== */

/** The project's tenders, or none. The project is not changed. */
export function tendersOf(project: Pick<DdProject, 'procurement'>): Tender[] {
  return project.procurement?.tenders ?? [];
}

function registerOf(project: DdProject): ProcurementRegister {
  if (!project.procurement) project.procurement = { tenders: [] };
  return project.procurement;
}

export function tenderOf(project: Pick<DdProject, 'procurement'>, tenderId: string): Tender {
  const held = tendersOf(project).find((tender) => tender.id === tenderId);
  if (!held) throw new Error('No tender by that id.');
  return held;
}

/** A tender's package as it is named now: by the cost register where the reader has it, else as it was named when the tender was started. */
export function tenderPackageName(project: Pick<DdProject, 'cost'>, tender: Pick<Tender, 'workPackageId' | 'packageName'>): string {
  const pack = costRegister(project).workPackages.find((held) => held.id === tender.workPackageId);
  return pack ? [pack.code, pack.name].filter(Boolean).join(' ') : tender.packageName;
}

/** Whether a stage is behind the tender: done, or gone without. */
export const tenderStageSettled = (stage: TenderStage): boolean => Boolean(stage.doneOn) || Boolean(stage.notNeeded);

export interface TenderStanding {
  /** The stage the tender is at: the first that is neither done nor gone without. None once the contract is signed. */
  at?: TenderStageKey;
  /** How many stages are behind it. */
  settled: number;
  /** The stages past their date and not done, in order. */
  late: TenderStageKey[];
  /** In a line: "At comparison, 1 stage past its date". */
  say: string;
}

export function tenderStanding(tender: Pick<Tender, 'stages'>, now = new Date()): TenderStanding {
  const today = todayOf(now);
  const at = tender.stages.find((stage) => !tenderStageSettled(stage))?.key;
  const late = tender.stages.filter((stage) => !tenderStageSettled(stage) && stage.dueOn !== undefined && stage.dueOn < today).map((stage) => stage.key);
  const where = at ? `At ${TENDER_STAGE_LABEL[at].toLowerCase()}` : 'Contract signed';
  return { ...(at ? { at } : {}), settled: tender.stages.filter(tenderStageSettled).length, late, say: late.length ? `${where}, ${late.length} ${late.length === 1 ? 'stage' : 'stages'} past ${late.length === 1 ? 'its' : 'their'} date` : where };
}

/* ==================================================================== */
/* The comparison                                                        */
/* ==================================================================== */

export interface TenderFlag {
  bidderId: string;
  name: string;
  /** The priced item, on a flag about one item of a bid. */
  item?: string;
  /** How far from the median, in percent: less than nothing is below. */
  percent: number;
  say: string;
}

export interface TenderBidRow {
  bidderId: string;
  name: string;
  quoted?: number;
  revised?: number;
  /** The figure compared: the revised one where there is one. */
  amount?: number;
  /** Against the pre-tender estimate, in percent: less than nothing is below it. */
  againstEstimate?: number;
  /** Against the median of the bids, in percent. Absent with fewer bids than can be compared. */
  againstOthers?: number;
  flagged: boolean;
  /** The lowest figure compared. A fact of the arithmetic, and no recommendation. */
  lowest: boolean;
}

export interface TenderLineCell {
  bidderId: string;
  amount?: number;
  againstOthers?: number;
  flagged: boolean;
}

export interface TenderLineRow {
  item: string;
  cells: TenderLineCell[];
}

export interface TenderComparison {
  estimate?: number;
  /** The median of every figure compared. */
  median?: number;
  bids: TenderBidRow[];
  /** The priced items, one row an item, where any bidder gave them. A cell a bidder: in the order of `bids`. */
  lines: TenderLineRow[];
  flags: TenderFlag[];
}

function medianOf(amounts: readonly number[]): number {
  const sorted = [...amounts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * One figure against the others': how far from the median of every figure
 * given, its own among them, in percent, and whether that is further than the
 * limit. The median of them all, so that one figure far from the rest moves
 * the mark it is measured from as little as it can. Asked in paise, so a
 * figure exactly at the limit is not past it by a rounding.
 */
function againstOthers(amount: number, all: readonly number[], limit: number): { percent: number; flagged: boolean } | undefined {
  if (all.length < TENDER_MIN_BIDS_TO_FLAG) return undefined;
  const median = medianOf(all.map(inPaise));
  if (median <= 0) return undefined;
  const apart = inPaise(amount) - median;
  return { percent: (apart / median) * 100, flagged: Math.abs(apart) * 100 > limit * median };
}

const whichWay = (percent: number): string => (percent < 0 ? 'below' : 'above');

/** An item's name as it is matched between bids: case and spacing do not make two items of one. */
const itemKey = (item: string): string => item.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * A tender's bids, set side by side.
 *
 * Each bid is the revised figure where there is one, else the quoted one.
 * Against the estimate it is a percentage and no more. Against the others it
 * is a percentage from the median of the bids, flagged past
 * `TENDER_BID_FLAG_PERCENT`; an item of a bid the same way, past
 * `TENDER_LINE_FLAG_PERCENT`. A flag says how far and which way.
 */
export function tenderComparison(tender: Pick<Tender, 'estimate' | 'bidders'>): TenderComparison {
  const flags: TenderFlag[] = [];
  const figures = tender.bidders.map((bidder) => ({ bidder, amount: bidder.revised ?? bidder.quoted }));
  const priced = figures.flatMap((row) => (row.amount === undefined ? [] : [row.amount]));
  const least = priced.length ? Math.min(...priced) : undefined;
  const bids = figures.map(({ bidder, amount }): TenderBidRow => {
    const apart = amount === undefined ? undefined : againstOthers(amount, priced, TENDER_BID_FLAG_PERCENT);
    if (apart?.flagged) flags.push({ bidderId: bidder.id, name: bidder.name, percent: apart.percent, say: `${bidder.name} differs from the others by ${percentSaid(apart.percent)}, ${whichWay(apart.percent)} the median.` });
    return {
      bidderId: bidder.id,
      name: bidder.name,
      ...(bidder.quoted !== undefined ? { quoted: bidder.quoted } : {}),
      ...(bidder.revised !== undefined ? { revised: bidder.revised } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(amount !== undefined && tender.estimate ? { againstEstimate: ((inPaise(amount) - inPaise(tender.estimate)) / inPaise(tender.estimate)) * 100 } : {}),
      ...(apart ? { againstOthers: apart.percent } : {}),
      flagged: Boolean(apart?.flagged),
      lowest: amount !== undefined && amount === least && priced.length > 1,
    };
  });

  // The items in the order they are first met, each bidder's own price for it.
  const items = new Map<string, string>();
  for (const bidder of tender.bidders) for (const line of bidder.lines ?? []) if (!items.has(itemKey(line.item))) items.set(itemKey(line.item), line.item.trim());
  const lines = [...items].map(([key, item]): TenderLineRow => {
    const prices = tender.bidders.map((bidder) => ({ bidder, amount: (bidder.lines ?? []).find((line) => itemKey(line.item) === key)?.amount }));
    return {
      item,
      cells: prices.map(({ bidder, amount }): TenderLineCell => {
        const given = prices.flatMap((row) => (row.amount === undefined ? [] : [row.amount]));
        const apart = amount === undefined ? undefined : againstOthers(amount, given, TENDER_LINE_FLAG_PERCENT);
        if (apart?.flagged) flags.push({ bidderId: bidder.id, name: bidder.name, item, percent: apart.percent, say: `${bidder.name}, ${item}: differs from the others by ${percentSaid(apart.percent)}, ${whichWay(apart.percent)} the median.` });
        return { bidderId: bidder.id, ...(amount !== undefined ? { amount } : {}), ...(apart ? { againstOthers: apart.percent } : {}), flagged: Boolean(apart?.flagged) };
      }),
    };
  });

  return { ...(tender.estimate ? { estimate: tender.estimate } : {}), ...(priced.length ? { median: medianOf(priced.map(inPaise)) / 100 } : {}), bids, lines, flags };
}

/** A percentage against the estimate or the others, as a cell writes it: "12% below", "3.5% above", "the same". */
export function tenderPercentSaid(percent: number): string {
  return Math.round(Math.abs(percent) * 10) === 0 ? 'the same' : `${percentSaid(percent)} ${whichWay(percent)}`;
}

/* ==================================================================== */
/* Starting and changing a tender                                        */
/* ==================================================================== */

function touched(project: DdProject, tender: Tender, actor: string): void {
  tender.updatedAt = nowIso();
  tender.updatedBy = actor;
  project.updatedAt = tender.updatedAt;
}

/** Start the tender for a work package. A package has one tender. */
export function startTender(project: DdProject, input: { workPackageId: string; estimate?: number }, actor: string): Tender {
  const pack = costRegister(project).workPackages.find((held) => held.id === input.workPackageId);
  if (!pack) throw new Error('No work package by that id. Work packages are kept in Finance › Budget.');
  const register = registerOf(project);
  if (register.tenders.some((tender) => tender.workPackageId === pack.id)) throw new Error('That work package has a tender already.');
  if (register.tenders.length >= TENDER_LIMITS.tenders) throw new Error(`A project keeps at most ${TENDER_LIMITS.tenders} tenders.`);
  const at = nowIso();
  const tender: Tender = {
    id: newId('tnd'),
    workPackageId: pack.id,
    packageName: [pack.code, pack.name].filter(Boolean).join(' '),
    ...(input.estimate !== undefined ? { estimate: amountOf(input.estimate, 'An estimate') } : {}),
    stages: TENDER_STAGES.map((key) => ({ key })),
    bidders: [],
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
    updatedBy: actor,
  };
  register.tenders = [...register.tenders, tender];
  recordAuditEvent(project, { actor, action: 'start_tender', entityType: 'tender', entityId: tender.id, newValue: tender.packageName });
  return tender;
}

/** Set or clear the pre-tender estimate. */
export function setTenderEstimate(project: DdProject, tenderId: string, estimate: number | null, actor: string): Tender {
  const tender = tenderOf(project, tenderId);
  const was = tender.estimate;
  if (estimate === null) delete tender.estimate;
  else tender.estimate = amountOf(estimate, 'An estimate');
  touched(project, tender, actor);
  const said = (amount: number | undefined): string => (amount === undefined ? 'none' : moneySaid(amount, project.currency));
  recordAuditEvent(project, { actor, action: 'set_tender_estimate', entityType: 'tender', entityId: tender.id, oldValue: said(was), newValue: said(tender.estimate) });
  return tender;
}

/** Take a tender off the project. Refused once a letter of acceptance is on it: the award is then on the record. */
export function removeTender(project: DdProject, tenderId: string, actor: string): void {
  const tender = tenderOf(project, tenderId);
  if (tender.award) throw new Error('This tender has a letter of acceptance on it and stays on the record.');
  registerOf(project).tenders = tendersOf(project).filter((held) => held.id !== tenderId);
  recordAuditEvent(project, { actor, action: 'remove_tender', entityType: 'tender', entityId: tenderId, oldValue: tender.packageName });
}

/* ==================================================================== */
/* Stages                                                                */
/* ==================================================================== */

/** A change to a stage: a field that is named is set, and one given as null is cleared. */
export interface TenderStagePatch {
  dueOn?: string | null;
  owner?: string | null;
  doneOn?: string | null;
  notNeeded?: boolean;
}

/**
 * Change one stage of a tender: its date, who it is with, the day it was
 * done, or that the tender goes without it.
 *
 * The stages are worked in order. One is done only when every stage before it
 * is done or gone without, on a day that is not before theirs and not after
 * today. One is opened again only while nothing after it is done. A date due
 * is not before the date an earlier stage is due, nor after a later one's.
 *
 * The letter of acceptance is not marked done here: it is done by recording
 * the letter, with the bidder and the value (`recordLetterOfAcceptance`). The
 * recommendation is done once a person has written it.
 */
export function setTenderStage(project: DdProject, tenderId: string, key: TenderStageKey, patch: TenderStagePatch, actor: string, now = new Date()): TenderStage {
  const tender = tenderOf(project, tenderId);
  const at = tender.stages.findIndex((stage) => stage.key === key);
  const held = tender.stages[at];
  if (!held) throw new Error('No stage by that name.');
  const label = TENDER_STAGE_LABEL[key];
  const next: TenderStage = { ...held };
  const before = tender.stages.slice(0, at);
  const after = tender.stages.slice(at + 1);

  if (patch.owner !== undefined) {
    const owner = wordsOf(patch.owner, TENDER_LIMITS.owner, 'A name');
    if (owner) next.owner = owner;
    else delete next.owner;
  }

  if (patch.dueOn !== undefined) {
    if (patch.dueOn === null) delete next.dueOn;
    else {
      const dueOn = dayOf(patch.dueOn, 'A date');
      const earlier = before.filter((stage) => stage.dueOn !== undefined && stage.dueOn > dueOn)[0];
      if (earlier) throw new Error(`${label} cannot be due before ${TENDER_STAGE_LABEL[earlier.key].toLowerCase()}, which is due ${earlier.dueOn}.`);
      const later = after.filter((stage) => stage.dueOn !== undefined && stage.dueOn < dueOn)[0];
      if (later) throw new Error(`${label} cannot be due after ${TENDER_STAGE_LABEL[later.key].toLowerCase()}, which is due ${later.dueOn}.`);
      next.dueOn = dueOn;
    }
  }

  const settles = (patch.doneOn !== undefined && patch.doneOn !== null) || patch.notNeeded === true;
  const reopens = (patch.doneOn === null && held.doneOn !== undefined) || (patch.notNeeded === false && held.notNeeded === true);
  if (settles && patch.doneOn && patch.notNeeded) throw new Error('A stage is done or not needed, not both.');
  if (settles) {
    const open = before.find((stage) => !tenderStageSettled(stage));
    if (open) throw new Error(`${TENDER_STAGE_LABEL[open.key]} comes first: mark it done${TENDER_STAGES_OPTIONAL.includes(open.key) ? ' or not needed' : ''}.`);
  }
  if (reopens) {
    const done = after.find(tenderStageSettled);
    if (done) throw new Error(`${TENDER_STAGE_LABEL[done.key]} is already done. Open that again first.`);
    if (key === 'letter_of_acceptance') throw new Error('A letter of acceptance is taken back, not opened again.');
  }

  if (patch.notNeeded !== undefined) {
    if (patch.notNeeded) {
      if (!TENDER_STAGES_OPTIONAL.includes(key)) throw new Error(`A tender does not go without ${label.toLowerCase()}.`);
      next.notNeeded = true;
      delete next.doneOn;
    } else delete next.notNeeded;
  }

  if (patch.doneOn !== undefined) {
    if (patch.doneOn === null) delete next.doneOn;
    else {
      if (key === 'letter_of_acceptance') throw new Error('Record the letter of acceptance, with the bidder and the value.');
      if (key === 'recommendation' && !tender.recommendation) throw new Error('Write the recommendation first.');
      if (key === 'contract_signed' && !tender.award) throw new Error('A contract is signed after a letter of acceptance.');
      next.doneOn = doneDay(patch.doneOn, before, label, now);
      delete next.notNeeded;
    }
  }

  tender.stages[at] = next;
  touched(project, tender, actor);
  const said = (stage: TenderStage): string =>
    [stage.dueOn ? `due ${stage.dueOn}` : '', stage.owner ? `with ${stage.owner}` : '', stage.doneOn ? `done ${stage.doneOn}` : '', stage.notNeeded ? 'not needed' : ''].filter(Boolean).join(', ') || 'no date';
  recordAuditEvent(project, { actor, action: 'set_tender_stage', entityType: 'tender', entityId: tender.id, oldValue: `${label}: ${said(held)}`, newValue: `${label}: ${said(next)}` });
  return next;
}

/** The day a stage was done, as it is kept: a day, not after today, and not before the stages done before it. */
function doneDay(value: string, before: readonly TenderStage[], label: string, now: Date): string {
  const doneOn = dayOf(value, 'The day it was done');
  if (doneOn > todayOf(now)) throw new Error('A stage is done on a day that has come.');
  const last = before.filter((stage) => stage.doneOn !== undefined && stage.doneOn > doneOn)[0];
  if (last) throw new Error(`${label} cannot be done before ${TENDER_STAGE_LABEL[last.key].toLowerCase()}, done ${last.doneOn}.`);
  return doneOn;
}

/* ==================================================================== */
/* Bidders                                                               */
/* ==================================================================== */

export interface TenderBidderInput {
  name: string;
  quoted?: number;
  revised?: number;
  qualifications?: string;
  exclusions?: string;
  lines?: ReadonlyArray<{ item: string; amount: number }>;
}

export type TenderBidderPatch = { [K in keyof TenderBidderInput]?: TenderBidderInput[K] | null };

function bidderFields(input: TenderBidderInput, tender: Tender, heldId?: string): Omit<TenderBidder, 'id' | 'addedAt' | 'addedBy' | 'updatedAt' | 'updatedBy'> {
  const name = wordsOf(input.name, TENDER_LIMITS.name, 'A bidder’s name');
  if (!name) throw new Error('A bidder needs a name.');
  if (tender.bidders.some((bidder) => bidder.id !== heldId && bidder.name.trim().toLowerCase() === name.toLowerCase())) throw new Error('That bidder is on this tender already.');
  const qualifications = wordsOf(input.qualifications, TENDER_LIMITS.note, 'A note');
  const exclusions = wordsOf(input.exclusions, TENDER_LIMITS.note, 'A note');
  if ((input.lines?.length ?? 0) > TENDER_LIMITS.lines) throw new Error(`A bid keeps at most ${TENDER_LIMITS.lines} priced items.`);
  const seen = new Set<string>();
  const lines = (input.lines ?? []).map((line): TenderBidLine => {
    const item = wordsOf(line.item, TENDER_LIMITS.name, 'An item');
    if (!item) throw new Error('A priced item needs a name.');
    if (seen.has(itemKey(item))) throw new Error(`“${item}” is priced twice in this bid.`);
    seen.add(itemKey(item));
    return { id: newId('bdl'), item, amount: amountOf(line.amount, 'A price') };
  });
  return {
    name,
    ...(input.quoted !== undefined ? { quoted: amountOf(input.quoted, 'The amount quoted') } : {}),
    ...(input.revised !== undefined ? { revised: amountOf(input.revised, 'The revised amount') } : {}),
    ...(qualifications ? { qualifications } : {}),
    ...(exclusions ? { exclusions } : {}),
    ...(lines.length ? { lines } : {}),
  };
}

export function addTenderBidder(project: DdProject, tenderId: string, input: TenderBidderInput, actor: string): TenderBidder {
  const tender = tenderOf(project, tenderId);
  if (tender.bidders.length >= TENDER_LIMITS.bidders) throw new Error(`A tender keeps at most ${TENDER_LIMITS.bidders} bidders.`);
  const at = nowIso();
  const bidder: TenderBidder = { id: newId('bdr'), ...bidderFields(input, tender), addedAt: at, addedBy: actor, updatedAt: at, updatedBy: actor };
  tender.bidders = [...tender.bidders, bidder];
  touched(project, tender, actor);
  recordAuditEvent(project, { actor, action: 'add_tender_bidder', entityType: 'tender', entityId: tender.id, newValue: bidder.name });
  return bidder;
}

export function updateTenderBidder(project: DdProject, tenderId: string, bidderId: string, patch: TenderBidderPatch, actor: string): TenderBidder {
  const tender = tenderOf(project, tenderId);
  const at = tender.bidders.findIndex((bidder) => bidder.id === bidderId);
  const held = tender.bidders[at];
  if (!held) throw new Error('No bidder by that id.');
  if (tender.award?.bidderId === bidderId && (patch.name !== undefined || patch.quoted !== undefined || patch.revised !== undefined)) throw new Error('This bidder holds the letter of acceptance. Their name and figures stay as they were awarded.');
  const was: TenderBidderInput = {
    name: held.name,
    ...(held.quoted !== undefined ? { quoted: held.quoted } : {}),
    ...(held.revised !== undefined ? { revised: held.revised } : {}),
    ...(held.qualifications ? { qualifications: held.qualifications } : {}),
    ...(held.exclusions ? { exclusions: held.exclusions } : {}),
    ...(held.lines ? { lines: held.lines } : {}),
  };
  const merged = { ...was } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else if (value !== undefined) merged[key] = value;
  }
  const next: TenderBidder = { id: held.id, ...bidderFields(merged as unknown as TenderBidderInput, tender, held.id), addedAt: held.addedAt, addedBy: held.addedBy, updatedAt: nowIso(), updatedBy: actor };
  tender.bidders[at] = next;
  touched(project, tender, actor);
  const said = (bidder: TenderBidder): string => `${bidder.name}${bidder.quoted !== undefined ? `, quoted ${moneySaid(bidder.quoted, project.currency)}` : ''}${bidder.revised !== undefined ? `, revised ${moneySaid(bidder.revised, project.currency)}` : ''}`;
  recordAuditEvent(project, { actor, action: 'update_tender_bidder', entityType: 'tender', entityId: tender.id, oldValue: said(held), newValue: said(next) });
  return next;
}

/** Take a bidder off a tender. Refused for the one recommended or awarded to. */
export function removeTenderBidder(project: DdProject, tenderId: string, bidderId: string, actor: string): void {
  const tender = tenderOf(project, tenderId);
  const held = tender.bidders.find((bidder) => bidder.id === bidderId);
  if (!held) throw new Error('No bidder by that id.');
  if (tender.award?.bidderId === bidderId) throw new Error('This bidder holds the letter of acceptance.');
  if (tender.recommendation?.bidderId === bidderId) throw new Error('This bidder is the one recommended. Change the recommendation first.');
  tender.bidders = tender.bidders.filter((bidder) => bidder.id !== bidderId);
  touched(project, tender, actor);
  recordAuditEvent(project, { actor, action: 'remove_tender_bidder', entityType: 'tender', entityId: tender.id, oldValue: held.name });
}

/* ==================================================================== */
/* The recommendation, the letter of acceptance, and the offer to Finance */
/* ==================================================================== */

/** A person's recommendation, in their words and under their name. Written again, it replaces the one before, until there is a letter of acceptance. */
export function recommendTender(project: DdProject, tenderId: string, input: { bidderId: string; text: string }, actor: string): TenderRecommendation {
  const tender = tenderOf(project, tenderId);
  if (tender.award) throw new Error('This tender has a letter of acceptance. Its recommendation stays as it was.');
  const bidder = tender.bidders.find((held) => held.id === input.bidderId);
  if (!bidder) throw new Error('No bidder by that id.');
  const text = wordsOf(input.text, TENDER_LIMITS.text, 'A recommendation');
  if (!text) throw new Error('A recommendation says why, in a person’s words.');
  const was = tender.recommendation;
  tender.recommendation = { bidderId: bidder.id, text, by: actor, at: nowIso() };
  touched(project, tender, actor);
  recordAuditEvent(project, {
    actor,
    action: 'recommend_tender',
    entityType: 'tender',
    entityId: tender.id,
    ...(was ? { oldValue: tender.bidders.find((held) => held.id === was.bidderId)?.name ?? 'a bidder since removed' } : {}),
    newValue: bidder.name,
  });
  return tender.recommendation;
}

/**
 * Record the letter of acceptance: the bidder, the value and the day of the
 * letter.
 *
 * It marks the stage done, and offers the value to the package's row on the
 * Cost Report as PO issued. Nothing is written on the Cost Report here:
 * `acceptTenderOffer` does that, for Finance.
 */
export function recordLetterOfAcceptance(project: DdProject, tenderId: string, input: { bidderId: string; value: number; letterOn: string; evidenceId?: string }, actor: string, now = new Date()): Tender {
  const tender = tenderOf(project, tenderId);
  if (tender.award) throw new Error('This tender has a letter of acceptance already. Take it back to record another.');
  const bidder = tender.bidders.find((held) => held.id === input.bidderId);
  if (!bidder) throw new Error('No bidder by that id.');
  if (!tender.recommendation) throw new Error('Write the recommendation first.');
  const at = tender.stages.findIndex((stage) => stage.key === 'letter_of_acceptance');
  const before = tender.stages.slice(0, at);
  const open = before.find((stage) => !tenderStageSettled(stage));
  if (open) throw new Error(`${TENDER_STAGE_LABEL[open.key]} comes first: mark it done${TENDER_STAGES_OPTIONAL.includes(open.key) ? ' or not needed' : ''}.`);
  if (input.evidenceId && !project.evidence.some((row) => row.id === input.evidenceId)) throw new Error('The letter is not on this project. Upload it to the vault first.');
  const value = amountOf(input.value, 'The awarded value');
  const letterOn = doneDay(input.letterOn, before, TENDER_STAGE_LABEL.letter_of_acceptance, now);
  const stamp = nowIso();
  tender.award = { bidderId: bidder.id, value, letterOn, ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}), by: actor, at: stamp };
  tender.stages[at] = { ...tender.stages[at]!, doneOn: letterOn };
  tender.offer = { id: newId('tof'), workPackageId: tender.workPackageId, amount: value, status: 'offered', offeredAt: stamp, offeredBy: actor };
  touched(project, tender, actor);
  recordAuditEvent(project, { actor, action: 'record_letter_of_acceptance', entityType: 'tender', entityId: tender.id, newValue: `${bidder.name}, ${moneySaid(value, project.currency)}, letter of ${letterOn}; offered to Finance as PO issued` });
  return tender;
}

/** Take a letter of acceptance back, with the offer it made. Refused once Finance has accepted the offer, or the contract is signed. */
export function withdrawLetterOfAcceptance(project: DdProject, tenderId: string, actor: string): Tender {
  const tender = tenderOf(project, tenderId);
  if (!tender.award) throw new Error('This tender has no letter of acceptance.');
  if (tender.offer?.status === 'accepted') throw new Error('Finance has accepted the awarded value as PO issued. The letter stays on the record.');
  if (tender.stages.find((stage) => stage.key === 'contract_signed')?.doneOn) throw new Error('The contract is signed. The letter stays on the record.');
  const was = tender.award;
  delete tender.award;
  delete tender.offer;
  const at = tender.stages.findIndex((stage) => stage.key === 'letter_of_acceptance');
  const { doneOn: _doneOn, ...stage } = tender.stages[at]!;
  tender.stages[at] = stage;
  touched(project, tender, actor);
  recordAuditEvent(project, { actor, action: 'withdraw_letter_of_acceptance', entityType: 'tender', entityId: tender.id, oldValue: `${tender.bidders.find((held) => held.id === was.bidderId)?.name ?? 'a bidder'}, ${moneySaid(was.value, project.currency)}` });
  return tender;
}

/** An awarded value waiting on Finance, with what it would change. */
export interface TenderOfferWaiting {
  tender: Tender;
  offer: TenderOffer;
  packageName: string;
  bidderName: string;
  /** The draft Cost Report it would be written on, and the figure that row holds now. None: there is no draft holding the package. */
  onto?: { reportId: string; label: string; rowId: string; poIssued: number };
}

/** The newest draft Cost Report that has a row for a work package. */
function draftRowFor(project: Pick<DdProject, 'costReports'>, workPackageId: string): TenderOfferWaiting['onto'] {
  const drafts = [...costReportsOf(project)].filter((report) => report.status === 'draft').sort((a, b) => b.from.localeCompare(a.from) || b.createdAt.localeCompare(a.createdAt));
  for (const report of drafts) {
    const row = report.rows.find((held) => held.workPackageId === workPackageId);
    if (row) return { reportId: report.id, label: report.label, rowId: row.id, poIssued: row.poIssued };
  }
  return undefined;
}

/** The awarded values offered to Finance and not yet decided. */
export function tenderOffersWaiting(project: Pick<DdProject, 'procurement' | 'cost' | 'costReports'>): TenderOfferWaiting[] {
  return tendersOf(project).flatMap((tender) => {
    const offer = tender.offer;
    if (!offer || offer.status !== 'offered') return [];
    const onto = draftRowFor(project, offer.workPackageId);
    return [{ tender, offer, packageName: tenderPackageName(project, tender), bidderName: tender.bidders.find((bidder) => bidder.id === tender.award?.bidderId)?.name ?? '', ...(onto ? { onto } : {}) }];
  });
}

/**
 * Accept an awarded value as PO issued: it is written on the package's row of
 * the newest draft Cost Report, under the name of whoever accepted it.
 *
 * For a lead or a signer in Finance. The route asks that before it calls
 * this. Refused where no draft Cost Report holds the package: an issued
 * report is not written on.
 */
export function acceptTenderOffer(project: DdProject, tenderId: string, actor: string): TenderOffer {
  const tender = tenderOf(project, tenderId);
  const offer = tender.offer;
  if (!offer) throw new Error('This tender has offered nothing to Finance.');
  if (offer.status !== 'offered') throw new Error(`This offer was ${offer.status} already.`);
  const onto = draftRowFor(project, offer.workPackageId);
  if (!onto) throw new Error('No draft Cost Report holds this package. Start one, or reopen the latest, and accept it then.');
  updateCostReportRow(project, onto.reportId, onto.rowId, { poIssued: offer.amount }, actor);
  const at = nowIso();
  tender.offer = { ...offer, status: 'accepted', decidedAt: at, decidedBy: actor, reportId: onto.reportId };
  touched(project, tender, actor);
  recordAuditEvent(project, {
    actor,
    action: 'accept_tender_offer',
    entityType: 'tender',
    entityId: tender.id,
    oldValue: `PO issued ${moneySaid(onto.poIssued, project.currency)}`,
    newValue: `PO issued ${moneySaid(offer.amount, project.currency)} on ${onto.label}, from the letter of acceptance for ${tender.packageName}`,
  });
  return tender.offer;
}

/** Decline an awarded value, with the reason. The Cost Report is left as it is. */
export function declineTenderOffer(project: DdProject, tenderId: string, reason: string, actor: string): TenderOffer {
  const tender = tenderOf(project, tenderId);
  const offer = tender.offer;
  if (!offer) throw new Error('This tender has offered nothing to Finance.');
  if (offer.status !== 'offered') throw new Error(`This offer was ${offer.status} already.`);
  const why = wordsOf(reason, TENDER_LIMITS.note, 'A reason');
  if (!why) throw new Error('Say why it is declined.');
  tender.offer = { ...offer, status: 'declined', decidedAt: nowIso(), decidedBy: actor, reason: why };
  touched(project, tender, actor);
  recordAuditEvent(project, { actor, action: 'decline_tender_offer', entityType: 'tender', entityId: tender.id, reason: why, oldValue: moneySaid(offer.amount, project.currency) });
  return tender.offer;
}

/** Offer a declined value to Finance again, as it stands on the letter of acceptance. */
export function reofferTender(project: DdProject, tenderId: string, actor: string): TenderOffer {
  const tender = tenderOf(project, tenderId);
  if (!tender.award || !tender.offer) throw new Error('This tender has no letter of acceptance.');
  if (tender.offer.status !== 'declined') throw new Error('Only a declined offer is made again.');
  tender.offer = { id: newId('tof'), workPackageId: tender.workPackageId, amount: tender.award.value, status: 'offered', offeredAt: nowIso(), offeredBy: actor };
  touched(project, tender, actor);
  recordAuditEvent(project, { actor, action: 'reoffer_tender', entityType: 'tender', entityId: tender.id, newValue: moneySaid(tender.award.value, project.currency) });
  return tender.offer;
}

/* ==================================================================== */
/* Alerts                                                                */
/* ==================================================================== */

export interface TenderStagePastDue {
  key: string;
  department: DepartmentKey;
  workstream: string;
  severity: 'warning';
  title: string;
  detail: string;
  dueOn: string;
  /** Who the stage is with, as the record names them. */
  to?: string[];
}

/**
 * The stages past their date and not done, each as a condition worth an
 * alert.
 *
 * The key is the tender, the stage and its date, so the alert is raised once
 * for that date, cleared when the stage is done, gone without or given a
 * later date, and raised again only if the new date passes. It is
 * Procurement's: its lead hears of it, with the person the stage is with.
 */
export function tenderStagesPastDue(project: Pick<DdProject, 'procurement' | 'cost'>, now = new Date()): TenderStagePastDue[] {
  const today = todayOf(now);
  const out: TenderStagePastDue[] = [];
  for (const tender of tendersOf(project)) {
    for (const stage of tender.stages) {
      if (tenderStageSettled(stage) || stage.dueOn === undefined || stage.dueOn >= today) continue;
      out.push({
        key: `tender:${tender.id}:${stage.key}:due:${stage.dueOn}`,
        department: 'procurement',
        workstream: 'procurement.boq',
        severity: 'warning',
        title: `${tenderPackageName(project, tender)}: ${TENDER_STAGE_LABEL[stage.key].toLowerCase()} is past its date`,
        detail: `Due ${stage.dueOn}${stage.owner ? `, with ${stage.owner}` : ', with nobody named for it'}.`,
        dueOn: stage.dueOn,
        ...(stage.owner ? { to: [stage.owner] } : {}),
      });
    }
  }
  return out;
}
