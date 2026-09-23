/**
 * Project cockpit — chat, commands, agents, and the orchestrator on DdProject.
 *
 * Person-authored commands (approve, set owner, close this action) stay
 * deterministic. "Guide me" is a named sitting on the same path. Other
 * questions run through the project copilot when a model is configured.
 * Model conclusions stay propose-and-review.
 */

import { CHECK_RESULT_LABEL, LIFECYCLE_STAGE_LABEL, REPORT_KIND_LABEL } from './catalogs';
import { createValuationRun, proposeAiDrafts, snapshotCapabilities } from './capabilities';
import { proposeProjectScreen, wantsProjectScreen } from './project-screen';
import {
  detachReportBlock,
  editReportBlock,
  ensureProjectShape,
  insertReportBlock,
  issueReport,
  generateReport,
  packCompleteness,
  packEvidence,
  patchFindingSeverity,
  patchRecordStatus,
  reattachReportBlock,
  recommendedDdTypes,
  recordCheckResult,
  removeReportBlock,
} from './operations';
import { interpretReportCommand, looksLikeReportCommand, openReportOf } from './report-command';
import { reportSummaryLine } from './report-blocks';
import type {
  ChatChoice,
  ActionRecord,
  ChatIngestFile,
  ChatMetric,
  ChatProposal,
  TurnSpend,
  ChatProposalKind,
  ChatSideBundle,
  DdProject,
  FindingRecord,
  OrchestratorRun,
  ProjectChatResult,
  ProjectChatTurn,
  ReportKind,
  RiskRecord,
} from './types';
import {
  buildWizardProposals,
  commitChatProposal,
  createChatProposal,
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
import { placeProposalsFromIngest } from './place-extract';
import { ddForDocumentsProposal, factsOnFile, pendingFactProposals } from './document-intake';
import { answerFromFile } from './file-answers';
import { detectChatSideIntents, handleChatSides } from './chat-sides';
import { clarifyRecordCommand, clarifySubject, looksLikeCommand, resolveSubject, sittingTitle } from './clarify';
import { verifyAttribution } from './attribution';
import { trimTurn } from './brevity';
import { plural } from './text';
import {
  checkResultChoices,
  describeRecorded,
  looksLikeCheckAssign,
  looksLikeCheckRecord,
  looksLikeCheckRecordOnSitting,
  parseCheckOwner,
  parseCheckResult,
  resultFromLabel,
} from './check-command';
import {
  rankTalkSittings,
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
  'visits',
  'findings',
  'risks',
  'actions',
  'decisions',
  'reports',
  'valuation',
  'graph',
  'drafts',
  'orchestrate',
  'people',
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
  if (kind === 'record_check' || kind === 'record_check_fields') return 'scope';
  if (kind === 'add_finding') return 'findings';
  if (kind === 'add_risk') return 'risks';
  if (kind === 'add_decision') return 'decisions';
  if (kind === 'generate_report' || kind === 'edit_report') return 'reports';
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
    case 'visits':
      return `${base}/visits`;
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
    case 'people':
      return `${base}/people`;
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
    unsupportedClaims: extra.unsupportedClaims,
    heldQuestions: extra.heldQuestions,
    trimmed: extra.trimmed,
    metrics: extra.metrics,
    spend: extra.spend,
    unanswered: extra.unanswered,
    refusedForLackOfEvidence: extra.refusedForLackOfEvidence,
    proposalIds: extra.proposalIds,
  };
}

function appendTurns(project: DdProject, user: ProjectChatTurn, assistant: ProjectChatTurn): void {
  project.conversation.push(user, assistant);
  project.updatedAt = assistant.at;
}

/**
 * The same instruction, aimed at one named check.
 *
 * Substitutes the title the person half-named with the one they picked, so
 * "mark the boundary check as non-compliant" becomes a message that records
 * exactly that against "Physical boundaries match the sanctioned plan".
 * Quoted, because a quoted title is the one form the matcher treats as
 * decisive.
 */
