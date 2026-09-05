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
import { runValuationApproaches } from './valuation-run';
import { VALUATION_METHOD_LABEL } from './valuation-model';
import { rule8Summary, type Rule8Summary, type ValuerIdentity } from './ibbi';
import type { CaptureFacts } from './capture';
import type { PhotoObservation } from './photo-observation';
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
import { plural } from './text';

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
  file: { fileName: string; mimeType: string; sizeBytes: number; storageKey: string; capture?: CaptureFacts },
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
    // Only when there is something to say. An empty capture object on every
    // scanned deed would make "no capture facts" and "capture facts we never
    // filled in" indistinguishable, and the register renders those differently.
    ...(file.capture && Object.keys(file.capture).length ? { capture: file.capture } : {}),
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
  const working = runValuationApproaches(project, locality ?? undefined);
  const { reconciliation } = working;

  const relied = project.evidence.filter((e) => e.used);
  const considered = project.evidence.filter((e) => e.considered && !e.used);
  const gaps = project.evidence.filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested');
  const legalFindings = project.findings.filter((f) => (f.discipline === 'legal' || f.discipline === 'regulatory') && f.status !== 'closed' && f.status !== 'rejected');

  const cost = working.runs.find((r) => r.method === 'depreciated_replacement_cost');
  const comparable = working.runs.find((r) => r.method === 'comparable_rate');

  return {
    localityId: locality?.id,
    localityLabel: locality ? `${locality.locality}, ${locality.city}` : undefined,
    // Kept for the readers that predate the working. Each is the amount of the
    // approach that produced it, or undefined when that approach did not run —
    // never a partial figure standing in for one that failed.
    landValue: cost?.steps.find((s) => s.label === 'Land')?.value,
    buildingReplacement: cost?.steps.find((s) => s.label === 'Less depreciation')?.value,
    comparableValue: comparable?.amount ?? undefined,
    indicatedValue: reconciliation.indicated ?? 0,
    low: reconciliation.low ?? 0,
    high: reconciliation.high ?? 0,
    currency: project.currency,
    working,
    ibbi: {
      instruction: `Indicative decision-support valuation of ${project.name} for internal DD. Intended audience: project owner / investment committee. This is not a certified valuation.`,
      subject: `${project.name}, ${project.location}, ${project.city}. Land ${(project.landAreaSqm ?? 0).toLocaleString() || 'n/a'} sqm, BUA ${(project.builtUpAreaSqm ?? 0).toLocaleString() || 'n/a'} sqm. Valued on ${working.area.value ? `${working.area.value.toLocaleString()} sqm — ${working.area.label}` : 'no recorded area'}. Stage: ${LIFECYCLE_STAGE_LABEL[project.currentStage]}.`,
      dates: {
        valuationDate: nowIso().slice(0, 10),
        evidenceCutoff: nowIso().slice(0, 10),
      },
      basis: 'market_value',
      premise: defaultPremise(project),
      legalPlanningAssumptions: legalFindings.length
        ? legalFindings.map((f) => `${f.severity}: ${f.title}`).join('; ')
        : 'No open legal/planning findings recorded. Absence of findings is not a clean title.',
      approaches: working.runs
        .filter((r) => r.amount !== null)
        .map((r) => ({ approach: r.approach, amount: r.amount!, notes: `${r.formula}. ${r.weightBasis}`, weight: r.weight })),
      /*
       * Three outcomes, three different things to tell somebody.
       *
       * Nothing ran → go and record the inputs. Several ran and disagreed →
       * go and check the one that looks wrong. A figure → here it is with its
       * band. Collapsing the first two into one sentence printed "No approach
       * could be run." over four approaches that had all run.
       */
      reconciliation:
        reconciliation.outcome === 'no_approach_ran'
          ? `No approach could be run. ${reconciliation.skippedMethods.map((m) => `${VALUATION_METHOD_LABEL[m.method]} — ${m.because}`).join('; ')}. Record those inputs on the Indicative valuation scope and run again.`
          : reconciliation.outcome === 'approaches_disagree'
            ? `No figure is given. ${reconciliation.spreadBasis}${reconciliation.skippedMethods.length ? ` Also not run: ${reconciliation.skippedMethods.map((m) => `${VALUATION_METHOD_LABEL[m.method]} (${m.because})`).join('; ')}.` : ''}`
            : `${inr(reconciliation.indicated ?? 0)} (${inr(reconciliation.low ?? 0)}–${inr(reconciliation.high ?? 0)}). ${reconciliation.spreadBasis}${reconciliation.skippedMethods.length ? ` Not run: ${reconciliation.skippedMethods.map((m) => `${VALUATION_METHOD_LABEL[m.method]} (${m.because})`).join('; ')}.` : ''}`,
      caveats: [
        'Indicative only. Not an IBBI-registered valuer’s report and not to be used as certified value.',
        ...(working.runs.some((r) => r.inputs.some((i) => i.source.kind === 'locality'))
          ? ['One or more rates are locality reference medians rather than comparables inspected for this asset. Each is marked on the input it was used for.']
          : []),
        `${gaps.length} evidence gap(s) remain. Relied-upon: ${relied.length}. Considered not used: ${considered.length}.`,
        actor ? `Prepared by ${actor} from live project registers.` : 'Prepared from live project registers.',
      ],
      evidenceReliedUponIds: relied.map((e) => e.id),
      evidenceConsideredIds: considered.map((e) => e.id),
      evidenceGapIds: gaps.map((e) => e.id),
      rule8: {
        // Everything here is DERIVED. The three items a computation cannot
        // supply — the valuer's identity, their conflict disclosure and the
        // date of appointment — stay absent rather than being filled with
        // something plausible, and `rule8Completeness` reports them missing.
        reportedOn: nowIso().slice(0, 10),
        inspections: (project.siteVisits ?? [])
          .filter((v) => v.status === 'completed' || v.status === 'aborted')
          .map((v) => ({
            visitId: v.id,
            visitedOn: v.visitedOn,
            by: v.surveyor,
            // The limitations travel into the valuation, which is the point of
            // Rule 8(3)(f): a value formed without seeing the roof is a value
            // with a hole in it, and the reader has to be able to see the hole.
            limitations: v.limitations.map((l) => l.what),
          })),
        majorFactors: [
          ...working.runs
            .filter((r) => r.amount !== null)
            .map((r) => `${VALUATION_METHOD_LABEL[r.method]}: ${r.weightBasis}`),
          ...working.externalities.applied.map((a) => `${a.label} at ${a.metres} m — ${(a.pct * 100).toFixed(0)}%. ${a.say}`),
          ...(working.reconciliation.skippedMethods.length
            ? [`Not run: ${working.reconciliation.skippedMethods.map((m) => `${VALUATION_METHOD_LABEL[m.method]} (${m.because})`).join('; ')}.`]
            : []),
        ],
        standardsFollowed: [
          'Companies (Registered Valuers and Valuation) Rules 2017, Rule 8 — used as a report-contents checklist.',
          'IBBI Guidelines on Use of Caveats, Limitations and Disclaimers, 2020.',
        ],
        restrictionsOnUse: [
          'Prepared for the project owner and investment committee named in the instruction, for internal due-diligence decisions only.',
          'Not to be relied on by a lender, a court, a tribunal or any third party, and not to be used for any statutory purpose requiring a registered valuer.',
        ],
      },
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

/**
 * The two Rule 8 items nothing can compute: who is signing, and what they hold.
 *
 * Kept as its own operation rather than a field on the run because both are
 * statements a PERSON makes, and the moment either could be defaulted the
 * report would carry a disclosure nobody made. `declaredConflict: false` with
 * an empty list is a positive statement — "I considered this and have none" —
 * and is a different fact from the disclosure being absent, which is why the
 * argument is required rather than optional.
 *
 * Nothing here checks a registration number against IBBI's register. That is a
 * lookup this product does not do, and validating the format alone would give
 * a number an air of having been verified.
 */
export function setValuationValuer(
  project: DdProject,
  runId: string,
  input: {
    valuer: ValuerIdentity;
    declaredConflict: boolean;
    interests?: string[];
    appointedOn?: string;
  },
  actor = 'operator',
): ValuationRun {
  ensureProjectShape(project);
  const run = project.valuationRuns.find((r) => r.id === runId);
  if (!run) throw new Error('Valuation run not found');
  if (!input.valuer.name.trim()) throw new Error('A valuation has to name who is signing it.');
  if (input.declaredConflict && !(input.interests ?? []).length) {
    throw new Error('An interest was declared but not described. Say what it is, or declare none.');
  }

  const at = nowIso();
  run.ibbi.rule8 = {
    ...(run.ibbi.rule8 ?? {}),
    valuer: input.valuer,
    conflict: { declared: input.declaredConflict, interests: input.interests ?? [], statedBy: actor, statedAt: at },
    ...(input.appointedOn ? { appointedOn: input.appointedOn } : {}),
  };
  touch(project, at);
  project.audit.push({
    id: id('aud'),
    at,
    actor,
    action: 'valuation_valuer',
    entityType: 'valuation',
    entityId: run.id,
    newValue: `${input.valuer.name}${input.valuer.registrationNumber ? ` (${input.valuer.registrationNumber})` : ''} · ${input.declaredConflict ? `${(input.interests ?? []).length} interest(s) declared` : 'no interest declared'}`,
  });
  return run;
}

/** Which of the twelve Rule 8(3) items this run answers, computed fresh. */
export function valuationRule8(run: ValuationRun): Rule8Summary {
  return rule8Summary(run.ibbi, run.ibbi.rule8 ?? {});
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

/* ==================================================================== */
/* What a model saw in a photograph                                      */
/* ==================================================================== */

/**
 * File a reading, and raise its defects as cards.
 *
 * Two things happen here and the split between them is the point. The
 * OBSERVATION goes onto the attachment, plainly attributed, where it sits
 * beside the person's caption without ever becoming it. The suggested
 * findings become DRAFTS — the same propose-and-review path a chat proposal
 * or a rule-generated draft takes — so a defect a model spotted in a
 * photograph reaches the findings register by exactly the same road as one it
 * inferred from a deed: a person reads it and accepts it.
 *
 * There is deliberately no option to skip that. A photograph is the input a
 * model reads most confidently and a defect is the conclusion a buyer acts on
 * hardest, and the two together are the last place this product should be
 * making its own entries.
 */
export function recordPhotoObservation(
  project: DdProject,
  evidenceId: string,
  attachmentId: string,
  observation: PhotoObservation,
  actor = 'operator',
): { attachment: EvidenceAttachment; drafts: AiDraft[] } {
  ensureProjectShape(project);
  const evidence = project.evidence.find((e) => e.id === evidenceId);
  const attachment = evidence?.attachments.find((a) => a.id === attachmentId);
  if (!evidence || !attachment) throw new Error('Attachment not found');

  attachment.observation = observation;

  const drafts: AiDraft[] = [];
  for (const suggestion of observation.suggestedFindings) {
    drafts.push(
      pushDraft(project, {
        kind: 'finding',
        title: suggestion.title,
        // Observed and reasoning stay in separate sentences all the way to the
        // card. Merged, they read as one confident statement, and the reviewer
        // loses the only thing that lets them disagree with half of it.
        body: [
          `Seen in ${attachment.fileName}: ${suggestion.observed}`,
          `Why it may matter (the model's reasoning, not a finding): ${suggestion.whyItMayMatter}`,
          `Read by ${observation.model} at confidence ${(suggestion.confidence * 100).toFixed(0)}%.`,
          observation.limits ? `What this photograph does not show: ${observation.limits}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        source: 'model',
        createdBy: actor,
        proposedPayload: {
          title: suggestion.title,
          description: `${suggestion.observed} ${suggestion.whyItMayMatter}`.trim(),
          severity: suggestion.suggestedSeverity,
          // Every photograph-sourced finding lands under technical unless a
          // person moves it. Letting the model pick a discipline would be a
          // second judgement smuggled in behind the first, and the discipline
          // decides which report section it appears in.
          discipline: 'technical',
          evidenceIds: [evidenceId],
        },
      }),
    );
  }

  const at = nowIso();
  evidence.updatedAt = at;
  touch(project, at);
  project.audit.push({
    id: id('aud'),
    at,
    actor,
    action: 'read_photograph',
    entityType: 'attachment',
    entityId: attachment.id,
    newValue: `${observation.subject} · ${plural(observation.notes.length, 'note')} · ${plural(drafts.length, 'card')}`,
  });
  return { attachment, drafts };
}

/** Photographs on the file that no model has read yet. */
export function unreadPhotographs(project: DdProject): Array<{ evidenceId: string; attachment: EvidenceAttachment }> {
  ensureProjectShape(project);
  const out: Array<{ evidenceId: string; attachment: EvidenceAttachment }> = [];
  // A sheet's scan is a plan, not a photograph — the same exemption
  // `captureConcerns` makes, for the same reason.
  const sheetFiles = new Set((project.sheets ?? []).map((sheet) => sheet.attachmentId).filter(Boolean) as string[]);
  for (const evidence of project.evidence) {
    if (evidence.kind === 'drawing' || evidence.kind === 'gis') continue;
    for (const attachment of evidence.attachments) {
      if (!attachment.mimeType.startsWith('image/')) continue;
      if (sheetFiles.has(attachment.id)) continue;
      if (attachment.observation) continue;
      out.push({ evidenceId: evidence.id, attachment });
    }
  }
  return out;
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
