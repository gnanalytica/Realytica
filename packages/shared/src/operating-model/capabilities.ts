/**
 * BRD MVP 2 through Phase 5 capabilities, computed against the same project
 * registers as the manual system of record. Nothing here requires a model.
 */

import { REFERENCE_DATA } from '../reference';
import type { LocalityReference } from '../types';
import { LIFECYCLE_STAGE_LABEL } from './catalogs';
import {
  addAction,
  addDecision,
  addFinding,
  addRisk,
  assessmentProgress,
  changesSincePrevious,
  ensureProjectShape,
  evidenceCompleteness,
  packCompleteness,
  recommendedDdTypes,
} from './operations';
import type {
  ActionAging,
  AiDraft,
  AiDraftKind,
  AiDraftStatus,
  CapabilityRun,
  CreateActionInput,
  CreateDecisionInput,
  CreateFindingInput,
  CreateRiskInput,
  DdProject,
  EvidenceAttachment,
  PatchProjectInput,
  ProjectDashboard,
  ValuationPremise,
  ValuationRun,
} from './types';

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

export function patchProject(project: DdProject, input: PatchProjectInput, actor = 'operator'): DdProject {
  ensureProjectShape(project);
  const at = nowIso();
  if (input.name !== undefined) project.name = input.name.trim();
  if (input.description !== undefined) project.description = input.description;
  if (input.location !== undefined) project.location = input.location.trim();
  if (input.city !== undefined) project.city = input.city.trim();
  if (input.jurisdiction !== undefined) project.jurisdiction = input.jurisdiction;
  if (input.siteAddress !== undefined) project.siteAddress = input.siteAddress;
  if (input.owner !== undefined) project.owner = input.owner;
  if (input.developer !== undefined) project.developer = input.developer;
  if (input.landAreaSqm !== undefined) project.landAreaSqm = input.landAreaSqm;
  if (input.builtUpAreaSqm !== undefined) project.builtUpAreaSqm = input.builtUpAreaSqm;
  if (input.saleableAreaSqm !== undefined) project.saleableAreaSqm = input.saleableAreaSqm;
  if (input.budget !== undefined) project.budget = input.budget;
  if (input.portfolio !== undefined) project.portfolio = input.portfolio.trim() || undefined;
  if (input.status !== undefined) project.status = input.status;
  if (input.parcelId !== undefined) project.parcelId = input.parcelId.trim() || undefined;
  if (input.tenure !== undefined) project.tenure = input.tenure;
  if (input.plot !== undefined) project.plot = input.plot;
  if (input.karnataka !== undefined) project.karnataka = input.karnataka;
  touch(project, at);
  project.audit.push({
    id: id('aud'),
    at,
    actor,
    action: 'patch',
    entityType: 'project',
    entityId: project.id,
    newValue: input.portfolio ?? input.name,
  });
  return project;
}

export function attachEvidenceFile(
  project: DdProject,
  evidenceId: string,
  file: { fileName: string; mimeType: string; sizeBytes: number; storageKey: string },
  actor = 'operator',
): EvidenceAttachment {
  ensureProjectShape(project);
  const record = project.evidence.find((e) => e.id === evidenceId);
  if (!record) throw new Error('Evidence not found');
  const at = nowIso();
  const attachment: EvidenceAttachment = {
    id: id('file'),
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    storageKey: file.storageKey,
    uploadedAt: at,
  };
  record.attachments.push(attachment);
  record.fileName = file.fileName;
  if (record.status === 'expected' || record.status === 'requested' || record.status === 'missing') {
    record.status = 'received';
    record.considered = true;
  }
  record.updatedAt = at;
  touch(project, at);
  project.audit.push({
    id: id('aud'),
    at,
    actor,
    action: 'upload',
    entityType: 'evidence',
    entityId: record.id,
    newValue: file.fileName,
  });
  return attachment;
}

