/**
 * Realytica operating model — the BRD's manual system of record.
 *
 * A project is the primary object. Due diligence assessments run against it
 * (or against selected assets), instantiate reusable scopes and checks, and
 * write into shared project-level registers. AI is a later execution layer
 * on these same records; nothing here requires a model to function.
 */

import type { RevenueMapRead, RevenueShape } from './revenue-map';
import type {
  ChatChoice,
  ChatMetric,
  TurnSpend,
  GeoPoint,
  KarnatakaAttributes,
  ParcelBoundary,
  PlotAttributes,
  ScreenResult,
  SiteContext,
  Tenure,
} from '../types';

export type { ChatChoice, ChatMetric, ChoicePin, TurnSpend } from '../types';

import type { ProjectGraphEdgeKind, ProjectGraphLayer, ProjectGraphNodeKind } from './project-ontology';

export type { ProjectGraphEdgeKind, ProjectGraphLayer, ProjectGraphNodeKind } from './project-ontology';

/**
 * Type-only, and one direction: `standards.ts` reads `FindingSeverity` from
 * here, and the records here borrow its vocabulary. Both imports erase, so
 * there is no cycle at runtime — and the alternative, restating RICS bands and
 * ASTM conditions as bare string unions in this file, would put the words a
 * long way from the citation that makes them mean anything.
 */
import type { EnvironmentalCondition, Iso19650Ref, RemedialBand, RicsEscalation } from './standards';
import type { CaptureFacts } from './capture';
import type { PhotoObservation } from './photo-observation';
import type { SheetRecord } from './geo-sheet';
import type { SiteVisitRecord } from './site-visit';
import type { Rule8Additions } from './ibbi';
import type { ValuationWorking } from './valuation-run';

/* ------------------------------------------------------------------ */
/* Catalog keys                                                        */
/* ------------------------------------------------------------------ */

export type ProjectArchetype =
  | 'residential'
  | 'commercial'
  | 'mixed_use'
  | 'industrial'
  | 'logistics'
  | 'hospitality'
  | 'healthcare'
  | 'institutional'
  | 'large_campus'
  | 'specialized';

export type ProjectHealth = 'green' | 'amber' | 'red' | 'unknown';

export type LifecycleStage =
  | 'opportunity_site'
  | 'feasibility'
  | 'acquisition'
  | 'design'
  | 'approvals'
  | 'procurement'
  | 'pre_construction'
  | 'construction'
  | 'testing_commissioning'
  | 'completion'
  | 'handover'
  | 'operations';

export type DdTypeKey =
  | 'acquisition'
  | 'feasibility'
  | 'design'
  | 'approval_compliance'
  | 'pre_construction_readiness'
  | 'procurement_contractor'
  | 'construction_progress'
  | 'technical'
  | 'cost'
  | 'cost_schedule'
  | 'quality'
  | 'hse'
  | 'completion'
  | 'handover_readiness'
  | 'operational_condition'
  | 'full_project_health'
  | 'indicative_valuation'
  | 'custom';

export type ScopeKey =
  | 'land_site'
  | 'legal'
  | 'regulatory'
  | 'technical'
  | 'cost_quantity'
  | 'schedule_progress'
  | 'commercial_market'
  | 'financial_appraisal'
  | 'procurement'
  | 'quality'
  | 'hse'
  | 'esg'
  | 'condition_operations'
  | 'indicative_valuation';

export type DdTargetType = 'project' | 'assets';

export type AssessmentStatus = 'draft' | 'active' | 'in_review' | 'completed' | 'archived';
export type ScopeStatus = 'not_started' | 'in_progress' | 'in_review' | 'complete' | 'excluded';

export type CheckResult =
  | 'pending'
  | 'compliant'
  | 'non_compliant'
  | 'partially_compliant'
  | 'not_applicable'
  | 'unable_to_verify'
  | 'missing_evidence'
  | 'requires_expert_review';

export type EvidenceStatus =
  | 'expected'
  | 'requested'
  | 'received'
  | 'validated'
  | 'used'
  | 'superseded'
  | 'rejected'
  | 'missing';

export type FindingStatus =
  | 'draft'
  | 'under_review'
  | 'open'
  | 'accepted'
  | 'rejected'
  | 'duplicate'
  | 'monitoring'
  | 'closed'
  | 'superseded';

export type FindingSeverity = 'low' | 'medium' | 'high' | 'critical';

export type DdRiskStatus =
  | 'identified'
  | 'assessed'
  | 'accepted'
  | 'mitigated'
  | 'monitoring'
  | 'escalated'
  | 'closed';

export type RiskImpactType =
  | 'cost'
  | 'time'
  | 'quality'
  | 'safety'
  | 'compliance'
  | 'legal'
  | 'commercial'
  | 'operational'
  | 'esg'
  | 'valuation'
  | 'reputation'
  | 'handover';

export type ActionKind =
  | 'remediation'
  | 'clarification'
  | 'evidence_request'
  | 'expert_review'
  | 'reinspection'
  | 'approval_submission'
  | 'cost_update'
  | 'schedule_update'
  | 'decision_request'
  | 'report_update';

export type ActionStatus =
  | 'not_started'
  | 'in_progress'
  | 'blocked'
  | 'overdue'
  | 'submitted'
  | 'under_review'
  | 'closed';

export type DecisionType =
  | 'proceed'
  | 'renegotiate'
  | 'reject'
  | 'approve_with_conditions'
  | 'hold_payment'
  | 'require_remediation'
  | 'proceed_to_handover'
  | 'commission_valuation'
  | 'other';

export type DecisionStatus =
  | 'proposed'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'conditional'
  | 'implemented';

export type ReportKind =
  | 'executive_dd'
  | 'detailed_dd'
  | 'red_flag'
  | 'evidence_completeness'
  | 'open_risk_action'
  | 'changes_since_previous'
  | 'indicative_valuation'
  | 'handover_readiness'
  /** The engineer's report: building information, observations and mitigations, documents. */
  | 'technical_dd'
  /** The lawyer's report: title, requisitions answered, findings, documents. */
  | 'legal_dd'
  /** The financial report: valuation, questions answered, findings, documents. */
  | 'financial_dd'
  /** What changed over a period, what is waiting and on whom, and what comes next. See `status-report.ts`. */
  | 'status'
  /** One function's report, laid out by a template declared beside its fields. See `report-fields.ts`. */
  | 'function';

export type ReportStatus = 'draft' | 'generated' | 'reviewed' | 'issued' | 'superseded' | 'archived';

export type ValuationPremise = 'as_is' | 'as_completed' | 'residual' | 'forced_sale';
export type ValuationBasis = 'market_value' | 'investment_value' | 'liquidation' | 'replacement_cost';
export type ValuationApproach = 'market' | 'cost' | 'income' | 'residual';
export type ValuationSignOff = 'unsigned' | 'internal_review' | 'registered_valuer_required';
export type ValuationRunStatus = 'draft' | 'computed' | 'in_review' | 'issued' | 'superseded';

export type CapabilityKind = 'valuation' | 'cost' | 'schedule' | 'market' | 'benchmarking' | 'report_builder';
export type CapabilityRunStatus = 'not_run' | 'computed' | 'stale';

export type AiDraftKind =
  | 'finding'
  | 'risk'
  | 'action'
  | 'decision'
  | 'report_section'
  | 'check_comment'
  | 'orchestrator_plan';
export type AiDraftStatus = 'draft' | 'in_review' | 'accepted' | 'rejected' | 'committed';
export type AiDraftSource = 'rule' | 'model' | 'operator';

export type EvidenceKind =
  | 'document'
  | 'drawing'
  | 'approval'
  | 'contract'
  | 'boq'
  | 'invoice'
  | 'photograph'
  | 'schedule'
  | 'inspection'
  | 'test_report'
  | 'certificate'
  | 'correspondence'
  | 'market_comparable'
  | 'gis'
  | 'other';

export type ProjectStatus = 'draft' | 'active' | 'on_hold' | 'closed';

export type Probability = 'rare' | 'unlikely' | 'possible' | 'likely' | 'almost_certain';
export type ImpactScore = 1 | 2 | 3 | 4 | 5;

/* ------------------------------------------------------------------ */
/* Library definitions (reusable, not project instances)               */
/* ------------------------------------------------------------------ */

export type CheckFieldKind =
  /* --- plain values ------------------------------------------------ */
  | 'text'
  /** Free-flow prose. Rendered as a growing box, never a single line. */
  | 'longtext'
  | 'number'
  | 'money'
  | 'area'
  | 'percent'
  /** A span in days, months or years — the unit says which. */
  | 'duration'
  | 'date'
  | 'boolean'
  /* --- choices ------------------------------------------------------ */
  /** One of a fixed list. `control` decides dropdown, radio or segmented. */
  | 'enum'
  /** Several of a fixed list — checkboxes. */
  | 'multi_enum'
  /* --- things that are not typed in ---------------------------------- */
  /**
   * Derived from other fields by a declared formula. Never writable.
   *
   * The third place this product draws the same line: the graph splits
   * derived nodes from authored ones, the report splits bound blocks from
   * prose, and a computed field is the same idea at the smallest scale. If a
   * number can be worked out from other numbers, nobody should be able to
   * type a different one over it.
   */
  | 'computed'
  /**
   * Repeating rows with their own column schema — a title chain, a milestone
   * table, a schedule of tests. The thing people otherwise keep in a
   * spreadsheet beside the system, which is where DD facts go to die.
   */
  | 'table'
  /**
   * A reference to something on the evidence register: a document, a
   * photograph, a certificate. The value is an evidence id, so the file is
   * held once and cited from everywhere rather than re-uploaded per check.
   */
  | 'evidence'
  /**
   * A link to something entered once elsewhere: a party, a parcel, a work
   * package, a document, an approval, a milestone, or one record of a field
   * set that repeats (an owner, a case). The value is that thing's id, so it
   * is never typed a second time. `target` says which register.
   */
  | 'ref'
  /**
   * A standing worked out by the rule engine from other fields: the first of
   * its `cases` whose rule fires gives the label and the tone. Never written.
   * A standing a person sets by hand is an `enum`.
   */
  | 'status';

/** How a choice or a switch is drawn. Presentation only — the data is the same. */
export type CheckFieldControl = 'dropdown' | 'radio' | 'segmented' | 'switch' | 'checkbox' | 'tiles' | 'tick' | 'scale';

/* --- The field system (docs/fields.md) ------------------------------- */

/**
 * Where a field is: the function it belongs to, the set that holds it (a
 * check definition's id, or a field set's), and its key. `column` names one
 * column of a table field; `record` one row of a set that repeats.
 */
export interface FieldAddress {
  fn: string;
  set: string;
  field: string;
  column?: string;
  record?: string;
  /** One period of a set kept by period, by its key (`2026-09`, `FY2026-Q2`): the field as that period holds it. Absent, the open one. */
  period?: string;
}

export type Dimension = 'area' | 'length' | 'volume' | 'mass' | 'money' | 'time' | 'count' | 'ratio';
export type Tone = 'good' | 'warning' | 'critical' | 'neutral' | 'info';
export type FieldCurrency = 'INR' | 'USD' | 'AED' | 'EUR';

export interface OptionDef {
  key: string;
  label: string;
  tone?: Tone;
  /** No longer offered. A value saved under it still reads. */
  retired?: true;
}

/** A list of choices shared by several fields. */
export interface OptionSet {
  id: string;
  label: string;
  options: OptionDef[];
}

/** What a `ref` field links to: a register that exists, or the records of a field set that repeats. */
export type RefTarget = 'party' | 'parcel' | 'building' | 'unit' | 'drawing' | 'approval' | 'matter' | 'contract' | 'account' | 'package' | 'document' | 'milestone' | { set: string };

/** Where one side of a `match` table takes its list from: a field of every record of a set, a column of another table, or a register. */
export type MatchList =
  | { records: string; field: string }
  /** A column of a table kept inside each record of a set: the vendors named on every purchase. */
  | { records: string; table: string; column: string }
  | { table: FieldAddress; column: string }
  | { target: RefTarget };

/** One side of a `match` table: the column that holds its item, what the list is called, and where the list comes from. */
export interface MatchSide {
  column: string;
  label: string;
  of: MatchList;
  /** An item of this side needs no partner: a parcel named in no suit is in order. Nothing of it is left over. */
  optional?: true;
}

/**
 * One dated row of a rule table: a rate, a limit, a threshold or a period,
 * as a regulation states it for a place and a set of conditions.
 *
 * A figure that a law sets is never a constant in a field. It is a row here,
 * with where it applies, when it is in force and where it is written, so a
 * change in the law is a new row and not a formula nobody knows went stale.
 * A row nobody has checked against its source says so, and the screen says
 * so beside every value worked out from it.
 */
export interface RuleRow {
  /** What it is, by a key formulas name: `rera_deposit_share`, `far_limit`. */
  key: string;
  label: string;
  jurisdiction: { state?: string; city?: string; authority?: string };
  /** The conditions it applies under, each a value or a band: zone, road width band, plot band, occupancy, height band, grade. */
  when?: Record<string, string | { min?: number; max?: number }>;
  value: number;
  unit?: string;
  /** In force from this day, and until `to` where it has been replaced. */
  from: string;
  to?: string;
  source: { regulation: string; clause?: string; page?: number; url?: string };
  verified: boolean;
  verifiedBy?: string;
  verifiedOn?: string;
}

/**
 * A rule the table is to hold whose figure nobody has yet read in the
 * instrument: what it is, what it is keyed by and where it is written, with
 * no value. A formula may name it. It gives no answer until a row of the
 * same key is added, so a standing over it says the limit is not on file
 * and never passes for want of one.
 */
export interface RuleShape {
  key: string;
  label: string;
  jurisdiction: RuleRow['jurisdiction'];
  /** The conditions its rows will carry: zone, road width, plot band, occupancy, height band. */
  keyedBy: string[];
  unit?: string;
  source: RuleRow['source'];
}

/** A rule row a value was worked out from. */
export interface RuleCitation {
  key: string;
  label: string;
  value: number;
  unit?: string;
  from: string;
  source: RuleRow['source'];
  verified: boolean;
}

