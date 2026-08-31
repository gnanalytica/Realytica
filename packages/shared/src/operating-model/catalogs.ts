import type {
  ActionKind,
  ActionStatus,
  AssessmentStatus,
  CheckResult,
  DecisionStatus,
  DecisionType,
  DdTypeKey,
  EvidenceKind,
  EvidenceStatus,
  FindingSeverity,
  FindingStatus,
  LifecycleStage,
  ProjectArchetype,
  ProjectHealth,
  ProjectStatus,
  ReportKind,
  RiskImpactType,
  ValuationApproach,
  ValuationBasis,
  ValuationPremise,
  ValuationRunStatus,
  ValuationSignOff,
  CapabilityKind,
  AiDraftKind,
  AiDraftStatus,
  DdRiskStatus,
  ScopeKey,
} from './types';

export const PROJECT_ARCHETYPES: { key: ProjectArchetype; label: string; examples: string }[] = [
  { key: 'residential', label: 'Residential', examples: 'Apartments, villas, townships, gated communities' },
  { key: 'commercial', label: 'Commercial', examples: 'Office towers, business parks, malls, retail' },
  { key: 'mixed_use', label: 'Mixed-use', examples: 'Residential + office + retail + hospitality' },
  { key: 'industrial', label: 'Industrial', examples: 'Factories, manufacturing plants, industrial parks' },
  { key: 'logistics', label: 'Logistics', examples: 'Warehouses, distribution centres, logistics parks' },
  { key: 'hospitality', label: 'Hospitality', examples: 'Hotels, resorts, serviced apartments' },
  { key: 'healthcare', label: 'Healthcare', examples: 'Hospitals, clinics, medical campuses' },
  { key: 'institutional', label: 'Institutional', examples: 'Schools, colleges, public buildings' },
  { key: 'large_campus', label: 'Large campus', examples: 'Corporate campus, technology park' },
  { key: 'specialized', label: 'Specialized', examples: 'Data centres, utility-intensive developments' },
];

export const LIFECYCLE_STAGES: { key: LifecycleStage; label: string; meaning: string }[] = [
  { key: 'opportunity_site', label: 'Opportunity / Site', meaning: 'Site or project is being identified or screened.' },
  { key: 'feasibility', label: 'Feasibility', meaning: 'Development options and business case are being evaluated.' },
  { key: 'acquisition', label: 'Acquisition / Pre-development', meaning: 'Commitment, acquisition, JV/JDA, or development rights are being assessed.' },
  { key: 'design', label: 'Design', meaning: 'Concept, schematic, detailed, or discipline design is in progress.' },
  { key: 'approvals', label: 'Approvals', meaning: 'Authorities, NOCs, permits, and approval conditions are being pursued.' },
  { key: 'procurement', label: 'Procurement', meaning: 'Contractors, consultants, vendors, and packages are being tendered or awarded.' },
  { key: 'pre_construction', label: 'Pre-construction', meaning: 'Project is preparing to mobilise construction.' },
  { key: 'construction', label: 'Construction', meaning: 'Execution is active.' },
  { key: 'testing_commissioning', label: 'Testing / Commissioning', meaning: 'Systems are tested and commissioned.' },
  { key: 'completion', label: 'Completion', meaning: 'Works are being completed and closed out.' },
  { key: 'handover', label: 'Handover', meaning: 'Asset is being prepared for owner/user/tenant handover.' },
  { key: 'operations', label: 'Operations', meaning: 'Asset is operational or post-completion.' },
];

export const SCOPE_KEYS: ScopeKey[] = [
  'land_site',
  'legal',
  'regulatory',
  'technical',
  'cost_quantity',
  'schedule_progress',
  'commercial_market',
  'financial_appraisal',
  'procurement',
  'quality',
  'hse',
  'esg',
  'condition_operations',
  'indicative_valuation',
];

