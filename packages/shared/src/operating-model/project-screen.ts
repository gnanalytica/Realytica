/**
 * Property-screen engines, writing onto a project.
 *
 * `runScreen` still computes against identity + documents. This module is the
 * only product path: a DdProject is the site, evidence files are the papers,
 * and the snapshot lands as valuation, findings, risks, actions, evidence
 * gaps and a proposed decision — the same registers the rest of the OS uses.
 */

import { classifyDocument, extractFields, runScreen } from '../engine';
import { REFERENCE_DATA } from '../reference';
import type {
  CaseDocument,
  DocumentKind,
  KarnatakaAttributes,
  KarnatakaJurisdiction,
  PropertyIdentity,
  PropertyType,
  RecommendedAction,
  RiskCategory,
  RiskFlag,
  RiskSeverity,
  ScreenResult,
  ScreenVerdict,
  SiteContext,
} from '../types';
import { matchProjectLocality } from './capabilities';
import {
  addAction,
  addDecision,
  addEvidence,
  addFinding,
  addRisk,
  ensureProjectShape,
  generateReport,
} from './operations';
import type {
  ActionKind,
  ChatProposal,
  DdProject,
  FindingSeverity,
  Probability,
  ProjectScreenSnapshot,
  RiskImpactType,
  ScopeKey,
  ValuationRun,
} from './types';

const SCREEN_MARK = (code: string) => `[screen:${code}]`;

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  const uuid = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

/**
 * Whether a record already carries this screen's code.
 *
 * Reads the field first and the old inline mark second. The fallback is not
 * decoration: every project screened before `screenCode` existed has the mark
 * baked into its prose, and dropping the text check would make the screen
 * re-file every finding it had ever filed on those files. `ensureProjectShape`
 * migrates them on load; this keeps the run correct for one that has not been
 * loaded yet.
 */
function hasMark(record: { screenCode?: string }, haystack: string | undefined, code: string): boolean {
  if (record.screenCode) return record.screenCode === code;
  return Boolean(haystack?.includes(SCREEN_MARK(code)));
}

function already(project: DdProject, code: string): boolean {
  return (
    project.findings.some((f) => hasMark(f, f.description, code))
    || project.risks.some((r) => hasMark(r, r.cause, code) || hasMark(r, r.residualNote, code))
    || project.actions.some((a) => hasMark(a, a.description, code))
    || project.evidence.some((e) => hasMark(e, e.description, code))
    || project.decisions.some((d) => hasMark(d, d.rationale, code))
  );
}

function propertyTypeOf(project: DdProject): PropertyType {
  if (project.type === 'commercial') return 'commercial_office';
  if (project.type === 'industrial' || project.type === 'logistics') return 'industrial_warehouse';
  if (project.type === 'hospitality') return 'residential_villa';
  const land = project.landAreaSqm ?? 0;
  const built = project.builtUpAreaSqm ?? 0;
  if (land > 0 && built === 0) return 'land_parcel';
  if (project.type === 'residential') return built > 0 ? 'residential_apartment' : 'residential_plot';
  return 'land_parcel';
}

/**
 * The planning authority named in a project's `jurisdiction` string.
 *
 * A project records its jurisdiction the way an analyst writes it —
 * "Karnataka / BMRDA", "Karnataka / BBMP" — and which authority governs the
 * site decides whether a khata, a Form 9/11 or a BDA sanction is even the
 * right instrument to ask for. That was already on the file and reached the
 * Karnataka checks as `unknown`.
 *
 * Read from the string only when nobody has recorded the field explicitly,
 * and only for authorities named unambiguously. This is reading what is
 * written down, not inferring what is not: an unrecognised jurisdiction stays
 * `unknown`, because the checks are meant to say "not established" rather
 * than guess.
 */
function jurisdictionFromText(text: string | undefined): KarnatakaJurisdiction {
  if (!text) return 'unknown';
  const hay = text.toLowerCase();
  if (/\bbbmp\b/.test(hay)) return 'BBMP';
  if (/\bbiaapa\b/.test(hay)) return 'BIAAPA';
  if (/\bbmrda\b/.test(hay)) return 'BMRDA';
  if (/\bbda\b/.test(hay)) return 'BDA';
  if (/gram\s*panchayat|\bgp\b/.test(hay)) return 'gram_panchayat';
  return 'unknown';
}

