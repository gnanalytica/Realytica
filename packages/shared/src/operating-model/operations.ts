import { CHECK_DEFINITIONS, DD_TYPE_DEFINITIONS, SCOPE_DEFINITIONS, checksForScope, ddTypeDefinition } from './libraries';
import { LIFECYCLE_STAGE_LABEL, REPORT_KIND_LABEL, SCOPE_LABEL } from './catalogs';
import { readCheckFields, toleranceReadings, validateFieldValue, withComputed, type CheckFieldReading, type ToleranceReading } from './check-fields';
import { isReportBoundSource, reportIsFrozen, reportSummaryLine, reportTemplate, resolveReportBlock, REPORT_SOURCE_LABEL } from './report-blocks';
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
  CheckFieldDef,
  CheckFieldValue,
  CheckInsightRule,
  ReportBlock,
  ReportBody,
  ReportBoundSource,
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
  // A report written before the block model existed is migrated on read, so
  // nothing downstream has to know two shapes.
  for (const report of project.reports) ensureReportBlocks(report);
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
    ...(def.fields?.length ? { fields: {} } : {}),
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

/**
 * The definition behind an instantiated check, for its field schema.
 *
 * A check instance copies its title and criteria at instantiation so it is
 * stable if the library moves, but the SCHEMA is deliberately read live: a
 * field added to a definition should appear on the checks already running,
 * because it is a question that was always worth answering and nobody wants
 * to re-instantiate a DD to be asked it.
 */
export function checkSchema(check: CheckInstance): { fields: CheckFieldDef[]; rules: CheckInsightRule[] } {
  const def = CHECK_DEFINITIONS.find((d) => d.id === check.definitionId);
  return { fields: def?.fields ?? [], rules: def?.insightRules ?? [] };
}

/** Everything this check's fields say — schema, values, what is missing, and the arithmetic. */
export function checkFieldReading(check: CheckInstance): CheckFieldReading {
  const { fields, rules } = checkSchema(check);
  return readCheckFields(check, fields, rules);
}

export interface ProjectToleranceRow extends ToleranceReading {
  checkId: string;
  checkTitle: string;
  scopeKey: ScopeKey;
  assessmentId: string;
  assessmentName: string;
}

/**
 * Every comparison on the file, normalised so they can be read against each
 * other.
 *
 * Worst first, where "worst" is how many times past its OWN tolerance a
 * divergence fell — not the raw percentage. A 3% budget variance inside a 5%
 * threshold and a 3% extent variance against a 1% one are not comparable
 * facts, and ranking them by percentage would put the harmless one above the
 * finding.
 *
 * Breaches — a divergence against a zero tolerance, like an FAR above what
 * the plan permits — sort to the very top and stay there. There is no
 * "slightly over" on a threshold that admits nothing.
 */
export function projectTolerances(project: DdProject): ProjectToleranceRow[] {
  ensureProjectShape(project);
  const rows: ProjectToleranceRow[] = [];
  for (const assessment of project.assessments) {
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) {
        const { fields, rules } = checkSchema(check);
        if (!fields.length || !rules.length) continue;
        for (const reading of toleranceReadings(fields, withComputed(fields, check.fields ?? {}), rules)) {
          rows.push({
            ...reading,
            checkId: check.id,
            checkTitle: check.title,
            scopeKey: scope.scopeKey,
            assessmentId: assessment.id,
            assessmentName: assessment.name,
          });
        }
      }
    }
  }
  return rows.sort((a, b) => b.overBy - a.overBy || b.divergence - a.divergence);
}

export interface RecordCheckFieldsResult {
  check: CheckInstance;
  /** Values that would not coerce, with the reason. Nothing partial is written. */
  rejected: { key: string; error: string }[];
  reading: CheckFieldReading;
}

/**
 * Write values onto a check.
 *
 * All or nothing on validation: a half-written field set is worse than a
 * refused one, because the person walks away believing the numbers are in.
 * An unknown key is rejected by name rather than ignored — a model that
 * invented a field should be told, not silently humoured.
 *
 * Writing a value NEVER records a result. What the numbers mean is the
 * check's insight rules; whether the check passes is somebody's judgement,
 * and conflating the two is how an automated tolerance ends up signing off a
 * title.
 */
