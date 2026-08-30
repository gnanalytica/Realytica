import type { CheckInstance, DdAssessment, DdProject } from './types';
import { createValuationRun, proposeAiDrafts } from './capabilities';
import {
  addAction,
  addAsset,
  addDecision,
  addEvidence,
  addFinding,
  addRisk,
  changeStage,
  createAssessment,
  createProject,
  generateReport,
  linkFindingAcross,
  recordCheckResult,
  setAssessmentStatus,
  updateEvidenceStatus,
} from './operations';

function checkByDef(assessment: DdAssessment, definitionIdEndsWith: string): CheckInstance {
  for (const scope of assessment.scopes) {
    const found = scope.checks.find((c) => c.definitionId.endsWith(definitionIdEndsWith) || c.definitionId === definitionIdEndsWith);
    if (found) return found;
  }
  throw new Error(`Check ${definitionIdEndsWith} not found on ${assessment.name}`);
}

/**
 * A worked residential township at construction — the BRD's own nesting
 * example, populated enough that every register has something to show and
 * two DDs can be compared.
 */
export function seedDemoProject(): DdProject {
  const project = createProject(
    {
      name: 'Harohalli Greenfield Township',
      type: 'residential',
      location: 'Harohalli, Kanakapura Road',
      city: 'Bengaluru',
      jurisdiction: 'Karnataka / BMRDA',
      siteAddress: 'Sy. Nos. 41/1, 41/2 & 42, Harohalli Hobli, Kanakapura Taluk',
      currentStage: 'acquisition',
      description: 'Phased gated township: three residential towers, clubhouse, internal roads and central utilities. Used as the sample engagement for the manual DD operating model.',
      owner: 'DD Lead',
      developer: 'Harohalli Developments Pvt Ltd',
      landAreaSqm: 48_562,
      builtUpAreaSqm: 72_800,
      saleableAreaSqm: 61_400,
      budget: 4_80_00_00_000,
      currency: 'INR',
      portfolio: 'Bengaluru residential',
    },
    'RYT-0001',
    'Asha Menon',
  );

  const towerA = addAsset(project, { name: 'Tower A', assetType: 'Residential tower', currentStage: 'design', responsible: 'Site engineer — Tower A' }, 'Asha Menon');
  const towerB = addAsset(project, { name: 'Tower B', assetType: 'Residential tower', currentStage: 'design', responsible: 'Design lead' }, 'Asha Menon');
  addAsset(project, { name: 'Tower C', assetType: 'Residential tower', currentStage: 'design' }, 'Asha Menon');
  addAsset(project, { name: 'Clubhouse', assetType: 'Amenity building', currentStage: 'design' }, 'Asha Menon');
  addAsset(project, { name: 'Roads and external works', assetType: 'Infrastructure', currentStage: 'construction' }, 'Asha Menon');
  const utilities = addAsset(project, { name: 'Utilities', assetType: 'Central utilities', currentStage: 'construction' }, 'Asha Menon');
  addAsset(project, { name: 'STP', assetType: 'STP', parentId: utilities.id, currentStage: 'construction' }, 'Asha Menon');
  addAsset(project, { name: 'WTP', assetType: 'WTP', parentId: utilities.id, currentStage: 'design' }, 'Asha Menon');
  addAsset(project, { name: 'Substation', assetType: 'Electrical', parentId: utilities.id, currentStage: 'construction' }, 'Asha Menon');

  changeStage(
    project,
    { subject: 'project', stage: 'construction', reason: 'Main contract awarded; Tower A structure underway.' },
    'Asha Menon',
  );
  changeStage(
    project,
    { subject: 'asset', assetId: towerA.id, stage: 'construction', reason: 'Tower A moved from design freeze into structure.' },
    'Asha Menon',
  );

  const acquisition = createAssessment(
    project,
    {
      ddType: 'acquisition',
      name: 'Land Acquisition DD',
      owner: 'Asha Menon',
      reviewer: 'Legal counsel',
      targetType: 'project',
      objective: 'Proceed / renegotiate / reject on the land parcel and development rights.',
    },
    'Asha Menon',
  );

  const titleDeed = addEvidence(
    project,
    {
      title: 'Registered sale deed — Sy. 41/1',
      kind: 'document',
      source: 'Sub-registrar Kanakapura',
      status: 'validated',
      assessmentIds: [acquisition.id],
    },
    'Asha Menon',
  );
  updateEvidenceStatus(project, titleDeed.id, 'used', { used: true, considered: true }, 'Asha Menon');

  const ec = addEvidence(
    project,
    {
      title: 'Encumbrance certificate — 30 year',
      kind: 'document',
      source: 'Kaveri Online',
      status: 'validated',
      assessmentIds: [acquisition.id],
    },
    'Asha Menon',
  );
  updateEvidenceStatus(project, ec.id, 'used', { used: true, considered: true }, 'Asha Menon');

  recordCheckResult(
    project,
    checkByDef(acquisition, 'title_chain').id,
    {
      result: 'partially_compliant',
      comments: 'Chain is continuous from 1998. 1987–1998 relies on a family partition that is unregistered.',
      evidenceIds: [titleDeed.id, ec.id],
      findingTitle: 'Unregistered partition in the 1987–1998 title link',
      findingDescription: 'The partition deed cited for Sy. 41/2 is unregistered. Counsel flags enforceability risk until a registered confirmation or court decree is obtained.',
      findingSeverity: 'high',
    },
    'Legal counsel',
  );

  recordCheckResult(
    project,
    checkByDef(acquisition, 'encumbrances').id,
    { result: 'compliant', comments: 'Latest EC is clear of mortgages. Two released charges from 2014 and 2019.', evidenceIds: [ec.id], createFinding: false },
    'Legal counsel',
  );

  recordCheckResult(
    project,
    checkByDef(acquisition, 'land_use').id,
    {
      result: 'non_compliant',
      comments: 'A portion of Sy. 42 remains shown as agricultural in the revenue record pending DC conversion.',
      findingTitle: 'Unconverted agricultural pocket on Sy. 42',
      findingDescription: 'Layout sanction cannot cover the unconverted remainder. Conversion under Karnataka Land Reforms / s.95 is a condition precedent to full development.',
      findingSeverity: 'critical',
    },
    'Asha Menon',
  );

  recordCheckResult(
    project,
    checkByDef(acquisition, 'instruction').id,
    {
      result: 'compliant',
      comments: 'Indicative market value, as-is land plus residual GDV for the sanctioned scheme. Audience: investment committee. Not a certified valuation.',
      createFinding: false,
    },
    'Asha Menon',
  );

  const conversionFinding = project.findings.find((f) => f.title.includes('Unconverted'))!;
  addRisk(
    project,
    {
      title: 'Acquisition delayed by conversion of Sy. 42',
      category: 'legal',
      cause: 'Unconverted agricultural remainder cannot be included in the layout as drawn.',
      impactType: 'time',
      probability: 'likely',
      impactScore: 4,
      materiality: 'critical',
      owner: 'Legal counsel',
      findingIds: [conversionFinding.id],
      assessmentIds: [acquisition.id],
      mitigation: 'Condition precedent: DC conversion before second tranche of consideration.',
    },
    'Asha Menon',
  );
  addAction(
    project,
    {
      title: 'Obtain DC conversion for Sy. 42 remainder',
      kind: 'approval_submission',
      owner: 'Legal counsel',
      priority: 'critical',
      dueDate: '2026-09-30',
      findingIds: [conversionFinding.id],
    },
    'Asha Menon',
  );
  addDecision(
    project,
    {
      title: 'Proceed to acquire with conversion as a condition precedent',
      decisionType: 'approve_with_conditions',
      decisionMaker: 'Investment committee',
      status: 'approved',
      rationale: 'Title is otherwise workable. The unconverted pocket is priced out of the second tranche until conversion evidence is on file.',
      conditions: 'No vertical work on Sy. 42 until conversion is gazetted. Professional valuation to be commissioned before financial close.',
      findingIds: [conversionFinding.id],
      assessmentIds: [acquisition.id],
    },
    'Investment committee',
  );
  setAssessmentStatus(project, acquisition.id, 'completed', 'Asha Menon');

  const construction = createAssessment(
    project,
    {
      ddType: 'construction_progress',
      name: 'Construction Progress DD #04 — Tower A',
      owner: 'Ravi Hegde',
      reviewer: 'Asha Menon',
      targetType: 'assets',
      targetAssetIds: [towerA.id],
      priorAssessmentId: acquisition.id,
      objective: 'Whether Tower A execution matches drawings, programme, quality and HSE evidence.',
    },
    'Ravi Hegde',
  );

  const drawing = addEvidence(
    project,
    {
      title: 'Drawing DR-018 — fire escape, rev C',
      kind: 'drawing',
      source: 'Architect IFC set',
      status: 'validated',
      assetIds: [towerA.id],
      assessmentIds: [construction.id],
    },
    'Ravi Hegde',
  );
  const inspection = addEvidence(
    project,
    {
      title: 'Site inspection SI-221 — Tower A L7–L9',
      kind: 'inspection',
      source: 'PMC',
      status: 'validated',
      assetIds: [towerA.id],
      assessmentIds: [construction.id],
    },
    'Ravi Hegde',
  );
  updateEvidenceStatus(project, drawing.id, 'used', { used: true, considered: true }, 'Ravi Hegde');
  updateEvidenceStatus(project, inspection.id, 'used', { used: true, considered: true }, 'Ravi Hegde');

  recordCheckResult(
    project,
    checkByDef(construction, 'fire_life_safety').id,
    {
      result: 'non_compliant',
      comments: 'Measured escape width on L8 is 1050 mm against 1200 mm on approved drawing DR-018.',
      evidenceIds: [drawing.id, inspection.id],
      findingTitle: 'Fire escape width differs from approved drawing DR-018',
      findingDescription: 'Tower A L8 escape stair is built at 1050 mm. Sanctioned fire scheme and DR-018 require 1200 mm. Rework, revised detail, and likely a revised fire submission.',
      findingSeverity: 'critical',
    },
    'Ravi Hegde',
  );

  const fireFinding = project.findings.find((f) => f.title.includes('Fire escape'))!;
  const designDd = createAssessment(
    project,
    {
      ddType: 'design',
      name: 'Design DD — Tower B',
      owner: 'Design lead',
      targetType: 'assets',
      targetAssetIds: [towerB.id],
    },
    'Design lead',
  );
  const regulatoryDd = createAssessment(
    project,
    {
      ddType: 'approval_compliance',
      name: 'Regulatory DD #02',
      owner: 'Approvals coordinator',
      targetType: 'project',
    },
    'Approvals coordinator',
  );
  const costDd = createAssessment(
    project,
    {
      ddType: 'cost_schedule',
      name: 'Cost & Schedule DD #04',
      owner: 'QS',
      targetType: 'project',
    },
    'QS',
  );

  linkFindingAcross(
    project,
    fireFinding.id,
    { assessmentIds: [regulatoryDd.id, costDd.id, designDd.id], assetIds: [towerA.id], evidenceIds: [drawing.id, inspection.id] },
    'Ravi Hegde',
  );

  const reworkRisk = addRisk(
    project,
    {
      title: 'Rework cost and delay from fire-escape widening',
      category: 'cost',
      cause: 'As-built escape width is short of the sanctioned fire scheme.',
      impactType: 'cost',
      probability: 'likely',
      impactScore: 4,
      materiality: 'high',
      owner: 'QS',
      findingIds: [fireFinding.id],
      assetIds: [towerA.id],
      assessmentIds: [construction.id, costDd.id],
      mitigation: 'Issue revised detail, rectify L8, reinspect before the next payment milestone.',
    },
    'QS',
  );
  addRisk(
    project,
    {
      title: 'Fire approval risk on Tower A',
      category: 'compliance',
      cause: 'Deviation from sanctioned fire drawing.',
      impactType: 'compliance',
      probability: 'possible',
      impactScore: 5,
      materiality: 'critical',
      owner: 'Approvals coordinator',
      findingIds: [fireFinding.id],
      assetIds: [towerA.id],
      assessmentIds: [construction.id, regulatoryDd.id],
    },
    'Approvals coordinator',
  );
  addAction(
    project,
    {
      title: 'Rectify Tower A L8 escape width and reinspect',
      kind: 'remediation',
      owner: 'Contractor — Tower A',
      priority: 'critical',
      dueDate: '2026-09-12',
      findingIds: [fireFinding.id],
      riskIds: [reworkRisk.id],
    },
    'Ravi Hegde',
  );
  addAction(
    project,
    {
      title: 'Submit revised fire detail to the authority',
      kind: 'approval_submission',
      owner: 'Approvals coordinator',
      priority: 'high',
      dueDate: '2026-09-20',
      findingIds: [fireFinding.id],
    },
    'Asha Menon',
  );
  addDecision(
    project,
    {
      title: 'Approve remediation plan before next payment milestone',
      decisionType: 'hold_payment',
      decisionMaker: 'Project owner',
      status: 'pending',
      rationale: 'Payment on Tower A structure package is held until L8 escape width matches DR-018 or a revised sanction is in hand.',
      findingIds: [fireFinding.id],
      riskIds: [reworkRisk.id],
      assessmentIds: [construction.id],
    },
    'Project owner',
  );

  recordCheckResult(
    project,
    checkByDef(construction, 'planned_vs_actual').id,
    {
      result: 'partially_compliant',
      comments: 'Structure is two weeks behind the June baseline on L9 slab. Photos support the percent-complete; the recovery plan is not yet approved.',
      findingSeverity: 'medium',
      findingTitle: 'Tower A structure two weeks behind June baseline',
      findingDescription: 'L9 slab forecast has slipped 14 days. Critical-path impact on façade package not yet re-sequenced.',
    },
    'Ravi Hegde',
  );

  generateReport(
    project,
    { kind: 'red_flag', assessmentIds: [construction.id], generatedBy: 'Asha Menon' },
    'Asha Menon',
  );
  generateReport(
    project,
    { kind: 'executive_dd', assessmentIds: [construction.id, regulatoryDd.id], generatedBy: 'Asha Menon' },
    'Asha Menon',
  );

  addFinding(
    project,
    {
      title: 'Open RFI on Tower B podium transfer beam',
      description: 'RFI-118 unanswered for 19 days. Design DD cannot close structural completeness until the consultant responds.',
      severity: 'medium',
      discipline: 'technical',
      sourceAssessmentId: designDd.id,
      assetIds: [towerB.id],
      assessmentIds: [designDd.id],
    },
    'Design lead',
  );

  createValuationRun(project, 'Asha Menon');
  proposeAiDrafts(project, 'Asha Menon');

  return project;
}

export const SEED_DEMO_PROJECT_REFERENCE = 'RYT-0001';