/**
 * The state-pack particulars for a project, as recorded.
 *
 * Only `jurisdiction` is ever derived, and only from the project's own
 * jurisdiction text (above). Khata type, conversion status and area basis are
 * matters of record and are exactly what this product exists to check, so
 * nothing here supplies a default that would read as an answer — they stay
 * `unknown` until somebody puts the record on the file. Returns `undefined`
 * when there is nothing at all to say, so a non-Karnataka project carries no
 * empty Karnataka block.
 */
function projectKarnatakaAttributes(project: DdProject): KarnatakaAttributes | undefined {
  const recorded = project.karnataka;
  const jurisdiction =
    recorded?.jurisdiction && recorded.jurisdiction !== 'unknown'
      ? recorded.jurisdiction
      : jurisdictionFromText(project.jurisdiction);
  if (!recorded && jurisdiction === 'unknown') return undefined;
  return {
    khataType: 'unknown',
    eKhataIssued: false,
    landConversionStatus: 'unknown',
    areaBasis: 'unknown',
    ...recorded,
    jurisdiction,
  };
}

export function projectToIdentity(project: DdProject): PropertyIdentity {
  const locality = matchProjectLocality(project);
  const country = project.currency === 'EUR' ? 'NL' : 'IN';
  const state =
    project.jurisdiction
    || (country === 'IN' ? 'Karnataka' : 'Noord-Holland');
  return {
    label: project.name,
    country,
    state,
    city: project.city,
    locality: locality?.locality ?? project.location,
    addressLine: project.siteAddress || project.location,
    postalCode: '',
    // The recorded parcel id wins; the notes scrape stays as the fallback for
    // projects created before there was a field to record it in.
    parcelId: project.parcelId || project.assets[0]?.notes?.match(/Sy\.?\s*[\d/]+/i)?.[0] || '',
    propertyType: propertyTypeOf(project),
    // Absent means unknown. Asserting freehold on every project put a fact
    // nobody entered into the valuation and hid the tenure risk behind it.
    tenure: project.tenure ?? 'unknown',
    builtUpAreaSqm: project.builtUpAreaSqm ?? 0,
    plotAreaSqm: project.landAreaSqm ?? 0,
    askingPrice: project.budget,
    currency: project.currency,
    plot: project.plot,
    // The surveyor's outline, when somebody supplied one. It drives area
    // reconciliation and the site-constraint geometry, and the project path
    // was holding it and not passing it.
    boundary: project.surveyBoundary,
    karnataka: projectKarnatakaAttributes(project),
  };
}

function kindFromEvidenceTitle(title: string, fileName?: string): { kind: DocumentKind; confidence: number } {
  return classifyDocument(fileName || `${title}.pdf`, 'application/pdf');
}

export function projectToScreenDocuments(project: DdProject): CaseDocument[] {
  const docs: CaseDocument[] = [];
  for (const row of project.evidence) {
    const attachment = row.attachments[0];
    const fileName = attachment?.fileName || row.fileName || `${row.title}.pdf`;
    const classified = kindFromEvidenceTitle(row.title, fileName);
    const doc: CaseDocument = {
      id: row.id,
      caseId: project.id,
      fileName,
      mimeType: attachment?.mimeType ?? 'application/pdf',
      sizeBytes: attachment?.sizeBytes ?? 0,
      uploadedAt: row.createdAt,
      kind: classified.kind,
      classificationConfidence: classified.confidence,
      kindConfirmedByUser: false,
      pages: 1,
      ocrStatus: 'complete',
      extracted: [],
      notes: row.source,
    };
    doc.extracted = extractFields(doc, projectToIdentity(project), project.id);
    docs.push(doc);
  }
  return docs;
}

export function runProjectScreen(project: DdProject, now = nowIso(), siteContext?: SiteContext): ScreenResult {
  ensureProjectShape(project);
  const identity = projectToIdentity(project);
  return runScreen({
    caseId: project.id,
    reference: project.reference,
    identity,
    documents: projectToScreenDocuments(project),
    refData: REFERENCE_DATA,
    now,
    siteContext: siteContext ?? project.siteContext,
  });
}

