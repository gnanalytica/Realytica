import { z } from 'zod';
import {
  ACTION_KIND_LABEL,
  ACTION_STATUS_LABEL,
  ASSESSMENT_STATUS_LABEL,
  CHECK_RESULT_LABEL,
  DD_TYPE_KEYS,
  DECISION_STATUS_LABEL,
  DECISION_TYPE_LABEL,
  EVIDENCE_KIND_LABEL,
  EVIDENCE_STATUS_LABEL,
  FINDING_STATUS_LABEL,
  IMPACT_TYPE_LABEL,
  LIFECYCLE_STAGES,
  PROJECT_ARCHETYPES,
  PROJECT_STATUS_LABEL,
  REPORT_KIND_LABEL,
  RISK_STATUS_LABEL,
  SCOPE_KEYS,
  SEVERITY_LABEL,
  type DdTypeKey,
  type ScopeKey,
} from '@realytica/shared';

const keys = <T extends string>(record: Record<T, unknown> | Array<{ key: T }>): [T, ...T[]] => {
  if (Array.isArray(record)) return record.map((r) => r.key) as [T, ...T[]];
  return Object.keys(record) as [T, ...T[]];
};

export const projectArchetypeSchema = z.enum(keys(PROJECT_ARCHETYPES));
export const lifecycleStageSchema = z.enum(keys(LIFECYCLE_STAGES));
export const ddTypeKeySchema = z.enum(DD_TYPE_KEYS as [DdTypeKey, ...DdTypeKey[]]);
export const scopeKeySchema = z.enum(SCOPE_KEYS as [ScopeKey, ...ScopeKey[]]);
export const checkResultSchema = z.enum(keys(CHECK_RESULT_LABEL));
export const evidenceStatusSchema = z.enum(keys(EVIDENCE_STATUS_LABEL));
export const evidenceKindSchema = z.enum(keys(EVIDENCE_KIND_LABEL));
export const findingStatusSchema = z.enum(keys(FINDING_STATUS_LABEL));
export const severitySchema = z.enum(keys(SEVERITY_LABEL));
export const riskStatusSchema = z.enum(keys(RISK_STATUS_LABEL));
export const impactTypeSchema = z.enum(keys(IMPACT_TYPE_LABEL));
export const actionKindSchema = z.enum(keys(ACTION_KIND_LABEL));
export const actionStatusSchema = z.enum(keys(ACTION_STATUS_LABEL));
export const decisionTypeSchema = z.enum(keys(DECISION_TYPE_LABEL));
export const decisionStatusSchema = z.enum(keys(DECISION_STATUS_LABEL));
export const reportKindSchema = z.enum(keys(REPORT_KIND_LABEL));
export const assessmentStatusSchema = z.enum(keys(ASSESSMENT_STATUS_LABEL));
export const projectStatusSchema = z.enum(keys(PROJECT_STATUS_LABEL));
export const probabilitySchema = z.enum(['rare', 'unlikely', 'possible', 'likely', 'almost_certain']);

export const actorSchema = z.string().trim().min(1).max(120).optional();

export const createProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: projectArchetypeSchema,
  location: z.string().trim().min(1).max(300),
  city: z.string().trim().min(1).max(120),
  currentStage: lifecycleStageSchema.optional(),
  description: z.string().max(4000).optional(),
  jurisdiction: z.string().max(200).optional(),
  siteAddress: z.string().max(400).optional(),
  owner: z.string().max(120).optional(),
  developer: z.string().max(200).optional(),
  landAreaSqm: z.number().nonnegative().optional(),
  builtUpAreaSqm: z.number().nonnegative().optional(),
  saleableAreaSqm: z.number().nonnegative().optional(),
  budget: z.number().nonnegative().optional(),
  currency: z.enum(['INR', 'EUR']).optional(),
  portfolio: z.string().max(200).optional(),
  actor: actorSchema,
});

export const createAssetBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  assetType: z.string().trim().min(1).max(120),
  parentId: z.string().optional(),
  currentStage: lifecycleStageSchema.optional(),
  zone: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  responsible: z.string().max(120).optional(),
  actor: actorSchema,
});

export const changeStageBodySchema = z.object({
  subject: z.enum(['project', 'asset']),
  assetId: z.string().optional(),
  stage: lifecycleStageSchema,
  reason: z.string().trim().min(1).max(1000),
  evidenceIds: z.array(z.string()).optional(),
  actor: actorSchema,
});

