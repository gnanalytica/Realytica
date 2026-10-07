/**
 * Finance › Budget: the cost register.
 *
 * What a cost consultant keeps to certify a contractor's bills. The budget is
 * split into work packages. Work is awarded under contracts, each covering
 * some of them. A contractor submits a running bill for a period: lines that
 * say, item by item, the quantity and the amount to date, what was billed
 * before, and what this bill claims. The certifier decides each line, as
 * claimed or adjusted with the reason, and then issues a certificate for the
 * bill: the gross certified, the deductions, and what is payable. The owner
 * pays against the certificate.
 *
 * Five things the register holds to.
 *
 * A line says where it was read. A figure a person typed, one read exactly
 * off a spreadsheet's cell and one a model read off a page are not equally
 * sure, so every line carries which it was. A line a model read is not kept
 * without its page, nor one read off a sheet without its sheet and cell.
 *
 * A certificate stands until it is withdrawn. While one stands on a bill its
 * lines are fixed: they are not replaced, changed or decided again, because
 * the certificate's figures are sums of theirs. Withdrawing it leaves it on
 * the bill, marked, and opens the lines again.
 *
 * What is certified counts only under a certificate that stands. What was
 * passed for a line is one line decided, and no more than that. It reaches a
 * package's and a contract's position when the bill's certificate is issued,
 * and leaves them when that certificate is withdrawn.
 *
 * Money is kept to the paisa. Every amount is brought to it on the way in and
 * sums are added in whole paise, so a total never ends in a stray fraction.
 * It is in the project's own currency, and is written in it.
 *
 * What was entered wrongly is taken back in the open. A payment is voided
 * and stays on the bill, marked. A bill or a contract is removed only while
 * nothing has been decided, certified or paid under it.
 *
 * Finance holds the budget and the contract values for now. Every record has
 * an id of its own, so a package or a contract can be joined to Procurement's
 * tender and order once that department keeps them.
 */

import type { DdProject } from './types';
import { recordAuditEvent } from './operations';
import { plural } from './text';

/* ==================================================================== */
/* What is kept                                                          */
/* ==================================================================== */

/** Where a figure was read: the paper, and the page of it or the sheet and the cell. */
export interface CostSource {
  /** The paper, on the document vault. */
  evidenceId: string;
  /** The 1-based page, on a paper that has pages. */
  page?: number;
  /** The sheet and the cell, on a spreadsheet. */
  sheet?: string;
  cell?: string;
  /** The words or the figure as the paper has them. */
  quote?: string;
}

