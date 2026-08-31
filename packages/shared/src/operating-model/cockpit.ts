/**
 * Project cockpit — chat, commands, agents, and the orchestrator on DdProject.
 *
 * Person-authored commands (approve, set owner, close this action) stay
 * deterministic. "Guide me" is a named sitting on the same path. Other
 * questions run through the project copilot when a model is configured.
 * Model conclusions stay propose-and-review.
 */

import { LIFECYCLE_STAGE_LABEL } from './catalogs';
import { createValuationRun, proposeAiDrafts, snapshotCapabilities } from './capabilities';
import { proposeProjectScreen, wantsProjectScreen } from './project-screen';
import { ensureProjectShape, packCompleteness, packEvidence, patchRecordStatus, recommendedDdTypes } from './operations';
import type {
  ChatChoice,
  ActionRecord,
  ChatIngestFile,
  ChatProposal,
  ChatProposalKind,
  ChatSideBundle,
  DdProject,
  FindingRecord,
  OrchestratorRun,
  ProjectChatResult,
  ProjectChatTurn,
  RiskRecord,
} from './types';
import {
  buildWizardProposals,
  commitChatProposal,
  interpretConversation,
  matchProposal,
  proposalsFromIngest,
  rejectChatProposal,
  startDdFromQuestion,
  wantsApprove,
  wantsAssets,
  wantsDdTypes,
  wantsProofs,
  wantsReject,
  wantsReport,
  wantsScopes,
  wantsWizard,
  proposeReportCard,
} from './wizard';
import { projectNextStep, materialOpenFindings, unevidencedFindings, findingCriticSitting } from './next-step';
import { detectChatSideIntents, handleChatSides } from './chat-sides';
import { clarifyRecordCommand, clarifySubject, looksLikeCommand, resolveSubject } from './clarify';
import {
  approveAllMeansEveryOpen,
  currentTurnProposals,
  paneForTalk,
  sittingBrief,
  sittingCheckOf,
  sittingFromCitedIds,
  sittingWithField,
  talkSittingFromText,
  withTalkNavigation,
  wantsCritic,
  type CockpitPathExtra,
  type SittingRef,
} from './sitting';

export const PROJECT_COCKPIT_PANES = [
  'overview',
  'assets',
  'dd',
  'scope',
  'evidence',
  'findings',
  'risks',
  'actions',
  'decisions',
  'reports',
  'valuation',
  'graph',
  'drafts',
  'orchestrate',
] as const;

export type ProjectCockpitPane = (typeof PROJECT_COCKPIT_PANES)[number];

export function paneForProposalKind(kind: ChatProposalKind): ProjectCockpitPane {
  if (kind === 'file_evidence') return 'evidence';
  if (kind === 'request_evidence' || kind === 'add_action' || kind === 'open_connector') return 'actions';
  if (kind === 'run_valuation') return 'valuation';
  if (kind === 'run_screen') return 'overview';
  if (kind === 'commit_draft') return 'drafts';
  if (kind === 'snapshot_capabilities') return 'orchestrate';
  if (kind === 'start_dd' || kind === 'add_scope') return 'dd';
  if (kind === 'add_asset' || kind === 'patch_asset') return 'assets';
  if (kind === 'add_finding') return 'findings';
  if (kind === 'add_risk') return 'risks';
  if (kind === 'add_decision') return 'decisions';
  if (kind === 'generate_report') return 'reports';
  return 'overview';
}

function withQuery(path: string, pairs: Array<[string, string | undefined]>): string {
  const parts: string[] = [];
  for (const [key, value] of pairs) {
    if (value) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.length ? `${path}?${parts.join('&')}` : path;
}

export function cockpitPath(
  projectId: string,
  pane: ProjectCockpitPane,
  extra?: CockpitPathExtra,
): string {
  const base = `/projects/${projectId}`;
  switch (pane) {
    case 'overview':
      return base;
    case 'assets':
      return withQuery(`${base}/assets`, [['asset', extra?.assetId]]);
    case 'dd':
      return extra?.ddId ? `${base}/dd/${extra.ddId}` : `${base}/dd`;
    case 'scope': {
      const path =
        extra?.ddId && extra?.scopeId
          ? `${base}/dd/${extra.ddId}/scopes/${extra.scopeId}`
          : extra?.ddId
            ? `${base}/dd/${extra.ddId}`
            : `${base}/dd`;
      return extra?.checkId ? `${path}?check=${encodeURIComponent(extra.checkId)}` : path;
    }
    case 'evidence':
      return withQuery(`${base}/evidence`, [
        ['evidence', extra?.evidenceId],
        ['page', extra?.page],
      ]);
    case 'findings':
      return withQuery(`${base}/findings`, [['finding', extra?.findingId]]);
    case 'risks':
      return withQuery(`${base}/risks`, [
        ['risk', extra?.riskId],
        ['action', extra?.actionId],
      ]);
    case 'actions':
      return withQuery(`${base}/risks`, [
        ['action', extra?.actionId],
        ['risk', extra?.riskId],
      ]);
    case 'decisions':
      return `${base}/decisions`;
    case 'reports':
      return `${base}/reports`;
    case 'valuation':
      return `${base}/valuation`;
    case 'graph':
      return extra?.node ? `${base}/graph?node=${encodeURIComponent(extra.node)}` : `${base}/graph`;
    case 'drafts':
      return `${base}/ai`;
    case 'orchestrate':
      return `${base}/orchestrate`;
  }
}

export function paneFromProjectPath(pathname: string): ProjectCockpitPane {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'projects' || !parts[1]) return 'overview';
  const rest = parts.slice(2);
  const tab = rest[0];
  if (!tab || tab === 'cockpit') return 'overview';
  if (tab === 'dd' && rest[2] === 'scopes') return 'scope';
  if (tab === 'dd') return 'dd';
  if (tab === 'ai') return 'drafts';
  if ((PROJECT_COCKPIT_PANES as readonly string[]).includes(tab)) return tab as ProjectCockpitPane;
  return 'overview';
}