function rewriteCheckCommand(question: string, title: string): string {
  const stripped = question
    .replace(/["“][^"”]*["”]/g, '')
    .replace(/\bthe\s+[^,.]*?\bcheck\b/i, 'the check')
    .trim();
  return stripped.replace(/\bthe check\b/i, `the "${title}" check`);
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
function mostCommonKind(cards: ChatProposal[]): ChatProposalKind {
  const counts = new Map<ChatProposalKind, number>();
  for (const c of cards) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

/**
 * What approving just did, in words — "Filed 9 documents, started the
 * Acquisition / Site DD and recorded the parcel." — rather than "Filed 13
 * cards", which named the mechanism and not the result.
 */
function approvalReceipt(cards: ChatProposal[]): string {
  const count = (kind: ChatProposalKind) => cards.filter((c) => c.kind === kind).length;
  const parts: string[] = [];
  const filed = cards.filter((c) => c.kind === 'file_evidence');
  const requested = filed.filter((c) => c.payload.status === 'requested').length;
  if (filed.length - requested) parts.push(`filed ${plural(filed.length - requested, 'document')}`);
  if (requested) parts.push(`requested ${plural(requested, 'document')}`);
  for (const c of cards.filter((p) => p.kind === 'start_dd')) parts.push(`started the ${String(c.payload.name ?? c.title.replace(/^Start /, ''))}`);
  if (count('record_check_fields')) parts.push(`recorded values on ${plural(count('record_check_fields'), 'check')}`);
  if (count('record_check')) parts.push(`recorded ${plural(count('record_check'), 'check result')}`);
  if (count('add_finding')) parts.push(`raised ${plural(count('add_finding'), 'finding')}`);
  if (count('add_risk')) parts.push(`logged ${plural(count('add_risk'), 'risk')}`);
  if (count('add_action') + count('request_evidence')) parts.push(`opened ${plural(count('add_action') + count('request_evidence'), 'action')}`);
  if (count('patch_project')) parts.push('updated the project record');
  if (count('add_asset')) parts.push(`added ${plural(count('add_asset'), 'asset')}`);
  if (count('generate_report')) parts.push(`generated ${plural(count('generate_report'), 'report')}`);
  if (count('run_screen')) parts.push('ran the property screen');
  if (count('run_valuation')) parts.push('ran the valuation');
  const known = new Set<ChatProposalKind>(['file_evidence', 'start_dd', 'record_check_fields', 'record_check', 'add_finding', 'add_risk', 'add_action', 'request_evidence', 'patch_project', 'add_asset', 'generate_report', 'run_screen', 'run_valuation']);
  const other = cards.filter((c) => !known.has(c.kind)).length;
  if (other) parts.push(`applied ${plural(other, 'other change')}`);
  if (!parts.length) return `Done — ${plural(cards.length, 'card')} approved.`;
  const sentence = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** What just opened, and the one figure worth knowing about it. */
function paneLine(project: DdProject, pane: ProjectCockpitPane): string {
  const openF = project.findings.filter((f) => !['closed', 'rejected', 'duplicate', 'superseded'].includes(f.status));
  const material = openF.filter((f) => f.severity === 'critical' || f.severity === 'high').length;
  const gapCount = project.evidence.filter((e) => ['expected', 'missing', 'requested'].includes(e.status)).length;
  const filed = project.evidence.filter((e) => e.attachments.length).length;
  const today = new Date().toISOString().slice(0, 10);
  const openA = project.actions.filter((a) => a.status !== 'closed');
  const overdue = openA.filter((a) => a.status === 'overdue' || (a.dueDate && a.dueDate < today)).length;
  switch (pane) {
    case 'evidence':
      return `Evidence is open — ${plural(filed, 'document')} filed, ${gapCount} outstanding.`;
    case 'findings':
      return `Findings are open — ${plural(openF.length, 'open finding')}${material ? `, ${material} material` : ''}.`;
    case 'risks':
      return `Risks are open — ${plural(project.risks.filter((r) => r.status !== 'closed').length, 'open risk')}.`;
    case 'actions':
      return `Actions are open — ${plural(openA.length, 'open action')}${overdue ? `, ${overdue} overdue` : ''}.`;
    case 'reports':
      return project.reports.length ? `Reports are open — ${plural(project.reports.length, 'report')}.` : 'Reports are open. None yet — say “generate the executive DD report”.';
    case 'graph':
      return 'The knowledge graph is open — click a node to see what it touches.';
    case 'valuation':
      return project.lastScreen?.indicatedMid ? 'Valuation is open.' : 'Valuation is open. Say “run the property screen” for an indicative range.';
    case 'assets':
      return `Assets are open — ${plural(project.assets.length, 'asset')}.`;
    case 'dd':
      return project.assessments.length ? `DDs are open — ${plural(project.assessments.length, 'DD')}.` : 'DDs are open. None started yet.';
    case 'decisions':
      return `Decisions are open — ${plural(project.decisions.length, 'decision')}.`;
    default:
      return `${pane.charAt(0).toUpperCase()}${pane.slice(1)} is open.`;
  }
}

/**
 * "Open the evidence register" is a request for a pane, not a check.
 *
 * Checks list what evidence they expect, and one of them expects "Evidence
 * register" — so the sitting resolver matched it, and "open the evidence
 * register" opened a valuation check instead of the register. A verb that
 * opens things, followed by a pane's own name and a word like "register",
 * is always the pane.
 */
function asksForPane(ql: string): boolean {
  return /^(?:please\s+)?(?:open|show(?:\s+me)?|go\s+to|switch\s+to|take\s+me\s+to|see|view)\b/.test(ql)
    && /\b(?:register|pane|tab|list|page|graph|canvas)\b/.test(ql)
    && NAV_RULES.some((r) => r.test(ql));
}

/**
 * Which report somebody asked to be generated, or null.
 *
 * Needs a verb that makes something — "what does the red flag report say" is
 * a question about one, not a request for a new one.
 */
export function reportKindRequested(question: string): ReportKind | null {
  const q = question.toLowerCase();
  if (!/\b(?:generate|create|draft|build|make|prepare|produce|write|run|give\s+me|new)\b/.test(q)) return null;
  if (!/\breports?\b|\bred[\s-]flag\b|\bpack\b/.test(q)) return null;
  if (/\bred[\s-]flag/.test(q)) return 'red_flag';
  if (/\bdetailed\b/.test(q)) return 'detailed_dd';
  if (/\b(?:evidence\s+)?completeness\b/.test(q)) return 'evidence_completeness';
  if (/\b(?:open\s+)?risks?\b.*\bactions?\b|\brisk\s+(?:and|&)\s+action\b/.test(q)) return 'open_risk_action';
  if (/\bchanges?\b/.test(q)) return 'changes_since_previous';
  if (/\bvaluation\b/.test(q)) return 'indicative_valuation';
  if (/\bhandover\b/.test(q)) return 'handover_readiness';
  return 'executive_dd';
}

/** "Mark the EC finding as critical" → 'critical'. */
export function findingSeverityRequested(question: string): FindingRecord['severity'] | null {
  const q = question.toLowerCase();
  if (!/\bfindings?\b/.test(q)) return null;
  if (!/\b(?:mark|set|raise|lower|downgrade|upgrade|make|change|grade|re-?grade|escalate)\b/.test(q)) return null;
  const hit = /\b(critical|high|medium|low)\b/.exec(q);
  return hit ? (hit[1] as FindingRecord['severity']) : null;
}

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
  // A factual question the file itself answers is looked up, not paraphrased:
  // instant, free, and every figure carries its page.
  if (answerFromFile(project, q)) return true;
  if (reportKindRequested(q) || findingSeverityRequested(q)) return true;
  if (/^(?:please\s+)?add\s+(?:an?\s+)?note\b/i.test(q)) return true;
  if (/\b(?:add|log|record|create|request)\s+(?:an?\s+|the\s+)?(?:evidence|document)(?:\s+request)?\s*[:\-–]/i.test(q)) return true;
  if (wantsWizard(q)) return true;
  if (wantsCritic(q)) return true;
  if (startDdFromQuestion(project, q, 'probe')) return true;
  const interpreted = interpretConversation(project, q, 'probe');
  if (interpreted.imperative && interpreted.proposals.length) return true;
  // A person recording or assigning a check is a person's own instruction:
  // it executes, so it must not be handed to a model to paraphrase.
  if (looksLikeCheckRecord(q) || looksLikeCheckAssign(q)) return true;
  // A person editing their own report is their own instruction, same as
  // recording a check. It executes; a model reaching the same conclusion
  // raises a card.
  if (looksLikeReportCommand(q, Boolean(openReportOf(project)))) return true;
  if (options.sitting?.checkId && looksLikeCheckRecordOnSitting(q)) return true;
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
    /** What the call cost. Rendered beside the turn, never summed in prose. */
    spend?: TurnSpend;
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
  /*
   * The way-out check. Retrieval grounded what went in and the critic audits
   * after the fact; this is the only point that sees the exact text a person
   * is about to read, so it is where an invented figure gets named. Model
   * turns only — this function IS the model path.
   */
  const attribution = verifyAttribution(project, agent.text);
  /*
   * The other way-out check, and it sits here for the same reason: this is the
   * last point that sees the exact text a person will read. A prompt rule
   * about brevity degrades on precisely the hard turn where a wall of text is
   * least useful, and "ask one question at a time" fails predictably — the
   * model asks three, the person answers the last, and two are lost. Held
   * rather than cut, so the interview continues.
   */
  const brief = trimTurn(agent.text);
  const assistantTurn = turn('assistant', brief.text, {
    choices: agent.choices?.length ? agent.choices : undefined,
    heldQuestions: brief.heldQuestions.length ? brief.heldQuestions : undefined,
    trimmed: brief.trimmed || undefined,
    unsupportedClaims: attribution.unsupported.length ? attribution.unsupported.map((c) => c.text) : undefined,
    citedEvidenceIds: [...new Set(agent.citedEvidenceIds ?? [])],
    citedNodeIds: agent.citedNodeIds ? [...new Set(agent.citedNodeIds)] : undefined,
    toolCalls: agent.toolCalls,
    spend: agent.spend,
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
    unproven.length ? `${plural(unproven.length, 'material finding')} with no evidence id.` : null,
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

/** Where the file stands, in the three numbers a receipt can move. */
interface FileStanding {
  evidence: number;
  /** Evidence attached to a scope or a check — the rest is on the register only. */
  linked: number;
  packReceived: number;
  packTotal: number;
}

function fileStanding(project: DdProject): FileStanding {
  const pack = packCompleteness(project);
  return {
    evidence: project.evidence.length,
    linked: project.evidence.filter((e) => e.scopeInstanceIds.length > 0 || e.checkIds.length > 0).length,
    packReceived: pack.received,
    packTotal: pack.total,
  };
}

/**
 * The receipt's figures.
 *
 * Only rows that moved, plus the one that did not move when it should have.
 * "Linked to a scope: 0" is the row that explains an unchanged pack, so it is
 * kept even at zero when documents were filed — a silent zero there is how six
 * approved documents can feel like progress and be none.
 */
function standingDelta(before: FileStanding, after: FileStanding): ChatMetric[] | undefined {
  const rows: ChatMetric[] = [];
  const filed = after.evidence - before.evidence;
  if (filed > 0) {
    rows.push({ label: 'Evidence', value: String(after.evidence), delta: `+${filed}` });
    const linked = after.linked - before.linked;
    rows.push({
      label: 'Linked to a scope',
      value: String(after.linked),
      delta: linked > 0 ? `+${linked}` : 'none of the new ones',
    });
  }
  const packMoved = after.packReceived - before.packReceived;
  if (filed > 0 || packMoved !== 0) {
    rows.push({
      label: 'Priority pack',
      value: `${after.packReceived}/${after.packTotal}`,
      delta: packMoved > 0 ? `+${packMoved}` : 'unchanged',
    });
  }
  return rows.length ? rows : undefined;
}

export function applyProjectChat(
  project: DdProject,
  question: string,
  options: {
    actor?: string;
    viewContext?: string;
    ingest?: ChatIngestFile[];
    sides?: ChatSideBundle;
    sitting?: SittingRef;
    /** What reading the attached documents cost. Rendered beside the turn, as a chat turn's cost already is. */
    spend?: TurnSpend;
  } = {},
): ProjectChatResult {
  ensureProjectShape(project);
  const actor = options.actor ?? 'operator';
  const q = question.trim() || (options.ingest?.length ? 'I attached documents' : '');
  const ql = q.toLowerCase();
  const userTurn = turn('user', q);
  const commands: string[] = [];
  const navigations: ProjectChatResult['navigations'] = [];
  let offered: ChatProposal[] = [];
  let metrics: ChatMetric[] | undefined;
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
    || (/\b(mitigate|close|accept)\b/.test(ql) && /\brisk\b/.test(ql))
    || Boolean(findingSeverityRequested(q));
  const recordCommand =
    registerRecordCommand || (looksLikeCommand(q) && /\b(check|scope|assessment|dd)\b/.test(ql));
  /*
   * The person recording, or assigning, a check. Tested before the branches
   * that answer on topic words, because "mark the khata check compliant"
   * names a portal, a scope and a result, and only one of those is what they
   * asked for.
   */
  const checkRecordCommand =
    !registerRecordCommand
    && (looksLikeCheckRecord(q)
      || looksLikeCheckAssign(q)
      // "mark it compliant" while a check is open. "It" is the check on
      // screen, which is the only reading, and the only safe one.
      || (Boolean(options.sitting?.checkId) && looksLikeCheckRecordOnSitting(q)));
  const reportCommand = looksLikeReportCommand(q, Boolean(openReportOf(project)));
  const reportToGenerate = reportKindRequested(q);
  const severityChange = findingSeverityRequested(q);
  const bareNote = !reportCommand && /^(?:please\s+)?add\s+(?:an?\s+)?note\b/i.test(q);
  /*
   * "Add evidence: survey sketch" when a survey sketch is already filed. The
   * request makes no card — there is nothing to request — and used to fall
   * through to the portal side-branch, which answered with where to obtain a
   * document the file already holds.
   */
  const askedEvidence = /\b(?:add|log|record|create|request)\s+(?:an?\s+|the\s+)?(?:evidence|document)(?:\s+request)?\s*[:\-–]\s*(.{3,160})/i.exec(q)?.[1]?.trim().replace(/[.!?]+$/, '');
  const evidenceOnFile = askedEvidence
    ? project.evidence.find((e) => {
        const want = askedEvidence.toLowerCase().replace(/^(?:the|an?)\s+/, '');
        return e.title.toLowerCase() === want || (e.documentType ?? '').toLowerCase() === want;
      })
    : undefined;
  const runOrchestrate = /\borchestrat/.test(ql) && !/^(open|show|go to|switch to|see|view)\b/.test(ql);
  const proposeDrafts = /\bpropose\b/.test(ql) && /\bdrafts?\b/.test(ql);
  const runValuation = /\b(run|compute|start)\b/.test(ql) && /\bvaluat/.test(ql) && !wantsProjectScreen(q);
  const ingest = options.ingest ?? [];

  if (ingest.length) {
    const prefer = options.sitting;
    /*
     * What the documents say about WHERE this is, alongside what they are.
     *
     * The pin, the map, Street View, the locality rate and every connector
     * route key off `siteAddress` and `parcelId`. Both have existed since the
     * screen was written and nothing filled them, so a file could carry an
     * encumbrance certificate naming twelve survey numbers and still report
     * "no geocoded pin on this project".
     */
    const built = [...proposalsFromIngest(project, ingest, actor, prefer), ...placeProposalsFromIngest(project, ingest, actor)];
    // No DD yet: offer the one these documents answer, last, so approving
    // everything files them, starts it, and then offers its values.
    const startDd = ddForDocumentsProposal(
      project,
      [...ingest.flatMap((f) => f.read?.facts ?? []), ...factsOnFile(project).map((row) => row.fact)],
      actor,
      built,
    );
    const rows = offer(startDd ? [...built, startDd] : built);
    /*
     * A DD card may already be waiting — "guide me" offers one as the next
     * step. It belongs in THIS turn too, or "approve all" files the documents
     * and leaves the DD they answer one approval behind.
     */
    const readFacts = ingest.some((f) => (f.read?.facts ?? []).length);
    const waitingDd = !startDd && readFacts && !project.assessments.some((a) => a.status !== 'archived')
      ? project.chatProposals.find((p) => p.kind === 'start_dd' && p.status === 'proposed' && !rows.includes(p))
      : undefined;
    if (waitingDd) {
      offered = [...offered, waitingDd];
      rows.push(waitingDd);
    }
    const ddCard = startDd ?? waitingDd;
    /*
     * One line, and the cards carry the rest.
     *
     * This used to reprint every card's title and full rationale immediately
     * above the cards themselves, so a six-file upload rendered the same six
     * paragraphs twice and then a third time on approval. The cards are the
     * canonical rendering — they are what you act on — so the message says
     * only what the cards cannot: how many there are, and how many of them
     * are worth reading.
     */
    const failures = ingest.map((f) => f.readFailure).filter((r): r is string => Boolean(r));
    const unread = failures.length;
    /*
     * When every file failed for the same reason, that reason is a fact about
     * the deployment, not about six documents. Saying it once beats stamping
     * it on six cards — which is the same mistake, one level up, as the prose
     * this branch used to duplicate.
     */
    const oneCause = unread > 1 && new Set(failures).size === 1 ? failures[0]! : null;
    /*
     * Say what the documents ARE, and what needs a person, in one line each
     * at most — the cards carry the facts and their pages. "Read 1 file"
     * told somebody who had just dropped in a sale deed nothing they did not
     * already know.
     */
    const read = ingest.filter((f) => f.read && f.read.type !== 'other');
    const named = read.map((f) => {
      const raw = f.read!.label;
      // "Sale deed" reads as "the sale deed"; "DC conversion order" keeps its acronym.
      const label = /^[A-Z][a-z]/.test(raw) ? raw.charAt(0).toLowerCase() + raw.slice(1) : raw;
      return f.read!.method === 'text' ? label : `${label} (scan, read by OCR)`;
    });
    const fills = rows.filter((p) => p.kind === 'record_check_fields').length;
    const redFlags = rows.filter((p) => p.kind === 'add_finding');
    const patches = rows.filter((p) => p.kind === 'patch_project').length;
    const extras = [
      fills ? `${plural(fills, 'check')} can take values from ${ingest.length === 1 ? 'it' : 'them'}` : '',
      patches ? `${plural(patches, 'project detail')} to fill` : '',
      ddCard ? `approving also starts the ${String(ddCard.payload.name ?? ddCard.title.replace(/^Start /, ''))}, whose checks ${ingest.length === 1 ? 'it answers' : 'they answer'}` : '',
    ].filter(Boolean);
    const flagLine = redFlags.length ? `\n⚑ ${redFlags.map((p) => p.title).join('; ')}.` : '';
    const heading =
      read.length === ingest.length
        ? named.length === 1
          ? `Read the ${named[0]}.`
          : `Read ${named.length} documents: ${named.join(', ')}.`
        : read.length
          ? `Read ${named.join(', ')}; ${ingest.length - read.length} I couldn’t read${unread ? ` — ${oneCause ?? failures[0]!}` : ''}.`
          : unread === ingest.length
            ? `${oneCause ?? failures[0]!} Approving still files ${ingest.length === 1 ? 'it' : `all ${ingest.length}`} on the register, unread.`
            : `Read ${plural(ingest.length - unread, 'file')}; ${unread} I couldn’t.`;
    assistantText = `${heading}${extras.length ? ` ${extras.join('; ')}.` : ''}${flagLine}${read.length || unread < ingest.length ? '\nApprove to file, or say “approve all”.' : ''}`;
    citedEvidenceIds = rows.flatMap((p) => p.citedEvidenceIds ?? []);
    citedNodeIds = rows.flatMap((p) => p.citedNodeIds ?? []);
    highlightIds.push(...citedEvidenceIds);
    toolCalls = [{ name: 'ingest', summary: `Classified ${plural(ingest.length, 'file')}` }];
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
        assistantText = `Nothing waiting to approve.\n${asked.text}`;
        choices = asked.choices;
        toolCalls = [{ name: 'clarify', summary: asked.summary }];
        navigate(kind === 'risk' ? 'risks' : kind === 'finding' ? 'findings' : 'actions', '');
      } else {
        assistantText = 'Nothing waiting. Ask what’s next, or drop a document in.';
      }
    } else {
      const before = fileStanding(project);
      const done: string[] = [];
      for (const item of targets) {
        const result = commitChatProposal(project, item.id, actor);
        done.push(`${item.title}${result.recordId ? ` → ${result.recordId}` : ''}`);
        if (result.recordId) highlightIds.push(result.recordId);
      }
      commands.push(`Approved ${plural(done.length, 'proposal')}`);
      /*
       * A receipt, not a re-listing. The cards above have just flipped to
       * their committed state in place, so repeating their titles — and the
       * raw `ev_1a06…` ids, which name nothing a person recognises — said the
       * same thing a third time in the least readable form available.
       *
       * What the sentence cannot say, the figures can: whether the diligence
       * actually moved. Filing six documents against a project with no
       * assessment leaves the pack at 0/16, and that is the fact worth putting
       * in front of somebody who has just spent a minute approving cards.
       */
      assistantText = approvalReceipt(targets);
      metrics = standingDelta(before, fileStanding(project));
      toolCalls = [{ name: 'approve', summary: `${done.length} committed` }];
      /*
       * One card approved opens exactly what it wrote — a filed deed opens at
       * its page. A batch opens the register it mostly wrote to, and nothing
       * more: auto-opening the first document's viewer over a batch put a
       * modal over the chat just as it offered the next step.
       */
      const lead = targets[0]!;
      const extra = targets.length === 1 ? extrasFromPayload(lead.payload as Record<string, unknown>) : undefined;
      const pane = extra?.checkId ? 'scope' : paneForProposalKind(mostCommonKind(targets));
      navigate(pane, `Opened ${pane}`, extra);
      /*
       * One suggestion, and only one.
       *
       * `projectNextStep` already decides what this file needs next and the
       * Overview pane already renders it; chat simply never asked. Offering it
       * as a card rather than a sentence means it is actionable where it is
       * read, and it inherits the collapsed card treatment rather than adding
       * another paragraph. Idle means the file needs nothing — then say nothing.
       */
      /*
       * What the documents already said, offered to the checks that can now
       * hold it. Most files arrive before the DD that asks for them: a deed
       * read in week one states the extent the parcel check instantiated in
       * week two is about to ask for. Offered here, the moment a DD lands,
       * rather than making somebody re-upload or re-type what is on file.
       */
      const fills = pendingFactProposals(project, actor);
      if (fills.length) {
        offer(fills);
        assistantText += ` ${plural(fills.length, 'check')} can take values from documents already on file — say “approve all” to record them.`;
      }
      const startDd = fills.length ? undefined : ddForDocumentsProposal(project, factsOnFile(project).map((row) => row.fact), actor);
      if (startDd) {
        offer([startDd]);
        assistantText += ` Your documents answer checks in the ${startDd.title.replace(/^Start /, '')} — approve to start it.`;
      }
      const next = projectNextStep(project, actor);
      if (next.kind !== 'idle' && next.proposals.length && !fills.length && !startDd) offer([next.proposals[0]!]);
    }
  } else if (wantsReject(ql)) {
    const hit = matchProposal(project, q) ?? project.chatProposals.find((p) => p.status === 'proposed');
    if (hit) {
      rejectChatProposal(project, hit.id);
      commands.push(`Rejected “${hit.title}”`);
      assistantText = `Skipped “${hit.title}”.`;
    } else {
      assistantText = 'No open proposal to skip.';
    }
  } else if (wantsCritic(q)) {
    const critic = findingCriticSitting(project, actor);
    const cards = offer(critic.proposals);
    assistantText = critic.text;
    citedNodeIds = critic.citedNodeIds;
    toolCalls = [{ name: 'critic', summary: cards.length ? plural(cards.length, 'unevidenced finding') : 'No unevidenced material findings' }];
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
  } else if (reportToGenerate) {
    /*
     * "Generate the red flag report" is the person's own instruction, so it
     * runs — the same way starting a DD from chat does. It used to fall
     * through to the model, which on a deployment without one meant an
     * apology instead of a report.
     */
    const label = REPORT_KIND_LABEL[reportToGenerate].replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase());
    // A card, like every other thing chat would create: the report is one
    // approval away, and it is the kind that was asked for — the old card
    // chose its own kind from the findings and offered nothing when none
    // were material.
    offer([
      createChatProposal(
        'generate_report',
        `Generate the ${label}`,
        `It will open with: ${reportSummaryLine(project)}`,
        'Creates the report. Its sections read the registers live until you issue it.',
        { kind: reportToGenerate, assessmentIds: [], generatedBy: actor },
        actor,
      ),
    ]);
    assistantText = `Ready to generate the ${label} — ${reportSummaryLine(project)} Approve below.`;
    toolCalls = [{ name: 'generate_report', summary: REPORT_KIND_LABEL[reportToGenerate] }];
  } else if (severityChange) {
    const hit = matchTitle(openFindings(), q) as FindingRecord | undefined;
    if (hit) {
      const before = hit.severity;
      patchFindingSeverity(project, hit.id, severityChange, actor);
      navigate('findings', `Re-graded finding “${hit.title}”`, { findingId: hit.id });
      assistantText = before === severityChange ? `“${hit.title}” is already ${severityChange}.` : `“${hit.title}” is now ${severityChange} (was ${before}).`;
      toolCalls = [{ name: 'patch_finding', summary: `${hit.title} → ${severityChange}` }];
      citedNodeIds = [hit.id];
      highlightIds.push(hit.id);
    } else {
      const asked = clarifyRecordCommand(project, q, 'finding', openFindings(), `Mark ${severityChange}`);
      assistantText = asked.text;
      choices = asked.choices;
      toolCalls = [{ name: 'clarify', summary: asked.summary }];
      navigate('findings', 'Opened findings');
    }
  } else if (evidenceOnFile) {
    const held = evidenceOnFile.attachments.length > 0;
    assistantText = held
      ? `${evidenceOnFile.documentType ?? evidenceOnFile.title} is already on the register, with its file. Opening it.`
      : `“${evidenceOnFile.title}” is already on the register as ${evidenceOnFile.status}. Drop the document into the chat when you have it.`;
    toolCalls = [{ name: 'navigate', summary: evidenceOnFile.title }];
    citedEvidenceIds = [evidenceOnFile.id];
    navigate('evidence', '', held ? { evidenceId: evidenceOnFile.id } : undefined);
  } else if (bareNote) {
    /*
     * "Add a note: …" with no word saying where. Report edits demand the
     * report noun on purpose, so this is never guessed into one — it is
     * asked, with the answer one tap away.
     */
    const note = q.replace(/^(?:please\s+)?add\s+(?:an?\s+)?note\s*(?:to\s+\w+\s*)?[:\-–]?\s*/i, '').trim();
    const open = openReportOf(project);
    if (open) {
      assistantText = `Add that to the ${open.title}?`;
      choices = [
        { id: id('chc'), label: `Add to ${open.title}`, detail: note.slice(0, 60), send: `Add a note to the report: ${note}`, kind: 'action' },
      ];
    } else {
      assistantText = 'There is no open report to add that note to yet. Generate one, then say the note again.';
      choices = [
        { id: id('chc'), label: 'Generate the executive DD report', detail: 'Reads the registers live', send: 'Generate the executive DD report', kind: 'action' },
        { id: id('chc'), label: 'Generate the red flag report', detail: 'Material findings only', send: 'Generate the red flag report', kind: 'action' },
      ];
    }
    toolCalls = [{ name: 'clarify', summary: open ? 'Which report' : 'No open report' }];
  } else if (reportCommand) {
    /*
     * The person editing their own report, through chat.
     *
     * Executes rather than proposes, for the same reason recording a check
     * does: the authorship law turns on WHO concluded, not on which surface
     * they typed it into. What it will not do is write into a block that
     * reads the registers — `editReportBlock` refuses that outright, and a
     * detach is a thing somebody has to ask for by name.
     */
    const read = interpretReportCommand(project, q);
    if (read.choices?.length) {
      choices = read.choices;
      assistantText = 'That could be more than one section. Nothing has changed — pick the one you meant.';
    } else if (!read.command || !read.report) {
      assistantText = read.say ?? 'I could not tell what to change in the report.';
    } else {
      const report = read.report;
      const cmd = read.command;
      try {
        if (cmd.kind === 'issue') {
          issueReport(project, report.id, actor);
          assistantText =
            `Issued “${report.title}”. Every live section is now frozen at what it said just now, and the report will not move again. `
            + 'The reports pane shows what the registers have done since.';
          commands.push(`Issued ${report.title}`);
        } else if (cmd.kind === 'add_note') {
          const block = insertReportBlock(project, report.id, { text: cmd.text, afterBlockId: cmd.blockId }, actor);
          assistantText = cmd.blockId
            ? 'Added, in your words, under that section.'
            : 'Added at the end — I could not tell which section you meant, and putting your words under the wrong heading changes what you said.';
          commands.push(`Added a note to ${report.title}`);
          citedNodeIds = [block.id];
        } else if (cmd.kind === 'remove_block') {
          removeReportBlock(project, report.id, cmd.blockId!, actor);
          assistantText = 'Removed. Nothing in the registers changed — this only took it out of the report.';
          commands.push(`Removed a section from ${report.title}`);
        } else if (cmd.kind === 'detach_block') {
          const block = detachReportBlock(project, report.id, cmd.blockId!, actor);
          assistantText =
            `“${block.heading ?? 'That section'}” is yours to edit now. It keeps what it said, and the report shows that it stopped `
            + 'updating today — a paragraph that reads like a register summary should never quietly stop being one.';
          commands.push(`Detached a section of ${report.title}`);
        } else if (cmd.kind === 'reattach_block') {
          reattachReportBlock(project, report.id, cmd.blockId!, actor);
          assistantText = 'Back on the registers. Whatever was typed there is gone — it reads live again.';
          commands.push(`Reattached a section of ${report.title}`);
        } else if (cmd.kind === 'rename_block') {
          editReportBlock(project, report.id, cmd.blockId!, { heading: cmd.heading }, actor);
          assistantText = `Renamed to “${cmd.heading}”.`;
          commands.push(`Renamed a section of ${report.title}`);
        }
      } catch (err) {
        assistantText = err instanceof Error ? err.message : 'That change could not be made.';
      }
    }
    navigate('reports', 'Opened the report');
  } else if (checkRecordCommand) {
    /*
     * The person recording a check, through chat.
     *
     * Executes rather than proposes: the authorship law turns on WHO
     * concluded, not on which surface they typed it into, and this sentence
     * is the person concluding. A model reaching the same conclusion still
     * has to raise a `record_check` card.
     *
     * The subject must resolve to exactly one check. Anything less goes to
     * the clarifier — this is the command where a wrong guess writes a result
     * and, for a material one, raises a finding under somebody's name.
     */
    const resolution = resolveSubject(project, q, { strict: true });
    /*
     * The check on screen settles it in two cases, and only two. When the
     * sentence names nothing ("mark it compliant"), the check they are
     * looking at is what "it" means. And when they picked one of the options
     * we offered, the pick arrives pinned — so an ambiguity between two DDs
     * carrying the same check title resolves to the one they clicked rather
     * than re-asking the question forever.
     *
     * In every other case the URL is ignored. Sitting on check A and typing
     * "mark the boundary check compliant" must never record A: the pinned
     * record only counts when it is one of the candidates for what was typed.
     */
    const ranked = rankTalkSittings(project, q, 5);
    const pinned = options.sitting?.checkId
      ? ranked.length
        ? ranked.find((row) => row.sitting.extra.checkId === options.sitting?.checkId)?.sitting.extra
        : options.sitting
      : undefined;
    const target =
      resolution.kind === 'confident'
        ? sittingCheckOf(project, resolution.sitting.extra)
        : sittingCheckOf(project, pinned);
    if (!target) {
      const asked = clarifySubject(project, q, resolution, {
        sitting: options.sitting,
        insist: true,
        // Carry the instruction onto every option, so picking the right check
        // records what they asked for rather than merely opening it.
        send: (candidate) => rewriteCheckCommand(q, sittingTitle(candidate)),
      });
      if (asked) {
        assistantText = asked.text;
        choices = asked.choices;
        toolCalls = [{ name: 'clarify', summary: asked.summary }];
      } else {
        assistantText = 'Name the check the way it appears on the scope, and I will record it.';
        toolCalls = [{ name: 'clarify', summary: 'No check named' }];
      }
    } else {
      const owner = looksLikeCheckAssign(q) ? parseCheckOwner(q, actor) : null;
      const result = owner ? null : parseCheckResult(q) ?? resultFromLabel(q);
      if (!owner && !result) {
        /*
         * A recording instruction whose state word is not a result —
         * "started", "in progress", "done". There is no such check state, so
         * offer the ones there are rather than picking the nearest.
         */
        choices = checkResultChoices(target.check.title, {
          assignTo: actor,
          sitting: { ddId: target.assessment.id, scopeId: target.scope.id, checkId: target.check.id },
        });
        assistantText = [
          `A check does not have a “started” state — it stays not started until somebody concludes something, and the scope moves to in progress on its own at that point.`,
          `Nothing has changed on “${target.check.title}”. Either put it in your name, or record what you actually found:`,
        ].join('\n');
        toolCalls = [{ name: 'clarify', summary: 'Result not named — offered' }];
        navigate('scope', '', {
          ddId: target.assessment.id,
          scopeId: target.scope.id,
          checkId: target.check.id,
        });
      } else {
        const before = [...target.check.findingIds];
        const recorded = recordCheckResult(
          project,
          target.check.id,
          owner ? { result: target.check.result, owner } : { result: result! },
          actor,
        );
        commands.push(
          owner
            ? `Assigned “${recorded.title}” to ${owner}`
            : `Recorded “${recorded.title}” as ${CHECK_RESULT_LABEL[recorded.result]}`,
        );
        assistantText = owner
          ? `“${recorded.title}” is in ${owner}'s name. It is still not started — recording a result is a separate step, on the right.`
          : describeRecorded(project, recorded, before);
        toolCalls = [
          owner
            ? { name: 'assign_check', summary: `${recorded.title} → ${owner}` }
            : { name: 'record_check', summary: `${recorded.title} — ${CHECK_RESULT_LABEL[recorded.result]}` },
        ];
        citedNodeIds = [recorded.id, ...recorded.findingIds.filter((id) => !before.includes(id))];
        highlightIds.push(...citedNodeIds);
        navigate('scope', '', {
          ddId: target.assessment.id,
          scopeId: target.scope.id,
          checkId: target.check.id,
        });
      }
    }
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
      // The new checks can take what the documents on file already state.
      const fills = offer(pendingFactProposals(project, actor));
      if (fills.length) assistantText += `\n${plural(fills.length, 'check')} can take values from documents already on file — say “approve all” to record them.`;
    } else {
      const named = asksForPane(ql) ? undefined : sittingWithField(project, talkSittingFromText(project, q));
      const namedSitting = named && (named.kind === 'check' || named.kind === 'scope' || named.kind === 'dd');
      const rewrite = /\b(add|start|set|request|create|close|assign|approve|skip|run|compute|propose|orchestrat)\b/i.test(ql);
      /*
       * A factual question is answered from the file before anything else
       * reads it as a place to go. "What is the encumbrance status?" names
       * the encumbrances check, and used to open it and describe the check —
       * when the person asked what the EC says, and the EC was on file.
       */
      const fileAnswer = answerFromFile(project, q);
      if (fileAnswer) {
        assistantText = fileAnswer.text;
        citedEvidenceIds = fileAnswer.citedEvidenceIds;
        citedNodeIds = fileAnswer.citedNodeIds.length ? fileAnswer.citedNodeIds : undefined;
        highlightIds.push(...fileAnswer.citedEvidenceIds, ...fileAnswer.citedNodeIds);
        toolCalls = [{ name: 'answer_from_file', summary: fileAnswer.summary }];
        if (fileAnswer.navigate) {
          const { pane, evidenceId, page } = fileAnswer.navigate;
          navigate(pane, '', evidenceId ? { evidenceId, page } : undefined);
        }
        if (fileAnswer.choices?.length) choices = fileAnswer.choices;
      } else if (namedSitting && !rewrite) {
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
            // The record's title, never its id: "→ ast_1a0cfb…" named nothing
            // a person recognises and read like a stack trace in the chat.
            done.push(item.title);
            if (committed.recordId) highlightIds.push(committed.recordId);
          }
          commands.push(`Applied ${done.length} update(s) from chat`);
          assistantText =
            done.length === 1
              ? `Done — ${done[0]!.charAt(0).toLowerCase()}${done[0]!.slice(1)}. It’s open on the right.`
              : `Done:\n${done.map((d) => `• ${d}`).join('\n')}\nOpen on the right.`;
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
        /*
         * Everything it would have offered is already waiting.
         *
         * The side's own text ends "approve below" — which, once dedup has
         * removed every card, points at nothing and then contradicts itself
         * two lines later. Replace it rather than appending to it.
         */
        if (!cards.length && side.proposals.length) {
          assistantText = `Already asked for. ${plural(side.proposals.length, 'card')} waiting further up — approve or skip.`;
        }
      } else if (proposeDrafts) {
    const drafts = proposeAiDrafts(project, actor, 'rule');
    navigate('drafts', 'Proposed drafts from registers');
    assistantText = `${plural(drafts.length, 'draft')} from the registers. Nothing lands until you review each one.`;
    toolCalls = [{ name: 'propose_drafts', summary: `Proposed ${plural(drafts.length, 'draft')}` }];
  } else if (wantsProjectScreen(q)) {
    const card = proposeProjectScreen(project, actor);
    const cards = offer([card]);
    // The card carries the detail; this says what approving it does, once.
    // It used to reprint the card's own title and rationale beneath itself.
    assistantText = cards.length
      ? 'Ready to screen the property against the evidence on file. Approve to write findings, risks, gaps and an indicative value — nothing is a certified valuation.'
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
    const talk = asksForPane(ql) ? undefined : sittingWithField(project, talkSittingFromText(project, q));
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
      // One line: what opened and the figure that matters there. The full
      // register briefing used to follow — ten lines under "open the graph".
      assistantText = paneLine(project, pane);
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
        wantsAssets(ql) ? `${plural(cards.filter((p) => p.kind === 'add_asset').length, 'asset')} worth adding.` : null,
        wantsDdTypes(ql) ? `${plural(cards.filter((p) => p.kind === 'start_dd').length, 'DD')} you could start. Each brings its scopes with it.` : null,
        wantsScopes(ql) ? 'Scopes come with the DD. Ask what’s next for the following check.' : null,
        wantsReport(ql) ? `${plural(cards.filter((p) => p.kind === 'generate_report').length, 'report')} you could run, off the live registers.` : null,
        proofBlock ? `Proofs\n${proofBlock}` : null,
        /*
         * The cards, counted — not reprinted.
         *
         * This pasted every card's title and full rationale directly above the
         * cards themselves, so three suggestions rendered as three paragraphs
         * and then again as three collapsed rows with buttons. The same
         * duplication the upload path carried, in the branch next door.
         */
        cards.length ? `${plural(cards.length, 'card')} below — approve what you want.` : next.text,
      ]
        .filter(Boolean)
        .join('\n\n');
      citedEvidenceIds = next.citedEvidenceIds;
      citedNodeIds = [...next.citedNodeIds, ...cards.flatMap((p) => p.citedNodeIds ?? [])];
      /*
       * A chip for nothing is worse than no chip. Cards already raised on this
       * project are deduped away, so a second ask legitimately offers none —
       * and "0 proposal(s)" reported that as though it were a result.
       */
      toolCalls = cards.length ? [{ name: 'wizard', summary: plural(cards.length, 'card') }] : undefined;
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
    metrics,
    spend: options.spend,
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
