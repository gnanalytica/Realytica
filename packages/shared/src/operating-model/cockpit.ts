/**
 * Project cockpit — chat, commands, agents, and the orchestrator on DdProject.
 *
 * Person-authored commands (approve, set owner, close this action) stay
 * deterministic. "Guide me" is a named sitting on the same path. Other
 * questions run through the project copilot when a model is configured.
 * Model conclusions stay propose-and-review.
 */

import { CHECK_RESULT_LABEL, REPORT_KIND_LABEL } from './catalogs';
import { chatPlaceLabel, chatPlaceLine, functionOfDocument, functionRank, menuPlaceOfWords, openPlace, placeFromText, placeOfRecord, placeOpenedLine, stageChangedLine, type ChatPlace } from './chat-places';
import { STAGES, STAGE_WORD, functionKey, stageAndStep, workstreamOfCheck } from './departments';
import { asksToFileUnder, disagreementSentence, documentDisagreements, fileUnderFromText, filedGroups, filedSentence, filingChoices, offeredByFunction, offeredSentence, reachSentence, waitingChoices, waitingSentence } from './document-filing';
import { readInstruction, sameTitle, type Instruction, type InstructionVerb } from './instruction';
import { factsAwaitingReview, proposedFacts } from './fact-review';
import { contestedKeys, decideCheckFields, reviewFacts, waitingFieldKeys } from './review';
import { createValuationRun, proposeAiDrafts, snapshotCapabilities } from './capabilities';
import { proposeProjectScreen, wantsProjectScreen } from './project-screen';
import {
  detachReportBlock,
  editReportBlock,
  ensureProjectShape,
  insertReportBlock,
  issueReport,
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
  ChoicePin,
  ActionRecord,
  ChatIngestFile,
  ChatMetric,
  ChatProposal,
  TurnSpend,
  ChatProposalKind,
  ChatSideBundle,
  ChatTurnPlace,
  DdProject,
  EvidenceRecord,
  FindingRecord,
  OrchestratorRun,
  ProjectChatResult,
  ProjectChatTurn,
  ReportKind,
  RiskRecord,
} from './types';
import {
  buildWizardProposals,
  ADMIN_ONLY_PROPOSALS,
  commitChatProposal,
  createChatProposal,
  interpretConversation,
  proposalsFromIngest,
  rejectChatProposal,
  startDdFromQuestion,
  wantsAssets,
  wantsDdTypes,
  wantsProofs,
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
  DROPPED_WITHOUT_WORDS,
  NOTHING_ACCEPTED,
  NOTHING_SET_ASIDE,
  NOTHING_TO_READ,
  rankTalkSittings,
  filedByReply,
  lastSpokenReply,
  paneForTalk,
  sittingBrief,
  sittingCheckOf,
  sittingFromCitedIds,
  sittingWithField,
  talkSittingFromText,
  withTalkNavigation,
  wantsCritic,
  type ChatSitting,
  type CockpitPathExtra,
  type SittingRef,
  type TalkSitting,
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
  'department',
  'workstream',
] as const;

export type ProjectCockpitPane = (typeof PROJECT_COCKPIT_PANES)[number];