export function matchProjectLocality(project: DdProject, localities = REFERENCE_DATA.localities): LocalityReference | undefined {
  const city = project.city.toLowerCase();
  const location = project.location.toLowerCase();
  const byName = localities.find(
    (l) => l.city.toLowerCase() === city && location.includes(l.locality.toLowerCase()),
  );
  if (byName) return byName;
  const byCity = localities.find((l) => l.city.toLowerCase() === city);
  if (byCity) return byCity;
  return localities.find((l) => l.city.toLowerCase().includes(city.slice(0, 6))) ?? localities[0];
}

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function defaultPremise(project: DdProject): ValuationPremise {
  if (project.currentStage === 'opportunity_site' || project.currentStage === 'feasibility' || project.currentStage === 'acquisition') {
    return 'residual';
  }
  if (project.currentStage === 'operations' || project.currentStage === 'handover' || project.currentStage === 'completion') {
    return 'as_is';
  }
  return 'as_completed';
}

export function computeIndicativeValuation(project: DdProject, actor = 'operator'): Omit<ValuationRun, 'id' | 'createdAt' | 'createdBy' | 'status' | 'signOff'> {
  ensureProjectShape(project);
  const locality = matchProjectLocality(project);
  const landArea = project.landAreaSqm ?? 0;
  const builtUp = project.builtUpAreaSqm ?? 0;
  const saleable = project.saleableAreaSqm || builtUp;
  const landRate = locality?.medianLandRatePerSqm ?? 18_000;
  const builtRate = locality?.medianPricePerSqm ?? 85_000;
  const replacement = locality?.replacementCostPerSqm ?? 45_000;
  const yieldRate = locality?.grossYield ?? 0.04;

  const landValue = landArea > 0 ? landArea * landRate : undefined;
  const buildingReplacement = builtUp > 0 ? builtUp * replacement : undefined;
  const comparableValue = saleable > 0 ? saleable * builtRate : undefined;
  const costValue = (landValue ?? 0) + (buildingReplacement ?? 0);
  const incomeValue = saleable > 0 ? (saleable * builtRate * yieldRate) / 0.07 : undefined;

  const approaches = [
    comparableValue
      ? { approach: 'market' as const, amount: comparableValue, notes: `Saleable ${saleable.toLocaleString()} sqm × ${inr(builtRate)}/sqm locality median.`, weight: 0.4 }
      : null,
    costValue > 0
      ? { approach: 'cost' as const, amount: costValue, notes: `Land ${inr(landValue ?? 0)} + replacement ${inr(buildingReplacement ?? 0)}.`, weight: 0.3 }
      : null,
    incomeValue
      ? { approach: 'income' as const, amount: incomeValue, notes: `Stabilised income capitalised at 7% using ${((yieldRate) * 100).toFixed(1)}% gross yield.`, weight: 0.15 }
      : null,
    landValue && buildingReplacement
      ? {
          approach: 'residual' as const,
          amount: Math.max(0, (comparableValue ?? 0) - buildingReplacement),
          notes: 'GDV less replacement cost as a residual land check. Not a full development appraisal.',
          weight: 0.15,
        }
      : null,
  ].filter((a): a is NonNullable<typeof a> => a !== null);

  const weightSum = approaches.reduce((n, a) => n + a.weight, 0) || 1;
  const indicatedValue = approaches.reduce((n, a) => n + a.amount * (a.weight / weightSum), 0);
  const relied = project.evidence.filter((e) => e.used);
  const considered = project.evidence.filter((e) => e.considered && !e.used);
  const gaps = project.evidence.filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested');
  const legalFindings = project.findings.filter((f) => (f.discipline === 'legal' || f.discipline === 'regulatory') && f.status !== 'closed' && f.status !== 'rejected');

  return {
    localityId: locality?.id,
    localityLabel: locality ? `${locality.locality}, ${locality.city}` : undefined,
    landValue,
    buildingReplacement,
    comparableValue,
    indicatedValue,
    low: indicatedValue * 0.88,
    high: indicatedValue * 1.12,
    currency: project.currency,
    ibbi: {
      instruction: `Indicative decision-support valuation of ${project.name} for internal DD. Intended audience: project owner / investment committee. This is not a certified valuation.`,
      subject: `${project.name}, ${project.location}, ${project.city}. Land ${landArea.toLocaleString() || 'n/a'} sqm, BUA ${builtUp.toLocaleString() || 'n/a'} sqm, saleable ${saleable.toLocaleString() || 'n/a'} sqm. Stage: ${LIFECYCLE_STAGE_LABEL[project.currentStage]}.`,
      dates: {
        valuationDate: nowIso().slice(0, 10),
        evidenceCutoff: nowIso().slice(0, 10),
      },
      basis: 'market_value',
      premise: defaultPremise(project),
      legalPlanningAssumptions: legalFindings.length
        ? legalFindings.map((f) => `${f.severity}: ${f.title}`).join('; ')
        : 'No open legal/planning findings recorded. Absence of findings is not a clean title.',
      approaches,
      reconciliation: indicatedValue
        ? `Weighted indication ${inr(indicatedValue)} (range ${inr(indicatedValue * 0.88)}–${inr(indicatedValue * 1.12)}). Market and cost are the primary anchors; income and residual are cross-checks. Gaps in evidence reduce confidence and are listed, not implied as nil.`
        : 'Insufficient area inputs to compute a range. Record land and built-up area on the project.',
      caveats: [
        'Indicative only. Not an IBBI-registered valuer’s report and not to be used as certified value.',
        'Locality rates are reference medians, not a matched comparable set inspected for this asset.',
        `${gaps.length} evidence gap(s) remain. Relied-upon: ${relied.length}. Considered not used: ${considered.length}.`,
        actor ? `Prepared by ${actor} from live project registers.` : 'Prepared from live project registers.',
      ],
      evidenceReliedUponIds: relied.map((e) => e.id),
      evidenceConsideredIds: considered.map((e) => e.id),
      evidenceGapIds: gaps.map((e) => e.id),
    },
  };
}

