/**
 * Project cockpit — chat, commands, agents, and the orchestrator on DdProject.
 *
 * Person-authored commands (approve, set owner, close this action) stay
 * deterministic. Questions and "help me" run through the project copilot when
 * a model is configured. Model conclusions stay propose-and-review.
 */

import { LIFECYCLE_STAGE_LABEL } from './catalogs';
import { createValuationRun, proposeAiDrafts, snapshotCapabilities } from './capabilities';
import { proposeProjectScreen, wantsProjectScreen } from './project-screen';
import { assessmentProgress, ensureProjectShape, patchRecordStatus, recommendedDdTypes } from './operations';
import type {
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
  renderProjectGuide,
  startDdFromQuestion,
  wantsApprove,
  wantsAssets,
  wantsDdTypes,
  wantsProofs,
  wantsReject,
  wantsReport,
  wantsScopes,
  wantsWizard,
} from './wizard';
import { detectChatSideIntents, handleChatSides } from './chat-sides';

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

export function cockpitPath(
  projectId: string,
  pane: ProjectCockpitPane,
  extra?: { ddId?: string; scopeId?: string; node?: string },
): string {
  const base = `/projects/${projectId}`;
  switch (pane) {
    case 'overview':
      return base;
    case 'assets':
      return `${base}/assets`;
    case 'dd':
      return extra?.ddId ? `${base}/dd/${extra.ddId}` : `${base}/dd`;
    case 'scope':
      return extra?.ddId && extra?.scopeId
        ? `${base}/dd/${extra.ddId}/scopes/${extra.scopeId}`
        : extra?.ddId
          ? `${base}/dd/${extra.ddId}`
          : `${base}/dd`;
    case 'evidence':
      return `${base}/evidence`;
    case 'findings':
      return `${base}/findings`;
    case 'risks':
    case 'actions':
      return `${base}/risks`;
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
    refusedForLackOfEvidence: extra.refusedForLackOfEvidence,
    proposalIds: extra.proposalIds,
  };
}

function appendTurns(project: DdProject, user: ProjectChatTurn, assistant: ProjectChatTurn): void {
  project.conversation.push(user, assistant);
  project.updatedAt = assistant.at;
}