/** A condition inside a formula: two amounts compared, or what a field holds. */
export type FormulaCondition =
  | { left: CheckFormula; is: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne'; right: CheckFormula }
  | { field: string; at?: FieldAddress; is: 'set' | 'true' | 'false' | 'equals' | 'in'; value?: unknown }
  | { all: FormulaCondition[] }
  | { any: FormulaCondition[] };

/** A condition on one row of a table or one record of a set. */
export interface RowCondition {
  column: string;
  /**
   * `own` joins a row to the record the formula is worked out for: the row's
   * column holds that record's id, or, with `value` naming one of the
   * record's own fields, what that field holds. The claims of this contract,
   * the samples of this pour.
   */
  is: 'set' | 'true' | 'false' | 'equals' | 'in' | 'gt' | 'lt' | 'own';
  value?: unknown;
}

/** One condition on a row, or several at once: all of them, or any of them. */
export type RowWhere = RowCondition | { all: RowWhere[] } | { any: RowWhere[] };

/**
 * A window on a row's date column: the row counts where its day falls on or
 * between two days, each worked out by a formula (a date field of the record
 * the figure is for, as a rule). An end left out is open.
 */
export interface RowWindow {
  column: string;
  from?: CheckFormula;
  to?: CheckFormula;
}

/**
 * The rows a formula runs over: a table field of its own set, the records of
 * a set that repeats, or the rows of a table kept inside each record of such
 * a set (the receipts on every demand), read as one list.
 */
export type FormulaRows = { table: string } | { records: string } | { records: string; table: string };

/** How much of a sheet a field is: always shown, shown when its condition holds, or folded until asked for. */
export type FieldTier = 'core' | 'situational' | 'expert';

/**
 * Something true of a project, or of one function of it, that brings more
 * fields into play: a minor among the owners, agricultural land, a joint
 * development. Set by a person, or proposed from a paper and accepted.
 */
export interface Situation {
  key: string;
  label: string;
  scope: 'project' | 'function';
  hint?: string;
  /** What suggests it: a kind of paper on file, or a field holding a value. */
  proposeFrom?: { documentTypes?: string[]; field?: FieldAddress };
  /** Where it follows from what is recorded, nobody is asked: it is in play exactly when this holds ("more than one owner"). */
  derive?: ShowWhen;
  /**
   * Also in play, with nobody asked, whenever this holds: an approach whose
   * rate is already recorded. A person may still put it in play before then;
   * while this holds nobody takes it out.
   */
  impliedBy?: ShowWhen;
}

/** Who a field's value is waited on from, where it is not the reader's own department: a role on the project. */
export type OwedRole = 'owner' | 'advocate' | 'authority' | 'consultant' | 'contractor' | 'lender' | 'buyer';

export const OWED_ROLE_LABEL: Record<OwedRole, string> = {
  owner: 'The owner',
  advocate: 'The advocate',
  authority: 'The authority',
  consultant: 'The consultant',
  contractor: 'The contractor',
  lender: 'The lender',
  buyer: 'The buyer',
};

/**
 * Who owes a field's value: a role, or the party a `ref` field of the same
 * holder links to (`{ ref: 'seller' }`). Absent, the function's own people
 * owe it.
 */
export type OwedBy = OwedRole | { ref: string };

/**
 * A hard case's own small sheet, opened from the holder that needs it: a
 * partition suit on a case, a guardian's permission on a minor owner. At most
 * twenty fields in at most four sections, and no list inside. Its fields are
 * kept on the holder it opens from, under their own keys, so a key here is
 * never one of the set's own.
 */
export interface DepthSheet {
  id: string;
  title: string;
  /** When the holder needs it, read from that holder. */
  showWhen: ShowWhen;
  fields: CheckFieldDef[];
  rules: CheckInsightRule[];
  sections?: FieldSection[];
}

/** When a field or a section shows. */
export type ShowWhen =
  | { situation: string }
  | { field: FieldAddress; is: 'set' | 'true' | 'false' | 'equals' | 'in' | 'gt' | 'lt'; value?: unknown }
  /** Over the records of a set that repeats: any, none, or at least `n`, of those meeting `where`. */
  | { records: string; is: 'any' | 'none' | 'at_least'; n?: number; where?: RowWhere }
  | { all: ShowWhen[] }
  | { any: ShowWhen[] };

/** A named part of a sheet. A field joins one by naming its key in `section`. */
export interface FieldSection {
  key: string;
  label: string;
  tier?: FieldTier;
  showWhen?: ShowWhen;
}

/**
 * The fields one function keeps, declared as data.
 *
 * A check's fields are one holder and a function's sheet is another; both are
 * read through the registry (`field-registry.ts`). A set with `records` is
 * one that repeats: owners, parcels, cases. Each record is a small sheet of
 * its own, and the page lists them by `titleField` with `summaryFields` as
 * chips.
 */
export interface FieldSet {
  id: string;
  /** The function it belongs to: a workstream key, as `legal.title`. */
  fn: string;
  title: string;
  v: number;
  fields: CheckFieldDef[];
  rules: CheckInsightRule[];
  sections?: FieldSection[];
  records?: { of: string; titleField: string; summaryFields: string[] };
  /** The situations this set's fields answer to. Declared here so a catalog is one file. */
  situations?: Situation[];
  /** The shared lists this set's fields choose from. */
  optionSets?: OptionSet[];
  /**
   * Adds this set's fields to a set that repeats declared elsewhere (a
   * shared record: party, parcel, unit), in place of making a sheet. The
   * department's own facts about a party sit on the one party record.
   */
  extends?: string;
  /** Hard cases, each a small sheet of its own opened from the holder that needs it (docs/fields.md, Depth sheets). */
  sheets?: DepthSheet[];
  /** The reports this set's function hands over, each an ordered list of sections. See `report-fields.ts`. */
  reports?: FieldReportTemplate[];
  /** Kept by period: opened from the last, compared with it, due, and issued by a named person (`field-periods.ts`). */
  periodic?: Periodic;
}

/**
 * One section of a function's report.
 *
 * `fields` prints named fields with where each came from. `table` prints a
 * table field, `records` the records of a set that repeats, `chart` draws
 * one of either. `note` is a place for a person's own words, capped.
 * `register` is a reading of the project's registers, as any report has. A
 * field named by its key alone is a field of the set the template sits on.
 */
export type FieldReportSection =
  | { heading: string; fields: Array<string | FieldAddress>; layout?: 'list' | 'table' }
  | { heading: string; table: string | FieldAddress; columns?: string[] }
  | { heading: string; records: string; columns?: string[] }
  /** `of: { periods }` draws one field of a set kept by period, period by period: `y` is the field, `x` is not read, and `moved` draws what each period added to a running total. */
  | { heading: string; chart: { of: string | FieldAddress | { records: string } | { periods: string }; x: string; y: string; mark?: 'bar' | 'line'; moved?: true } }
  | { heading: string; note: { maxLength: number; hint?: string } }
  | { heading: string; register: ReportBoundSource };

/** A report a function hands over: its sections in order. A person may then arrange them. */
export interface FieldReportTemplate {
  /** Never reused: a report made from it keeps this. */
  id: string;
  title: string;
  /** The function it is of. Left out on a template declared on a field set, which is its set's. */
  fn?: string;
  sections: FieldReportSection[];
}

/** Where a field's value stands with a person. */
export type FieldState = 'empty' | 'proposed' | 'accepted' | 'typed' | 'disputed' | 'not_applicable' | 'assumed';

/** Why a field or a section does not apply: one of five, so a report can print it and nobody writes a sentence. */
export type NaReason = 'not_in_this_project' | 'not_at_this_stage' | 'done_by_another_party' | 'exempt' | 'no_such_paper';

export const NA_REASONS: readonly NaReason[] = ['not_in_this_project', 'not_at_this_stage', 'done_by_another_party', 'exempt', 'no_such_paper'];

export const NA_REASON_LABEL: Record<NaReason, string> = {
  not_in_this_project: 'Not in this project',
  not_at_this_stage: 'Not at this stage',
  done_by_another_party: 'Done by another party',
  exempt: 'Exempt',
  no_such_paper: 'No such paper',
};

/**
 * A usual value that stands in until the real one is known: thirty years of
 * title search in Karnataka, a notice period under a form of contract. The
 * first whose condition holds is taken. It is shown as assumed, feeds what
 * is worked out, and gives way the moment a value is typed or accepted.
 */
export interface DefaultRule {
  when?: ShowWhen;
  value: string | number | boolean;
  from: 'state_pack' | 'contract' | 'firm' | 'catalog';
  /** Where the usual value is written. Required unless it is the firm's own. */
  cite?: string;
}

/** Where a value came from. */
export type FieldOrigin =
  | { kind: 'paper'; evidenceId: string; page: number; quote: string; reader: 'parser' | 'model'; proof?: 'page_text' | 'second_reader' | 'unverified' }
  | { kind: 'external'; source: string; url?: string; asOf: string; quote?: string }
  | { kind: 'field'; address: FieldAddress }
  | { kind: 'person' }
  | { kind: 'default'; from: DefaultRule['from']; cite?: string };

/**
 * A value a field held before the one it holds now: what stood, who made it
 * stand and from when, and when it stopped standing. Only what stood is kept:
 * a value somebody offered, one in dispute and a usual value standing in
 * never enter. A table keeps how many rows it had, never the rows.
 */
export interface FieldPast {
  value: string | number | boolean | string[] | null;
  /** A table's rows, counted. */
  rows?: number;
  entered?: { value: number; unit: string; text?: string };
  state: 'accepted' | 'typed' | 'not_applicable' | 'empty';
  /** Where it came from, its quoted words cut to 80 characters. */
  origin?: FieldOrigin;
  /** Who made it stand, and when. */
  by: string;
  at: string;
  /** When it stopped standing. */
  until: string;
  /** Entries that came after this one were thinned out: between `until` and the next entry kept, the record no longer says what stood. */
  thinnedAfter?: true;
}

/**
 * How often a set is kept: by the week, the month, the quarter or the year, or
 * once for each record of another set (a lender's engineer reports once for
 * each drawdown). `on` names that record's own day, which the instance is due
 * from.
 */
export type PeriodEvery = 'week' | 'month' | 'quarter' | 'year' | { event: string; on?: string };

/**
 * Rows that explain a figure of a period: dated rows of a table or of another
 * set's records, summed where their day falls inside the period. They explain
 * how far the figure moved since the last period (`movement`, the default) or
 * the period's own amount (`amount`: the month's collections against the
 * receipts dated in it). What they leave is "unexplained".
 */
export interface PeriodAttribute {
  field: string;
  rows: FormulaRows;
  date: string;
  amount: string;
  label: string;
  of?: 'movement' | 'amount';
}

/**
 * A set kept by period (docs/fields.md, Periods).
 *
 * On a set that repeats, with `by`, each record is one period's instance: the
 * month a cash record is for, the quarter a certificate covers. On a sheet
 * held once, the sheet is the open period and each period issued is kept
 * beside it, frozen (`StoredFieldSheet.periods`).
 */
export interface Periodic {
  every: PeriodEvery;
  /** On a set that repeats: the field that names the period. A date, the year as written, or for `event` the link to the event's record. */
  by?: string;
  /** On a set that repeats: fields that tell one instance from another inside a period (the certificate's kind, the building). */
  per?: string[];
  /** Keys copied from the last instance when a new one is opened; the rest open blank. */
  carry?: string[];
  /** Keys that are running totals: what moved in the period is this less the last. */
  cumulative?: string[];
  /** When the period is due after it ends: so many days, or a rule row that gives the days or months. */
  due: { days: number } | { rate: string };
  /** Who issues it: a lead of the department (a signer may too), its signer, or an outside party whose name is then given. */
  issuer: 'lead' | 'signer' | OwedRole;
  attribute?: PeriodAttribute[];
  /** The option set a person picks from for what the rows do not explain. Never prose. */
  reasons?: string;
}

/** One field of a period as it read when the period was issued: its value, how it printed, and the footnote it carried. */
export interface FrozenField {
  value: CheckFieldValue['value'];
  said: string;
  footnote?: string;
  /** The paper the footnote cites, so a copy that does not hold the paper does not hold the footnote. */
  evidenceId?: string;
  /** Worked out, a standing or a mirror: nobody entered it. */
  derived?: true;
  tone?: Tone;
}

/** One issued period of a sheet held once: every field as it read at issue. The open period is the sheet itself. */
export interface FieldPeriod {
  /** `2026-09`, `FY2026-Q2`, `2026-W41`. */
  key: string;
  /** Its first and last day, inclusive. */
  from: string;
  to: string;
  status: 'open' | 'issued';
  /** What the sheet stored of the period: the typed and accepted fields. */
  values: Record<string, CheckFieldValue>;
  /** Every field in play at issue, the worked-out ones among them. */
  frozen?: Record<string, FrozenField>;
  openedAt: string;
  openedBy: string;
  issuedAt?: string;
  issuedBy?: string;
  issuedName?: string;
  /** The issue of the same period this one corrects, by its `issuedAt`. */
  revises?: string;
  /** What a person picked for a figure's unexplained movement, by field key. */
  reasons?: Record<string, string>;
}

/** One record of a set that repeats. */
export interface FieldRecord {
  id: string;
  values: Record<string, CheckFieldValue>;
  createdAt: string;
  by: string;
  /** Taken off the list. Kept, with who took it off. */
  removed?: { by: string; at: string };
  /** On a set kept by period: issued by a named person. An issued record is never edited; a correction is a revision kept beside it. */
  issued?: { by: string; at: string; name?: string };
  /** Every field as it read at issue, the worked-out ones among them. */
  frozen?: Record<string, FrozenField>;
  /** The issued record this one corrects. Until this one is issued the other stands; once it is, this one does. */
  revises?: string;
  /** The fields filled from the last period when this one was opened, and the period they came from. */
  carried?: { from: string; at: string; keys: string[] };
  /** What a person picked for a figure's unexplained movement, by field key. */
  reasons?: Record<string, string>;
}

/** What a project holds for one field set. */
export interface StoredFieldSheet {
  values: Record<string, CheckFieldValue>;
  records?: FieldRecord[];
  /** Sections marked not applicable, each with the reason. */
  na?: Record<string, { reason: NaReason | string; note?: string; by: string; at: string }>;
  /** On a sheet kept by period: the periods issued, each frozen. The sheet itself is the open one. */
  periods?: FieldPeriod[];
  /** The period the sheet is open on, and what it carried from the last. */
  open?: { key: string; openedAt: string; openedBy: string; carried?: { from: string; keys: string[] }; reasons?: Record<string, string> };
  /** On a reading of the project as at a past day: the issued period that covers the day, whose frozen fields are what the sheet reads. Never stored. */
  asIssued?: Pick<FieldPeriod, 'key' | 'frozen' | 'issuedAt' | 'issuedBy' | 'issuedName'>;
}

/** A line under Due soon put off by a person until a day. It comes back that day, or sooner if it starts failing. */
export interface FieldSnooze {
  until: string;
  by: string;
  at: string;
}

/** Whether a situation is in play on a project, and who said so. */
export interface SituationState {
  /** `proposed` waits for a person, and brings no field into play until accepted. */
  state: 'on' | 'off' | 'proposed';
  by: string;
  at: string;
  /** The paper and page that suggested it. */
  suggestedBy?: { evidenceId: string; page?: number; quote?: string };
}

/**
 * How strongly a value must be backed by something on file.
 *
 * This is the property that separates a diligence record from a form. An
 * extent read off a registered deed and an extent somebody remembered are not
 * the same fact, and a schema that cannot tell them apart will let the second
 * one reach a report wearing the first one's authority.
 */
export type CheckFieldProof = 'required' | 'expected' | 'none';

/**
 * A formula over other fields on the same check.
 *
 * A tiny expression tree rather than a string to parse, because the two
 * things that matter are that it cannot execute anything and that a reader
 * can see what it computes. Every leaf is either a field key or a literal.
 */
export type CheckFormula =
  /**
   * With `at`, the field is read from another set or another function
   * (`resolveFields`). With `via` as well, `at` names a field of a set that
   * repeats and `via` one of this set's own links: the field is read from
   * the record that link holds (the completion date of this claim's contract).
   */
  | { op: 'field'; key: string; at?: FieldAddress; via?: string }
  /**
   * A figure another part of the product already works out: progress from
   * the milestones, the last day on the site log, a package's award. Read,
   * never entered here (`field-figures.ts`). `of` names one of this set's own
   * links, where the figure is of one thing: a work package, a building.
   * `asAt` names one of this holder's own dates: the figure is then read as
   * the project stood when that day ended, where the day has gone by (the
   * progress a quarter's row reports is the progress at the quarter's end).
   */
  | { op: 'figure'; key: string; of?: string; asAt?: string }
  /**
   * How far a figure of this holder has moved: what it is now less what it was. `last_period` is since the last period
   * issued of a set kept by period; `{ days }` is since so many days ago, read from the record as it stood then. No
   * answer where the record does not reach that far: a movement nobody can tell is not nought.
   */
  | { op: 'moved'; key: string; since: 'last_period' | { days: number } }
  /** Over the records of a set that repeats: how many there are, or one numeric field of theirs summed. */
  | { op: 'records'; set: string; reduce: 'count' | 'sum' | 'min' | 'max' | 'spread_pct'; field?: string }
  /**
   * One field of the latest record of a set: the record whose `by` date is the
   * last, among those meeting `where`. The sanction as last revised, the
   * newest statement. A record that states no `by` day is dated by `orBy`
   * where one is named. A date field is read as its day number.
   */
  | { op: 'records'; set: string; reduce: 'latest'; by: string; orBy?: string; field: string; where?: RowWhere }
  /** The least or the most of several amounts. One that is not known is left out. */
  | { op: 'min' | 'max'; of: CheckFormula[] }
  | { op: 'if'; when: FormulaCondition; then: CheckFormula; else: CheckFormula }
  /** One column summed, or the rows counted, over the rows that meet a condition. */
  | { op: 'sum_if'; over: FormulaRows; column: string; where: RowWhere; between?: RowWindow }
  /**
   * `asAt` counts the rows that stood on a past day: begun on or before it
   * (`from`) and not yet ended (`until`, where the row has one). `distinct`
   * counts each value of a column once: a family that holds three units is
   * one allottee.
   */
  | { op: 'count_if'; over: FormulaRows; where: RowWhere; between?: RowWindow; asAt?: { from: string; until?: string; on: CheckFormula }; distinct?: string }
  /**
   * Days covered by dated spans, each from its `from` day to its `to` day,
   * with spans that overlap counted once. `within` cuts the count to a period;
   * `uncovered` is the days of that period no span covers, never below zero.
   */
  | { op: 'span_days'; over: FormulaRows; from: string; to: string; where?: RowWhere; within?: { from: CheckFormula; to: CheckFormula }; reduce: 'covered' | 'uncovered' }
  /**
   * A figure a regulation sets, read from the rule table: the row for the
   * project's place in force on a day, under conditions taken from fields.
   * `on` names a date field; without it the day is today.
   */
  | { op: 'rate'; table: string; on?: string; where?: Record<string, { field: string } | { value: string | number }> }
  /** The yearly rate of return of dated cash flows held in a table, as a percentage. */
  | { op: 'irr'; over: FormulaRows; date: string; amount: string }
  /** Dated cash flows discounted to the first of them, at a yearly rate given as a percentage. */
  | { op: 'npv'; rate: CheckFormula; over: FormulaRows; date: string; amount: string }
  /** A date field as a day number, so days can be added to it or two dates compared. A computed field that yields a date turns it back. */
  | { op: 'date'; key: string; at?: FieldAddress; via?: string }
  | { op: 'today' }
  | { op: 'add_days'; date: CheckFormula; days: CheckFormula }
  | { op: 'add_months'; date: CheckFormula; months: CheckFormula }
  | { op: 'const'; value: number }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide'; left: CheckFormula; right: CheckFormula }
  /** `100 * (left - right) / right`, the shape most DD variances take. */
  | { op: 'variance_pct'; left: CheckFormula; right: CheckFormula }
  /** Sum one numeric column of a table field. */
  | { op: 'sum'; table: string; column: string }
  /** How many rows a table field holds. */
  | { op: 'count'; table: string }
  /** Whole days between two date fields, left minus right. */
  | { op: 'days_between'; left: string; right: string }
  /**
   * `left` raised to `right`.
   *
   * Added for the one shape the other operators cannot express: a present
   * value, `amount ÷ (1 + rate) ^ years`. Without it the residual's discount
   * back from completion had to live in TypeScript, which is why the residual
   * could take nine inputs on the check sheet and show no arithmetic at all
   * until somebody ran a valuation.
   */
  | { op: 'power'; left: CheckFormula; right: CheckFormula };

/**
 * A fact this check is actually about, declared so it can be recorded as a
 * value rather than described in a comment box.
 *
 * See `check-fields.ts` for why the prose was not enough.
 */
export interface CheckFieldDef {
  key: string;
  label: string;
  kind: CheckFieldKind;
  /** sqm, ft, INR, years — shown beside the input and carried into the report. */
  unit?: string;
  options?: string[];
  hint?: string;
  /** Which document is expected to supply it. Shown so a person knows where to look. */
  from?: string;
  /** Defaults to true. A false here means the check can be complete without it. */
  required?: boolean;
  /** How the control is drawn. Presentation only. */
  control?: CheckFieldControl;
  /** Whether this value has to cite something on the evidence register. */
  proof?: CheckFieldProof;
  /** `computed` only: what it works out. */
  formula?: CheckFormula;
  /** `table` only: the columns of each row. Columns cannot themselves be tables. */
  columns?: CheckFieldDef[];
  /** `evidence` only: what kind of file this expects, for the picker's filter. */
  accepts?: 'document' | 'image' | 'any';
  /** Numeric guards, checked on write so an impossible figure is refused at the door. */
  min?: number;
  max?: number;

  /* --- the field system: every member optional, absent reads as before --- */

  /** The section of the sheet it sits in, by key. */
  section?: string;
  tier?: FieldTier;
  showWhen?: ShowWhen;
  /** What is measured. The value is kept in the dimension's base unit (sqm, m, the field's currency) with what was typed beside it. */
  dimension?: Dimension;
  /** The units a person may type in. Defaults to every unit of the dimension. */
  enterIn?: string[];
  currency?: FieldCurrency;
  /** Decimal places shown. */
  precision?: number;
  /** A shared list, by id. `options` stays for a list used once. */
  optionSet?: string;
  /** What a text field completes from: an option set's id, or a register (`party`, `parcel`, …). */
  suggest?: string;
  /** `ref` only: what it links to. */
  target?: RefTarget;
  /** Read here, entered there. Never writable here. */
  sameAs?: FieldAddress;
  /** `status` only. The first case whose rule fires gives the label and tone; none firing is `otherwise`. */
  cases?: Array<{ when: CheckInsightRule; label: string; tone: Tone }>;
  otherwise?: { label: string; tone: Tone };
  /** `evidence` only: how the file is shown. */
  viewer?: 'pdf' | 'image' | 'drawing' | 'deed' | 'ifc';
  /** `table` only: drawn as a timeline, as two columns matched, or as a chart. */
  display?: 'timeline' | 'match' | 'chart';
  /**
   * `display: 'match'`: the lists paired. Whatever of any list no row pairs is
   * left over, and needs a person. `also` adds further lists paired to the
   * left one (a survey number to its RTC owner, its last purchaser and its
   * khata holder). `agree` names the columns that should read the same on a
   * row; a row where they differ needs a person too.
   */
  match?: { left: MatchSide; right: MatchSide; also?: MatchSide[]; agree?: string[] };
  /**
   * `display: 'chart'`: the columns drawn. `bar` is a bar for each row, `line`
   * a line over the `x` column in its own order (dates in date order), and
   * `stacked` one bar for each `x` built of the rows' `y` by their `stack`
   * column.
   */
  chart?: { x: string; y: string; mark?: 'bar' | 'line' | 'stacked'; stack?: string };
  /** `computed` only: the formula gives a day, and the value is kept as a date. */
  yields?: 'date';
  /** `longtext`: the most a person may write. Required on a field set; 600 where a check leaves it out. */
  maxLength?: number;
  /** No longer asked. A value saved under it is kept and shown as no longer asked. */
  retired?: true;
  /** The version of its set that introduced it. */
  since?: number;
  /**
   * How the field is drawn over time, inside the popover its label opens: a line or bars, one point a period (`periods`,
   * on a set kept by period or a figure that keeps readings) or one for each value it has held (`history`). `against`
   * names a second field of the same holder drawn beside it: planned against actual. `last` keeps the latest so many.
   */
  trend?: { over: 'history' | 'periods'; mark: 'line' | 'bar'; against?: string; last?: number };
  /** The kinds of paper that state it, by the register's document type. A paper of one of these kinds filed on the project offers its value here. */
  fromTypes?: string[];
  /** The key a paper's reading files the value under, where it is not this field's own. */
  factKey?: string;
  /** Usual values, first match wins. One that applies stands in as `assumed` until a real value arrives. */
  defaults?: DefaultRule[];
  /** A must-field only while this holds. Absent, it follows `required`. */
  requiredWhen?: ShowWhen;
  /** `date` only: a day that runs out. Past it, or within `leadDays` of it, the function's page says so. */
  expires?: { leadDays: number };
  /** Choices once offered and no longer. A value saved under one still reads; a new one is refused. */
  retiredOptions?: string[];
  /**
   * From when it is expected: a step of the project (`approvals`,
   * `construction`, …) or a day (`YYYY-MM-DD`). Before then it shows, takes a
   * value, and is neither counted nor listed as empty.
   */
  dueFrom?: LifecycleStage | string;
  /** Who owes its value, where that is not the function's own people. It is then listed under that party, never as the reader's to fill. */
  owedBy?: OwedBy;
  /** The depth sheet it belongs to. Set by the catalog from `FieldSet.sheets`; never written in a field set. */
  sheet?: string;
  /** Added by the firm, not built in. Set by the firm's overlay. */
  firm?: true;
  /** Set by the catalog on a field a department adds to a shared record with `extends`: the function that added it. Never declared. */
  addedBy?: string;
}

/** Anything a caller may write into a field. Mirrors `CheckFieldValue['value']`. */
export type CheckFieldWrite = string | number | boolean | string[] | CheckTableRow[] | null;

/** One row of a table field, keyed by column. */
export type CheckTableRow = Record<string, string | number | boolean | null>;

export interface CheckFieldValue {
  value: string | number | boolean | string[] | CheckTableRow[] | null;
  /** The evidence row this was read off, when it came from a document. */
  sourceEvidenceId?: string;
  /** The page of that document the value is on, when it was read off one. */
  page?: number;
  /** The document's own words for the value, never rewritten. */
  quote?: string;
  at: string;
  by: string;

  /* --- the field system: absent members read as before ------------------ */

  /** Absent reads as `accepted` where the value cites a paper, `typed` where it does not. */
  state?: FieldState;
  origin?: FieldOrigin;
  /** What was typed, in the unit it was typed in: a deed's "1 acre 22 guntas" prints that way. */
  entered?: { value: number; unit: string; text?: string };
  /** Who or what proposed it: a person's name, `model`, or `parser`. */
  proposedBy?: string;
  acceptedBy?: string;
  acceptedAt?: string;
  /** Other values stated for this field. One here waits beside the value held; with `state: 'disputed'` neither stands. */
  other?: Array<{ value: CheckFieldValue['value']; origin: FieldOrigin; proposedBy?: string; at?: string; entered?: { value: number; unit: string; text?: string }; card?: string }>;
  /** On a check: the card a value that waits is read from. Never stored: set when the check is read as a sheet (`check-waiting.ts`). */
  card?: string;
  /** Values a person set aside here, so the same reading is not offered a second time. */
  declined?: Array<{ value: CheckFieldValue['value']; by: string; at: string }>;
  /** Why it does not apply, where `state` is `not_applicable`: one of five keys. A value saved with words of its own still reads. */
  naReason?: NaReason | string;
  /** A person's short note beside the reason. */
  naNote?: string;
  /** The version of the set the value was saved under. */
  v?: number;
  /** The rule rows a worked-out value was read from. Never stored: set when the value is resolved. */
  cites?: RuleCitation[];
  /** The usual values a worked-out value rests on, each by its field's label: nobody entered them. Never stored: set when the value is resolved. */
  assumes?: string[];
  /** A worked-out zero that is a sum over nothing entered: no rule fires on it and no standing is drawn from it. Never stored: set when the value is resolved. */
  overNothing?: boolean;
  /** What the field held when it was marked not applicable: put back as it was when the field is asked again. */
  was?: Omit<CheckFieldValue, 'was' | 'history'>;
  /** What stood here before, newest first, at most twenty-four (`field-history.ts`). Written only by `stand`. */
  history?: FieldPast[];
  /** From when the value held has stood, where that is neither `acceptedAt` nor `at`: kept after a dispute, asked again after not applicable. */
  since?: string;
  /**
   * On a reading of the project as at a past day: the record does not reach that day for this value, and it is today's.
   * The day history of it begins. Never stored: set by `projectAsAt`, and carried onto whatever is worked out from it.
   */
  asNow?: string;
}

/**
 * A rule that turns recorded values into an observation.
 *
 * Arithmetic, not generation: the engine owns conclusions drawn from numbers,
 * exactly as it owns the screen's. A model may read an insight; it may not
 * author one.
 */
export interface CheckInsightRule {
  /**
   * `require_if` is the conditional one: a field that is only needed because
   * of what another field says. A quoted super built-up area needs a RERA
   * carpet figure beside it; a quoted carpet area does not, and a plain
   * `require` would nag on both.
   */
  /**
   * `at_least` and `at_most` are the directional ones: the first field must
   * reach the second, or must not pass it. `compare` cannot say "consents
   * must reach two-thirds", only that two figures differ.
   */
  kind: 'compare' | 'before' | 'require' | 'require_if' | 'row_expired' | 'row_missing' | 'at_least' | 'at_most';
  /** The rule exists only while this holds. Read by a sheet; a check's own rules carry none. */
  when?: ShowWhen;
  /** The depth sheet it belongs to. Set by the catalog from `FieldSet.sheets`; never written in a field set. */
  sheet?: string;
  /** A key in `fields` that is another set's field, by its address: a rule may read another function. */
  at?: Record<string, FieldAddress>;
  /** `compare`, `at_least`, `at_most`: a figure in place of the second field. */
  against?: number;
  /** The field keys the rule reads, in the order the template names them. */
  fields: string[];
  /** Relative tolerance for `compare`. Defaults to 1%. */
  tolerance?: number;
  /** `require_if` and `row_missing`: the gate values that make the other field necessary. */
  whenIn?: string[];
  /**
   * The row rules read INSIDE a table, which is where a register of eight NOCs
   * or twenty approval conditions actually lives. `fields` names the table;
   * `column` names the cell the rule is about, and `gate` the cell that
   * decides whether it matters — an expired date on a NOC marked "not
   * required" is not a finding.
   */
  column?: string;
  gate?: string;
  /** Template with {a}, {b}, {divergence}, {tolerance}. */
  say: string;
  severity: FindingSeverity;
}

export interface CheckInsight {
  severity: FindingSeverity;
  text: string;
  fields: string[];
  /** Always true today. Present so a model-authored one could never pass as computed. */
  computed: boolean;
}

export interface CheckDefinition {
  id: string;
  scopeKey: ScopeKey;
  section: string;
  title: string;
  purpose: string;
  expectedEvidence: string[];
  acceptanceCriteria: string;
  method: string;
  severityGuidance: string;
  standards?: string;
  /** What this check records, beyond a result and a comment. */
  fields?: CheckFieldDef[];
  /** What the recorded values mean, computed. */
  insightRules?: CheckInsightRule[];
}

export interface ScopeDefinition {
  key: ScopeKey;
  label: string;
  purpose: string;
  sections: string[];
  typicalEvidence: string[];
  typicalFindings: string[];
}

export interface DdTypeDefinition {
  key: DdTypeKey;
  label: string;
  purpose: string;
  typicalStages: LifecycleStage[];
  defaultScopes: ScopeKey[];
  defaultReportKind: ReportKind;
}

/* ------------------------------------------------------------------ */
/* Project records                                                     */
/* ------------------------------------------------------------------ */

export interface Stakeholder {
  id: string;
  name: string;
  role: string;
  organisation?: string;
}

export interface StageRecord {
  id: string;
  subject: 'project' | 'asset';
  assetId?: string;
  stage: LifecycleStage;
  previousStage?: LifecycleStage;
  effectiveAt: string;
  actor: string;
  reason: string;
  evidenceIds: string[];
}

export interface Asset {
  id: string;
  parentId?: string;
  name: string;
  /** This product's own word for what it is — free text, and it stays free. */
  assetType: string;
  /**
   * Uniclass 2015 Entities code, when somebody has classified it.
   *
   * Optional and additive: `assetType` is what the team calls it, this is what
   * a cost consultant or a BIM model calls the same thing. Neither replaces
   * the other, and an unclassified asset is not a defective one.
   */
  uniclassCode?: string;
  uniclassTitle?: string;
  description?: string;
  zone?: string;
  currentStage: LifecycleStage;
  stageHistory: StageRecord[];
  responsible?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckInstance {
  id: string;
  definitionId: string;
  scopeInstanceId: string;
  assessmentId: string;
  section: string;
  title: string;
  purpose: string;
  expectedEvidence: string[];
  acceptanceCriteria: string;
  result: CheckResult;
  evidenceIds: string[];
  findingIds: string[];
  comments: string;
  /**
   * The facts this check recorded, keyed by field.
   *
   * Absent on a check instantiated before its definition declared any, which
   * is why every reader goes through `readCheckFields` rather than indexing
   * into it directly.
   */
  fields?: Record<string, CheckFieldValue>;
  owner?: string;
  reviewer?: string;
  updatedAt: string;
}

export interface ScopeInstance {
  id: string;
  scopeKey: ScopeKey;
  assessmentId: string;
  status: ScopeStatus;
  owner?: string;
  reviewer?: string;
  exclusionReason?: string;
  materialityNote?: string;
  checks: CheckInstance[];
  createdAt: string;
  updatedAt: string;
}

export interface DdAssessment {
  id: string;
  name: string;
  ddType: DdTypeKey;
  objective: string;
  targetType: DdTargetType;
  targetAssetIds: string[];
  stageAtAssessment: LifecycleStage;
  owner: string;
  reviewer?: string;
  periodStart?: string;
  periodEnd?: string;
  status: AssessmentStatus;
  priorAssessmentId?: string;
  outputReportKind: ReportKind;
  scopes: ScopeInstance[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceRecord {
  id: string;
  title: string;
  kind: EvidenceKind;
  description?: string;
  source?: string;
  owner?: string;
  status: EvidenceStatus;
  considered: boolean;
  used: boolean;
  assetIds: string[];
  assessmentIds: string[];
  scopeInstanceIds: string[];
  checkIds: string[];
  supersedesId?: string;
  supersededById?: string;
  rejectionReason?: string;
  fileName?: string;
  /**
   * ISO 19650 information-container reference, as far as it is known.
   *
   * The filename it arrived as stays in `fileName` — this is the structured
   * reading of it, and every part is optional because a diligence pack
   * collects documents from a dozen sources and most arrive with none of it.
   */
  iso19650?: Iso19650Ref;
  attachments: EvidenceAttachment[];
  /** Verbatim DI quotes copied off the ingest card when the person approved. */
  quotes?: Array<{ text: string; page?: number }>;
  extractionNotes?: string;
  /**
   * What the filed document states, each with its page and its own words.
   *
   * Copied off the ingest card on approval. Kept on the row, not only pushed
   * into checks, because most of a file arrives before the DD that would ask
   * for it exists — the extent is read in week one and the parcel check is
   * instantiated in week two. When it is, these are what it is offered.
   */
  facts?: import('./document-parse').DocumentFact[];
  /** What the document was read as — "Sale deed", "Encumbrance certificate". */
  documentType?: string;
  /**
   * What a model took the paper for, where the rules could not say and no
   * person has. An offer: it names nothing on the register, answers no
   * waiting row and types no fact until a person makes it the type.
   */
  proposedDocumentType?: string;
  /**
   * An offer a person refused for this paper: set aside, or corrected to
   * something else. The same offer is not made again when the paper is read
   * again.
   */
  refusedDocumentType?: string;
  /**
   * The workstream that owns it, when a person said so. Otherwise it is read
   * from what the document is; see `documentWorkstream`.
   */
  workstream?: string;
  /** How its words were obtained: its own text layer, or OCR of a scan. */
  readMethod?: 'text' | 'ocr' | 'mixed';
  /**
   * When a model last read it. A reading can describe a document without
   * placing a single value on a page — a route with no verified citations
   * cannot — and such a document is read, not waiting to be.
   */
  modelReadAt?: string;
  /**
   * Which reader read it, as `MODEL_READER_VERSION` stood then. Absent on a
   * row read before it was recorded, which counts as version 1. A row read by
   * an older reader that placed nothing is read again when the filed
   * documents are read: the newer reader may place what the older could not.
   */
  modelReadVersion?: number;
  /** A photograph chosen to print in the report on its own, beside the ones the observations cite. */
  inReport?: boolean;
  /** Set while this paper is an outside party's reply nobody has confirmed: it answers no checklist line by its name until a person does. */
  unconfirmedReply?: { requestId: string; replyId: string };
  createdAt: string;
  updatedAt: string;
  /**
   * The screen flag that raised this record, when the screen raised it.
   *
   * `runProjectScreen` has to know whether it has already filed a given
   * finding, or a second run files the missing-khata finding twice. It used to
   * answer that by appending `[screen:<code>]` to the record's own prose and
   * reading it back — which worked, and put twenty internal keys in front of
   * readers, four of them inside the red flag report that goes to a client.
   *
   * The same fact, in a field, where a reader never meets it.
   */
  screenCode?: string;
}

export interface EvidenceAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedAt: string;
  /**
   * How much of this file was read when it was last read, by which reader,
   * and what was sent to a model. Absent on a file read before this was kept.
   */
  reading?: ReadingCoverage;
  /**
   * Where and when this file claims it was captured, and who claims it.
   *
   * On a photograph this is most of what makes it evidence rather than a
   * picture. Absent on a deed, and correctly so — a scanned conveyance has no
   * capture facts, and inventing an uploaded-at as a taken-at would turn the
   * moment somebody dragged a file into the browser into a statement about
   * when the property looked like that.
   */
  capture?: CaptureFacts;
  /**
   * What a model saw, kept apart from what the photographer said.
   *
   * Never merged into `capture.caption`. The caption is a person's; this is a
   * reading, and a sentence with no author is the one thing a diligence file
   * cannot carry.
   */
  observation?: PhotoObservation;
  /**
   * What the photograph shows, in words a person stands behind.
   *
   * A model's reading sits in `observation` as a suggestion. It becomes this
   * only when a person accepts it or writes their own, the same way a value
   * read off a document waits to be accepted before anything relies on it.
   */
  shows?: { text: string; by: string; at: string; fromModel: boolean };
  /** Where the file was taken from, when a connected folder brought it and no person dropped it. */
  origin?: import('./connectors').FileOrigin;
}

export interface FindingRecord {
  id: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  discipline: ScopeKey;
  status: FindingStatus;
  owner?: string;
  reviewer?: string;
  confidenceNote?: string;
  sourceAssessmentId?: string;
  sourceScopeId?: string;
  sourceCheckId?: string;
  assetIds: string[];
  assessmentIds: string[];
  scopeInstanceIds: string[];
  evidenceIds: string[];
  riskIds: string[];
  actionIds: string[];
  decisionIds: string[];
  duplicateOfId?: string;
  supersededById?: string;
  includeInReport: boolean;
  /**
   * RICS keeps "dangerous" apart from "serious", and so does this.
   *
   * The condition rating is DERIVED from `severity` — see
   * `ricsConditionRating` — so there is never a second stored grading to drift
   * from the first. This is the other half: whether somebody had to be told
   * before the report was written, which no severity scale can express.
   */
  escalation?: RicsEscalation;
  /**
   * ASTM E1527 classification, on environmental findings only.
   *
   * Vocabulary borrowed, protection not. Always rendered with
   * `ENVIRONMENTAL_CONDITION_CAVEAT` — the standard's force is a US liability
   * shield India has no analogue for, and an HREC here says "cleaned up, no
   * restrictions left" and nothing more.
   */
  environmentalCondition?: EnvironmentalCondition;
  /** Where in the building it was seen: pump room, basement. */
  area?: string;
  /** What to do about it, as the engineer's table states it. */
  mitigation?: string;
  /** The code or standard it is judged against. */
  standardRef?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The screen flag that raised this record, when the screen raised it.
   *
   * `runProjectScreen` has to know whether it has already filed a given
   * finding, or a second run files the missing-khata finding twice. It used to
   * answer that by appending `[screen:<code>]` to the record's own prose and
   * reading it back — which worked, and put twenty internal keys in front of
   * readers, four of them inside the red flag report that goes to a client.
   *
   * The same fact, in a field, where a reader never meets it.
   */
  screenCode?: string;
  /**
   * When a later screen closed this because it no longer raised it. Such a
   * record does not count as raised: the same thing found again is raised
   * afresh rather than hidden behind the one that was closed.
   */
  screenClosedAt?: string;
}

export interface RiskRecord {
  id: string;
  title: string;
  category: RiskImpactType;
  cause: string;
  impactType: RiskImpactType;
  probability: Probability;
  impactScore: ImpactScore;
  materiality: FindingSeverity;
  mitigation?: string;
  residualNote?: string;
  owner?: string;
  status: DdRiskStatus;
  reviewDate?: string;
  assetIds: string[];
  assessmentIds: string[];
  scopeInstanceIds: string[];
  findingIds: string[];
  actionIds: string[];
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
  /**
   * The screen flag that raised this record, when the screen raised it.
   *
   * `runProjectScreen` has to know whether it has already filed a given
   * finding, or a second run files the missing-khata finding twice. It used to
   * answer that by appending `[screen:<code>]` to the record's own prose and
   * reading it back — which worked, and put twenty internal keys in front of
   * readers, four of them inside the red flag report that goes to a client.
   *
   * The same fact, in a field, where a reader never meets it.
   */
  screenCode?: string;
  /**
   * When a later screen closed this because it no longer raised it. Such a
   * record does not count as raised: the same thing found again is raised
   * afresh rather than hidden behind the one that was closed.
   */
  screenClosedAt?: string;
}

export interface ActionRecord {
  id: string;
  title: string;
  kind: ActionKind;
  description?: string;
  owner: string;
  priority: FindingSeverity;
  dueDate?: string;
  status: ActionStatus;
  comments?: string;
  escalation?: string;
  /**
   * What the remedy costs, in the project's currency.
   *
   * A buyer does not primarily want a list of defects; they want to know what
   * has to be spent before completion, in the first year, and over the hold.
   * That table cannot be built from priorities alone, which is why the figure
   * and its band sit on the action rather than being inferred from one.
   */
  costEstimate?: number;
  costBand?: RemedialBand;
  findingIds: string[];
  riskIds: string[];
  evidenceIds: string[];
  checkIds: string[];
  closureEvidenceIds: string[];
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The screen flag that raised this record, when the screen raised it.
   *
   * `runProjectScreen` has to know whether it has already filed a given
   * finding, or a second run files the missing-khata finding twice. It used to
   * answer that by appending `[screen:<code>]` to the record's own prose and
   * reading it back — which worked, and put twenty internal keys in front of
   * readers, four of them inside the red flag report that goes to a client.
   *
   * The same fact, in a field, where a reader never meets it.
   */
  screenCode?: string;
  /**
   * When a later screen closed this because it no longer raised it. Such a
   * record does not count as raised: the same thing found again is raised
   * afresh rather than hidden behind the one that was closed.
   */
  screenClosedAt?: string;
}

export interface DecisionRecord {
  id: string;
  title: string;
  decisionType: DecisionType;
  decisionMaker: string;
  status: DecisionStatus;
  rationale: string;
  alternatives?: string;
  conditions?: string;
  findingIds: string[];
  riskIds: string[];
  actionIds: string[];
  evidenceIds: string[];
  assessmentIds: string[];
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The screen flag that raised this record, when the screen raised it.
   *
   * `runProjectScreen` has to know whether it has already filed a given
   * finding, or a second run files the missing-khata finding twice. It used to
   * answer that by appending `[screen:<code>]` to the record's own prose and
   * reading it back — which worked, and put twenty internal keys in front of
   * readers, four of them inside the red flag report that goes to a client.
   *
   * The same fact, in a field, where a reader never meets it.
   */
  screenCode?: string;
  /**
   * When a later screen closed this because it no longer raised it. Such a
   * record does not count as raised: the same thing found again is raised
   * afresh rather than hidden behind the one that was closed.
   */
  screenClosedAt?: string;
}

export interface GeneratedReport {
  id: string;
  kind: ReportKind;
  title: string;
  status: ReportStatus;
  assessmentIds: string[];
  scopeInstanceIds: string[];
  body: ReportBody;
  generatedAt: string;
  generatedBy: string;
  /** On a function's report: the template it was laid out from. */
  templateId?: string;
  reviewer?: string;
  /**
   * Who signed it out, as they sign, and in what capacity. Set when the
   * report is issued; the signer names themselves, the app records who
   * pressed the button in `reviewer` and in the audit trail.
   */
  signedBy?: string;
  signedRole?: string;
  signedAt?: string;
}

/** Where one section of a report stands before it goes out. */
export type ReportSectionState = 'drafted' | 'checked' | 'approved';

export const REPORT_SECTION_STATE_LABEL: Record<ReportSectionState, string> = {
  drafted: 'Drafted',
  checked: 'Checked',
  approved: 'Approved',
};

export type ReportBoundSourceKind =
  | 'particulars'
  | 'title_chain'
  | 'findings'
  | 'risks'
  | 'actions'
  | 'decisions'
  | 'evidence_gaps'
  | 'dd_progress'
  | 'checks'
  | 'valuation'
  | 'remedial_cost'
  | 'site_visits'
  | 'changes_since_previous'
  | 'observations'
  | 'questionnaire'
  | 'requirement_sheet'
  | 'risk_summary'
  | 'site_photographs'
  /** The three sections of a status report: what changed in a period, what is waiting, what comes next. */
  | 'status_changed'
  | 'status_waiting'
  | 'status_next'
  /** Named fields, each with its standing and where its value came from. */
  | 'fields'
  /** A table field, or the records of a set that repeats, with chosen columns. */
  | 'field_table'
  /** A chart drawn from a table field or a set that repeats. */
  | 'field_chart';

/**
 * What a bound block asks the registers for.
 *
 * Small on purpose. Every knob here is one a person would actually reach for
 * while writing — "only the material ones", "only this DD", "legal only" —
 * and nothing here can express a query whose answer the reader could not
 * check by opening the register themselves.
 */
export interface ReportBoundSource {
  kind: ReportBoundSourceKind;
  /** Narrow to one or more assessments. Empty or absent means the whole file. */
  assessmentIds?: string[];
  /** Critical and high only. */
  materialOnly?: boolean;
  /** Defaults to true — closed records are left out unless asked for. */
  openOnly?: boolean;
  /** Narrow findings to one discipline. */
  discipline?: ScopeKey;
  /** Whose observations, questionnaire or requirement sheet: Engineering's when absent. */
  department?: import('./departments').DepartmentKey;
  /** For a section of a status report: the period it covers, from this moment up to, and not including, this one. */
  from?: string;
  to?: string;
  /** For a section of a status report: its lines as code wrote them, with no model's wording laid over them. */
  plain?: boolean;
  /** `fields`: the fields printed, in order. With `from` and `to` and none named: every field decided in that period. */
  addresses?: FieldAddress[];
  /** `fields`: a table (the default) or a list of lines. */
  layout?: 'list' | 'table';
  /** `field_table`, `field_chart`: the table field read. */
  address?: FieldAddress;
  /** `field_table`, `field_chart`: the set that repeats read in place of a table field, by its id. */
  records?: string;
  /** `field_table`: the columns printed, by key. All of a table's, or a record's title and summary fields, when absent. */
  columns?: string[];
  /** `field_chart`: the column along the foot and the column drawn, by key. */
  x?: string;
  y?: string;
  mark?: 'bar' | 'line';
  /** `field_chart`: a set kept by period, by its id, in place of a table or records. The chart draws its field `y` period by period. */
  periods?: string;
  /** `field_chart` over periods: draw what each period added to a running total, in place of the total. */
  moved?: boolean;
  /**
   * Fields, tables and charts of fields: the day the section is read as at, as `YYYY-MM-DD`. Absent, it reads the
   * record as it stands. A report made for a period sets it to the period's last day.
   */
  asAt?: string;
}

export type ReportBlockOrigin = 'derived' | 'authored';

/**
 * One block of a report: either a live reading of the registers, or a
 * person's own words.
 *
 * See `report-blocks.ts` for why the two cannot be the same thing.
 */
export interface ReportBlock {
  id: string;
  /** Shown above the block. Editable whatever the block's origin. */
  heading?: string;
  /**
   * `derived` blocks re-resolve from the registers and cannot be typed into.
   * `authored` blocks hold text nothing regenerates.
   */
  origin: ReportBlockOrigin;
  /** Present on a derived block: what it reads. */
  source?: ReportBoundSource;
  /** Present on an authored block: what somebody wrote. */
  text?: string;
  /**
   * What this block said when the report was issued.
   *
   * An issued report went to somebody, so it must stop moving. This is what
   * it showed at that moment; the difference against the live registers is
   * computed by `reportDrift` rather than hidden.
   */
  frozen?: string[];
  frozenRecordIds?: string[];
  /** The table as it stood when the report was issued. */
  frozenTable?: ReportTable;
  /** On a block that reads fields: its footnotes, chart and note as they stood when it was issued or detached. */
  frozenFootnotes?: ReportFootnote[];
  frozenChart?: ReportChart;
  frozenNote?: string;
  /** What a detached block read, so putting it back reads the same fields. */
  detachedSource?: ReportBoundSource;
  /** On a person's note: the most characters it may hold, and what it is for. Set by the template that placed it. */
  cap?: number;
  hint?: string;
  /**
   * Set when a bound block was turned into prose, with the source it came
   * from. Recorded rather than erased: a reader is entitled to know that a
   * paragraph which looks like a register reading is a person's words frozen
   * at a date.
   */
  detachedAt?: string;
  detachedFrom?: ReportBoundSourceKind;
  editedAt?: string;
  editedBy?: string;
  /**
   * Drafted, checked by a second person, approved to go out. Any change to
   * what the section says puts it back to drafted: a check is of the words
   * that were checked.
   */
  state?: ReportSectionState;
  stateBy?: string;
  stateAt?: string;
  /**
   * On a section of a status report: a model's wording for some of its lines.
   * `said` is the line as code wrote it and `as` the words shown in its place.
   * It is shown only while the section still gives that very line, and it
   * replaces the line's words and nothing else: never the date, the person or
   * what is behind the line. See `statusWordingHeld`.
   */
  wording?: Array<{ said: string; as: string }>;
}

/**
 * A section that is a table rather than a list: the observations and their
 * mitigations, the answered questionnaire, the document sheet. `lines` still
 * carries the same content as text, for anything that cannot draw a table.
 */
export interface ReportTable {
  columns: string[];
  /** The last column is a count: draw it as a bar as well as a figure. */
  bars?: boolean;
  rows: Array<{
    cells: string[];
    recordId?: string;
    /** Photographs and documents that stand behind the row, printed after the table. */
    evidenceIds?: string[];
    /** The row's words are a model's wording of the line code wrote. */
    worded?: boolean;
    /** The field the row prints, on a block that reads fields. */
    address?: FieldAddress;
  }>;
}

/** Where a printed value came from: a paper and its page, a public source and the day it was read, a person and the day. */
export interface ReportFootnote {
  n: number;
  text: string;
}

/** A chart a block draws from fields. The same figures are in the block's table. */
export interface ReportChart {
  mark: 'bar' | 'line';
  x: string;
  y: string;
  points: Array<{ label: string; value: number; said: string }>;
}

export interface ResolvedReportBlock {
  lines: string[];
  recordIds: string[];
  table?: ReportTable;
  /** Said instead of inventing a line, when the registers have nothing to show. */
  note?: string;
  /** On a block that reads fields: where each value came from, numbered as the values mark them. */
  footnotes?: ReportFootnote[];
  chart?: ReportChart;
}

export interface ReportBody {
  /** Recomputed on read. Never stored, never edited — see `reportSummaryLine`. */
  summary: string;
  blocks: ReportBlock[];
  /**
   * The pre-block shape, kept only so a report generated before this existed
   * can still be read. `ensureProjectShape` migrates one into `blocks` on
   * load; nothing writes it any more.
   */
  sections?: ReportSection[];
}

export interface ReportSection {
  heading: string;
  paragraphs: string[];
  recordIds?: string[];
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string;
  oldValue?: string;
  newValue?: string;
  /** On a decision about one value read off a paper: the value's key. */
  factKey?: string;
  /** On a change to the project's own fields: the fields it set. On an undo: the fields it put back. */
  fields?: string[];
  /** On an undo: the records it put something back on, by their ids. */
  about?: string[];
  /**
   * On a line a chat message wrote: a mark of the one request that carried
   * the message out, the same on every line that request wrote. A line
   * written from a page carries none. It is how a message is kept apart from
   * other work done while it ran (`chat-changes.ts` in the API).
   */
  req?: string;
}

export interface ValuationApproachResult {
  approach: ValuationApproach;
  /**
   * What this particular approach is called, when it has a narrower name than
   * its family.
   *
   * `approach` is the IBBI family — market, cost, income, residual — and a
   * screen routinely produces three market-family approaches at once:
   * comparable sales, a guidance-value reference, and a locality index trend.
   * Rendered by family they were three rows all reading "Market / comparable"
   * with a threefold spread between their figures, and the only thing telling
   * them apart was the prose underneath. Optional because a run that has one
   * approach per family needs nothing more than the family name.
   */
  label?: string;
  amount: number;
  notes: string;
  weight: number;
}

export interface IbbiValuationSections {
  instruction: string;
  subject: string;
  dates: { valuationDate: string; inspectionDate?: string; evidenceCutoff: string };
  basis: ValuationBasis;
  premise: ValuationPremise;
  legalPlanningAssumptions: string;
  approaches: ValuationApproachResult[];
  reconciliation: string;
  caveats: string[];
  evidenceReliedUponIds: string[];
  evidenceConsideredIds: string[];
  evidenceGapIds: string[];
  /**
   * The Rule 8(3) items the original seven headings had no home for.
   *
   * Optional because runs written before it load without one, and because
   * several of them can only be filled in by a person — nothing computes a
   * conflict disclosure. `rule8Completeness` reads this alongside the sections
   * above and reports which of the twelve the report can actually satisfy.
   */
  rule8?: Rule8Additions;
}

export interface ValuationRun {
  id: string;
  status: ValuationRunStatus;
  signOff: ValuationSignOff;
  localityId?: string;
  localityLabel?: string;
  landValue?: number;
  buildingReplacement?: number;
  comparableValue?: number;
  /**
   * Zero when no approach had all of its inputs.
   *
   * `working.reconciliation.indicated` is null in that case and IS the honest
   * answer; this stays a number only because every reader of it predates the
   * working and expects one. Anything rendering a value must check
   * `working.reconciliation.indicated` first — a valuation of zero and a
   * valuation that could not be computed are different facts.
   */
  indicatedValue: number;
  low: number;
  high: number;
  currency: 'INR' | 'EUR';
  /**
   * The formula, the inputs, where each came from, and the working.
   *
   * Optional only because runs written before it exists load without one.
   * Everything new carries it, and it is what makes the number checkable
   * rather than merely printed.
   */
  working?: ValuationWorking;
  ibbi: IbbiValuationSections;
  createdAt: string;
  createdBy: string;
}

export interface CapabilityRun {
  kind: CapabilityKind;
  status: CapabilityRunStatus;
  summary: string;
  metrics: Record<string, string | number>;
  updatedAt: string;
}

export interface AiDraft {
  id: string;
  kind: AiDraftKind;
  title: string;
  body: string;
  status: AiDraftStatus;
  source: AiDraftSource;
  proposedPayload?: Record<string, unknown>;
  reviewNote?: string;
  committedRecordId?: string;
  createdAt: string;
  createdBy: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface ProjectGraphNode {
  id: string;
  kind: ProjectGraphNodeKind;
  /**
   * What KIND OF THING this is — entity, evidence, claim, judgement or
   * deliberation. Derived from `kind` and carried on the node so a consumer
   * (a renderer, a traversal, Cypher) does not have to keep its own copy of
   * the mapping and drift from it.
   */
  layer: ProjectGraphLayer;
  /**
   * Where this node LIVES, which is a different question from what it is.
   *
   * `derived` nodes are a pure function of the project registers: a rebuild
   * reproduces them exactly, so a store holding them is an index and losing
   * them costs a rebuild. `authored` nodes were written straight into the
   * graph and exist nowhere else — an analyst's annotation, a link somebody
   * drew by hand. A sync must never touch those.
   */
  origin: ProjectGraphOrigin;
  label: string;
  detail?: string;
  /**
   * A stable key the product names this by, on the structural nodes: the
   * stage (`construction`, one of the four), the department (`legal`), the
   * function (`legal.title`, or `design` for Design's workstreams together),
   * the approval (`plan_sanction`). Cypher finds "the Legal department of this
   * project" by it rather than by an id. A bill carries its own number here.
   */
  key?: string;
  /**
   * Where it stands, in the node's own vocabulary: a stage's `done`,
   * `current` or `ahead`; a function's `live` or `coming_soon`; an
   * approval's `in_force`, `expired` or `missing`; a document's `expected`,
   * `received` or `rejected`; a quick assessment's verdict; a bill's
   * `claimed`, `in_review`, `certified` or `paid`. It is what says
   * whether a paper an edge reaches is in hand, still awaited or set aside
   * (`projectNodeAwaited`, `projectNodeSetAside`).
   */
  status?: string;
}

export type ProjectGraphOrigin = 'derived' | 'authored';

export interface ProjectGraphEdge {
  id: string;
  from: string;
  to: string;
  rel: ProjectGraphEdgeKind;
  /**
   * When this stopped being what the file says — absent while it still is.
   *
   * A rebuild that no longer draws an edge is not evidence the edge was
   * wrong; it is evidence the file changed. A check that dropped an evidence
   * reference last week should leave both readable, because "what did this
   * finding rest on when we signed the report" is a question a diligence file
   * has to be able to answer, and deleting the edge answers it with silence.
   *
   * Set by the persistence layer at the moment a sync stops producing the
   * edge, never by the projection — the projection has no memory of what it
   * emitted last time, which is exactly why the store is the one that can
   * tell.
   */
  closedAt?: string;
}

export interface DdProgressRow {
  id: string;
  name: string;
  status: AssessmentStatus;
  percent: number;
  checkDone: number;
  checkTotal: number;
}

export interface ActionAging {
  open: number;
  overdue: number;
  dueSoon: number;
  closed: number;
}

export interface ProjectDashboard {
  health: ProjectHealth;
  evidenceCompleteness: {
    expected: number;
    received: number;
    validated: number;
    used: number;
    missing: number;
    percent: number;
  };
  packCompleteness: {
    percent: number;
    received: number;
    missing: number;
    total: number;
    missingTitles: string[];
  };
  ddProgress: DdProgressRow[];
  actionAging: ActionAging;
  changeSincePrevious: Array<{
    assessmentId: string;
    assessmentName: string;
    priorName?: string;
    newCount: number;
    closedCount: number;
    unresolvedCount: number;
  }>;
  capabilities: CapabilityRun[];
}

/**
 * A page of a project, as a chat turn keeps it: the pane on screen, the
 * department and function when the page is one of theirs, and the stage being
 * looked at. Plain words, so a stored turn outlives a pane or a function that
 * is later renamed: a word nothing knows is read as no place.
 */
export interface ChatTurnPlace {
  pane?: string;
  department?: string;
  fn?: string;
  stage?: string;
}

/** Structurally the copilot turn the cockpit chat panel already renders. */
export interface ProjectChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  /**
   * Who this turn belongs to.
   *
   * One project has one thread, so without this a collaborator reading the
   * conversation reads the developer's. Absent on a turn written before the
   * field existed, and such a turn is treated as staff-only — an unattributed
   * turn cannot be shown to be anybody's.
   */
  actor?: string;
  /**
   * Options offered because the message did not resolve to one thing.
   * Present only on a turn that asked rather than acted.
   */
  choices?: ChatChoice[];
  /**
   * The answer as a card of fields, on a turn a model answered: the rows it
   * picked, each looked up on the record by code. `text` is then made from
   * this card and a template, and no word of it is a model's. A turn a
   * model answered that has no card was kept before answers were cards: its
   * `text` is the model's own, and is shown marked as that.
   */
  card?: import('./chat-answer').ChatAnswerCard;
  /**
   * Figures in this answer that nothing on the file supports, verbatim.
   *
   * Set only on model-authored turns — deterministic text is assembled from
   * register values and cannot disagree with them. A flag, never a block:
   * the answer still renders, with the unsupported figures named beside it,
   * because an invented number in the same confident voice as a real one is
   * the exact failure this product exists to prevent.
   */
  unsupportedClaims?: string[];
  /**
   * The facts of the project's memory this answer rests on, each with the
   * tag it had when the answer was given, and where in `text` that tag is
   * printed: the place of each opening bracket.
   *
   * Set by code from the facts themselves, never by a model. A page draws a
   * tag as a tag at these places and nowhere else: bracketed words anywhere
   * else in the text are words, whoever wrote them. A turn kept before the
   * places were has none, and is drawn with no tag.
   */
  restsOn?: Array<{ id: string; tag: 'approved' | 'proposed' | 'thought'; stands?: boolean; at?: number[] }>;
  /**
   * Questions the model asked beyond the first, held rather than shown.
   *
   * An interview asks one thing at a time; a turn with three questions gets
   * the last one answered and loses the other two. These are kept so the
   * thread can continue rather than cut, and surfaced as "next, I'll ask…".
   */
  heldQuestions?: string[];
  /** Prose was dropped to fit the turn budget, so the UI can offer “say more”. */
  trimmed?: boolean;
  /**
   * What the turn changed on the file, as figures rather than sentences.
   *
   * A receipt that lists what you just approved tells you nothing you did not
   * already know — you approved it. The question a person actually has after
   * filing six documents is whether the diligence moved, and the honest answer
   * is often no: six documents landed on the register and the priority pack
   * stayed at 0/16 because there was no assessment to attach them to. That is
   * one line of numbers and it is the most useful line in the exchange.
   *
   * Numbers only. Anything that needs a sentence belongs in the next step.
   */
  metrics?: ChatMetric[];
  /**
   * Why this turn does not answer what was asked.
   *
   * The copilot is reached only when the deterministic router declines the
   * question. When that call cannot be made — no endpoint configured, a rate
   * limit, a timeout — the request already falls through to the day's standing
   * briefing so that chat keeps working, which is right. What was wrong is
   * that it fell through SILENTLY: "what would a buyer pay for this?" came
   * back as an unrelated open finding, in the same voice and the same position
   * as a real answer, with nothing to say the question had not been read.
   *
   * The failure is recorded in the run ledger either way. This is the half the
   * person can see. Set only when a question went unanswered; a briefing
   * somebody actually asked for carries nothing here.
   */
  unanswered?: string;
  /**
   * Which conversation this turn belongs to.
   *
   * A project's thread ran forever. Opening a file you had worked on for a
   * week dropped you at the bottom of every exchange anybody had ever had
   * about it, which is not history so much as an unbounded scrollback — and
   * the useful part, "what was I doing", was the least visible part of it.
   *
   * A session is one sitting. Opening the project starts a new one, so the
   * panel is empty and the past is somewhere you go rather than something you
   * scroll past. Turns written before this field existed carry none, and
   * `chatSessions` groups those by the gaps between them instead.
   */
  sessionId?: string;
  /**
   * The chat this sitting carries on, by that chat's id.
   *
   * An earlier chat is picked up again in a sitting of its own, so `sessionId`
   * stays what it has always been: one opening of the project. This says the
   * sitting belongs to the end of an older chat, and `chatSessions` reads the
   * two as one. A reader that does not know the field sees a new sitting.
   */
  continues?: string;
  /**
   * The name a person gave this chat. Kept on the chat's first turn, so it is
   * seen by whoever can see the chat and nobody else. A chat without one is
   * named by its first question.
   */
  sessionName?: string;
  /**
   * Where the person was when this was asked: the page, and the stage it was
   * looked at in. The thread stays as a person moves through the project, so
   * an answer given on Title is still on screen on Approvals, and this is how
   * the thread says which page it was about. Absent on a turn written before
   * the chat knew, and on one the file wrote itself.
   */
  place?: ChatTurnPlace;
  /**
   * What this turn cost to produce, when a model produced it.
   *
   * Absent on the deterministic paths, which is the honest answer — they cost
   * nothing and a "$0.00" beside them would read as a priced zero rather than
   * as no call at all.
   */
  spend?: TurnSpend;
  citedEvidenceIds: string[];
  citedNodeIds?: string[];
  toolCalls?: { name: string; summary: string }[];
  refusedForLackOfEvidence?: boolean;
  proposalIds?: string[];
  /**
   * The plan this turn shows, started or reports on: its id in the run
   * ledger, which is where the plan and how far it has got are kept
   * (`plans.ts`). The page draws the plan under the turn from there, so a
   * turn written an hour ago shows the plan as it stands now.
   */
  planId?: string;
  /**
   * What this reply changed on the record, as the lines a person reads, and
   * whether it has been undone. What it takes to put the changes back is
   * kept beside the project and not here (`turn-changes.ts`). Absent on a
   * reply that changed nothing.
   */
  changed?: import('./turn-changes').TurnChanged;
}

export type ChatProposalKind =
  | 'start_dd'
  | 'add_asset'
  | 'add_scope'
  | 'file_evidence'
  | 'request_evidence'
  | 'add_finding'
  | 'add_action'
  | 'add_risk'
  | 'add_decision'
  | 'record_check'
  /**
   * Values read off a document onto a check's declared fields.
   *
   * Separate from `record_check` because they are different acts: recording
   * values is transcription, recording a result is a conclusion. A model may
   * propose the first far more readily than the second.
   */
  | 'record_check_fields'
  | 'generate_report'
  /**
   * A change to a report's own words: a paragraph added, or one rewritten.
   *
   * Never a change to a bound block's text — a model may not restate what the
   * registers say, only add prose beside it or change what a block asks for.
   * See `report-blocks.ts`.
   */
  | 'edit_report'
  | 'run_valuation'
  | 'run_screen'
  | 'patch_project'
  | 'patch_asset'
  | 'change_stage'
  | 'open_connector'
  | 'commit_draft'
  | 'snapshot_capabilities'
  /** Which departments the project runs. Admin's to approve, like the control it mirrors. */
  | 'set_departments'
  /** Ask a named person for documents the requirement sheet still lacks. */
  | 'request_documents'
  /** Give a filed document to a workstream, or hand it back to what it is. */
  | 'assign_document'
  /** A site entry read from a voice note: the day, the work done and the issues, each with the note's words. Filed on the site log when a person accepts. */
  | 'log_site_entry';

export type ChatSideIntentKind = 'places' | 'web_search' | 'connectors' | 'locality' | 'planning' | 'capabilities' | 'commit_drafts';

export interface ChatSideIntent {
  kind: ChatSideIntentKind;
  /** Amenity kinds when `places`; connector keys when `connectors`. */
  keys?: string[];
}

export interface ChatPlacesAmenity {
  kind: string;
  name: string;
  metres?: number;
  drivingMetres?: number;
  drivingSeconds?: number;
}

export interface ChatPlacesPull {
  provider: string;
  configured: boolean;
  query: string;
  resolvedAddress?: string;
  precision?: string;
  caveat?: string;
  /** WGS84 pin when geocode returned. Not a parcel boundary. */
  point?: { lat: number; lng: number };
  amenities: ChatPlacesAmenity[];
  streetView?: { capturedAt: string; offsetMetres?: number };
  gaps: Array<{ code: string; consequence: string }>;
}

export interface ChatWebHit {
  title: string;
  claim: string;
  url?: string;
  sourceTitle?: string;
}

export interface ChatWebPull {
  enabled: boolean;
  query: string;
  hits: ChatWebHit[];
  note?: string;
}

/** Network-backed extras the API fills before `applyProjectChat`. Connectors and locality do not need this. */
export interface ChatSideBundle {
  places?: ChatPlacesPull;
  web?: ChatWebPull;
}

export type ChatProposalStatus = 'proposed' | 'accepted' | 'rejected' | 'committed';

export interface ChatProposal {
  id: string;
  kind: ChatProposalKind;
  title: string;
  rationale: string;
  impact: string;
  status: ChatProposalStatus;
  payload: Record<string, unknown>;
  citedEvidenceIds?: string[];
  /**
   * Where on the papers it cites: the page, and that page's own words as this
   * server read them. What a card shows of why it is offered. Never a sentence
   * a model wrote: a passage is put here only from a search of the papers.
   */
  cites?: Array<{ evidenceId: string; page: number; quote: string }>;
  citedNodeIds?: string[];
  createdAt: string;
  createdBy: string;
  committedRecordId?: string;
}

/**
 * A document being read, as it happens, on the upload turn's stream.
 *
 * The turn's result says what was read once everything is; these say it file
 * by file and page by page, so the reading can be shown while it runs — the
 * page being scanned, and each fact as it comes off it. `key` is the file's
 * storage key, the one thing every line about the same file shares.
 */
export type ReadingStreamEvent =
  | {
      type: 'reading';
      event: 'start';
      key: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      /** 0-based place in this turn's files, and how many there are. */
      index: number;
      total: number;
      /** Set when the file is already on a row — a filed document read again — so its bytes can be fetched. */
      evidenceId?: string;
      fileId?: string;
    }
  | {
      type: 'reading';
      /** Sent for every file at once, in the order dropped, before any is read: the desk lists them that way however they finish. */
      event: 'queued';
      key: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      index: number;
      total: number;
      evidenceId?: string;
      fileId?: string;
    }
  | {
      type: 'reading';
      /** The paper's reading is on the project's file, saved: sent as each paper finishes, in the order they finish. */
      event: 'filed';
      key: string;
      /** The row it is on, as saved, so the values can be decided while the rest are still being read. */
      row?: EvidenceRecord;
    }
  | {
      type: 'reading';
      /** The file was no paper and was not filed as one: a questionnaire, the notes of a meeting, a voice note, or a photograph of the site. */
      event: 'taken';
      key: string;
      as: 'questionnaire' | 'notes' | 'voice' | 'photo';
      /** What became of it, in a line: "A questionnaire: 24 questions", "Notes of a meeting: 4 items proposed". */
      said: string;
      /** For a questionnaire: which, and the department whose Questions page holds it. */
      questionnaireId?: string;
      department?: string;
    }
  | { type: 'reading'; event: 'page'; key: string; page: number; of: number }
  | {
      type: 'reading';
      event: 'read';
      key: string;
      /** "Sale deed", or absent when the file could not be read. */
      label?: string;
      method?: string;
      pages?: number;
      facts: import('./document-parse').DocumentFact[];
      summary?: string;
      failure?: string;
    }
  | {
      type: 'reading';
      event: 'merged';
      key: string;
      /** The file's facts once the model's reading is laid over this server's: what the turn's cards will carry. */
      facts: import('./document-parse').DocumentFact[];
    }
  | {
      type: 'reading';
      event: 'model';
      key: string;
      phase: 'start' | 'done';
      /** On `done`: what only the model read, which a page verified. */
      facts?: import('./document-parse').DocumentFact[];
      notes?: string;
      kind?: string;
      failure?: string;
    };

export interface ChatIngestFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  excerpt?: string;
  /** Verbatim notes from document intelligence — never a substitute for approve. */
  extractionNotes?: string;
  /**
   * Why the file's text could not be read, in one short human sentence.
   *
   * Set only when extraction did not succeed, and never set together with
   * `extractionNotes`: the two say opposite things. A note is something the
   * model observed about the document; this is the admission that it observed
   * nothing. They were previously the same field, so a rate-limited parse
   * arrived in chat wearing the clothes of a classification — an HTTP 400 body
   * rendered where a summary of the deed should be. A person skimming six
   * upload cards cannot be expected to notice which two of them are real.
   */
  readFailure?: string;
  quotes?: Array<{ text: string; page?: number }>;
  pages?: number;
  kindHint?: string;
  /**
   * What a model read off the document, each fact on a page its quote was
   * verified against, with the original script kept beside the reading.
   * Merged into `read.facts` by the API; nothing here is filed until a card
   * is approved.
   */
  modelFacts?: import('./document-parse').DocumentFact[];
  /**
   * A model read the document and said what it is, whether or not it could
   * place anything on a page. Filed onto the row as `modelReadAt`, so asking
   * to read the filed documents moves on to the ones not yet read.
   */
  modelRead?: boolean;
  /**
   * What a model read and nothing could check against its page: looked for
   * there and not found, or never looked for. No fact, and never filed as
   * one: each carries `proof: 'unverified'` and, as its page, only the page
   * the model named. Laid onto `reading.unverified` by the merge.
   */
  modelUnverified?: import('./document-parse').DocumentFact[];
  /**
   * What reading the document on this server found — see `document-parse`.
   *
   * Present whenever the file had readable text (a text layer or OCR), with
   * or without a model. `facts` carry their page and the words they came
   * from; nothing here is written to a register until a card is approved.
   */
  read?: IngestRead;
  /** How much of the file was read, by which reader, and why a model was asked. */
  reading?: ReadingCoverage;
  /**
   * This reading is on the file's row already: it was put there the moment
   * the paper was read, ahead of the turn that reports the whole drop
   * (`landIngestFile`). The turn's card for the file then records the filing
   * and writes no value a second time, so a value a person decided on the row
   * meanwhile is not put back to waiting.
   */
  landed?: true;
}

/**
 * How much of a paper was read.
 *
 * A reading used to say what it found and nothing about what it never looked
 * at: a forty-page scan read for its first eight pages looked the same as one
 * read whole. `pagesRead` under `pagesInFile` is a paper read in part, and the
 * two numbers are what to say ("8 of 40 pages read").
 */
export interface ReadingCoverage {
  /** Pages in the file. */
  pagesInFile: number;
  /** Pages some reader got words from: the file's text layer, OCR, or the model reader. */
  pagesRead: number;
  /**
   * Pages each reader read. A page the model reader read after OCR is counted
   * under both, so these can add up to more than `pagesRead`.
   */
  readers: { text: number; ocr: number; model: number };
  /**
   * The 1-based pages whose words on this server are OCR's reading of a
   * picture, not the file's own text. A value that has to be exact is not
   * proved by a quote found among those words. Absent where none were.
   */
  ocrPages?: number[];
  /**
   * Why the paper goes to the model reader, each reason a plain sentence that
   * can be shown as it is. Empty when this server's own reading was enough.
   */
  modelReasons: string[];
  /** The 1-based pages those reasons are about: the ones the model reader is asked to read. */
  modelPages: number[];
  /**
   * The pages that left this server for the model reader. Usually
   * `modelPages`. Fewer where the file was too heavy to send and only its
   * two ends went; more where the file could not be cut and went whole.
   * Absent until any were sent.
   */
  modelPagesSent?: number[];
  /**
   * Of the pages sent, those a value came back for that was found on the
   * page. Set, even when empty, once the model reader has answered; absent
   * while it has not, which is when the paper is worth reading again.
   */
  modelPagesRead?: number[];
  /** Why the model reader, when asked, returned nothing, in plain words. Absent when it answered or was not asked. */
  modelFailure?: string;
  /**
   * The model reader answered, and the time allowed ran out before a second
   * model had read every value's page: values that might have been confirmed
   * are unverified for want of time. Such a paper is worth reading again.
   * Absent when every page that needed a second reading got one.
   */
  modelChecksCut?: boolean;
  /** Why pages went unread on this server, in plain words: "only the first 8 scanned pages of a file are read here". */
  unreadWhy?: string;
  /**
   * What the model reader read and nothing could check against its page.
   * Not facts: nothing here answers a check or is compared with anything. A
   * person can see them, each marked unverified, and look at the page.
   */
  unverified?: import('./document-parse').DocumentFact[];
}

export interface IngestRead {
  type: import('./document-parse').ReadDocumentType;
  label: string;
  confidence: number;
  method: 'text' | 'ocr' | 'mixed';
  /** Mean OCR confidence, 0..100, when any page was OCR'd. */
  ocrConfidence?: number;
  facts: import('./document-parse').DocumentFact[];
  flags: import('./document-parse').DocumentFlag[];
  summary: string;
  rowHints: string[];
  scopes: ScopeKey[];
  evidenceKind: EvidenceKind;
}

export interface OrchestratorRun {
  id: string;
  at: string;
  actor: string;
  summary: string;
  recommendedDdTypes: string[];
  evidenceGapCount: number;
  openFindingCount: number;
  draftIds: string[];
  source: 'rule' | 'model';
}

export interface ProjectChatResult {
  userTurn: ProjectChatTurn;
  assistantTurn: ProjectChatTurn;
  commands: string[];
  navigations: {
    target: string;
    ddId?: string;
    scopeId?: string;
    checkId?: string;
    node?: string;
    evidenceId?: string;
    findingId?: string;
    riskId?: string;
    actionId?: string;
    assetId?: string;
    page?: string;
    /** The department or function whose page opens, for the `department` and `workstream` panes. */
    department?: string;
    workstream?: string;
    /** The stage the page is looked at in, by its key. */
    stage?: string;
    /** The section of a function's page to land on, and the record to mark there. */
    section?: string;
    item?: string;
  }[];
  proposals: ChatProposal[];
  highlightIds: string[];
}

export interface ProjectScreenSnapshot {
  generatedAt: string;
  engineVersion: string;
  verdict: string;
  headline: string;
  reasoning: string[];
  indicatedMid?: number;
  indicatedLow?: number;
  indicatedHigh?: number;
  currency?: string;
  completenessScore?: number;
  confidenceScore?: number;
  openCriticalRisks: number;
}

/**
 * Where an engagement is, as the firm runs it.
 *
 * Not the property's lifecycle stage. A villa project under construction can
 * be at "documents" for one engagement (a lender's TDD) and "issued" for
 * another (last year's screening). This is the firm's pipeline: what it has
 * been asked to do, and how far it has got.
 */
export type EngagementStage = 'intake' | 'documents' | 'site_visit' | 'analysis' | 'review' | 'issued';

export const ENGAGEMENT_STAGE_LABEL: Record<EngagementStage, string> = {
  intake: 'Intake',
  documents: 'Documents',
  site_visit: 'Site visit',
  analysis: 'Analysis',
  review: 'Review',
  issued: 'Issued',
};

export type ProjectRequestStatus = 'draft' | 'sent' | 'answered' | 'cancelled';

/**
 * Something the file is waiting on from a named person.
 *
 * An expected evidence row says a document is missing; it does not say who
 * was asked for it, when, or by when it was promised. Those three are what
 * "waiting on others" is made of, and the age of a request is the one number
 * a lead chases every morning.
 */
export interface ProjectRequest {
  id: string;
  /** What is asked for: "Encumbrance certificate 2004 to 2026". */
  title: string;
  detail?: string;
  /** Who owes it, as a person would name them. */
  recipient: string;
  /** Their role on this file: "Owner's advocate", "Architect". */
  recipientRole?: string;
  status: ProjectRequestStatus;
  sentAt?: string;
  /** ISO date it was promised by. */
  dueAt?: string;
  /** The expected evidence row this will satisfy, when there is one. */
  evidenceId?: string;
  /** The document that answered it. */
  answeredByEvidenceId?: string;
  answeredAt?: string;
  /** The checklist lines one request covers, when it was raised from a checklist: everything one party owes. */
  checklistItemIds?: string[];
  /** Where it was last sent, when it left the firm by email or WhatsApp (`outside-replies.ts`). */
  recipientEmail?: string;
  recipientPhone?: string;
  /** Each sending of it to the outside party, with the reference a reply names it by. */
  dispatches?: import('./outside-replies').RequestDispatch[];
  /** What the outside party sent back. A reply answers nothing until a person confirms it. */
  replies?: import('./outside-replies').RequestReply[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface DdProject {
  id: string;
  /**
   * The workspace this project belongs to.
   *
   * Optional on the type so a store written before tenancy still loads;
   * `ensureProjectShape` adopts an untenanted project into the bootstrap
   * workspace on first read, and the API refuses to serve one that has no
   * tenant to a caller from another.
   */
  tenantId?: string;
  reference: string;
  name: string;
  type: ProjectArchetype;
  /** The pieces of work clients commission on this project, each drawing on workstreams. */
  engagements?: import('./engagements').Engagement[];
  /** What the file is waiting on, and from whom. */
  requests?: ProjectRequest[];
  /** The project's own checklist of papers, loaded from a list somebody sent. Absent on a project that has none. */
  checklist?: import('./checklist').ChecklistItem[];
  /** The day of the month reports are prepared on without being asked, and what the timer has prepared. Absent on a project that never set one. */
  reportDay?: import('./report-day').ReportDay;
  /** Owner packs kept as they read when prepared, each waiting to be issued or issued and frozen. */
  ownerPacks?: import('./report-day').KeptOwnerPack[];
  /** The lists of questions a due diligence put to the building, with their answers. */
  questionnaires?: import('./questionnaire').Questionnaire[];
  /** One-off data migrations already applied to this stored project. */
  migrations?: string[];
  subtype?: string;
  description?: string;
  location: string;
  city: string;
  jurisdiction?: string;
  siteAddress?: string;
  status: ProjectStatus;
  currentStage: LifecycleStage;
  stageHistory: StageRecord[];
  health: ProjectHealth;
  owner?: string;
  developer?: string;
  landAreaSqm?: number;
  builtUpAreaSqm?: number;
  saleableAreaSqm?: number;
  budget?: number;
  currency: 'INR' | 'EUR';
  portfolio?: string;
  stakeholders: Stakeholder[];
  assets: Asset[];
  assessments: DdAssessment[];
  evidence: EvidenceRecord[];
  findings: FindingRecord[];
  risks: RiskRecord[];
  actions: ActionRecord[];
  decisions: DecisionRecord[];
  /**
   * Site visits, and the sheets somebody has placed on the map.
   *
   * Both are registers rather than fields on something else: a visit exists
   * whether or not it produced a photograph, and a master plan sheet is
   * consulted by several checks at once.
   */
  siteVisits: SiteVisitRecord[];
  sheets: SheetRecord[];
  reports: GeneratedReport[];
  valuationRuns: ValuationRun[];
  capabilityRuns: CapabilityRun[];
  aiDrafts: AiDraft[];
  conversation: ProjectChatTurn[];
  chatProposals: ChatProposal[];
  orchestratorRuns: OrchestratorRun[];
  audit: AuditEvent[];
  /**
   * Written by an earlier build, which kept one whole copy of the file for
   * the last instruction. Nothing reads it now: what each message changed is
   * kept with the message (`ProjectChatTurn.changed`, `turn-changes.ts`). It
   * stays on the type because records written then still carry it.
   */
  lastUndo?: { token: string; label: string; state: string; at: string };
  /**
   * Survey / parcel identifier for the site.
   *
   * Recorded rather than scraped. The screen used to recover this with a
   * regex over the first asset's free-text notes, which found it only when
   * somebody happened to have typed "Sy. 42" there — and a title chain that
   * cannot name the parcel it is about compares nothing.
   */
  parcelId?: string;
  /**
   * A coordinate the project's own documents state.
   *
   * Recorded, like the parcel and the address, only after somebody approved a
   * card that read it off a file. Where it exists it is the pin: no geocoder
   * is asked to guess a point for a village name the case already has a
   * coordinate for. It is a placement and never an extent — a point cannot
   * bound a parcel, and `SiteContext` carries the full argument for why.
   */
  siteCoordinate?: GeoPoint;
  /**
   * How the site is held.
   *
   * Optional, and absent means `unknown` rather than `freehold`. The screen
   * used to assert freehold for every project, which is a fact nobody entered
   * — and one that flatters the valuation by 4% and suppresses the
   * unconfirmed-tenure risk. An unrecorded tenure is a gap, and the engine
   * already knows how to price and report a gap.
   */
  tenure?: Tenure;
  /**
   * Plot/site attributes — road width, facing, corner, layout approval.
   *
   * These move a Bengaluru site's rate materially and the engine reads them;
   * before this the project path had nowhere to put them, so it passed none.
   */
  plot?: PlotAttributes;
  /**
   * State-pack particulars: khata type, jurisdiction, conversion status, area
   * basis, and the site constraints that come from something other than title.
   *
   * These are the inputs the Karnataka title checks are written against. The
   * project path supplied none of them, so every one of those checks resolved
   * `unknown` — which reads like an answer and is not one. What is recorded
   * here is matter of record, so nothing infers it: an unanswered field stays
   * unanswered and the check says so.
   */
  karnataka?: KarnatakaAttributes;
  /** Last property-screen snapshot. The engine writes registers; this is the headline. */
  lastScreen?: ProjectScreenSnapshot;
  /**
   * The last screen in full.
   *
   * `lastScreen` is twelve scalars for a header. The engine also computes
   * anchors, comparables, drivers, the planning position, the evidence
   * ledger, the state compliance checks and the transaction costs — all of
   * which were computed on every run and then dropped on the floor, leaving
   * the reader a verdict with no way to ask why. Held here so the panes can
   * show the working, and so a report can quote it.
   *
   * Stored whole rather than trimmed to what a pane happens to render. It is
   * a record of one run at one moment against a project that keeps moving, so
   * it cannot be re-derived later — re-running the screen answers a different
   * question. Trimming would also mean this field is not a `ScreenResult`,
   * only something shaped like one until the day it isn't.
   *
   * **It is not small: about 95-125 KB per project, of which the evidence
   * ledger is roughly half.** The store rewrites the whole document on every
   * mutation, so that cost lands on every chat turn and every recorded check,
   * not only on a screen. The ledger is what makes "every figure traces back
   * to something" checkable rather than a claim, so the answer is not to drop
   * it — it is that the store should stop rewriting everything to change one
   * record. This note is here so whoever hits that knows what is in the blob.
   */
  lastScreenResult?: ScreenResult;
  /** Places/geocode cache for this project's site address. */
  siteContext?: SiteContext;
  /**
   * Surveyor's outline when a person supplied GeoJSON/KML. Not a product-drawn
   * parcel, not the RMP hatch, and not evidence until someone files the sketch
   * on a check.
   */
  surveyBoundary?: ParcelBoundary;
  /**
   * What the state's revenue map said about the survey number on this file:
   * the parcel, the statutory layers around it, and a guidance-value anchor.
   * A machine read of a government record. Not evidence until a person files
   * the extract. See `revenue-map.ts`.
   */
  revenueMap?: RevenueMapRead;
  /**
   * Every read kept for a site that stands on more than one survey number,
   * one per parcel, in the order read. `revenueMap` above is always the first
   * of them, so code that knows of one read keeps working, and that field is
   * the one trusted when the two disagree. Absent while there is one read or
   * none. Read it through `revenueReads` in `revenue-map.ts`, never directly:
   * the first place only stands for the read `revenueMap` holds, and the
   * reads after it keep their shapes in `revenueShapes` below.
   */
  revenueMaps?: RevenueMapRead[];
  /**
   * The shapes of the state's layers that the reads in `revenueMaps` share
   * and the first read does not hold, each kept once. A tank beside seventy
   * parcels is one outline here, not seventy. Absent while there is one read,
   * or while the first read holds every shape the others need.
   */
  revenueShapes?: Record<string, RevenueShape>;
  /**
   * Value inputs the file offered that a person set aside, by offer id. An
   * offer's id carries its value and source, so a new document or a corrected
   * reading is a new offer and comes back. See `value-inputs.ts`.
   */
  valueSetAside?: Array<{ offerId: string; input: string; at: string; by: string }>;
  /**
   * Where the areas the valuation reads were taken from, when they were taken
   * from the file. A project particular has no citation of its own, so an
   * area accepted off a deed would otherwise read as somebody's typing; kept
   * against the value, so a later edit by hand does not inherit the deed.
   */
  valueSources?: Partial<Record<'landAreaSqm' | 'builtUpAreaSqm' | 'saleableAreaSqm', { value: number; label: string; evidenceId?: string; page?: number; factKey?: string; at: string; by: string }>>;
  /**
   * The comparables a market rate is drawn from: portal listings a search
   * found, registered sales, and figures a valuer added — each with its
   * source, its adjustments and whether a person has accepted it. See
   * `comparables.ts`.
   */
  comparables?: import('./comparables').ComparableRecord[];
  /** The last portal search: when, for what, and what it found or why it found nothing. */
  comparableSearch?: import('./comparables').ComparableSearchRecord;
  /** The departments this project uses. Absent: the firm's default. */
  departments?: import('./departments').DepartmentKey[];
  /** Who works on it, and their role in each department. */
  team?: import('./team').TeamMember[];
  /**
   * What each field set holds on this project, by the set's id. Absent on a
   * project saved before field sets; a set saved under an id nothing declares
   * any more is kept as it is.
   */
  fieldSheets?: Record<string, StoredFieldSheet>;
  /** The moment from which every change to a field's standing value is kept as history: the project's making, or its first change after history was kept. Before it, a past day reads as now and says so. */
  historyFrom?: string;
  /** On a reading of the project as at a past day (`projectAsAt`): the day. Never stored, and never on the project itself. */
  asAt?: string;
  /** The situations in play, by key. A function's own is kept under `<fn>:<key>`. */
  situations?: Record<string, SituationState>;
  /** Lines under Due soon a person put off, by the line's key. Absent on a project where nobody has. */
  fieldSnoozes?: Record<string, FieldSnooze>;
  /** Reports signed by named professionals, each the figure of record for its workstream. */
  certifiedReports?: import('./certified').CertifiedReport[];
  /** Construction › Progress: the milestones the work reports against. */
  milestones?: import('./progress').Milestone[];
  /** Construction › Progress: the daily site log, mostly from the phone. */
  siteLog?: import('./progress').SiteLogEntry[];
  /** Finance › Budget: the cost register. The budget's work packages, the contracts that cover them, each contractor's bills line by line, and what was certified and paid against them. See `cost.ts`. */
  cost?: import('./cost').CostRegister;
  /** Finance › Budget: monthly Cost Reports — the editable figure of record for cost monitoring. See `cost-report.ts`. */
  costReports?: import('./cost-report').CostReportPeriod[];
  /** Procurement › Tenders: each work package from tender papers to a signed contract, with its bidders. Withheld from a grant that does not name Procurement. See `tenders.ts`. */
  procurement?: import('./tenders').ProcurementRegister;
  /** What the team should hear about; raised and resolved from the project's state. */
  alerts?: import('./alerts').ProjectAlert[];
  /** The folder kept elsewhere that this project takes its files from. Absent on a project connected to none. */
  connector?: import('./connectors').ProjectConnector;
  /** Meetings whose notes were kept: the day, who was there, where the words are stored and what was proposed from them. Never the words. See `meetings.ts`. */
  meetings?: import('./meetings').MeetingRecord[];
  /** Links between departments a person drew; the system's own are read on demand. */
  links?: import('./links').ProjectLink[];
  /** The review table: the questions put to the papers, what a model answered (never a value of a paper), and the rows a person marked reviewed. See `review-table.ts`. */
  reviewTable?: import('./review-table').ReviewTable;
  /** What goes out: letters, replies, requests for information and minutes, each a draft until a person approves it by name. See `outgoing.ts`. */
  outgoing?: import('./outgoing').OutgoingDraft[];
  /** Who was told of what was filed, accepted or answered, and who has quieted the project. See `tell.ts`. */
  tell?: import('./tell').TellState;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  reference: string;
  name: string;
  type: ProjectArchetype;
  city: string;
  location: string;
  status: ProjectStatus;
  currentStage: LifecycleStage;
  health: ProjectHealth;
  activeDdCount: number;
  openFindings: number;
  openRisks: number;
  overdueActions: number;
  evidenceMissing: number;
  portfolio?: string;
  /** The engagement the project is mostly working for. */
  engagement?: import('./engagements').Engagement;
  /** How many engagements are on it. */
  engagements?: number;
  /** Alerts raised and not yet resolved, and how many of them are critical. */
  openAlerts?: number;
  criticalAlerts?: number;
  /** The departments it uses, when it chose its own. */
  departments?: import('./departments').DepartmentKey[];
  /** Requests sent and not yet answered. */
  waitingOn: number;
  /** Proposals and drafts a person has not yet accepted or rejected. */
  pendingDecisions: number;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  type: ProjectArchetype;
  location: string;
  city: string;
  currentStage?: LifecycleStage;
  description?: string;
  jurisdiction?: string;
  siteAddress?: string;
  owner?: string;
  developer?: string;
  landAreaSqm?: number;
  builtUpAreaSqm?: number;
  saleableAreaSqm?: number;
  budget?: number;
  currency?: 'INR' | 'EUR';
  portfolio?: string;
  parcelId?: string;
  siteCoordinate?: GeoPoint;
  tenure?: Tenure;
  plot?: PlotAttributes;
  karnataka?: KarnatakaAttributes;
  /** The first engagement, when the project is created for one. */
  engagement?: import('./engagements').CreateEngagementInput;
  /** The departments this project uses; the firm's default when absent. */
  departments?: import('./departments').DepartmentKey[];
}

export interface PatchProjectInput {
  name?: string;
  description?: string;
  location?: string;
  city?: string;
  jurisdiction?: string;
  siteAddress?: string;
  owner?: string;
  developer?: string;
  landAreaSqm?: number;
  builtUpAreaSqm?: number;
  saleableAreaSqm?: number;
  budget?: number;
  portfolio?: string;
  status?: ProjectStatus;
  parcelId?: string;
  siteCoordinate?: GeoPoint;
  tenure?: Tenure;
  plot?: PlotAttributes;
  /**
   * State-pack particulars. Patched whole rather than merged field by field:
   * these are matters of record, and a partial update that left a stale khata
   * type beside a new conversion status would read as one consistent record
   * of a property when it is two.
   */
  karnataka?: KarnatakaAttributes;
}

export interface CreateAssetInput {
  name: string;
  assetType: string;
  uniclassCode?: string;
  uniclassTitle?: string;
  parentId?: string;
  currentStage?: LifecycleStage;
  zone?: string;
  description?: string;
  responsible?: string;
}

export interface PatchAssetInput {
  name?: string;
  assetType?: string;
  uniclassCode?: string;
  uniclassTitle?: string;
  description?: string;
  zone?: string;
  responsible?: string;
}

export interface CreateAssessmentInput {
  name?: string;
  ddType: DdTypeKey;
  objective?: string;
  targetType: DdTargetType;
  targetAssetIds?: string[];
  owner: string;
  reviewer?: string;
  periodStart?: string;
  periodEnd?: string;
  extraScopes?: ScopeKey[];
  excludeScopes?: ScopeKey[];
  priorAssessmentId?: string;
}

export interface RecordCheckInput {
  result: CheckResult;
  comments?: string;
  evidenceIds?: string[];
  owner?: string;
  createFinding?: boolean;
  findingTitle?: string;
  findingDescription?: string;
  findingSeverity?: FindingSeverity;
}

export interface CreateEvidenceInput {
  title: string;
  kind: EvidenceKind;
  description?: string;
  source?: string;
  owner?: string;
  status?: EvidenceStatus;
  assetIds?: string[];
  assessmentIds?: string[];
  scopeInstanceIds?: string[];
  checkIds?: string[];
  fileName?: string;
  iso19650?: Iso19650Ref;
  quotes?: Array<{ text: string; page?: number }>;
  extractionNotes?: string;
  /** Set when the property screen raised this, so a re-run does not file it twice. */
  screenCode?: string;
}

export interface CreateFindingInput {
  title: string;
  description: string;
  severity: FindingSeverity;
  discipline: ScopeKey;
  status?: FindingStatus;
  owner?: string;
  sourceAssessmentId?: string;
  sourceScopeId?: string;
  sourceCheckId?: string;
  assetIds?: string[];
  assessmentIds?: string[];
  evidenceIds?: string[];
  escalation?: RicsEscalation;
  environmentalCondition?: EnvironmentalCondition;
  /** Set when the property screen raised this, so a re-run does not file it twice. */
  screenCode?: string;
}

export interface CreateRiskInput {
  title: string;
  category: RiskImpactType;
  cause: string;
  impactType: RiskImpactType;
  probability: Probability;
  impactScore: ImpactScore;
  materiality: FindingSeverity;
  owner?: string;
  mitigation?: string;
  findingIds?: string[];
  assetIds?: string[];
  assessmentIds?: string[];
  /** Set when the property screen raised this, so a re-run does not file it twice. */
  screenCode?: string;
}

export interface CreateActionInput {
  title: string;
  kind: ActionKind;
  owner: string;
  priority: FindingSeverity;
  description?: string;
  dueDate?: string;
  costEstimate?: number;
  costBand?: RemedialBand;
  findingIds?: string[];
  riskIds?: string[];
  evidenceIds?: string[];
  checkIds?: string[];
  /** Set when the property screen raised this, so a re-run does not file it twice. */
  screenCode?: string;
}

export interface CreateDecisionInput {
  title: string;
  decisionType: DecisionType;
  decisionMaker: string;
  rationale: string;
  status?: DecisionStatus;
  alternatives?: string;
  conditions?: string;
  findingIds?: string[];
  riskIds?: string[];
  actionIds?: string[];
  evidenceIds?: string[];
  assessmentIds?: string[];
  /** Set when the property screen raised this, so a re-run does not file it twice. */
  screenCode?: string;
}

export interface GenerateReportInput {
  kind: ReportKind;
  assessmentIds?: string[];
  generatedBy: string;
  /** For a status report: the period it covers, and who it is written for. The week so far when left out. For a function's report: the period it is for, whose last day its fields are read as at. */
  period?: { from: string; to: string };
  audience?: string;
  /** For a function's report: the template it is laid out from, by id. */
  template?: string;
}