export function recordCheckFields(
  project: DdProject,
  checkId: string,
  values: Record<string, unknown>,
  actor = DEFAULT_ACTOR,
  sourceEvidenceId?: string,
): RecordCheckFieldsResult {
  const { check } = findCheck(project, checkId);
  const { fields } = checkSchema(check);
  if (!fields.length) throw new Error(`“${check.title}” does not record typed fields — use the result and comments.`);

  const at = nowIso();
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const rejected: { key: string; error: string }[] = [];
  const accepted: Record<string, CheckFieldValue> = {};

  for (const [key, raw] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) {
      rejected.push({ key, error: `“${check.title}” has no field called "${key}". It records: ${fields.map((f) => f.key).join(', ')}.` });
      continue;
    }
    const parsed = validateFieldValue(def, raw);
    if ('error' in parsed) {
      rejected.push({ key, error: parsed.error });
      continue;
    }
    // A field declared `proof: 'required'` cannot be recorded on somebody's
    // word. This is the line between a diligence record and a form: the
    // extent a deed recites and the extent somebody remembered must not be
    // able to reach a report wearing the same authority.
    if (def.proof === 'required' && parsed.value !== null && !sourceEvidenceId) {
      rejected.push({
        key,
        error: `${def.label} has to cite what it was read from${def.from ? ` — the ${def.from.toLowerCase()}` : ''}. File it on the evidence register first, then record the value against it.`,
      });
      continue;
    }
    accepted[key] = { value: parsed.value, at, by: actor, ...(sourceEvidenceId ? { sourceEvidenceId } : {}) };
  }

  if (rejected.length === 0) {
    check.fields = { ...(check.fields ?? {}), ...accepted };
    check.updatedAt = at;
    touch(project, at);
    audit(project, {
      actor,
      action: 'record_check_fields',
      entityType: 'check',
      entityId: check.id,
      newValue: Object.keys(accepted).join(', '),
      at,
    });
  }

  return { check, rejected, reading: checkFieldReading(check) };
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

/**
 * A new report opens as a document of blocks, not a frozen page of text.
 *
 * Most of them are bound: they read the registers on every render, so the
 * report is level with the file the moment the file moves. The rest are empty
 * prose blocks — the opinion, the recommendation — waiting for the one thing
 * no amount of regeneration can produce.
 *
 * The assessment scope the caller asked for is pushed down onto every bound
 * block rather than applied once here. That is what lets a person widen one
 * section back out to the whole file without regenerating the document and
 * losing what they wrote.
 */