export function createValuationRun(project: DdProject, actor = 'operator'): ValuationRun {
  ensureProjectShape(project);
  const at = nowIso();
  for (const prior of project.valuationRuns) {
    if (prior.status === 'computed' || prior.status === 'issued') prior.status = 'superseded';
  }
  const computed = computeIndicativeValuation(project, actor);
  const run: ValuationRun = {
    id: id('val'),
    status: 'computed',
    signOff: 'unsigned',
    ...computed,
    createdAt: at,
    createdBy: actor,
  };
  project.valuationRuns.push(run);
  touch(project, at);
  project.audit.push({
    id: id('aud'),
    at,
    actor,
    action: 'valuation_run',
    entityType: 'valuation',
    entityId: run.id,
    newValue: String(Math.round(run.indicatedValue)),
  });
  snapshotCapabilities(project, actor);
  return run;
}

export function setValuationSignOff(project: DdProject, runId: string, signOff: ValuationRun['signOff'], actor = 'operator'): ValuationRun {
  ensureProjectShape(project);
  const run = project.valuationRuns.find((r) => r.id === runId);
  if (!run) throw new Error('Valuation run not found');
  if (signOff === 'unsigned') run.status = 'computed';
  else if (signOff === 'internal_review') run.status = 'in_review';
  else run.status = 'computed';
  run.signOff = signOff;
  touch(project);
  project.audit.push({
    id: id('aud'),
    at: nowIso(),
    actor,
    action: 'valuation_signoff',
    entityType: 'valuation',
    entityId: run.id,
    newValue: signOff,
  });
  return run;
}

