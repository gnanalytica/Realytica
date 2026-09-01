/**
 * Realytica operating model — the BRD's manual system of record.
 *
 * A project is the primary object. Due diligence assessments run against it
 * (or against selected assets), instantiate reusable scopes and checks, and
 * write into shared project-level registers. AI is a later execution layer
 * on these same records; nothing here requires a model to function.
 */

import type {
  ChatChoice,
  KarnatakaAttributes,
  ParcelBoundary,
  PlotAttributes,
  ScreenResult,
  SiteContext,
  Tenure,
} from '../types';

export type { ChatChoice } from '../types';

import type { ProjectGraphEdgeKind, ProjectGraphLayer, ProjectGraphNodeKind } from './project-ontology';

export type { ProjectGraphEdgeKind, ProjectGraphLayer, ProjectGraphNodeKind } from './project-ontology';

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
  | 'handover_readiness';

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

export type CheckFieldKind = 'text' | 'number' | 'money' | 'area' | 'percent' | 'date' | 'enum' | 'boolean';

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
}

export interface CheckFieldValue {
  value: string | number | boolean | null;
  /** The evidence row this was read off, when it came from a document. */
  sourceEvidenceId?: string;
  at: string;
  by: string;
}

/**
 * A rule that turns recorded values into an observation.
 *
 * Arithmetic, not generation: the engine owns conclusions drawn from numbers,
 * exactly as it owns the screen's. A model may read an insight; it may not
 * author one.
 */
export interface CheckInsightRule {
  kind: 'compare' | 'before' | 'require';
  /** The field keys the rule reads, in the order the template names them. */
  fields: string[];
  /** Relative tolerance for `compare`. Defaults to 1%. */
  tolerance?: number;
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
  assetType: string;
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
  attachments: EvidenceAttachment[];
  /** Verbatim DI quotes copied off the ingest card when the person approved. */
  quotes?: Array<{ text: string; page?: number }>;
  extractionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedAt: string;
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
  createdAt: string;
  updatedAt: string;
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
  findingIds: string[];
  riskIds: string[];
  evidenceIds: string[];
  checkIds: string[];
  closureEvidenceIds: string[];
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
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
  reviewer?: string;
}

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
  | 'changes_since_previous';

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
}

export interface ResolvedReportBlock {
  lines: string[];
  recordIds: string[];
  /** Said instead of inventing a line, when the registers have nothing to show. */
  note?: string;
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
}

export interface ValuationApproachResult {
  approach: ValuationApproach;
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
  indicatedValue: number;
  low: number;
  high: number;
  currency: 'INR' | 'EUR';
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

/** Structurally the copilot turn the cockpit chat panel already renders. */
export interface ProjectChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  /**
   * Options offered because the message did not resolve to one thing.
   * Present only on a turn that asked rather than acted.
   */
  choices?: ChatChoice[];
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
   * Questions the model asked beyond the first, held rather than shown.
   *
   * An interview asks one thing at a time; a turn with three questions gets
   * the last one answered and loses the other two. These are kept so the
   * thread can continue rather than cut, and surfaced as "next, I'll ask…".
   */
  heldQuestions?: string[];
  /** Prose was dropped to fit the turn budget, so the UI can offer “say more”. */
  trimmed?: boolean;
  citedEvidenceIds: string[];
  citedNodeIds?: string[];
  toolCalls?: { name: string; summary: string }[];
  refusedForLackOfEvidence?: boolean;
  proposalIds?: string[];
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
  | 'snapshot_capabilities';

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
  citedNodeIds?: string[];
  createdAt: string;
  createdBy: string;
  committedRecordId?: string;
}

export interface ChatIngestFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  excerpt?: string;
  /** Verbatim notes from document intelligence — never a substitute for approve. */
  extractionNotes?: string;
  quotes?: Array<{ text: string; page?: number }>;
  pages?: number;
  kindHint?: string;
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

export interface DdProject {
  id: string;
  reference: string;
  name: string;
  type: ProjectArchetype;
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
  reports: GeneratedReport[];
  valuationRuns: ValuationRun[];
  capabilityRuns: CapabilityRun[];
  aiDrafts: AiDraft[];
  conversation: ProjectChatTurn[];
  chatProposals: ChatProposal[];
  orchestratorRuns: OrchestratorRun[];
  audit: AuditEvent[];
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
  tenure?: Tenure;
  plot?: PlotAttributes;
  karnataka?: KarnatakaAttributes;
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
  parentId?: string;
  currentStage?: LifecycleStage;
  zone?: string;
  description?: string;
  responsible?: string;
}

export interface PatchAssetInput {
  name?: string;
  assetType?: string;
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
  quotes?: Array<{ text: string; page?: number }>;
  extractionNotes?: string;
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
}

export interface CreateActionInput {
  title: string;
  kind: ActionKind;
  owner: string;
  priority: FindingSeverity;
  description?: string;
  dueDate?: string;
  findingIds?: string[];
  riskIds?: string[];
  evidenceIds?: string[];
  checkIds?: string[];
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
}

export interface GenerateReportInput {
  kind: ReportKind;
  assessmentIds?: string[];
  generatedBy: string;
}