export const DD_TYPE_KEYS: DdTypeKey[] = [
  'acquisition',
  'feasibility',
  'design',
  'approval_compliance',
  'pre_construction_readiness',
  'procurement_contractor',
  'construction_progress',
  'technical',
  'cost',
  'cost_schedule',
  'quality',
  'hse',
  'completion',
  'handover_readiness',
  'operational_condition',
  'full_project_health',
  'indicative_valuation',
  'custom',
];

export const PROJECT_ARCHETYPE_LABEL: Record<ProjectArchetype, string> = Object.fromEntries(
  PROJECT_ARCHETYPES.map((a) => [a.key, a.label]),
) as Record<ProjectArchetype, string>;

export const LIFECYCLE_STAGE_LABEL: Record<LifecycleStage, string> = Object.fromEntries(
  LIFECYCLE_STAGES.map((s) => [s.key, s.label]),
) as Record<LifecycleStage, string>;

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  on_hold: 'On hold',
  closed: 'Closed',
};

export const PROJECT_HEALTH_LABEL: Record<ProjectHealth, string> = {
  green: 'Healthy',
  amber: 'Watch',
  red: 'At risk',
  unknown: 'Unknown',
};

export const ASSESSMENT_STATUS_LABEL: Record<AssessmentStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  in_review: 'In review',
  completed: 'Completed',
  archived: 'Archived',
};

/** Every check result, as data — so a validator cannot drift from the type. */
export const CHECK_RESULTS: CheckResult[] = [
  'pending',
  'compliant',
  'non_compliant',
  'partially_compliant',
  'not_applicable',
  'unable_to_verify',
  'missing_evidence',
  'requires_expert_review',
];

export const CHECK_RESULT_LABEL: Record<CheckResult, string> = {
  pending: 'Not started',
  compliant: 'Compliant',
  non_compliant: 'Non-compliant',
  partially_compliant: 'Partially compliant',
  not_applicable: 'Not applicable',
  unable_to_verify: 'Unable to verify',
  missing_evidence: 'Missing evidence',
  requires_expert_review: 'Requires expert review',
};

export const EVIDENCE_STATUS_LABEL: Record<EvidenceStatus, string> = {
  expected: 'Expected',
  requested: 'Requested',
  received: 'Received',
  validated: 'Validated',
  used: 'Used',
  superseded: 'Superseded',
  rejected: 'Rejected',
  missing: 'Missing',
};

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  document: 'Document',
  drawing: 'Drawing',
  approval: 'Approval',
  contract: 'Contract',
  boq: 'BOQ',
  invoice: 'Invoice',
  photograph: 'Photograph',
  schedule: 'Schedule',
  inspection: 'Inspection',
  test_report: 'Test report',
  certificate: 'Certificate',
  correspondence: 'Correspondence',
  market_comparable: 'Market comparable',
  gis: 'GIS / survey',
  other: 'Other',
};

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  draft: 'Draft',
  under_review: 'Under review',
  open: 'Open',
  accepted: 'Accepted',
  rejected: 'Rejected',
  duplicate: 'Duplicate',
  monitoring: 'Monitoring',
  closed: 'Closed',
  superseded: 'Superseded',
};

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const RISK_STATUS_LABEL: Record<DdRiskStatus, string> = {
  identified: 'Identified',
  assessed: 'Assessed',
  accepted: 'Accepted',
  mitigated: 'Mitigated',
  monitoring: 'Monitoring',
  escalated: 'Escalated',
  closed: 'Closed',
};

export const IMPACT_TYPE_LABEL: Record<RiskImpactType, string> = {
  cost: 'Cost',
  time: 'Time',
  quality: 'Quality',
  safety: 'Safety',
  compliance: 'Compliance',
  legal: 'Legal',
  commercial: 'Commercial',
  operational: 'Operational',
  esg: 'ESG',
  valuation: 'Valuation',
  reputation: 'Reputation',
  handover: 'Handover',
};