/** A planned piece of the budget: what is to be spent on one part of the work. */
export interface WorkPackage {
  id: string;
  /** The project's own short name for it: "B2", "4.1". */
  code?: string;
  name: string;
  /** In the project's currency. Absent: no budget has been set for it. */
  budget?: number;
  source?: CostSource;
  /** The site progress milestone its work is measured against. */
  milestoneId?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

/** An award of work to a contractor, for a value, covering some of the work packages. */
export interface CostContract {
  id: string;
  contractor: string;
  title: string;
  /** The work order or agreement number, as its paper states it. */
  reference?: string;
  workPackageIds: string[];
  /** In the project's currency. */
  value: number;
  /** The share of each certified amount held back until the work is complete, 0..100. */
  retentionPercent?: number;
  source?: CostSource;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface BillLine {
  id: string;
  /** The item number as the bill has it. Empty where the bill gives none. */
  item: string;
  description: string;
  workPackageId?: string;
  unit?: string;
  rate?: number;
  quantityToDate?: number;
  amountToDate?: number;
  previousAmount?: number;
  /** What this bill claims for the line. Less than nothing on a credit. */
  amount: number;
  /** Outside the original contract. */
  variation?: boolean;
  /** The project's own columns, by their keys. */
  extra?: Record<string, string | number>;
  /** Where it was read. A line a model read has its page, and one read off a sheet its sheet and cell. */
  source?: CostSource;
  /** Who read it: a person typed it, a spreadsheet's cell was read exactly, or a model read a page. */
  readBy: 'person' | 'sheet' | 'model';
  /**
   * What the certifier passed for this line. Absent: nobody has decided it.
   * It is a decision until the bill's certificate is issued, and counts as
   * certified only while that certificate stands (`billLineStatus`).
   */
  certified?: { amount: number; quantity?: number; note?: string; by: string; at: string };
}

/** An amount the owner paid against a bill. */
export interface CostPayment {
  id: string;
  amount: number;
  paidOn: string;
  /** The bank's or the ledger's own reference for it. No two payments standing on a bill share one. */
  reference?: string;
  source?: CostSource;
  recordedAt: string;
  recordedBy: string;
  /** Set when the payment was entered wrongly. It stays on the bill, marked, and is left out of every sum. */
  voided?: { by: string; at: string; reason: string };
}

export type CostDeductionKind = 'retention' | 'advance_recovery' | 'tax' | 'penalty' | 'other';

export const COST_DEDUCTION_LABEL: Record<CostDeductionKind, string> = {
  retention: 'Retention',
  advance_recovery: 'Advance recovery',
  tax: 'Tax',
  penalty: 'Penalty',
  other: 'Other deduction',
};

/** An amount taken off what is certified. `label` is the certificate's own word for it: "TDS 2%". */
export interface CostDeduction {
  kind: CostDeductionKind;
  label?: string;
  amount: number;
}

/** Who signs a certificate: a Finance signer, by the address they sign in with, and their profession. */
export interface CostSigner {
  email: string;
  name?: string;
  /** "Quantity Surveyor", "Chartered Accountant". */
  profession: string;
  /** Their council or institute registration number. */
  registration?: string;
}

/** A certificate issued on a bill: what was passed, what was taken off, and what is payable. */
export interface BillCertification {
  id: string;
  /** The sum of what was passed on the bill's lines. Never less than nothing. */
  gross: number;
  deductions: CostDeduction[];
  /** Gross less the deductions: what the owner pays. */
  net: number;
  signer: CostSigner;
  certifiedOn: string;
  note?: string;
  /** The signed certificate, on the document vault. */
  evidenceId?: string;
  createdAt: string;
  createdBy: string;
  /** Set when the bill was reopened after this was issued. A withdrawn certificate certifies nothing. */
  withdrawn?: { by: string; at: string; reason?: string };
}

/** A contractor's running bill for one period, as it was submitted. */
export interface CostBill {
  id: string;
  contractId: string;
  /** The bill's own number: "RA-3". One contract has no two bills of the same number. */
  number: string;
  date: string;
  periodFrom?: string;
  periodTo?: string;
  /** The total the bill states, to hold against the sum of its lines. */
  statedTotal?: number;
  /** The bill itself, on the document vault. */
  evidenceId?: string;
  lines: BillLine[];
  payments: CostPayment[];
  /** Every certificate issued on it, oldest first. At most one stands; the rest are withdrawn. */
  certifications: BillCertification[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/** A column of a bill beyond the core ones, defined once for the project. */
export interface CostExtraColumn {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'money';
}

export interface CostRegister {
  workPackages: WorkPackage[];
  contracts: CostContract[];
  bills: CostBill[];
  extraColumns?: CostExtraColumn[];
  /** What the whole job is now expected to cost, as the cost consultant last put it. */
  forecast?: { finalCost: number; note?: string; by: string; at: string };
}

export type BillCoreColumn = 'item' | 'description' | 'unit' | 'rate' | 'quantityToDate' | 'amountToDate' | 'previousAmount' | 'amount';

/**
 * The columns every bill line has, by the field that holds each, with the
 * heading it is shown under. Each contractor words these headings their own
 * way, and a bill is read by saying which of its columns is which of these.
 */
export const BILL_CORE_COLUMNS: ReadonlyArray<{ key: BillCoreColumn; label: string; kind: CostExtraColumn['kind'] }> = [
  { key: 'item', label: 'Item', kind: 'text' },
  { key: 'description', label: 'Description', kind: 'text' },
  { key: 'unit', label: 'Unit', kind: 'text' },
  { key: 'rate', label: 'Rate', kind: 'money' },
  { key: 'quantityToDate', label: 'Quantity to date', kind: 'number' },
  { key: 'amountToDate', label: 'Amount to date', kind: 'money' },
  { key: 'previousAmount', label: 'Previous amount', kind: 'money' },
  { key: 'amount', label: 'This bill', kind: 'money' },
];

const COLUMN_KINDS: ReadonlyArray<CostExtraColumn['kind']> = ['text', 'number', 'money'];
const READ_BY: ReadonlyArray<BillLine['readBy']> = ['person', 'sheet', 'model'];
const DEDUCTION_KINDS = Object.keys(COST_DEDUCTION_LABEL) as CostDeductionKind[];

/* ==================================================================== */
/* Money, to the paisa                                                   */
/* ==================================================================== */

type Currency = DdProject['currency'];

/**
 * An amount in whole paise, or a euro's cents.
 *
 * Half a paisa goes away from zero, as a person rounds it. The figure is read
 * as the decimal it was written as: 1.005 is a hundred and a half paise, not
 * the 100.49999999999999 the machine holds for it.
 */
function inPaise(amount: number): number {
  const paise = Math.round(Number((Math.abs(amount) * 100).toPrecision(15)));
  return amount < 0 && paise !== 0 ? -paise : paise;
}

/** An amount brought to the paisa, as every amount is on its way in. */
const toThePaisa = (amount: number): number => inPaise(amount) / 100;
/** Some amounts added, in whole paise: a sum of them cannot drift by a fraction of one. */
const sum = (amounts: readonly number[]): number => amounts.reduce((paise, amount) => paise + inPaise(amount), 0) / 100;
/** One amount less another, in whole paise. */
const less = (amount: number, taken: number): number => (inPaise(amount) - inPaise(taken)) / 100;

const MONEY: Record<Currency, { sign: string; locale: string }> = {
  INR: { sign: '₹', locale: 'en-IN' },
  EUR: { sign: '€', locale: 'en-IE' },
};

/**
 * An amount of money as a person writes it, in the currency it is in: rupees
 * grouped the Indian way, euros in thousands, and the paise or cents only
 * where there are any. Less than nothing has its minus before the sign.
 */
export function moneySaid(amount: number, currency: Currency = 'INR'): string {
  const { sign, locale } = MONEY[currency] ?? MONEY.INR;
  const paise = Math.abs(inPaise(amount));
  const digits = (paise / 100).toLocaleString(locale, { minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  return `${amount < 0 && paise !== 0 ? '−' : ''}${sign}${digits}`;
}

/** Where a figure was read, in words: the page, or the sheet and the cell. */
export function costSourceSaid(source: Pick<CostSource, 'page' | 'sheet' | 'cell'>): string {
  return [source.page !== undefined ? `p. ${source.page}` : '', source.sheet ? `sheet “${source.sheet}”` : '', source.cell ? `cell ${source.cell}` : ''].filter(Boolean).join(', ');
}

/* ==================================================================== */
/* Reading                                                               */
/* ==================================================================== */

/** The project's cost register, or an empty one. The project is not changed. */
export function costRegister(project: Pick<DdProject, 'cost'>): CostRegister {
  return project.cost ?? { workPackages: [], contracts: [], bills: [] };
}

/** The certificate that stands on a bill: the one issued and not withdrawn. */
export function standingCertification(bill: CostBill): BillCertification | undefined {
  return bill.certifications.find((certificate) => !certificate.withdrawn);
}

/** The payments that stand on a bill: every one recorded and not voided. */
function standingPayments(bill: CostBill): CostPayment[] {
  return bill.payments.filter((payment) => !payment.voided);
}

/** The register to write to: the project's own, begun the first time something is kept on it. */
function registerOf(project: DdProject): CostRegister {
  if (!project.cost) project.cost = { workPackages: [], contracts: [], bills: [] };
  return project.cost;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Two random parts, not one: a bill's lines are made hundreds at a time, in the same millisecond. */
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

/** The size an amount stays below. Past it a figure brought to the paisa is no longer exact, and far past it is no number at all. */
const AMOUNT_BELOW = 1e13;

/**
 * Whether a value is a number the register keeps: finite, and below ten
 * million million in size. No job is billed in figures that large, and one
 * that came in would be a mistake in whatever read it. A finite number past
 * the limit is refused here, in its own words, so the person is told what is
 * wrong with it and not only that it is no amount.
 */
function isAmount(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (Math.abs(value) >= AMOUNT_BELOW) throw new Error('That figure is too large to be kept: an amount on this register is below 10,000,000,000,000.');
  return true;
}

/** Whether some words are a day of the calendar, written YYYY-MM-DD. The thirteenth month is not one, nor the thirtieth of February. */
function isDay(value: unknown): value is string {
  const said = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!said) return false;
  const [year, month, day] = [Number(said[1]), Number(said[2]), Number(said[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const paperOnFile = (project: DdProject, evidenceId: string): boolean => project.evidence.some((row) => row.id === evidenceId);

/**
 * A source as it is kept: its paper is on the project, and its page is a page.
 *
 * `held` is the source the record already carries, when a record is being
 * changed. It is left as it stands and not asked about again. Its paper may
 * have been taken off the project since, and that is no reason to refuse a
 * change to something else on the record. The same goes for the milestone a
 * work package is measured against.
 */
function sourceOf(project: DdProject, source: CostSource, held?: CostSource): CostSource {
  if (source === held) return source;
  if (!paperOnFile(project, source.evidenceId)) throw new Error('The paper a figure was read from is not on this project. Upload it to the vault first.');
  if (source.page !== undefined && (!Number.isInteger(source.page) || source.page < 1)) throw new Error('A page is a whole number, counted from 1.');
  const sheet = source.sheet?.trim();
  const cell = source.cell?.trim();
  const quote = source.quote?.trim();
  return { evidenceId: source.evidenceId, ...(source.page !== undefined ? { page: source.page } : {}), ...(sheet ? { sheet } : {}), ...(cell ? { cell } : {}), ...(quote ? { quote } : {}) };
}

/** A change to a record: a field that is named is set, and one given as null is cleared. */
export type CostPatch<T> = { [K in keyof T]?: T[K] | null };

function withPatch<T extends object>(held: T, patch: CostPatch<T>): T {
  const next = { ...held } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return next as T;
}

/* ==================================================================== */
/* Work packages                                                         */
/* ==================================================================== */

export interface WorkPackageInput {
  code?: string;
  name: string;
  budget?: number;
  source?: CostSource;
  milestoneId?: string;
}

const packageSaid = (pack: Pick<WorkPackage, 'code' | 'name'>): string => [pack.code, pack.name].filter(Boolean).join(' ');

function packageFields(project: DdProject, input: WorkPackageInput, held?: WorkPackage): WorkPackageInput {
  const name = input.name?.trim();
  if (!name) throw new Error('A work package needs a name.');
  if (input.budget !== undefined && (!isAmount(input.budget) || input.budget < 0)) throw new Error('A budget is an amount of money, zero or more.');
  if (input.milestoneId && input.milestoneId !== held?.milestoneId && !(project.milestones ?? []).some((milestone) => milestone.id === input.milestoneId)) {
    throw new Error('No milestone by that id.');
  }
  const code = input.code?.trim();
  return {
    ...(code ? { code } : {}),
    name,
    ...(input.budget !== undefined ? { budget: toThePaisa(input.budget) } : {}),
    ...(input.source ? { source: sourceOf(project, input.source, held?.source) } : {}),
    ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}),
  };
}

/** Split the budget into work packages. All of them are added, or none is: one row that cannot be kept stops the rest. */
export function addWorkPackages(project: DdProject, rows: ReadonlyArray<WorkPackageInput>, actor: string): WorkPackage[] {
  const at = nowIso();
  const added = rows.map((row): WorkPackage => ({ id: newId('wpk'), ...packageFields(project, row), createdAt: at, updatedAt: at, updatedBy: actor }));
  if (!added.length) return added;
  const register = registerOf(project);
  register.workPackages = [...register.workPackages, ...added];
  recordAuditEvent(project, { actor, action: 'add_work_packages', entityType: 'work_package', entityId: project.id, newValue: added.map(packageSaid).join(', ') });
  return added;
}

export function updateWorkPackage(project: DdProject, id: string, patch: CostPatch<WorkPackageInput>, actor: string): WorkPackage {
  const register = costRegister(project);
  const at = register.workPackages.findIndex((pack) => pack.id === id);
  const held = register.workPackages[at];
  if (!held) throw new Error('No work package by that id.');
  const { id: _id, createdAt, updatedAt: _updatedAt, updatedBy: _updatedBy, ...was } = held;
  const next: WorkPackage = { id, ...packageFields(project, withPatch(was, patch), held), createdAt, updatedAt: nowIso(), updatedBy: actor };
  register.workPackages[at] = next;
  const said = (pack: WorkPackage): string => `${packageSaid(pack)}${pack.budget === undefined ? '' : `, ${moneySaid(pack.budget, project.currency)}`}`;
  recordAuditEvent(project, { actor, action: 'update_work_package', entityType: 'work_package', entityId: id, oldValue: said(held), newValue: said(next) });
  return next;
}

/** Take a work package off the register. Refused while a contract covers it or a bill line prices it: the money would be left against nothing. */
export function removeWorkPackage(project: DdProject, id: string, actor: string): void {
  const register = costRegister(project);
  const held = register.workPackages.find((pack) => pack.id === id);
  if (!held) throw new Error('No work package by that id.');
  const contract = register.contracts.find((c) => c.workPackageIds.includes(id));
  if (contract) throw new Error(`The contract with ${contract.contractor} covers this work package. Take it off the contract first.`);
  const bill = register.bills.find((b) => b.lines.some((line) => line.workPackageId === id));
  if (bill) throw new Error(`A line of bill ${bill.number} prices this work package. Move the line to another package first.`);
  register.workPackages = register.workPackages.filter((pack) => pack.id !== id);
  recordAuditEvent(project, { actor, action: 'remove_work_package', entityType: 'work_package', entityId: id, oldValue: packageSaid(held) });
}

/* ==================================================================== */
/* Contracts                                                             */
/* ==================================================================== */

export interface ContractInput {
  contractor: string;
  title: string;
  reference?: string;
  workPackageIds?: string[];
  value: number;
  retentionPercent?: number;
  source?: CostSource;
}

function contractFields(project: DdProject, register: CostRegister, input: ContractInput, held?: CostContract): Omit<CostContract, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'> {
  const contractor = input.contractor?.trim();
  const title = input.title?.trim();
  if (!contractor || !title) throw new Error('A contract names its contractor and says what the work is.');
  const value = isAmount(input.value) ? toThePaisa(input.value) : Number.NaN;
  if (!(value > 0)) throw new Error('A contract’s value is an amount of money above zero.');
  const workPackageIds = [...new Set(input.workPackageIds ?? [])];
  if (workPackageIds.some((id) => !register.workPackages.some((pack) => pack.id === id))) throw new Error('A contract covers work packages of this project. One of those named is not one of them.');
  if (input.retentionPercent !== undefined && (!isAmount(input.retentionPercent) || input.retentionPercent < 0 || input.retentionPercent > 100)) {
    throw new Error('Retention is a percentage between 0 and 100.');
  }
  const reference = input.reference?.trim();
  return {
    contractor,
    title,
    ...(reference ? { reference } : {}),
    workPackageIds,
    value,
    ...(input.retentionPercent !== undefined ? { retentionPercent: input.retentionPercent } : {}),
    ...(input.source ? { source: sourceOf(project, input.source, held?.source) } : {}),
  };
}

const contractSaid = (contract: Pick<CostContract, 'contractor' | 'title' | 'value'>, currency: Currency): string => `${contract.contractor}: ${contract.title}, ${moneySaid(contract.value, currency)}`;

export function addContract(project: DdProject, input: ContractInput, actor: string): CostContract {
  const at = nowIso();
  const contract: CostContract = { id: newId('ctr'), ...contractFields(project, costRegister(project), input), createdAt: at, updatedAt: at, updatedBy: actor };
  const register = registerOf(project);
  register.contracts = [...register.contracts, contract];
  recordAuditEvent(project, { actor, action: 'add_contract', entityType: 'contract', entityId: contract.id, newValue: contractSaid(contract, project.currency) });
  return contract;
}

/** Change a contract. It goes on covering a work package while one of its bills prices it, as a package stays while a contract covers it. */
export function updateContract(project: DdProject, id: string, patch: CostPatch<ContractInput>, actor: string): CostContract {
  const register = costRegister(project);
  const at = register.contracts.findIndex((contract) => contract.id === id);
  const held = register.contracts[at];
  if (!held) throw new Error('No contract by that id.');
  const { id: _id, createdAt, updatedAt: _updatedAt, updatedBy: _updatedBy, ...was } = held;
  const next: CostContract = { id, ...contractFields(project, register, withPatch(was, patch), held), createdAt, updatedAt: nowIso(), updatedBy: actor };
  const priced = register.bills.find((bill) => bill.contractId === id && bill.lines.some((line) => line.workPackageId && !next.workPackageIds.includes(line.workPackageId)));
  if (priced) throw new Error(`A line of bill ${priced.number} prices a work package this would take off the contract. Move the line first.`);
  register.contracts[at] = next;
  recordAuditEvent(project, { actor, action: 'update_contract', entityType: 'contract', entityId: id, oldValue: contractSaid(held, project.currency), newValue: contractSaid(next, project.currency) });
  return next;
}

/** Take a contract off the register, as when it was entered wrongly. Refused while a bill was raised under it: the bills go first, and each of those is kept once it has been worked on. */
export function removeContract(project: DdProject, id: string, actor: string): void {
  const register = costRegister(project);
  const held = register.contracts.find((contract) => contract.id === id);
  if (!held) throw new Error('No contract by that id.');
  const bill = register.bills.find((b) => b.contractId === id);
  if (bill) throw new Error(`Bill ${bill.number} was raised under this contract. Remove its bills first.`);
  register.contracts = register.contracts.filter((contract) => contract.id !== id);
  recordAuditEvent(project, { actor, action: 'remove_contract', entityType: 'contract', entityId: id, oldValue: contractSaid(held, project.currency) });
}

/* ==================================================================== */
/* The project's own columns                                             */
/* ==================================================================== */

/** Give every bill of the project one more column. Its key is its own: no other column has it, and no core column does. */
export function defineCostColumn(project: DdProject, input: CostExtraColumn, actor: string): CostExtraColumn {
  const key = input.key?.trim();
  const label = input.label?.trim();
  if (!key || !label) throw new Error('A column needs a key and the heading it is shown under.');
  if (!COLUMN_KINDS.includes(input.kind)) throw new Error('A column holds text, a number or money.');
  const same = (other: string): boolean => other.toLowerCase() === key.toLowerCase();
  if (BILL_CORE_COLUMNS.some((column) => same(column.key))) throw new Error(`Every bill line already has “${key}”. Give the column another key.`);
  if ((costRegister(project).extraColumns ?? []).some((column) => same(column.key))) throw new Error(`This project already has a column with the key “${key}”.`);
  const column: CostExtraColumn = { key, label, kind: input.kind };
  const register = registerOf(project);
  register.extraColumns = [...(register.extraColumns ?? []), column];
  recordAuditEvent(project, { actor, action: 'define_cost_column', entityType: 'cost', entityId: project.id, newValue: `${label} (${key})` });
  return column;
}

/* ==================================================================== */
/* Bills and their lines                                                 */
/* ==================================================================== */

export interface BillLineInput {
  item?: string;
  description?: string;
  workPackageId?: string;
  unit?: string;
  rate?: number;
  quantityToDate?: number;
  amountToDate?: number;
  previousAmount?: number;
  amount: number;
  variation?: boolean;
  extra?: Record<string, string | number>;
  source?: CostSource;
  readBy: BillLine['readBy'];
}

export interface BillInput {
  contractId: string;
  number: string;
  date: string;
  periodFrom?: string;
  periodTo?: string;
  statedTotal?: number;
  evidenceId?: string;
  lines?: ReadonlyArray<BillLineInput>;
}

/** Said when a line is to be changed or decided on a bill whose certificate stands. */
const LINES_FIXED = 'A certificate stands on this bill. Withdraw it before changing or deciding its lines.';

/** What each field of a line is called where the trail says which of them a change moved. */
const LINE_FIELD_SAID: Record<keyof BillLineInput, string> = {
  item: 'item',
  description: 'description',
  workPackageId: 'work package',
  unit: 'unit',
  rate: 'rate',
  quantityToDate: 'quantity to date',
  amountToDate: 'amount to date',
  previousAmount: 'previous amount',
  amount: 'amount claimed',
  variation: 'variation',
  extra: 'the project’s own columns',
  source: 'where it was read',
  readBy: 'who read it',
};

function billIn(register: CostRegister, billId: string): CostBill {
  const bill = register.bills.find((b) => b.id === billId);
  if (!bill) throw new Error('No bill by that id.');
  return bill;
}

function contractOf(register: CostRegister, bill: CostBill): CostContract {
  const contract = register.contracts.find((c) => c.id === bill.contractId);
  if (!contract) throw new Error('The contract this bill was raised under is no longer on the project.');
  return contract;
}

function lineFields(project: DdProject, register: CostRegister, contract: CostContract, input: BillLineInput, held?: BillLine): Omit<BillLine, 'id' | 'certified'> {
  const item = input.item?.trim() ?? '';
  const description = input.description?.trim() ?? '';
  if (!item && !description) throw new Error('A bill line needs an item number or a description.');
  if (!isAmount(input.amount)) throw new Error('Each line of a bill needs the amount it claims, as a number.');
  for (const key of ['rate', 'quantityToDate', 'amountToDate', 'previousAmount'] as const) {
    if (input[key] !== undefined && !isAmount(input[key])) throw new Error('A line’s rate, its quantity and its amounts are numbers.');
  }
  if (input.workPackageId && !contract.workPackageIds.includes(input.workPackageId)) {
    throw new Error(`A line prices a work package its contract covers. The contract with ${contract.contractor} does not cover that one.`);
  }
  const columns = register.extraColumns ?? [];
  const extra = Object.entries(input.extra ?? {});
  const stray = extra.find(([key]) => !columns.some((column) => column.key === key));
  if (stray) throw new Error(`“${stray[0]}” is not a column this project has defined.`);
  if (!READ_BY.includes(input.readBy)) throw new Error('A line says who read it: a person, a sheet or a model.');
  // What a person typed needs no source. What was read off a paper says where, closely enough to be looked up.
  const source = input.source ? sourceOf(project, input.source, held?.source) : undefined;
  if (input.readBy === 'model' && source?.page === undefined) throw new Error('A line a model read says the paper and the page it was read from.');
  if (input.readBy === 'sheet' && !(source?.sheet && source.cell)) throw new Error('A line read off a spreadsheet says the paper, the sheet and the cell it was read from.');
  const unit = input.unit?.trim();
  // An amount in one of the project's own money columns is brought to the paisa like any other.
  const kept = extra.map(([key, value]): [string, string | number] => [key, typeof value === 'number' && columns.find((column) => column.key === key)?.kind === 'money' ? toThePaisa(value) : value]);
  return {
    item,
    description,
    ...(input.workPackageId ? { workPackageId: input.workPackageId } : {}),
    ...(unit ? { unit } : {}),
    ...(input.rate !== undefined ? { rate: input.rate } : {}),
    ...(input.quantityToDate !== undefined ? { quantityToDate: input.quantityToDate } : {}),
    ...(input.amountToDate !== undefined ? { amountToDate: toThePaisa(input.amountToDate) } : {}),
    ...(input.previousAmount !== undefined ? { previousAmount: toThePaisa(input.previousAmount) } : {}),
    amount: toThePaisa(input.amount),
    ...(input.variation ? { variation: true } : {}),
    ...(kept.length ? { extra: Object.fromEntries(kept) } : {}),
    ...(source ? { source } : {}),
    readBy: input.readBy,
  };
}

const linesSaid = (lines: readonly BillLine[], currency: Currency): string => `${plural(lines.length, 'line')}, ${moneySaid(sum(lines.map((line) => line.amount)), currency)}`;

const billSaid = (contract: CostContract | undefined, bill: CostBill, currency: Currency): string =>
  `${contract ? `${contract.contractor} bill` : 'Bill'} ${bill.number}, ${bill.date}: ${linesSaid(bill.lines, currency)}`;

/** Take in a contractor's bill under one of the project's contracts. A contract has no two bills of the same number. */
export function addBill(project: DdProject, input: BillInput, actor: string): CostBill {
  const register = costRegister(project);
  const contract = register.contracts.find((c) => c.id === input.contractId);
  if (!contract) throw new Error('No contract by that id.');
  const number = input.number?.trim();
  if (!number) throw new Error('A bill needs its number.');
  if (register.bills.some((bill) => bill.contractId === contract.id && bill.number.trim().toLowerCase() === number.toLowerCase())) {
    throw new Error(`${contract.contractor} already has a bill numbered ${number} under this contract.`);
  }
  if (!isDay(input.date)) throw new Error('A bill needs its date: a day of the calendar, as YYYY-MM-DD.');
  if ([input.periodFrom, input.periodTo].some((day) => day !== undefined && !isDay(day))) throw new Error('The period a bill covers is two days of the calendar, each as YYYY-MM-DD.');
  if (input.periodFrom && input.periodTo && input.periodFrom > input.periodTo) throw new Error('The period a bill covers ends on or after the day it starts.');
  if (input.statedTotal !== undefined && !isAmount(input.statedTotal)) throw new Error('The total a bill states is a number.');
  if (input.evidenceId && !paperOnFile(project, input.evidenceId)) throw new Error('Upload the bill to the vault first.');
  const at = nowIso();
  const bill: CostBill = {
    id: newId('bill'),
    contractId: contract.id,
    number,
    date: input.date,
    ...(input.periodFrom ? { periodFrom: input.periodFrom } : {}),
    ...(input.periodTo ? { periodTo: input.periodTo } : {}),
    ...(input.statedTotal !== undefined ? { statedTotal: toThePaisa(input.statedTotal) } : {}),
    ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}),
    lines: (input.lines ?? []).map((line) => ({ id: newId('line'), ...lineFields(project, register, contract, line) })),
    payments: [],
    certifications: [],
    createdAt: at,
    createdBy: actor,
    updatedAt: at,
  };
  const held = registerOf(project);
  held.bills = [...held.bills, bill];
  recordAuditEvent(project, { actor, action: 'add_bill', entityType: 'bill', entityId: bill.id, newValue: billSaid(contract, bill, project.currency) });
  return bill;
}

/**
 * Take a bill off the register, as when it was taken in twice or under the
 * wrong contract. Refused once the bill has been worked on: a line of it
 * decided, a certificate ever issued on it, or a payment standing against it.
 * From then on it is part of the record of what was certified and paid.
 */
export function removeBill(project: DdProject, billId: string, actor: string): void {
  const register = costRegister(project);
  const bill = billIn(register, billId);
  if (bill.certifications.length) throw new Error('A certificate was issued on this bill, so the bill is kept with it.');
  if (bill.lines.some((line) => line.certified)) throw new Error('A line of this bill has been decided, so the bill is kept. If it was taken in wrongly, replace its lines first.');
  if (standingPayments(bill).length) throw new Error('A payment stands on this bill. Void it first.');
  register.bills = register.bills.filter((b) => b.id !== billId);
  recordAuditEvent(project, {
    actor,
    action: 'remove_bill',
    entityType: 'bill',
    entityId: billId,
    oldValue: billSaid(register.contracts.find((contract) => contract.id === bill.contractId), bill, project.currency),
  });
}

/** Replace a bill's lines, as when it is read again. The new lines are undecided. Refused while a certificate stands. */
export function setBillLines(project: DdProject, billId: string, lines: ReadonlyArray<BillLineInput>, actor: string): CostBill {
  const register = costRegister(project);
  const bill = billIn(register, billId);
  if (standingCertification(bill)) throw new Error(LINES_FIXED);
  const contract = contractOf(register, bill);
  const was = linesSaid(bill.lines, project.currency);
  bill.lines = lines.map((line) => ({ id: newId('line'), ...lineFields(project, register, contract, line) }));
  bill.updatedAt = nowIso();
  recordAuditEvent(project, { actor, action: 'set_bill_lines', entityType: 'bill', entityId: bill.id, oldValue: was, newValue: linesSaid(bill.lines, project.currency) });
  return bill;
}

/** The fields of a line that say what work it is and how much of it: what a certifier looked at to pass an amount for it. */
const LINE_DECIDED_ON = ['amount', 'item', 'description', 'unit', 'rate', 'quantityToDate'] as const;

/**
 * Change one line of a bill. Refused while a certificate stands.
 *
 * What the certifier passed was passed for this item, at this quantity and
 * rate, claiming this amount. A line changed in any of those is another
 * claim, which nobody has decided: its decision goes with what it was a
 * decision about, and is never left under the certifier's name on work they
 * did not look at. Moving the line to another work package changes none of
 * that. The amount and the reason are still true of the same work, so the
 * decision stays.
 */
export function updateBillLine(project: DdProject, billId: string, lineId: string, patch: CostPatch<BillLineInput>, actor: string): BillLine {
  const register = costRegister(project);
  const bill = billIn(register, billId);
  if (standingCertification(bill)) throw new Error(LINES_FIXED);
  const at = bill.lines.findIndex((line) => line.id === lineId);
  const held = bill.lines[at];
  if (!held) throw new Error('No line by that id on this bill.');
  const { id: _id, certified, ...was } = held;
  const fields = lineFields(project, register, contractOf(register, bill), withPatch(was, patch), held);
  const sameClaim = LINE_DECIDED_ON.every((key) => fields[key] === held[key]);
  const next: BillLine = { id: lineId, ...fields, ...(certified && sameClaim ? { certified } : {}) };
  bill.lines[at] = next;
  bill.updatedAt = nowIso();
  // The trail says what the line claims and for which package, before and after, and names every field the change moved.
  const said = (row: Pick<BillLine, 'amount' | 'workPackageId'>): string => {
    const pack = register.workPackages.find((p) => p.id === row.workPackageId);
    return `${moneySaid(row.amount, project.currency)}, ${pack ? packageSaid(pack) : 'no work package'}`;
  };
  const moved = (Object.keys(LINE_FIELD_SAID) as Array<keyof BillLineInput>).filter((key) => JSON.stringify(was[key]) !== JSON.stringify(fields[key])).map((key) => LINE_FIELD_SAID[key]);
  recordAuditEvent(project, {
    actor,
    action: 'update_bill_line',
    entityType: 'bill_line',
    entityId: lineId,
    oldValue: said(held),
    newValue: `${said(next)}${moved.length ? `. Changed: ${moved.join(', ')}` : ''}${certified && !sameClaim ? `. What ${certified.by} passed for it no longer stands` : ''}`,
  });
  return next;
}

/* ==================================================================== */
/* Certifying                                                            */
/* ==================================================================== */

/**
 * Say what is passed for one line of a bill: the amount claimed, or another
 * with the reason. An adjustment says why, so a note is required whenever the
 * two differ. A line already decided may be decided again until the bill's
 * certificate is issued.
 *
 * The amount may be less than nothing, because a line may be a credit and a
 * credit passed as claimed is passed at what it claims. The floor is on the
 * certificate: a bill's lines together are never certified below nothing.
 */
export function certifyLine(project: DdProject, billId: string, lineId: string, input: { amount: number; quantity?: number; note?: string }, actor: string): BillLine {
  const bill = billIn(costRegister(project), billId);
  if (standingCertification(bill)) throw new Error(LINES_FIXED);
  const line = bill.lines.find((l) => l.id === lineId);
  if (!line) throw new Error('No line by that id on this bill.');
  if (!isAmount(input.amount)) throw new Error('What is passed for a line is an amount of money, as a number.');
  if (input.quantity !== undefined && !isAmount(input.quantity)) throw new Error('The quantity passed for a line is a number.');
  const amount = toThePaisa(input.amount);
  const note = input.note?.trim();
  if (!note && amount !== line.amount) throw new Error('Say why the amount passed differs from the amount claimed.');
  const at = nowIso();
  line.certified = { amount, ...(input.quantity !== undefined ? { quantity: input.quantity } : {}), ...(note ? { note } : {}), by: actor, at };
  bill.updatedAt = at;
  recordAuditEvent(project, {
    actor,
    action: 'certify_line',
    entityType: 'bill_line',
    entityId: lineId,
    newValue: `${moneySaid(amount, project.currency)} of ${moneySaid(line.amount, project.currency)} claimed${note ? `: ${note}` : ''}`,
  });
  return line;
}

export interface CertifyBillInput {
  signer: CostSigner;
  certifiedOn: string;
  deductions?: ReadonlyArray<CostDeduction>;
  note?: string;
  evidenceId?: string;
}

/**
 * Issue the certificate for a bill, once every line of it is decided.
 *
 * The gross is the sum of what was passed on the lines and the net is the
 * gross less the deductions: neither is typed, so a certificate cannot say
 * something its lines do not. Neither may be less than nothing. Who may
 * issue one is the caller's to check; here it is only that somebody with a
 * profession is named.
 */
export function certifyBill(project: DdProject, billId: string, input: CertifyBillInput, actor: string): BillCertification {
  const money = (amount: number): string => moneySaid(amount, project.currency);
  const bill = billIn(costRegister(project), billId);
  if (standingCertification(bill)) throw new Error('This bill already has a certificate. Withdraw it before issuing another.');
  if (!bill.lines.length) throw new Error('This bill has no lines to certify.');
  const waiting = bill.lines.filter((line) => !line.certified).length;
  if (waiting) throw new Error(`${waiting === 1 ? 'One line of this bill has' : `${waiting} lines of this bill have`} not been decided yet. Certify every line first.`);
  const email = input.signer?.email?.trim();
  const profession = input.signer?.profession?.trim();
  if (!email || !profession) throw new Error('A certificate names who signed it and their profession.');
  if (!isDay(input.certifiedOn)) throw new Error('A certificate needs the day it was issued: a day of the calendar, as YYYY-MM-DD.');
  if (input.certifiedOn < bill.date) throw new Error(`A certificate is not dated before its bill. This bill is dated ${bill.date}.`);
  if (input.evidenceId && !paperOnFile(project, input.evidenceId)) throw new Error('Upload the signed certificate to the vault first.');
  const taken = input.deductions ?? [];
  if (taken.some((deduction) => !DEDUCTION_KINDS.includes(deduction.kind) || !isAmount(deduction.amount) || deduction.amount < 0)) {
    throw new Error('A deduction is retention, advance recovery, tax, a penalty or another, and an amount of zero or more.');
  }
  // One of nothing takes nothing off, and is not kept.
  const deductions = taken
    .map((deduction): CostDeduction => ({ kind: deduction.kind, ...(deduction.label?.trim() ? { label: deduction.label.trim() } : {}), amount: toThePaisa(deduction.amount) }))
    .filter((deduction) => deduction.amount > 0);
  const gross = sum(bill.lines.map((line) => line.certified?.amount ?? 0));
  if (gross < 0) throw new Error(`What was passed on this bill comes to ${money(gross)}. A certificate is for nothing or more: the credits on it are larger than the work.`);
  const net = less(gross, sum(deductions.map((deduction) => deduction.amount)));
  if (net < 0) throw new Error(`The deductions come to more than the ${money(gross)} certified.`);
  const name = input.signer.name?.trim();
  const registration = input.signer.registration?.trim();
  const note = input.note?.trim();
  const at = nowIso();
  const certificate: BillCertification = {
    id: newId('cert'),
    gross,
    deductions,
    net,
    signer: { email, ...(name ? { name } : {}), profession, ...(registration ? { registration } : {}) },
    certifiedOn: input.certifiedOn,
    ...(note ? { note } : {}),
    ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}),
    createdAt: at,
    createdBy: actor,
  };
  bill.certifications = [...bill.certifications, certificate];
  bill.updatedAt = at;
  recordAuditEvent(project, {
    actor,
    action: 'certify_bill',
    entityType: 'certification',
    entityId: certificate.id,
    newValue: `Bill ${bill.number}: ${money(gross)} gross, ${money(net)} net. ${name ?? email}, ${profession}`,
  });
  return certificate;
}

/**
 * Withdraw the certificate that stands on a bill, so its lines can be changed
 * and decided again. The certificate stays on the bill, marked, and what was
 * passed on each line is kept as the place to start from.
 *
 * Money paid against it is not taken back by this: the payments stay, against
 * a bill that is no longer certified. So withdrawing a certificate that has
 * been paid against has to say why.
 */
export function withdrawCertification(project: DdProject, billId: string, actor: string, reason?: string): BillCertification {
  const bill = billIn(costRegister(project), billId);
  const certificate = standingCertification(bill);
  if (!certificate) throw new Error('No certificate stands on this bill.');
  const why = reason?.trim();
  if (!why && standingPayments(bill).length) throw new Error('Money has been paid against this certificate. Say why it is withdrawn.');
  const at = nowIso();
  certificate.withdrawn = { by: actor, at, ...(why ? { reason: why } : {}) };
  bill.updatedAt = at;
  recordAuditEvent(project, {
    actor,
    action: 'withdraw_certification',
    entityType: 'certification',
    entityId: certificate.id,
    ...(why ? { reason: why } : {}),
    oldValue: `Bill ${bill.number}: ${moneySaid(certificate.gross, project.currency)} gross, ${moneySaid(certificate.net, project.currency)} net`,
  });
  return certificate;
}

/* ==================================================================== */
/* Paying, and what the job is expected to cost                           */
/* ==================================================================== */

const paymentSaid = (payment: CostPayment, bill: CostBill, currency: Currency): string =>
  `${moneySaid(payment.amount, currency)} paid on ${payment.paidOn} against bill ${bill.number}${payment.reference ? ` (${payment.reference})` : ''}`;

/** Record an amount paid against a bill. A reference names one payment: a second with the same one is the same payment entered twice. */
export function recordPayment(project: DdProject, billId: string, input: { amount: number; paidOn: string; reference?: string; source?: CostSource }, actor: string): CostPayment {
  const bill = billIn(costRegister(project), billId);
  const amount = isAmount(input.amount) ? toThePaisa(input.amount) : Number.NaN;
  if (!(amount > 0)) throw new Error('A payment is an amount of money above zero.');
  if (!isDay(input.paidOn)) throw new Error('A payment needs the day it was paid: a day of the calendar, as YYYY-MM-DD.');
  const reference = input.reference?.trim();
  if (reference && standingPayments(bill).some((payment) => payment.reference?.trim().toLowerCase() === reference.toLowerCase())) {
    throw new Error(`A payment with the reference ${reference} already stands on this bill. If that one was entered wrongly, void it first.`);
  }
  const at = nowIso();
  const payment: CostPayment = {
    id: newId('pay'),
    amount,
    paidOn: input.paidOn,
    ...(reference ? { reference } : {}),
    ...(input.source ? { source: sourceOf(project, input.source) } : {}),
    recordedAt: at,
    recordedBy: actor,
  };
  bill.payments = [...bill.payments, payment];
  bill.updatedAt = at;
  recordAuditEvent(project, { actor, action: 'record_payment', entityType: 'bill', entityId: bill.id, newValue: paymentSaid(payment, bill, project.currency) });
  return payment;
}

/**
 * Take back a payment that was entered wrongly. It stays on the bill, marked
 * with who voided it, when and why, and is left out of every sum from then
 * on. Nothing is deleted: what was once recorded as paid can still be read.
 */
export function voidPayment(project: DdProject, billId: string, paymentId: string, actor: string, reason: string): CostPayment {
  const bill = billIn(costRegister(project), billId);
  const payment = bill.payments.find((p) => p.id === paymentId);
  if (!payment) throw new Error('No payment by that id on this bill.');
  if (payment.voided) throw new Error('That payment is already voided.');
  const why = reason?.trim();
  if (!why) throw new Error('Say why the payment is voided.');
  const at = nowIso();
  payment.voided = { by: actor, at, reason: why };
  bill.updatedAt = at;
  recordAuditEvent(project, { actor, action: 'void_payment', entityType: 'bill', entityId: bill.id, reason: why, oldValue: paymentSaid(payment, bill, project.currency) });
  return payment;
}

export function setCostForecast(project: DdProject, input: { finalCost: number; note?: string }, actor: string): NonNullable<CostRegister['forecast']> {
  const finalCost = isAmount(input.finalCost) ? toThePaisa(input.finalCost) : Number.NaN;
  if (!(finalCost > 0)) throw new Error('The forecast final cost is an amount of money above zero.');
  const note = input.note?.trim();
  const was = costRegister(project).forecast;
  const forecast = { finalCost, ...(note ? { note } : {}), by: actor, at: nowIso() };
  registerOf(project).forecast = forecast;
  recordAuditEvent(project, {
    actor,
    action: 'set_cost_forecast',
    entityType: 'cost',
    entityId: project.id,
    ...(was ? { oldValue: moneySaid(was.finalCost, project.currency) } : {}),
    newValue: moneySaid(forecast.finalCost, project.currency),
  });
  return forecast;
}

/* ==================================================================== */
/* Where the money stands                                                */
/* ==================================================================== */

export type BillLineStatus = 'claimed' | 'decided' | 'certified' | 'adjusted';

/**
 * Where one line of a bill stands.
 *
 * `claimed`: nobody has decided it. `decided`: something was passed for it
 * and no certificate stands on its bill, because none was issued yet or the
 * one issued was withdrawn. `certified` and `adjusted`: the bill's certificate
 * stands, and the line was passed as claimed or at another amount.
 *
 * It takes the bill because a line is not certified by itself. What was
 * passed for it is certified only under a certificate that stands.
 */
export function billLineStatus(line: BillLine, bill: Pick<CostBill, 'certifications'>): BillLineStatus {
  if (!line.certified) return 'claimed';
  if (!bill.certifications.some((certificate) => !certificate.withdrawn)) return 'decided';
  return inPaise(line.certified.amount) === inPaise(line.amount) ? 'certified' : 'adjusted';
}

export type BillStatus = 'claimed' | 'in_review' | 'certified' | 'paid';

export interface BillPosition {
  /** The sum of what its lines claim. */
  claimed: number;
  /** Its lines, and how many of them the certifier has decided. */
  lines: number;
  decided: number;
  /** From the certificate that stands. Absent while none does. */
  gross?: number;
  net?: number;
  /** What was paid against it. A payment that was voided is not counted. */
  paid: number;
  /** What is still to pay under the certificate: net less paid, and never less than nothing. Absent while no certificate stands. */
  outstanding?: number;
  /** What was paid beyond what was payable. Its own figure, so that it is never set against what another bill is owed. */
  overpaid?: number;
  /** `claimed` while no line is decided, `in_review` once one is, `certified` under a certificate, `paid` once what was paid reaches its net. */
  status: BillStatus;
}

export function billPosition(bill: CostBill): BillPosition {
  const certificate = standingCertification(bill);
  const decided = bill.lines.filter((line) => line.certified).length;
  const paid = sum(standingPayments(bill).map((payment) => payment.amount));
  const owed = certificate ? less(certificate.net, paid) : 0;
  return {
    claimed: sum(bill.lines.map((line) => line.amount)),
    lines: bill.lines.length,
    decided,
    ...(certificate ? { gross: certificate.gross, net: certificate.net } : {}),
    paid,
    ...(certificate ? { outstanding: Math.max(0, owed), overpaid: Math.max(0, less(0, owed)) } : {}),
    status: certificate ? (owed <= 0 ? 'paid' : 'certified') : decided > 0 ? 'in_review' : 'claimed',
  };
}

export interface ContractPosition {
  value: number;
  claimed: number;
  /** Gross, under the certificates that stand. */
  certified: number;
  net: number;
  paid: number;
  /** What is left to certify under it: the contract's value less what is certified. Below zero once more is certified than the contract is for. */
  balance: number;
}

export function contractPosition(project: Pick<DdProject, 'cost'>, contractId: string): ContractPosition {
  const register = costRegister(project);
  const contract = register.contracts.find((c) => c.id === contractId);
  if (!contract) throw new Error('No contract by that id.');
  const bills = register.bills.filter((bill) => bill.contractId === contractId).map(billPosition);
  const certified = sum(bills.map((bill) => bill.gross ?? 0));
  return {
    value: contract.value,
    claimed: sum(bills.map((bill) => bill.claimed)),
    certified,
    net: sum(bills.map((bill) => bill.net ?? 0)),
    paid: sum(bills.map((bill) => bill.paid)),
    balance: less(contract.value, certified),
  };
}

export interface PackagePosition {
  budget?: number;
  /** What every line pricing it claims, on every bill: each bill's own amount, never its amount to date. */
  claimed: number;
  /** What was passed on those lines, counted only on a bill whose certificate stands. */
  certified: number;
  /** What is left of the budget: the budget less what is certified. Below zero once it is overrun. Absent while no budget is set. */
  balance?: number;
}

export function packagePosition(project: Pick<DdProject, 'cost'>, workPackageId: string): PackagePosition {
  const register = costRegister(project);
  const pack = register.workPackages.find((p) => p.id === workPackageId);
  if (!pack) throw new Error('No work package by that id.');
  const claimed: number[] = [];
  const passed: number[] = [];
  for (const bill of register.bills) {
    const stands = Boolean(standingCertification(bill));
    for (const line of bill.lines) {
      if (line.workPackageId !== workPackageId) continue;
      claimed.push(line.amount);
      if (stands && line.certified) passed.push(line.certified.amount);
    }
  }
  const certified = sum(passed);
  return {
    ...(pack.budget !== undefined ? { budget: pack.budget } : {}),
    claimed: sum(claimed),
    certified,
    ...(pack.budget !== undefined ? { balance: less(pack.budget, certified) } : {}),
  };
}

export interface CostSummary {
  /** The sum of the budgets of the work packages that have one. Absent while none has: no budget is not a budget of nothing. */
  budget?: number;
  /** The sum of the contracts' values. */
  committed: number;
  claimed: number;
  /** Gross, under the certificates that stand. */
  certified: number;
  /** Every payment that stands, whether or not its bill is certified. */
  paid: number;
  /** What is payable under those certificates and not yet paid, bill by bill. A bill that was overpaid takes nothing off it. */
  outstanding: number;
  /** What was paid beyond what was payable, bill by bill. One contractor's overpayment is not another's settlement, so it is its own figure. */
  overpaid: number;
  /** The forecast final cost, once one has been put. */
  forecast?: number;
  /**
   * Whether the forecast of the whole job is above the budget. Said only once
   * every work package has a budget: the forecast is for all of the work, and
   * held against the budgets of some of it it would read as over when it is
   * not. False until then.
   */
  forecastOverBudget: boolean;
  /**
   * Whether what is certified is above the budget.
   *
   * Once every work package has a budget, the budget is for all of the work,
   * and all that is certified is held against it: a line that prices no
   * package is money certified on the job like any other. While some package
   * has none, the budget covers part of the work only, so what is certified
   * on the packages that have a budget is held against those budgets taken
   * together and the rest against nothing.
   */
  certifiedOverBudget: boolean;
}

export function costSummary(project: Pick<DdProject, 'cost'>): CostSummary {
  const register = costRegister(project);
  const budgeted = register.workPackages.filter((pack) => pack.budget !== undefined);
  const budget = budgeted.length ? sum(budgeted.map((pack) => pack.budget ?? 0)) : undefined;
  // The budget is for all of the work once every package has one. Until then it is for part of it.
  const wholeBudget = budgeted.length === register.workPackages.length;
  const bills = register.bills.map(billPosition);
  const certified = sum(bills.map((bill) => bill.gross ?? 0));
  const forecast = register.forecast?.finalCost;
  return {
    ...(budget !== undefined ? { budget } : {}),
    committed: sum(register.contracts.map((contract) => contract.value)),
    claimed: sum(bills.map((bill) => bill.claimed)),
    certified,
    paid: sum(bills.map((bill) => bill.paid)),
    outstanding: sum(bills.map((bill) => bill.outstanding ?? 0)),
    overpaid: sum(bills.map((bill) => bill.overpaid ?? 0)),
    ...(forecast !== undefined ? { forecast } : {}),
    forecastOverBudget: budget !== undefined && wholeBudget && forecast !== undefined && forecast > budget,
    certifiedOverBudget: budget !== undefined && (wholeBudget ? certified : sum(budgeted.map((pack) => packagePosition(project, pack.id).certified))) > budget,
  };
}