const NAV_RULES: Array<{ pane: ProjectCockpitPane; test: (q: string) => boolean }> = [
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
 * Questions, "guide me", and "what should we do" go to the project copilot
 * when a model is configured.
 */
export function wantsDeterministicProjectChat(
  project: DdProject,
  question: string,
  options: { ingest?: ChatIngestFile[] } = {},
): boolean {
  if (options.ingest?.length) return true;
  const q = question.trim();
  const ql = q.toLowerCase();
  if (!q) return true;
  if (wantsApprove(ql) || wantsReject(ql)) return true;
  if (startDdFromQuestion(project, q, 'probe')) return true;
  const interpreted = interpretConversation(project, q, 'probe');
  if (interpreted.imperative && interpreted.proposals.length) return true;
  if (/\b(close|complete|done|finish)\b/.test(ql) && /\baction\b/.test(ql)) return true;
  if (/\b(close|resolve)\b/.test(ql) && /\bfinding\b/.test(ql)) return true;
  if (/\b(mitigate|close|accept)\b/.test(ql) && /\brisk\b/.test(ql) && !wantsApprove(ql)) return true;
  if (detectChatSideIntents(q).length) return true;
  if (wantsPersonCapability(q)) return true;
  if (wantsNavigate(ql) || NAV_RULES.some((r) => r.test(ql) && /^(open|show|go to|switch to|take me|see|view)\b/.test(ql))) {
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
    navigations: { target: string }[];
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
    citedEvidenceIds: [...new Set(agent.citedEvidenceIds ?? [])],
    citedNodeIds: agent.citedNodeIds ? [...new Set(agent.citedNodeIds)] : undefined,
    toolCalls: agent.toolCalls,
    proposalIds: offered.map((p) => p.id),
  });
  appendTurns(project, userTurn, assistantTurn);
  return {
    userTurn,
    assistantTurn,
    commands: [],
    navigations: agent.navigations,
    proposals: offered,
    highlightIds,
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
  const openFindings = project.findings.filter((f) => f.status === 'open' || f.status === 'under_review');
  const material = openFindings.filter((f) => f.severity === 'high' || f.severity === 'critical');
  const openRisks = project.risks.filter((r) => r.status !== 'closed' && r.status !== 'accepted');
  const overdue = project.actions.filter((a) => a.status === 'overdue');
  const openActions = project.actions.filter((a) => a.status !== 'closed');
  const gaps = project.evidence.filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested');
  const latestVal = project.valuationRuns.filter((r) => r.status !== 'superseded').at(-1);
  const pendingDrafts = project.aiDrafts.filter((d) => d.status === 'draft' || d.status === 'in_review' || d.status === 'accepted');
  const recommended = recommendedDdTypes(project.currentStage).filter(
    (d) => !project.assessments.some((a) => a.ddType === d.key && a.status !== 'archived'),
  );
  const ddLines = project.assessments
    .filter((a) => a.status !== 'archived')
    .map((a) => {
      const p = assessmentProgress(a);
      return `  • ${a.name} (${a.status}): ${p.checkDone}/${p.checkTotal} checks, ${p.percent}%`;
    });

  const lines = [
    `Project ${project.reference} — ${project.name}.`,
    `Type ${project.type.replaceAll('_', ' ')}; ${project.city}; stage ${LIFECYCLE_STAGE_LABEL[project.currentStage]}; health ${project.health}.`,
    viewContext ? `Reader is looking at: ${viewContext}.` : null,
    `${project.assessments.length} DD assessment(s). ${project.assets.length} asset(s).`,
    ddLines.length ? `DD progress:\n${ddLines.join('\n')}` : 'No assessments yet.',
    material.length
      ? `Material open findings (${material.length}): ${material
          .slice(0, 6)
          .map((f) => `${f.title} [${f.severity}]`)
          .join('; ')}.`
      : 'No high or critical open findings.',
    openRisks.length
      ? `Open risks (${openRisks.length}): ${openRisks
          .slice(0, 5)
          .map((r) => r.title)
          .join('; ')}.`
      : 'No open risks.',
    openActions.length
      ? `Open actions: ${openActions.length} (${overdue.length} overdue).`
      : 'No open actions.',
    gaps.length
      ? `Evidence gaps (${gaps.length}): ${gaps
          .slice(0, 6)
          .map((g) => g.title)
          .join('; ')}.`
      : 'No outstanding evidence gaps.',
    latestVal
      ? `Latest indicative valuation: ${project.currency} ${Math.round(latestVal.indicatedValue).toLocaleString()} (${latestVal.ibbi.premise}, ${latestVal.signOff.replaceAll('_', ' ')}). Not a certified IBBI certificate.`
      : 'No valuation run yet.',
    pendingDrafts.length
      ? `${pendingDrafts.length} AI draft(s) awaiting review/commit. Nothing lands in a register until a person commits.`
      : 'No pending AI drafts.',
    recommended.length
      ? `Recommended DD templates not yet running: ${recommended.map((d) => d.label).join(', ')}.`
      : 'All recommended templates for this stage have been instantiated.',
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
  const gaps = project.evidence.filter((e) => e.status === 'expected' || e.status === 'missing' || e.status === 'requested');
  const material = project.findings.filter(
    (f) => (f.status === 'open' || f.status === 'under_review') && (f.severity === 'high' || f.severity === 'critical'),
  );
  return {
    text: projectRegisterBriefing(project, viewContext),
    citedEvidenceIds: gaps.slice(0, 8).map((g) => g.id),
    citedNodeIds: material.slice(0, 8).map((f) => f.id),
  };
}

export function applyProjectChat(
  project: DdProject,
  question: string,
  options: { actor?: string; viewContext?: string; ingest?: ChatIngestFile[]; sides?: ChatSideBundle } = {},
): ProjectChatResult {
  ensureProjectShape(project);
  const actor = options.actor ?? 'operator';
  const q = question.trim() || (options.ingest?.length ? 'I attached documents' : '');
  const ql = q.toLowerCase();
  const userTurn = turn('user', q);
  const commands: string[] = [];
  const navigations: { target: string }[] = [];
  let offered: ChatProposal[] = [];
  const highlightIds: string[] = [];

  const navigate = (pane: ProjectCockpitPane, label: string) => {
    navigations.push({ target: pane });
    commands.push(label);
  };

  const offer = (rows: ChatProposal[]) => {
    const openTitles = new Set(project.chatProposals.filter((p) => p.status === 'proposed').map((p) => p.title));
    const fresh = rows.filter((p) => !openTitles.has(p.title));
    for (const p of fresh) project.chatProposals.push(p);
    offered = fresh;
    return fresh;
  };

  let assistantText = '';
  let toolCalls: ProjectChatTurn['toolCalls'];
  let citedEvidenceIds: string[] = [];
  let citedNodeIds: string[] | undefined;

  const openActions = () => project.actions.filter((a) => a.status !== 'closed');
  const openFindings = () => project.findings.filter((f) => f.status !== 'closed' && f.status !== 'rejected');
  const openRisks = () => project.risks.filter((r) => r.status !== 'closed' && r.status !== 'accepted');

  const isShow = wantsNavigate(ql);
  const runOrchestrate = /\borchestrat/.test(ql) && !/^(open|show|go to|switch to|see|view)\b/.test(ql);
  const proposeDrafts = /\bpropose\b/.test(ql) && /\bdrafts?\b/.test(ql);
  const runValuation = /\b(run|compute|start)\b/.test(ql) && /\bvaluat/.test(ql) && !wantsProjectScreen(q);
  const ingest = options.ingest ?? [];

  if (ingest.length) {
    const rows = offer(proposalsFromIngest(project, ingest, actor));
    const guide = renderProjectGuide(project);
    assistantText = [
      `Read ${ingest.length} file(s). Nothing is filed until you approve a card.`,
      rows.map((p) => `• ${p.title}\n  ${p.rationale}`).join('\n'),
      'Approve a card, or say “approve all”.',
      '',
      guide.text,
    ].join('\n');
    citedEvidenceIds = rows.flatMap((p) => p.citedEvidenceIds ?? []);
    citedNodeIds = rows.flatMap((p) => p.citedNodeIds ?? []);
    highlightIds.push(...(citedEvidenceIds));
    toolCalls = [{ name: 'ingest', summary: `Classified ${ingest.length} file(s)` }];
    navigate('evidence', 'Opened evidence');
  } else if (wantsApprove(ql)) {
    const targets =
      /\ball\b/.test(ql)
        ? project.chatProposals.filter((p) => p.status === 'proposed')
        : [matchProposal(project, q)].filter((p): p is ChatProposal => Boolean(p));
    if (targets.length === 0 && project.chatProposals.filter((p) => p.status === 'proposed').length === 1) {
      targets.push(project.chatProposals.find((p) => p.status === 'proposed')!);
    }
    if (targets.length === 0) {
      assistantText = 'Nothing to approve. Ask “guide me” for the next cards, or attach a document.';
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
      navigate(paneForProposalKind(targets[0]!.kind), `Opened ${paneForProposalKind(targets[0]!.kind)}`);
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
      `${run.evidenceGapCount} evidence gap(s), ${run.openFindingCount} open finding(s).`,
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
      const side = handleChatSides(project, q, actor, options.sides);
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
      assistantText = 'No matching open action. Name it the way it appears on the register, or open the actions pane.';
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
      assistantText = 'No matching open finding. Quote the title, or ask for a briefing.';
    }
  } else if (/\b(mitigate|close|accept)\b/.test(ql) && /\brisk\b/.test(ql) && !wantsApprove(ql)) {
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
      assistantText = 'No matching open risk. Quote the title from the register.';
    }
  } else if (isShow || NAV_RULES.some((r) => r.test(ql) && /^(open|show|go to|switch to|take me|see|view)\b/.test(ql))) {
    const pane = NAV_RULES.find((r) => r.test(ql))?.pane ?? 'overview';
    navigate(pane, `Opened ${pane}`);
    const brief = briefingAnswer(project, options.viewContext);
    assistantText = `Opening the ${pane} pane.\n\n${brief.text}`;
    citedEvidenceIds = brief.citedEvidenceIds ?? [];
    citedNodeIds = brief.citedNodeIds;
    toolCalls = [{ name: 'navigate', summary: pane }];
  } else {
    const guide = renderProjectGuide(project);
    const cards = offer(buildWizardProposals(project, actor));
    const focus =
      wantsAssets(ql) ? cards.filter((p) => p.kind === 'add_asset')
      : wantsDdTypes(ql) ? cards.filter((p) => p.kind === 'start_dd')
      : wantsScopes(ql) ? cards.filter((p) => p.kind === 'add_scope')
      : wantsReport(ql) ? cards.filter((p) => p.kind === 'generate_report')
      : wantsProofs(ql) ? []
      : cards;

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
      wantsWizard(ql) || (!wantsAssets(ql) && !wantsDdTypes(ql) && !wantsScopes(ql) && !wantsReport(ql) && !wantsProofs(ql))
        ? guide.text
        : null,
      wantsAssets(ql) ? `Asset suggestions (${focus.length}): approve a card to create it.` : null,
      wantsDdTypes(ql) ? `DD types to start (${focus.length}): each card instantiates scopes and expected evidence.` : null,
      wantsScopes(ql) ? `Scopes to add (${focus.length}): each card extends an existing assessment.` : null,
      wantsReport(ql) ? `Report cards (${focus.length}): generated from live registers, with findings pointing at their evidence.` : null,
      proofBlock ? `Proofs\n${proofBlock}` : null,
      focus.length ? `Cards in this turn:\n${focus.map((p) => `• ${p.title}\n  ${p.rationale}`).join('\n')}` : cards.length ? `Open cards are ready to approve.` : null,
    ]
      .filter(Boolean)
      .join('\n\n');
    citedEvidenceIds = guide.citedEvidenceIds;
    citedNodeIds = [...guide.citedNodeIds, ...cards.flatMap((p) => p.citedNodeIds ?? [])];
    toolCalls = [{ name: 'wizard', summary: `${cards.length} proposal(s)` }];
    if (wantsReport(ql)) navigate('reports', 'Opened reports');
    }
    }
    }
  }

  const assistantTurn = turn('assistant', assistantText, {
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
