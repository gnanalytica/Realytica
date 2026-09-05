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

/* The standards' own vocabulary, at the door. */

const iso19650RefSchema = z.object({
  originator: z.string().trim().max(12).optional(),
  volume: z.string().trim().max(12).optional(),
  level: z.string().trim().max(12).optional(),
  type: z.string().trim().max(12).optional(),
  role: z.string().trim().max(12).optional(),
  number: z.string().trim().max(12).optional(),
});

const ricsEscalationSchema = z.object({
  immediateAction: z.boolean(),
  notifiedTo: z.string().trim().max(200).optional(),
  notifiedAt: z.string().max(40).optional(),
});

const remedialBandSchema = z.enum(['immediate', 'year_1', 'years_1_5', 'years_5_10']);

export const createAssetBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  assetType: z.string().trim().min(1).max(120),
  // Free text on purpose. The suggestions come from a working subset of the
  // Uniclass Entities table; the table itself is thousands of rows and is
  // maintained at source, so refusing a code this build has not heard of
  // would make the field wrong every time NBS publishes.
  uniclassCode: z.string().trim().max(40).optional(),
  uniclassTitle: z.string().trim().max(200).optional(),
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
  iso19650: iso19650RefSchema.optional(),
  actor: actorSchema,
});

/** One status onto many rows, so a batch is one event rather than twenty. */
export const bulkEvidenceStatusBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  status: evidenceStatusSchema,
  actor: z.string().optional(),
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
  escalation: ricsEscalationSchema.optional(),
  environmentalCondition: z.enum(['rec', 'hrec', 'crec']).optional(),
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
  costEstimate: z.number().nonnegative().optional(),
  costBand: remedialBandSchema.optional(),
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

/**
 * A remedial cost, set after the action was raised.
 *
 * `null` clears rather than being rejected: a figure entered in error has to
 * be removable, and an omitted key must not read as "clear this", which is why
 * the two are distinguished instead of both meaning absent.
 */
export const setActionCostBodySchema = z.object({
  costEstimate: z.number().nonnegative().nullable().optional(),
  costBand: remedialBandSchema.nullable().optional(),
  actor: actorSchema,
});

export const classifyFindingBodySchema = z.object({
  escalation: ricsEscalationSchema.nullable().optional(),
  environmentalCondition: z.enum(['rec', 'hrec', 'crec']).nullable().optional(),
  actor: actorSchema,
});

/* --- Capture, visits and sheets ------------------------------------- */

const capturePurposeSchema = z.enum([
  'pre_construction',
  'survey',
  'diligence_inspection',
  'valuation_inspection',
  'progress',
  'defect',
  'handover',
  'record',
]);

const visitLimitationSchema = z.object({
  kind: z.enum(['no_access', 'occupied', 'weather', 'concealed', 'height', 'services_off', 'time', 'other']),
  what: z.string().trim().min(1).max(400),
});

export const createSiteVisitBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  purpose: capturePurposeSchema,
  visitedOn: z.string().trim().min(1).max(40),
  surveyor: z.string().trim().min(1).max(120),
  status: z.enum(['planned', 'completed', 'aborted']).optional(),
  accompaniedBy: z.string().max(200).optional(),
  weather: z.string().max(200).optional(),
  notes: z.string().max(4000).optional(),
  limitations: z.array(visitLimitationSchema).max(40).optional(),
  assetIds: z.array(z.string()).optional(),
  assessmentIds: z.array(z.string()).optional(),
  actor: actorSchema,
});

export const patchSiteVisitBodySchema = createSiteVisitBodySchema.partial().extend({ actor: actorSchema });

/**
 * `null` clears, an omitted key leaves alone.
 *
 * The distinction matters more here than anywhere else on this file: a photo
 * whose geotag was wrong has to be clearable, and "I did not mention the
 * coordinates" must never read as "remove them".
 */
export const setCaptureBodySchema = z.object({
  purpose: capturePurposeSchema.optional(),
  takenAt: z.string().max(40).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  assetId: z.string().optional(),
  visitId: z.string().optional(),
  zone: z.string().max(120).optional(),
  caption: z.string().max(400).optional(),
  actor: actorSchema,
});

export const createSheetBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['master_plan', 'zoning', 'site_plan', 'layout_plan', 'survey_sketch', 'other']),
  evidenceId: z.string().trim().min(1),
  attachmentId: z.string().optional(),
  asOf: z.string().max(40).optional(),
  issuer: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  actor: actorSchema,
});

/**
 * Control points arrive as a complete set, never one at a time.
 *
 * The transform is derived from all of them, so adding one moves the sheet;
 * a caller placing three would otherwise watch it jump twice on the way. 40 is
 * far past useful — a north-up fit stops improving after a handful — and is
 * there to bound the request, not to express a view.
 */
export const setControlPointsBodySchema = z.object({
  points: z
    .array(
      z.object({
        u: z.number().min(0).max(1),
        v: z.number().min(0).max(1),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        label: z.string().max(200).optional(),
      }),
    )
    .max(40),
  actor: actorSchema,
});

/**
 * Who is signing, and what they hold.
 *
 * `declaredConflict` is required, not optional. An absent disclosure and a nil
 * disclosure are different facts and the API must not let them arrive looking
 * the same.
 */
export const setValuerBodySchema = z.object({
  valuer: z.object({
    name: z.string().trim().min(1).max(200),
    registrationNumber: z.string().trim().max(60).optional(),
    registeredFor: z.string().trim().max(120).optional(),
    firm: z.string().trim().max(200).optional(),
    otherExperts: z
      .array(z.object({ name: z.string().trim().min(1).max(200), contribution: z.string().trim().min(1).max(400) }))
      .max(10)
      .optional(),
  }),
  declaredConflict: z.boolean(),
  interests: z.array(z.string().trim().min(1).max(400)).max(20).optional(),
  appointedOn: z.string().max(40).optional(),
  actor: actorSchema,
});

export const assignBodySchema = z.object({
  targetId: z.string().trim().min(1),
  /** Empty clears the assignment, which is a real act and not a mistake. */
  owner: z.string().trim().max(120),
  actor: actorSchema,
});

export const patchStatusBodySchema = z.object({
  status: z.string().min(1),
  actor: actorSchema,
});

export const projectChatBodySchema = z.object({
  question: z.string().trim().min(1).max(4000),
  viewContext: z.string().max(400).optional(),
  /** Which sitting this belongs to. Absent means a client that predates sessions. */
  sessionId: z.string().max(120).optional(),
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