export function computeCapabilityRuns(project: DdProject): CapabilityRun[] {
  ensureProjectShape(project);
  const at = nowIso();
  const locality = matchProjectLocality(project);
  const latestVal = project.valuationRuns[project.valuationRuns.length - 1];
  const costFindings = project.findings.filter((f) => f.discipline === 'cost_quantity' && f.status !== 'closed' && f.status !== 'rejected');
  const costRisks = project.risks.filter((r) => r.category === 'cost' && r.status !== 'closed');
  const overdue = project.actions.filter((a) => a.status === 'overdue').length;
  const scheduleFindings = project.findings.filter((f) => f.discipline === 'schedule_progress' && f.status !== 'closed');
  const marketFindings = project.findings.filter((f) => f.discipline === 'commercial_market' && f.status !== 'closed');
  const saleable = project.saleableAreaSqm || project.builtUpAreaSqm || 0;
  const impliedPsm = saleable && latestVal ? latestVal.indicatedValue / saleable : 0;

  return [
    {
      kind: 'valuation',
      status: latestVal ? 'computed' : 'not_run',
      summary: latestVal
        ? `Indicative ${inr(latestVal.indicatedValue)} (${latestVal.ibbi.premise}, ${latestVal.signOff.split('_').join(' ')}).`
        : 'No valuation run yet. Compute from project areas and locality medians.',
      metrics: {
        indicated: latestVal ? Math.round(latestVal.indicatedValue) : 0,
        runs: project.valuationRuns.length,
      },
      updatedAt: latestVal?.createdAt ?? at,
    },
    {
      kind: 'cost',
      status: project.budget || costFindings.length ? 'computed' : 'not_run',
      summary: project.budget
        ? `Budget ${inr(project.budget)}. ${costFindings.length} open cost findings, ${costRisks.length} open cost risks.`
        : `${costFindings.length} open cost findings. Record a budget to anchor the cost capability.`,
      metrics: {
        budget: project.budget ?? 0,
        openFindings: costFindings.length,
        openRisks: costRisks.length,
      },
      updatedAt: at,
    },
    {
      kind: 'schedule',
      status: 'computed',
      summary: `Stage ${LIFECYCLE_STAGE_LABEL[project.currentStage]}. ${overdue} overdue actions, ${scheduleFindings.length} open schedule findings.`,
      metrics: {
        overdue,
        openFindings: scheduleFindings.length,
        stageHistory: project.stageHistory.length,
      },
      updatedAt: at,
    },
    {
      kind: 'market',
      status: locality ? 'computed' : 'not_run',
      summary: locality
        ? `${locality.locality}: median ${inr(locality.medianPricePerSqm)}/sqm, yield ${(locality.grossYield * 100).toFixed(1)}%, liquidity ${locality.liquidityDays} days. ${marketFindings.length} open market findings.`
        : 'No locality match for market comparables.',
      metrics: {
        medianPsm: locality?.medianPricePerSqm ?? 0,
        yieldPct: locality ? Math.round(locality.grossYield * 1000) / 10 : 0,
        openFindings: marketFindings.length,
      },
      updatedAt: at,
    },
    {
      kind: 'benchmarking',
      status: impliedPsm && locality ? 'computed' : 'not_run',
      summary:
        impliedPsm && locality
          ? `Indication ${inr(impliedPsm)}/sqm vs locality median ${inr(locality.medianPricePerSqm)}/sqm (${Math.round((impliedPsm / locality.medianPricePerSqm - 1) * 100)}%).`
          : 'Run valuation with saleable/BUA area to benchmark against the locality.',
      metrics: {
        impliedPsm: Math.round(impliedPsm),
        localityPsm: locality?.medianPricePerSqm ?? 0,
      },
      updatedAt: at,
    },
    {
      kind: 'report_builder',
      status: project.reports.length ? 'computed' : 'not_run',
      summary: `${project.reports.length} report(s) generated from live registers.`,
      metrics: { reports: project.reports.length },
      updatedAt: project.reports.length ? project.reports[project.reports.length - 1].generatedAt : at,
    },
  ];
}

export function snapshotCapabilities(project: DdProject, _actor = 'operator'): CapabilityRun[] {
  const runs = computeCapabilityRuns(project);
  project.capabilityRuns = runs;
  return runs;
}

function dueSoonCount(project: DdProject): number {
  const today = nowIso().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + 14);
  const horizon = soon.toISOString().slice(0, 10);
  return project.actions.filter((a) => a.status !== 'closed' && a.dueDate && a.dueDate >= today && a.dueDate <= horizon).length;
}

