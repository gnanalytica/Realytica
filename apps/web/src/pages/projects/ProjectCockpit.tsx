import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LayoutDashboard, Maximize2, MessageCircle, PanelRight, Search } from 'lucide-react';
import {
  PROJECT_HEALTH_LABEL,
  cockpitPath,
  graphNodeLabels,
  isProjectCockpitPane,
  paneFromProjectPath,
  projectNextStep,
  paneForTalk,
  sittingFromCitedId,
  sittingFromTurn,
  sittingWithField,
  proposalsPinnedToCheck,
  type AgentStep,
  type ChatProposal,
  type CockpitPathExtra,
  type CopilotTurn,
  type DdProject,
  type EvidenceItem,
  type ProjectChatResult,
  type ProjectCockpitPane,
  type TalkSitting,
} from '@realytica/shared';
import { api } from '../../lib/api';
import { CopilotPanel } from '../../components/CopilotPanel';
import { Badge, Button, Spinner, cn, useToast } from '../../components/ui/kit';
import { DESKTOP_QUERY, useMediaQuery } from '../../lib/useMediaQuery';
import { EMPTY_CHAT_WIDTH, LAYOUTS, clampChatWidth, readChatWidth, writeChatWidth } from './cockpit/layout';
import type { CockpitLayout } from './cockpit/layout';
import { healthTone } from './shared';
import { RouteErrorBoundary } from '../../components/layout/ErrorBoundary';
import type { ProjectOutlet } from './ProjectLayout';
import { ProjectCommandBar } from './cockpit/ProjectCommandBar';
import { CockpitPaneStrip, paneLabel } from './cockpit/rail';
import { SittingChip, SittingDock } from './cockpit/SittingPeek';

function sameSitting(a: TalkSitting, b: TalkSitting): boolean {
  return (
    a.kind === b.kind
    && a.extra.checkId === b.extra.checkId
    && a.extra.scopeId === b.extra.scopeId
    && a.extra.ddId === b.extra.ddId
  );
}