export const createAssessmentBodySchema = z.object({
  name: z.string().trim().max(200).optional(),
  ddType: ddTypeKeySchema,
  objective: z.string().max(2000).optional(),
  targetType: z.enum(['project', 'assets']),
  targetAssetIds: z.array(z.string()).optional(),
  owner: z.string().trim().min(1).max(120),
  reviewer: z.string().max(120).optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  extraScopes: z.array(scopeKeySchema).optional(),
  excludeScopes: z.array(scopeKeySchema).optional(),
  priorAssessmentId: z.string().optional(),
  actor: actorSchema,
});

export const recordCheckBodySchema = z.object({
  result: checkResultSchema,
  comments: z.string().max(4000).optional(),
  evidenceIds: z.array(z.string()).optional(),
  owner: z.string().max(120).optional(),
  createFinding: z.boolean().optional(),
  findingTitle: z.string().max(300).optional(),
  findingDescription: z.string().max(4000).optional(),
  findingSeverity: severitySchema.optional(),
  actor: actorSchema,
});

export const createEvidenceBodySchema = z.object({
  title: z.string().trim().min(1).max(300),
  kind: evidenceKindSchema,
  description: z.string().max(4000).optional(),
  source: z.string().max(300).optional(),
  owner: z.string().max(120).optional(),
  status: evidenceStatusSchema.optional(),
  assetIds: z.array(z.string()).optional(),
  assessmentIds: z.array(z.string()).optional(),
  scopeInstanceIds: z.array(z.string()).optional(),
  checkIds: z.array(z.string()).optional(),
  fileName: z.string().max(300).optional(),
  actor: actorSchema,
});

export const patchEvidenceBodySchema = z.object({
  status: evidenceStatusSchema,
  rejectionReason: z.string().max(2000).optional(),
  considered: z.boolean().optional(),
  used: z.boolean().optional(),
  actor: actorSchema,
});

export const createFindingBodySchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(4000),
  severity: severitySchema,
  discipline: scopeKeySchema,
  status: findingStatusSchema.optional(),
  owner: z.string().max(120).optional(),
  sourceAssessmentId: z.string().optional(),
  sourceScopeId: z.string().optional(),
  sourceCheckId: z.string().optional(),
  assetIds: z.array(z.string()).optional(),
  assessmentIds: z.array(z.string()).optional(),
  evidenceIds: z.array(z.string()).optional(),
  linkAssessmentIds: z.array(z.string()).optional(),
  actor: actorSchema,
});

export const createRiskBodySchema = z.object({
  title: z.string().trim().min(1).max(300),
  category: impactTypeSchema,
  cause: z.string().trim().min(1).max(4000),
  impactType: impactTypeSchema,
  probability: probabilitySchema,
  impactScore: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  materiality: severitySchema,
  owner: z.string().max(120).optional(),
  mitigation: z.string().max(4000).optional(),
  findingIds: z.array(z.string()).optional(),
  assetIds: z.array(z.string()).optional(),
  assessmentIds: z.array(z.string()).optional(),
  actor: actorSchema,
});

export const createActionBodySchema = z.object({
  title: z.string().trim().min(1).max(300),
  kind: actionKindSchema,
  owner: z.string().trim().min(1).max(120),
  priority: severitySchema,
  description: z.string().max(4000).optional(),
  dueDate: z.string().optional(),
  findingIds: z.array(z.string()).optional(),
  riskIds: z.array(z.string()).optional(),
  evidenceIds: z.array(z.string()).optional(),
  checkIds: z.array(z.string()).optional(),
  actor: actorSchema,
});

export const createDecisionBodySchema = z.object({
  title: z.string().trim().min(1).max(300),
  decisionType: decisionTypeSchema,
  decisionMaker: z.string().trim().min(1).max(120),
  rationale: z.string().trim().min(1).max(4000),
  status: decisionStatusSchema.optional(),
  alternatives: z.string().max(4000).optional(),
  conditions: z.string().max(4000).optional(),
  findingIds: z.array(z.string()).optional(),
  riskIds: z.array(z.string()).optional(),
  actionIds: z.array(z.string()).optional(),
  evidenceIds: z.array(z.string()).optional(),
  assessmentIds: z.array(z.string()).optional(),
  actor: actorSchema,
});