function severityOf(flag: RiskSeverity): FindingSeverity {
  if (flag === 'critical') return 'critical';
  if (flag === 'serious') return 'high';
  if (flag === 'warning') return 'medium';
  return 'low';
}

function impactOf(category: RiskCategory): RiskImpactType {
  if (category === 'title') return 'legal';
  if (category === 'planning') return 'compliance';
  if (category === 'structural') return 'quality';
  if (category === 'financial') return 'cost';
  if (category === 'market' || category === 'tenancy') return 'commercial';
  if (category === 'environmental') return 'esg';
  return 'operational';
}

function disciplineOf(category: RiskCategory): ScopeKey {
  if (category === 'title') return 'legal';
  if (category === 'planning') return 'regulatory';
  if (category === 'structural') return 'technical';
  if (category === 'financial') return 'financial_appraisal';
  if (category === 'market' || category === 'tenancy') return 'commercial_market';
  if (category === 'environmental') return 'esg';
  return 'legal';
}

function probabilityOf(flag: RiskFlag): Probability {
  if (flag.severity === 'critical') return 'likely';
  if (flag.severity === 'serious') return 'possible';
  return 'possible';
}

function actionKindOf(action: RecommendedAction): ActionKind {
  const hay = `${action.title} ${action.description}`.toLowerCase();
  if (/\b(search|certificate|document|extract|deed|khata|encumbrance)\b/.test(hay)) return 'evidence_request';
  if (/\b(survey|inspect|visit|measure)\b/.test(hay)) return 'reinspection';
  if (/\b(lawyer|counsel|opinion|valuer)\b/.test(hay)) return 'expert_review';
  return 'clarification';
}

function actionPriority(action: RecommendedAction): FindingSeverity {
  if (action.priority === 'now') return 'critical';
  if (action.priority === 'before_offer') return 'high';
  return 'medium';
}

function decisionTypeOf(verdict: ScreenVerdict): 'proceed' | 'approve_with_conditions' | 'reject' | 'other' {
  if (verdict === 'pursue') return 'proceed';
  if (verdict === 'pursue_with_conditions') return 'approve_with_conditions';
  if (verdict === 'do_not_pursue') return 'reject';
  return 'other';
}

function snapshotFrom(result: ScreenResult): ProjectScreenSnapshot {
  return {
    generatedAt: result.generatedAt,
    engineVersion: result.engineVersion,
    verdict: result.recommendation.verdict,
    headline: result.recommendation.headline,
    reasoning: result.recommendation.reasoning,
    indicatedMid: result.indicativeValue.mid,
    indicatedLow: result.indicativeValue.low,
    indicatedHigh: result.indicativeValue.high,
    currency: result.indicativeValue.currency,
    completenessScore: result.completeness.score,
    confidenceScore: result.confidence.score,
    openCriticalRisks: result.risks.filter((r) => r.severity === 'critical' && r.status === 'open').length,
  };
}