export function paneForProposalKind(kind: ChatProposalKind): ProjectCockpitPane {
  if (kind === 'file_evidence' || kind === 'assign_document') return 'evidence';
  if (kind === 'request_documents') return 'evidence';
  if (kind === 'set_departments') return 'overview';
  if (kind === 'request_evidence' || kind === 'add_action' || kind === 'open_connector') return 'actions';
  if (kind === 'run_valuation') return 'valuation';
  // The screen is the Value tab's compliance half now, so it waits there.
  if (kind === 'run_screen') return 'valuation';
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

/** One thing waiting for a person on the canvas, and where it waits. */
export interface WaitingEntry {
  /** A document's values, or a card of this kind. */
  kind: 'facts' | ChatProposalKind;
  pane: ProjectCockpitPane;
  /** Decisions it holds: the values on a document, the fields on a check card, otherwise one. */
  count: number;
  title: string;
  evidenceId?: string;
  proposalId?: string;
  extra?: CockpitPathExtra;
  /** The function it waits in: the one that holds the document, or the one the check sits in. */
  fn?: string;
}

/** The order a review moves through the file: documents first, then what they answer, then everything else. */
const REVIEW_ORDER: ProjectCockpitPane[] = [
  'evidence', 'scope', 'dd', 'findings', 'risks', 'actions', 'decisions', 'assets', 'overview', 'visits', 'valuation', 'reports', 'drafts', 'orchestrate', 'people', 'graph',
];

function extraForCard(project: DdProject, card: ChatProposal): CockpitPathExtra | undefined {
  const p = card.payload as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const checkId = str(p.checkId) ?? (Array.isArray(p.checkIds) ? str(p.checkIds[0]) : undefined);
  // A check opens inside its scope; the address needs both to get there.
  const seat = checkId
    ? project.assessments.flatMap((a) => a.scopes.map((s) => ({ a, s }))).find(({ s }) => s.checks.some((c) => c.id === checkId))
    : undefined;
  const extra: CockpitPathExtra = {
    ...(str(p.assessmentId) ? { ddId: str(p.assessmentId) } : seat ? { ddId: seat.a.id } : {}),
    ...(seat ? { scopeId: seat.s.id } : {}),
    ...(checkId ? { checkId } : {}),
    ...(str(p.evidenceId) ? { evidenceId: str(p.evidenceId) } : {}),
    ...(str(p.assetId) ? { assetId: str(p.assetId) } : {}),
  };
  return Object.keys(extra).length ? extra : undefined;
}

/**
 * Everything waiting for a person, by the pane it waits in.
 *
 * The chat no longer carries a card to approve: what a reader or the model
 * proposed waits where it would land. This is the count the canvas shows on
 * each tab and in its review pill, and the order its "next" walks — the
 * values on documents first, because everything else is read from them.
 */
export function waitingOnCanvas(project: DdProject): { total: number; byPane: Partial<Record<ProjectCockpitPane, number>>; entries: WaitingEntry[] } {
  const entries: WaitingEntry[] = [];
  const definitions = new Map(project.assessments.flatMap((a) => a.scopes.flatMap((s) => s.checks.map((c) => [c.id, c.definitionId] as const))));
  for (const { evidence, facts } of factsAwaitingReview(project)) {
    const fn = functionOfDocument(project, evidence);
    entries.push({ kind: 'facts', pane: 'evidence', count: facts.length, title: evidence.title, evidenceId: evidence.id, extra: { evidenceId: evidence.id }, ...(fn ? { fn } : {}) });
  }
  for (const card of project.chatProposals ?? []) {
    if (card.status !== 'proposed') continue;
    const count = card.kind === 'record_check_fields' ? waitingFieldKeys(card).length : 1;
    if (!count) continue;
    const pane = card.kind === 'change_stage' && card.payload.subject === 'asset' ? 'assets' : paneForProposalKind(card.kind);
    const extra = extraForCard(project, card);
    // A value waiting on a check waits in the function the check sits in.
    const definition = pane === 'scope' && extra?.checkId ? definitions.get(extra.checkId) : undefined;
    entries.push({ kind: card.kind, pane, count, title: card.title, proposalId: card.id, extra, ...(definition ? { fn: functionKey(workstreamOfCheck(definition)) } : {}) });
  }
  // The documents are walked a function at a time, in the menu's order, so a review opens on one function's papers
  // and goes on to the next. Those no function holds come last.
  const rank = (e: WaitingEntry) => (e.kind === 'facts' ? functionRank(e.fn) : 0);
  entries.sort((a, b) => REVIEW_ORDER.indexOf(a.pane) - REVIEW_ORDER.indexOf(b.pane) || rank(a) - rank(b));
  const byPane: Partial<Record<ProjectCockpitPane, number>> = {};
  let total = 0;
  for (const e of entries) {
    byPane[e.pane] = (byPane[e.pane] ?? 0) + e.count;
    total += e.count;
  }
  return { total, byPane, entries };
}

function withQuery(path: string, pairs: Array<[string, string | undefined]>): string {
  const parts: string[] = [];
  for (const [key, value] of pairs) {
    if (value) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.length ? `${path}?${parts.join('&')}` : path;
}

/**
 * The address of a page of a project.
 *
 * Besides the page, a link can say how to look at it: the stage, by the word
 * an address carries, and on a function's page the part to bring into view
 * with the record to mark there. A link that says no stage leaves the one in
 * view as it is.
 */
export function cockpitPath(
  projectId: string,
  pane: ProjectCockpitPane,
  extra?: CockpitPathExtra,
): string {
  const path = panePath(projectId, pane, extra);
  const stage = STAGES.find((s) => s.key === extra?.stage);
  const pairs: Array<[string, string | undefined]> = [
    ['stage', stage ? STAGE_WORD[stage.key] : undefined],
    // A part belongs to a function's page. On it a document opens as it does on the register, at the page cited.
    ...(extra?.section
      ? ([
          ['part', extra.section],
          ['item', extra.item],
          ['evidence', extra.evidenceId],
          ['page', extra.evidenceId ? extra.page : undefined],
        ] as Array<[string, string | undefined]>)
      : []),
  ];
  const more = withQuery('', pairs).slice(1);
  return more ? `${path}${path.includes('?') ? '&' : '?'}${more}` : path;
}

function panePath(projectId: string, pane: ProjectCockpitPane, extra?: CockpitPathExtra): string {
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
      return withQuery(`${base}/decisions`, [['decision', extra?.item]]);
    case 'reports':
      return withQuery(`${base}/reports`, [['report', extra?.item]]);
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
    case 'department':
      return extra?.department ? `${base}/d/${extra.department}` : base;
    case 'workstream': {
      // The two workstreams with a page of their own keep it.
      if (extra?.workstream === 'finance.valuation') return `${base}/valuation`;
      if (extra?.workstream === 'construction.site') return `${base}/visits`;
      return extra?.workstream ? `${base}/w/${extra.workstream}` : base;
    }
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
  if (tab === 'd') return 'department';
  if (tab === 'w') return 'workstream';
  if ((PROJECT_COCKPIT_PANES as readonly string[]).includes(tab)) return tab as ProjectCockpitPane;
  return 'overview';
}

export function isProjectCockpitPane(value: string | null | undefined): value is ProjectCockpitPane {
  return Boolean(value && (PROJECT_COCKPIT_PANES as readonly string[]).includes(value));
}

/**
 * The place a question came from, read from what the request sent.
 *
 * The words are checked against the menu, so a place is only ever a page that
 * exists. A client that sends the pane alone (`viewContext`, which is all the
 * chat used to be told) is on that pane and at no stage in particular.
 * Nothing known in either gives no place, and the chat answers as it did
 * before it was told.
 */
export function chatPlaceFrom(raw: ChatTurnPlace | undefined, viewContext?: string): ChatPlace | undefined {
  const sent = raw?.pane;
  const pane = isProjectCockpitPane(sent) ? sent : isProjectCockpitPane(viewContext) ? viewContext : undefined;
  const menu = menuPlaceOfWords(raw);
  if (!pane && !menu.department) return undefined;
  return { ...(pane ? { pane } : {}), ...menu };
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
  // The map is on the overview again, beside where the file stands.
  { pane: 'overview', test: (q) => /\bgis\b|\bmaps?\b|\boverlay\b/.test(q) },
  { pane: 'graph', test: (q) => /\b(knowledge\s+)?graph\b|\bnodes?\b|\blinks?\b/.test(q) },
  { pane: 'actions', test: (q) => /\bactions?\b|\boverdue\b|\btodos?\b/.test(q) },
  { pane: 'drafts', test: (q) => /\bdrafts?\b|\bai drafts?\b|\bproposed drafts?\b/.test(q) },
  { pane: 'evidence', test: (q) => /\bevidence\b|\bdocuments?\b|\bfiles?\b|\bgaps?\b/.test(q) },
  { pane: 'valuation', test: (q) => /\bvaluations?\b|\bworth\b|\bindicated value\b|\bindicative value\b|\bcomparables?\b|\bcomps\b|\b(?:99acres|magicbricks)\b/.test(q) },
  { pane: 'orchestrate', test: (q) => /\borchestrat/.test(q) },
  { pane: 'findings', test: (q) => /\bfindings?\b/.test(q) },
  { pane: 'risks', test: (q) => /\brisks?\b/.test(q) },
  { pane: 'decisions', test: (q) => /\bdecisions?\b/.test(q) },
  { pane: 'reports', test: (q) => /\breports?\b/.test(q) },
  { pane: 'assets', test: (q) => /\bassets?\b|\btowers?\b/.test(q) },
  { pane: 'dd', test: (q) => /\bdue diligence\b|\bdd\b|\bchecks?\b|\bassessments?\b|\bscopes?\b/.test(q) },
  // The site, with its place card, street view and visits. Late, so "the site's documents" still opens documents.
  { pane: 'visits', test: (q) => /\bsite\b|\bstreet ?view\b|\bnearby\b|\bvisits?\b|\bphotos?\b/.test(q) },
  { pane: 'overview', test: (q) => /\boverview\b|\bwork\b|\bbriefing\b/.test(q) },
];

function wantsNavigate(q: string): boolean {
  return /^(open|show|go to|switch to|take me|see|view)\b/.test(q) || /\b(pane|register|canvas)\b/.test(q);
}

/**
 * The name a sentence asked to be shown, when it asked for one thing by a
 * name: what is left of "open Zorblax" once the verb is gone. A sentence that
 * asks a question ("show me where we stand") or points at nothing ("open it")
 * names nothing, and gets none.
 */
function unknownName(q: string): string | undefined {
  const rest = /^(?:please\s+)?(?:open|show(?:\s+me)?|go\s+to|switch\s+to|take\s+me(?:\s+to)?|see|view)\s+(?:the\s+)?(.+?)[\s.!?]*$/i.exec(q.trim())?.[1];
  if (!rest) return undefined;
  const words = rest.split(/\s+/);
  const pointing = /^(?:where|what|how|why|who|which|when|whether|if|it|this|that|these|those|here|there|me|us|we|i|you|all|everything|anything|something|more)$/i;
  return words.length <= 4 && !words.some((w) => pointing.test(w)) ? rest : undefined;
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
  if (!parts.length) return `Done — ${plural(cards.length, 'suggestion')} accepted.`;
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
      return `Documents are open — ${filed} filed, ${gapCount} outstanding.`;
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
      return 'Value is open. “Value this property” fills every input the file holds, checks it the way a lender would, and shows the figure.';
    case 'assets':
      return `Assets are open — ${plural(project.assets.length, 'asset')}.`;
    case 'dd':
      return project.assessments.length ? `DDs are open — ${plural(project.assessments.length, 'DD')}.` : 'DDs are open. None started yet.';
    case 'decisions':
      return `Decisions are open — ${plural(project.decisions.length, 'decision')}.`;
    case 'visits':
      return 'The site is open — the map, what is nearby, and the visits.';
    case 'overview':
      return 'The overview is open — where the file stands, and the map.';
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
  if (/\btechnical\b|\btdd\b|\bobservations?\b/.test(q)) return 'technical_dd';
  if (/\blegal\b|\btitle\s+(?:report|dd|due)\b/.test(q)) return 'legal_dd';
  if (/\bfinancial\b|\bfinance\s+(?:report|dd|due)\b/.test(q)) return 'financial_dd';
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

/** The cards a chat may accept or set aside. An admin's card is decided by an admin, where it is shown. */
const decidedInChat = (card: ChatProposal): boolean => !ADMIN_ONLY_PROPOSALS.has(card.kind);

/** What the last reply of a chat left: the cards it listed that are still open, and the papers it filed that still have values waiting. */
interface LeftByLastReply {
  /** Every card it listed that is still open. */
  cards: ChatProposal[];
  /** The ones a chat may accept or set aside. */
  mine: ChatProposal[];
  rows: EvidenceRecord[];
}

function leftByLastReply(project: DdProject, chat?: ChatSitting): LeftByLastReply {
  const reply = lastSpokenReply(project, chat);
  const listed = new Set(reply?.proposalIds ?? []);
  const cards = project.chatProposals.filter((p) => p.status === 'proposed' && listed.has(p.id));
  const filed = new Set(filedByReply(reply));
  return { cards, mine: cards.filter(decidedInChat), rows: project.evidence.filter((e) => filed.has(e.id) && proposedFacts(e).length) };
}

/**
 * A typed sentence read as an instruction to accept or set aside, in the chat
 * it was typed in, with what the last reply there left.
 *
 * A sentence that only looks like one ("ok", "skip", "approve the land use")
 * is answered as one when the last reply left something it could have meant:
 * nothing is taken, and the choices are offered. When the last reply left
 * nothing it is talk. "Yes" is then an answer to whatever the chat asked, and
 * "reject the contractor's claim" is about the project and not about a card.
 */
function instructionSaid(project: DdProject, sentence: string, chat?: ChatSitting): { said: Instruction; left: LeftByLastReply } | undefined {
  // Asked before the chat itself runs, of a project as it was stored: one from before cards or a thread were kept has neither list.
  ensureProjectShape(project);
  const said = readInstruction(sentence);
  if (!said) return undefined;
  const left = leftByLastReply(project, chat);
  if (said.form === 'unclear' && !left.mine.length && !(said.verb === 'accept' && left.rows.length)) return undefined;
  return { said, left };
}

export function wantsDeterministicProjectChat(
  project: DdProject,
  question: string,
  options: { ingest?: ChatIngestFile[]; sitting?: ChoicePin; place?: ChatPlace; chat?: ChatSitting } = {},
): boolean {
  if (options.ingest?.length) return true;
  const q = question.trim();
  const ql = q.toLowerCase();
  if (!q) return true;
  // A pressed choice that accepts or sets aside acts on the ids it carries. Its sentence is not for anything to read.
  if (options.sitting?.decision) return true;
  // A page or a stage asked for by name is a place to go, and needs no model to find.
  if (placeFromText(project, q, options.place)) return true;
  // A document given to a function by name is the person's own instruction.
  if (asksToFileUnder(project, q)) return true;
  // So is accepting or setting aside in one of its typed forms. It is carried out as said, or answered with what can be pressed, and no model reads it.
  if (instructionSaid(project, q, options.chat)) return true;
  // A factual question the file itself answers is looked up, not paraphrased:
  // instant, free, and every figure carries its page.
  if (answerFromFile(project, q, options.place)) return true;
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
  if (/\b(mitigate|close|accept)\b/.test(ql) && /\brisk\b/.test(ql)) return true;
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

export function projectRegisterBriefing(project: DdProject, viewContext?: string, place?: ChatPlace): string {
  ensureProjectShape(project);
  // The page by its name and stage where the request said them; the bare pane from a client that says only that.
  const looking = chatPlaceLine(project, place) ?? viewContext;
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
    `Project ${project.reference} — ${project.name}. Stage ${stageAndStep(project.currentStage)}; health ${project.health}.`,
    looking ? `Reader is looking at: ${looking}.` : null,
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

/**
 * What each material finding rests on: the documents it cites and what it says
 * they state, page and words included.
 *
 * The briefing names a finding and whether it has evidence, which is all a
 * person reading it needs. A model asked "which documents say so" needs the
 * rest — given the briefing alone, it answered that it could not see the
 * source of two lapsed NOCs that were filed with their page and wording. Kept
 * out of the briefing itself, which is also what chat shows with no model.
 */
export function findingEvidenceBriefing(project: DdProject): string {
  ensureProjectShape(project);
  const byId = new Map(project.evidence.map((e) => [e.id, e]));
  return materialOpenFindings(project)
    .slice(0, 6)
    .filter((f) => f.evidenceIds.length > 0)
    .map((f) => {
      const documents = f.evidenceIds
        .map((id) => byId.get(id))
        .filter((e): e is NonNullable<typeof e> => Boolean(e))
        .map((e) => (e.documentType ? `${e.title} (${e.documentType})` : e.title));
      const said = f.description.replace(/\s+/g, ' ').trim();
      const clipped = said.length > 400 ? `${said.slice(0, 399)}…` : said;
      return `- ${f.title}. Evidence: ${documents.join('; ') || 'on file'}.${clipped ? ` ${clipped}` : ''}`;
    })
    .join('\n');
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

function briefingAnswer(project: DdProject, viewContext?: string, place?: ChatPlace): Pick<ProjectChatTurn, 'text' | 'citedEvidenceIds' | 'citedNodeIds'> {
  const next = projectNextStep(project);
  const material = materialOpenFindings(project);
  return {
    text: projectRegisterBriefing(project, viewContext, place),
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
    /** The check being sat on. With `evidenceId`, the document a pressed choice was offered for. */
    sitting?: ChoicePin;
    /**
     * The page the person asked from, and the stage it is looked at in. A
     * place asked for by name opens from here, and what is missing, a summary
     * and the findings are this page's when it is a function's or a
     * department's. Absent, the pane in `viewContext` stands for it.
     */
    place?: ChatPlace;
    /**
     * The person asking is an outside collaborator. Giving a document to a
     * function is the firm's own people's to do, on the register and here.
     */
    outside?: boolean;
    /**
     * The chat the question was asked in. An approval answers the last reply
     * of this chat, and a caller that keeps no sittings is read against the
     * last reply on the thread.
     */
    chat?: ChatSitting;
    /**
     * The sentence asked for the filed documents to be read, and none was left
     * to read. The caller knows, because it is the one that fetches them. The
     * reply says so and nothing else: answered as talk it became the next
     * step with a card, and the "approve all" meant for the paper just read
     * answered that instead.
     */
    nothingLeftToRead?: boolean;
    /** What reading the attached documents cost. Rendered beside the turn, as a chat turn's cost already is. */
    spend?: TurnSpend;
  } = {},
): ProjectChatResult {
  ensureProjectShape(project);
  const actor = options.actor ?? 'operator';
  const q = question.trim() || (options.ingest?.length ? DROPPED_WITHOUT_WORDS : '');
  const ql = q.toLowerCase();
  const here: ChatPlace = options.place ?? chatPlaceFrom(undefined, options.viewContext) ?? {};
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

  /**
   * A record named in the sentence, opened where it lives. A document in hand
   * opens on the page of the function that holds it, at its documents. A
   * check, a scope or a due diligence opens as the sitting it has always
   * been: that is where its values are recorded.
   */
  const openTalk = (talk: TalkSitting, label: string) => {
    const at = talk.kind === 'evidence' && talk.extra.evidenceId ? placeOfRecord(project, talk.extra.evidenceId, here) : undefined;
    if (at) navigate(at.open.pane, label, { ...talk.extra, ...at.open.extra });
    else navigate(paneForTalk(talk.kind), label, talk.extra);
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

  /*
   * The same card is not offered twice. Check values are the same card when
   * they carry the same values for the same check — not when their titles
   * match: two deeds stating different extents both read "Record extent per
   * title on …", and offering only the first would settle the disagreement
   * for the person.
   */
  const sameAs = (p: ChatProposal) =>
    p.kind === 'record_check_fields' ? `${p.kind}:${String(p.payload.checkId)}:${JSON.stringify(p.payload.values ?? {})}` : p.title;
  /*
   * A card already waiting is not raised a second time, and the reply still
   * points at it ("accept the request waiting beside it"), so it is listed
   * with the reply's own. Left off, an "ok" typed under that reply answered a
   * reply that had no card. The fresh ones are what comes back: they are what
   * the caller counts and files.
   */
  const offer = (rows: ChatProposal[]) => {
    const open = project.chatProposals.filter((p) => p.status === 'proposed');
    const fresh = rows.filter((p) => !open.some((held) => sameAs(held) === sameAs(p)));
    const waiting = open.filter((held) => rows.some((p) => sameAs(p) === sameAs(held)));
    for (const p of fresh) project.chatProposals.push(p);
    offered = [...fresh, ...waiting];
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
  /*
   * A page or a stage asked for by name. Read before anything that answers on
   * topic words: "open Approvals" names a function, and is not an approval to
   * give, a check with a title like it, or a portal to fetch from.
   */
  const went = ingest.length ? null : placeFromText(project, q, here);
  // The chat this was asked in, and whose it is.
  const chat = options.chat && { ...options.chat, actor: options.chat.actor ?? options.actor };
  // A choice that was pressed, or failing that a typed instruction. Read before this request adds its own turns to the thread.
  const pressed = !ingest.length && options.sitting?.decision ? options.sitting : undefined;
  const typed = ingest.length || pressed ? undefined : instructionSaid(project, q, chat);

  /*
   * Accepting and setting aside, by a typed form or by a pressed choice.
   *
   * Typed words do three things: take what the last reply left, take
   * everything open when that is said in full, and take or set aside one card
   * by its exact title in quotes. Everything else is a choice that is pressed,
   * and a choice names what it means by id. `instruction.ts` reads the words;
   * what each takes is decided here.
   *
   * "The last reply" is the last thing this chat said to the person. What it
   * left is the cards it listed that are still open and the values waiting on
   * the papers it filed. A paper an answer only cites is not one it filed:
   * "approve all" typed after "which documents are on file?" took every value
   * on every paper the answer named.
   */
  const openCards = () => project.chatProposals.filter((p) => p.status === 'proposed');

  /** Accept these cards, and the values waiting on these papers. */
  const acceptThese = (targets: ChatProposal[], factRows: EvidenceRecord[]) => {
    const before = fileStanding(project);
    let valuesAccepted = 0;
    for (const row of factRows) {
      valuesAccepted += reviewFacts(project, row.id, 'all', 'accept', actor).changed.length;
      highlightIds.push(row.id);
    }
    const done: string[] = [];
    /*
     * "All" is not a choice between documents that disagree. A check value
     * two documents state differently stays waiting on its check, where
     * the person picks one; everything else is accepted.
     */
    let toPick = 0;
    for (const item of targets) {
      if (item.status !== 'proposed') continue;
      if (item.kind === 'record_check_fields') {
        const left = contestedKeys(project, item);
        const open = waitingFieldKeys(item).filter((key) => !left.includes(key));
        toPick += left.length;
        if (!open.length) continue;
        try {
          decideCheckFields(project, item.id, open, 'accept', actor);
        } catch {
          continue;
        }
        done.push(item.title);
        highlightIds.push(String(item.payload.checkId));
        continue;
      }
      const result = commitChatProposal(project, item.id, actor);
      done.push(`${item.title}${result.recordId ? ` → ${result.recordId}` : ''}`);
      if (result.recordId) highlightIds.push(result.recordId);
    }
    const accepted = [valuesAccepted ? plural(valuesAccepted, 'value') : '', done.length ? plural(done.length, 'suggestion') : ''].filter(Boolean).join(' and ');
    commands.push(accepted ? `Accepted ${accepted}` : 'Nothing left to accept');
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
    assistantText = [
      valuesAccepted ? `Accepted ${plural(valuesAccepted, 'value')} on ${plural(factRows.length, 'document')}.` : '',
      done.length ? approvalReceipt(targets.filter((t) => t.status === 'committed')) : '',
      toPick ? `${toPick === 1 ? 'One value the documents disagree on waits' : `${toPick} values the documents disagree on wait`} on the checks for you to pick.` : '',
    ].filter(Boolean).join(' ');
    /*
     * What still waits, said before anything this reply offers of its own.
     * An approval takes the last reply's and no other, so a value an
     * earlier paper also states can be left waiting with its card, and a
     * receipt that said only what was accepted read as if nothing were.
     * A check this approval left for a person to pick is in the line above
     * and is not counted twice.
     */
    const forPicking = new Set(targets.filter((t) => t.kind === 'record_check_fields').map((t) => t.id));
    const rest = waitingSentence(
      project,
      { entries: waitingOnCanvas(project).entries.filter((e) => !(e.proposalId && forPicking.has(e.proposalId))) },
      here,
      Boolean(assistantText),
    );
    if (rest) assistantText = `${assistantText} ${rest}`.trim();
    metrics = standingDelta(before, fileStanding(project));
    toolCalls = [{ name: 'approve', summary: `${done.length} committed` }];
    /*
     * One card approved opens exactly what it wrote — a filed deed opens at
     * its page. A batch opens the register it mostly wrote to, and nothing
     * more: auto-opening the first document's viewer over a batch put a
     * modal over the chat just as it offered the next step.
     */
    const lead = targets[0];
    const extra = targets.length === 1 && lead ? extrasFromPayload(lead.payload as Record<string, unknown>) : undefined;
    // Only document values accepted: the register they are on.
    const pane = !targets.length ? 'evidence' : extra?.checkId ? 'scope' : paneForProposalKind(mostCommonKind(targets));
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
      assistantText += ` ${plural(fills.length, 'check')} can take values from documents already on file; they are waiting on the checks.`;
    }
    const startDd = fills.length ? undefined : ddForDocumentsProposal(project, factsOnFile(project).map((row) => row.fact), actor);
    if (startDd) {
      offer([startDd]);
      assistantText += ` Your documents answer checks in the ${startDd.title.replace(/^Start /, '')}; it is waiting to start under Technical DD.`;
    }
    const next = projectNextStep(project, actor);
    if (next.kind !== 'idle' && next.proposals.length && !fills.length && !startDd) offer([next.proposals[0]!]);
  };

  /** Set these cards aside. */
  const setAsideThese = (cards: ChatProposal[]) => {
    for (const card of cards) rejectChatProposal(project, card.id);
    commands.push(cards.length === 1 ? `Rejected “${cards[0]!.title}”` : `Rejected ${cards.length}`);
    assistantText = cards.length === 1 ? `Skipped “${cards[0]!.title}”.` : `Skipped ${cards.length}.`;
  };

  /**
   * The reply when nothing was taken: what waits and where, and under it the
   * choices that would take what the last reply left. It names its own tool,
   * so the next instruction answers the reply before this one and no model
   * rewrites what this one said.
   */
  const nothingTaken = (verb: InstructionVerb, left: LeftByLastReply) => {
    const accept = verb === 'accept';
    const waiting = waitingOnCanvas(project);
    const rows = accept ? left.rows : [];
    const own = waiting.entries.filter((e) => (e.proposalId ? left.mine.some((c) => c.id === e.proposalId) : rows.some((r) => r.id === e.evidenceId)));
    if (!waiting.entries.length) {
      assistantText = accept ? 'Nothing waiting. Ask what’s next, or drop a document in.' : 'Nothing is waiting, so nothing was set aside.';
    } else if (own.length) {
      const offered = waitingChoices(project, verb, left.mine, own, here);
      const waits = waitingSentence(project, waiting, here, false);
      const one = waits.startsWith('1 ');
      choices = offered.choices;
      assistantText = [
        accept ? 'Nothing was accepted.' : 'Nothing was set aside.',
        waits,
        accept
          ? one ? 'Accept it below, or where it is shown.' : 'Pick what to accept below, or accept each where it is shown.'
          : one ? 'Set it aside below, or where it is shown.' : 'Pick what to set aside below, or set each aside where it is shown.',
        offered.more ? `Four from the last reply are below, ${offered.more}.` : '',
      ].filter(Boolean).join(' ');
    } else {
      const waits = waitingSentence(project, waiting, here);
      assistantText = `Nothing from the last reply is left to ${accept ? 'accept' : 'set aside'}. ${waits} ${waits.startsWith('1 ') ? 'It is' : 'Each is'} ${accept ? 'accepted' : 'set aside'} where it is shown.`;
    }
    toolCalls = [{ name: accept ? NOTHING_ACCEPTED : NOTHING_SET_ASIDE, summary: accept ? 'Nothing accepted' : 'Nothing set aside' }];
  };

  /** A line that says nothing was taken, and why. */
  const refused = (verb: InstructionVerb, text: string) => {
    assistantText = text;
    toolCalls = [{ name: verb === 'accept' ? NOTHING_ACCEPTED : NOTHING_SET_ASIDE, summary: verb === 'accept' ? 'Nothing accepted' : 'Nothing set aside' }];
  };

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
     * The documents are filed now. They are the person's own files — asking
     * them to approve filing what they just dropped in was a click that
     * decided nothing. What each document STATES waits on its row, value by
     * value, for them to accept where it sits; what it would CHANGE — a
     * check's values, a finding, a DD to start — waits in the register it
     * would change.
     */
    const before = fileStanding(project);
    const filedIds: string[] = [];
    for (const card of rows.filter((r) => r.kind === 'file_evidence')) {
      const filed = commitChatProposal(project, card.id, actor);
      if (filed.recordId) filedIds.push(filed.recordId);
    }
    const valuesWaiting = filedIds.reduce((n, evId) => n + proposedFacts(project.evidence.find((e) => e.id === evId) ?? {}).length, 0);
    // Filing is the change now, so the upload's own reply says whether the file moved.
    metrics = standingDelta(before, fileStanding(project));
    /*
     * Nothing in these documents to review — unread, or nothing they state
     * that a check asks for. The approval that used to follow an upload is
     * gone, and with it the moment the next step was offered, so it is
     * offered here: one card, waiting in its register.
     */
    if (!valuesWaiting && !rows.some((r) => r.status === 'proposed')) {
      const next = projectNextStep(project, actor);
      if (next.kind !== 'idle' && next.proposals.length) {
        const filedCards = offered;
        offer([next.proposals[0]!]);
        offered = [...filedCards, ...offered];
      }
    }
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
    const redFlags = rows.filter((p) => p.kind === 'add_finding');
    const patches = rows.filter((p) => p.kind === 'patch_project').length;
    const extras = [
      patches ? `${plural(patches, 'project detail')} to fill` : '',
      ddCard ? `the ${String(ddCard.payload.name ?? ddCard.title.replace(/^Start /, ''))} is waiting to start under Technical DD, since ${ingest.length === 1 ? 'it answers' : 'they answer'} its checks` : '',
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
            : `Read ${plural(ingest.length - unread, 'file')}${unread ? `; ${unread} I couldn’t` : ''}.`;
    /*
     * Where each paper went, said in the menu's words: the function it was
     * filed under and the stage the project is at. A paper no function holds
     * stays in Documents, and the functions it might belong to are offered
     * as choices. None is picked for it.
     */
    const groups = filedGroups(project, filedIds, here);
    const filedLine = groups.length ? `\n${filedSentence(project, groups, unread > 0)}` : '';
    const loose = groups.find((g) => !g.fn);
    const looseRow = loose ? project.evidence.find((e) => e.id === loose.ids[0]) : undefined;
    if (looseRow && !options.outside) choices = filingChoices(project, looseRow);
    /*
     * Where the values go: how many are offered to checks, function by
     * function. Counted in values and not in checks, because a value is what
     * a person accepts.
     */
    const offeredLine = offeredSentence(offeredByFunction(project, rows.filter((p) => p.status === 'proposed')));
    /*
     * What the papers state that differs from what is already held: on a
     * check, on the project record, or on another paper a person accepted.
     * Said with both values and where each came from, and never settled here.
     * On a check the new value waits beside the recorded one until a person
     * keeps one of them.
     */
    const disagreements = filedIds.flatMap((evId) => {
      const row = project.evidence.find((e) => e.id === evId);
      return row ? documentDisagreements(project, row) : [];
    });
    const differLine = disagreements.length ? `\n${disagreementSentence(disagreements)}` : '';
    const waitingLine = valuesWaiting
      ? `\n${valuesWaiting === 1 ? '1 value is waiting on the right, beside the words it came from' : `${valuesWaiting} values are waiting on the right, each beside the words it came from`}.${offeredLine ? ` ${offeredLine}` : ''} Nothing is on the file until you accept it there.`
      : offeredLine
        ? `\n${offeredLine} Nothing is on the file until you accept it there.`
        : '';
    // What else the papers reach, only when they bring something that could move a value or raise a finding.
    // Not to an outside collaborator: what rests on a function is the firm's view of the whole project.
    const reach = !options.outside && (valuesWaiting || redFlags.length || disagreements.length) ? reachSentence(project, filedIds) : '';
    const extraLine = extras.join('; ');
    assistantText = `${heading}${extraLine ? ` ${extraLine.charAt(0).toUpperCase()}${extraLine.slice(1)}.` : ''}${filedLine}${flagLine}${differLine}${waitingLine}${reach ? `\n${reach}` : ''}`;
    /*
     * The papers this reply brought, and nothing else. "Approve all" accepts
     * what waits on the papers a reply filed, which are the ones it cites,
     * and the chips under a reply count them. So a paper this one only
     * differs from is named in the words, where its link is drawn from, and
     * is not cited.
     */
    citedEvidenceIds = [...new Set([...filedIds, ...rows.flatMap((p) => p.citedEvidenceIds ?? [])])];
    citedNodeIds = rows.flatMap((p) => p.citedNodeIds ?? []);
    highlightIds.push(...citedEvidenceIds);
    toolCalls = [{ name: 'ingest', summary: `Filed ${plural(filedIds.length || ingest.length, 'file')}` }];
    /*
     * The canvas opens where the papers went: the page of the function the
     * first of them was filed under, at its documents, with the new rows lit.
     * Papers in other functions are a chip each under the reply. Where no
     * function's page has a place for the paper, it is the register of every
     * document, as it always was. Never at the paper itself: that opens its
     * viewer, a modal, over the values waiting to be reviewed on the desk.
     */
    const first = groups[0];
    if (first?.fn && first.open.pane !== 'evidence') navigate(first.open.pane, `Opened ${chatPlaceLabel({ fn: first.fn })} documents`, first.open.extra);
    else navigate('evidence', 'Opened documents');
  } else if (options.nothingLeftToRead) {
    assistantText = 'Nothing on file is left to read.';
    // Its own name: it raises and files nothing, so it is not the reply the next instruction answers.
    toolCalls = [{ name: NOTHING_TO_READ, summary: 'Nothing to read' }];
  } else if (pressed) {
    /*
     * A choice that was pressed. It acts on the cards and papers it names and
     * on nothing else, and only on those still waiting: not on a title, which
     * two cards can share, and not on "the last reply", which is another
     * reply by the time an older button is pressed.
     */
    const ids = new Set(pressed.proposalIds ?? []);
    const cards = openCards().filter((p) => ids.has(p.id) && decidedInChat(p));
    if (pressed.decision === 'aside') {
      if (cards.length) setAsideThese(cards);
      else refused('aside', 'That is no longer waiting, so nothing was set aside.');
    } else {
      const papers = new Set(pressed.evidenceIds ?? []);
      // An outside collaborator is offered the papers a reply to them filed. Ids put together by hand are held to the same: the thread they see is their own.
      const theirs = options.outside ? new Set(project.conversation.flatMap((turn) => filedByReply(turn))) : undefined;
      const rows = project.evidence.filter((e) => papers.has(e.id) && (!theirs || theirs.has(e.id)) && proposedFacts(e).length);
      if (cards.length || rows.length) acceptThese(cards, rows);
      else refused('accept', 'That is no longer waiting, so nothing was accepted.');
    }
  } else if (asksToFileUnder(project, q)) {
    /*
     * "File “Survey notes” under Legal › Title": a person giving a document
     * to a function, in their own words or by pressing the choice a drop
     * offered. It is their instruction, so it runs, and the way back is the
     * undo every instruction has. An outside collaborator is told it is not
     * theirs to do, as the register tells them.
     */
    const filing = options.outside
      ? ({ kind: 'refused', text: 'Only the firm’s own people can file a document under a function. Nothing moved.' } as const)
      : fileUnderFromText(project, q, actor, options.sitting?.evidenceId);
    if (filing?.kind === 'filed') {
      const at = placeOfRecord(project, filing.evidence.id, here);
      const { evidenceId: _viewer, ...extra } = at?.open.extra ?? {};
      if (at && at.open.pane !== 'evidence') navigate(at.open.pane, `Filed “${filing.evidence.title}” under ${filing.label}`, extra);
      else navigate('evidence', `Filed “${filing.evidence.title}” under ${filing.label}`);
      assistantText = `“${filing.evidence.title}” is filed under ${filing.label}.`;
      toolCalls = [{ name: 'assign_document', summary: filing.label }];
      citedEvidenceIds = [filing.evidence.id];
      highlightIds.push(filing.evidence.id);
    } else {
      assistantText = filing?.text ?? 'Name the document and the function to file it under.';
      if (filing?.kind === 'ask') choices = filing.choices;
      toolCalls = [{ name: 'clarify', summary: 'Not filed' }];
    }
  } else if (went) {
    /*
     * Going somewhere changes nothing on the record, so it happens at once and
     * the reply is one line: where it went, and the figure that matters there.
     * A name two pages share, or a page with no work at the stage asked for,
     * is put back to the person as a choice, and nothing moves.
     */
    if (went.kind === 'go') {
      // A stage looked at is said by the stage, a page opened by the page.
      const stage = went.stageOnly ? STAGES.find((s) => s.key === went.place.stage) : undefined;
      const name = stage ? stage.label : chatPlaceLabel(went.place);
      navigate(went.open.pane, stage ? `Looking at ${name}` : `Opened ${name}`, went.open.extra);
      assistantText = placeOpenedLine(project, went, here, options.outside) ?? [paneLine(project, went.open.pane), stageChangedLine(project, went.place.stage, here)].filter(Boolean).join(' ');
      toolCalls = [{ name: 'navigate', summary: name }];
    } else {
      assistantText = went.text;
      if (went.kind === 'ask') choices = went.choices;
      toolCalls = [{ name: 'clarify', summary: went.summary }];
    }
  } else if (typed && (typed.said.form !== 'unclear' || !registerRecordCommand)) {
    /*
     * One of the three typed forms, or a sentence that looks as if it wanted
     * to be one. "Accept the flood risk" and "close the action" are words for
     * the registers, and are left to them.
     */
    const { said, left } = typed;
    if (said.form === 'last') {
      if (left.mine.length || left.rows.length) acceptThese(left.mine, left.rows);
      else nothingTaken('accept', left);
    } else if (said.form === 'open') {
      // Everything open is the firm's to take. An outside collaborator sees the papers in their grant and none of the firm's cards.
      const cards = openCards().filter(decidedInChat);
      const rows = project.evidence.filter((e) => proposedFacts(e).length);
      if (options.outside) refused('accept', 'Only the firm’s own people can accept everything that is open. Nothing was accepted.');
      else if (cards.length || rows.length) acceptThese(cards, rows);
      else nothingTaken('accept', left);
    } else if (said.form === 'titled') {
      // The exact title, of exactly one open card, which the last reply listed. Anything less is picked below, by id.
      const titled = openCards().filter((p) => sameTitle(p.title, said.title));
      const card = titled.length === 1 && left.cards.includes(titled[0]!) ? titled[0]! : undefined;
      if (card && !decidedInChat(card)) refused(said.verb, `“${card.title}” is for a workspace admin to ${said.verb === 'accept' ? 'accept' : 'set aside'}. It waits where it is shown.`);
      else if (!card) nothingTaken(said.verb, left);
      else if (said.verb === 'accept') acceptThese([card], []);
      else setAsideThese([card]);
    } else {
      nothingTaken(said.verb, left);
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
    assistantText = `Ready to generate the ${label} — ${reportSummaryLine(project)} It is waiting under Report.`;
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
      if (fills.length) assistantText += `\n${plural(fills.length, 'check')} can take values from documents already on file; they are waiting on the checks.`;
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
      const fileAnswer = answerFromFile(project, q, here, { outside: options.outside });
      if (fileAnswer) {
        assistantText = fileAnswer.text;
        citedEvidenceIds = fileAnswer.citedEvidenceIds;
        citedNodeIds = fileAnswer.citedNodeIds.length ? fileAnswer.citedNodeIds : undefined;
        highlightIds.push(...fileAnswer.citedEvidenceIds, ...fileAnswer.citedNodeIds);
        toolCalls = [{ name: 'answer_from_file', summary: fileAnswer.summary }];
        const to = fileAnswer.navigate;
        if (to && 'fn' in to) {
          // The page the answer was read from, at the part it was read from. A department switched off has no page to open.
          const page = openPlace(project, to, undefined, here);
          if (page.kind === 'go') navigate(page.open.pane, '', page.open.extra);
        } else if (to) {
          // A document quoted by its page opens on the page of the function that holds it, at that page.
          const at = to.evidenceId ? placeOfRecord(project, to.evidenceId, here) : undefined;
          if (at) navigate(at.open.pane, '', { ...at.open.extra, ...(to.page ? { page: to.page } : {}) });
          else navigate(to.pane, '', to.evidenceId ? { evidenceId: to.evidenceId, page: to.page } : undefined);
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
            assistantText = 'That update is already waiting on the right. Accept it there, or set it aside and say the value again.';
            toolCalls = [{ name: 'advise', summary: 'Already proposed' }];
          } else {
          assistantText = [
            'I can apply these updates from what you just said. They are waiting on the right; nothing is written until you accept them there.',
            cards.map((p) => `• ${p.title}\n  ${p.rationale}`).join('\n'),
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
          assistantText = `Already asked for. ${side.proposals.length === 1 ? 'It is' : `${side.proposals.length} are`} waiting on the right.`;
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
      ? 'Ready to screen the property against the evidence on file. It waits on the Value tab: accepting it checks the title against the state rules and writes findings, risks and gaps. The value itself comes from the inputs — nothing is a certified valuation.'
      : 'A property screen is already waiting on the Value tab.';
    toolCalls = [{ name: 'screen', summary: 'Proposed property screen' }];
    navigate('valuation', 'Opened Value');
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
      openTalk(talk, `Opened ${talk.label}`);
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
      const rule = NAV_RULES.find((r) => r.test(ql));
      const name = rule ? undefined : unknownName(q);
      if (name) {
        /*
         * A name nothing answers to: no page, no stage, no record. Opening
         * the overview for it, which is what the line below does for a
         * sentence that names nothing, would be going somewhere the person
         * did not ask for. So it says so, and nothing moves.
         */
        assistantText = `Nothing on this project is called “${name}”. Nothing moved.`;
        toolCalls = [{ name: 'clarify', summary: 'No page by that name' }];
      } else {
      const pane = rule?.pane ?? 'overview';
      navigate(pane, `Opened ${pane}`);
      // One line: what opened and the figure that matters there. The full
      // register briefing used to follow — ten lines under "open the graph".
      assistantText = paneLine(project, pane);
      toolCalls = [{ name: 'navigate', summary: pane }];
      }
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
        cards.length ? `${plural(cards.length, 'suggestion')} waiting on the right.` : next.text,
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
      const brief = briefingAnswer(project, options.viewContext, options.place);
      assistantText = brief.text;
      citedEvidenceIds = brief.citedEvidenceIds ?? [];
      citedNodeIds = brief.citedNodeIds;
      toolCalls = [{ name: 'briefing', summary: 'Register briefing' }];
    } else {
      const talk = sittingWithField(project, talkSittingFromText(project, q));
      if (talk) {
        openTalk(talk, '');
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
    proposalIds: [...new Set(offered.map((p) => p.id))],
  });
  appendTurns(project, userTurn, assistantTurn);
  return { userTurn, assistantTurn, commands, navigations, proposals: [...new Set(offered)], highlightIds: [...new Set(highlightIds)] };
}

export function clearProjectConversation(project: DdProject): void {
  ensureProjectShape(project);
  project.conversation = [];
  project.updatedAt = nowIso();
}