export const ACTION_KIND_LABEL: Record<ActionKind, string> = {
  remediation: 'Remediation',
  clarification: 'Clarification',
  evidence_request: 'Evidence request',
  expert_review: 'Expert review',
  reinspection: 'Reinspection',
  approval_submission: 'Approval submission',
  cost_update: 'Cost update',
  schedule_update: 'Schedule update',
  decision_request: 'Decision request',
  report_update: 'Report update',
};

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  overdue: 'Overdue',
  submitted: 'Submitted',
  under_review: 'Under review',
  closed: 'Closed',
};

export const DECISION_TYPE_LABEL: Record<DecisionType, string> = {
  proceed: 'Proceed',
  renegotiate: 'Renegotiate',
  reject: 'Reject',
  approve_with_conditions: 'Approve with conditions',
  hold_payment: 'Hold payment',
  require_remediation: 'Require remediation',
  proceed_to_handover: 'Proceed to handover',
  commission_valuation: 'Commission professional valuation',
  other: 'Other',
};

export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  proposed: 'Proposed',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  deferred: 'Deferred',
  conditional: 'Conditional',
  implemented: 'Implemented',
};

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  executive_dd: 'Executive DD report',
  detailed_dd: 'Detailed DD report',
  red_flag: 'Red flag report',
  evidence_completeness: 'Evidence completeness',
  open_risk_action: 'Open risks and actions',
  changes_since_previous: 'Changes since previous DD',
  indicative_valuation: 'Indicative valuation',
  handover_readiness: 'Handover readiness',
};

export const VALUATION_PREMISE_LABEL: Record<ValuationPremise, string> = {
  as_is: 'As-is',
  as_completed: 'As completed',
  residual: 'Residual / development',
  forced_sale: 'Forced sale',
};

export const VALUATION_BASIS_LABEL: Record<ValuationBasis, string> = {
  market_value: 'Market value',
  investment_value: 'Investment value',
  liquidation: 'Liquidation',
  replacement_cost: 'Replacement cost',
};

export const VALUATION_APPROACH_LABEL: Record<ValuationApproach, string> = {
  market: 'Market / comparable',
  cost: 'Cost / replacement',
  income: 'Income',
  residual: 'Residual',
};

export const VALUATION_SIGN_OFF_LABEL: Record<ValuationSignOff, string> = {
  unsigned: 'Unsigned — indicative only',
  internal_review: 'Internal review',
  registered_valuer_required: 'Registered valuer required for certification',
};

export const VALUATION_RUN_STATUS_LABEL: Record<ValuationRunStatus, string> = {
  draft: 'Draft',
  computed: 'Computed',
  in_review: 'In review',
  issued: 'Issued (indicative)',
  superseded: 'Superseded',
};

export const CAPABILITY_KIND_LABEL: Record<CapabilityKind, string> = {
  valuation: 'Indicative valuation',
  cost: 'Cost & quantity',
  schedule: 'Schedule & progress',
  market: 'Market & commercial',
  benchmarking: 'Benchmarking',
  report_builder: 'Report builder',
};

export const AI_DRAFT_KIND_LABEL: Record<AiDraftKind, string> = {
  finding: 'Finding',
  risk: 'Risk',
  action: 'Action',
  decision: 'Decision',
  report_section: 'Report section',
  check_comment: 'Check comment',
  orchestrator_plan: 'DD orchestrator plan',
};

export const AI_DRAFT_STATUS_LABEL: Record<AiDraftStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  committed: 'Committed to register',
};

export const SCOPE_LABEL: Record<ScopeKey, string> = {
  land_site: 'Land & Site',
  legal: 'Legal',
  regulatory: 'Regulatory & Planning',
  technical: 'Technical & Design',
  cost_quantity: 'Cost & Quantity',
  schedule_progress: 'Schedule & Progress',
  commercial_market: 'Commercial & Market',
  financial_appraisal: 'Financial / Appraisal',
  procurement: 'Procurement & Contractual',
  quality: 'Quality',
  hse: 'HSE',
  esg: 'Environmental / ESG',
  condition_operations: 'Condition / Operations',
  indicative_valuation: 'Indicative Valuation',
};