export function generateReport(project: DdProject, input: GenerateReportInput, actor = DEFAULT_ACTOR): GeneratedReport {
  const at = nowIso();
  const assessmentIds = input.assessmentIds ?? [];
  const blocks: ReportBlock[] = reportTemplate(input.kind).map((row) => ({
    id: id('rbk'),
    heading: row.heading,
    origin: row.source ? 'derived' : 'authored',
    ...(row.source ? { source: assessmentIds.length ? { ...row.source, assessmentIds } : row.source } : {}),
    ...(row.source ? {} : { text: row.text ?? '' }),
  }));
  const body: ReportBody = { summary: reportSummaryLine(project), blocks };
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

/* ==================================================================== */
/* Editing a report                                                      */
/* ==================================================================== */

/**
 * Every edit goes through here, and every one of them is refused on a frozen
 * report.
 *
 * An issued report went to somebody. Letting it be edited afterwards — even
 * with the best intentions — means the document a bank holds and the document
 * this system shows have quietly diverged, with nothing recording that they
 * did. Reissue instead: `superseded` says plainly that a later version exists.
 */
function editableReport(project: DdProject, reportId: string): GeneratedReport {
  const report = project.reports.find((r) => r.id === reportId);
  if (!report) throw new Error(`No report "${reportId}" on this project.`);
  if (reportIsFrozen(report.status)) {
    throw new Error(
      `This report is ${report.status} and can no longer be edited. Generate a new one — the issued version stays exactly as it was read.`,
    );
  }
  ensureReportBlocks(report);
  return report;
}

function blockIn(report: GeneratedReport, blockId: string): ReportBlock {
  const block = report.body.blocks.find((b) => b.id === blockId);
  if (!block) throw new Error(`No block "${blockId}" in this report.`);
  return block;
}

function stamp(report: GeneratedReport, block: ReportBlock, actor: string, at: string): void {
  block.editedAt = at;
  block.editedBy = actor;
  report.body.summary = '';
}

/** Add a block. Prose by default; pass a source to bind one to the registers. */
export function insertReportBlock(
  project: DdProject,
  reportId: string,
  input: { heading?: string; text?: string; source?: ReportBoundSource; afterBlockId?: string },
  actor = DEFAULT_ACTOR,
): ReportBlock {
  const at = nowIso();
  const report = editableReport(project, reportId);
  if (input.source && !isReportBoundSource(input.source.kind)) {
    throw new Error(`"${input.source.kind}" is not something a report block can read.`);
  }
  const block: ReportBlock = {
    id: id('rbk'),
    heading: input.heading,
    origin: input.source ? 'derived' : 'authored',
    ...(input.source ? { source: input.source } : { text: input.text ?? '' }),
    editedAt: at,
    editedBy: actor,
  };
  const at_index = input.afterBlockId ? report.body.blocks.findIndex((b) => b.id === input.afterBlockId) : -1;
  if (at_index >= 0) report.body.blocks.splice(at_index + 1, 0, block);
  else report.body.blocks.push(block);
  touch(project, at);
  audit(project, { actor, action: 'insert_report_block', entityType: 'report', entityId: reportId, newValue: input.heading ?? input.source?.kind ?? 'prose', at });
  return block;
}

/**
 * Write into a block.
 *
 * A bound block refuses the text outright rather than accepting it and
 * quietly ceasing to be live. Somebody who wants to say it differently wants
 * `detachReportBlock`, and making them ask for that by name is the point: it
 * is the moment a live reading becomes a person's words, and it should be a
 * decision rather than a side effect of typing.
 */
export function editReportBlock(
  project: DdProject,
  reportId: string,
  blockId: string,
  input: { heading?: string; text?: string },
  actor = DEFAULT_ACTOR,
): ReportBlock {
  const at = nowIso();
  const report = editableReport(project, reportId);
  const block = blockIn(report, blockId);
  if (input.heading !== undefined) block.heading = input.heading;
  if (input.text !== undefined) {
    if (block.origin === 'derived') {
      throw new Error(
        `“${block.heading ?? REPORT_SOURCE_LABEL[block.source!.kind]}” reads the registers, so its text is not yours to write. `
          + 'Detach it first if you need to say this differently — the report will then show that the paragraph stopped updating.',
      );
    }
    block.text = input.text;
  }
  stamp(report, block, actor, at);
  touch(project, at);
  audit(project, { actor, action: 'edit_report_block', entityType: 'report', entityId: reportId, newValue: blockId, at });
  return block;
}

/** Change what a bound block asks the registers for. Never its words. */
export function retuneReportBlock(
  project: DdProject,
  reportId: string,
  blockId: string,
  source: ReportBoundSource,
  actor = DEFAULT_ACTOR,
): ReportBlock {
  const at = nowIso();
  const report = editableReport(project, reportId);
  const block = blockIn(report, blockId);
  if (block.origin !== 'derived') throw new Error('That block holds somebody’s words, not a register reading — there is nothing to retune.');
  if (!isReportBoundSource(source.kind)) throw new Error(`"${source.kind}" is not something a report block can read.`);
  block.source = source;
  stamp(report, block, actor, at);
  touch(project, at);
  audit(project, { actor, action: 'retune_report_block', entityType: 'report', entityId: reportId, newValue: source.kind, at });
  return block;
}

/**
 * Turn a live block into prose, keeping what it currently says.
 *
 * The record of where it came from stays on the block. A reader looking at a
 * paragraph that reads like a register summary is entitled to know it stopped
 * being one on a particular day — that is the whole difference between an
 * honest edit and a document that has drifted without telling anyone.
 */
export function detachReportBlock(project: DdProject, reportId: string, blockId: string, actor = DEFAULT_ACTOR): ReportBlock {
  const at = nowIso();
  const report = editableReport(project, reportId);
  const block = blockIn(report, blockId);
  if (block.origin !== 'derived') return block;
  const resolved = resolveReportBlock(project, block);
  block.detachedFrom = block.source?.kind;
  block.detachedAt = at;
  block.origin = 'authored';
  block.text = resolved.lines.join('\n');
  delete block.source;
  stamp(report, block, actor, at);
  touch(project, at);
  audit(project, { actor, action: 'detach_report_block', entityType: 'report', entityId: reportId, newValue: block.detachedFrom ?? blockId, at });
  return block;
}

/**
 * Put a detached block back on the registers.
 *
 * Discards the edited text, which is why it is a separate verb rather than a
 * toggle: somebody has to mean it.
 */
export function reattachReportBlock(project: DdProject, reportId: string, blockId: string, actor = DEFAULT_ACTOR): ReportBlock {
  const at = nowIso();
  const report = editableReport(project, reportId);
  const block = blockIn(report, blockId);
  if (!block.detachedFrom) throw new Error('That block was written from scratch, so there is no reading to go back to.');
  block.origin = 'derived';
  block.source = { kind: block.detachedFrom };
  delete block.text;
  delete block.detachedAt;
  delete block.detachedFrom;
  stamp(report, block, actor, at);
  touch(project, at);
  audit(project, { actor, action: 'reattach_report_block', entityType: 'report', entityId: reportId, newValue: blockId, at });
  return block;
}

export function removeReportBlock(project: DdProject, reportId: string, blockId: string, actor = DEFAULT_ACTOR): void {
  const at = nowIso();
  const report = editableReport(project, reportId);
  const index = report.body.blocks.findIndex((b) => b.id === blockId);
  if (index < 0) throw new Error(`No block "${blockId}" in this report.`);
  report.body.blocks.splice(index, 1);
  touch(project, at);
  audit(project, { actor, action: 'remove_report_block', entityType: 'report', entityId: reportId, newValue: blockId, at });
}

export function moveReportBlock(project: DdProject, reportId: string, blockId: string, toIndex: number, actor = DEFAULT_ACTOR): void {
  const at = nowIso();
  const report = editableReport(project, reportId);
  const from = report.body.blocks.findIndex((b) => b.id === blockId);
  if (from < 0) throw new Error(`No block "${blockId}" in this report.`);
  const [block] = report.body.blocks.splice(from, 1);
  const target = Math.max(0, Math.min(report.body.blocks.length, toIndex));
  report.body.blocks.splice(target, 0, block!);
  touch(project, at);
  audit(project, { actor, action: 'move_report_block', entityType: 'report', entityId: reportId, newValue: `${from}→${target}`, at });
}

/**
 * Issue the report: snapshot every live block and stop the document moving.
 *
 * This is the moment the report becomes a thing somebody else holds. From
 * here the registers may say whatever they like and this document will keep
 * saying what it said — and `reportDrift` will show, on demand, exactly how
 * far the two have travelled apart. A report that silently kept updating
 * after it was sent would be the more dangerous of the two failures, because
 * nobody would know to look.
 */
export function issueReport(project: DdProject, reportId: string, actor = DEFAULT_ACTOR): GeneratedReport {
  const at = nowIso();
  const report = editableReport(project, reportId);
  for (const block of report.body.blocks) {
    if (block.origin !== 'derived' || !block.source) continue;
    const resolved = resolveReportBlock(project, block);
    block.frozen = resolved.lines;
    block.frozenRecordIds = resolved.recordIds;
  }
  report.body.summary = reportSummaryLine(project);
  report.status = 'issued';
  report.reviewer = actor;
  touch(project, at);
  audit(project, { actor, action: 'issue_report', entityType: 'report', entityId: reportId, newValue: 'issued', at });
  return report;
}

/**
 * Bring a report generated before blocks existed into the block shape.
 *
 * Every migrated section becomes AUTHORED, not bound. That is deliberate and
 * it is the conservative reading: the old body was a frozen snapshot, so its
 * words are what the report said, and guessing which register each section
 * used to read would risk a paragraph silently changing under a report
 * somebody already sent. They arrive as prose, and a person can rebind one
 * deliberately if they want it live.
 */
export function ensureReportBlocks(report: GeneratedReport): void {
  if (Array.isArray(report.body.blocks)) return;
  const sections = report.body.sections ?? [];
  report.body.blocks = sections.map((section) => ({
    id: id('rbk'),
    heading: section.heading,
    origin: 'authored' as const,
    text: section.paragraphs.join('\n'),
  }));
  delete report.body.sections;
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
