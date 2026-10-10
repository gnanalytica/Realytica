/**
 * Finance › Budget: the monthly Cost Report.
 *
 * The Cost Report is the figure of record for cost monitoring in v1 — not the
 * RA-bill register. A period holds one row per work package: sanctioned
 * budget, PO issued (committed), amount paid, and anticipated cost. The two
 * executive sheets (Budget vs PO vs Paid, Budget vs Anticipated) and the
 * package ledger are the same rows, read different ways.
 *
 * Editing a draft updates those rows and keeps matching work packages on the
 * cost register so the graph and checks stay coherent. Issuing freezes the
 * period: print reads what stood then; further edits need a new draft or an
 * explicit reopen.
 */

import type { DdProject } from './types';
import { addWorkPackages, costRegister, moneySaid, updateWorkPackage } from './cost';
import { recordAuditEvent } from './operations';

export type CostReportStatus = 'draft' | 'issued';

/** One work package on a Cost Report: the four figures the exec sheets share. */
export interface CostReportPackageRow {
  id: string;
  /** The register package this row mirrors. Always set after the row is kept. */
  workPackageId: string;
  code?: string;
  name: string;
  budget: number;
  /** Purchase orders / contracts issued against the package. */
  poIssued: number;
  amountPaid: number;
  /** What the package is now expected to cost at completion. */
  anticipatedCost: number;
  note?: string;
}

/** Why the project cost moved: a variation drawn against contingency or the budget. */
export interface CostReportVariation {
  id: string;
  description: string;
  /** Signed amount: positive increases cost. */
  amount: number;
  workPackageId?: string;
  /** Drawn from contingency rather than a package budget. */
  contingencyDrawn?: boolean;
  /** Day the variation was agreed, YYYY-MM-DD. */
  dated?: string;
  note?: string;
}

/** A material or item whose tender rate and current rate differ. */
export interface CostReportBasicPrice {
  id: string;
  item: string;
  unit?: string;
  tenderRate: number;
  currentRate: number;
  quantity?: number;
  /** (current − tender) × quantity when quantity is set; otherwise left blank for the sheet. */
  amount?: number;
  note?: string;
}

export interface CostReportPeriod {
  id: string;
  /** "August 2026" — the month the report covers. */
  label: string;
  /** Inclusive calendar day YYYY-MM-DD. */
  from: string;
  /** Inclusive calendar day YYYY-MM-DD. */
  to: string;
  status: CostReportStatus;
  rows: CostReportPackageRow[];
  /** Cause of cost increment — variation log. */
  variations?: CostReportVariation[];
  /** Basic price adjustments (tender vs current rates). */
  basicPriceAdjustments?: CostReportBasicPrice[];
  /** Site / progress photographs on the vault to show with this report. */
  photoEvidenceIds?: string[];
  /** Plain callouts (contingency notes, etc.), not structured adjustments. */
  note?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  issuedAt?: string;
  issuedBy?: string;
}