export function toDashboard(project: DdProject): ProjectDashboard {
  ensureProjectShape(project);
  const aging: ActionAging = {
    open: project.actions.filter((a) => a.status !== 'closed').length,
    overdue: project.actions.filter((a) => a.status === 'overdue').length,
    dueSoon: dueSoonCount(project),
    closed: project.actions.filter((a) => a.status === 'closed').length,
  };
  return {
    health: project.health,
    evidenceCompleteness: evidenceCompleteness(project),
    packCompleteness: packCompleteness(project),
    ddProgress: project.assessments.map((a) => {
      const p = assessmentProgress(a);
      return { id: a.id, name: a.name, status: a.status, percent: p.percent, checkDone: p.checkDone, checkTotal: p.checkTotal };
    }),
    actionAging: aging,
    changeSincePrevious: project.assessments
      .filter((a) => a.priorAssessmentId)
      .map((a) => {
        const diff = changesSincePrevious(project, a.id);
        return {
          assessmentId: a.id,
          assessmentName: a.name,
          priorName: diff?.priorName,
          newCount: diff?.newFindings.length ?? 0,
          closedCount: diff?.closedFindings.length ?? 0,
          unresolvedCount: diff?.unresolvedFindings.length ?? 0,
        };
      }),
    capabilities: computeCapabilityRuns(project),
  };
}

function pushDraft(project: DdProject, draft: Omit<AiDraft, 'id' | 'createdAt' | 'status'> & { status?: AiDraftStatus }): AiDraft {
  const at = nowIso();
  const record: AiDraft = {
    id: id('aid'),
    status: draft.status ?? 'draft',
    kind: draft.kind,
    title: draft.title,
    body: draft.body,
    source: draft.source,
    proposedPayload: draft.proposedPayload,
    createdAt: at,
    createdBy: draft.createdBy,
  };
  project.aiDrafts.push(record);
  return record;
}

export function proposeAiDrafts(project: DdProject, actor = 'operator', source: AiDraft['source'] = 'rule'): AiDraft[] {
  ensureProjectShape(project);
  const created: AiDraft[] = [];
  const gaps = project.evidence.filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested').slice(0, 8);
  const material = project.findings.filter((f) => (f.severity === 'high' || f.severity === 'critical') && (f.status === 'open' || f.status === 'under_review'));
  const pending = project.assessments.flatMap((a) =>
    a.scopes.flatMap((s) => s.checks.filter((c) => c.result === 'pending' || c.result === 'missing_evidence').map((c) => ({ a, s, c }))),
  );

  if (gaps.length) {
    created.push(
      pushDraft(project, {
        kind: 'action',
        title: `Request ${gaps.length} outstanding evidence item(s)`,
        body: gaps.map((g) => `• ${g.title} (${g.status})`).join('\n'),
        source,
        createdBy: actor,
        proposedPayload: {
          title: `Collect outstanding evidence (${gaps.length} items)`,
          kind: 'evidence_request',
          owner: project.owner || actor,
          priority: 'high',
          description: gaps.map((g) => g.title).join('; '),
        } satisfies CreateActionInput,
      }),
    );
  }

  for (const finding of material.slice(0, 5)) {
    const already = project.risks.some((r) => r.findingIds.includes(finding.id));
    if (already) continue;
    created.push(
      pushDraft(project, {
        kind: 'risk',
        title: `Risk from: ${finding.title}`,
        body: finding.description,
        source,
        createdBy: actor,
        proposedPayload: {
          title: finding.title,
          category: finding.discipline === 'hse' ? 'safety' : finding.discipline === 'legal' ? 'legal' : 'operational',
          cause: finding.description,
          impactType: finding.discipline === 'cost_quantity' ? 'cost' : finding.discipline === 'schedule_progress' ? 'time' : 'operational',
          probability: 'possible',
          impactScore: finding.severity === 'critical' ? 5 : 4,
          materiality: finding.severity,
          findingIds: [finding.id],
        } satisfies CreateRiskInput,
      }),
    );
  }

  if (pending.length) {
    const sample = pending.slice(0, 6);
    created.push(
      pushDraft(project, {
        kind: 'check_comment',
        title: `${pending.length} checks still pending or missing evidence`,
        body: sample.map(({ a, c }) => `• ${a.name}: ${c.title}`).join('\n'),
        source,
        createdBy: actor,
        proposedPayload: { checkIds: sample.map(({ c }) => c.id) },
      }),
    );
  }

  const recommended = recommendedDdTypes(project.currentStage).filter((d) => !project.assessments.some((a) => a.ddType === d.key && a.status !== 'archived'));
  created.push(
    pushDraft(project, {
      kind: 'orchestrator_plan',
      title: `DD plan at ${LIFECYCLE_STAGE_LABEL[project.currentStage]}`,
      body: [
        `Stage: ${LIFECYCLE_STAGE_LABEL[project.currentStage]}.`,
        `Active DDs: ${project.assessments.filter((a) => a.status === 'active' || a.status === 'in_review').length}.`,
        recommended.length ? `Recommended templates not yet running: ${recommended.map((d) => d.label).join(', ')}.` : 'All recommended templates for this stage have been instantiated.',
        `${gaps.length} evidence gaps, ${material.length} high/critical open findings, ${pending.length} unfinished checks.`,
        'AI is optional. Accepting this plan does not start a model run; commit writes human-reviewed records only.',
      ].join('\n'),
      source,
      createdBy: actor,
      proposedPayload: {
        recommendedDdTypes: recommended.map((d) => d.key),
        evidenceGapIds: gaps.map((g) => g.id),
      },
    }),
  );

  touch(project);
  return created;
}