function writeValuationFromScreen(project: DdProject, result: ScreenResult, actor: string): ValuationRun {
  const at = nowIso();
  for (const prior of project.valuationRuns) {
    if (prior.status === 'computed' || prior.status === 'issued') prior.status = 'superseded';
  }
  const locality = matchProjectLocality(project);
  const mid = result.indicativeValue.mid;
  const approaches = result.anchors.slice(0, 4).map((anchor) => {
    const method = String(anchor.method);
    const approach =
      method.includes('cost') || method.includes('replacement')
        ? ('cost' as const)
        : method.includes('income') || method.includes('yield')
          ? ('income' as const)
          : method.includes('residual')
            ? ('residual' as const)
            : ('market' as const);
    return {
      approach,
      // The anchor's own name, because three market-family anchors otherwise
      // arrive as three rows called "Market / comparable". The rationale is
      // the note; the name is no longer glued to the front of it.
      label: anchor.label,
      amount: anchor.mid,
      notes: anchor.rationale,
      weight: anchor.weight || 0.25,
    };
  });
  const run: ValuationRun = {
    id: id('val'),
    status: 'computed',
    signOff: 'unsigned',
    localityId: locality?.id,
    localityLabel: locality ? `${locality.locality}, ${locality.city}` : undefined,
    comparableValue: result.indicativeValue.mid,
    indicatedValue: mid,
    low: result.indicativeValue.low,
    high: result.indicativeValue.high,
    currency: result.indicativeValue.currency === 'EUR' ? 'EUR' : 'INR',
    ibbi: {
      instruction: `Property screen of ${project.name}. Indicative decision-support only — not a certified valuation.`,
      subject: `${project.name}, ${project.location}, ${project.city}.`,
      dates: { valuationDate: at.slice(0, 10), evidenceCutoff: at.slice(0, 10) },
      basis: 'market_value',
      premise: project.currentStage === 'operations' || project.currentStage === 'handover' ? 'as_is' : 'residual',
      legalPlanningAssumptions: result.risks
        .filter((r) => r.category === 'title' || r.category === 'planning')
        .map((r) => r.title)
        .join('; ') || 'No title/planning flags from this screen. Absence is not a clean title.',
      approaches: approaches.length
        ? approaches
        : [{ approach: 'market', amount: mid, notes: result.snapshot.headline, weight: 1 }],
      reconciliation: `${result.indicativeValue.currency} ${Math.round(mid).toLocaleString()} (${Math.round(result.indicativeValue.low).toLocaleString()}–${Math.round(result.indicativeValue.high).toLocaleString()}). Completeness ${result.completeness.score}; confidence ${result.confidence.band}. ${result.recommendation.headline}`,
      caveats: [
        'Indicative only. Not an IBBI-registered valuer’s report.',
        ...result.recommendation.reasoning.slice(0, 4),
      ],
      evidenceReliedUponIds: project.evidence.filter((e) => e.used).map((e) => e.id),
      evidenceConsideredIds: project.evidence.filter((e) => e.considered && !e.used).map((e) => e.id),
      evidenceGapIds: project.evidence.filter((e) => e.status === 'expected' || e.status === 'missing').map((e) => e.id),
    },
    createdAt: at,
    createdBy: actor,
  };
  project.valuationRuns.push(run);
  project.audit.push({
    id: id('aud'),
    at,
    actor,
    action: 'valuation_run',
    entityType: 'valuation',
    entityId: run.id,
    newValue: String(Math.round(run.indicatedValue)),
    reason: 'property_screen',
  });
  return run;
}

export interface AppliedScreen {
  result: ScreenResult;
  snapshot: ProjectScreenSnapshot;
  valuationId: string;
  findingIds: string[];
  riskIds: string[];
  actionIds: string[];
  evidenceIds: string[];
  decisionId?: string;
  reportId?: string;
}