export function isProjectCockpitPane(value: string | null | undefined): value is ProjectCockpitPane {
  return Boolean(value && (PROJECT_COCKPIT_PANES as readonly string[]).includes(value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  const uuid = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function turn(role: ProjectChatTurn['role'], text: string, extra: Partial<ProjectChatTurn> = {}): ProjectChatTurn {
  return {
    id: id('cht'),
    role,
    text,
    at: nowIso(),
    citedEvidenceIds: extra.citedEvidenceIds ?? [],
    citedNodeIds: extra.citedNodeIds,
    toolCalls: extra.toolCalls,
    choices: extra.choices,
    refusedForLackOfEvidence: extra.refusedForLackOfEvidence,
    proposalIds: extra.proposalIds,
  };
}

function appendTurns(project: DdProject, user: ProjectChatTurn, assistant: ProjectChatTurn): void {
  project.conversation.push(user, assistant);
  project.updatedAt = assistant.at;
}

const NAV_RULES: Array<{ pane: ProjectCockpitPane; test: (q: string) => boolean }> = [
  { pane: 'overview', test: (q) => /\bgis\b|\bmap overlay\b|\bosm overlay\b/.test(q) },
  { pane: 'graph', test: (q) => /\b(knowledge\s+)?graph\b|\bnodes?\b|\blinks?\b/.test(q) },
  { pane: 'actions', test: (q) => /\bactions?\b|\boverdue\b|\btodos?\b/.test(q) },
  { pane: 'drafts', test: (q) => /\bdrafts?\b|\bai drafts?\b|\bproposed drafts?\b/.test(q) },
  { pane: 'evidence', test: (q) => /\bevidence\b|\bdocuments?\b|\bfiles?\b|\bgaps?\b/.test(q) },
  { pane: 'valuation', test: (q) => /\bvaluations?\b|\bworth\b|\bindicated value\b|\bindicative value\b/.test(q) },
  { pane: 'orchestrate', test: (q) => /\borchestrat/.test(q) },
  { pane: 'findings', test: (q) => /\bfindings?\b/.test(q) },
  { pane: 'risks', test: (q) => /\brisks?\b/.test(q) },
  { pane: 'decisions', test: (q) => /\bdecisions?\b/.test(q) },
  { pane: 'reports', test: (q) => /\breports?\b/.test(q) },
  { pane: 'assets', test: (q) => /\bassets?\b|\btowers?\b/.test(q) },
  { pane: 'dd', test: (q) => /\bdue diligence\b|\bdd\b|\bchecks?\b|\bassessments?\b|\bscopes?\b/.test(q) },
  { pane: 'overview', test: (q) => /\boverview\b|\bwork\b|\bbriefing\b/.test(q) },
];

function wantsNavigate(q: string): boolean {
  return /^(open|show|go to|switch to|take me|see|view)\b/.test(q) || /\b(pane|register|canvas)\b/.test(q);
}

function wantsPersonCapability(q: string): boolean {
  const ql = q.toLowerCase();
  if (/\borchestrat/.test(ql) && !/^(open|show|go to|switch to|see|view)\b/.test(ql)) return true;
  if (/\b(run|compute|start)\b/.test(ql) && /\bvaluat/.test(ql)) return true;
  if (/\bpropose\b/.test(ql) && /\bdrafts?\b/.test(ql)) return true;
  if (wantsProjectScreen(q)) return true;
  return false;
}

/**
 * Person-authored commands and facts stay on the deterministic wizard.
 * "Guide me" / next-step is a named sitting — also deterministic — so a model
 * cannot dump the evidence library in its place.
 */
export function wantsDeterministicProjectChat(
  project: DdProject,
  question: string,
  options: { ingest?: ChatIngestFile[]; sitting?: SittingRef } = {},
): boolean {
  if (options.ingest?.length) return true;
  const q = question.trim();
  const ql = q.toLowerCase();
  if (!q) return true;
  if (wantsApprove(ql) || wantsReject(ql)) return true;
  if (wantsWizard(q)) return true;
  if (wantsCritic(q)) return true;
  if (startDdFromQuestion(project, q, 'probe')) return true;
  const interpreted = interpretConversation(project, q, 'probe');
  if (interpreted.imperative && interpreted.proposals.length) return true;
  if (/\b(close|complete|done|finish)\b/.test(ql) && /\baction\b/.test(ql)) return true;
  if (/\b(close|resolve)\b/.test(ql) && /\bfinding\b/.test(ql)) return true;
  if (/\b(mitigate|close|accept)\b/.test(ql) && /\brisk\b/.test(ql) && !wantsApprove(ql)) return true;
  if (detectChatSideIntents(q, options.sitting, project).length) return true;
  if (wantsPersonCapability(q)) return true;
  if (wantsNavigate(ql) || NAV_RULES.some((r) => r.test(ql) && /^(open|show|go to|switch to|take me|see|view)\b/.test(ql))) {
    return true;
  }
  const named = talkSittingFromText(project, q);
  if (
    named
    && (named.kind === 'check' || named.kind === 'scope' || named.kind === 'dd')
    && q.length < 80
    && !/\b(add|start|set|request|create|close|assign|run|compute)\b/i.test(ql)
  ) {
    return true;
  }
  return false;
}

export function applyProjectAgentTurn(
  project: DdProject,
  question: string,
  agent: {
    text: string;
    proposals: ChatProposal[];
    /** Options the model offered instead of guessing. Carried onto the turn. */
    choices?: ChatChoice[];
    navigations: Array<{ target: string } & CockpitPathExtra>;
    toolCalls?: ProjectChatTurn['toolCalls'];
    citedEvidenceIds?: string[];
    citedNodeIds?: string[];
  },
): ProjectChatResult {
  ensureProjectShape(project);
  const userTurn = turn('user', question.trim());
  const offered: ChatProposal[] = [];
  const openTitles = new Set(project.chatProposals.filter((p) => p.status === 'proposed').map((p) => p.title));
  for (const item of agent.proposals) {
    if (openTitles.has(item.title)) continue;
    project.chatProposals.push(item);
    offered.push(item);
    openTitles.add(item.title);
  }
  const highlightIds = [
    ...new Set(offered.flatMap((p) => [...(p.citedNodeIds ?? []), ...(p.citedEvidenceIds ?? [])])),
  ];
  const assistantTurn = turn('assistant', agent.text, {
    choices: agent.choices?.length ? agent.choices : undefined,
    citedEvidenceIds: [...new Set(agent.citedEvidenceIds ?? [])],
    citedNodeIds: agent.citedNodeIds ? [...new Set(agent.citedNodeIds)] : undefined,
    toolCalls: agent.toolCalls,
    proposalIds: offered.map((p) => p.id),
  });
  appendTurns(project, userTurn, assistantTurn);
  const talk = sittingWithField(
    project,
    talkSittingFromText(project, question)
      ?? sittingFromCitedIds(project, [...(agent.citedNodeIds ?? []), ...(agent.citedEvidenceIds ?? []), ...highlightIds]),
  );
  const navigations = withTalkNavigation(project, agent.navigations, talk);
  if (talk) highlightIds.push(...talk.highlightIds);
  return {
    userTurn,
    assistantTurn,
    commands: [],
    navigations,
    proposals: offered,
    highlightIds: [...new Set(highlightIds)],
  };
}

function quotedNeedle(question: string): string | null {
  const m = question.match(/["“]([^"”]+)["”]/);
  return m ? m[1].trim().toLowerCase() : null;
}

function matchTitle<T extends { title: string }>(rows: T[], question: string): T | undefined {
  const quoted = quotedNeedle(question);
  if (quoted) {
    return rows.find((r) => r.title.toLowerCase().includes(quoted));
  }
  const q = question.toLowerCase();
  let best: T | undefined;
  let bestScore = 0;
  for (const row of rows) {
    const title = row.title.toLowerCase();
    if (title.length < 4) continue;
    if (q.includes(title)) {
      if (title.length > bestScore) {
        best = row;
        bestScore = title.length;
      }
      continue;
    }
    const tokens = title.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
    const hits = tokens.filter((t) => q.includes(t)).length;
    if (hits >= 2 || (hits === 1 && tokens.length === 1)) {
      const score = hits * 8;
      if (score > bestScore) {
        best = row;
        bestScore = score;
      }
    }
  }
  return best;
}

export function projectRegisterBriefing(project: DdProject, viewContext?: string): string {
  ensureProjectShape(project);
  const next = projectNextStep(project);
  const pack = packCompleteness(project);
  const material = materialOpenFindings(project);
  const unproven = unevidencedFindings(project);
  const overdue = project.actions.filter((a) => a.status === 'overdue');
  const openActions = project.actions.filter((a) => a.status !== 'closed');
  const openRisks = project.risks.filter((r) => r.status !== 'closed' && r.status !== 'accepted');
  const latestVal = project.valuationRuns.filter((r) => r.status !== 'superseded').at(-1);
  const pendingDrafts = project.aiDrafts.filter((d) => d.status === 'draft' || d.status === 'in_review' || d.status === 'accepted');

  const lines = [
    `Today: ${next.title}. ${next.why}`,
    `Project ${project.reference} — ${project.name}. Stage ${LIFECYCLE_STAGE_LABEL[project.currentStage]}; health ${project.health}.`,
    viewContext ? `Reader is looking at: ${viewContext}.` : null,
    `Pack completeness: ${pack.percent}% (${pack.received}/${pack.total} core items${pack.missing ? `; still missing ${pack.missingTitles.slice(0, 4).join(', ')}` : ''}). Library completeness is a separate long-tail figure.`,
    material.length
      ? `Material open findings (${material.length}): ${material
          .slice(0, 4)
          .map((f) => `${f.title} [${f.severity}]${f.evidenceIds.length === 0 ? ' — unevidenced' : ''}`)
          .join('; ')}.`
      : 'No high or critical open findings.',
    unproven.length ? `${unproven.length} material finding(s) have no evidence id.` : null,
    openRisks.length
      ? `Open risks (${openRisks.length}): ${openRisks
          .slice(0, 4)
          .map((r) => r.title)
          .join('; ')}.`
      : 'No open risks.',
    openActions.length
      ? `Open actions: ${openActions.length} (${overdue.length} overdue).`
      : 'No open actions.',
    latestVal
      ? `Latest indicative valuation: ${project.currency} ${Math.round(latestVal.indicatedValue).toLocaleString()} (${latestVal.ibbi.premise}, ${latestVal.signOff.replaceAll('_', ' ')}). Not a certified IBBI certificate.`
      : 'No valuation run yet.',
    pendingDrafts.length
      ? `${pendingDrafts.length} AI draft(s) awaiting review/commit. Nothing lands in a register until a person commits.`
      : null,
    'Chat commands work without a model. Model conclusions stay propose-and-review.',
  ];
  return lines.filter(Boolean).join('\n');
}

export function runProjectOrchestrator(project: DdProject, actor = 'operator'): OrchestratorRun {
  ensureProjectShape(project);
  const drafts = proposeAiDrafts(project, actor, 'rule');
  snapshotCapabilities(project, actor);
  const gaps = project.evidence.filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested');
  const openFindings = project.findings.filter((f) => f.status === 'open' || f.status === 'under_review');
  const recommended = recommendedDdTypes(project.currentStage)
    .filter((d) => !project.assessments.some((a) => a.ddType === d.key && a.status !== 'archived'))
    .map((d) => d.key);
  const plan = drafts.find((d) => d.kind === 'orchestrator_plan');
  const run: OrchestratorRun = {
    id: id('orc'),
    at: nowIso(),
    actor,
    summary:
      plan?.title ??
      `Orchestrator proposed ${drafts.length} draft(s) from live registers. Review before anything writes a finding or action.`,
    recommendedDdTypes: recommended,
    evidenceGapCount: gaps.length,
    openFindingCount: openFindings.length,
    draftIds: drafts.map((d) => d.id),
    source: 'rule',
  };
  project.orchestratorRuns.push(run);
  return run;
}

function briefingAnswer(project: DdProject, viewContext?: string): Pick<ProjectChatTurn, 'text' | 'citedEvidenceIds' | 'citedNodeIds'> {
  const pack = packCompleteness(project);
  const next = projectNextStep(project);
  const material = materialOpenFindings(project);
  return {
    text: projectRegisterBriefing(project, viewContext),
    citedEvidenceIds: packEvidence(project).pack.filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested').slice(0, 8).map((g) => g.id),
    citedNodeIds: [...(next.citedNodeIds ?? []), ...material.slice(0, 8).map((f) => f.id)],
  };
}

export function applyProjectChat(
  project: DdProject,
  question: string,
  options: { actor?: string; viewContext?: string; ingest?: ChatIngestFile[]; sides?: ChatSideBundle; sitting?: SittingRef } = {},
): ProjectChatResult {
  ensureProjectShape(project);
  const actor = options.actor ?? 'operator';
  const q = question.trim() || (options.ingest?.length ? 'I attached documents' : '');
  const ql = q.toLowerCase();
  const userTurn = turn('user', q);
  const commands: string[] = [];
  const navigations: ProjectChatResult['navigations'] = [];
  let offered: ChatProposal[] = [];
  const highlightIds: string[] = [];

  const navigate = (
    pane: ProjectCockpitPane,
    label: string,
    extra?: CockpitPathExtra,
  ) => {
    navigations.push({ target: pane, ...extra });
    if (label) commands.push(label);
  };

  const extrasFromPayload = (payload: Record<string, unknown> | undefined) => {
    if (!payload) return undefined;
    const checkFromList = Array.isArray(payload.checkIds) ? payload.checkIds.find((id): id is string => typeof id === 'string') : undefined;
    const extra = {
      ddId: typeof payload.assessmentId === 'string' ? payload.assessmentId : undefined,
      scopeId: typeof payload.scopeId === 'string' ? payload.scopeId : undefined,
      checkId: typeof payload.checkId === 'string' ? payload.checkId : checkFromList,
    };
    if (!extra.ddId && !extra.scopeId && !extra.checkId) return undefined;
    return extra;
  };

  const offer = (rows: ChatProposal[]) => {
    const openTitles = new Set(project.chatProposals.filter((p) => p.status === 'proposed').map((p) => p.title));
    const fresh = rows.filter((p) => !openTitles.has(p.title));
    for (const p of fresh) project.chatProposals.push(p);
    offered = fresh;
    return fresh;
  };

  let assistantText = '';
  let choices: ChatChoice[] | undefined;
  let toolCalls: ProjectChatTurn['toolCalls'];
  let citedEvidenceIds: string[] = [];
  let citedNodeIds: string[] | undefined;

  const openActions = () => project.actions.filter((a) => a.status !== 'closed');
  const openFindings = () => project.findings.filter((f) => f.status !== 'closed' && f.status !== 'rejected');
  const openRisks = () => project.risks.filter((r) => r.status !== 'closed' && r.status !== 'accepted');

  const isShow = wantsNavigate(ql);
  /*
   * A command aimed at a record on the register — "close the litigation
   * finding", "mitigate the drainage risk". These are handled further down,
   * but the connector/side-intent branch sits above them and matches on topic
   * words alone, so "close the litigation finding" was answered with eCourts
   * portal routes: a real answer to a question nobody asked, while the
   * finding stayed open. Naming it here lets the side branch stand aside for
   * an instruction about a record we already hold.
   */
  const registerRecordCommand =
    (/\b(close|complete|done|finish)\b/.test(ql) && /\baction\b/.test(ql))
    || (/\b(close|resolve)\b/.test(ql) && /\bfinding\b/.test(ql))
    || (/\b(mitigate|close|accept)\b/.test(ql) && /\brisk\b/.test(ql));
  const recordCommand =
    registerRecordCommand || (looksLikeCommand(q) && /\b(check|scope|assessment|dd)\b/.test(ql));
  const runOrchestrate = /\borchestrat/.test(ql) && !/^(open|show|go to|switch to|see|view)\b/.test(ql);
  const proposeDrafts = /\bpropose\b/.test(ql) && /\bdrafts?\b/.test(ql);
  const runValuation = /\b(run|compute|start)\b/.test(ql) && /\bvaluat/.test(ql) && !wantsProjectScreen(q);
  const ingest = options.ingest ?? [];

  if (ingest.length) {
    const prefer = options.sitting;
    const rows = offer(proposalsFromIngest(project, ingest, actor, prefer));
    assistantText = [
      `Read ${ingest.length} file(s). Nothing is filed until you approve a card.`,
      rows.map((p) => `• ${p.title}\n  ${p.rationale}`).join('\n'),
      'Approve a card, or say “approve all”.',
    ].join('\n');
    citedEvidenceIds = rows.flatMap((p) => p.citedEvidenceIds ?? []);
    citedNodeIds = rows.flatMap((p) => p.citedNodeIds ?? []);
    highlightIds.push(...citedEvidenceIds);
    toolCalls = [{ name: 'ingest', summary: `Classified ${ingest.length} file(s)` }];
    const sitting = sittingCheckOf(project, prefer) ?? sittingCheckOf(project, extrasFromPayload(rows[0]?.payload as Record<string, unknown>));
    if (sitting) {
      navigate('scope', 'Opened check', { ddId: sitting.assessment.id, scopeId: sitting.scope.id, checkId: sitting.check.id });
    } else {
      navigate('evidence', 'Opened evidence', extrasFromPayload(rows[0]?.payload as Record<string, unknown>));
    }
  } else if (wantsApprove(ql) && !registerRecordCommand) {
    const everyOpen = approveAllMeansEveryOpen(q);
    const targets =
      /\ball\b/.test(ql) || everyOpen
        ? everyOpen
          ? project.chatProposals.filter((p) => p.status === 'proposed')
          : currentTurnProposals(project)
        : [matchProposal(project, q)].filter((p): p is ChatProposal => Boolean(p));
    if (targets.length === 0 && project.chatProposals.filter((p) => p.status === 'proposed').length === 1) {
      targets.push(project.chatProposals.find((p) => p.status === 'proposed')!);
    }
    if (targets.length === 0) {
      /*
       * "Accept" is two verbs. It approves a card, and it is also what you do
       * to a risk you have decided to live with — so "accept the flood risk"
       * landed here, found no card, and said "nothing to approve" while the
       * risk stayed open. When there is no card to approve but the sentence
       * names a register, offer that reading rather than treating the word as
       * settled.
       */
      const kind: 'risk' | 'finding' | 'action' | null = /\brisks?\b/.test(ql)
        ? 'risk'
        : /\bfindings?\b/.test(ql)
          ? 'finding'
          : /\bactions?\b/.test(ql)
            ? 'action'
            : null;
      if (kind) {
        const rows = kind === 'risk' ? openRisks() : kind === 'finding' ? openFindings() : openActions();
        const verb = kind === 'risk' ? (/\baccept/.test(ql) ? 'Accept' : 'Mitigate') : 'Close';
        const asked = clarifyRecordCommand(project, q, kind, rows, verb);
        assistantText = `There is no card waiting for approval, so I have not written anything.\n${asked.text}`;
        choices = asked.choices;
        toolCalls = [{ name: 'clarify', summary: asked.summary }];
        navigate(kind === 'risk' ? 'risks' : kind === 'finding' ? 'findings' : 'actions', '');
      } else {
        assistantText = 'Nothing to approve. Ask “guide me” for the next cards, or attach a document.';
      }
    } else {
      const done: string[] = [];
      for (const item of targets) {
        const result = commitChatProposal(project, item.id, actor);
        done.push(`${item.title}${result.recordId ? ` → ${result.recordId}` : ''}`);
        if (result.recordId) highlightIds.push(result.recordId);
      }
      commands.push(`Approved ${done.length} proposal(s)`);
      assistantText = `Approved:\n${done.map((d) => `• ${d}`).join('\n')}\n\nThe right-hand pane shows the live record.`;
      toolCalls = [{ name: 'approve', summary: `${done.length} committed` }];
      const extra = extrasFromPayload(targets[0]!.payload as Record<string, unknown>);
      const pane = extra?.checkId ? 'scope' : paneForProposalKind(targets[0]!.kind);
      navigate(pane, `Opened ${pane}`, extra);
    }
  } else if (wantsReject(ql)) {
    const hit = matchProposal(project, q) ?? project.chatProposals.find((p) => p.status === 'proposed');
    if (hit) {
      rejectChatProposal(project, hit.id);
      commands.push(`Rejected “${hit.title}”`);
      assistantText = `Skipped “${hit.title}”. Ask “guide me” for other cards.`;
    } else {
      assistantText = 'No open proposal to skip.';
    }
  } else if (wantsCritic(q)) {
    const critic = findingCriticSitting(project, actor);
    const cards = offer(critic.proposals);
    assistantText = critic.text;
    citedNodeIds = critic.citedNodeIds;
    toolCalls = [{ name: 'critic', summary: cards.length ? `${cards.length} unevidenced finding(s)` : 'No unevidenced material findings' }];
    navigate(critic.pane, 'Opened findings');
  } else if (runOrchestrate) {
    const run = runProjectOrchestrator(project, actor);
    navigate('orchestrate', 'Ran orchestrator');
    navigate('drafts', 'Opened drafts');
    assistantText = [
      run.summary,
      `${run.draftIds.length} draft(s) proposed from registers — review and commit before they write findings, risks or actions.`,
      run.recommendedDdTypes.length
        ? `Recommended DD types not yet running: ${run.recommendedDdTypes.join(', ')}.`
        : 'Recommended templates for this stage are already instantiated.',
      `${run.openFindingCount} open finding(s). Pack completeness is the health figure — not the full evidence library.`,
    ].join('\n');
    toolCalls = [{ name: 'orchestrate', summary: `Proposed ${run.draftIds.length} draft(s)` }];
  } else {
    const startDd = startDdFromQuestion(project, q, actor);
    if (startDd) {
      offer([startDd]);
      const committed = commitChatProposal(project, startDd.id, actor);
      commands.push(`Started ${startDd.title}`);
      navigate('dd', 'Opened assessments');
      assistantText = `${startDd.title} is now on the project.\n${startDd.impact}\nScopes and expected evidence have been instantiated.`;
      citedNodeIds = committed.recordId ? [committed.recordId] : undefined;
      if (committed.recordId) highlightIds.push(committed.recordId);
      toolCalls = [{ name: 'start_dd', summary: startDd.title }];
    } else {
      const named = sittingWithField(project, talkSittingFromText(project, q));
      const namedSitting = named && (named.kind === 'check' || named.kind === 'scope' || named.kind === 'dd');
      const rewrite = /\b(add|start|set|request|create|close|assign|approve|skip|run|compute|propose|orchestrat)\b/i.test(ql);
      if (namedSitting && !rewrite) {
        const pane = paneForTalk(named.kind);
        navigate(pane, `Opened ${named.label}`, named.extra);
        assistantText = sittingBrief(project, named);
        citedNodeIds = named.highlightIds;
        highlightIds.push(...named.highlightIds);
        if (named.extra.evidenceId) citedEvidenceIds = [named.extra.evidenceId];
        toolCalls = [{ name: 'open_sitting', summary: named.label }];
      } else {
      const interpreted = interpretConversation(project, q, actor);
      if (interpreted.proposals.length) {
        if (interpreted.imperative) {
          const done: string[] = [];
          for (const item of interpreted.proposals) {
            project.chatProposals.push(item);
            const committed = commitChatProposal(project, item.id, actor);
            done.push(`${item.title}${committed.recordId ? ` → ${committed.recordId}` : ''}`);
            if (committed.recordId) highlightIds.push(committed.recordId);
          }
          commands.push(`Applied ${done.length} update(s) from chat`);
          assistantText = `Applied from this message:\n${done.map((d) => `• ${d}`).join('\n')}\n\nThe right-hand pane shows the live record. To change it again, say the new value.`;
          toolCalls = [{ name: 'apply', summary: `${done.length} applied` }];
          navigate(paneForProposalKind(interpreted.proposals[0]!.kind), `Opened ${paneForProposalKind(interpreted.proposals[0]!.kind)}`);
          citedNodeIds = highlightIds;
        } else {
          const cards = offer(interpreted.proposals);
          if (!cards.length) {
            assistantText = 'That update is already sitting on an open card. Approve it, or skip it and say the value again.';
            toolCalls = [{ name: 'advise', summary: 'Already proposed' }];
          } else {
          assistantText = [
            'I can apply these updates from what you just said. Approve a card to write them.',
            cards.map((p) => `• ${p.title}\n  ${p.rationale}`).join('\n'),
            'Or say “approve all”. Nothing is written until then.',
          ].join('\n\n');
          toolCalls = [{ name: 'advise', summary: `${cards.length} update(s)` }];
          navigate(paneForProposalKind(cards[0]?.kind ?? interpreted.proposals[0]!.kind), `Opened ${paneForProposalKind(cards[0]?.kind ?? 'patch_project')}`);
          citedNodeIds = cards.flatMap((p) => p.citedNodeIds ?? []);
          citedEvidenceIds = cards.flatMap((p) => p.citedEvidenceIds ?? []);
          }
        }
      } else {
      const side = recordCommand ? null : handleChatSides(project, q, actor, options.sides, options.sitting);
      if (side) {
        const cards = offer(side.proposals);
        assistantText = side.text;
        toolCalls = side.toolCalls;
        citedEvidenceIds = side.citedEvidenceIds;
        citedNodeIds = side.citedNodeIds;
        navigate(side.pane, `Opened ${side.pane}`);
        if (!cards.length && side.proposals.length) {
          assistantText = `${side.text}\n\nThose cards are already open — approve or skip them.`;
        }
      } else if (proposeDrafts) {
    const drafts = proposeAiDrafts(project, actor, 'rule');
    navigate('drafts', 'Proposed drafts from registers');
    assistantText = `${drafts.length} draft(s) proposed from live registers. Nothing writes a finding, risk or action until a person reviews and commits.`;
    toolCalls = [{ name: 'propose_drafts', summary: `Proposed ${drafts.length} draft(s)` }];
  } else if (wantsProjectScreen(q)) {
    const card = proposeProjectScreen(project, actor);
    const cards = offer([card]);
    assistantText = cards.length
      ? [
          'A property screen treats this project as the site and your evidence as the papers.',
          'Approve the card to write findings, risks, actions, gaps, an indicative valuation and a proposed pursue/don’t decision into the same registers. Nothing is a certified value.',
          `• ${card.title}`,
          `  ${card.rationale}`,
        ].join('\n')
      : 'A property-screen card is already open — approve or skip it.';
    toolCalls = [{ name: 'screen', summary: 'Proposed property screen' }];
    navigate('overview', 'Opened overview');
  } else if (runValuation) {
    const val = createValuationRun(project, actor);
    navigate('valuation', 'Ran indicative valuation');
    assistantText = `Indicative value ${project.currency} ${Math.round(val.indicatedValue).toLocaleString()} (${val.ibbi.premise}). This is not a certified IBBI certificate. Sign-off stays ${val.signOff.replaceAll('_', ' ')}.`;
    toolCalls = [{ name: 'run_valuation', summary: `Indicative ${project.currency} ${Math.round(val.indicatedValue).toLocaleString()}` }];
    highlightIds.push(val.id);
  } else if (/\b(close|complete|done|finish)\b/.test(ql) && /\baction\b/.test(ql)) {
    const hit = matchTitle(openActions(), q) as ActionRecord | undefined;
    if (hit) {
      patchRecordStatus(project, project.actions, hit.id, 'closed', 'action', actor);
      navigate('actions', `Closed action “${hit.title}”`);
      assistantText = `Closed action “${hit.title}”.`;
      toolCalls = [{ name: 'patch_action', summary: `Closed ${hit.title}` }];
      citedNodeIds = [hit.id];
      highlightIds.push(hit.id);
    } else {
      const asked = clarifyRecordCommand(project, q, 'action', openActions(), 'Close');
      assistantText = asked.text;
      choices = asked.choices;
      toolCalls = [{ name: 'clarify', summary: asked.summary }];
      navigate('actions', 'Opened actions');
    }
  } else if (/\b(close|resolve)\b/.test(ql) && /\bfinding\b/.test(ql)) {
    const hit = matchTitle(openFindings(), q) as FindingRecord | undefined;
    if (hit) {
      patchRecordStatus(project, project.findings, hit.id, 'closed', 'finding', actor);
      navigate('findings', `Closed finding “${hit.title}”`);
      assistantText = `Closed finding “${hit.title}”.`;
      toolCalls = [{ name: 'patch_finding', summary: `Closed ${hit.title}` }];
      citedNodeIds = [hit.id];
      highlightIds.push(hit.id);
    } else {
      const asked = clarifyRecordCommand(project, q, 'finding', openFindings(), 'Close');
      assistantText = asked.text;
      choices = asked.choices;
      toolCalls = [{ name: 'clarify', summary: asked.summary }];
      navigate('findings', 'Opened findings');
    }
  } else if (/\b(mitigate|close|accept)\b/.test(ql) && /\brisk\b/.test(ql)) {
    const hit = matchTitle(openRisks(), q) as RiskRecord | undefined;
    if (hit) {
      const next = /\baccept/.test(ql) ? 'accepted' : 'mitigated';
      patchRecordStatus(project, project.risks, hit.id, next, 'risk', actor);
      navigate('risks', `Marked risk “${hit.title}” ${next}`);
      assistantText = `Marked risk “${hit.title}” ${next}.`;
      toolCalls = [{ name: 'patch_risk', summary: `${next} ${hit.title}` }];
      citedNodeIds = [hit.id];
      highlightIds.push(hit.id);
    } else {
      const asked = clarifyRecordCommand(project, q, 'risk', openRisks(), /\baccept/.test(ql) ? 'Accept' : 'Mitigate');
      assistantText = asked.text;
      choices = asked.choices;
      toolCalls = [{ name: 'clarify', summary: asked.summary }];
      navigate('risks', 'Opened risks');
    }
  } else if (isShow || NAV_RULES.some((r) => r.test(ql) && /^(open|show|go to|switch to|take me|see|view)\b/.test(ql))) {
    const talk = sittingWithField(project, talkSittingFromText(project, q));
    if (talk) {
      const pane = paneForTalk(talk.kind);
      navigate(pane, `Opened ${talk.label}`, talk.extra);
      assistantText = sittingBrief(project, talk);
      citedNodeIds = talk.highlightIds;
      highlightIds.push(...talk.highlightIds);
      if (talk.extra.evidenceId) citedEvidenceIds = [talk.extra.evidenceId];
      toolCalls = [{ name: 'navigate', summary: talk.label }];
    } else {
      /*
       * "Open the zzzz check" used to open the DD pane and read out today's
       * unrelated next step. Opening a whole register is the right answer to
       * "open evidence"; it is the wrong answer to a named thing we could not
       * find, so try to say which named thing we thought they meant first.
       */
      const asked = clarifySubject(project, q, resolveSubject(project, q, { strict: true }), {
        sitting: options.sitting,
        insist: true,
      });
      if (asked) {
        assistantText = asked.text;
        choices = asked.choices;
        toolCalls = [{ name: 'clarify', summary: asked.summary }];
      } else {
      const pane = NAV_RULES.find((r) => r.test(ql))?.pane ?? 'overview';
      navigate(pane, `Opened ${pane}`);
      const brief = briefingAnswer(project, options.viewContext);
      assistantText = `Opening the ${pane} pane.\n\n${brief.text}`;
      citedEvidenceIds = brief.citedEvidenceIds ?? [];
      citedNodeIds = brief.citedNodeIds;
      toolCalls = [{ name: 'navigate', summary: pane }];
      }
    }
  } else {
    const focused = wantsAssets(ql) || wantsDdTypes(ql) || wantsScopes(ql) || wantsReport(ql) || wantsProofs(ql);
    if (focused) {
      const wiz = wantsReport(ql)
        ? [proposeReportCard(project, actor)].filter((p): p is ChatProposal => Boolean(p))
        : buildWizardProposals(project, actor);
      const cards = offer(wiz);
      const next = projectNextStep(project, actor);
      const proofBlock = wantsProofs(ql)
        ? project.findings
            .filter((f) => f.status === 'open' || f.status === 'under_review')
            .slice(0, 10)
            .map((f) => {
              const proofs = project.evidence.filter((e) => f.evidenceIds.includes(e.id));
              return proofs.length
                ? `• ${f.title} — ${proofs.map((e) => e.title).join('; ')}`
                : `• ${f.title} — no proof linked`;
            })
            .join('\n')
        : '';
      assistantText = [
        wantsAssets(ql) ? `Asset suggestions (${cards.filter((p) => p.kind === 'add_asset').length}): approve a card to create it.` : null,
        wantsDdTypes(ql) ? `DD types to start (${cards.filter((p) => p.kind === 'start_dd').length}): each card instantiates scopes and expected evidence.` : null,
        wantsScopes(ql) ? `Ask Guide me for the next check on a running DD. Scope cards are not bulk-added.` : null,
        wantsReport(ql) ? `Report cards (${cards.filter((p) => p.kind === 'generate_report').length}): generated from live registers.` : null,
        proofBlock ? `Proofs\n${proofBlock}` : null,
        cards.length ? `Cards in this turn:\n${cards.map((p) => `• ${p.title}\n  ${p.rationale}`).join('\n')}` : next.text,
      ]
        .filter(Boolean)
        .join('\n\n');
      citedEvidenceIds = next.citedEvidenceIds;
      citedNodeIds = [...next.citedNodeIds, ...cards.flatMap((p) => p.citedNodeIds ?? [])];
      toolCalls = [{ name: 'wizard', summary: `${cards.length} proposal(s)` }];
      if (wantsReport(ql)) navigate('reports', 'Opened reports');
      else if (wantsAssets(ql)) navigate('assets', '');
      else if (wantsDdTypes(ql)) navigate('dd', '');
      else navigate(next.pane, '', next.extra);
    } else if (/\bbrief/.test(ql)) {
      const brief = briefingAnswer(project, options.viewContext);
      assistantText = brief.text;
      citedEvidenceIds = brief.citedEvidenceIds ?? [];
      citedNodeIds = brief.citedNodeIds;
      toolCalls = [{ name: 'briefing', summary: 'Register briefing' }];
    } else {
      const talk = sittingWithField(project, talkSittingFromText(project, q));
      if (talk) {
        const pane = paneForTalk(talk.kind);
        navigate(pane, '', talk.extra);
        assistantText = sittingBrief(project, talk);
        citedNodeIds = talk.highlightIds;
        highlightIds.push(...talk.highlightIds);
        if (talk.extra.evidenceId) citedEvidenceIds = [talk.extra.evidenceId];
        toolCalls = [{ name: 'open_sitting', summary: talk.label }];
      } else {
        /*
         * Nothing resolved exactly. Before falling through to the next-step
         * briefing — which answers a DIFFERENT question, on a different check,
         * in the same confident voice — see whether anything is close enough
         * to put to the person. Asking costs a turn; guessing costs their
         * trust in every answer that was right.
         */
        const asked = clarifySubject(project, q, resolveSubject(project, q), { sitting: options.sitting });
        if (asked) {
          assistantText = asked.text;
          choices = asked.choices;
          toolCalls = [{ name: 'clarify', summary: asked.summary }];
        } else {
          const next = projectNextStep(project, actor);
          offer(next.proposals);
          assistantText = next.text;
          citedEvidenceIds = next.citedEvidenceIds;
          citedNodeIds = next.citedNodeIds;
          highlightIds.push(...next.citedEvidenceIds, ...next.citedNodeIds);
          toolCalls = [{ name: 'next_step', summary: next.title }];
          navigate(next.pane, '', next.extra);
        }
      }
    }
    }
    }
    }
    }
  }

  const assistantTurn = turn('assistant', assistantText, {
    choices,
    citedEvidenceIds: [...new Set(citedEvidenceIds)],
    citedNodeIds: citedNodeIds ? [...new Set(citedNodeIds)] : undefined,
    toolCalls,
    proposalIds: offered.map((p) => p.id),
  });
  appendTurns(project, userTurn, assistantTurn);
  return { userTurn, assistantTurn, commands, navigations, proposals: offered, highlightIds: [...new Set(highlightIds)] };
}

export function clearProjectConversation(project: DdProject): void {
  ensureProjectShape(project);
  project.conversation = [];
  project.updatedAt = nowIso();
}
