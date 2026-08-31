/**
 * Today's next move on a DD file.
 *
 * A wizard dump of every gap is not how diligence is sat. One check, one pack
 * item, one material finding — then the registers already hold the rest.
 */

import { LIFECYCLE_STAGE_LABEL, SCOPE_LABEL } from './catalogs';
import type { ProjectCockpitPane } from './cockpit';
import {
  assessmentProgress,
  ensureProjectShape,
  isPackEvidenceTitle,
  packCompleteness,
  packEvidence,
  recommendedDdTypes,
} from './operations';
import type {
  ChatProposal,
  CheckInstance,
  CreateActionInput,
  CreateAssessmentInput,
  CreateAssetInput,
  DdAssessment,
  DdProject,
  EvidenceRecord,
  FindingRecord,
  ReportKind,
  ScopeInstance,
} from './types';
import { isoDaysFromNow } from './sitting';
import {
  createChatProposal,
  recommendedDdTypesForProject,
  suggestedAssets,
} from './wizard';

const SCOPE_PRIORITY: Array<ScopeInstance['scopeKey']> = [
  'legal',
  'land_site',
  'regulatory',
  'technical',
  'hse',
  'quality',
  'cost_quantity',
  'schedule_progress',
  'procurement',
  'financial_appraisal',
  'commercial_market',
  'esg',
  'condition_operations',
  'indicative_valuation',
];

function gapStatus(e: { status: string }): boolean {
  return e.status === 'expected' || e.status === 'missing' || e.status === 'requested';
}

export function materialOpenFindings(project: DdProject): FindingRecord[] {
  return project.findings.filter(
    (f) => (f.status === 'open' || f.status === 'under_review') && (f.severity === 'high' || f.severity === 'critical'),
  );
}

export function unevidencedFindings(project: DdProject): FindingRecord[] {
  return materialOpenFindings(project).filter((f) => f.evidenceIds.length === 0);
}

function workingAssessments(project: DdProject): DdAssessment[] {
  return project.assessments.filter((a) => a.status === 'draft' || a.status === 'active' || a.status === 'in_review');
}

function scopeRank(key: ScopeInstance['scopeKey']): number {
  const i = SCOPE_PRIORITY.indexOf(key);
  return i === -1 ? 99 : i;
}

export interface PendingCheck {
  assessment: DdAssessment;
  scope: ScopeInstance;
  check: CheckInstance;
}

export function nextPendingCheck(project: DdProject, preferDiscipline?: ScopeInstance['scopeKey']): PendingCheck | undefined {
  const rows: PendingCheck[] = [];
  for (const assessment of workingAssessments(project)) {
    for (const scope of assessment.scopes) {
      for (const check of scope.checks) {
        if (check.result === 'pending') rows.push({ assessment, scope, check });
      }
    }
  }
  rows.sort((a, b) => {
    if (preferDiscipline) {
      const ad = a.scope.scopeKey === preferDiscipline ? 0 : 1;
      const bd = b.scope.scopeKey === preferDiscipline ? 0 : 1;
      if (ad !== bd) return ad - bd;
    }
    const sr = scopeRank(a.scope.scopeKey) - scopeRank(b.scope.scopeKey);
    if (sr !== 0) return sr;
    return a.check.title.localeCompare(b.check.title);
  });
  return rows[0];
}

function packGapForCheck(project: DdProject, check: CheckInstance): EvidenceRecord | undefined {
  const expected = check.expectedEvidence.map((t) => t.toLowerCase());
  return project.evidence.find(
    (e) =>
      gapStatus(e)
      && (check.evidenceIds.includes(e.id)
        || e.checkIds.includes(check.id)
        || expected.some((t) => e.title.toLowerCase().includes(t) || t.includes(e.title.toLowerCase()))
        || (isPackEvidenceTitle(e.title) && expected.some((t) => isPackEvidenceTitle(t)))),
  );
}

export type NextStepKind =
  | 'add_asset'
  | 'start_dd'
  | 'record_check'
  | 'prove_finding'
  | 'overdue'
  | 'report'
  | 'idle';

export interface NextStep {
  kind: NextStepKind;
  title: string;
  why: string;
  text: string;
  proposals: ChatProposal[];
  pane: ProjectCockpitPane;
  extra?: { ddId?: string; scopeId?: string; checkId?: string; node?: string };
  citedEvidenceIds: string[];
  citedNodeIds: string[];
}