export function applyScreenToProject(project: DdProject, result: ScreenResult, actor = 'operator'): AppliedScreen {
  ensureProjectShape(project);
  const findingIds: string[] = [];
  const riskIds: string[] = [];
  const actionIds: string[] = [];
  const evidenceIds: string[] = [];

  for (const flag of result.risks) {
    if (flag.status !== 'open') continue;
    if (already(project, flag.code)) continue;
    const finding = addFinding(
      project,
      {
        title: flag.title,
        description: `${flag.description}\n\nImpact: ${flag.impact}`,
        screenCode: flag.code,
        severity: severityOf(flag.severity),
        discipline: disciplineOf(flag.category),
        status: 'open',
        owner: actor,
      },
      actor,
    );
    findingIds.push(finding.id);
    const risk = addRisk(
      project,
      {
        title: flag.title,
        category: impactOf(flag.category),
        cause: flag.description,
        screenCode: flag.code,
        impactType: impactOf(flag.category),
        probability: probabilityOf(flag),
        impactScore: flag.severity === 'critical' ? 5 : flag.severity === 'serious' ? 4 : 3,
        materiality: severityOf(flag.severity),
        mitigation: flag.mitigation,
        findingIds: [finding.id],
        owner: actor,
      },
      actor,
    );
    riskIds.push(risk.id);
  }

  for (const action of result.actions) {
    if (action.done) continue;
    if (already(project, action.id)) continue;
    const record = addAction(
      project,
      {
        title: action.title,
        kind: actionKindOf(action),
        owner: action.owner,
        priority: actionPriority(action),
        description: `${action.description}\nUnblocks: ${action.unblocks.join('; ') || '—'}`,
        screenCode: action.id,
      },
      actor,
    );
    actionIds.push(record.id);
  }

  for (const item of result.completeness.items) {
    if (item.present || !item.required) continue;
    const code = `gap:${item.key}`;
    if (already(project, code)) continue;
    const evidence = addEvidence(
      project,
      {
        title: item.label,
        kind: 'document',
        source: 'property_screen',
        status: 'expected',
        description: item.note || `Required for a complete screen. Satisfied by: ${item.satisfiedBy.join(', ')}.`,
        screenCode: code,
      },
      actor,
    );
    evidenceIds.push(evidence.id);
  }

  if (result.titleGraph) {
    const code = 'title-graph';
    if (!already(project, code) && (result.titleGraph.contradictions.length > 0 || result.titleGraph.integrityScore < 80)) {
      const finding = addFinding(
        project,
        {
          title: result.titleGraph.headline || 'Title graph',
          description: `Integrity ${result.titleGraph.integrityScore}/100. ${result.titleGraph.contradictions.map((c) => c.statement).join(' ') || 'No contradictions named.'}`,
          screenCode: code,
          severity: result.titleGraph.contradictions.some((c) => c.severity === 'critical' || c.severity === 'serious') ? 'high' : 'medium',
          discipline: 'legal',
          status: 'open',
          owner: actor,
        },
        actor,
      );
      findingIds.push(finding.id);
    }
  }

  const valuation = writeValuationFromScreen(project, result, actor);
  const snapshot = snapshotFrom(result);
  project.lastScreen = snapshot;
  // Keep the working, not just the verdict. The registers carry what the
  // screen concluded; this carries what it concluded it FROM — anchors,
  // comparables, drivers, the state compliance checks and the transaction
  // costs. All of it was computed on every run and then dropped, which left
  // "pursue with conditions" as an assertion the reader could not interrogate.
  project.lastScreenResult = result;
  project.updatedAt = nowIso();

  let decisionId: string | undefined;
  const verdictCode = `verdict:${result.recommendation.verdict}`;
  if (!already(project, verdictCode)) {
    const decision = addDecision(
      project,
      {
        title: `Screen: ${result.recommendation.verdict.replaceAll('_', ' ')}`,
        decisionType: decisionTypeOf(result.recommendation.verdict),
        decisionMaker: actor,
        status: 'proposed',
        rationale: `${result.recommendation.headline}\n\n${result.recommendation.reasoning.join('\n')}`,
        screenCode: verdictCode,
        findingIds,
        riskIds,
      },
      actor,
    );
    decisionId = decision.id;
  }

  const report = generateReport(project, { kind: 'red_flag', generatedBy: actor }, actor);

  return {
    result,
    snapshot,
    valuationId: valuation.id,
    findingIds,
    riskIds,
    actionIds,
    evidenceIds,
    decisionId,
    reportId: report.id,
  };
}

/** Compute the screen and write it onto the project registers. */
export function screenProject(project: DdProject, actor = 'operator', now = nowIso(), siteContext?: SiteContext): AppliedScreen {
  if (siteContext) project.siteContext = siteContext;
  const result = runProjectScreen(project, now, siteContext ?? project.siteContext);
  return applyScreenToProject(project, result, actor);
}

export function proposeProjectScreen(project: DdProject, actor = 'operator'): ChatProposal {
  const identity = projectToIdentity(project);
  return {
    id: id('prp'),
    kind: 'run_screen',
    title: `Run property screen on ${project.name}`,
    rationale: `Treat this project as the site. Identity: ${identity.city} / ${identity.locality}. ${project.evidence.length} evidence row(s) become the papers. The engine writes findings, risks, actions, evidence gaps, an indicative valuation and a proposed pursue/don’t decision — nothing is certified.`,
    impact: 'Writes into the same registers the rest of the OS uses. Re-running skips rows already tagged from a prior screen.',
    status: 'proposed',
    payload: {},
    createdAt: nowIso(),
    createdBy: actor,
  };
}

export function wantsProjectScreen(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  return (
    /\b(run|start|do|compute)\b.{0,24}\b(property )?screen\b/i.test(q)
    || /\bscreen (this |the )?(project|site|property)\b/i.test(q)
    || /\bproperty screen\b/i.test(q)
    || /\bshould (we|i) (pursue|buy|acquire|proceed)\b/i.test(q)
    || /\bworth (investigating|pursuing|buying)\b/i.test(q)
  );
}
