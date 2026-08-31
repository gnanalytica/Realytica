/**
 * Realytica operating model — the BRD's manual system of record.
 *
 * A project is the primary object. Due diligence assessments run against it
 * (or against selected assets), instantiate reusable scopes and checks, and
 * write into shared project-level registers. AI is a later execution layer
 * on these same records; nothing here requires a model to function.
 */

import type { SiteContext } from '../types';

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

export interface ReportBody {
  summary: string;
  sections: ReportSection[];
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
  kind:
    | 'project'
    | 'asset'
    | 'assessment'
    | 'scope'
    | 'evidence'
    | 'finding'
    | 'risk'
    | 'action'
    | 'decision'
    | 'report'
    | 'thought'
    | 'question'
    | 'proposal';
  label: string;
  detail?: string;
}

export interface ProjectGraphEdge {
  id: string;
  from: string;
  to: string;
  rel: string;
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
  | 'generate_report'
  | 'run_valuation'
  | 'run_screen'
  | 'patch_project'
  | 'patch_asset'
  | 'change_stage'
  | 'open_connector'
  | 'commit_draft'
  | 'snapshot_capabilities';

export type ChatSideIntentKind = 'places' | 'web_search' | 'connectors' | 'locality' | 'capabilities' | 'commit_drafts';

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
  navigations: { target: string }[];
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
  /** Last property-screen snapshot. The engine writes registers; this is the headline. */
  lastScreen?: ProjectScreenSnapshot;
  /** Places/geocode cache for this project's site address. */
  siteContext?: SiteContext;
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