function spoken(project: DdProject, title: string, why: string, how: string): string {
  return [
    `Today on ${project.name} (${project.reference}).`,
    title,
    why,
    how,
  ].join('\n');
}

function requestOne(
  project: DdProject,
  actor: string,
  title: string,
  rationale: string,
  extra: {
    evidenceId?: string;
    findingId?: string;
    assessmentId?: string;
    scopeId?: string;
    checkId?: string;
    owner?: string;
  },
): ChatProposal {
  return createChatProposal(
    'request_evidence',
    title,
    rationale,
    'Writes one collection action. Attach the file in chat when you have it — nothing bulk-requests the library.',
    {
      title,
      kind: 'evidence_request',
      owner: extra.owner || project.owner || actor,
      priority: 'high',
      dueDate: isoDaysFromNow(14),
      description: rationale,
      assessmentId: extra.assessmentId,
      scopeId: extra.scopeId,
      checkId: extra.checkId,
    } satisfies CreateActionInput & Record<string, unknown>,
    actor,
    {
      citedEvidenceIds: extra.evidenceId ? [extra.evidenceId] : undefined,
      citedNodeIds: [extra.findingId, extra.checkId, extra.scopeId].filter((id): id is string => Boolean(id)),
    },
  );
}

/** One pending AI draft as a chat card — not a bulk commit of the library. */
export function oneDraftReviewCard(project: DdProject, actor = 'operator'): ChatProposal | undefined {
  const pending = project.aiDrafts.filter((d) => d.status === 'draft' || d.status === 'in_review' || d.status === 'accepted');
  const first = pending[0];
  if (!first) return undefined;
  const more = pending.length - 1;
  return createChatProposal(
    'commit_draft',
    `Commit “${first.title}”`,
    more
      ? `${first.kind} draft. ${more} more stay in the drafts register — this card commits one.`
      : `${first.kind} draft awaiting review. Nothing writes until you approve.`,
    'Writes this draft into the matching register. Other drafts stay proposed.',
    { draftIds: [first.id] },
    actor,
    { citedNodeIds: [first.id] },
  );
}

/** Unevidenced material findings → request cards. Never records a check. */
export function findingCriticSitting(
  project: DdProject,
  actor = 'operator',
): {
  text: string;
  proposals: ChatProposal[];
  pane: ProjectCockpitPane;
  citedNodeIds: string[];
} {
  ensureProjectShape(project);
  const unproven = unevidencedFindings(project).slice(0, 2);
  if (!unproven.length) {
    return {
      text: spoken(
        project,
        'No unevidenced material findings.',
        'High and critical open findings already have an evidence id.',
        'Ask Guide me for the next check.',
      ),
      proposals: [],
      pane: 'findings',
      citedNodeIds: [],
    };
  }
  const cards = unproven.map((f) =>
    requestOne(project, actor, `Attach proof to “${f.title}”`, `${f.severity} finding with no evidence id — an unevidenced judgement until a document is linked.`, {
      findingId: f.id,
      owner: project.owner || actor,
    }),
  );
  return {
    text: [
      `Critic on ${project.name} (${project.reference}).`,
      `${unproven.length} material finding(s) have no evidence id. That is an unevidenced judgement, not a register fact.`,
      unproven.map((f) => `• ${f.title} [${f.severity}] — no proof linked.`).join('\n'),
      'Approve a card to open a collection action. Recording a check still happens in the check, by a person.',
    ].join('\n'),
    proposals: cards,
    pane: 'findings',
    citedNodeIds: unproven.map((f) => f.id),
  };
}

