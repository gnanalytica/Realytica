import { CHECK_DEFINITIONS, DD_TYPE_DEFINITIONS, SCOPE_DEFINITIONS, checksForScope, ddTypeDefinition } from './libraries';
import { LIFECYCLE_STAGE_LABEL, REPORT_KIND_LABEL, SCOPE_LABEL } from './catalogs';
import type {
  ActionRecord,
  Asset,
  AuditEvent,
  CheckInstance,
  CreateActionInput,
  CreateAssessmentInput,
  CreateAssetInput,
  CreateDecisionInput,
  CreateEvidenceInput,
  CreateFindingInput,
  CreateProjectInput,
  CreateRiskInput,
  DdAssessment,
  PatchAssetInput,
  DdProject,
  DecisionRecord,
  EvidenceRecord,
  FindingRecord,
  GenerateReportInput,
  GeneratedReport,
  LifecycleStage,
  ProjectHealth,
  ProjectSummary,
  RecordCheckInput,
  ReportBody,
  ReportSection,
  RiskRecord,
  ScopeInstance,
  ScopeKey,
  StageRecord,
} from './types';

const DEFAULT_ACTOR = 'operator';

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  const uuid = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function touch(project: DdProject, at = nowIso()): void {
  project.updatedAt = at;
}

function audit(
  project: DdProject,
  event: Omit<AuditEvent, 'id' | 'at'> & { at?: string },
): void {
  project.audit.push({
    id: id('aud'),
    at: event.at ?? nowIso(),
    actor: event.actor,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    reason: event.reason,
    oldValue: event.oldValue,
    newValue: event.newValue,
  });
}

export function deriveHealth(project: DdProject): ProjectHealth {
  const openCritical = project.findings.filter((f) => f.status === 'open' && f.severity === 'critical').length;
  const openHighRisks = project.risks.filter((r) => r.status !== 'closed' && r.status !== 'accepted' && (r.materiality === 'critical' || r.materiality === 'high')).length;
  if (openCritical > 0 || openHighRisks >= 3) return 'red';
  const openFindings = project.findings.filter((f) => f.status === 'open' || f.status === 'under_review').length;
  if (openFindings > 0 || openHighRisks > 0) return 'amber';
  if (project.assessments.length === 0) return 'unknown';
  return 'green';
}

export function ensureProjectShape(project: DdProject): void {
  if (!project.valuationRuns) project.valuationRuns = [];
  if (!project.capabilityRuns) project.capabilityRuns = [];
  if (!project.aiDrafts) project.aiDrafts = [];
  if (!project.conversation) project.conversation = [];
  if (!project.chatProposals) project.chatProposals = [];
  if (!project.orchestratorRuns) project.orchestratorRuns = [];
  if (!project.stakeholders) project.stakeholders = [];
  for (const row of project.evidence) {
    if (!row.attachments) row.attachments = [];
  }
}

export function refreshProjectDerived(project: DdProject): void {
  ensureProjectShape(project);
  project.health = deriveHealth(project);
  for (const action of project.actions) {
    if (action.status !== 'closed' && action.dueDate && action.dueDate < nowIso().slice(0, 10) && action.status !== 'overdue') {
      action.status = 'overdue';
    }
  }
}

export function toProjectSummary(project: DdProject): ProjectSummary {
  refreshProjectDerived(project);
  const today = nowIso().slice(0, 10);
  return {
    id: project.id,
    reference: project.reference,
    name: project.name,
    type: project.type,
    city: project.city,
    location: project.location,
    status: project.status,
    currentStage: project.currentStage,
    health: project.health,
    activeDdCount: project.assessments.filter((a) => a.status === 'active' || a.status === 'in_review' || a.status === 'draft').length,
    openFindings: project.findings.filter((f) => f.status === 'open' || f.status === 'under_review' || f.status === 'draft').length,
    openRisks: project.risks.filter((r) => r.status !== 'closed' && r.status !== 'accepted').length,
    overdueActions: project.actions.filter((a) => a.status === 'overdue' || (a.status !== 'closed' && a.dueDate && a.dueDate < today)).length,
    evidenceMissing: project.evidence.filter((e) => e.status === 'missing' || e.status === 'expected' || e.status === 'requested').length,
    portfolio: project.portfolio,
    updatedAt: project.updatedAt,
  };
}

export function createProject(input: CreateProjectInput, reference: string, actor = DEFAULT_ACTOR): DdProject {
  const at = nowIso();
  const stage = input.currentStage ?? 'opportunity_site';
  const project: DdProject = {
    id: id('prj'),
    reference,
    name: input.name.trim(),
    type: input.type,
    description: input.description,
    location: input.location.trim(),
    city: input.city.trim(),
    jurisdiction: input.jurisdiction,
    siteAddress: input.siteAddress,
    status: 'active',
    currentStage: stage,
    stageHistory: [],
    health: 'unknown',
    owner: input.owner,
    developer: input.developer,
    landAreaSqm: input.landAreaSqm,
    builtUpAreaSqm: input.builtUpAreaSqm,
    saleableAreaSqm: input.saleableAreaSqm,
    budget: input.budget,
    currency: input.currency ?? 'INR',
    portfolio: input.portfolio,
    parcelId: input.parcelId,
    tenure: input.tenure,
    plot: input.plot,
    karnataka: input.karnataka,
    stakeholders: [],
    assets: [],
    assessments: [],
    evidence: [],
    findings: [],
    risks: [],
    actions: [],
    decisions: [],
    reports: [],
    valuationRuns: [],
    capabilityRuns: [],
    aiDrafts: [],
    conversation: [],
    chatProposals: [],
    orchestratorRuns: [],
    audit: [],
    createdAt: at,
    updatedAt: at,
  };
  const opening: StageRecord = {
    id: id('stg'),
    subject: 'project',
    stage,
    effectiveAt: at,
    actor,
    reason: 'Project created',
    evidenceIds: [],
  };
  project.stageHistory.push(opening);
  audit(project, { actor, action: 'create', entityType: 'project', entityId: project.id, newValue: project.name, at });
  return project;
}

