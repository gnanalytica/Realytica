/**
 * Property-screen engines, writing onto a project.
 *
 * `runScreen` still computes against identity + documents. This module is the
 * only product path: a DdProject is the site, evidence files are the papers,
 * and the snapshot lands as valuation, findings, risks, actions, evidence
 * gaps and a proposed decision — the same registers the rest of the OS uses.
 */

import { classifyDocument, runScreen } from '../engine';
import { acceptedFacts } from './fact-review';
import { REFERENCE_DATA } from '../reference';
import type {
  CaseDocument,
  CompletenessSummary,
  ConfidenceSummary,
  DocumentKind,
  ExtractedField,
  ReferenceData,
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
import { documentKindForLabel } from './document-parse';
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
  GeneratedReport,
  EvidenceRecord,
  EvidenceStatus,
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

/** Raised, and not closed by a later screen (see `retireWhatIsNoLongerRaised`). */
function already(project: DdProject, code: string): boolean {
  return (
    project.findings.some((f) => !f.screenClosedAt && hasMark(f, f.description, code))
    || project.risks.some((r) => !r.screenClosedAt && (hasMark(r, r.cause, code) || hasMark(r, r.residualNote, code)))
    || project.actions.some((a) => !a.screenClosedAt && hasMark(a, a.description, code))
    || project.evidence.some((e) => hasMark(e, e.description, code))
    || project.decisions.some((d) => !d.screenClosedAt && hasMark(d, d.rationale, code))
  );
}

/** A red flag report is a live reading of the registers; one nobody touched holds nothing a new one lacks. */
function untouchedDraft(report: GeneratedReport): boolean {
  return (
    report.status === 'generated'
    && !report.reviewer
    && !report.signedBy
    && (report.body.blocks ?? []).every((b) => !b.editedAt && !b.stateBy && !b.detachedAt)
  );
}

/**
 * Close what an earlier screen raised and this one no longer does.
 *
 * The screen used to only add. A finding it raised stayed open after the
 * document that answered it was filed, and one built on facts an earlier
 * engine had made up — a mother deed nobody supplied — stayed open for good,
 * because the same code on every later run counted as already raised. Now a
 * re-screen retires its own earlier output that it no longer stands behind,
 * but only while nobody has taken it up: a finding still open, a risk still
 * only identified, an action not started, a verdict still only proposed.
 * Anything a person moved on is theirs and stays as they left it.
 *
 * Closed with the reason and `screenClosedAt`, never deleted; the same thing
 * found again later is raised afresh. Earlier red flag drafts nobody touched
 * are replaced by the one this run writes rather than piling up beside it.
 */
function retireWhatIsNoLongerRaised(project: DdProject, result: ScreenResult, verdictCode: string, actor: string, at: string): void {
  const raised = new Set<string>([
    ...result.risks.filter((flag) => flag.status === 'open').map((flag) => flag.code),
    ...result.actions.filter((action) => !action.done).map((action) => action.id),
  ]);
  const note = `No longer raised by the screen of ${at.slice(0, 10)}.`;
  const graph = result.titleGraph;
  const graphRaises = Boolean(graph && (graph.contradictions.length > 0 || graph.integrityScore < 80));
  const graphHeadline = graph?.headline || 'Title graph';
  let closed = 0;

  for (const f of project.findings) {
    if (!f.screenCode || f.screenClosedAt || f.status !== 'open') continue;
    if (f.screenCode === 'title-graph') {
      // The same headline is the same finding; a different one replaces it.
      if (graphRaises && f.title === graphHeadline) continue;
      f.status = graphRaises ? 'superseded' : 'closed';
      f.confidenceNote = graphRaises ? `Replaced by the title graph of ${at.slice(0, 10)}.` : note;
    } else {
      if (raised.has(f.screenCode)) continue;
      f.status = 'closed';
      f.confidenceNote = note;
    }
    f.screenClosedAt = at;
    f.updatedAt = at;
    closed += 1;
  }
  for (const r of project.risks) {
    if (!r.screenCode || r.screenClosedAt || r.status !== 'identified' || raised.has(r.screenCode)) continue;
    r.status = 'closed';
    r.residualNote = note;
    r.screenClosedAt = at;
    r.updatedAt = at;
    closed += 1;
  }
  for (const a of project.actions) {
    if (!a.screenCode || a.screenClosedAt || a.status !== 'not_started' || raised.has(a.screenCode)) continue;
    a.status = 'closed';
    a.screenClosedAt = at;
    a.updatedAt = at;
    closed += 1;
  }
  for (const d of project.decisions) {
    if (!d.screenCode?.startsWith('verdict:') || d.screenCode === verdictCode || d.screenClosedAt) continue;
    if (d.status !== 'proposed' && d.status !== 'pending') continue;
    d.status = 'rejected';
    d.rationale = `${d.rationale}\n\nWithdrawn: the screen of ${at.slice(0, 10)} reached a different verdict.`;
    d.screenClosedAt = at;
    d.updatedAt = at;
    closed += 1;
  }

  const before = project.reports.length;
  project.reports = project.reports.filter((r) => !(r.kind === 'red_flag' && untouchedDraft(r)));
  const replaced = before - project.reports.length;

  if (!closed && !replaced) return;
  project.audit.push({
    id: id('aud'),
    at,
    actor,
    action: 'rescreen',
    entityType: 'project',
    entityId: project.id,
    newValue: [
      closed ? `Closed ${closed} record${closed === 1 ? '' : 's'} the screen no longer raises` : '',
      replaced ? `replaced ${replaced} untouched red flag draft${replaced === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join('; ') + '.',
  });
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
  // India is the only country pack. A project is screened against Indian
  // rules or not at all; the state decides which state pack applies.
  const country = 'IN';
  const state = project.jurisdiction || 'Karnataka';
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
    // A coordinate the file itself states. Where it exists the geocoder is
    // never called: it would be guessing at a village name about a property
    // whose own plan already gives the point.
    statedPoint: project.siteCoordinate,
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

/**
 * The screen's names for what a filed document states.
 *
 * The parser keys a fact by the check it can fill (`extent_title`,
 * `khata_type`); the screen and the title graph read the older
 * `ExtractedField` names (`extent`, `khataClassification`). Only the pairs
 * that mean the same thing are listed. Any other fact keeps its own key: the
 * screen still quotes it as evidence, it just does not reason from it.
 */
const SCREEN_FIELD_KEY: Record<string, string> = {
  extent_title: 'extent',
  extent_khata: 'assessedArea',
  owner: 'ownerName',
  consideration: 'considerationPaid',
  registration_date: 'deedDate',
  document_number: 'registrationNumber',
  survey_numbers: 'surveyNumber',
  khata_type: 'khataClassification',
  khata_number: 'khataNumber',
  sas_number: 'sasApplicationNumber',
  sanctioned_far: 'approvedFar',
  rera_number: 'reraNumber',
  oc_date: 'ocIssueDate',
  order_number: 'conversionOrderNumber',
  conversion_date: 'conversionOrderDate',
  boundary_north: 'boundaryNorth',
  boundary_east: 'boundaryEast',
  boundary_south: 'boundarySouth',
  boundary_west: 'boundaryWest',
};

/** A khata type as the screen's classification field spells it. */
function khataClassification(value: string): string {
  const letter = value.trim().match(/^([AB])\b/i)?.[1];
  return letter ? letter.toUpperCase() : value;
}

/**
 * What a filed document states, in the screen's vocabulary.
 *
 * Every value here was read off the document and carries the page it was
 * read from. Nothing is inferred to fill a gap: a deed whose reader found no
 * owner has no owner field, and the screen says the owner is unconfirmed.
 */
function factsToFields(row: EvidenceRecord): ExtractedField[] {
  const method = row.readMethod === 'ocr' ? 'ocr' : 'parser';
  return acceptedFacts(row).map((fact) => {
    const key = SCREEN_FIELD_KEY[fact.key] ?? fact.key;
    const raw = typeof fact.value === 'boolean' ? (fact.value ? 'yes' : 'no') : String(fact.value);
    return {
      key,
      label: fact.label,
      value: key === 'khataClassification' ? khataClassification(raw) : raw,
      unit: fact.unit,
      // A parsed fact is read with its words beside it, so it is as sure as
      // the reading. OCR of a scan is less so.
      confidence: method === 'ocr' ? 0.75 : 0.9,
      sourceDocumentId: row.id,
      sourcePage: fact.page,
      method,
    };
  });
}

/**
 * Rows that stand for a document someone has supplied.
 *
 * An expected or requested row is a placeholder for a paper nobody has sent
 * yet; counting it as on file would score a screen as complete on the
 * strength of its own to-do list. A superseded or rejected paper is on file
 * but no longer relied on.
 */
const NOT_RELIED_ON: ReadonlySet<EvidenceStatus> = new Set(['superseded', 'rejected', 'missing']);
const ON_FILE: ReadonlySet<EvidenceStatus> = new Set(['received', 'validated', 'used']);

function isOnFile(row: EvidenceRecord): boolean {
  if (NOT_RELIED_ON.has(row.status)) return false;
  return ON_FILE.has(row.status) || row.attachments.length > 0;
}

export function projectToScreenDocuments(project: DdProject): CaseDocument[] {
  const docs: CaseDocument[] = [];
  for (const row of project.evidence) {
    if (!isOnFile(row)) continue;
    const attachment = row.attachments[0];
    const fileName = attachment?.fileName || row.fileName || `${row.title}.pdf`;
    // What the document was read as outranks what its file is called: a RERA
    // certificate saved as "scan_0042.pdf" is still one. The name is the
    // fallback for a file nothing could read.
    const read = documentKindForLabel(row.documentType);
    const classified = read ? { kind: read, confidence: 0.95 } : kindFromEvidenceTitle(row.title, fileName);
    const extracted = factsToFields(row);
    docs.push({
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
      // 'complete' only for a document whose reading stated something. The
      // engine and the title graph both fill a 'complete' document that has
      // no fields with made-up values; a document nobody has read, or whose
      // reading found nothing, must not be handed to them as one.
      ocrStatus: extracted.length > 0 ? 'complete' : 'pending',
      extracted,
      notes: row.source,
    });
  }
  return docs;
}

/**
 * The reference data a client file may be screened against.
 *
 * The country and state packs are rules with provenance: stamp duty, the
 * documents a Karnataka title needs, what an A-khata means. They stay.
 *
 * The locality table and the comparable pool are not market data. They are
 * illustrative figures written to exercise the engine, and a screen that ran
 * a client's site against them would hand the client a value range, a
 * liquidity figure and a flood grade that describe nowhere in particular. So
 * the pool goes in empty, and every locality loses the two tables (water and
 * aerodrome) that the compliance checks would otherwise quote as if they were
 * about this site. The engine still needs a locality row to run; what it
 * computes from one is removed by `withoutMarketData` before anyone sees it.
 */
const PROJECT_REFERENCE_DATA: ReferenceData = {
  ...REFERENCE_DATA,
  comparablePool: [],
  localities: REFERENCE_DATA.localities.map(({ waterExposure: _water, aerodrome: _aerodrome, ...locality }) => locality),
};

/**
 * Risk flags the engine can only raise by reading those illustrative tables:
 * the value mid, the comparable pool, locality liquidity, zoning and FAR by
 * locality, and water exposure by locality. None may reach a client file.
 */
export const MARKET_RISK_CODES: ReadonlySet<string> = new Set([
  'asking_price_above_mid',
  'thin_comparable_evidence',
  'land_comparables_widened',
  'no_land_comparables',
  'locality_data_thin',
  'long_liquidity',
  'far_exceeded',
  'zoning_mismatch',
  'plot_road_width_far_cap',
  'flood_catchment_exposure',
]);

/**
 * Actions the engine raises from the value range or from duty charged on a
 * locality guidance value, keyed by the suffix of their id.
 */
export const MARKET_ACTIONS = [
  'lender-check',
  'guidance-value-reference',
  // Raised by the risks above; they go with them.
  'risk-asking-gap',
  'risk-thin-comps',
  'risk-far',
  'risk-zoning',
  'risk-locality-data',
];

/**
 * A verdict from what the file holds, and nothing it does not.
 *
 * The engine's own recommendation weighs a value range and a confidence band
 * built from the market tables; both are gone, so this weighs the risks the
 * documents and the state rules raised, and how much of the file is present.
 */
function recommendationFromFile(
  risks: RiskFlag[],
  completeness: CompletenessSummary,
): ScreenResult['recommendation'] {
  const open = risks.filter((r) => r.status === 'open');
  const critical = open.filter((r) => r.severity === 'critical');
  const serious = open.filter((r) => r.severity === 'serious');
  const missing = completeness.missingCritical;
  const reasoning: string[] = [];
  const conditions: string[] = [];
  let verdict: ScreenVerdict;

  if (critical.length > 0) {
    verdict = 'do_not_pursue';
    reasoning.push(`${critical.length} open critical issue${critical.length === 1 ? '' : 's'}: ${critical.map((r) => r.title).join(', ')}.`);
    conditions.push(...critical.map((r) => r.mitigation));
  } else if (missing.length > 0) {
    verdict = 'investigate_further';
    reasoning.push(`${missing.length} critical document${missing.length === 1 ? ' is' : 's are'} not on file: ${missing.join(', ')}.`);
    conditions.push('Obtain the missing documents and run the screen again.');
  } else if (serious.length > 0) {
    verdict = 'pursue_with_conditions';
    reasoning.push(`${serious.length} serious issue${serious.length === 1 ? '' : 's'} to resolve: ${serious.map((r) => r.title).join(', ')}.`);
    conditions.push(...serious.map((r) => r.mitigation));
  } else {
    verdict = 'pursue';
    reasoning.push('No open critical or serious issues were raised by the documents on file.');
  }
  reasoning.push(`Document completeness is ${completeness.score}/100.`);
  reasoning.push('No value is given here: the file holds no comparables or recorded rates. Record them on the Value tab.');
  if (conditions.length === 0) conditions.push('None raised by the documents on file. Continue with the planned due diligence.');

  const headline =
    verdict === 'pursue'
      ? 'No blocking issues in the documents on file.'
      : verdict === 'pursue_with_conditions'
        ? 'Workable, subject to the conditions below.'
        : verdict === 'investigate_further'
          ? 'Not enough on file to form a view.'
          : 'Stop until the critical issues are resolved.';
  return { verdict, headline, reasoning: reasoning.slice(0, 5), conditions: [...new Set(conditions)].slice(0, 6) };
}

/** Confidence in the screen, as a measure of the file rather than of a market. */
function confidenceFromFile(completeness: CompletenessSummary): ConfidenceSummary {
  const score = completeness.score;
  return {
    score,
    band: score >= 80 ? 'high' : score >= 50 ? 'moderate' : 'low',
    factors: [
      {
        key: 'documents',
        label: 'Documents on file',
        contribution: score,
        note: completeness.missingCritical.length
          ? `Missing: ${completeness.missingCritical.join(', ')}.`
          : 'Every critical document is on file.',
      },
    ],
    biggestLever: completeness.missingCritical[0]
      ? `Put the ${completeness.missingCritical[0]} on file.`
      : 'Record comparables or rates on the Value tab.',
  };
}

/**
 * The screen with everything built on the illustrative tables taken out.
 *
 * What stays is what the documents and the state rules support: completeness,
 * the title graph (now read from real facts), the state compliance checks,
 * the document risks and the actions that follow from them. What goes is the
 * value range, the anchors, comparables, drivers, market context, costs
 * charged on a guidance value, forced-sale and offer figures, the yield, the
 * JD split and the price trajectory, which is drawn against the value range.
 */
export function withoutMarketData(result: ScreenResult): ScreenResult {
  const risks = result.risks.filter((r) => !MARKET_RISK_CODES.has(r.code));
  const keptRiskIds = new Set(risks.map((r) => r.id));
  const stateCompliance = result.stateCompliance
    ? {
        ...result.stateCompliance,
        checks: result.stateCompliance.checks.map((c) => ({
          ...c,
          relatedRiskIds: c.relatedRiskIds.filter((riskId) => keptRiskIds.has(riskId)),
        })),
      }
    : undefined;
  const actions = result.actions.flatMap((a) => {
    const related = a.relatedRiskIds.filter((riskId) => keptRiskIds.has(riskId));
    // An action raised only for risks that are gone goes with them, and so
    // does one about duty on a guidance value this screen no longer computes.
    if (a.relatedRiskIds.length > 0 && related.length === 0) return [];
    if (MARKET_ACTIONS.some((key) => a.id.endsWith(`-${key}`))) return [];
    return [{ ...a, relatedRiskIds: related }];
  });

  const cited = new Set<string>([
    ...risks.flatMap((r) => r.evidenceIds),
    ...(stateCompliance?.checks.flatMap((c) => c.evidenceIds) ?? []),
  ]);
  const evidence = result.evidence.filter(
    (e) => e.sourceType === 'document' || e.sourceType === 'user_input' || cited.has(e.id),
  );

  const recommendation = recommendationFromFile(risks, result.completeness);
  const confidence = confidenceFromFile(result.completeness);
  const openCritical = risks.filter((r) => r.status === 'open' && r.severity === 'critical').length;
  const currency = result.indicativeValue.currency;
  const {
    transactionCosts: _costs,
    forcedSale: _forcedSale,
    offer: _offer,
    yield: _yield,
    waterExposure: _water,
    jdSplit: _jdSplit,
    priceTrajectory: _trajectory,
    ...rest
  } = result;

  return {
    ...rest,
    snapshot: {
      headline: recommendation.headline,
      bullets: [
        `${result.completeness.score}/100 document completeness${result.completeness.missingCritical.length ? `, missing: ${result.completeness.missingCritical.join(', ')}` : ', all critical documents on file'}.`,
        openCritical > 0 ? `${openCritical} open critical issue${openCritical === 1 ? '' : 's'} to resolve before proceeding.` : 'No open critical issues raised.',
        'No market value: the file holds no comparables or recorded rates.',
      ],
      keyFacts: result.snapshot.keyFacts.filter((f) => f.label !== 'Locality'),
    },
    indicativeValue: {
      low: 0,
      mid: 0,
      high: 0,
      currency,
      perSqm: { low: 0, mid: 0, high: 0 },
      spreadPct: 0,
      askingVsMidPct: null,
    },
    anchors: [],
    comparables: [],
    drivers: [],
    risks,
    planning: {
      ...result.planning,
      zoning: 'Not assessed',
      permittedUses: [],
      farAllowed: 0,
      buildablePotentialSqm: 0,
      restrictions: [],
      statusNote: 'Zoning and permissible FAR come from the Master Plan or a sanctioned plan. Neither has been read for this site.',
      source: 'Not assessed',
      evidenceIds: [],
    },
    confidence,
    evidence,
    actions,
    marketContext: {
      medianPricePerSqm: 0,
      yoyChangePct: 0,
      liquidityDays: 0,
      sampleSize: 0,
      source: 'Not used: no market data on file',
      trend: [],
    },
    stateCompliance,
    recommendation,
  };
}

export function runProjectScreen(project: DdProject, now = nowIso(), siteContext?: SiteContext): ScreenResult {
  ensureProjectShape(project);
  const identity = projectToIdentity(project);
  return withoutMarketData(
    runScreen({
      caseId: project.id,
      reference: project.reference,
      identity,
      documents: projectToScreenDocuments(project),
      refData: PROJECT_REFERENCE_DATA,
      now,
      siteContext: siteContext ?? project.siteContext,
    }),
  );
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
    // The screen gives no value on a project; see `withoutMarketData`.
    indicatedMid: result.indicativeValue.mid > 0 ? result.indicativeValue.mid : undefined,
    indicatedLow: result.indicativeValue.low > 0 ? result.indicativeValue.low : undefined,
    indicatedHigh: result.indicativeValue.high > 0 ? result.indicativeValue.high : undefined,
    currency: result.indicativeValue.currency,
    completenessScore: result.completeness.score,
    confidenceScore: result.confidence.score,
    openCriticalRisks: result.risks.filter((r) => r.severity === 'critical' && r.status === 'open').length,
  };
}

export interface AppliedScreen {
  result: ScreenResult;
  snapshot: ProjectScreenSnapshot;
  findingIds: string[];
  riskIds: string[];
  actionIds: string[];
  evidenceIds: string[];
  decisionId?: string;
  reportId?: string;
}

export interface ApplyScreenOptions {
  /**
   * Write a red flag report as well. On by default — the screen button always
   * has — and off when the screen runs as part of valuing the property, where a
   * report on every press would bury the Reports tab in copies of one another.
   */
  report?: boolean;
}

export function applyScreenToProject(project: DdProject, result: ScreenResult, actor = 'operator', options: ApplyScreenOptions = {}): AppliedScreen {
  ensureProjectShape(project);
  retireWhatIsNoLongerRaised(project, result, `verdict:${result.recommendation.verdict}`, actor, nowIso());
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

  // No valuation run is written. The screen has no value to give: a figure
  // comes only from the valuation run, over inputs somebody recorded.
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
  // A verdict somebody rejected, or the clean-up withdrew, is no answer to a
  // new run: only one still standing keeps this run from proposing its own.
  const standing = project.decisions.some(
    (d) => !d.screenClosedAt && d.status !== 'rejected' && hasMark(d, d.rationale, verdictCode),
  );
  if (!standing) {
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

  const report = options.report === false ? undefined : generateReport(project, { kind: 'red_flag', generatedBy: actor }, actor);

  return {
    result,
    snapshot,
    findingIds,
    riskIds,
    actionIds,
    evidenceIds,
    decisionId,
    reportId: report?.id,
  };
}

/** Compute the screen and write it onto the project registers. */
export function screenProject(project: DdProject, actor = 'operator', now = nowIso(), siteContext?: SiteContext, options: ApplyScreenOptions = {}): AppliedScreen {
  if (siteContext) project.siteContext = siteContext;
  const result = runProjectScreen(project, now, siteContext ?? project.siteContext);
  return applyScreenToProject(project, result, actor, options);
}

export function proposeProjectScreen(project: DdProject, actor = 'operator'): ChatProposal {
  const identity = projectToIdentity(project);
  return {
    id: id('prp'),
    kind: 'run_screen',
    title: `Run property screen on ${project.name}`,
    rationale: `Treat this project as the site. Identity: ${identity.city} / ${identity.locality}. ${project.evidence.length} evidence row(s) become the papers. The screen writes findings, risks, actions, evidence gaps and a proposed decision from the documents and the state rules. It gives no value: that comes from the valuation run over recorded inputs.`,
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