function ProposalCards({
  turn,
  proposals,
  busy,
  hideIds,
  onApprove,
  onSkip,
}: {
  turn: CopilotTurn;
  proposals: ChatProposal[];
  busy: boolean;
  hideIds?: Set<string>;
  onApprove: (id: string) => void;
  onSkip: (id: string) => void;
}) {
  const rows = (turn.proposalIds ?? [])
    .map((id) => proposals.find((row) => row.id === id))
    .filter((row): row is ChatProposal => {
      if (!row) return false;
      return !hideIds?.has(row.id);
    });
  if (!rows.length) return null;
  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {rows.map((item) => {
        const open = item.status === 'proposed';
        return (
          <div key={item.id} className="rounded-lg bg-surface px-3 py-2 ring-1 ring-inset ring-[var(--ring)]">
            <p className="text-[12.5px] font-medium text-ink">{item.title}</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">{item.rationale}</p>
            <p className="mt-1 text-[11px] text-ink-muted">{item.impact}</p>
            {typeof item.payload.url === 'string' && item.payload.url ? (
              <a
                href={item.payload.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[11.5px] text-brand underline-offset-2 hover:underline"
              >
                Open portal
              </a>
            ) : null}
            {open ? (
              <div className="mt-2 flex gap-1.5">
                <Button size="sm" variant="primary" disabled={busy} onClick={() => onApprove(item.id)}>
                  Approve
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSkip(item.id)}>
                  Skip
                </Button>
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] font-medium text-ink-muted">
                {item.status === 'committed' ? 'Written to the project' : item.status}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function evidenceForChat(project: ProjectOutlet['project']): EvidenceItem[] {
  return project.evidence.map((e) => ({
    id: e.id,
    statement: e.title,
    sourceType: 'document',
    sourceRef: e.id,
    sourceLabel: e.title,
    confidence: e.status === 'validated' || e.status === 'used' ? 0.9 : 0.55,
    capturedAt: e.updatedAt,
  }));
}

function extrasForNavigation(
  project: DdProject,
  target: ProjectCockpitPane,
  ids: string[],
  nav?: CockpitPathExtra,
): CockpitPathExtra {
  if (nav && (nav.ddId || nav.scopeId || nav.checkId || nav.node || nav.evidenceId || nav.findingId || nav.riskId || nav.actionId || nav.assetId)) {
    return {
      ddId: nav.ddId,
      scopeId: nav.scopeId,
      checkId: nav.checkId,
      node: nav.node,
      evidenceId: nav.evidenceId,
      findingId: nav.findingId,
      riskId: nav.riskId,
      actionId: nav.actionId,
      assetId: nav.assetId,
      page: nav.page,
    };
  }
  if (target === 'graph' && ids[0]) return { node: ids[0] };
  if (target === 'evidence' && ids[0] && project.evidence.some((e) => e.id === ids[0])) return { evidenceId: ids[0] };
  if (target === 'findings' && ids[0] && project.findings.some((f) => f.id === ids[0])) return { findingId: ids[0] };
  if ((target === 'risks' || target === 'actions') && ids[0]) {
    if (project.risks.some((r) => r.id === ids[0])) return { riskId: ids[0] };
    if (project.actions.some((a) => a.id === ids[0])) return { actionId: ids[0] };
  }
  if (target === 'assets' && ids[0] && project.assets.some((a) => a.id === ids[0])) return { assetId: ids[0] };
  if (target === 'dd' && ids[0] && project.assessments.some((a) => a.id === ids[0])) return { ddId: ids[0] };
  if (target === 'scope') {
    for (const a of project.assessments) {
      for (const scope of a.scopes) {
        const check = scope.checks.find((c) => ids.includes(c.id));
        if (check) return { ddId: a.id, scopeId: scope.id, checkId: check.id };
        if (ids.includes(scope.id)) return { ddId: a.id, scopeId: scope.id };
      }
    }
  }
  return {};
}

type MobileSurface = 'chat' | 'work';

/** While one of the two lazily-loaded project tabs arrives. */
function PaneWaiting() {
  return (
    <div className="flex h-full min-h-[40vh] animate-fade-in items-center justify-center">
      <Spinner size={18} />
    </div>
  );
}

export default function ProjectCockpit({ outlet }: { outlet: ProjectOutlet }) {
  const { project, refresh, setProject } = outlet;
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ ddId?: string; scopeId?: string }>();
  const [searchParams] = useSearchParams();
  const pane: ProjectCockpitPane = paneFromProjectPath(location.pathname);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  const [focusMode, setFocusMode] = useState(false);
  const layout: CockpitLayout = focusMode ? 'focus' : pane === 'graph' ? 'study' : 'cockpit';
  const [chatWidth, setChatWidth] = useState<number>(() => readChatWidth() ?? LAYOUTS.cockpit.chat ?? 520);
  const draggingRef = useRef(false);
  /*
   * The ref decides whether a preset may overwrite the width mid-drag; this
   * decides whether the width is allowed to animate. A ref cannot do the
   * second job — nothing re-renders when it changes.
   */
  const [dragging, setDragging] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [chatSteps, setChatSteps] = useState<AgentStep[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [liveLabel, setLiveLabel] = useState<string | null>(null);
  const [dockTalk, setDockTalk] = useState<TalkSitting | null>(null);
  const [mobileSurface, setMobileSurface] = useState<MobileSurface>(() =>
    paneFromProjectPath(typeof window === 'undefined' ? '' : window.location.pathname) === 'overview' ? 'chat' : 'work',
  );

  const threadEmpty = (project.conversation ?? []).length === 0;

  useEffect(() => {
    const preset = LAYOUTS[layout].chat;
    if (preset === null || draggingRef.current) return;
    // A width the person dragged for themselves outranks either default.
    setChatWidth(readChatWidth() ?? (threadEmpty ? EMPTY_CHAT_WIDTH : preset));
  }, [layout, threadEmpty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        setFocusMode((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const goPane = useCallback(
    (next: ProjectCockpitPane, extra?: CockpitPathExtra) => {
      setFocusMode(false);
      setMobileSurface('work');
      navigate(cockpitPath(project.id, next, extra));
    },
    [navigate, project.id],
  );

  const openCited = useCallback(
    (id: string) => {
      const talk = sittingWithField(project, sittingFromCitedId(project, id));
      if (talk) {
        setHighlightIds((prev) => [...new Set([...prev, ...talk.highlightIds])]);
        if (talk.kind === 'check' || talk.kind === 'scope') setDockTalk(talk);
        goPane(paneForTalk(talk.kind), talk.extra);
        return;
      }
      goPane('graph', { node: id });
    },
    [project, goPane],
  );

  const applyResult = useCallback(
    (response: ProjectChatResult & { project: DdProject }) => {
      setProject(response.project);
      const ids = response.highlightIds ?? [];
      setHighlightIds(ids);
      setLiveLabel(
        response.commands[0]
          ?? (response.proposals.length ? `Proposed ${response.proposals.length} update(s) — approve to write` : null),
      );
      const lastNav = response.navigations.at(-1);
      const targetRaw = lastNav?.target ?? null;
      const target = isProjectCockpitPane(targetRaw)
        ? targetRaw
        : targetRaw === 'work'
          ? 'overview'
          : null;
      const namedId = lastNav?.checkId ?? lastNav?.scopeId ?? lastNav?.ddId;
      const named = sittingWithField(
        response.project,
        namedId ? sittingFromCitedId(response.project, namedId) : null,
      );
      if (named && (named.kind === 'check' || named.kind === 'scope')) setDockTalk(named);
      if (target) {
        setFocusMode(false);
        navigate(cockpitPath(response.project.id, target, extrasForNavigation(response.project, target, ids, lastNav)));
      }
      const landOnField = named?.kind === 'check' || named?.kind === 'scope';
      if (landOnField) {
        setMobileSurface('chat');
      } else if (target === 'scope' || Boolean(lastNav?.checkId)) {
        setMobileSurface('work');
      } else if (response.proposals.length > 0 && response.commands.length === 0) {
        setMobileSurface('chat');
      } else if (target || response.commands.length > 0) {
        setMobileSurface('work');
      }
      if (response.commands.length > 0) toast(response.commands.join(' · '), 'good');
    },
    [setProject, navigate, toast],
  );

  const handleAsk = useCallback(
    async (
      question: string,
      files?: File[],
      /**
       * The record a picked choice pinned. Overrides the URL's sitting,
       * which is only where the person happens to be standing — when they
       * click "Physical boundaries…" the answer must be that check, not the
       * one the address bar still points at.
       */
      pinned?: { ddId?: string; scopeId?: string; checkId?: string },
    ) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setAsking(true);
      setChatSteps([]);
      setMobileSurface('chat');
      const sitting = pinned?.checkId
        ? pinned
        : {
            ddId: params.ddId,
            scopeId: params.scopeId,
            checkId: searchParams.get('check') ?? undefined,
          };
      const onStep = (step: AgentStep) => setChatSteps((prev) => [...prev, step]);
      try {
        const response = files?.length
          ? await api.projectChatFiles(project.id, { question, viewContext: pane, files, sitting }, { onStep, signal: ac.signal })
          : await api.projectChat(project.id, { question, viewContext: pane, sitting }, { onStep, signal: ac.signal });
        applyResult(response);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (e instanceof Error && e.name === 'AbortError') return;
        throw e;
      } finally {
        if (abortRef.current === ac) {
          abortRef.current = null;
          setAsking(false);
          setChatSteps([]);
        }
      }
    },
    [project.id, pane, params.ddId, params.scopeId, searchParams, applyResult],
  );

  const handleProposal = useCallback(
    async (id: string, action: 'commit' | 'reject') => {
      setAsking(true);
      try {
        const response =
          action === 'commit' ? await api.commitChatProposal(project.id, id) : await api.rejectChatProposal(project.id, id);
        applyResult(response);
      } finally {
        setAsking(false);
      }
    },
    [project.id, applyResult],
  );

  useEffect(() => {
    if (!pendingQuestion) return;
    const q = pendingQuestion;
    setPendingQuestion(null);
    void handleAsk(q);
  }, [pendingQuestion, handleAsk]);

  const overdue = project.actions.filter((a) => a.status === 'overdue').length;
  const pendingDrafts = (project.aiDrafts ?? []).filter((d) => d.status === 'draft' || d.status === 'accepted' || d.status === 'in_review').length;
  const conversation = (project.conversation ?? []) as CopilotTurn[];
  const spec = LAYOUTS[layout];
  const fillRight = pane === 'graph';
  const currentDd = params.ddId ? project.assessments.find((a) => a.id === params.ddId) : undefined;
  const next = useMemo(() => projectNextStep(project), [project]);
  const nodeLabels = useMemo(() => graphNodeLabels(project), [project]);

  const suggestions = useMemo(() => {
    if (project.assets.length === 0) return [next.title, 'Guide me'];
    const rows = ["What's next?", 'Guide me'];
    if (pendingDrafts) rows.push('Review pending drafts');
    rows.push('Set owner to Priya Shah');
    return rows.slice(0, 4);
  }, [project.assets.length, next.title, pendingDrafts]);

  /**
   * The dock is a pointer to something not on screen. When the work pane is
   * already showing that very check, it is the same card twice — once with the
   * tick and cross, once without — and a person has to work out which one is
   * live. Desktop only: on mobile the two surfaces are never visible at once,
   * so the dock is the only way to act without leaving the conversation.
   */
  const onScreenAlready = useCallback(
    (talk: TalkSitting | null) =>
      Boolean(
        isDesktop &&
          pane === 'scope' &&
          talk &&
          ((talk.kind === 'check' && talk.extra.checkId === searchParams.get('check')) ||
            (talk.kind === 'scope' && talk.extra.scopeId === params.scopeId && !searchParams.get('check'))),
      ),
    [isDesktop, pane, searchParams, params.scopeId],
  );
  const dockIsEcho = onScreenAlready(dockTalk);

  const dockCardIds = useMemo(() => {
    if (dockTalk?.kind !== 'check' || !dockTalk.extra.checkId) return new Set<string>();
    return new Set(proposalsPinnedToCheck(project, dockTalk.extra.checkId).map((p) => p.id));
  }, [dockTalk, project]);

  const workOutlet: ProjectOutlet = {
    ...outlet,
    highlightIds,
    pinnedProposals: project.chatProposals ?? [],
    onApproveProposal: (id) => void handleProposal(id, 'commit'),
    onSkipProposal: (id) => void handleProposal(id, 'reject'),
    proposalBusy: asking,
    onOpenCited: openCited,
  };

  const chat = (
    <CopilotPanel
      fill
      compact={!isDesktop}
      conversation={conversation}
      evidence={evidenceForChat(project)}
      suggestions={suggestions}
      onAsk={handleAsk}
      busy={asking}
      steps={chatSteps}
      nodes={nodeLabels}
      onPickChoice={(text, pinned) => void handleAsk(text, undefined, pinned)}
      screenResult={project.lastScreenResult}
      askingPrice={project.budget ?? null}
      onCancel={asking ? () => abortRef.current?.abort() : undefined}
      disabled={false}
      allowAttach
      onOpenCommands={() => setCommandOpen(true)}
      emptyTitle={next.title}
      emptyHint={next.why}
      placeholder={isDesktop ? 'What should we do next? · Set owner to … · Guide me' : 'Ask this project…'}
      dock={
        dockTalk && !dockIsEcho && (dockTalk.kind === 'check' || dockTalk.kind === 'scope') ? (
          <SittingDock
            project={project}
            talk={dockTalk}
            busy={asking}
            compact={isDesktop}
            onClose={() => setDockTalk(null)}
            onOpen={goPane}
            onApprove={(id) => void handleProposal(id, 'commit')}
            onSkip={(id) => void handleProposal(id, 'reject')}
            onProject={setProject}
          />
        ) : null
      }
      renderTurnExtras={(turn) => {
        const talk = sittingFromTurn(project, turn);
        const field = talk && (talk.kind === 'check' || talk.kind === 'scope') ? talk : null;
        // "Docked" also covers the work pane already showing it: a chip that
        // opens something you are looking at is a control that does nothing.
        const docked = onScreenAlready(field) || (field && dockTalk ? sameSitting(field, dockTalk) : false);
        return (
          <>
            {field && !docked ? <SittingChip talk={field} onOpen={() => setDockTalk(field)} /> : null}
            <ProposalCards
              turn={turn}
              proposals={project.chatProposals ?? []}
              busy={asking}
              hideIds={dockCardIds}
              onApprove={(id) => void handleProposal(id, 'commit')}
              onSkip={(id) => void handleProposal(id, 'reject')}
            />
          </>
        );
      }}
      onOpenNode={openCited}
      onOpenDocument={openCited}
      onOpenEvidence={openCited}
      onClear={
        conversation.length > 0
          ? async () => {
              await api.clearProjectChat(project.id);
              await refresh();
            }
          : undefined
      }
    />
  );

  const workBody = (
    <>
      {liveLabel ? (
        <div className="shrink-0 border-b border-brand/25 bg-brand-soft px-3 py-2 text-[12px] text-ink sm:px-4">
          <span className="font-medium">Live</span>
          <span className="text-ink-muted"> · {liveLabel}</span>
          {highlightIds.length ? <span className="sr-only">{highlightIds.join(', ')}</span> : null}
        </div>
      ) : null}
      {/*
        `[container-type:inline-size]` is what lets a pane lay itself out
        against the space it actually has.

        Every `sm:` and `lg:` inside these panes is a *viewport* query, and the
        pane is not the viewport — it is whatever the chat pane leaves behind,
        which on a 1024px screen is under 400px. Reports asked for a 16rem
        sidebar plus content the moment the window passed 1024px and got 116px
        of content column to put the report in, one word per line. The tabs
        that merely looked cramped were the same bug, quieter.

        Naming no container means the panes match this, the nearest one, so a
        pane dropped somewhere else still measures its own parent.
      */}
      {fillRight ? (
        <div className="min-h-0 min-w-0 flex-1 [container-type:inline-size]">
          {/* One broken pane must not take the project tabs with it, and the
              two lazily-loaded tabs need somewhere to wait. */}
          <RouteErrorBoundary>
            <Suspense fallback={<PaneWaiting />}>
              <Outlet context={workOutlet} />
            </Suspense>
          </RouteErrorBoundary>
        </div>
      ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 [container-type:inline-size] sm:p-4">
          {/* One broken pane must not take the project tabs with it, and the
              two lazily-loaded tabs need somewhere to wait. */}
          <RouteErrorBoundary>
            <Suspense fallback={<PaneWaiting />}>
              <Outlet context={workOutlet} />
            </Suspense>
          </RouteErrorBoundary>
        </div>
      )}
    </>
  );

  return (
    <div className="flex h-[calc(100dvh-56px)] min-h-0 flex-col overflow-hidden">
      {isDesktop ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-hairline px-5 py-2.5">
          <Link to="/projects" className="text-[11.5px] text-ink-secondary hover:text-ink">
            Projects
          </Link>
          <span className="text-ink-muted">·</span>
          <span className="font-mono text-[11px] text-ink-muted">{project.reference}</span>
          <span className="truncate text-[13.5px] font-semibold text-ink">{project.name}</span>
          <Badge tone={healthTone(project.health)}>{PROJECT_HEALTH_LABEL[project.health]}</Badge>
          <div className="flex-grow" />
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="rounded-lg border border-[var(--ring)] bg-surface px-2.5 py-1 text-[11.5px] text-ink-muted hover:text-ink"
          >
            Run a command <span className="font-mono">⌘K</span>
          </button>
          <button
            type="button"
            onClick={() => setFocusMode((v) => !v)}
            title={focusMode ? 'Leave focus' : 'Focus the conversation (⌘.)'}
            aria-pressed={focusMode}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px]',
              focusMode ? 'border-brand bg-brand-soft text-brand' : 'border-[var(--ring)] bg-surface text-ink-secondary hover:text-ink',
            )}
          >
            {focusMode ? <PanelRight size={13} /> : <Maximize2 size={13} />}
            {/*
              This button toggles focus mode. It used to be labelled with the
              layout you were already in — "Cockpit" on most tabs, "Study" on
              the graph, because opening the graph narrows the conversation and
              that preset has a different name.

              So the label changed for a reason that had nothing to do with the
              button, and named a state it does not set: pressing it while it
              read "Study" gave you Focus. A toggle is labelled with what it
              will do, and `aria-pressed` already carries the state.
            */}
            {focusMode ? 'Leave focus' : 'Focus'}
          </button>
        </div>
      ) : (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline px-3">
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
            {mobileSurface === 'chat' ? 'Chat' : paneLabel(pane)}
          </p>
          <Badge tone={healthTone(project.health)}>{PROJECT_HEALTH_LABEL[project.health]}</Badge>
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            aria-label="Run a command"
            className="rounded-lg p-2 text-ink-secondary hover:bg-sunken hover:text-ink coarse:min-h-11 coarse:min-w-11"
          >
            <Search size={16} />
          </button>
        </div>
      )}

      {isDesktop ? (
        <div className="flex min-h-0 flex-1">
          <section
            aria-label="Conversation"
            /*
             * Opening the graph narrows the conversation from 520 to 372 to
             * give the canvas the room — deliberate, and it read as a glitch
             * because it happened in one frame with nothing to follow. Two
             * hundred milliseconds is the difference between a panel that
             * moved and a layout that flinched.
             *
             * Never while dragging: a transition on a width the pointer is
             * already driving lags behind the cursor.
             */
            className={cn(
              'flex min-h-0 min-w-0 flex-col border-r border-hairline',
              !dragging && 'transition-[width] duration-base ease-state motion-reduce:transition-none',
            )}
            style={spec.chat === null ? { flexGrow: 1 } : { width: chatWidth, flexShrink: 0 }}
          >
            <div className="flex min-h-0 flex-1 flex-col p-4">{chat}</div>
          </section>

          {spec.rightPane ? (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the conversation"
              tabIndex={0}
              onPointerDown={(e) => {
                draggingRef.current = true;
                setDragging(true);
                const startX = e.clientX;
                const startW = chatWidth;
                /*
                 * The width has to be carried out of the drag in a variable,
                 * not read back off `chatWidth`.
                 *
                 * `up` closes over the `chatWidth` of the render that started
                 * the drag, and `move` only ever calls the setter — so the
                 * width written to storage was the one from BEFORE the drag.
                 * Dragging the conversation wider and reloading put it
                 * straight back where it was.
                 */
                let latest = startW;
                const move = (ev: PointerEvent) => {
                  latest = clampChatWidth(startW + (ev.clientX - startX));
                  setChatWidth(latest);
                };
                const up = () => {
                  draggingRef.current = false;
                  setDragging(false);
                  writeChatWidth(latest);
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  const next = clampChatWidth(chatWidth + (e.key === 'ArrowLeft' ? -24 : 24));
                  setChatWidth(next);
                  writeChatWidth(next);
                }
              }}
              className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-brand-soft"
            />
          ) : null}

          {spec.rightPane ? (
            <section aria-label="Work surface" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-1">
              <CockpitPaneStrip
                pane={pane}
                project={project}
                ddId={params.ddId}
                scopeId={params.scopeId}
                overdue={overdue}
                pendingDrafts={pendingDrafts}
                onGo={goPane}
                wrap
              />
              {workBody}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <section
            aria-label="Conversation"
            hidden={mobileSurface !== 'chat'}
            className={cn('min-h-0 flex-col', mobileSurface === 'chat' ? 'flex flex-1' : 'hidden')}
          >
            <div className="flex min-h-0 flex-1 flex-col p-3">{chat}</div>
          </section>
          <section
            aria-label="Work surface"
            hidden={mobileSurface !== 'work'}
            className={cn(
              'min-h-0 min-w-0 flex-col overflow-hidden bg-surface-1',
              mobileSurface === 'work' ? 'flex flex-1' : 'hidden',
            )}
          >
            <CockpitPaneStrip
              pane={pane}
              project={project}
              ddId={params.ddId}
              scopeId={params.scopeId}
              overdue={overdue}
              pendingDrafts={pendingDrafts}
              onGo={goPane}
            />
            {workBody}
          </section>

          <nav
            aria-label="Cockpit"
            className="flex shrink-0 border-t border-hairline bg-surface pb-[max(0.35rem,env(safe-area-inset-bottom))]"
          >
            <button
              type="button"
              onClick={() => setMobileSurface('chat')}
              aria-current={mobileSurface === 'chat' ? 'page' : undefined}
              className={cn(
                'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]',
                mobileSurface === 'chat' ? 'font-semibold text-brand' : 'text-ink-muted',
              )}
            >
              <MessageCircle size={18} />
              Chat
            </button>
            <button
              type="button"
              onClick={() => {
                setFocusMode(false);
                setMobileSurface('work');
              }}
              aria-current={mobileSurface === 'work' ? 'page' : undefined}
              className={cn(
                'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]',
                mobileSurface === 'work' ? 'font-semibold text-brand' : 'text-ink-muted',
              )}
            >
              <LayoutDashboard size={18} />
              {paneLabel(pane)}
            </button>
          </nav>
        </div>
      )}

      <ProjectCommandBar
        open={commandOpen}
        project={project}
        onClose={() => setCommandOpen(false)}
        onGo={goPane}
        onAsk={(q) => setPendingQuestion(q)}
        onChanged={refresh}
      />
    </div>
  );
}