export function projectNextStep(project: DdProject, actor = 'operator'): NextStep {
  ensureProjectShape(project);
  const owner = project.owner || actor;

  if (project.assets.length === 0) {
    const hint = suggestedAssets(project)[0] ?? { name: 'Land parcel', assetType: 'Land' };
    const card = createChatProposal(
      'add_asset',
      `Add asset: ${hint.name}`,
      `A ${project.type.replaceAll('_', ' ')} file starts with the thing you are diligencing — usually the land, then the buildings.`,
      'Creates one asset. Later DDs can target it.',
      { name: hint.name, assetType: hint.assetType } satisfies CreateAssetInput,
      actor,
    );
    return {
      kind: 'add_asset',
      title: `Add ${hint.name}`,
      why: 'There is no asset tree yet. Diligence needs a target.',
      text: spoken(
        project,
        `Add ${hint.name} (${hint.assetType}).`,
        'There is no asset tree yet.',
        'Approve the card, or say “add Tower A”. Then we start one DD.',
      ),
      proposals: [card],
      pane: 'assets',
      citedEvidenceIds: [],
      citedNodeIds: [],
    };
  }

  const working = workingAssessments(project);
  if (working.length === 0) {
    const rec = recommendedDdTypesForProject(project).find((d) => d.key !== 'custom' && d.key !== 'full_project_health')
      ?? recommendedDdTypes(project.currentStage)[0];
    if (rec) {
      const card = createChatProposal(
        'start_dd',
        `Start ${rec.label}`,
        `${rec.purpose} Default scopes: ${rec.defaultScopes.map((k) => SCOPE_LABEL[k]).join(', ')}.`,
        'Instantiates one assessment and its checks. Does not run a model.',
        {
          ddType: rec.key,
          owner,
          targetType: 'project',
          name: rec.label,
        } satisfies CreateAssessmentInput,
        actor,
      );
      return {
        kind: 'start_dd',
        title: `Start ${rec.label}`,
        why: `Stage is ${LIFECYCLE_STAGE_LABEL[project.currentStage]}. No assessment is running.`,
        text: spoken(
          project,
          `Start ${rec.label}.`,
          `Stage is ${LIFECYCLE_STAGE_LABEL[project.currentStage]}; nothing is instantiated yet.`,
          'Approve the card. That is the only DD to start this sitting — not every template.',
        ),
        proposals: [card],
        pane: 'dd',
        citedEvidenceIds: [],
        citedNodeIds: [],
      };
    }
  }

  const unproven = unevidencedFindings(project).sort((a, b) => {
    if (a.severity === 'critical' && b.severity !== 'critical') return -1;
    if (b.severity === 'critical' && a.severity !== 'critical') return 1;
    return 0;
  });
  const pending = nextPendingCheck(project, unproven[0]?.discipline);

  if (pending) {
    const gap = packGapForCheck(project, pending.check);
    const finding = unproven.find((f) => f.discipline === pending.scope.scopeKey) ?? unproven[0];
    const why = finding
      ? `Open ${finding.severity} finding “${finding.title}” has no proof.`
      : gap
        ? `Pack item “${gap.title}” is still ${gap.status}.`
        : `${assessmentProgress(pending.assessment).checkDone}/${assessmentProgress(pending.assessment).checkTotal} checks done on ${pending.assessment.name}.`;
    const cards: ChatProposal[] = [];
    const owner = pending.assessment.owner || project.owner || actor;
    if (gap) {
      cards.push(
        requestOne(project, actor, `Request ${gap.title}`, `${gap.title} is ${gap.status}. Needed for “${pending.check.title}”.`, {
          evidenceId: gap.id,
          assessmentId: pending.assessment.id,
          scopeId: pending.scope.id,
          checkId: pending.check.id,
          owner,
        }),
      );
    } else if (finding) {
      cards.push(
        requestOne(project, actor, `Attach proof to “${finding.title}”`, 'Material finding with no evidence id — record the check or file a document against it.', {
          findingId: finding.id,
          assessmentId: pending.assessment.id,
          scopeId: pending.scope.id,
          checkId: pending.check.id,
          owner,
        }),
      );
    }
    const how = cards.length
      ? 'The check is open on the right. Approve the card to put a collection action on the register, or record the result in the check.'
      : 'Record the result in the check on the right. Attach a document in chat if the proof has arrived.';
    return {
      kind: 'record_check',
      title: `${SCOPE_LABEL[pending.scope.scopeKey]} · ${pending.check.title}`,
      why,
      text: spoken(
        project,
        `${SCOPE_LABEL[pending.scope.scopeKey]} · ${pending.check.title} — pending.`,
        why,
        how,
      ),
      proposals: cards.slice(0, 2),
      pane: 'scope',
      extra: { ddId: pending.assessment.id, scopeId: pending.scope.id, checkId: pending.check.id },
      citedEvidenceIds: gap ? [gap.id] : [],
      citedNodeIds: [pending.check.id, pending.scope.id, finding?.id].filter((id): id is string => Boolean(id)),
    };
  }

  if (unproven[0]) {
    const f = unproven[0];
    const card = requestOne(project, actor, `Attach proof to “${f.title}”`, `${f.severity} finding, no evidence linked.`, {
      findingId: f.id,
    });
    return {
      kind: 'prove_finding',
      title: `Prove “${f.title}”`,
      why: 'A material finding without evidence is an unevidenced judgement.',
      text: spoken(
        project,
        `Attach proof to “${f.title}” [${f.severity}].`,
        'It is open and has no evidence id.',
        'Approve the card, or file a document in chat against this finding.',
      ),
      proposals: [card],
      pane: 'findings',
      extra: { node: f.id },
      citedEvidenceIds: [],
      citedNodeIds: [f.id],
    };
  }

  const overdue = project.actions.filter((a) => a.status === 'overdue');
  if (overdue.length) {
    return {
      kind: 'overdue',
      title: `${overdue.length} overdue action(s)`,
      why: overdue[0] ? `Oldest: ${overdue[0].title}.` : '',
      text: spoken(
        project,
        `${overdue.length} overdue action(s).`,
        overdue[0] ? `Start with “${overdue[0].title}”.` : 'Chase owners, then close them.',
        'Open risks & actions. Say “close action …” when it is done.',
      ),
      proposals: [],
      pane: 'risks',
      citedEvidenceIds: [],
      citedNodeIds: overdue.slice(0, 3).map((a) => a.id),
    };
  }

  const material = materialOpenFindings(project);
  if (material.length && !project.reports.some((r) => r.kind === 'red_flag' || r.kind === 'executive_dd')) {
    const kind: ReportKind = material.some((f) => f.severity === 'critical') ? 'red_flag' : 'executive_dd';
    const card = createChatProposal(
      'generate_report',
      kind === 'red_flag' ? 'Generate red-flag report' : 'Generate executive DD report',
      `${material.length} material open finding(s). A report pulls live registers; it does not freeze them.`,
      'Creates a report from current findings, risks, actions and evidence.',
      { kind, generatedBy: owner, assessmentIds: working.map((a) => a.id) },
      actor,
      { citedNodeIds: material.slice(0, 6).map((f) => f.id) },
    );
    return {
      kind: 'report',
      title: card.title,
      why: 'The file has material findings and no live opinion yet.',
      text: spoken(project, card.title, card.rationale, 'Approve the card. The report cites what is on the registers today.'),
      proposals: [card],
      pane: 'reports',
      citedEvidenceIds: [],
      citedNodeIds: material.slice(0, 6).map((f) => f.id),
    };
  }

  const pack = packCompleteness(project);
  const draft = oneDraftReviewCard(project, actor);
  return {
    kind: 'idle',
    title: draft ? draft.title : 'No pending check on an active DD',
    why: pack.missing ? `Pack still missing: ${pack.missingTitles.slice(0, 3).join(', ')}.` : 'Pack items on the register are received.',
    text: spoken(
      project,
      draft ? 'A draft is waiting for review.' : 'Nothing is pending on an active assessment.',
      pack.missing ? `Priority pack still has gaps: ${pack.missingTitles.slice(0, 4).join(', ')}.` : 'Priority pack looks received.',
      draft ? 'Approve the card to commit one draft. Others stay in the drafts register.' : 'Ask a question, attach a document, or open a completed DD to re-check.',
    ),
    proposals: draft ? [draft] : [],
    pane: draft ? 'drafts' : 'overview',
    citedEvidenceIds: packEvidence(project).pack.filter(gapStatus).slice(0, 6).map((e) => e.id),
    citedNodeIds: draft?.citedNodeIds ?? [],
  };
}

export function renderProjectGuide(project: DdProject, actor = 'operator'): {
  text: string;
  citedEvidenceIds: string[];
  citedNodeIds: string[];
} {
  const step = projectNextStep(project, actor);
  return { text: step.text, citedEvidenceIds: step.citedEvidenceIds, citedNodeIds: step.citedNodeIds };
}