export function addAsset(project: DdProject, input: CreateAssetInput, actor = DEFAULT_ACTOR): Asset {
  if (input.parentId && !project.assets.some((a) => a.id === input.parentId)) {
    throw new Error('Parent asset not found');
  }
  const at = nowIso();
  const stage = input.currentStage ?? project.currentStage;
  const assetId = id('ast');
  const asset: Asset = {
    id: assetId,
    parentId: input.parentId,
    name: input.name.trim(),
    assetType: input.assetType.trim(),
    description: input.description,
    zone: input.zone,
    currentStage: stage,
    stageHistory: [
      {
        id: id('stg'),
        subject: 'asset',
        assetId,
        stage,
        effectiveAt: at,
        actor,
        reason: 'Asset created',
        evidenceIds: [],
      },
    ],
    responsible: input.responsible,
    createdAt: at,
    updatedAt: at,
  };
  project.assets.push(asset);
  touch(project, at);
  audit(project, { actor, action: 'create', entityType: 'asset', entityId: asset.id, newValue: asset.name, at });
  return asset;
}

export function patchAsset(project: DdProject, assetId: string, input: PatchAssetInput, actor = DEFAULT_ACTOR): Asset {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error('Asset not found');
  const at = nowIso();
  const previous = asset.name;
  if (input.name !== undefined) asset.name = input.name.trim();
  if (input.assetType !== undefined) asset.assetType = input.assetType.trim();
  if (input.description !== undefined) asset.description = input.description;
  if (input.zone !== undefined) asset.zone = input.zone;
  if (input.responsible !== undefined) asset.responsible = input.responsible;
  asset.updatedAt = at;
  touch(project, at);
  audit(project, {
    actor,
    action: 'patch',
    entityType: 'asset',
    entityId: asset.id,
    oldValue: previous,
    newValue: asset.name,
    at,
  });
  return asset;
}

export function changeStage(
  project: DdProject,
  input: { subject: 'project' | 'asset'; assetId?: string; stage: LifecycleStage; reason: string; evidenceIds?: string[] },
  actor = DEFAULT_ACTOR,
): StageRecord {
  const at = nowIso();
  if (input.subject === 'asset') {
    const asset = project.assets.find((a) => a.id === input.assetId);
    if (!asset) throw new Error('Asset not found');
    const previous = asset.currentStage;
    if (previous === input.stage) {
      throw new Error('Stage is already current');
    }
    const record: StageRecord = {
      id: id('stg'),
      subject: 'asset',
      assetId: asset.id,
      stage: input.stage,
      previousStage: previous,
      effectiveAt: at,
      actor,
      reason: input.reason.trim(),
      evidenceIds: input.evidenceIds ?? [],
    };
    asset.currentStage = input.stage;
    asset.stageHistory.push(record);
    asset.updatedAt = at;
    touch(project, at);
    audit(project, {
      actor,
      action: 'stage_change',
      entityType: 'asset',
      entityId: asset.id,
      reason: input.reason,
      oldValue: previous,
      newValue: input.stage,
      at,
    });
    return record;
  }

  const previous = project.currentStage;
  if (previous === input.stage) {
    throw new Error('Stage is already current');
  }
  const record: StageRecord = {
    id: id('stg'),
    subject: 'project',
    stage: input.stage,
    previousStage: previous,
    effectiveAt: at,
    actor,
    reason: input.reason.trim(),
    evidenceIds: input.evidenceIds ?? [],
  };
  project.currentStage = record.stage;
  project.stageHistory.push(record);
  touch(project, at);
  audit(project, {
    actor,
    action: 'stage_change',
    entityType: 'project',
    entityId: project.id,
    reason: input.reason,
    oldValue: previous,
    newValue: input.stage,
    at,
  });
  return record;
}

function instantiateScope(assessmentId: string, scopeKey: ScopeKey, at: string): ScopeInstance {
  const defs = checksForScope(scopeKey);
  const scopeId = id('scp');
  const checks: CheckInstance[] = defs.map((def) => ({
    id: id('chk'),
    definitionId: def.id,
    scopeInstanceId: scopeId,
    assessmentId,
    section: def.section,
    title: def.title,
    purpose: def.purpose,
    expectedEvidence: [...def.expectedEvidence],
    acceptanceCriteria: def.acceptanceCriteria,
    result: 'pending',
    evidenceIds: [],
    findingIds: [],
    comments: '',
    updatedAt: at,
  }));
  return {
    id: scopeId,
    scopeKey,
    assessmentId,
    status: 'not_started',
    checks,
    createdAt: at,
    updatedAt: at,
  };
}