export interface CostReportTotals {
  budget: number;
  poIssued: number;
  amountPaid: number;
  anticipatedCost: number;
  /** anticipated − budget; negative is under budget. */
  anticipatedVariance: number;
  /** poIssued − budget. */
  commitmentVariance: number;
  /** amountPaid as a share of poIssued, when anything is issued. */
  paidOfIssued?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function inPaise(amount: number): number {
  const paise = Math.round(Number((Math.abs(amount) * 100).toPrecision(15)));
  return amount < 0 && paise !== 0 ? -paise : paise;
}

const toThePaisa = (amount: number): number => inPaise(amount) / 100;
const sum = (amounts: readonly number[]): number => amounts.reduce((paise, amount) => paise + inPaise(amount), 0) / 100;

const AMOUNT_BELOW = 1e13;

function isAmount(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (Math.abs(value) >= AMOUNT_BELOW) {
    throw new Error('That figure is too large to be kept: an amount on this report is below 10,000,000,000,000.');
  }
  return true;
}

function moneyOrZero(value: unknown, label: string): number {
  if (value === undefined || value === null) return 0;
  if (!isAmount(value) || value < 0) throw new Error(`${label} is an amount of money, zero or more.`);
  return toThePaisa(value);
}

function isDay(value: unknown): value is string {
  const said = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!said) return false;
  const [year, month, day] = [Number(said[1]), Number(said[2]), Number(said[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** A calendar month as the Cost Report names it: "August 2026". */
export function costReportMonthLabel(from: string): string {
  if (!isDay(from)) throw new Error('The period needs a calendar day as its start.');
  const d = new Date(`${from}T12:00:00.000Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** First and last calendar day of the UTC month that contains `day`. */
export function costReportMonthBounds(day: string): { from: string; to: string } {
  if (!isDay(day)) throw new Error('Give a calendar day YYYY-MM-DD.');
  const d = new Date(`${day}T12:00:00.000Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

export function costReportsOf(project: Pick<DdProject, 'costReports'>): CostReportPeriod[] {
  return project.costReports ?? [];
}

function reportsOf(project: DdProject): CostReportPeriod[] {
  if (!project.costReports) project.costReports = [];
  return project.costReports;
}

export function costReportOf(project: Pick<DdProject, 'costReports'>, reportId: string): CostReportPeriod {
  const held = costReportsOf(project).find((r) => r.id === reportId);
  if (!held) throw new Error('No Cost Report by that id.');
  return held;
}

function assertDraft(report: CostReportPeriod): void {
  if (report.status === 'issued') {
    throw new Error('This Cost Report is issued. Reopen it before changing figures, or start a new period.');
  }
}

export function costReportTotals(report: Pick<CostReportPeriod, 'rows'>): CostReportTotals {
  const budget = sum(report.rows.map((r) => r.budget));
  const poIssued = sum(report.rows.map((r) => r.poIssued));
  const amountPaid = sum(report.rows.map((r) => r.amountPaid));
  const anticipatedCost = sum(report.rows.map((r) => r.anticipatedCost));
  return {
    budget,
    poIssued,
    amountPaid,
    anticipatedCost,
    anticipatedVariance: toThePaisa(anticipatedCost - budget),
    commitmentVariance: toThePaisa(poIssued - budget),
    ...(poIssued > 0 ? { paidOfIssued: amountPaid / poIssued } : {}),
  };
}

function mirrorPackage(
  project: DdProject,
  input: { workPackageId?: string; code?: string; name: string; budget: number },
  actor: string,
): { workPackageId: string; code?: string; name: string } {
  const name = input.name.trim();
  if (!name) throw new Error('A package needs a name.');
  const code = input.code?.trim() || undefined;
  const register = costRegister(project);
  if (input.workPackageId) {
    const held = register.workPackages.find((p) => p.id === input.workPackageId);
    if (!held) throw new Error('No work package by that id.');
    updateWorkPackage(
      project,
      held.id,
      {
        name,
        ...(code !== undefined ? { code: code || null } : {}),
        budget: input.budget,
      },
      actor,
    );
    const next = costRegister(project).workPackages.find((p) => p.id === held.id)!;
    return { workPackageId: next.id, ...(next.code ? { code: next.code } : {}), name: next.name };
  }
  const [added] = addWorkPackages(project, [{ name, ...(code ? { code } : {}), budget: input.budget }], actor);
  return { workPackageId: added!.id, ...(added!.code ? { code: added!.code } : {}), name: added!.name };
}

function rowFields(
  project: DdProject,
  input: {
    workPackageId?: string;
    code?: string;
    name: string;
    budget?: number;
    poIssued?: number;
    amountPaid?: number;
    anticipatedCost?: number;
    note?: string | null;
  },
  actor: string,
  held?: CostReportPackageRow,
): Omit<CostReportPackageRow, 'id'> {
  const budget = moneyOrZero(input.budget ?? held?.budget ?? 0, 'Budget');
  const poIssued = moneyOrZero(input.poIssued ?? held?.poIssued ?? 0, 'PO issued');
  const amountPaid = moneyOrZero(input.amountPaid ?? held?.amountPaid ?? 0, 'Amount paid');
  const anticipatedCost = moneyOrZero(input.anticipatedCost ?? held?.anticipatedCost ?? budget, 'Anticipated cost');
  const name = (input.name ?? held?.name ?? '').trim();
  if (!name) throw new Error('A package needs a name.');
  const mirrored = mirrorPackage(
    project,
    {
      workPackageId: input.workPackageId ?? held?.workPackageId,
      code: input.code !== undefined ? input.code : held?.code,
      name,
      budget,
    },
    actor,
  );
  const note = input.note === null ? undefined : input.note !== undefined ? input.note.trim() || undefined : held?.note;
  return {
    ...mirrored,
    budget,
    poIssued,
    amountPaid,
    anticipatedCost,
    ...(note ? { note } : {}),
  };
}

export interface StartCostReportInput {
  /** Any day in the month; the report covers that whole month. */
  month?: string;
  from?: string;
  to?: string;
  label?: string;
  note?: string;
  /** Seed rows from the cost register's work packages. Default true. */
  seedPackages?: boolean;
}

/** Open a draft Cost Report for a month. */
export function startCostReport(project: DdProject, input: StartCostReportInput, actor: string): CostReportPeriod {
  let from: string;
  let to: string;
  if (input.from && input.to) {
    if (!isDay(input.from) || !isDay(input.to)) throw new Error('The period needs calendar days YYYY-MM-DD.');
    if (input.from > input.to) throw new Error('The period ends on or after the day it starts.');
    from = input.from;
    to = input.to;
  } else {
    const bounds = costReportMonthBounds(input.month ?? new Date().toISOString().slice(0, 10));
    from = bounds.from;
    to = bounds.to;
  }
  const label = input.label?.trim() || costReportMonthLabel(from);
  const at = nowIso();
  const rows: CostReportPackageRow[] = [];
  if (input.seedPackages !== false) {
    for (const pack of costRegister(project).workPackages) {
      const budget = pack.budget ?? 0;
      rows.push({
        id: newId('crp'),
        workPackageId: pack.id,
        ...(pack.code ? { code: pack.code } : {}),
        name: pack.name,
        budget,
        poIssued: 0,
        amountPaid: 0,
        anticipatedCost: budget,
      });
    }
  }
  const note = input.note?.trim();
  const report: CostReportPeriod = {
    id: newId('crep'),
    label,
    from,
    to,
    status: 'draft',
    rows,
    ...(note ? { note } : {}),
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
    updatedBy: actor,
  };
  reportsOf(project).push(report);
  recordAuditEvent(project, {
    actor,
    action: 'start_cost_report',
    entityType: 'cost_report',
    entityId: report.id,
    newValue: report.label,
  });
  return report;
}

export type CostReportRowInput = {
  workPackageId?: string;
  code?: string;
  name: string;
  budget?: number;
  poIssued?: number;
  amountPaid?: number;
  anticipatedCost?: number;
  note?: string | null;
};

export function addCostReportPackage(project: DdProject, reportId: string, input: CostReportRowInput, actor: string): CostReportPackageRow {
  const report = costReportOf(project, reportId);
  assertDraft(report);
  const row: CostReportPackageRow = { id: newId('crp'), ...rowFields(project, input, actor) };
  if (report.rows.some((r) => r.workPackageId === row.workPackageId)) {
    throw new Error('That work package is already on this Cost Report.');
  }
  report.rows = [...report.rows, row];
  report.updatedAt = nowIso();
  report.updatedBy = actor;
  recordAuditEvent(project, {
    actor,
    action: 'add_cost_report_package',
    entityType: 'cost_report',
    entityId: report.id,
    newValue: row.name,
  });
  return row;
}

export type CostReportRowPatch = {
  [K in keyof CostReportRowInput]?: CostReportRowInput[K] | null;
};

export function updateCostReportRow(
  project: DdProject,
  reportId: string,
  rowId: string,
  patch: CostReportRowPatch,
  actor: string,
): CostReportPackageRow {
  const report = costReportOf(project, reportId);
  assertDraft(report);
  const at = report.rows.findIndex((r) => r.id === rowId);
  const held = report.rows[at];
  if (!held) throw new Error('No package row by that id.');
  const nextInput: CostReportRowInput = {
    workPackageId: held.workPackageId,
    name: patch.name === null ? held.name : (patch.name ?? held.name),
    code: patch.code === null ? undefined : patch.code !== undefined ? patch.code : held.code,
    budget: patch.budget === null ? 0 : patch.budget !== undefined ? patch.budget : held.budget,
    poIssued: patch.poIssued === null ? 0 : patch.poIssued !== undefined ? patch.poIssued : held.poIssued,
    amountPaid: patch.amountPaid === null ? 0 : patch.amountPaid !== undefined ? patch.amountPaid : held.amountPaid,
    anticipatedCost:
      patch.anticipatedCost === null ? 0 : patch.anticipatedCost !== undefined ? patch.anticipatedCost : held.anticipatedCost,
    note: patch.note === null ? null : patch.note !== undefined ? patch.note : held.note,
  };
  const next: CostReportPackageRow = { id: held.id, ...rowFields(project, nextInput, actor, held) };
  report.rows[at] = next;
  report.updatedAt = nowIso();
  report.updatedBy = actor;
  recordAuditEvent(project, {
    actor,
    action: 'update_cost_report_row',
    entityType: 'cost_report',
    entityId: report.id,
    oldValue: `${held.name}: budget ${moneySaid(held.budget, project.currency)}`,
    newValue: `${next.name}: budget ${moneySaid(next.budget, project.currency)}`,
  });
  return next;
}

export function removeCostReportPackage(project: DdProject, reportId: string, rowId: string, actor: string): void {
  const report = costReportOf(project, reportId);
  assertDraft(report);
  const held = report.rows.find((r) => r.id === rowId);
  if (!held) throw new Error('No package row by that id.');
  report.rows = report.rows.filter((r) => r.id !== rowId);
  report.updatedAt = nowIso();
  report.updatedBy = actor;
  recordAuditEvent(project, {
    actor,
    action: 'remove_cost_report_package',
    entityType: 'cost_report',
    entityId: report.id,
    oldValue: held.name,
  });
}

export function setCostReportNote(project: DdProject, reportId: string, note: string | null, actor: string): CostReportPeriod {
  const report = costReportOf(project, reportId);
  assertDraft(report);
  const trimmed = note?.trim();
  if (trimmed) report.note = trimmed;
  else delete report.note;
  report.updatedAt = nowIso();
  report.updatedBy = actor;
  return report;
}

/** Freeze the period for print. Further figure edits are refused until reopened. */
export function issueCostReport(project: DdProject, reportId: string, actor: string): CostReportPeriod {
  const report = costReportOf(project, reportId);
  if (report.status === 'issued') throw new Error('This Cost Report is already issued.');
  if (!report.rows.length) throw new Error('Add at least one package before issuing the Cost Report.');
  const at = nowIso();
  report.status = 'issued';
  report.issuedAt = at;
  report.issuedBy = actor;
  report.updatedAt = at;
  report.updatedBy = actor;
  // Freeze deep copies so later edits do not rewrite the issued figures.
  report.rows = report.rows.map((r) => ({ ...r }));
  if (report.variations) report.variations = report.variations.map((v) => ({ ...v }));
  if (report.basicPriceAdjustments) report.basicPriceAdjustments = report.basicPriceAdjustments.map((v) => ({ ...v }));
  if (report.photoEvidenceIds) report.photoEvidenceIds = [...report.photoEvidenceIds];
  recordAuditEvent(project, {
    actor,
    action: 'issue_cost_report',
    entityType: 'cost_report',
    entityId: report.id,
    newValue: report.label,
  });
  return report;
}

/** Return an issued report to draft so figures can change again. */
export function reopenCostReport(project: DdProject, reportId: string, actor: string): CostReportPeriod {
  const report = costReportOf(project, reportId);
  if (report.status !== 'issued') throw new Error('Only an issued Cost Report can be reopened.');
  report.status = 'draft';
  delete report.issuedAt;
  delete report.issuedBy;
  report.updatedAt = nowIso();
  report.updatedBy = actor;
  recordAuditEvent(project, {
    actor,
    action: 'reopen_cost_report',
    entityType: 'cost_report',
    entityId: report.id,
    newValue: report.label,
  });
  return report;
}


function touchReport(report: CostReportPeriod, actor: string): void {
  report.updatedAt = nowIso();
  report.updatedBy = actor;
}

function signedMoney(value: unknown, label: string): number {
  if (!isAmount(value)) throw new Error(`${label} is an amount of money.`);
  return toThePaisa(value);
}

export interface CostReportVariationInput {
  description: string;
  amount: number;
  workPackageId?: string | null;
  contingencyDrawn?: boolean;
  dated?: string | null;
  note?: string | null;
}

function variationFields(project: DdProject, input: CostReportVariationInput, held?: CostReportVariation): Omit<CostReportVariation, 'id'> {
  const description = input.description?.trim();
  if (!description) throw new Error('A variation needs a description.');
  const amount = signedMoney(input.amount, 'Variation amount');
  const workPackageId =
    input.workPackageId === null ? undefined : input.workPackageId !== undefined ? input.workPackageId : held?.workPackageId;
  if (workPackageId && !costRegister(project).workPackages.some((p) => p.id === workPackageId)) {
    throw new Error('No work package by that id.');
  }
  const dated = input.dated === null ? undefined : input.dated !== undefined ? input.dated : held?.dated;
  if (dated !== undefined && !isDay(dated)) throw new Error('A variation date is a calendar day YYYY-MM-DD.');
  const note = input.note === null ? undefined : input.note !== undefined ? input.note.trim() || undefined : held?.note;
  const contingencyDrawn =
    input.contingencyDrawn !== undefined ? Boolean(input.contingencyDrawn) : held?.contingencyDrawn;
  return {
    description,
    amount,
    ...(workPackageId ? { workPackageId } : {}),
    ...(contingencyDrawn ? { contingencyDrawn: true } : {}),
    ...(dated ? { dated } : {}),
    ...(note ? { note } : {}),
  };
}

export function addCostReportVariation(
  project: DdProject,
  reportId: string,
  input: CostReportVariationInput,
  actor: string,
): CostReportVariation {
  const report = costReportOf(project, reportId);
  assertDraft(report);
  const row: CostReportVariation = { id: newId('crv'), ...variationFields(project, input) };
  report.variations = [...(report.variations ?? []), row];
  touchReport(report, actor);
  recordAuditEvent(project, {
    actor,
    action: 'add_cost_report_variation',
    entityType: 'cost_report',
    entityId: report.id,
    newValue: `${row.description}: ${moneySaid(row.amount, project.currency)}`,
  });
  return row;
}

export function updateCostReportVariation(
  project: DdProject,
  reportId: string,
  variationId: string,
  patch: { [K in keyof CostReportVariationInput]?: CostReportVariationInput[K] | null },
  actor: string,
): CostReportVariation {
  const report = costReportOf(project, reportId);
  assertDraft(report);
  const at = (report.variations ?? []).findIndex((v) => v.id === variationId);
  const held = report.variations?.[at];
  if (!held) throw new Error('No variation by that id.');
  const next: CostReportVariation = {
    id: held.id,
    ...variationFields(
      project,
      {
        description: patch.description === null ? held.description : (patch.description ?? held.description),
        amount: patch.amount === null ? held.amount : (patch.amount ?? held.amount),
        workPackageId: patch.workPackageId === null ? null : patch.workPackageId !== undefined ? patch.workPackageId : held.workPackageId,
        contingencyDrawn: patch.contingencyDrawn === null ? false : patch.contingencyDrawn ?? held.contingencyDrawn,
        dated: patch.dated === null ? null : patch.dated !== undefined ? patch.dated : held.dated,
        note: patch.note === null ? null : patch.note !== undefined ? patch.note : held.note,
      },
      held,
    ),
  };
  report.variations![at] = next;
  touchReport(report, actor);
  return next;
}

export function removeCostReportVariation(project: DdProject, reportId: string, variationId: string, actor: string): void {
  const report = costReportOf(project, reportId);
  assertDraft(report);
  const held = (report.variations ?? []).find((v) => v.id === variationId);
  if (!held) throw new Error('No variation by that id.');
  report.variations = (report.variations ?? []).filter((v) => v.id !== variationId);
  touchReport(report, actor);
  recordAuditEvent(project, {
    actor,
    action: 'remove_cost_report_variation',
    entityType: 'cost_report',
    entityId: report.id,
    oldValue: held.description,
  });
}

export interface CostReportBasicPriceInput {
  item: string;
  unit?: string | null;
  tenderRate: number;
  currentRate: number;
  quantity?: number | null;
  note?: string | null;
}

function basicPriceFields(input: CostReportBasicPriceInput, held?: CostReportBasicPrice): Omit<CostReportBasicPrice, 'id'> {
  const item = input.item?.trim();
  if (!item) throw new Error('A basic price line needs an item name.');
  const tenderRate = moneyOrZero(input.tenderRate, 'Tender rate');
  const currentRate = moneyOrZero(input.currentRate, 'Current rate');
  const unit = input.unit === null ? undefined : input.unit !== undefined ? input.unit.trim() || undefined : held?.unit;
  const quantity =
    input.quantity === null
      ? undefined
      : input.quantity !== undefined
        ? (() => {
            if (!isAmount(input.quantity) || input.quantity < 0) throw new Error('Quantity is zero or more.');
            return input.quantity;
          })()
        : held?.quantity;
  const amount = quantity !== undefined ? toThePaisa((currentRate - tenderRate) * quantity) : undefined;
  const note = input.note === null ? undefined : input.note !== undefined ? input.note.trim() || undefined : held?.note;
  return {
    item,
    tenderRate,
    currentRate,
    ...(unit ? { unit } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(note ? { note } : {}),
  };
}

export function addCostReportBasicPrice(
  project: DdProject,
  reportId: string,
  input: CostReportBasicPriceInput,
  actor: string,
): CostReportBasicPrice {
  const report = costReportOf(project, reportId);
  assertDraft(report);
  const row: CostReportBasicPrice = { id: newId('crb'), ...basicPriceFields(input) };
  report.basicPriceAdjustments = [...(report.basicPriceAdjustments ?? []), row];
  touchReport(report, actor);
  recordAuditEvent(project, {
    actor,
    action: 'add_cost_report_basic_price',
    entityType: 'cost_report',
    entityId: report.id,
    newValue: row.item,
  });
  return row;
}

export function updateCostReportBasicPrice(
  project: DdProject,
  reportId: string,
  lineId: string,
  patch: { [K in keyof CostReportBasicPriceInput]?: CostReportBasicPriceInput[K] | null },
  actor: string,
): CostReportBasicPrice {
  const report = costReportOf(project, reportId);
  assertDraft(report);
  const at = (report.basicPriceAdjustments ?? []).findIndex((v) => v.id === lineId);
  const held = report.basicPriceAdjustments?.[at];
  if (!held) throw new Error('No basic price line by that id.');
  const next: CostReportBasicPrice = {
    id: held.id,
    ...basicPriceFields(
      {
        item: patch.item === null ? held.item : (patch.item ?? held.item),
        unit: patch.unit === null ? null : patch.unit !== undefined ? patch.unit : held.unit,
        tenderRate: patch.tenderRate === null ? held.tenderRate : (patch.tenderRate ?? held.tenderRate),
        currentRate: patch.currentRate === null ? held.currentRate : (patch.currentRate ?? held.currentRate),
        quantity: patch.quantity === null ? null : patch.quantity !== undefined ? patch.quantity : held.quantity,
        note: patch.note === null ? null : patch.note !== undefined ? patch.note : held.note,
      },
      held,
    ),
  };
  report.basicPriceAdjustments![at] = next;
  touchReport(report, actor);
  return next;
}

export function removeCostReportBasicPrice(project: DdProject, reportId: string, lineId: string, actor: string): void {
  const report = costReportOf(project, reportId);
  assertDraft(report);
  const held = (report.basicPriceAdjustments ?? []).find((v) => v.id === lineId);
  if (!held) throw new Error('No basic price line by that id.');
  report.basicPriceAdjustments = (report.basicPriceAdjustments ?? []).filter((v) => v.id !== lineId);
  touchReport(report, actor);
}

/** Pin progress photographs (vault evidence ids) onto this Cost Report. */
export function setCostReportPhotos(project: DdProject, reportId: string, evidenceIds: readonly string[], actor: string): CostReportPeriod {
  const report = costReportOf(project, reportId);
  assertDraft(report);
  const unique = [...new Set(evidenceIds.map((id) => id.trim()).filter(Boolean))];
  for (const id of unique) {
    if (!(project.evidence ?? []).some((e) => e.id === id && e.attachments.length)) {
      throw new Error('Every photograph on the Cost Report must be a document already on the vault.');
    }
  }
  if (unique.length) report.photoEvidenceIds = unique;
  else delete report.photoEvidenceIds;
  touchReport(report, actor);
  recordAuditEvent(project, {
    actor,
    action: 'set_cost_report_photos',
    entityType: 'cost_report',
    entityId: report.id,
    newValue: `${unique.length} photograph${unique.length === 1 ? '' : 's'}`,
  });
  return report;
}

export interface CostReportImportRow {
  code?: string;
  name: string;
  budget?: number;
  poIssued?: number;
  amountPaid?: number;
  anticipatedCost?: number;
}

/**
 * Read a Cost Report ledger from tabular text (CSV / TSV / pasted sheet).
 * Looks for a header row naming Package (or Name), Budget, PO / Committed,
 * Paid, and Anticipated (aliases accepted).
 */
export function parseCostReportTable(text: string): CostReportImportRow[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  if (!lines.length) throw new Error('That file has no rows.');
  const delim = lines[0]!.includes('\t') ? '\t' : ',';
  const split = (line: string): string[] => {
    if (delim === '\t') return line.split('\t').map((c) => c.trim());
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else q = !q;
      } else if (ch === ',' && !q) {
        cells.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };
  const rows = lines.map(split);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const header = rows[0]!.map(norm);
  const find = (...aliases: string[]) => {
    for (const a of aliases) {
      const i = header.indexOf(norm(a));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iName = find('package', 'name', 'workpackage', 'description');
  const iCode = find('code', 'ref', 'item');
  const iBudget = find('budget', 'approved', 'sanctioned');
  const iPo = find('poissued', 'po', 'committed', 'commitment', 'orders');
  const iPaid = find('amountpaid', 'paid', 'payment');
  const iAnt = find('anticipated', 'anticipatedcost', 'forecast', 'eac');
  if (iName < 0) throw new Error('The sheet needs a Package or Name column.');
  if (iBudget < 0 && iPo < 0 && iPaid < 0 && iAnt < 0) {
    throw new Error('The sheet needs at least one money column: Budget, PO issued, Paid or Anticipated.');
  }
  const money = (raw: string | undefined): number | undefined => {
    if (raw === undefined || !raw.trim()) return undefined;
    const n = Number(raw.replace(/[,₹$€\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
    if (!Number.isFinite(n)) throw new Error(`“${raw}” is not an amount.`);
    return n;
  };
  const out: CostReportImportRow[] = [];
  for (const cells of rows.slice(1)) {
    const name = (cells[iName] ?? '').trim();
    if (!name) continue;
    const code = iCode >= 0 ? (cells[iCode] ?? '').trim() || undefined : undefined;
    const budget = iBudget >= 0 ? money(cells[iBudget]) : undefined;
    const poIssued = iPo >= 0 ? money(cells[iPo]) : undefined;
    const amountPaid = iPaid >= 0 ? money(cells[iPaid]) : undefined;
    const anticipatedCost = iAnt >= 0 ? money(cells[iAnt]) : undefined;
    out.push({
      name,
      ...(code ? { code } : {}),
      ...(budget !== undefined ? { budget } : {}),
      ...(poIssued !== undefined ? { poIssued } : {}),
      ...(amountPaid !== undefined ? { amountPaid } : {}),
      ...(anticipatedCost !== undefined ? { anticipatedCost } : {}),
    });
  }
  if (!out.length) throw new Error('No package rows found under that header.');
  return out;
}

/** Apply imported ledger rows onto a draft Cost Report (add or update by name/code). */
export function importCostReportRows(
  project: DdProject,
  reportId: string,
  rows: ReadonlyArray<CostReportImportRow>,
  actor: string,
): { added: number; updated: number } {
  const report = costReportOf(project, reportId);
  assertDraft(report);
  let added = 0;
  let updated = 0;
  for (const row of rows) {
    const match = report.rows.find(
      (r) =>
        (row.code && r.code && r.code.toLowerCase() === row.code.toLowerCase()) ||
        r.name.trim().toLowerCase() === row.name.trim().toLowerCase(),
    );
    if (match) {
      updateCostReportRow(
        project,
        reportId,
        match.id,
        {
          ...(row.code !== undefined ? { code: row.code } : {}),
          name: row.name,
          ...(row.budget !== undefined ? { budget: row.budget } : {}),
          ...(row.poIssued !== undefined ? { poIssued: row.poIssued } : {}),
          ...(row.amountPaid !== undefined ? { amountPaid: row.amountPaid } : {}),
          ...(row.anticipatedCost !== undefined ? { anticipatedCost: row.anticipatedCost } : {}),
        },
        actor,
      );
      updated += 1;
    } else {
      addCostReportPackage(
        project,
        reportId,
        {
          name: row.name,
          ...(row.code ? { code: row.code } : {}),
          budget: row.budget ?? 0,
          poIssued: row.poIssued ?? 0,
          amountPaid: row.amountPaid ?? 0,
          anticipatedCost: row.anticipatedCost ?? row.budget ?? 0,
        },
        actor,
      );
      added += 1;
    }
  }
  recordAuditEvent(project, {
    actor,
    action: 'import_cost_report_rows',
    entityType: 'cost_report',
    entityId: reportId,
    newValue: `${added} added, ${updated} updated`,
  });
  return { added, updated };
}