export function reviewAiDraft(
  project: DdProject,
  draftId: string,
  status: Extract<AiDraftStatus, 'in_review' | 'accepted' | 'rejected'>,
  reviewNote?: string,
  actor = 'operator',
): AiDraft {
  ensureProjectShape(project);
  const draft = project.aiDrafts.find((d) => d.id === draftId);
  if (!draft) throw new Error('Draft not found');
  if (draft.status === 'committed') throw new Error('Committed drafts cannot be re-reviewed');
  draft.status = status;
  draft.reviewNote = reviewNote;
  draft.reviewedAt = nowIso();
  draft.reviewedBy = actor;
  touch(project);
  return draft;
}

export function commitAiDraft(project: DdProject, draftId: string, actor = 'operator'): { draft: AiDraft; recordId?: string } {
  ensureProjectShape(project);
  const draft = project.aiDrafts.find((d) => d.id === draftId);
  if (!draft) throw new Error('Draft not found');
  if (draft.status === 'rejected') throw new Error('Rejected drafts cannot be committed');
  if (draft.status === 'committed') return { draft, recordId: draft.committedRecordId };

  let recordId: string | undefined;
  const payload = draft.proposedPayload ?? {};
  if (draft.kind === 'finding') {
    const record = addFinding(project, payload as unknown as CreateFindingInput, actor);
    recordId = record.id;
  } else if (draft.kind === 'risk') {
    const record = addRisk(project, payload as unknown as CreateRiskInput, actor);
    recordId = record.id;
  } else if (draft.kind === 'action') {
    const record = addAction(project, payload as unknown as CreateActionInput, actor);
    recordId = record.id;
  } else if (draft.kind === 'decision') {
    const record = addDecision(project, payload as unknown as CreateDecisionInput, actor);
    recordId = record.id;
  }

  draft.status = 'committed';
  draft.committedRecordId = recordId;
  draft.reviewedAt = nowIso();
  draft.reviewedBy = actor;
  touch(project);
  project.audit.push({
    id: id('aud'),
    at: nowIso(),
    actor,
    action: 'commit_ai_draft',
    entityType: 'ai_draft',
    entityId: draft.id,
    newValue: recordId,
    reason: draft.kind,
  });
  return { draft, recordId };
}

export const AI_DRAFT_KINDS: AiDraftKind[] = [
  'finding',
  'risk',
  'action',
  'decision',
  'report_section',
  'check_comment',
  'orchestrator_plan',
];