function seedExpectedEvidence(project: DdProject, assessment: DdAssessment, at: string): void {
  const seen = new Set<string>();
  for (const scope of assessment.scopes) {
    for (const check of scope.checks) {
      for (const title of check.expectedEvidence) {
        const key = `${scope.scopeKey}:${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (project.evidence.some((e) => e.title.toLowerCase() === title.toLowerCase() && e.scopeInstanceIds.includes(scope.id))) continue;
        if (project.evidence.some((e) => e.title.toLowerCase() === title.toLowerCase() && e.assessmentIds.includes(assessment.id))) continue;
        project.evidence.push({
          id: id('ev'),
          title,
          kind: 'document',
          description: `Expected for ${SCOPE_LABEL[scope.scopeKey]} · ${check.title}`,
          status: 'expected',
          considered: false,
          used: false,
          assetIds: [...assessment.targetAssetIds],
          assessmentIds: [assessment.id],
          scopeInstanceIds: [scope.id],
          checkIds: [check.id],
          attachments: [],
          createdAt: at,
          updatedAt: at,
        });
      }
    }
  }
}

export function createAssessment(project: DdProject, input: CreateAssessmentInput, actor = DEFAULT_ACTOR): DdAssessment {
  const preset = ddTypeDefinition(input.ddType);
  const at = nowIso();
  if (input.targetType === 'assets') {
    const ids = input.targetAssetIds ?? [];
    if (ids.length === 0) throw new Error('Select at least one asset for an asset-targeted DD');
    for (const assetId of ids) {
      if (!project.assets.some((a) => a.id === assetId)) throw new Error(`Unknown asset ${assetId}`);
    }
  }
  if (input.priorAssessmentId && !project.assessments.some((a) => a.id === input.priorAssessmentId)) {
    throw new Error('Prior assessment not found');
  }

  const exclude = new Set(input.excludeScopes ?? []);
  const extra = input.extraScopes ?? [];
  const scopeKeys = [...preset.defaultScopes, ...extra].filter((k, i, arr) => arr.indexOf(k) === i && !exclude.has(k));
  if (input.ddType === 'custom' && scopeKeys.length === 0) {
    throw new Error('A custom DD needs at least one scope');
  }

  const assessmentId = id('dd');
  const assessment: DdAssessment = {
    id: assessmentId,
    name: (input.name ?? preset.label).trim(),
    ddType: input.ddType,
    objective: (input.objective ?? preset.purpose).trim(),
    targetType: input.targetType,
    targetAssetIds: input.targetType === 'assets' ? [...(input.targetAssetIds ?? [])] : [],
    stageAtAssessment: project.currentStage,
    owner: input.owner.trim(),
    reviewer: input.reviewer,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    status: 'active',
    priorAssessmentId: input.priorAssessmentId,
    outputReportKind: preset.defaultReportKind,
    scopes: scopeKeys.map((key) => instantiateScope(assessmentId, key, at)),
    createdAt: at,
    updatedAt: at,
  };
  project.assessments.push(assessment);
  seedExpectedEvidence(project, assessment, at);
  touch(project, at);
  audit(project, {
    actor,
    action: 'create',
    entityType: 'assessment',
    entityId: assessment.id,
    newValue: `${assessment.name} (${assessment.ddType})`,
    at,
  });
  refreshProjectDerived(project);
  return assessment;
}

export function addScopeToAssessment(project: DdProject, assessmentId: string, scopeKey: ScopeKey, actor = DEFAULT_ACTOR): ScopeInstance {
  const assessment = project.assessments.find((a) => a.id === assessmentId);
  if (!assessment) throw new Error('Assessment not found');
  if (assessment.scopes.some((s) => s.scopeKey === scopeKey)) {
    throw new Error(`${SCOPE_LABEL[scopeKey]} is already on ${assessment.name}`);
  }
  const at = nowIso();
  const scope = instantiateScope(assessment.id, scopeKey, at);
  assessment.scopes.push(scope);
  assessment.updatedAt = at;
  seedExpectedEvidence(project, assessment, at);
  touch(project, at);
  audit(project, {
    actor,
    action: 'create',
    entityType: 'scope',
    entityId: scope.id,
    newValue: `${SCOPE_LABEL[scopeKey]} on ${assessment.name}`,
    at,
  });
  refreshProjectDerived(project);
  return scope;
}

export function findCheck(project: DdProject, checkId: string): { assessment: DdAssessment; scope: ScopeInstance; check: CheckInstance } {
  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      const check = scope.checks.find((c) => c.id === checkId);
      if (check) return { assessment, scope, check };
    }
  }
  throw new Error('Check not found');
}

const MATERIAL_RESULTS = new Set(['non_compliant', 'partially_compliant', 'unable_to_verify', 'missing_evidence']);

export function isMaterialCheckResult(result: RecordCheckInput['result']): boolean {
  return MATERIAL_RESULTS.has(result);
}

export function recordCheckResult(project: DdProject, checkId: string, input: RecordCheckInput, actor = DEFAULT_ACTOR): CheckInstance {
  const { assessment, scope, check } = findCheck(project, checkId);
  const at = nowIso();
  check.result = input.result;
  if (input.comments !== undefined) check.comments = input.comments;
  if (input.owner) check.owner = input.owner;
  if (input.evidenceIds) {
    check.evidenceIds = [...input.evidenceIds];
    for (const ev of project.evidence) {
      if (input.evidenceIds.includes(ev.id)) {
        if (!ev.checkIds.includes(check.id)) ev.checkIds.push(check.id);
        if (!ev.assessmentIds.includes(assessment.id)) ev.assessmentIds.push(assessment.id);
        if (!ev.scopeInstanceIds.includes(scope.id)) ev.scopeInstanceIds.push(scope.id);
        if (input.result !== 'pending' && (ev.status === 'validated' || ev.status === 'received' || ev.status === 'used')) {
          ev.used = true;
          ev.considered = true;
          if (ev.status === 'validated' || ev.status === 'received') ev.status = 'used';
        }
      }
    }
  }
  check.updatedAt = at;
  scope.status = scope.checks.every((c) => c.result !== 'pending') ? 'complete' : 'in_progress';
  scope.updatedAt = at;
  assessment.updatedAt = at;

  const shouldCreateFinding =
    input.createFinding === true || (input.createFinding !== false && isMaterialCheckResult(input.result));
  if (shouldCreateFinding && input.result !== 'pending' && input.result !== 'compliant' && input.result !== 'not_applicable') {
    const finding = addFinding(
      project,
      {
        title: input.findingTitle ?? check.title,
        description: input.findingDescription ?? (input.comments || `Check recorded as ${input.result}.`),
        severity: input.findingSeverity ?? (input.result === 'non_compliant' ? 'high' : 'medium'),
        discipline: scope.scopeKey,
        status: 'open',
        sourceAssessmentId: assessment.id,
        sourceScopeId: scope.id,
        sourceCheckId: check.id,
        assessmentIds: [assessment.id],
        assetIds: [...assessment.targetAssetIds],
        evidenceIds: check.evidenceIds,
      },
      actor,
    );
    if (!check.findingIds.includes(finding.id)) check.findingIds.push(finding.id);
  }

  touch(project, at);
  audit(project, {
    actor,
    action: 'check_result',
    entityType: 'check',
    entityId: check.id,
    newValue: input.result,
    reason: input.comments,
    at,
  });
  refreshProjectDerived(project);
  return check;
}

export function addEvidence(project: DdProject, input: CreateEvidenceInput, actor = DEFAULT_ACTOR): EvidenceRecord {
  const at = nowIso();
  const record: EvidenceRecord = {
    id: id('ev'),
    title: input.title.trim(),
    kind: input.kind,
    description: input.description,
    source: input.source,
    owner: input.owner,
    status: input.status ?? 'received',
    considered: false,
    used: false,
    assetIds: input.assetIds ?? [],
    assessmentIds: input.assessmentIds ?? [],
    scopeInstanceIds: input.scopeInstanceIds ?? [],
    checkIds: input.checkIds ?? [],
    fileName: input.fileName,
    attachments: [],
    quotes: input.quotes,
    extractionNotes: input.extractionNotes,
    createdAt: at,
    updatedAt: at,
  };
  project.evidence.push(record);
  touch(project, at);
  audit(project, { actor, action: 'create', entityType: 'evidence', entityId: record.id, newValue: record.title, at });
  return record;
}

export function updateEvidenceStatus(
  project: DdProject,
  evidenceId: string,
  status: EvidenceRecord['status'],
  extra: { rejectionReason?: string; considered?: boolean; used?: boolean } = {},
  actor = DEFAULT_ACTOR,
): EvidenceRecord {
  const record = project.evidence.find((e) => e.id === evidenceId);
  if (!record) throw new Error('Evidence not found');
  const at = nowIso();
  const previous = record.status;
  record.status = status;
  if (extra.rejectionReason !== undefined) record.rejectionReason = extra.rejectionReason;
  if (extra.considered !== undefined) record.considered = extra.considered;
  if (extra.used !== undefined) record.used = extra.used;
  if (status === 'used') {
    record.used = true;
    record.considered = true;
  }
  if (status === 'validated' || status === 'received') record.considered = true;
  record.updatedAt = at;
  touch(project, at);
  audit(project, {
    actor,
    action: 'status_change',
    entityType: 'evidence',
    entityId: record.id,
    oldValue: previous,
    newValue: status,
    at,
  });
  return record;
}

export function addFinding(project: DdProject, input: CreateFindingInput, actor = DEFAULT_ACTOR): FindingRecord {
  const at = nowIso();
  const record: FindingRecord = {
    id: id('fnd'),
    title: input.title.trim(),
    description: input.description.trim(),
    severity: input.severity,
    discipline: input.discipline,
    status: input.status ?? 'open',
    owner: input.owner,
    sourceAssessmentId: input.sourceAssessmentId,
    sourceScopeId: input.sourceScopeId,
    sourceCheckId: input.sourceCheckId,
    assetIds: input.assetIds ?? [],
    assessmentIds: input.assessmentIds ?? (input.sourceAssessmentId ? [input.sourceAssessmentId] : []),
    scopeInstanceIds: input.sourceScopeId ? [input.sourceScopeId] : [],
    evidenceIds: input.evidenceIds ?? [],
    riskIds: [],
    actionIds: [],
    decisionIds: [],
    includeInReport: true,
    createdAt: at,
    updatedAt: at,
  };
  project.findings.push(record);
  touch(project, at);
  audit(project, { actor, action: 'create', entityType: 'finding', entityId: record.id, newValue: record.title, at });
  refreshProjectDerived(project);
  return record;
}

export function addRisk(project: DdProject, input: CreateRiskInput, actor = DEFAULT_ACTOR): RiskRecord {
  const at = nowIso();
  const record: RiskRecord = {
    id: id('rsk'),
    title: input.title.trim(),
    category: input.category,
    cause: input.cause.trim(),
    impactType: input.impactType,
    probability: input.probability,
    impactScore: input.impactScore,
    materiality: input.materiality,
    mitigation: input.mitigation,
    owner: input.owner,
    status: 'identified',
    assetIds: input.assetIds ?? [],
    assessmentIds: input.assessmentIds ?? [],
    scopeInstanceIds: [],
    findingIds: input.findingIds ?? [],
    actionIds: [],
    evidenceIds: [],
    createdAt: at,
    updatedAt: at,
  };
  for (const findingId of record.findingIds) {
    const finding = project.findings.find((f) => f.id === findingId);
    if (finding && !finding.riskIds.includes(record.id)) finding.riskIds.push(record.id);
  }
  project.risks.push(record);
  touch(project, at);
  audit(project, { actor, action: 'create', entityType: 'risk', entityId: record.id, newValue: record.title, at });
  refreshProjectDerived(project);
  return record;
}

export function addAction(project: DdProject, input: CreateActionInput, actor = DEFAULT_ACTOR): ActionRecord {
  const at = nowIso();
  const record: ActionRecord = {
    id: id('act'),
    title: input.title.trim(),
    kind: input.kind,
    description: input.description,
    owner: input.owner.trim(),
    priority: input.priority,
    dueDate: input.dueDate,
    status: 'not_started',
    findingIds: input.findingIds ?? [],
    riskIds: input.riskIds ?? [],
    evidenceIds: input.evidenceIds ?? [],
    checkIds: input.checkIds ?? [],
    closureEvidenceIds: [],
    createdAt: at,
    updatedAt: at,
  };
  for (const findingId of record.findingIds) {
    const finding = project.findings.find((f) => f.id === findingId);
    if (finding && !finding.actionIds.includes(record.id)) finding.actionIds.push(record.id);
  }
  for (const riskId of record.riskIds) {
    const risk = project.risks.find((r) => r.id === riskId);
    if (risk && !risk.actionIds.includes(record.id)) risk.actionIds.push(record.id);
  }
  project.actions.push(record);
  touch(project, at);
  audit(project, { actor, action: 'create', entityType: 'action', entityId: record.id, newValue: record.title, at });
  refreshProjectDerived(project);
  return record;
}

export function addDecision(project: DdProject, input: CreateDecisionInput, actor = DEFAULT_ACTOR): DecisionRecord {
  const at = nowIso();
  const record: DecisionRecord = {
    id: id('dec'),
    title: input.title.trim(),
    decisionType: input.decisionType,
    decisionMaker: input.decisionMaker.trim(),
    status: input.status ?? 'proposed',
    rationale: input.rationale.trim(),
    alternatives: input.alternatives,
    conditions: input.conditions,
    findingIds: input.findingIds ?? [],
    riskIds: input.riskIds ?? [],
    actionIds: input.actionIds ?? [],
    evidenceIds: input.evidenceIds ?? [],
    assessmentIds: input.assessmentIds ?? [],
    createdAt: at,
    updatedAt: at,
  };
  for (const findingId of record.findingIds) {
    const finding = project.findings.find((f) => f.id === findingId);
    if (finding && !finding.decisionIds.includes(record.id)) finding.decisionIds.push(record.id);
  }
  project.decisions.push(record);
  touch(project, at);
  audit(project, { actor, action: 'create', entityType: 'decision', entityId: record.id, newValue: record.title, at });
  return record;
}

export function setAssessmentStatus(
  project: DdProject,
  assessmentId: string,
  status: DdAssessment['status'],
  actor = DEFAULT_ACTOR,
): DdAssessment {
  const assessment = project.assessments.find((a) => a.id === assessmentId);
  if (!assessment) throw new Error('Assessment not found');
  const at = nowIso();
  const previous = assessment.status;
  assessment.status = status;
  assessment.updatedAt = at;
  touch(project, at);
  audit(project, {
    actor,
    action: 'status_change',
    entityType: 'assessment',
    entityId: assessment.id,
    oldValue: previous,
    newValue: status,
    at,
  });
  refreshProjectDerived(project);
  return assessment;
}

export function patchRecordStatus<T extends { id: string; status: string; updatedAt: string }>(
  project: DdProject,
  collection: T[],
  recordId: string,
  status: T['status'],
  entityType: string,
  actor = DEFAULT_ACTOR,
): T {
  const record = collection.find((r) => r.id === recordId);
  if (!record) throw new Error(`${entityType} not found`);
  const at = nowIso();
  const previous = String(record.status);
  record.status = status;
  record.updatedAt = at;
  touch(project, at);
  audit(project, { actor, action: 'status_change', entityType, entityId: record.id, oldValue: previous, newValue: String(status), at });
  refreshProjectDerived(project);
  return record;
}

export function linkFindingAcross(
  project: DdProject,
  findingId: string,
  links: { assessmentIds?: string[]; assetIds?: string[]; evidenceIds?: string[] },
  actor = DEFAULT_ACTOR,
): FindingRecord {
  const finding = project.findings.find((f) => f.id === findingId);
  if (!finding) throw new Error('Finding not found');
  const at = nowIso();
  if (links.assessmentIds) {
    for (const idValue of links.assessmentIds) {
      if (!finding.assessmentIds.includes(idValue)) finding.assessmentIds.push(idValue);
    }
  }
  if (links.assetIds) {
    for (const idValue of links.assetIds) {
      if (!finding.assetIds.includes(idValue)) finding.assetIds.push(idValue);
    }
  }
  if (links.evidenceIds) {
    for (const idValue of links.evidenceIds) {
      if (!finding.evidenceIds.includes(idValue)) finding.evidenceIds.push(idValue);
    }
  }
  finding.updatedAt = at;
  touch(project, at);
  audit(project, { actor, action: 'link', entityType: 'finding', entityId: finding.id, at });
  return finding;
}

export interface RegisterFilter {
  assessmentId?: string;
  scopeInstanceId?: string;
  assetId?: string;
}

export function filterFindings(project: DdProject, filter: RegisterFilter = {}): FindingRecord[] {
  return project.findings.filter((f) => {
    if (filter.assessmentId && !f.assessmentIds.includes(filter.assessmentId) && f.sourceAssessmentId !== filter.assessmentId) return false;
    if (filter.scopeInstanceId && !f.scopeInstanceIds.includes(filter.scopeInstanceId) && f.sourceScopeId !== filter.scopeInstanceId) return false;
    if (filter.assetId && !f.assetIds.includes(filter.assetId)) return false;
    return true;
  });
}

export function filterRisks(project: DdProject, filter: RegisterFilter = {}): RiskRecord[] {
  return project.risks.filter((r) => {
    if (filter.assessmentId && !r.assessmentIds.includes(filter.assessmentId)) return false;
    if (filter.scopeInstanceId && !r.scopeInstanceIds.includes(filter.scopeInstanceId)) return false;
    if (filter.assetId && !r.assetIds.includes(filter.assetId)) return false;
    return true;
  });
}

export function filterEvidence(project: DdProject, filter: RegisterFilter = {}): EvidenceRecord[] {
  return project.evidence.filter((e) => {
    if (filter.assessmentId && !e.assessmentIds.includes(filter.assessmentId)) return false;
    if (filter.scopeInstanceId && !e.scopeInstanceIds.includes(filter.scopeInstanceId)) return false;
    if (filter.assetId && !e.assetIds.includes(filter.assetId)) return false;
    return true;
  });
}

export function scopeCompleteness(scope: ScopeInstance): { total: number; done: number; percent: number; findings: number; missing: number } {
  const total = scope.checks.length;
  const done = scope.checks.filter((c) => c.result !== 'pending').length;
  const missing = scope.checks.filter((c) => c.result === 'missing_evidence').length;
  const findings = scope.checks.reduce((n, c) => n + c.findingIds.length, 0);
  return { total, done, findings, missing, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export function assessmentProgress(assessment: DdAssessment): { percent: number; checkTotal: number; checkDone: number; scopeCount: number } {
  const checks = assessment.scopes.flatMap((s) => s.checks);
  const done = checks.filter((c) => c.result !== 'pending').length;
  return {
    percent: checks.length === 0 ? 0 : Math.round((done / checks.length) * 100),
    checkTotal: checks.length,
    checkDone: done,
    scopeCount: assessment.scopes.length,
  };
}

export function evidenceCompleteness(project: DdProject, assessmentId?: string): {
  expected: number;
  received: number;
  validated: number;
  used: number;
  missing: number;
  percent: number;
} {
  const rows = assessmentId ? project.evidence.filter((e) => e.assessmentIds.includes(assessmentId)) : project.evidence;
  const received = rows.filter((e) => ['received', 'validated', 'used'].includes(e.status)).length;
  const validated = rows.filter((e) => e.status === 'validated' || e.status === 'used').length;
  const used = rows.filter((e) => e.used || e.status === 'used').length;
  const missing = rows.filter((e) => e.status === 'missing' || e.status === 'expected' || e.status === 'requested').length;
  const denom = rows.length || 1;
  return { expected: rows.length, received, validated, used, missing, percent: Math.round(((rows.length - missing) / denom) * 100) };
}

/** Title, survey, sanction, fire NOC — the pack a sitting actually opens, not the 292-row library. */
const PACK_EVIDENCE_KEYS = [
  'title extract',
  'title chain',
  'title schedule',
  'sale deed',
  'mother deed',
  'encumbrance',
  'survey plan',
  'cadastral',
  'boundary survey',
  'conversion',
  'sanction',
  'layout plan',
  'khata',
  'fire noc',
  'soil report',
  'rera',
];

export function isPackEvidenceTitle(title: string): boolean {
  const t = title.toLowerCase();
  return PACK_EVIDENCE_KEYS.some((k) => t.includes(k));
}

function packGapStatus(e: EvidenceRecord): boolean {
  return e.status === 'expected' || e.status === 'missing' || e.status === 'requested';
}

function packReceivedStatus(e: EvidenceRecord): boolean {
  return e.status === 'received' || e.status === 'validated' || e.status === 'used';
}

export function packEvidence(project: DdProject): { pack: EvidenceRecord[]; tail: EvidenceRecord[] } {
  const pack: EvidenceRecord[] = [];
  const tail: EvidenceRecord[] = [];
  for (const row of project.evidence) {
    (isPackEvidenceTitle(row.title) ? pack : tail).push(row);
  }
  return { pack, tail };
}

export function packCompleteness(project: DdProject): {
  percent: number;
  received: number;
  missing: number;
  total: number;
  missingTitles: string[];
} {
  const { pack } = packEvidence(project);
  const missingRows = pack.filter(packGapStatus);
  const received = pack.filter(packReceivedStatus).length;
  const total = pack.length || PACK_EVIDENCE_KEYS.length;
  const missing = pack.length ? missingRows.length : PACK_EVIDENCE_KEYS.length;
  const percent = pack.length === 0 ? 0 : Math.round((received / pack.length) * 100);
  return {
    percent,
    received,
    missing,
    total,
    missingTitles: (pack.length ? missingRows.map((e) => e.title) : ['Title chain', 'Survey plan', 'Fire NOC']).slice(0, 6),
  };
}

export interface ChangeSincePrevious {
  priorId: string;
  priorName: string;
  newFindings: FindingRecord[];
  closedFindings: FindingRecord[];
  unresolvedFindings: FindingRecord[];
  repeatedTitles: string[];
}

export function changesSincePrevious(project: DdProject, assessmentId: string): ChangeSincePrevious | null {
  const current = project.assessments.find((a) => a.id === assessmentId);
  if (!current?.priorAssessmentId) return null;
  const prior = project.assessments.find((a) => a.id === current.priorAssessmentId);
  if (!prior) return null;
  const currentFindings = filterFindings(project, { assessmentId: current.id });
  const priorFindings = filterFindings(project, { assessmentId: prior.id });
  const priorTitles = new Set(priorFindings.map((f) => f.title.toLowerCase()));
  const currentTitles = new Set(currentFindings.map((f) => f.title.toLowerCase()));
  const newFindings = currentFindings.filter((f) => !priorTitles.has(f.title.toLowerCase()));
  const closedFindings = priorFindings.filter((f) => f.status === 'closed' || !currentTitles.has(f.title.toLowerCase()));
  const unresolvedFindings = currentFindings.filter((f) => priorTitles.has(f.title.toLowerCase()) && f.status !== 'closed');
  const repeatedTitles = [...currentTitles].filter((t) => priorTitles.has(t));
  return {
    priorId: prior.id,
    priorName: prior.name,
    newFindings,
    closedFindings,
    unresolvedFindings,
    repeatedTitles,
  };
}

function assetName(project: DdProject, assetId: string): string {
  return project.assets.find((a) => a.id === assetId)?.name ?? assetId;
}

function targetLabel(project: DdProject, assessment: DdAssessment): string {
  if (assessment.targetType === 'project') return 'Whole project';
  return assessment.targetAssetIds.map((idValue) => assetName(project, idValue)).join(', ') || 'Selected assets';
}

function buildReportBody(project: DdProject, kind: GenerateReportInput['kind'], assessmentIds: string[]): ReportBody {
  const assessments = assessmentIds.length
    ? project.assessments.filter((a) => assessmentIds.includes(a.id))
    : project.assessments;
  const findings = assessments.length
    ? project.findings.filter((f) => f.assessmentIds.some((idValue) => assessments.some((a) => a.id === idValue)))
    : project.findings;
  const risks = assessments.length
    ? project.risks.filter((r) => r.assessmentIds.some((idValue) => assessments.some((a) => a.id === idValue)))
    : project.risks;
  const openFindings = findings.filter((f) => f.status === 'open' || f.status === 'under_review' || f.status === 'accepted');
  const critical = openFindings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  const missing = project.evidence.filter((e) => {
    if (!['expected', 'requested', 'missing'].includes(e.status)) return false;
    if (!assessments.length) return true;
    return e.assessmentIds.some((idValue) => assessments.some((a) => a.id === idValue));
  });
  const openActions = project.actions.filter((a) => a.status !== 'closed');
  const sections: ReportSection[] = [];

  if (kind === 'red_flag') {
    sections.push({
      heading: 'Red flags',
      paragraphs: critical.length
        ? critical.map((f) => `${f.severity.toUpperCase()} · ${f.title} — ${f.description}`)
        : ['No critical or high open findings on the selected assessments.'],
      recordIds: critical.map((f) => f.id),
    });
    sections.push({
      heading: 'Material risks',
      paragraphs: risks.filter((r) => r.materiality === 'high' || r.materiality === 'critical').map((r) => `${r.title} (${r.category}) — ${r.cause}`),
      recordIds: risks.map((r) => r.id),
    });
    sections.push({
      heading: 'Missing evidence affecting confidence',
      paragraphs: missing.length ? missing.map((e) => e.title) : ['No missing/expected items on the selected assessments.'],
      recordIds: missing.map((e) => e.id),
    });
  } else if (kind === 'evidence_completeness') {
    const stats = evidenceCompleteness(project, assessments[0]?.id);
    sections.push({
      heading: 'Evidence status',
      paragraphs: [
        `${stats.expected} items on the register.`,
        `${stats.received} received, ${stats.validated} validated, ${stats.used} relied upon, ${stats.missing} still expected/requested/missing.`,
        `Completeness ${stats.percent}%. Evidence considered is distinct from evidence used.`,
      ],
    });
    sections.push({
      heading: 'Gaps',
      paragraphs: missing.map((e) => `${e.title} — ${e.status}`),
      recordIds: missing.map((e) => e.id),
    });
  } else if (kind === 'open_risk_action') {
    sections.push({
      heading: 'Open risks',
      paragraphs: risks.filter((r) => r.status !== 'closed').map((r) => `${r.title} · ${r.status} · owner ${r.owner ?? 'unassigned'}`),
    });
    sections.push({
      heading: 'Open actions',
      paragraphs: openActions.map((a) => `${a.title} · ${a.status} · ${a.owner}${a.dueDate ? ` · due ${a.dueDate}` : ''}`),
    });
  } else if (kind === 'changes_since_previous') {
    const primary = assessments[0];
    const diff = primary ? changesSincePrevious(project, primary.id) : null;
    if (!diff) {
      sections.push({
        heading: 'Changes since previous DD',
        paragraphs: ['This assessment has no linked prior DD. Set a prior assessment to enable the comparison.'],
      });
    } else {
      sections.push({
        heading: `Compared with ${diff.priorName}`,
        paragraphs: [
          `${diff.newFindings.length} new findings.`,
          `${diff.closedFindings.length} prior items closed or not repeated.`,
          `${diff.unresolvedFindings.length} unresolved carry-forwards.`,
          `${diff.repeatedTitles.length} titles seen in both assessments.`,
        ],
      });
      sections.push({
        heading: 'New findings',
        paragraphs: diff.newFindings.map((f) => f.title),
        recordIds: diff.newFindings.map((f) => f.id),
      });
      sections.push({
        heading: 'Unresolved from prior DD',
        paragraphs: diff.unresolvedFindings.map((f) => `${f.title} (${f.status})`),
        recordIds: diff.unresolvedFindings.map((f) => f.id),
      });
    }
  } else if (kind === 'indicative_valuation') {
    const valScope = assessments.flatMap((a) => a.scopes).find((s) => s.scopeKey === 'indicative_valuation');
    const valChecks = valScope?.checks ?? [];
    sections.push({
      heading: 'Indicative valuation — decision support only',
      paragraphs: [
        'This is an indicative, IBBI-structured decision-support record. It is not a certified valuation and must not be relied upon as one unless a registered valuer signs a separate professional report.',
        `Purpose / instruction: ${valChecks.find((c) => c.definitionId.endsWith('.instruction'))?.comments || 'Not yet completed.'}`,
        `Subject: ${project.name}, ${project.location}. Stage: ${LIFECYCLE_STAGE_LABEL[project.currentStage]}.`,
      ],
    });
    sections.push({
      heading: 'Evidence relied upon versus considered',
      paragraphs: [
        `Relied upon (used): ${project.evidence.filter((e) => e.used).length}.`,
        `Considered but not used: ${project.evidence.filter((e) => e.considered && !e.used).length}.`,
        `Missing / expected: ${missing.length}. Gaps reduce confidence and must be shown, not implied as nil.`,
      ],
    });
    sections.push({
      heading: 'Method and caveats',
      paragraphs: valChecks.map((c) => `${c.title}: ${c.result}${c.comments ? ` — ${c.comments}` : ''}`),
    });
  } else if (kind === 'handover_readiness') {
    sections.push({
      heading: 'Handover readiness',
      paragraphs: [
        `${openFindings.length} open findings remain.`,
        `${project.actions.filter((a) => a.status !== 'closed').length} open actions.`,
        `${missing.length} evidence gaps.`,
      ],
    });
    sections.push({
      heading: 'Open findings blocking handover',
      paragraphs: openFindings.map((f) => `${f.severity} · ${f.title}`),
      recordIds: openFindings.map((f) => f.id),
    });
  } else {
    // executive / detailed
    sections.push({
      heading: 'Project',
      paragraphs: [
        `${project.name} (${project.reference}) — ${project.city}.`,
        `Stage: ${LIFECYCLE_STAGE_LABEL[project.currentStage]}. Health: ${project.health}.`,
        assessments.length
          ? `Assessments included: ${assessments.map((a) => `${a.name} · ${targetLabel(project, a)}`).join('; ')}.`
          : 'All project assessments included.',
      ],
    });
    sections.push({
      heading: 'Key findings',
      paragraphs: (kind === 'detailed_dd' ? openFindings : critical.length ? critical : openFindings.slice(0, 8)).map(
        (f) => `${f.severity.toUpperCase()} · ${SCOPE_LABEL[f.discipline]} · ${f.title} — ${f.description}`,
      ),
      recordIds: openFindings.map((f) => f.id),
    });
    sections.push({
      heading: 'Risks',
      paragraphs: risks.filter((r) => r.status !== 'closed').map((r) => `${r.title} (${r.category}, ${r.materiality}) — ${r.cause}`),
      recordIds: risks.map((r) => r.id),
    });
    sections.push({
      heading: 'Actions',
      paragraphs: openActions.map((a) => `${a.title} · ${a.owner} · ${a.status}`),
    });
    sections.push({
      heading: 'Evidence gaps',
      paragraphs: missing.slice(0, 20).map((e) => e.title),
    });
    if (kind === 'detailed_dd') {
      for (const assessment of assessments) {
        for (const scope of assessment.scopes) {
          const c = scopeCompleteness(scope);
          sections.push({
            heading: `${assessment.name} · ${SCOPE_LABEL[scope.scopeKey]}`,
            paragraphs: [
              `Completion ${c.percent}% (${c.done}/${c.total} checks). ${c.findings} findings from checks. ${c.missing} missing-evidence results.`,
              ...scope.checks
                .filter((ch) => ch.result !== 'pending' && ch.result !== 'compliant' && ch.result !== 'not_applicable')
                .map((ch) => `${ch.title}: ${ch.result}${ch.comments ? ` — ${ch.comments}` : ''}`),
            ],
          });
        }
      }
    }
  }

  const summary =
    kind === 'red_flag'
      ? `${critical.length} high/critical findings, ${missing.length} evidence gaps on ${assessments.length || 'all'} assessment(s).`
      : `${project.name}: ${openFindings.length} open findings, ${risks.filter((r) => r.status !== 'closed').length} open risks, ${missing.length} evidence gaps. Generated from live registers — not a separate silo.`;

  return { summary, sections };
}

export function generateReport(project: DdProject, input: GenerateReportInput, actor = DEFAULT_ACTOR): GeneratedReport {
  const at = nowIso();
  const assessmentIds = input.assessmentIds ?? [];
  const body = buildReportBody(project, input.kind, assessmentIds);
  const report: GeneratedReport = {
    id: id('rpt'),
    kind: input.kind,
    title: `${REPORT_KIND_LABEL[input.kind]} — ${project.name}`,
    status: 'generated',
    assessmentIds,
    scopeInstanceIds: [],
    body,
    generatedAt: at,
    generatedBy: input.generatedBy || actor,
  };
  project.reports.push(report);
  touch(project, at);
  audit(project, { actor, action: 'generate_report', entityType: 'report', entityId: report.id, newValue: report.kind, at });
  return report;
}

export function assetTree(project: DdProject): Array<Asset & { depth: number; path: string }> {
  const byParent = new Map<string | undefined, Asset[]>();
  for (const asset of project.assets) {
    const key = asset.parentId;
    const list = byParent.get(key) ?? [];
    list.push(asset);
    byParent.set(key, list);
  }
  const out: Array<Asset & { depth: number; path: string }> = [];
  function walk(parentId: string | undefined, depth: number, prefix: string) {
    for (const asset of byParent.get(parentId) ?? []) {
      const path = prefix ? `${prefix} / ${asset.name}` : asset.name;
      out.push({ ...asset, depth, path });
      walk(asset.id, depth + 1, path);
    }
  }
  walk(undefined, 0, '');
  return out;
}

export function recommendedDdTypes(stage: LifecycleStage) {
  return DD_TYPE_DEFINITIONS.filter((d) => d.typicalStages.includes(stage));
}

export const OPERATING_MODEL_LIBRARIES = {
  scopes: SCOPE_DEFINITIONS,
  ddTypes: DD_TYPE_DEFINITIONS,
  checks: CHECK_DEFINITIONS,
};