export const generateReportBodySchema = z.object({
  kind: reportKindSchema,
  assessmentIds: z.array(z.string()).optional(),
  generatedBy: z.string().trim().min(1).max(120).optional(),
  actor: actorSchema,
});

/**
 * What a bound block may ask the registers for.
 *
 * Validated at the boundary rather than trusted, because retuning a block is
 * the one report operation that arrives as free-form structure — and a source
 * kind that is not in the closed set must be refused here rather than
 * discovered by the resolver's switch falling through.
 */
export const reportBoundSourceSchema = z.object({
  kind: z.enum([
    'particulars',
    'title_chain',
    'findings',
    'risks',
    'actions',
    'decisions',
    'evidence_gaps',
    'dd_progress',
    'checks',
    'valuation',
    'changes_since_previous',
  ]),
  assessmentIds: z.array(z.string()).optional(),
  materialOnly: z.boolean().optional(),
  openOnly: z.boolean().optional(),
  discipline: scopeKeySchema.optional(),
});

export const insertReportBlockBodySchema = z.object({
  heading: z.string().trim().max(160).optional(),
  text: z.string().max(20000).optional(),
  source: reportBoundSourceSchema.optional(),
  afterBlockId: z.string().optional(),
  actor: actorSchema,
});

export const editReportBlockBodySchema = z.object({
  heading: z.string().trim().max(160).optional(),
  /** Refused by the operation when the block reads the registers. */
  text: z.string().max(20000).optional(),
  actor: actorSchema,
});

export const retuneReportBlockBodySchema = z.object({
  source: reportBoundSourceSchema,
  actor: actorSchema,
});

export const moveReportBlockBodySchema = z.object({
  toIndex: z.number().int().min(0).max(500),
  actor: actorSchema,
});

export const recordCheckFieldsBodySchema = z.object({
  /**
   * Values keyed by field. Loosely typed here on purpose — the coercion and
   * the per-field reason live in the operating model, next to the schema that
   * knows what each field is, rather than being restated at the boundary.
   */
  values: z.record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      // Multi-select and table rows. Shapes are checked against the field
      // schema in the operating model, not restated here — the boundary only
      // has to admit them.
      z.array(z.string()),
      z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
    ]),
  ),
  sourceEvidenceId: z.string().optional(),
  actor: actorSchema,
});

export const patchProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  location: z.string().trim().min(1).max(300).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  jurisdiction: z.string().max(200).optional(),
  siteAddress: z.string().max(400).optional(),
  owner: z.string().max(120).optional(),
  developer: z.string().max(200).optional(),
  landAreaSqm: z.number().nonnegative().optional(),
  builtUpAreaSqm: z.number().nonnegative().optional(),
  saleableAreaSqm: z.number().nonnegative().optional(),
  budget: z.number().nonnegative().optional(),
  portfolio: z.string().max(200).optional(),
  status: projectStatusSchema.optional(),
  actor: actorSchema,
});

export const valuationSignOffSchema = z.enum(['unsigned', 'internal_review', 'registered_valuer_required']);

export const patchValuationBodySchema = z.object({
  signOff: valuationSignOffSchema,
  actor: actorSchema,
});

export const reviewDraftBodySchema = z.object({
  status: z.enum(['in_review', 'accepted', 'rejected']),
  reviewNote: z.string().max(4000).optional(),
  actor: actorSchema,
});

export const proposeDraftsBodySchema = z.object({
  actor: actorSchema,
});

export const patchStatusBodySchema = z.object({
  status: z.string().min(1),
  actor: actorSchema,
});

export const projectChatBodySchema = z.object({
  question: z.string().trim().min(1).max(4000),
  viewContext: z.string().max(400).optional(),
  actor: actorSchema,
  sitting: z
    .object({
      ddId: z.string().optional(),
      scopeId: z.string().optional(),
      checkId: z.string().optional(),
    })
    .optional(),
});

export const projectChatProposalBodySchema = z.object({
  actor: actorSchema,
});

export const projectOrchestrateBodySchema = z.object({
  actor: actorSchema,
});

export const linkFindingBodySchema = z.object({
  assessmentIds: z.array(z.string()).optional(),
  assetIds: z.array(z.string()).optional(),
  evidenceIds: z.array(z.string()).optional(),
  actor: actorSchema,
});
